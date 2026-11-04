"""Copy an existing SQLite market.db into the PostgreSQL database named by DATABASE_URL.

    DATABASE_URL='postgresql://…' python migrate_sqlite_to_postgres.py market.db

Importing app creates the PostgreSQL tables; rows are then copied table by table (parents first).
Existing rows with the same key are left untouched, so the script can be re-run.
"""
import sqlite3
import sys


def main(path):
    import app
    if not app.PG_URL:
        sys.exit('Hãy đặt DATABASE_URL trỏ tới PostgreSQL (Neon) trước khi chạy.')
    source = sqlite3.connect(path)
    source.row_factory = sqlite3.Row
    tables = [r[0] for r in source.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    with app.db() as target:
        have = {r['table_name'] for r in target.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()")}
        pending = [t for t in tables if t in have]
        for _ in range(len(pending) + 1):  # retry so foreign-key parents load before children
            failed = []
            for table in pending:
                rows = source.execute(f'SELECT * FROM "{table}"').fetchall()
                if not rows:
                    continue
                columns = rows[0].keys()
                marks = ','.join('?' * len(columns))
                sql = f'INSERT OR IGNORE INTO {table}({",".join(columns)}) VALUES({marks})'
                try:
                    target.execute('SAVEPOINT t')
                    target.executemany(sql, [tuple(r) for r in rows])
                    target.execute('RELEASE SAVEPOINT t')
                    print(f'{table}: {len(rows)} dòng')
                except Exception as error:  # noqa: BLE001 - report and retry after parents load
                    target.execute('ROLLBACK TO SAVEPOINT t')
                    failed.append(table)
                    last = error
            if not failed:
                break
            pending = failed
        else:
            sys.exit(f'Không chuyển được: {failed} ({last})')
        serials = target.execute(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema=current_schema() AND column_default LIKE 'nextval%'").fetchall()
        for table, column in serials:  # keep BIGSERIAL counters ahead of the copied ids
            sequence = target.execute("SELECT pg_get_serial_sequence('%s','%s')" % (table, column)).fetchone()[0]
            target.execute("SELECT setval('%s', COALESCE((SELECT MAX(%s) FROM %s),1))" % (sequence, column, table))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'market.db')
