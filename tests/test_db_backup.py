"""SQLite mirror to remote storage, exercised against in-memory fakes."""
import hashlib
import sqlite3

import pytest

import db_backup


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConn:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        if sql.startswith('CREATE'):
            return FakeCursor([])
        if sql.startswith('INSERT'):
            self.db.rows.append((params[2], params[0], params[1]))
            return FakeCursor([])
        if sql.startswith('DELETE'):
            self.db.rows = self.db.rows[-2:]
            return FakeCursor([])
        if sql.startswith('SELECT'):
            return FakeCursor([self.db.rows[-1]] if self.db.rows else [])
        raise AssertionError(sql)


class FakeNeon:
    """Stands in for psycopg.connect: rows are (data, bytes, sha256), newest last."""
    def __init__(self):
        self.rows = []
        self.fail = None

    def connect(self):
        if self.fail:
            raise self.fail
        return FakeConn(self)


def neon(fake):
    return db_backup.NeonStore('postgresql://unused', connect=fake.connect)


@pytest.fixture(autouse=True)
def no_retry_sleep(monkeypatch):
    monkeypatch.setattr(db_backup.time, 'sleep', lambda seconds: None)


def make_db(path, value='a'):
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE IF NOT EXISTS t(v TEXT)')
    conn.execute('INSERT INTO t VALUES(?)', (value,))
    conn.commit()
    conn.close()


def read(path):
    conn = sqlite3.connect(path)
    try:
        return [row[0] for row in conn.execute('SELECT v FROM t ORDER BY rowid')]
    finally:
        conn.close()


def test_backup_then_restore_on_empty_disk_round_trips_data(tmp_path):
    store = neon(FakeNeon())
    source = tmp_path / 'a' / 'market.db'
    source.parent.mkdir()
    make_db(source, 'shop-data')
    assert db_backup.backup_now(source, store) is True
    fresh = tmp_path / 'b' / 'market.db'
    fresh.parent.mkdir()
    assert db_backup.restore_if_missing(fresh, store) == 'restored'
    assert read(fresh) == ['shop-data']


def test_existing_database_is_never_overwritten_by_restore(tmp_path):
    path = tmp_path / 'market.db'
    make_db(path, 'local')
    assert db_backup.restore_if_missing(path, neon(FakeNeon())) == 'present'
    assert read(path) == ['local']


def test_first_run_starts_empty_and_only_the_two_newest_snapshots_are_kept(tmp_path):
    fake = FakeNeon()
    path = tmp_path / 'market.db'
    assert db_backup.restore_if_missing(path, neon(fake)) == 'empty'
    for value in ('one', 'two', 'three'):
        make_db(path, value)
        db_backup.backup_now(path, neon(fake))
    assert len(fake.rows) == 2


def test_corrupted_snapshot_is_rejected_not_restored(tmp_path):
    fake = FakeNeon()
    path = tmp_path / 'market.db'
    make_db(path)
    db_backup.backup_now(path, neon(fake))
    data, size, _ = fake.rows[-1]
    fake.rows[-1] = (data[:-3] + b'xyz', size, hashlib.sha256(b'other').hexdigest())
    assert db_backup.restore_if_missing(tmp_path / 'restored.db', neon(fake)) == 'error'


def test_connection_error_is_reported_not_treated_as_empty(tmp_path):
    fake = FakeNeon()
    fake.fail = RuntimeError('password authentication failed')
    assert db_backup.restore_if_missing(tmp_path / 'market.db', neon(fake)) == 'error'


def test_not_configured_is_a_noop(tmp_path, monkeypatch):
    for name in ('DATABASE_URL', 'BACKUP_NEON_URL', 'BACKUP_D1_ACCOUNT_ID', 'BACKUP_D1_DATABASE_ID', 'BACKUP_D1_API_TOKEN'):
        monkeypatch.delenv(name, raising=False)
    assert db_backup.restore_if_missing(tmp_path / 'market.db') == 'disabled'
    assert db_backup.backup_now(tmp_path / 'market.db') is False
    assert db_backup.BackupLoop(tmp_path / 'market.db').start() is False


def test_loop_uploads_only_when_the_file_changed(tmp_path):
    fake = FakeNeon()
    path = tmp_path / 'market.db'
    make_db(path)
    loop = db_backup.BackupLoop(path, store=neon(fake))
    loop._tick()
    assert len(fake.rows) == 1
    loop._tick()
    assert len(fake.rows) == 1
    make_db(path, 'more')
    loop._tick()
    assert len(fake.rows) == 2


def test_neon_store_is_selected_from_environment_and_wins_over_d1(monkeypatch):
    monkeypatch.setenv('BACKUP_D1_ACCOUNT_ID', 'acct')
    monkeypatch.setenv('BACKUP_D1_DATABASE_ID', 'db')
    monkeypatch.setenv('BACKUP_D1_API_TOKEN', 'token')
    monkeypatch.delenv('BACKUP_NEON_URL', raising=False)
    monkeypatch.setenv('DATABASE_URL', ' postgresql://user:pw@host/db?sslmode=require\n')
    store = db_backup.configured_store()
    assert store.name == 'neon' and store.dsn == 'postgresql://user:pw@host/db?sslmode=require'
    assert store.interval >= 300


def test_database_url_that_is_not_postgres_is_ignored_and_the_old_name_still_works(monkeypatch):
    for name in ('BACKUP_D1_ACCOUNT_ID', 'BACKUP_D1_DATABASE_ID', 'BACKUP_D1_API_TOKEN', 'BACKUP_NEON_URL'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('DATABASE_URL', 'sqlite:///other.db')
    assert db_backup.configured_store() is None
    monkeypatch.setenv('BACKUP_NEON_URL', 'postgres://user:pw@host/db')
    assert db_backup.configured_store().name == 'neon'


class FakeD1:
    """Answers Cloudflare's /query endpoint with a real SQLite engine (D1 is SQLite)."""

    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.requests = []
        self.fail_after = None

    def __call__(self, request, timeout=0):
        import io, json
        body = json.loads(request.data)
        assert request.headers['Authorization'] == 'Bearer token'
        self.requests.append(body)
        if self.fail_after is not None and len(self.requests) > self.fail_after:
            raise RuntimeError('network down')
        rows = [dict(row) for row in self.db.execute(body['sql'], body['params'])]
        self.db.commit()
        payload = json.dumps({'success': True, 'errors': [], 'result': [{'results': rows, 'success': True}]})

        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        return Response(payload.encode())


def test_d1_store_round_trips_a_multi_part_database(tmp_path):
    d1 = FakeD1()
    store = db_backup.D1Store('acct', 'db', 'token', chunk_bytes=64, opener=d1)
    source = tmp_path / 'a.db'
    make_db(source, 'x' * 5000)
    assert db_backup.backup_now(source, store) is True
    parts = d1.db.execute('SELECT COUNT(*) FROM backup_parts').fetchone()[0]
    assert parts > 1
    fresh = tmp_path / 'b' / 'market.db'
    fresh.parent.mkdir()
    assert db_backup.restore_if_missing(fresh, store) == 'restored'
    assert read(fresh) == ['x' * 5000]


def test_d1_keeps_only_two_generations_and_a_failed_upload_leaves_the_last_good_one(tmp_path):
    d1 = FakeD1()
    store = db_backup.D1Store('acct', 'db', 'token', chunk_bytes=64, opener=d1)
    path = tmp_path / 'a.db'
    make_db(path, 'one'); db_backup.backup_now(path, store)
    make_db(path, 'two'); db_backup.backup_now(path, store)
    make_db(path, 'three'); db_backup.backup_now(path, store)
    assert d1.db.execute('SELECT COUNT(DISTINCT generation) FROM backup_parts').fetchone()[0] == 2
    good = db_backup.D1Store('acct', 'db', 'token', opener=d1).fetch()
    d1.fail_after = len(d1.requests) + 2  # dies mid-upload, before the meta row flips
    make_db(path, 'four')
    with pytest.raises(RuntimeError):
        db_backup.backup_now(path, store)
    d1.fail_after = None
    assert db_backup.D1Store('acct', 'db', 'token', opener=d1).fetch() == good


def test_d1_store_is_selected_from_environment(monkeypatch):
    for name in ('BACKUP_BUCKET', 'BACKUP_ENDPOINT', 'BACKUP_ACCESS_KEY_ID', 'BACKUP_SECRET_ACCESS_KEY'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('BACKUP_D1_ACCOUNT_ID', ' acct\n')
    monkeypatch.setenv('BACKUP_D1_DATABASE_ID', 'db')
    monkeypatch.setenv('BACKUP_D1_API_TOKEN', 'token')
    store = db_backup.configured_store()
    assert store.name == 'd1' and '/accounts/acct/d1/database/db/query' in store.url
