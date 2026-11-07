"""Persistent category collection and point-in-time features for market research."""
import csv
import io
import json
import math
import re
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, urlunparse
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from competitor_analysis import _display_number, price_range


def category_url(value):
    try:
        u = urlparse(value.strip())
        if (u.scheme != 'https' or u.hostname not in ('shopee.vn', 'www.shopee.vn') or
                u.username or u.password or u.port or not re.fullmatch(r'/[^/]+-cat\.\d+(?:\.\d+)*', u.path)):
            raise ValueError()
        return urlunparse(('https', 'shopee.vn', u.path, '', '', ''))
    except ValueError:
        raise ValueError('Cần link ngành hàng Shopee VN có dạng …-cat.12345.')


class Category(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(max_length=2048)
    _url = field_validator('url')(category_url)


class Campaign(BaseModel):
    shop_id: str = Field(default='', max_length=64)  # own shop whose product library receives the full product data
    full_scan: bool = False
    categories: list[Category] = Field(min_length=1, max_length=100)
    max_pages: int = Field(default=5, ge=1, le=100)
    max_products: int = Field(default=150, ge=1, le=1000)


class Schedule(Campaign):
    start_at: datetime
    interval_hours: int = Field(default=24, ge=1, le=720)

    @field_validator('start_at')
    @classmethod
    def local_time(cls, value):
        if value.tzinfo is None:
            raise ValueError('Thời gian bắt đầu phải có múi giờ.')
        return value.astimezone(ZoneInfo('Asia/Ho_Chi_Minh'))


class ScheduleState(BaseModel):
    enabled: bool


class Listing(BaseModel):
    page: int = Field(ge=0, le=1000000)
    urls: list[str] = Field(max_length=100)
    has_next: bool


class Failure(BaseModel):
    error: str = Field(min_length=1, max_length=500)


class SkipRequest(Failure):
    url: str | None = Field(default=None, min_length=1, max_length=2048)


def now():
    return datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).isoformat()


def features(rows):
    """One feature row per product/day; never read future rows when deriving features."""
    histories = {}
    output = []
    for row in sorted(rows, key=lambda r: (r['sku'], r['day'])):
        item = dict(row)
        history = histories.setdefault(item['sku'], [])
        item.update(velocity=None, acceleration=None, trend_score=None, reason='Cần ít nhất 3 ngày quan sát', schema_version=1)
        if history:
            prev = history[-1]
            days = (datetime.fromisoformat(item['day']) - datetime.fromisoformat(prev['day'])).days
            if (days > 0 and item['sold_total'] is not None and prev['sold_total'] is not None
                    and not item['sold_approx'] and not prev['sold_approx']):
                delta = item['sold_total'] - prev['sold_total']
                if delta >= 0:
                    item['velocity'] = delta / days
                    item['reason'] = 'Cần thêm một khoảng thời gian để tính gia tốc'
                    if prev['velocity'] is not None:
                        item['acceleration'] = item['velocity'] - prev['velocity']
                        item['trend_score'] = round(min(100, 15 * math.log1p(item['velocity']) +
                            15 * max(0, math.log((item['velocity'] + 1) / (prev['velocity'] + 1)))), 1)
                        item['reason'] = 'Điểm quy tắc từ tốc độ và gia tốc bán; chưa phải dự báo ML'
                else:
                    item['reason'] = 'Bộ đếm bán giảm/reset; không suy diễn tăng trưởng'
            else:
                item['reason'] = 'Thiếu số bán chính xác hoặc số bán đã làm tròn'
        history.append(item)
        output.append(item)
    return output


def install(app, db, Detail, identity):
    router = APIRouter(prefix='/api/category-market')
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS market_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT UNIQUE NOT NULL);
        CREATE TABLE IF NOT EXISTS market_runs(id TEXT PRIMARY KEY,category_id TEXT NOT NULL REFERENCES market_categories(id),
          created_at TEXT NOT NULL,max_pages INTEGER NOT NULL,max_products INTEGER NOT NULL,page INTEGER DEFAULT 0,
          listing_done INTEGER DEFAULT 0,status TEXT DEFAULT 'pending',error TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS market_queue(run_id TEXT NOT NULL REFERENCES market_runs(id),sku TEXT NOT NULL,url TEXT NOT NULL,
          status TEXT DEFAULT 'pending',error TEXT DEFAULT '',PRIMARY KEY(run_id,sku));
        CREATE TABLE IF NOT EXISTS market_snapshots(sku TEXT NOT NULL,day TEXT NOT NULL,category_id TEXT NOT NULL REFERENCES market_categories(id),
          name TEXT NOT NULL,url TEXT NOT NULL,collected_at TEXT NOT NULL,price REAL,sold_total REAL,sold_approx INTEGER NOT NULL,
          rating REAL,review_count REAL,raw_json TEXT NOT NULL,PRIMARY KEY(sku,day,category_id));
        CREATE TABLE IF NOT EXISTS market_schedules(
          id TEXT PRIMARY KEY,category_id TEXT NOT NULL UNIQUE REFERENCES market_categories(id),
          interval_hours INTEGER NOT NULL,next_run_at TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
          max_pages INTEGER NOT NULL,max_products INTEGER NOT NULL,full_scan INTEGER NOT NULL DEFAULT 0,
          last_run_at TEXT NOT NULL DEFAULT '');
        CREATE INDEX IF NOT EXISTS idx_market_pending ON market_queue(run_id,status);
        CREATE INDEX IF NOT EXISTS idx_market_history ON market_snapshots(category_id,day);
        ''')
        columns = {r['name'] for r in c.execute('PRAGMA table_info(market_runs)')}
        for name, kind in [('full_scan', 'INTEGER NOT NULL DEFAULT 0'), ('schedule_id', "TEXT NOT NULL DEFAULT ''"),
                           ('superseded', 'INTEGER NOT NULL DEFAULT 0'), ('shop_id', "TEXT NOT NULL DEFAULT ''")]:
            if name not in columns:
                c.execute(f'ALTER TABLE market_runs ADD COLUMN {name} {kind}')
        if 'shop_id' not in {r['name'] for r in c.execute('PRAGMA table_info(market_schedules)')}:
            c.execute("ALTER TABLE market_schedules ADD COLUMN shop_id TEXT NOT NULL DEFAULT ''")
        if 'superseded' not in columns:
            c.execute("UPDATE market_runs SET superseded=1 WHERE status='partial' AND error LIKE ?",
                      ('Đã chuyển sang lượt quét hết ngành hàng mới%',))

    def save_category(c, category):
        cid = category.url.rsplit('-cat.', 1)[1]
        c.execute('INSERT INTO market_categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url', (cid, category.name.strip(), category.url))
        return cid

    def enqueue(c, cid, max_pages, max_products, full_scan, schedule_id='', shop_id=''):
        active = c.execute("SELECT id,full_scan FROM market_runs WHERE category_id=? AND status IN ('pending','paused') AND superseded=0", (cid,)).fetchone()
        if active:
            if not full_scan or active['full_scan']:
                if shop_id:
                    c.execute("UPDATE market_runs SET shop_id=? WHERE id=? AND shop_id=''", (shop_id, active['id']))
                return active['id']
            # Keep the old checkpoints and snapshots; an exhaustive scan must not
            # inherit a cursor that discarded cards at a sample limit.
            c.execute("UPDATE market_runs SET status='partial',superseded=1,error='Đã chuyển sang lượt quét hết ngành hàng mới; dữ liệu đã lưu được giữ nguyên.' WHERE id=?", (active['id'],))
        rid = uuid.uuid4().hex
        c.execute('INSERT INTO market_runs(id,category_id,created_at,max_pages,max_products,full_scan,schedule_id,shop_id) VALUES(?,?,?,?,?,?,?,?)',
                  (rid, cid, now(), max_pages, max_products, int(full_scan), schedule_id, shop_id))
        return rid

    def schedule_tick():
        stamp = now()
        current = datetime.fromisoformat(stamp)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            for item in c.execute('SELECT * FROM market_schedules WHERE enabled=1 AND next_run_at<=?', (stamp,)).fetchall():
                enqueue(c, item['category_id'], item['max_pages'], item['max_products'], item['full_scan'], item['id'], item['shop_id'])
                due = datetime.fromisoformat(item['next_run_at'])
                interval = timedelta(hours=item['interval_hours'])
                following = due + (int((current-due) / interval)+1)*interval
                c.execute('UPDATE market_schedules SET next_run_at=?,last_run_at=? WHERE id=?', (following.isoformat(), stamp, item['id']))

    @router.post('/schedules')
    def save_schedule(payload: Schedule):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            for category in {x.url: x for x in payload.categories}.values():
                cid = save_category(c, category)
                c.execute('''INSERT INTO market_schedules(id,category_id,interval_hours,next_run_at,max_pages,max_products,full_scan,shop_id)
                  VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET interval_hours=excluded.interval_hours,
                  next_run_at=excluded.next_run_at,max_pages=excluded.max_pages,max_products=excluded.max_products,
                  full_scan=excluded.full_scan,shop_id=excluded.shop_id,enabled=1''',
                  (uuid.uuid4().hex,cid,payload.interval_hours,payload.start_at.isoformat(),payload.max_pages,payload.max_products,int(payload.full_scan),payload.shop_id))
        schedule_tick()
        return {'saved': True}

    @router.get('/schedules')
    def schedules():
        with db() as c:
            return [dict(r) for r in c.execute('''SELECT s.*,c.name,c.url FROM market_schedules s
              JOIN market_categories c ON c.id=s.category_id ORDER BY s.next_run_at''')]

    @router.patch('/schedules/{sid}')
    def toggle_schedule(sid: str, payload: ScheduleState):
        with db() as c:
            changed = c.execute('UPDATE market_schedules SET enabled=? WHERE id=?', (int(payload.enabled),sid))
            if not changed.rowcount:
                raise HTTPException(404, 'Không tìm thấy lịch')
            if not payload.enabled:
                c.execute("UPDATE market_runs SET status='paused',error='Đã tắt lịch; có thể tiếp tục thủ công.' WHERE schedule_id=? AND status='pending'", (sid,))
        return {'enabled': payload.enabled}

    @router.post('/schedules/{sid}/run')
    def run_schedule(sid: str):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            item = c.execute('SELECT * FROM market_schedules WHERE id=?', (sid,)).fetchone()
            if not item:
                raise HTTPException(404, 'Không tìm thấy lịch')
            rid = enqueue(c,item['category_id'],item['max_pages'],item['max_products'],item['full_scan'],sid,item['shop_id'])
        return {'run_ids': [rid]}

    @router.get('/scheduled-ready')
    def scheduled_ready():
        schedule_tick()
        with db() as c:
            return {'run_ids': [r[0] for r in c.execute("""SELECT r.id FROM market_runs r
              JOIN market_schedules s ON s.id=r.schedule_id WHERE r.status='pending' AND s.enabled=1
              ORDER BY r.created_at""")]}

    def run(c, rid):
        row = c.execute('SELECT * FROM market_runs WHERE id=?', (rid,)).fetchone()
        if not row:
            raise HTTPException(404, 'Không tìm thấy lượt quét')
        return dict(row)

    def writable_run(r):
        # A delayed browser result must never revive a finished or superseded
        # campaign after a new exhaustive run has been created for the category.
        if r['superseded'] or r['status'] in ('done', 'partial'):
            raise HTTPException(409, 'Lượt quét đã kết thúc hoặc được thay thế; hãy dùng lượt quét hiện tại')

    def finish(c, rid):
        r = run(c, rid)
        pending = c.execute("SELECT COUNT(*) FROM market_queue WHERE run_id=? AND status='pending'", (rid,)).fetchone()[0]
        if r['listing_done'] and not pending:
            failed = c.execute("SELECT COUNT(*) FROM market_queue WHERE run_id=? AND status='failed'", (rid,)).fetchone()[0]
            c.execute('UPDATE market_runs SET status=? WHERE id=?', ('partial' if failed else 'done', rid))

    @router.post('/campaigns')
    def create(payload: Campaign):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            ids = [enqueue(c, save_category(c, category), payload.max_pages, payload.max_products, payload.full_scan, '', payload.shop_id)
                   for category in {x.url: x for x in payload.categories}.values()]
        return {'run_ids': ids}

    @router.get('/runs')
    def runs(all_rows: bool = False):
        with db() as c:
            return [dict(r) for r in c.execute('''SELECT r.*,c.name,c.url,
              (SELECT COUNT(*) FROM market_queue q WHERE q.run_id=r.id) AS discovered,
              (SELECT COUNT(*) FROM market_queue q WHERE q.run_id=r.id AND q.status='done') AS completed,
              (SELECT COUNT(*) FROM market_queue q WHERE q.run_id=r.id AND q.status='failed') AS failed
              FROM market_runs r JOIN market_categories c ON c.id=r.category_id ORDER BY r.created_at DESC''' + ('' if all_rows else ' LIMIT 300'))]

    @router.get('/runs/{rid}/next')
    def next_task(rid: str, automatic: bool = False):
        with db() as c:
            r = run(c, rid)
            if automatic and r['schedule_id']:
                schedule = c.execute('SELECT enabled FROM market_schedules WHERE id=?', (r['schedule_id'],)).fetchone()
                if not schedule or not schedule['enabled'] or r['status'] == 'paused':
                    return {'type': 'paused'}
            if r['status'] in ('done', 'partial'):
                return {'type': 'done'}
            q = c.execute("SELECT * FROM market_queue WHERE run_id=? AND status='pending' ORDER BY rowid LIMIT 1", (rid,)).fetchone()
            if q:
                return {'type': 'detail', 'url': q['url']}
            category = c.execute('SELECT * FROM market_categories WHERE id=?', (r['category_id'],)).fetchone()
            return {'type': 'listing', 'url': category['url'] + '?page=' + str(r['page']), 'page': r['page']}

    @router.post('/runs/{rid}/listing')
    def listing(rid: str, payload: Listing):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r = run(c, rid)
            writable_run(r)
            if r['listing_done'] or r['page'] != payload.page:
                raise HTTPException(409, 'Trang đã lưu hoặc không đúng con trỏ hiện tại')
            urls = {}
            for url in payload.urls:
                sku = identity(url)
                if not sku or len(url) > 2048:
                    raise HTTPException(422, 'URL sản phẩm không hợp lệ')
                urls[sku] = 'https://shopee.vn/product/' + sku.replace('.', '/')
            count = c.execute('SELECT COUNT(*) FROM market_queue WHERE run_id=?', (rid,)).fetchone()[0]
            added = 0
            for sku, url in urls.items():
                if not r['full_scan'] and count + added >= r['max_products']:
                    break
                added += c.execute('INSERT OR IGNORE INTO market_queue(run_id,sku,url) VALUES(?,?,?)', (rid, sku, url)).rowcount
            done = not payload.has_next or (not r['full_scan'] and (not added or payload.page + 1 >= r['max_pages'] or count + added >= r['max_products']))
            note = ('Không thấy nút trang tiếp theo trên Shopee' if not payload.has_next else
                    'Không thấy sản phẩm mới; tiếp tục trang sau' if not added and r['full_scan'] else
                    'Không thấy sản phẩm mới; dừng phân trang' if not added else
                    'Đã đạt giới hạn quét mẫu' if done else '')
            c.execute("UPDATE market_runs SET page=page+1,listing_done=?,status='pending',error=? WHERE id=?", (int(done), note, rid))
            finish(c, rid)
        return {'added': added, 'listing_done': done}

    def save_product_library(c, r, sku, url, payload, price, sold, rating, stamp):
        """Keep the full product (price, variants, images, description…) in the shop's product library,
        exactly like a shop scan, so it can be analysed and copied into drafts."""
        if not r['shop_id']:
            return
        shop = c.execute('SELECT id,is_demo FROM shops WHERE id=?', (r['shop_id'],)).fetchone()
        if not shop or shop['is_demo']:
            return
        category = c.execute('SELECT name FROM market_categories WHERE id=?', (r['category_id'],)).fetchone()
        source = ('Ngành: ' + (category['name'] if category else r['category_id']))[:120]
        shown = ' > '.join(payload.categories)[:120] if payload.categories else (category['name'] if category else '')
        listing_price = price if price is not None else price_range(payload.price_text)[0]
        stock_match = re.search(r'\d[\d.,]*', payload.stock_text or '')
        stock = _display_number(stock_match.group(0)) if stock_match else None
        day = stamp[:10]
        c.execute('''INSERT INTO observations
            (shop_id,role,source_shop,sku,name,category,price,units_30d,revenue_30d,sold_total,views_30d,rating,
             review_count,cost,stock,product_url,snapshot_date,data_origin)
            VALUES(?,'market',?,?,?,?,?,NULL,NULL,?,NULL,?,?,NULL,?,?,?,'category_market')
            ON CONFLICT(shop_id,role,source_shop,sku,snapshot_date) DO UPDATE SET name=excluded.name,
              category=excluded.category,price=excluded.price,sold_total=excluded.sold_total,rating=excluded.rating,
              review_count=excluded.review_count,stock=excluded.stock,product_url=excluded.product_url,
              data_origin=excluded.data_origin''',
            (r['shop_id'], source, sku, payload.name[:300], shown, listing_price, sold, rating,
             _display_number(payload.review_count_text), stock, url, day))
        c.execute('''INSERT INTO product_details
            (shop_id,role,source_shop,sku,status,detail_json,error,collected_at,last_attempt_at,last_error)
            VALUES(?,'market',?,?,'done',?,'',?,?,'')
            ON CONFLICT(shop_id,role,source_shop,sku) DO UPDATE SET status='done',detail_json=excluded.detail_json,
              error='',collected_at=excluded.collected_at,last_attempt_at=excluded.last_attempt_at,last_error=''
            ''', (r['shop_id'], source, sku, json.dumps(payload.model_dump(), ensure_ascii=False), stamp, stamp))

    @router.post('/runs/{rid}/detail')
    def detail(rid: str, payload: Detail):
        sku = identity(payload.url)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r = run(c, rid)
            queued = c.execute('SELECT * FROM market_queue WHERE run_id=? AND sku=?', (rid, sku)).fetchone()
            if not queued:
                raise HTTPException(422, 'Sản phẩm không thuộc hàng đợi')
            if queued['status'] == 'done':
                return {'saved': False}
            writable_run(r)
            raw = payload.model_dump()
            stamp = now()
            sold = _display_number(payload.sold_text)
            approximate = bool(re.search(r'[kKmM+]', payload.sold_text))
            price_text = payload.price_text.strip()
            price = None
            if re.fullmatch(r'[₫đ\s]*[\d.,]+[₫đ\s]*', price_text):
                price = _display_number(re.sub(r'[₫đ\s]', '', price_text))
            rating = _display_number(payload.rating_text)
            if rating is not None and rating > 5:
                rating = None
            c.execute('''INSERT INTO market_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(sku,day,category_id) DO UPDATE SET name=excluded.name,collected_at=excluded.collected_at,
              price=excluded.price,sold_total=excluded.sold_total,sold_approx=excluded.sold_approx,rating=excluded.rating,
              review_count=excluded.review_count,raw_json=excluded.raw_json''',
              (sku, stamp[:10], r['category_id'], payload.name, queued['url'], stamp, price, sold, int(approximate),
               rating, _display_number(payload.review_count_text), json.dumps(raw, ensure_ascii=False)))
            save_product_library(c, r, sku, queued['url'], payload, price, sold, rating, stamp)
            c.execute("UPDATE market_queue SET status='done',error='' WHERE run_id=? AND sku=?", (rid, sku))
            c.execute("UPDATE market_runs SET status='pending',error='' WHERE id=?", (rid,))
            finish(c, rid)
        after_detail()
        return {'saved': True}

    @router.post('/runs/{rid}/pause')
    def pause_run(rid: str, payload: Failure):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r = run(c, rid)
            if r['status'] not in ('done', 'partial'):
                c.execute("UPDATE market_runs SET status='paused',error=? WHERE id=?", (payload.error, rid))
        return {'paused': True}

    @router.post('/runs/{rid}/resume')
    def resume_run(rid: str):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r = run(c, rid)
            if r['superseded']:
                raise HTTPException(409, 'Lượt quét này đã được thay thế; hãy tiếp tục lượt quét mới của ngành hàng')
            if r['status'] == 'done':
                return {'run_id': rid, 'status': 'done', 'requeued': 0}
            active = c.execute("""SELECT id FROM market_runs WHERE category_id=? AND id<>?
              AND status IN ('pending','paused') AND superseded=0 LIMIT 1""", (r['category_id'], rid)).fetchone()
            if active:
                raise HTTPException(409, 'Ngành hàng đã có lượt quét khác đang chờ; hãy tiếp tục lượt quét đó')
            # Failed products may exist in either a completed partial run or a
            # run paused later. Retry those only; successful checkpoints stay.
            requeued = c.execute("UPDATE market_queue SET status='pending',error='' WHERE run_id=? AND status='failed'", (rid,)).rowcount
            c.execute("UPDATE market_runs SET status='pending',error='' WHERE id=?", (rid,))
            finish(c, rid)
            status = run(c, rid)['status']
        return {'run_id': rid, 'status': status, 'requeued': requeued}

    @router.post('/runs/{rid}/skip')
    def skip(rid: str, payload: SkipRequest):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r = run(c, rid)
            if payload.url is not None:
                sku = identity(payload.url)
                if not sku:
                    raise HTTPException(422, 'URL sản phẩm không hợp lệ')
                queued = c.execute('SELECT * FROM market_queue WHERE run_id=? AND sku=?', (rid, sku)).fetchone()
                if not queued or identity(queued['url']) != sku:
                    raise HTTPException(422, 'Sản phẩm không thuộc hàng đợi của lượt quét này')
                # A duplicated or delayed timeout must not mark the next SKU
                # failed after the requested product was saved or skipped.
                if queued['status'] in ('done', 'failed'):
                    return {'skipped': False}
                writable_run(r)
                changed = c.execute("UPDATE market_queue SET status='failed',error=? WHERE run_id=? AND sku=? AND status='pending'",
                                    (payload.error, rid, sku)).rowcount
            else:
                # Existing manual controls skip the current pending product.
                writable_run(r)
                changed = c.execute("UPDATE market_queue SET status='failed',error=? WHERE rowid=(SELECT rowid FROM market_queue WHERE run_id=? AND status='pending' ORDER BY rowid LIMIT 1)",
                                    (payload.error, rid)).rowcount
            finish(c, rid)
        return {'skipped': bool(changed)}

    def dataset(cid=''):
        with db() as c:
            rows = [dict(r) for r in c.execute('''SELECT s.*,c.name AS category FROM market_snapshots s
              JOIN market_categories c ON c.id=s.category_id WHERE (?='' OR s.category_id=?) ORDER BY collected_at''', (cid, cid))]
        # A product appearing in multiple category runs is one observation per day.
        unique = {(r['sku'], r['day']): r for r in rows}
        return features(list(unique.values()))

    def summary(row):
        """Exact text as shown on the product page (price, rating, reviews, variants); nothing rounded."""
        item = {k: v for k, v in row.items() if k != 'raw_json'}
        try:
            raw = json.loads(row.get('raw_json') or '{}')
        except ValueError:
            raw = {}
        item.update(price_text=raw.get('price_text', ''), rating_text=raw.get('rating_text', ''),
                    review_count_text=raw.get('review_count_text', ''), sold_text=raw.get('sold_text', ''),
                    stock_text=raw.get('stock_text', ''), variants=raw.get('variants') or [],
                    image=(raw.get('images') or [''])[0], categories=raw.get('categories') or [])
        return item

    @router.get('/products')
    def products(category_id: str = '', all_rows: bool = False):
        rows = dataset(category_id)
        latest = {r['sku']: r for r in rows}
        values = sorted(latest.values(), key=lambda r: (r['trend_score'] is not None, r['trend_score'] or 0), reverse=True)
        return {'products': [summary(r) for r in (values if all_rows else values[:500])],
                'product_count': len(values), 'snapshot_count': len(rows),
                'eligible_count': sum(r['trend_score'] is not None for r in values)}

    @router.get('/product')
    def product(sku: str, category_id: str = ''):
        """Full stored detail of one collected product (description, images, variants, attributes…)."""
        with db() as c:
            row = c.execute('''SELECT s.*,c.name AS category FROM market_snapshots s JOIN market_categories c ON c.id=s.category_id
              WHERE s.sku=? AND (?='' OR s.category_id=?) ORDER BY s.day DESC,s.collected_at DESC LIMIT 1''', (sku, category_id, category_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Không tìm thấy sản phẩm đã thu thập.')
        row = dict(row)
        try:
            detail = json.loads(row.pop('raw_json') or '{}')
        except ValueError:
            detail = {}
        detail['collected_at'] = row['collected_at']
        return {**row, 'detail': detail}

    @router.get('/export')
    def export(category_id: str = '', format: str = 'csv'):
        rows = dataset(category_id)
        if format == 'jsonl':
            body = '\n'.join(json.dumps({**r, 'raw': json.loads(r['raw_json'])}, ensure_ascii=False) for r in rows)
            return Response(body, media_type='application/x-ndjson', headers={'Content-Disposition': 'attachment; filename="market-dataset.jsonl"'})
        if format != 'csv':
            raise HTTPException(422, 'Định dạng phải là csv hoặc jsonl')
        keys = ['schema_version','sku','day','category_id','category','name','url','collected_at','price','sold_total','sold_approx','rating','review_count','velocity','acceleration','trend_score','reason']
        out = io.StringIO(); writer = csv.DictWriter(out, fieldnames=keys, extrasaction='ignore'); writer.writeheader()
        for row in rows:
            writer.writerow({k: ("'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v) for k, v in row.items()})
        return Response('\ufeff' + out.getvalue(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="market-features.csv"'})

    from market_pipeline import install as install_market_pipeline
    after_detail = install_market_pipeline(app, db)
    app.include_router(router)
    return schedule_tick
