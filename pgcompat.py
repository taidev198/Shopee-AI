"""PostgreSQL (Neon) backend exposing the small slice of the sqlite3 API the app uses.

The application was written against sqlite3: ``with db() as c: c.execute('... ?', params)``,
rows readable by name or index, ``executescript`` for schema, ``PRAGMA table_info`` for
migrations.  ``connect_factory`` returns a ``db()`` callable with the same contract, backed by
PostgreSQL, so the modules need no per-query changes.  SQL is translated on the fly (cached):

* ``?`` placeholders -> ``%s``;  INTEGER -> BIGINT, REAL -> DOUBLE PRECISION,
  ``INTEGER PRIMARY KEY AUTOINCREMENT`` -> BIGSERIAL
* ``INSERT OR IGNORE`` -> ``ON CONFLICT DO NOTHING``;  ``rowid`` -> ``ctid``;  ``LIKE`` -> ``ILIKE``
* ``PRAGMA table_info`` -> information_schema;  other PRAGMAs are ignored
* ``BEGIN IMMEDIATE`` -> a transaction-scoped advisory lock (serialises writers like SQLite did)
"""
import hashlib
import os
import re
import threading

import psycopg
from psycopg.adapt import Loader

ADVISORY_KEY = 727_001
Error = psycopg.Error


class Row(tuple):
    """tuple that also answers row['name'] / keys(), like sqlite3.Row."""
    __slots__ = ()
    _names = ()

    def __getitem__(self, key):
        if isinstance(key, str):
            try:
                return tuple.__getitem__(self, self._names.index(key))
            except ValueError:
                raise IndexError('No item with that key') from None
        return tuple.__getitem__(self, key)

    def keys(self):
        return list(self._names)


def _row_factory(cursor):
    names = tuple(column.name for column in cursor.description or ())
    cls = type('Row', (Row,), {'__slots__': (), '_names': names})
    return lambda values: cls(values)


class _NumericLoader(Loader):
    """numeric (SUM/AVG of integers) -> int/float, like SQLite, never Decimal."""
    def load(self, data):
        text = bytes(data).decode()
        number = float(text)
        return int(number) if '.' not in text and number.is_integer() else number


_STRING = re.compile(r"'(?:[^']|'')*'")
_RULES = [
    (re.compile(r'\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b', re.I), 'BIGSERIAL PRIMARY KEY'),
    (re.compile(r'\bINTEGER\b', re.I), 'BIGINT'),
    (re.compile(r'\bREAL\b', re.I), 'DOUBLE PRECISION'),
    (re.compile(r'\bBLOB\b', re.I), 'BYTEA'),
    (re.compile(r'\browid\b', re.I), 'ctid'),
    (re.compile(r'\bLIKE\b', re.I), 'ILIKE'),
    (re.compile(r'\bIFNULL\s*\(', re.I), 'COALESCE('),
]
_cache = {}


def _code(sql, fn):
    """Apply fn to the parts of sql outside string literals."""
    out, last = [], 0
    for match in _STRING.finditer(sql):
        out.append(fn(sql[last:match.start()]))
        out.append(match.group(0).replace('%', '%%'))
        last = match.end()
    out.append(fn(sql[last:]))
    return ''.join(out)


def translate(sql):
    """Return (pg_sql, special) where special is None, 'noop', 'lock' or ('columns', table)."""
    cached = _cache.get(sql)
    if cached is not None:
        return cached
    text = sql.strip().rstrip(';')
    head = text.upper().split(None, 2)
    special = None
    if head[:1] == ['PRAGMA']:
        match = re.fullmatch(r'PRAGMA\s+table_info\(\s*"?(\w+)"?\s*\)', text, re.I)
        special = ('columns', match.group(1)) if match else 'noop'
        result = ('', special)
        _cache[sql] = result
        return result
    if head[:1] == ['BEGIN']:
        result = ('SELECT pg_advisory_xact_lock(%d)' % ADVISORY_KEY, 'lock')
        _cache[sql] = result
        return result
    ignore = bool(re.match(r'INSERT\s+OR\s+IGNORE\s+INTO\b', text, re.I))
    if ignore:
        text = re.sub(r'^INSERT\s+OR\s+IGNORE\s+INTO\b', 'INSERT INTO', text, flags=re.I)

    # Tables whose insertion order matters get a real BIGSERIAL "rowid" (ctid moves on UPDATE).
    ordered = bool(re.search(r'\bmarket_queue\b', text))
    if re.match(r'CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?market_queue\s*\(', text, re.I):
        text = re.sub(r'\(', '(rowid BIGSERIAL,', text, count=1)

    def rewrite(part):
        part = part.replace('?', '%s')
        for pattern, replacement in _RULES:
            if ordered and replacement == 'ctid':
                continue
            part = pattern.sub(replacement, part)
        return part

    # '%' outside literals must be escaped too, but '?' is converted first.
    def code(part):
        return rewrite(part.replace('%', '%%'))

    out = _code(text, code)
    if ignore:
        out += ' ON CONFLICT DO NOTHING'
    _cache[sql] = (out, None)
    return _cache[sql]


def _split_script(script):
    statements, current, last = [], [], 0
    pieces = []
    for match in _STRING.finditer(script):
        pieces.append((script[last:match.start()], False))
        pieces.append((match.group(0), True))
        last = match.end()
    pieces.append((script[last:], False))
    buffer = ''
    for text, is_string in pieces:
        if is_string:
            buffer += text
            continue
        parts = text.split(';')
        for part in parts[:-1]:
            buffer += part
            if buffer.strip():
                statements.append(buffer.strip())
            buffer = ''
        buffer += parts[-1]
    if buffer.strip():
        statements.append(buffer.strip())
    return statements


def _clean(params):
    if params is None:
        return ()
    return tuple(int(v) if isinstance(v, bool) else v for v in params)


class Cursor:
    def __init__(self, cursor, rows=None):
        self._cursor, self._rows = cursor, rows

    @property
    def rowcount(self):
        return len(self._rows) if self._rows is not None else self._cursor.rowcount

    def fetchone(self):
        if self._rows is not None:
            return self._rows.pop(0) if self._rows else None
        if self._cursor.description is None:
            return None
        return self._cursor.fetchone()

    def fetchall(self):
        if self._rows is not None:
            rows, self._rows = self._rows, []
            return rows
        if self._cursor.description is None:
            return []
        return self._cursor.fetchall()

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    def __init__(self, raw, release):
        self._raw, self._release = raw, release

    def execute(self, sql, params=()):
        converted, special = translate(sql)
        if special == 'lock':
            return Cursor(self._raw.execute(converted), [])
        if special == 'noop':
            return Cursor(None, [])
        if isinstance(special, tuple):
            cursor = self._raw.execute(
                'SELECT column_name AS name FROM information_schema.columns '
                'WHERE table_schema=current_schema() AND table_name=%s ORDER BY ordinal_position',
                (special[1],))
            return Cursor(cursor)
        return Cursor(self._raw.execute(converted, _clean(params)))

    def executemany(self, sql, seq):
        converted, _ = translate(sql)
        with self._raw.cursor() as cursor:
            cursor.executemany(converted, [_clean(p) for p in seq])
            return Cursor(cursor, [])

    def executescript(self, script):
        for statement in _split_script(script):
            self.execute(statement)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        release, self._release = self._release, None
        if release:
            try:
                self._raw.rollback()
            except psycopg.Error:
                pass
            release(self._raw)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self._raw.commit()
            else:
                self._raw.rollback()
        finally:
            self.close()
        return False

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def schema_for(path):
    """Isolated schema per database path (used by the test-suite)."""
    return 'ml_' + hashlib.sha1(str(path).encode()).hexdigest()[:16]


def is_postgres_url(value):
    return bool(value) and value.strip().startswith(('postgres://', 'postgresql://'))


def connect_factory(url, schema=None, pooled=True):
    """Return a ``db()`` callable. ``schema`` None -> server default search_path."""
    url = ''.join(url.split())
    kwargs = {'prepare_threshold': None, 'row_factory': _row_factory, 'autocommit': False}
    lock = threading.Lock()
    state = {'pool': None, 'ready': False}

    def configure(conn):
        conn.adapters.register_loader('numeric', _NumericLoader)
        if schema:
            conn.execute('SET search_path TO "%s"' % schema)
        conn.commit()

    def ensure_schema():
        if schema and not state['ready']:
            with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
                conn.execute('CREATE SCHEMA IF NOT EXISTS "%s"' % schema)
            state['ready'] = True

    def get_pool():
        from psycopg_pool import ConnectionPool
        with lock:
            if state['pool'] is None:
                ensure_schema()
                state['pool'] = ConnectionPool(
                    url, min_size=1, max_size=int(os.environ.get('PG_POOL_MAX', '10')), kwargs=kwargs,
                    configure=configure, check=ConnectionPool.check_connection,
                    max_lifetime=1800, max_idle=240, open=True, timeout=30)
            return state['pool']

    def db():
        if pooled:
            pool = get_pool()
            return Connection(pool.getconn(), pool.putconn)
        with lock:
            ensure_schema()
        raw = psycopg.connect(url, **kwargs)
        configure(raw)
        return Connection(raw, lambda conn: conn.close())

    db.schema = schema
    return db
