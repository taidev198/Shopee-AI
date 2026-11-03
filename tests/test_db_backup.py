"""SQLite mirror to S3-compatible storage, exercised against an in-memory fake client."""
import sqlite3

import pytest
from botocore.exceptions import ClientError

import db_backup


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.fail = None

    def download_fileobj(self, bucket, key, stream):
        if self.fail:
            raise self.fail
        if key not in self.objects:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'GetObject')
        stream.write(self.objects[key])

    def upload_fileobj(self, stream, bucket, key):
        self.objects[key] = stream.read()

    def copy_object(self, Bucket, Key, CopySource):
        if CopySource['Key'] not in self.objects:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'CopyObject')
        self.objects[Key] = self.objects[CopySource['Key']]


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
    s3 = db_backup.S3Store(FakeS3(), 'bucket')
    source = tmp_path / 'a' / 'market.db'
    source.parent.mkdir()
    make_db(source, 'shop-data')
    assert db_backup.backup_now(source, s3) is True
    fresh = tmp_path / 'b' / 'market.db'
    fresh.parent.mkdir()
    assert db_backup.restore_if_missing(fresh, s3) == 'restored'
    assert read(fresh) == ['shop-data']


def test_existing_database_is_never_overwritten_by_restore(tmp_path):
    s3 = db_backup.S3Store(FakeS3(), 'bucket')
    path = tmp_path / 'market.db'
    make_db(path, 'local')
    assert db_backup.restore_if_missing(path, s3) == 'present'
    assert read(path) == ['local']


def test_first_run_with_no_backup_starts_empty_and_second_upload_keeps_previous(tmp_path):
    fake = FakeS3()
    path = tmp_path / 'market.db'
    assert db_backup.restore_if_missing(path, db_backup.S3Store(fake, 'bucket')) == 'empty'
    make_db(path, 'one')
    db_backup.backup_now(path, db_backup.S3Store(fake, 'bucket'))
    make_db(path, 'two')
    db_backup.backup_now(path, db_backup.S3Store(fake, 'bucket'))
    assert db_backup.PREVIOUS_KEY in fake.objects and fake.objects[db_backup.PREVIOUS_KEY] != fake.objects[db_backup.OBJECT_KEY]


def test_access_error_is_reported_not_treated_as_empty(tmp_path):
    fake = FakeS3()
    fake.fail = ClientError({'Error': {'Code': 'AccessDenied'}}, 'GetObject')
    assert db_backup.restore_if_missing(tmp_path / 'market.db', db_backup.S3Store(fake, 'bucket')) == 'error'


def test_not_configured_is_a_noop(tmp_path, monkeypatch):
    for name in ('BACKUP_BUCKET', 'BACKUP_ENDPOINT', 'BACKUP_ACCESS_KEY_ID', 'BACKUP_SECRET_ACCESS_KEY',
                 'BACKUP_D1_ACCOUNT_ID', 'BACKUP_D1_DATABASE_ID', 'BACKUP_D1_API_TOKEN'):
        monkeypatch.delenv(name, raising=False)
    assert db_backup.restore_if_missing(tmp_path / 'market.db') == 'disabled'
    assert db_backup.backup_now(tmp_path / 'market.db') is False
    assert db_backup.BackupLoop(tmp_path / 'market.db').start() is False


def test_loop_uploads_only_when_the_file_changed(tmp_path):
    fake = db_backup.S3Store(FakeS3(), 'bucket')
    path = tmp_path / 'market.db'
    make_db(path)
    loop = db_backup.BackupLoop(path, store=fake)
    loop._tick()
    first = fake.client.objects[db_backup.OBJECT_KEY]
    fake.client.objects[db_backup.OBJECT_KEY] = b'marker'
    loop._tick()
    assert fake.client.objects[db_backup.OBJECT_KEY] == b'marker'
    make_db(path, 'more')
    loop._tick()
    assert fake.client.objects[db_backup.OBJECT_KEY] != b'marker' and first


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
