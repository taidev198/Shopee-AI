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
    s3 = (FakeS3(), 'bucket')
    source = tmp_path / 'a' / 'market.db'
    source.parent.mkdir()
    make_db(source, 'shop-data')
    assert db_backup.backup_now(source, s3) is True
    fresh = tmp_path / 'b' / 'market.db'
    fresh.parent.mkdir()
    assert db_backup.restore_if_missing(fresh, s3) == 'restored'
    assert read(fresh) == ['shop-data']


def test_existing_database_is_never_overwritten_by_restore(tmp_path):
    s3 = (FakeS3(), 'bucket')
    path = tmp_path / 'market.db'
    make_db(path, 'local')
    assert db_backup.restore_if_missing(path, s3) == 'present'
    assert read(path) == ['local']


def test_first_run_with_no_backup_starts_empty_and_second_upload_keeps_previous(tmp_path):
    fake = FakeS3()
    path = tmp_path / 'market.db'
    assert db_backup.restore_if_missing(path, (fake, 'bucket')) == 'empty'
    make_db(path, 'one')
    db_backup.backup_now(path, (fake, 'bucket'))
    make_db(path, 'two')
    db_backup.backup_now(path, (fake, 'bucket'))
    assert db_backup.PREVIOUS_KEY in fake.objects and fake.objects[db_backup.PREVIOUS_KEY] != fake.objects[db_backup.OBJECT_KEY]


def test_access_error_is_reported_not_treated_as_empty(tmp_path):
    fake = FakeS3()
    fake.fail = ClientError({'Error': {'Code': 'AccessDenied'}}, 'GetObject')
    assert db_backup.restore_if_missing(tmp_path / 'market.db', (fake, 'bucket')) == 'error'


def test_not_configured_is_a_noop(tmp_path, monkeypatch):
    for name in ('BACKUP_BUCKET', 'BACKUP_ENDPOINT', 'BACKUP_ACCESS_KEY_ID', 'BACKUP_SECRET_ACCESS_KEY'):
        monkeypatch.delenv(name, raising=False)
    assert db_backup.restore_if_missing(tmp_path / 'market.db') == 'disabled'
    assert db_backup.backup_now(tmp_path / 'market.db') is False
    assert db_backup.BackupLoop(tmp_path / 'market.db').start() is False


def test_loop_uploads_only_when_the_file_changed(tmp_path):
    fake = (FakeS3(), 'bucket')
    path = tmp_path / 'market.db'
    make_db(path)
    loop = db_backup.BackupLoop(path, client=fake)
    loop._tick()
    first = fake[0].objects[db_backup.OBJECT_KEY]
    fake[0].objects[db_backup.OBJECT_KEY] = b'marker'
    loop._tick()
    assert fake[0].objects[db_backup.OBJECT_KEY] == b'marker'
    make_db(path, 'more')
    loop._tick()
    assert fake[0].objects[db_backup.OBJECT_KEY] != b'marker' and first
