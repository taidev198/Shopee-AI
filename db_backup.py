"""Keep the SQLite database across container restarts by mirroring it to remote storage.

Two stores are supported, chosen by environment variables (Neon wins when both are set):
  * Neon Postgres: BACKUP_NEON_URL (the connection string from the Neon dashboard)
  * Cloudflare D1: BACKUP_D1_ACCOUNT_ID, BACKUP_D1_DATABASE_ID, BACKUP_D1_API_TOKEN
Without them the app behaves as before. Restore runs before the schema is created,
so a fresh container starts from the last upload instead of an empty file.
"""
import base64
import gzip
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

LOG = logging.getLogger('marketlens.backup')
INTERVAL_SECONDS = 60
NEON_INTERVAL_SECONDS = 300  # Neon suspends compute after ~5 idle minutes; uploads only happen after changes
D1_INTERVAL_SECONDS = 180  # D1 bills per row written; a snapshot is several rows
D1_CHUNK_BYTES = 512 * 1024


def _clean(name):
    return ''.join(os.environ.get(name, '').split())


class NeonStore:
    """Latest two snapshots as BYTEA rows in a Neon Postgres table; a checksum guards every read."""
    name = 'neon'
    interval = NEON_INTERVAL_SECONDS

    def __init__(self, dsn, connect=None):
        self.dsn, self.connect_fn, self.ready = dsn, connect, False

    def _connect(self):
        if self.connect_fn:
            return self.connect_fn()
        import psycopg
        # prepare_threshold=None keeps statements unprepared, which Neon's pooled endpoint requires.
        return psycopg.connect(self.dsn, connect_timeout=30, prepare_threshold=None)

    def _run(self, work):
        """Neon suspends idle compute, so the first connection can fail while it wakes; retry briefly."""
        last = None
        for attempt in range(3):
            try:
                with self._connect() as conn:
                    if not self.ready:
                        conn.execute('CREATE TABLE IF NOT EXISTS marketlens_backup(id BIGSERIAL PRIMARY KEY, '
                                     'created_at TIMESTAMPTZ NOT NULL DEFAULT now(), bytes INTEGER NOT NULL, '
                                     'sha256 TEXT NOT NULL, data BYTEA NOT NULL)')
                        self.ready = True
                    return work(conn)
            except Exception as error:
                last = error
                time.sleep(1 + attempt * 2)
        raise last

    def fetch(self):
        def work(conn):
            return conn.execute('SELECT data, bytes, sha256 FROM marketlens_backup ORDER BY id DESC LIMIT 1').fetchone()
        row = self._run(work)
        if row is None:
            return None
        data = bytes(row[0])
        if len(data) != row[1] or hashlib.sha256(data).hexdigest() != row[2]:
            raise RuntimeError('Bản sao lưu trên Neon không khớp checksum.')
        return data

    def save(self, data):
        def work(conn):
            conn.execute('INSERT INTO marketlens_backup(bytes, sha256, data) VALUES(%s, %s, %s)',
                         (len(data), hashlib.sha256(data).hexdigest(), data))
            conn.execute('DELETE FROM marketlens_backup WHERE id NOT IN '
                         '(SELECT id FROM marketlens_backup ORDER BY id DESC LIMIT 2)')
        self._run(work)


class D1Store:
    """Snapshot split into base64 parts; the meta row flips last, so readers never see a partial upload."""
    name = 'd1'
    interval = D1_INTERVAL_SECONDS

    def __init__(self, account_id, database_id, token, chunk_bytes=D1_CHUNK_BYTES, opener=None):
        self.url = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query'
        self.token, self.chunk_bytes = token, chunk_bytes
        self.opener = opener or urllib.request.urlopen
        self.ready = False

    def _query(self, sql, params=()):
        body = json.dumps({'sql': sql, 'params': list(params)}).encode()
        request = urllib.request.Request(self.url, data=body, method='POST', headers={
            'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener(request, timeout=60) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read()[:300].decode('utf-8', 'replace')
            raise RuntimeError(f'D1 trả HTTP {error.code}: {detail}') from None
        if not payload.get('success'):
            raise RuntimeError('D1 báo lỗi: ' + json.dumps(payload.get('errors'))[:300])
        return (payload.get('result') or [{}])[0].get('results') or []

    def _prepare(self):
        if self.ready:
            return
        self._query('CREATE TABLE IF NOT EXISTS backup_parts(generation INTEGER NOT NULL, part INTEGER NOT NULL, '
                    'data TEXT NOT NULL, PRIMARY KEY(generation, part))')
        self._query('CREATE TABLE IF NOT EXISTS backup_meta(id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, '
                    'previous INTEGER, parts INTEGER NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL)')
        self.ready = True

    def fetch(self):
        self._prepare()
        meta = self._query('SELECT generation, parts, bytes, sha256 FROM backup_meta WHERE id=1')
        if not meta:
            return None
        meta = meta[0]
        chunks = []
        for part in range(meta['parts']):
            rows = self._query('SELECT data FROM backup_parts WHERE generation=? AND part=?', (meta['generation'], part))
            if not rows:
                raise RuntimeError(f'Thiếu phần {part} của bản sao lưu trên D1.')
            chunks.append(base64.b64decode(rows[0]['data']))
        data = b''.join(chunks)
        if len(data) != meta['bytes'] or hashlib.sha256(data).hexdigest() != meta['sha256']:
            raise RuntimeError('Bản sao lưu trên D1 không khớp checksum.')
        return data

    def save(self, data):
        self._prepare()
        meta = self._query('SELECT generation FROM backup_meta WHERE id=1')
        previous = meta[0]['generation'] if meta else None
        generation = time.time_ns() // 1_000_000
        parts = [data[i:i + self.chunk_bytes] for i in range(0, len(data), self.chunk_bytes)] or [b'']
        for index, chunk in enumerate(parts):
            self._query('INSERT INTO backup_parts(generation, part, data) VALUES(?,?,?)',
                        (generation, index, base64.b64encode(chunk).decode('ascii')))
        self._query('INSERT INTO backup_meta(id, generation, previous, parts, bytes, sha256, updated_at) VALUES(1,?,?,?,?,?,datetime(\'now\')) '
                    'ON CONFLICT(id) DO UPDATE SET generation=excluded.generation, previous=excluded.previous, '
                    'parts=excluded.parts, bytes=excluded.bytes, sha256=excluded.sha256, updated_at=excluded.updated_at',
                    (generation, previous, len(parts), len(data), hashlib.sha256(data).hexdigest()))
        # keep the newest two generations
        self._query('DELETE FROM backup_parts WHERE generation NOT IN (?, ?)', (generation, previous if previous is not None else generation))


def configured_store():
    """Return the store selected by environment variables, or None."""
    neon = ''.join(os.environ.get('BACKUP_NEON_URL', '').split())
    if neon:
        return NeonStore(neon)
    account, database, token = _clean('BACKUP_D1_ACCOUNT_ID'), _clean('BACKUP_D1_DATABASE_ID'), _clean('BACKUP_D1_API_TOKEN')
    if account and database and token:
        return D1Store(account, database, token)
    return None


def restore_if_missing(db_path, store=None):
    """Download the last upload when the local database file does not exist."""
    db_path = Path(db_path)
    if db_path.exists() and db_path.stat().st_size > 0:
        return 'present'
    store = store or configured_store()
    if store is None:
        LOG.warning('Sao lưu chưa cấu hình (BACKUP_*): dữ liệu sẽ mất khi container khởi động lại.')
        return 'disabled'
    try:
        packed = store.fetch()
        if packed is None:
            LOG.warning('Chưa có bản sao lưu trên kho lưu trữ; bắt đầu với database trống.')
            return 'empty'
        with tempfile.NamedTemporaryFile(dir=db_path.parent, delete=False) as raw:
            raw.write(gzip.decompress(packed))
        os.replace(raw.name, db_path)
        check = sqlite3.connect(db_path)
        try:
            ok = check.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        finally:
            check.close()
        if not ok:
            db_path.unlink()
            LOG.error('Bản sao lưu tải về không hợp lệ; bỏ qua.')
            return 'corrupt'
        LOG.warning('Đã khôi phục database từ bản sao lưu (%d byte).', db_path.stat().st_size)
        return 'restored'
    except Exception as error:
        LOG.error('Không khôi phục được từ kho sao lưu: %s', error)
        return 'error'


def backup_now(db_path, store=None):
    """Upload a consistent snapshot; returns True when uploaded."""
    db_path = Path(db_path)
    store = store or configured_store()
    if store is None or not db_path.exists():
        return False
    with tempfile.TemporaryDirectory(dir=db_path.parent) as folder:
        snapshot, packed = Path(folder, 'snapshot.db'), Path(folder, 'snapshot.db.gz')
        source = sqlite3.connect(db_path)
        target = sqlite3.connect(snapshot)
        try:
            source.backup(target)  # consistent even while the app is writing
        finally:
            target.close()
            source.close()
        with open(snapshot, 'rb') as raw, gzip.open(packed, 'wb', compresslevel=6) as out:
            shutil.copyfileobj(raw, out)
        store.save(packed.read_bytes())
    return True


class BackupLoop:
    """Uploads after changes (checked by file size/mtime) and once more at shutdown."""

    def __init__(self, db_path, interval=None, store=None):
        self.db_path, self.store = Path(db_path), store
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None
        self.last_seen = None

    def _signature(self):
        try:
            stat = self.db_path.stat()
            return stat.st_mtime_ns, stat.st_size
        except OSError:
            return None

    def _tick(self, force=False):
        signature = self._signature()
        if signature is None or (not force and signature == self.last_seen):
            return
        try:
            if backup_now(self.db_path, self.store):
                first = self.last_seen is None
                self.last_seen = signature
                log = LOG.warning if first else LOG.info  # warnings reach Render's log by default
                log('Đã sao lưu database lên kho lưu trữ (%d byte).', signature[1])
        except Exception as error:
            LOG.error('Sao lưu database thất bại: %s', error)

    def _run(self):
        self.stop_event.wait(5)  # first upload soon after startup, then on the regular interval
        while not self.stop_event.is_set():
            self._tick()
            self.stop_event.wait(self.interval)

    def start(self):
        self.store = self.store or configured_store()
        if self.store is None:
            return False
        self.interval = self.interval or self.store.interval
        LOG.warning('Sao lưu database đã bật (%s): tải lên mỗi %d giây khi có thay đổi.', self.store.name, self.interval)
        self.thread = threading.Thread(target=self._run, name='db-backup', daemon=True)
        self.thread.start()
        return True

    def stop(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=5)
            self._tick(force=True)


def selftest():
    """Round-trip a tiny database through the configured store: python db_backup.py --selftest"""
    store = configured_store()
    if store is None:
        print('Chưa đặt biến BACKUP_NEON_URL (Neon) hoặc BACKUP_D1_* (D1).')
        return 1
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder, 'probe.db')
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE t(v TEXT)')
        conn.execute("INSERT INTO t VALUES('ok')")
        conn.commit()
        conn.close()
        previous = store.fetch()
        backup_now(path, store)
        restored = Path(folder, 'restored.db')
        data = gzip.decompress(store.fetch())
        restored.write_bytes(data)
        value = sqlite3.connect(restored).execute('SELECT v FROM t').fetchone()
        if previous is not None:
            store.save(previous)  # put the real backup back
    print(f'{store.name}: ghi và đọc lại {"THÀNH CÔNG" if value == ("ok",) else "THẤT BẠI"}')
    return 0 if value == ('ok',) else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else 0)
