"""Keep the SQLite database across container restarts by mirroring it to S3-compatible storage.

Enabled only when BACKUP_BUCKET, BACKUP_ENDPOINT, BACKUP_ACCESS_KEY_ID and
BACKUP_SECRET_ACCESS_KEY are set (Cloudflare R2, Backblaze B2, ...). Without them
the app behaves as before. Restore runs before the schema is created, so a fresh
container starts from the last upload instead of an empty file.
"""
import gzip
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
from pathlib import Path

LOG = logging.getLogger('marketlens.backup')
OBJECT_KEY = 'market.db.gz'
PREVIOUS_KEY = 'market.db.prev.gz'
INTERVAL_SECONDS = 60


def _clean(name):
    return ''.join(os.environ.get(name, '').split())


def _client():
    """Return (client, bucket) or None when backup is not configured."""
    bucket, endpoint = _clean('BACKUP_BUCKET'), _clean('BACKUP_ENDPOINT')
    key, secret = _clean('BACKUP_ACCESS_KEY_ID'), _clean('BACKUP_SECRET_ACCESS_KEY')
    if not (bucket and endpoint and key and secret):
        return None
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=endpoint, aws_access_key_id=key, aws_secret_access_key=secret,
                          region_name='auto', config=Config(retries={'max_attempts': 3}, signature_version='s3v4'))
    return client, bucket


def _is_missing(error):
    code = getattr(error, 'response', {}).get('Error', {}).get('Code', '')
    return code in ('NoSuchKey', '404', 'NotFound')


def restore_if_missing(db_path, client=None):
    """Download the last upload when the local database file does not exist."""
    db_path = Path(db_path)
    if db_path.exists() and db_path.stat().st_size > 0:
        return 'present'
    configured = client or _client()
    if configured is None:
        LOG.warning('Sao lưu chưa cấu hình (BACKUP_*): dữ liệu sẽ mất khi container khởi động lại.')
        return 'disabled'
    s3, bucket = configured if isinstance(configured, tuple) else (configured, _clean('BACKUP_BUCKET'))
    try:
        with tempfile.NamedTemporaryFile(dir=db_path.parent, delete=False) as raw:
            s3.download_fileobj(bucket, OBJECT_KEY, raw)
        with gzip.open(raw.name, 'rb') as source, open(db_path, 'wb') as target:
            shutil.copyfileobj(source, target)
        os.unlink(raw.name)
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
        for leftover in (locals().get('raw'),):
            if leftover is not None and os.path.exists(leftover.name):
                os.unlink(leftover.name)
        if _is_missing(error):
            LOG.warning('Chưa có bản sao lưu trên kho lưu trữ; bắt đầu với database trống.')
            return 'empty'
        LOG.error('Không khôi phục được từ kho sao lưu: %s', error)
        return 'error'


def backup_now(db_path, client=None):
    """Upload a consistent snapshot; returns True when uploaded."""
    db_path = Path(db_path)
    configured = client or _client()
    if configured is None or not db_path.exists():
        return False
    s3, bucket = configured if isinstance(configured, tuple) else (configured, _clean('BACKUP_BUCKET'))
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
        try:
            s3.copy_object(Bucket=bucket, Key=PREVIOUS_KEY, CopySource={'Bucket': bucket, 'Key': OBJECT_KEY})
        except Exception as error:
            if not _is_missing(error):
                LOG.debug('Không giữ được bản trước: %s', error)
        with open(packed, 'rb') as stream:
            s3.upload_fileobj(stream, bucket, OBJECT_KEY)
    return True


class BackupLoop:
    """Uploads after changes (checked by file size/mtime) and once more at shutdown."""

    def __init__(self, db_path, interval=INTERVAL_SECONDS, client=None):
        self.db_path, self.interval, self.client = Path(db_path), interval, client
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
            if backup_now(self.db_path, self.client):
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
        if (self.client or _client()) is None:
            return False
        LOG.warning('Sao lưu database đã bật: tải lên kho lưu trữ mỗi %d giây khi có thay đổi.', self.interval)
        self.thread = threading.Thread(target=self._run, name='db-backup', daemon=True)
        self.thread.start()
        return True

    def stop(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=5)
            self._tick(force=True)
