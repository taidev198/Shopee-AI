"""Shopee Market Intelligence MVP — authorized imports, transparent scoring.
Run: uvicorn app:app --reload --port 8000
The browser collector reads public Shopee pages.
"""
import csv
import hashlib
import hmac
import io
import json
import logging
import math
import os
import re
import sqlite3
import statistics
import unicodedata
import uuid
from html import escape
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from threading import Lock, Event, Thread
from datetime import timedelta
from datetime import date, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urljoin, urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from openpyxl import load_workbook
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from bs4 import UnicodeDammit
from crawl_worker import validate_shop_url, crawl_public_shop, extract_public_cards, extract_saved_shop_page, CrawlError, CrawlBlocked
from competitor_analysis import enrich_product, without_self, rank_recommendations, build_analysis, price_range

ROOT = Path(__file__).parent
DB = Path(os.environ.get('MARKET_DB', str(ROOT / 'market.db')))
BROWSER_PROFILE = DB.parent / '.browser-profile'
DB.parent.mkdir(parents=True, exist_ok=True)
import db_backup
import pgcompat
# DATABASE_URL (Neon / any PostgreSQL) is the primary database. Without it the app keeps using the
# local SQLite file (optionally mirrored by db_backup). MARKETLENS_TEST_PG_URL runs the test-suite on
# PostgreSQL with one isolated schema per MARKET_DB path.
_TEST_PG = os.environ.get('MARKETLENS_TEST_PG_URL', '').strip()
PG_URL = _TEST_PG or next((''.join(os.environ[n].split()) for n in ('DATABASE_URL', 'BACKUP_NEON_URL')
                           if pgcompat.is_postgres_url(os.environ.get(n, ''))), '')
if PG_URL:
    BACKUP_RESTORE = 'postgres'  # data already lives in PostgreSQL: no file restore or mirror
else:
    BACKUP_RESTORE = db_backup.restore_if_missing(DB)  # must precede setup(): a fresh container starts from the last upload
@asynccontextmanager
async def lifespan(app: FastAPI):
    start_local_scheduler()
    category_stop = Event()
    def category_loop():
        while not category_stop.is_set():
            try:
                category_schedule_tick()
            except Exception:
                logging.exception('Category scheduling failed')
            try:
                seller_report_tick()
            except Exception:
                logging.exception('Seller report scheduling failed')
            category_stop.wait(30)
    category_thread = Thread(target=category_loop, name='category-scheduler', daemon=True)
    category_thread.start()
    app.state.market_learning.start()
    # After a failed restore the empty file must never overwrite the good remote copy.
    backup = db_backup.BackupLoop(DB) if BACKUP_RESTORE not in ('error', 'corrupt', 'postgres') else None
    if backup is not None:
        backup.start()
    try:
        yield
    finally:
        if backup is not None:
            backup.stop()
        app.state.market_learning.stop()
        category_stop.set()
        category_thread.join(timeout=5)
        scheduler_stop.set()
        if _scheduler_thread is not None:
            _scheduler_thread.join(timeout=5)


app = FastAPI(title='Market Intelligence', version='0.1.0', description='Shop analytics + public DOM collection via Playwright.', lifespan=lifespan)
app.mount('/static', StaticFiles(directory=str(ROOT / 'static')), name='static')


def _sqlite_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


db = pgcompat.connect_factory(PG_URL, pgcompat.schema_for(DB) if _TEST_PG else None, pooled=not _TEST_PG) \
    if PG_URL else _sqlite_db


def setup():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS shops (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
          category TEXT DEFAULT '', is_demo INTEGER DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shop_id TEXT NOT NULL REFERENCES shops(id), role TEXT NOT NULL,
          source_shop TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
          category TEXT DEFAULT '', price REAL, units_30d REAL, revenue_30d REAL,
          sold_total REAL, views_30d REAL, rating REAL, review_count REAL,
          cost REAL, stock REAL, product_url TEXT DEFAULT '',
          snapshot_date TEXT NOT NULL, data_origin TEXT DEFAULT 'import',
          UNIQUE(shop_id,role,source_shop,sku,snapshot_date)
        );
        CREATE INDEX IF NOT EXISTS idx_obs_shop ON observations(shop_id,role,snapshot_date);
        CREATE TABLE IF NOT EXISTS crawl_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,shop_id TEXT NOT NULL REFERENCES shops(id),
          target_url TEXT NOT NULL,role TEXT NOT NULL,
          interval_hours INTEGER NOT NULL DEFAULT 24, enabled INTEGER NOT NULL DEFAULT 1,
          next_run_at TEXT NOT NULL, last_run_at TEXT DEFAULT '',
          UNIQUE(shop_id,target_url,role)
        );
        CREATE TABLE IF NOT EXISTS crawl_jobs (
          id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id),
          target_url TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
          rows_imported INTEGER DEFAULT 0, error TEXT DEFAULT '',
          created_at TEXT NOT NULL, completed_at TEXT DEFAULT '',
          browser TEXT NOT NULL DEFAULT 'playwright',
          result_token TEXT NOT NULL DEFAULT '', result_expires_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_crawl_jobs_shop ON crawl_jobs(shop_id,created_at);
        CREATE TABLE IF NOT EXISTS crawl_job_products (
          job_id TEXT NOT NULL REFERENCES crawl_jobs(id), sku TEXT NOT NULL,
          source_shop TEXT NOT NULL, product_url TEXT NOT NULL, name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '',
          completed_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(job_id,sku)
        );
        CREATE TABLE IF NOT EXISTS product_details (
          shop_id TEXT NOT NULL REFERENCES shops(id), role TEXT NOT NULL,
          source_shop TEXT NOT NULL, sku TEXT NOT NULL, status TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
          collected_at TEXT NOT NULL DEFAULT '', last_attempt_at TEXT NOT NULL,
          last_error TEXT NOT NULL DEFAULT '', PRIMARY KEY(shop_id,role,source_shop,sku)
        );
        CREATE TABLE IF NOT EXISTS product_comparison_jobs (
          job_id TEXT PRIMARY KEY REFERENCES crawl_jobs(id), own_sku TEXT NOT NULL,
          product_url TEXT NOT NULL, query TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS product_comparison_links (
          shop_id TEXT NOT NULL REFERENCES shops(id), own_sku TEXT NOT NULL,
          source_shop TEXT NOT NULL, sku TEXT NOT NULL, query TEXT NOT NULL,
          product_url TEXT NOT NULL, collected_at TEXT NOT NULL,
          PRIMARY KEY(shop_id,own_sku,source_shop,sku)
        );
        CREATE TABLE IF NOT EXISTS imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT NOT NULL,
          filename TEXT NOT NULL, role TEXT NOT NULL, rows_imported INTEGER NOT NULL,
          imported_at TEXT NOT NULL, snapshot_date TEXT NOT NULL
        );
        ''')
        # Existing local databases keep their jobs when Chrome collection is added.
        job_columns = {row['name'] for row in c.execute('PRAGMA table_info(crawl_jobs)')}
        for column, definition in (
                ('browser', "TEXT NOT NULL DEFAULT 'playwright'"),
                ('result_token', "TEXT NOT NULL DEFAULT ''"),
                ('result_expires_at', "TEXT NOT NULL DEFAULT ''"),
                ('read_details', 'INTEGER NOT NULL DEFAULT 0'),
                ('detail_limit', 'INTEGER NOT NULL DEFAULT 150'),
                ('detail_total', 'INTEGER NOT NULL DEFAULT 0'),
                ('detail_completed', 'INTEGER NOT NULL DEFAULT 0'),
                ('detail_failed', 'INTEGER NOT NULL DEFAULT 0')):
            if column not in job_columns:
                c.execute(f'ALTER TABLE crawl_jobs ADD COLUMN {column} {definition}')


def asdict(row):
    return dict(row) if row else None


def strip_accents(s):
    return ''.join(ch for ch in unicodedata.normalize('NFD', str(s)) if unicodedata.category(ch) != 'Mn').lower()


def norm(s):
    return re.sub(r'[^a-z0-9]+', '_', strip_accents(s).replace('đ','d')).strip('_')


def identity(name):
    return hashlib.sha256(norm(name).encode()).hexdigest()[:16]


def valfloat(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (float,int)):
        return float(v) if math.isfinite(float(v)) else None
    s = str(v).strip().replace('\u00a0','').replace(' ','')
    if not s or s.lower() in ('n/a','none','-','nan'):
        return None
    s = re.sub(r'(₫|đ|vnd|vnđ|%|sp|lượt)', '', s, flags=re.I)
    s = s.replace('+', '')
    # 1.234.567 or 1,234,567 are grouping; 12,5 is decimal
    if re.fullmatch(r'-?\d{1,3}([.,]\d{3})+', s):
        s = s.replace('.','').replace(',','')
    elif ',' in s and '.' in s:
        s = s.replace('.','').replace(',','.') if s.rfind(',') > s.rfind('.') else s.replace(',','')
    elif ',' in s:
        s = s.replace(',','.')
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except ValueError:
        return None

ALIASES = {
 'name': ['name','product_name','ten_san_pham','ten_hang','san_pham','ten_sp','product','ten_san_pham_chinh'],
 'sku': ['sku','ma_sku','sku_phan_loai','ma_san_pham','item_id','product_id','ma_sp'],
 'category': ['category','nganh_hang','danh_muc','danh_muc_san_pham','loai_san_pham'],
 'source_shop': ['source_shop','shop','ten_shop','ten_cua_hang','shop_name','seller','doi_thu'],
 'price': ['price','gia','gia_ban','gia_niem_yet','gia_hien_tai','gia_san_pham'],
 'units_30d': ['units_30d','sold_30d','so_luong_ban_30_ngay','so_san_pham_ban_30_ngay','luot_ban_30_ngay','don_30d'],
 'revenue_30d': ['revenue_30d','doanh_thu_30d','doanh_thu_30_ngay','doanh_so_30_ngay'],
 'sold_total': ['sold_total','da_ban','tong_da_ban','luot_ban','sold'],
 'views_30d': ['views_30d','luot_xem_30_ngay','luot_truy_cap_30_ngay'],
 'rating': ['rating','danh_gia','diem_danh_gia'],
 'review_count': ['review_count','so_danh_gia','luot_danh_gia'],
 'cost': ['cost','gia_von','gia_nhap','chi_phi_nhap'],
 'stock': ['stock','ton_kho','so_luong_ton'],
 'product_url': ['url','product_url','link_san_pham','lien_ket'],
}


def first_from(row, key):
    return next((row[a] for a in ALIASES[key] if a in row and row[a] not in ('',None)), None)


def records_from_bytes(data, filename):
    ext = Path(filename).suffix.lower()
    if ext == '.csv':
        content = None
        for encoding in ('utf-8-sig','utf-16','cp1258','latin1'):
            try:
                content = data.decode(encoding)
                if '\x00' in content:
                    content = None
                    continue
                break
            except UnicodeDecodeError:
                continue
        if content is None:
            raise ValueError('Không giải mã được tệp CSV.')
        dialect = csv.Sniffer().sniff(content[:8192], delimiters=',;\t') if content.strip() else csv.excel
        reader = csv.DictReader(io.StringIO(content), dialect=dialect)
        return [dict(row) for row in reader if row]
    if ext == '.xlsx':
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        try:
            sheet = wb.active
            rows = sheet.iter_rows(values_only=True)
            headers = next(rows, None)
            if not headers: return []
            result = []
            for cells in rows:
                if any(v is not None for v in cells):
                    result.append(dict(zip([str(h or '') for h in headers], cells)))
                    if len(result) > 10000:
                        raise ValueError('Mỗi lượt nhập tối đa 10.000 dòng.')
            return result
        finally:
            wb.close()
    raise ValueError('Chỉ hỗ trợ CSV hoặc XLSX.')


def canonical_rows(raw_rows, role, shop_name, default_category):
    out = []
    for raw in raw_rows:
        row = {norm(k): v for k,v in raw.items() if k is not None}
        name = first_from(row,'name')
        if not name or not str(name).strip():
            continue
        name = str(name).strip()[:300]
        sku = str(first_from(row,'sku') or identity(name)).strip()[:140]
        price = valfloat(first_from(row,'price'))
        source = str(first_from(row,'source_shop') or (shop_name if role=='own' else 'Đối thủ chưa đặt tên')).strip()[:120]
        category = str(first_from(row,'category') or default_category or 'Chưa phân loại').strip()[:120]
        purl = str(first_from(row,'product_url') or '').strip()[:500]
        if purl and not purl.startswith(('https://','http://')): purl = ''
        o = {'source_shop':source,'sku':sku,'name':name,'category':category,'price':price,
             'product_url':purl}
        for k in ('units_30d','revenue_30d','sold_total','views_30d','rating','review_count','cost','stock'):
            number = valfloat(first_from(row,k))
            if number is not None and number < 0: number = None
            if k == 'rating' and number is not None and number > 5: number = None
            o[k] = number
        out.append(o)
    return out


def insert_obs(conn,shop_id,role,items,snapshot_date,origin):
    for x in items:
        conn.execute('''INSERT INTO observations
        (shop_id,role,source_shop,sku,name,category,price,units_30d,revenue_30d,sold_total,
         views_30d,rating,review_count,cost,stock,product_url,snapshot_date,data_origin)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(shop_id,role,source_shop,sku,snapshot_date) DO UPDATE SET
         name=excluded.name,category=excluded.category,price=excluded.price,
         units_30d=excluded.units_30d,revenue_30d=excluded.revenue_30d,
         sold_total=excluded.sold_total,views_30d=excluded.views_30d,rating=excluded.rating,
         review_count=excluded.review_count,cost=excluded.cost,stock=excluded.stock,
         product_url=excluded.product_url,data_origin=excluded.data_origin''',
         (shop_id,role,x['source_shop'],x['sku'],x['name'],x['category'],x['price'],x['units_30d'],
          x['revenue_30d'],x['sold_total'],x['views_30d'],x['rating'],x['review_count'],
          x['cost'],x['stock'],x['product_url'],snapshot_date,origin))


def ensure_demo():
    with db() as c:
        if c.execute("SELECT 1 FROM shops WHERE id='demo'").fetchone(): return
        c.execute("INSERT INTO shops VALUES (?,?,?,?,?,?)",('demo',"Family's House — DỮ LIỆU MẪU",'https://shopee.vn/familys_house','Nhà cửa & Đời sống',1,datetime.now().isoformat()))
        own = [
         ('Hộp đựng đồ đa năng có nắp',89000,170,4.8,236,44500),
         ('Móc dán tường chịu lực bộ 10 chiếc',39000,255,4.7,418,14800),
         ('Kệ để giày dép gấp gọn 4 tầng',179000,73,4.6,114,103000),
         ('Khăn lau bếp sợi microfiber bộ 5',59000,210,4.9,392,24000),
         ('Hộp đựng gia vị trong suốt',69000,121,4.7,142,29000),
         ('Giỏ đựng quần áo gấp gọn',129000,64,4.5,88,67000),
         ('Bình xịt dầu ăn nhà bếp 200ml',79000,90,4.8,201,37000),
        ]
        market = [
         ('Kệ góc nhà tắm không khoan tường',85000,460,4.8,620,'HomeStore A',38000),
         ('Túi giặt quần áo chống rối 5 cái',49000,690,4.7,814,'HomeStore B',18000),
         ('Hộp chia ngăn tủ lạnh 3 chiếc',99000,395,4.8,526,'HomeStore C',42000),
         ('Chổi vệ sinh khe cửa sổ đa năng',29000,880,4.7,1038,'HomeStore B',9000),
         ('Giá úp nắp nồi tiết kiệm diện tích',79000,335,4.9,291,'HomeStore A',32000),
         ('Thảm silicon chống trượt nhà bếp',65000,410,4.6,345,'HomeStore D',26500),
         ('Túi hút chân không đựng chăn 5 túi',109000,265,4.8,230,'HomeStore D',48000),
         ('Hộp đựng đồ đa năng có nắp',82000,410,4.6,455,'HomeStore C',39000),
         ('Móc dán tường chịu lực bộ 10 chiếc',36000,615,4.7,709,'HomeStore A',14000),
         ('Giá đựng dao thớt để bàn',149000,195,4.7,210,'HomeStore E',71000),
        ]
        o = []
        for name,price,units,rating,reviews,cost in own:
            o.append({'source_shop':"Family's House",'sku':identity(name),'name':name,'category':'Nhà cửa & Đời sống','price':price,'units_30d':units,'revenue_30d':None,'sold_total':units*7,'views_30d':units*25,'rating':rating,'review_count':reviews,'cost':cost,'stock':units*2,'product_url':''})
        m = []
        for name,price,units,rating,reviews,source,cost in market:
            m.append({'source_shop':source,'sku':identity(name),'name':name,'category':'Nhà cửa & Đời sống','price':price,'units_30d':units,'revenue_30d':None,'sold_total':units*9,'views_30d':None,'rating':rating,'review_count':reviews,'cost':cost,'stock':None,'product_url':''})
        insert_obs(c,'demo','own',o,'2026-10-12','synthetic_demo')
        insert_obs(c,'demo','market',m,'2026-10-12','synthetic_demo')

setup()
if os.environ.get('MARKETLENS_DEMO') == '1':  # synthetic sample shop is opt-in; hosted installs show only collected data
    ensure_demo()

from auth import install as install_auth
install_auth(app, db)


class ShopCreate(BaseModel):
    url: str
    name: str = ''
    category: str = ''


from ui_roles import install as install_ui_roles
install_ui_roles(app, ROOT)


@app.get('/api/health')
def health():
    return {'ok':True,'mode':'public_browser_crawler','version':'0.2.0','crawler_enabled':crawler_enabled()}


@app.get('/api/shops')
def shops(request: Request):
    with db() as c:
        if request.state.auth['role'] == 'system':
            return [asdict(r) for r in c.execute('SELECT * FROM shops ORDER BY is_demo ASC, created_at DESC')]
        return [asdict(r) for r in c.execute('''SELECT s.* FROM shops s JOIN auth_account_shops a ON a.shop_id=s.id
          WHERE a.account_id=? ORDER BY s.is_demo ASC,s.created_at DESC''',(request.state.auth['id'],))]


@app.post('/api/shops')
def create_shop(payload: ShopCreate, request: Request):
    try:
        url = validate_shop_url(payload.url)
    except ValueError as e:
        raise HTTPException(422,str(e))
    username = url.rsplit('/',1)[1]
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        existing = c.execute('SELECT * FROM shops WHERE url=? AND is_demo=0',(url,)).fetchone()
        if existing:
            # A user may add any shop by URL: if it already exists (added by someone else), link it to them.
            if request.state.auth['role'] != 'system':
                c.execute('INSERT OR IGNORE INTO auth_account_shops VALUES(?,?)',(request.state.auth['id'],existing['id']))
            return asdict(existing)
        shop_id = str(uuid.uuid4())
        c.execute('INSERT INTO shops VALUES (?,?,?,?,?,?)',
            (shop_id, (payload.name.strip() or username)[:120],url,payload.category.strip()[:120],0,datetime.now().isoformat()))
        if request.state.auth['role'] == 'user':
            c.execute('INSERT INTO auth_account_shops VALUES(?,?)',(request.state.auth['id'],shop_id))
        return asdict(c.execute('SELECT * FROM shops WHERE id=?',(shop_id,)).fetchone())


@app.post('/api/import')
async def upload(shop_id: str=Form(...), role: str=Form(...), snapshot_date: str=Form(...), file: UploadFile=File(...)):
    if role not in ('own','market'):
        raise HTTPException(422,'role phải là own hoặc market')
    try: date.fromisoformat(snapshot_date)
    except ValueError: raise HTTPException(422,'Ngày phải theo định dạng YYYY-MM-DD')
    if Path(file.filename or '').suffix.lower() not in ('.csv','.xlsx'):
        raise HTTPException(422,'Chỉ nhận tệp CSV/XLSX')
    data = await file.read(8*1024*1024+1)
    if len(data) > 8*1024*1024: raise HTTPException(413,'Tệp tối đa 8MB')
    with db() as c:
        shop = c.execute('SELECT * FROM shops WHERE id=?',(shop_id,)).fetchone()
        if not shop: raise HTTPException(404,'Không tìm thấy shop')
        if shop['is_demo']: raise HTTPException(422,'Hãy tạo shop riêng để nhập dữ liệu thật, không nhập đè dữ liệu mẫu.')
        try:
            rows = records_from_bytes(data,file.filename)
            if len(rows)>10000: raise ValueError('Tối đa 10.000 dòng cho mỗi lần nhập')
            items = canonical_rows(rows,role,shop['name'],shop['category'])
        except (ValueError, csv.Error, Exception) as e:
            # Errors from bad spreadsheets are safely returned as a generic validation error.
            raise HTTPException(422, f'Tệp dữ liệu không hợp lệ: {str(e)[:180]}')
        if not items:
            raise HTTPException(422,'Không tìm thấy cột tên sản phẩm. Dùng tệp mẫu hoặc cột "Tên sản phẩm".')
        insert_obs(c,shop_id,role,items,snapshot_date,'user_import')
        c.execute('INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date) VALUES(?,?,?,?,?,?)',
            (shop_id,Path(file.filename).name[:200],role,len(items),datetime.now().isoformat(),snapshot_date))
        return {'ok':True,'rows':len(items),'role':role,'snapshot_date':snapshot_date}


def latest_records(rows):
    """Preserve explicit units_30d; optionally derive *estimated* pace from sold-total deltas.

    A snapshot delta is not a 30-day actual result. Units and revenues are
    tagged with estimated_snapshot_delta and lower-confidence language.
    """
    grouped=defaultdict(list)
    for r in rows:
        grouped[(r['role'],norm(r['source_shop']),r['sku'])].append(dict(r))
    result=[]
    for history in grouped.values():
        history.sort(key=lambda r:(r['snapshot_date'],r['id']))
        newest=history[-1].copy()
        newest['units_basis']='reported_or_imported' if newest['units_30d'] is not None else 'missing'
        newest['delta_days']=None
        if newest['units_30d'] is None and newest['sold_total'] is not None:
            for prev in reversed(history[:-1]):
                if prev['sold_total'] is None: continue
                days=(date.fromisoformat(newest['snapshot_date'])-date.fromisoformat(prev['snapshot_date'])).days
                if days < 7: continue
                if days > 90: break
                if newest['sold_total'] >= prev['sold_total']:
                    newest['units_30d']=round((newest['sold_total']-prev['sold_total'])*30/days,1)
                    newest['units_basis']='estimated_snapshot_delta'
                    newest['delta_days']=days
                break
        result.append(newest)
    return result


def revenue(x):
    if x.get('revenue_30d') is not None: return x['revenue_30d']
    if x.get('units_30d') is not None and x.get('price') is not None: return x['units_30d']*x['price']
    return None


def family(s):
    return norm((s or '').split('>')[0].split('/')[0].strip())


def candidate_score(x, own, market, platform_fee, ads_fee):
    units = x['units_30d']
    provisional = units is None
    if provisional and x.get('sold_total') is None and x.get('review_count') is None:
        return None
    market_with_units = [a['units_30d'] for a in market if a['units_30d'] is not None]
    best = max(market_with_units or [1])
    if provisional:
        # Cumulative sold is only a weak discovery signal, NEVER labelled as 30-day sales.
        signal = 'sold_total' if x.get('sold_total') is not None else 'review_count'
        signal_sample=[r[signal] for r in market if r.get(signal) is not None]
        observed=x.get(signal) or 0
        demand = min(100, 100*math.log1p(observed)/max(1,math.log1p(max(signal_sample or [1]))))
    else:
        demand = min(100, 100*math.log1p(units)/max(1,math.log1p(best)))
    prices = [p['price'] for p in own if p['price'] and p['price']>0]
    median_price = statistics.median(prices) if prices else None
    price_fit = (max(0,100-62*abs(math.log(max(1,x['price'] or median_price)/median_price)))
                 if median_price is not None else 50)
    competitors = len(set(a['source_shop'] for a in market if family(a['category'])==family(x['category'])))
    competition = min(100,max(20,100-8*(competitors-1))) # only measured coverage, not all of Shopee
    actual_cost = x.get('cost')
    gross_margin = None
    if x.get('price') and actual_cost is not None:
        gross_margin = 100*((1-platform_fee-ads_fee)*x['price']-actual_cost)/x['price']
    margin_score = min(100,max(0,50+(gross_margin or 0)*1.2)) if gross_margin is not None else 50
    # momentum remains neutral until a meaningful time series exists
    momentum = 50
    score = round(0.37*demand+0.18*price_fit+0.18*margin_score+0.12*competition+0.15*momentum,1)
    if provisional: score=min(score,65)
    reasons = [ (('Chỉ có số đã bán tích lũy; CHƯA biết tốc độ bán 30 ngày' if x.get('sold_total') is not None else
                  'Chỉ có lượt đánh giá; chưa biết lượng bán hoặc tốc độ bán 30 ngày') if provisional else
                 f'ƯỚC TÍNH {int(units):,} sp/30 ngày từ chênh lệch {x["delta_days"]} ngày, không phải số thực tế' if x.get('units_basis')=='estimated_snapshot_delta' else
                 f'{int(units):,} sản phẩm/30 ngày trong mẫu dữ liệu'),
               f'Giá {int(x["price"]):,}đ được so với trung vị {int(median_price):,}đ của nhóm tham chiếu' if x['price'] and median_price is not None else
               'Chưa có giá cùng nhóm của shop: điểm phân khúc giá trung tính']
    if gross_margin is None:
        reasons.append('Chưa có giá vốn: điểm biên lợi nhuận trung tính')
    else:
        reasons.append(f'Biên đóng góp tạm tính {gross_margin:.1f}% theo phí giả định')
    confidence = ('Rất thấp' if provisional else 'Thấp' if x.get('units_basis')=='estimated_snapshot_delta' else
                  'Trung bình' if x['cost'] is not None else 'Thấp')
    return {'score':score,'confidence':confidence,'is_provisional':provisional,
            'demand_score':round(demand),'price_fit':round(price_fit), 'competition_sample':competitors,
            'margin_estimate_pct':round(gross_margin,1) if gross_margin is not None else None,
            'reasons':reasons}


def report(shop_id,platform_fee=0.12,ads_fee=0.08,all_rows=False):
    if not (0 <= platform_fee <= .8 and 0<=ads_fee<=.8 and platform_fee+ads_fee<=.95):
        raise HTTPException(422,'Tỷ lệ phí không hợp lệ')
    with db() as c:
        shop = c.execute('SELECT * FROM shops WHERE id=?',(shop_id,)).fetchone()
        if not shop: raise HTTPException(404,'Không tìm thấy shop')
        rows = c.execute('SELECT * FROM observations WHERE shop_id=? ORDER BY snapshot_date ASC,id ASC',(shop_id,)).fetchall()
        imports = [dict(r) for r in c.execute('SELECT * FROM imports WHERE shop_id=? ORDER BY id DESC' + ('' if all_rows else ' LIMIT 20'),(shop_id,))]
        details = {(row['role'], norm(row['source_shop']), row['sku']): row
                   for row in c.execute('SELECT * FROM product_details WHERE shop_id=?', (shop_id,))}
        comparison_links = [dict(row) for row in c.execute(
            'SELECT * FROM product_comparison_links WHERE shop_id=?', (shop_id,))]
    records = latest_records(rows)
    for product in records:
        detail = details.get((product['role'], norm(product['source_shop']), product['sku']))
        if detail:
            product['detail'] = {**json.loads(detail['detail_json']),
                                 **{key: detail[key] for key in
                                    ('status', 'error', 'collected_at', 'last_attempt_at', 'last_error')}}
        else:
            product['detail'] = None
    records = [enrich_product(product) for product in records]
    own = [r for r in records if r['role']=='own']
    market = without_self(own, [r for r in records if r['role']=='market'], dict(shop))
    price_own = [x['price'] for x in own if x['price'] is not None]
    rev = [revenue(x) for x in own]
    units = [x['units_30d'] for x in own if x['units_30d'] is not None]
    by_category = defaultdict(lambda:{'category':'','products':0,'revenue_30d':0,'units_30d':0})
    for x in own:
        g = by_category[x['category']]
        g['category']=x['category'];g['products']+=1;g['revenue_30d']+=revenue(x) or 0;g['units_30d']+=x['units_30d'] or 0
    cat = sorted(by_category.values(),key=lambda x:x['revenue_30d'],reverse=True)
    opportunities = rank_recommendations(own, market, dict(shop), candidate_score, platform_fee, ads_fee)
    competitor_analysis = build_analysis(own, market, opportunities, comparison_links)
    from seller_matching import compare_equivalence
    for comparison in competitor_analysis.get('product_comparisons', []):
        for candidate in comparison.get('competitors', []):
            candidate['equivalence'] = compare_equivalence(comparison['own_product'], candidate)
    own.sort(key=lambda p:(revenue(p) if revenue(p) is not None else -1),reverse=True)
    has_rev=any(r is not None for r in rev)
    revenue_kind=('estimated_snapshot_delta' if any(x.get('units_basis')=='estimated_snapshot_delta' for x in own) else
                  'estimate' if any(x['revenue_30d'] is None and revenue(x) is not None for x in own) else 'reported')
    return {
      'shop':dict(shop),'kpis':{
        'own_products':len(own),'market_products':len(market),
        'revenue_30d':round(sum(x for x in rev if x is not None)) if has_rev else None,
        'revenue_kind':revenue_kind if has_rev else 'missing',
        'units_30d':round(sum(units)) if units else None,
        'median_price':round(statistics.median(price_own)) if price_own else None,
        'market_shops':competitor_analysis['summary']['shop_count']
      },
      'categories':cat,'own_products':own,'opportunities':opportunities if all_rows else opportunities[:60],
      'market_products':market if all_rows else market[:300],
      'market_products_total':len(market),'market_products_truncated':not all_rows and len(market)>300,
      'competitor_analysis':competitor_analysis,
      'imports':imports,'snapshots':sorted(set(x['snapshot_date'] for x in rows),reverse=True),
      'assumptions':{'platform_fee_pct':platform_fee*100,'ads_fee_pct':ads_fee*100},
      'notes':[
        'Crawler đọc trang công khai, tuân thủ robots.txt và dừng khi gặp yêu cầu xác minh.',
        'Crawler lấy giá và số đã bán tích lũy (nếu hiển thị); không có số bán 30 ngày từ một lần quét.',
        'Doanh thu suy ra từ giá × số lượng bán 30 ngày là ước tính, không phải doanh thu thực nhận.',
        'Điểm cơ hội chỉ xếp hạng trong các sản phẩm thuộc tệp đối thủ đã nhập.',
        'Dữ liệu 2 ảnh chụp cách nhau >= 7 ngày chỉ cho ước tính tốc độ bán, không phải số liệu chính thức.',
        'Điểm cạnh tranh phản ánh số shop có trong tệp, không đại diện toàn sàn.',
      ]
    }


@app.get('/api/dashboard')
def dashboard(shop_id: str, platform_fee_pct: float=12, ads_fee_pct: float=8, all_rows: bool=False):
    data = report(shop_id,platform_fee_pct/100,ads_fee_pct/100,all_rows=all_rows)
    data['seller_analysis'] = app.state.seller_analysis(data)
    return data


@app.get('/api/template/{kind}')
def template(kind: str):
    if kind not in ('own','market'): raise HTTPException(404,'Không có tệp mẫu')
    return FileResponse(ROOT/'samples'/f'{kind}.csv', filename=f'mau_{kind}.csv',media_type='text/csv; charset=utf-8')


@app.get('/api/export/opportunities')
def export_opportunities(shop_id: str,platform_fee_pct: float=12,ads_fee_pct: float=8):
    opportunities = report(shop_id,platform_fee_pct/100,ads_fee_pct/100)['opportunities']
    f = io.StringIO()
    w = csv.writer(f)
    w.writerow(['Tên sản phẩm','Shop đối thủ trong mẫu','Ngành hàng','Giá VND','Bán 30 ngày (theo tệp)','Điểm cơ hội','Độ tin cậy','Biên tạm tính %','Lý do'])
    for x in opportunities:
        w.writerow([x['name'],x['source_shop'],x['category'],x['price'],x['units_30d'],x['score'],x['confidence'],x['margin_estimate_pct'],'; '.join(x['reasons'])])
    return Response('\ufeff'+f.getvalue(),media_type='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename="co_hoi_san_pham.csv"'})

# Public browser collector. Available on fresh installs.
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='marketlens-crawler')
crawl_lock=Lock()

def crawler_enabled():
    return True


class CrawlRequest(BaseModel):
    shop_id: str
    target_url: str | None = None
    role: str = 'market'
    interactive: bool = False
    browser: Literal['playwright', 'chrome'] = 'playwright'
    read_details: bool = False
    detail_limit: int = Field(default=150, ge=1, le=1000)


class BrowserProductCard(BaseModel):
    model_config = ConfigDict(extra='forbid')
    href: str = Field(min_length=1, max_length=2048)
    name: str = Field(max_length=300)
    text: str = Field(max_length=5000)


class BrowserShopPage(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=1, max_length=2048)
    cards: list[BrowserProductCard] = Field(max_length=300)


class BrowserCrawlResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    result_token: str = Field(min_length=1, max_length=128)
    pages: list[BrowserShopPage] = Field(default_factory=list, max_length=5)
    error: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def bounded_dom_capture(self):
        size = len(self.result_token.encode('utf-8')) + len((self.error or '').encode('utf-8'))
        for page in self.pages:
            size += len(page.url.encode('utf-8'))
            for card in page.cards:
                size += sum(len(value.encode('utf-8')) for value in (card.href, card.name, card.text))
        if size > 2 * 1024 * 1024:
            raise ValueError('Dữ liệu sản phẩm đọc từ Chrome tối đa 2MB.')
        return self


def _product_url_identity(value):
    """Product identity comes from the public pathname, never query parameters."""
    try:
        parsed = urlparse(value)
        if (parsed.scheme != 'https' or parsed.hostname not in ('shopee.vn', 'www.shopee.vn') or
                parsed.username or parsed.password or parsed.port):
            return None
        match = re.fullmatch(r'/product/(\d+)/(\d+)/?', parsed.path)
        if not match:
            match = re.fullmatch(r'/[^/]+-i\.(\d+)\.(\d+)/?', parsed.path)
        return '.'.join(match.groups()) if match else None
    except ValueError:
        return None


class ProductAttribute(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=300)
    value: str = Field(max_length=3000)


class ProductVariant(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=300)
    options: list[str] = Field(default_factory=list, max_length=100)

    @field_validator('options')
    @classmethod
    def bounded_options(cls, values):
        if any(len(value) > 300 for value in values):
            raise ValueError('Tên phân loại sản phẩm tối đa 300 ký tự.')
        return values


class BrowserProductDetail(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=1, max_length=2048)
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default='', max_length=50000)
    images: list[str] = Field(default_factory=list, max_length=30)
    description_images: list[str] = Field(default_factory=list, max_length=30)
    attributes: list[ProductAttribute] = Field(default_factory=list, max_length=100)
    variants: list[ProductVariant] = Field(default_factory=list, max_length=20)
    categories: list[str] = Field(default_factory=list, max_length=20)
    price_text: str = Field(default='', max_length=500)
    rating_text: str = Field(default='', max_length=300)
    review_count_text: str = Field(default='', max_length=300)
    sold_text: str = Field(default='', max_length=300)
    stock_text: str = Field(default='', max_length=500)

    @field_validator('url')
    @classmethod
    def valid_product_url(cls, value):
        if not _product_url_identity(value):
            raise ValueError('Chi tiết phải thuộc trang sản phẩm Shopee công khai.')
        return value

    @field_validator('images', 'description_images')
    @classmethod
    def public_image_urls(cls, values):
        for value in values:
            try:
                parsed = urlparse(value)
                valid = (len(value) <= 2048 and parsed.scheme == 'https' and parsed.hostname and
                         not parsed.username and not parsed.password and not parsed.port)
            except ValueError:
                valid = False
            if not valid:
                raise ValueError('Ảnh sản phẩm phải có URL HTTPS công khai.')
        return values

    @field_validator('categories')
    @classmethod
    def bounded_categories(cls, values):
        if any(len(value) > 300 for value in values):
            raise ValueError('Tên ngành hàng tối đa 300 ký tự.')
        return values

    @model_validator(mode='after')
    def bounded_detail(self):
        if len(self.model_dump_json().encode('utf-8')) > 256 * 1024:
            raise ValueError('Chi tiết mỗi sản phẩm tối đa 256KB.')
        return self


class BrowserProductResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    result_token: str = Field(min_length=1, max_length=128)
    product_url: str = Field(min_length=1, max_length=2048)
    detail: BrowserProductDetail | None = None
    error: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def one_result(self):
        if bool(self.detail) == bool((self.error or '').strip()):
            raise ValueError('Gửi chi tiết sản phẩm hoặc lỗi đọc sản phẩm.')
        return self


class FinishProductDetails(BaseModel):
    model_config = ConfigDict(extra='forbid')
    result_token: str = Field(min_length=1, max_length=128)
    error: str | None = Field(default=None, max_length=500)


class CompetitorProductRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    shop_id: str = Field(min_length=1, max_length=128)
    own_sku: str = Field(min_length=1, max_length=140)
    target_url: str = Field(min_length=1, max_length=2048)
    product_url: str = Field(min_length=1, max_length=2048)
    query: str = Field(min_length=1, max_length=300)

    @field_validator('query')
    @classmethod
    def searchable_query(cls, value):
        if not value.strip():
            raise ValueError('Từ khóa tìm sản phẩm không được để trống.')
        return value.strip()


class CompetitorProductResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    result_token: str = Field(min_length=1, max_length=128)
    detail: BrowserProductDetail | None = None
    error: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def one_result(self):
        if bool(self.detail) == bool((self.error or '').strip()):
            raise ValueError('Gửi chi tiết sản phẩm đối thủ hoặc lỗi đọc sản phẩm.')
        return self


def _require_chrome_result_job(conn, job_id, result_token):
    job = conn.execute('SELECT * FROM crawl_jobs WHERE id=?', (job_id,)).fetchone()
    if not job:
        raise HTTPException(404, 'Không tìm thấy lượt quét.')
    if job['browser'] != 'chrome':
        raise HTTPException(409, 'Lượt quét này không nhận dữ liệu từ Chrome.')
    if job['status'] != 'running':
        raise HTTPException(409, 'Lượt quét đã kết thúc; hãy bấm Quét một lần để tạo lượt mới.')
    if not hmac.compare_digest(job['result_token'].encode('utf-8'), result_token.encode('utf-8')):
        raise HTTPException(403, 'Mã gửi kết quả Chrome không hợp lệ.')
    if not job['result_expires_at'] or job['result_expires_at'] <= datetime.now().isoformat():
        # This helper runs before callback writes. Commit expiry explicitly:
        # raising inside the surrounding db() context would otherwise roll it back.
        conn.execute("""UPDATE crawl_jobs SET status='failed',error=?,completed_at=?,result_token=''
            WHERE id=?""", ('Hết thời gian chờ Chrome gửi sản phẩm. Hãy bấm Quét một lần để thử lại.',
                            datetime.now().isoformat(), job_id))
        conn.commit()
        raise HTTPException(410, 'Lượt quét Chrome đã hết thời gian chờ.')
    return job


def _detail_progress(job):
    return {key: job[key] for key in ('detail_total', 'detail_completed', 'detail_failed')}


def _expire_chrome_jobs(conn):
    now = datetime.now().isoformat()
    conn.execute("""UPDATE crawl_jobs SET status='failed', error=?, completed_at=?, result_token=''
        WHERE browser='chrome' AND status='running' AND result_expires_at!='' AND result_expires_at<=?""",
        ('Hết thời gian chờ Chrome gửi sản phẩm. Hãy bấm Quét một lần để thử lại.', now, now))


def _public_crawl_job(row):
    result = dict(row)
    # Only the response to the initiating click receives the one-use capability.
    result.pop('result_token', None)
    return result


def _products_from_browser_pages(pages, job, shop):
    target = urlparse(job['target_url'])
    source_name = shop['name'] if job['role'] == 'own' else target.path.strip('/')
    products_by_sku = {}
    for page in pages:
        try:
            current = urlparse(page.url)
            valid_page = (current.scheme == 'https' and current.hostname in ('shopee.vn', 'www.shopee.vn') and
                          current.path.rstrip('/').lower() == target.path.rstrip('/').lower() and
                          not current.username and not current.password and not current.port)
        except ValueError:
            valid_page = False
        if not valid_page:
            raise HTTPException(422, 'Trang Chrome không thuộc URL shop của lượt quét này.')
        cards_html = []
        for card in page.cards:
            try:
                href = urljoin(page.url, card.href)
                parsed = urlparse(href)
                valid_link = (parsed.scheme == 'https' and
                              parsed.hostname in ('shopee.vn', 'www.shopee.vn') and
                              not parsed.username and not parsed.password and not parsed.port)
            except ValueError:
                valid_link = False
            # Use the same product-link parser as the collector, including its
            # rejection of product IDs hidden in redirect/search parameters.
            if not valid_link or not extract_public_cards(
                    f'<a href="{escape(href, quote=True)}" title="Sản phẩm"></a>',
                    page.url, source_name, shop['category']):
                raise HTTPException(422, 'Chrome gửi liên kết không phải sản phẩm Shopee.')
            cards_html.append(
                f'<a href="{escape(href, quote=True)}" title="{escape(card.name, quote=True)}">'
                f'<img alt="{escape(card.name, quote=True)}">'
                f'<span>{escape(card.text)}</span></a>')
        if not cards_html:
            continue
        html = (f'<html><head><link rel="canonical" href="{escape(job["target_url"], quote=True)}">'
                f'</head><body>{"".join(cards_html)}</body></html>')
        try:
            products = extract_saved_shop_page(html, job['target_url'], source_name, shop['category'])
        except (CrawlError, ValueError) as error:
            raise HTTPException(422, str(error)) from error
        for product in products:
            previous = products_by_sku.get(product['sku'])
            if previous is None:
                products_by_sku[product['sku']] = product
            else:
                previous.update({key: value for key, value in product.items()
                                 if previous.get(key) is None and value is not None})
    return list(products_by_sku.values())[:150]


def _process_crawl_job(job_id: str, interactive: bool = False):
    with db() as c:
        job = c.execute('SELECT * FROM crawl_jobs WHERE id=?',(job_id,)).fetchone()
        if not job: return
        c.execute("UPDATE crawl_jobs SET status='running',error='' WHERE id=?",(job_id,))
        shop = c.execute('SELECT * FROM shops WHERE id=?',(job['shop_id'],)).fetchone()
    try:
        target_name = (shop['name'] if job['role']=='own' else job['target_url'].split('/')[-1])
        if interactive or BROWSER_PROFILE.exists():
            def on_status(message):
                with db() as c:
                    c.execute("UPDATE crawl_jobs SET error=? WHERE id=? AND status='running'",
                              (str(message)[:500],job_id))
            products = crawl_public_shop(job['target_url'],target_name,shop['category'],
                                        interactive=interactive,user_data_dir=str(BROWSER_PROFILE),
                                        on_status=on_status)
        else:
            products = crawl_public_shop(job['target_url'],target_name,shop['category'])
        if not products: raise CrawlError('Không tìm thấy sản phẩm công khai.')
        with db() as c:
            # Record the same date as the observing system; rows are not fabricated.
            snapshot_date=date.today().isoformat()
            insert_obs(c,job['shop_id'],job['role'],products,snapshot_date,'browser_public_dom')
            c.execute('INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date) VALUES(?,?,?,?,?,?)',
                    (job['shop_id'],'Playwright: '+job['target_url'],job['role'],len(products),datetime.now().isoformat(),snapshot_date))
            c.execute("UPDATE crawl_jobs SET status='done',rows_imported=?,error='',completed_at=? WHERE id=?",
                     (len(products),datetime.now().isoformat(),job_id))
    except Exception as e:
        logging.getLogger('uvicorn.error').warning('Crawl job %s failed: %s', job_id, e)
        with db() as c:
            c.execute("UPDATE crawl_jobs SET status='failed',error=?,completed_at=? WHERE id=?",
                     (str(e)[:500],datetime.now().isoformat(),job_id))


@app.get('/api/crawl/config')
def crawl_config():
    return {'enabled':crawler_enabled(),
            'blockers':[],
            'requirements':'Chromium đã cài; trang công khai truy cập được và robots.txt cho phép.',
            'mode':'Playwright DOM / optional manual browser assistance',
            'interactive_available':True,
            'chrome_bridge_available':True}


@app.post('/api/crawl/import-html')
async def import_shop_html(shop_id: str = Form(...), target_url: str = Form(...),
                           role: str = Form(...), snapshot_date: str = Form(...),
                           file: UploadFile = File(...)):
    if role not in ('own', 'market'):
        raise HTTPException(422, 'role phải là own hoặc market')
    try:
        date.fromisoformat(snapshot_date)
        target_url = validate_shop_url(target_url)
    except ValueError as error:
        raise HTTPException(422, str(error))
    if Path(file.filename or '').suffix.lower() not in ('.html', '.htm'):
        raise HTTPException(422, 'Chọn tệp .html hoặc .htm đã lưu từ trang shop, không dùng MHTML/PDF.')
    with db() as c:
        shop = c.execute('SELECT * FROM shops WHERE id=?', (shop_id,)).fetchone()
    if not shop or shop['is_demo']:
        raise HTTPException(422, 'Hãy chọn shop riêng để nhập sản phẩm từ trang đã lưu.')
    if role == 'own' and target_url != shop['url']:
        raise HTTPException(422, 'Dữ liệu shop đang phân tích phải thuộc URL của shop đã chọn.')
    data = await file.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, 'Tệp HTML tối đa 8MB.')
    html = UnicodeDammit(data, is_html=True).unicode_markup
    if not html:
        raise HTTPException(422, 'Tệp HTML trống hoặc không đọc được nội dung.')
    source_name = shop['name'] if role == 'own' else target_url.rsplit('/', 1)[-1]
    try:
        products = extract_saved_shop_page(html, target_url, source_name, shop['category'])
    except (CrawlError, ValueError) as error:
        raise HTTPException(422, str(error))
    with db() as c:
        insert_obs(c, shop_id, role, products, snapshot_date, 'saved_browser_dom')
        c.execute('INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date) VALUES(?,?,?,?,?,?)',
                  (shop_id, 'HTML: ' + Path(file.filename).name[:190], role, len(products),
                   datetime.now().isoformat(), snapshot_date))
    return {'ok': True, 'rows': len(products), 'role': role, 'snapshot_date': snapshot_date,
            'data_origin': 'saved_browser_dom'}


@app.post('/api/crawl/jobs',status_code=202)
def start_crawl(payload:CrawlRequest):
    if payload.role not in ('own','market'):
        raise HTTPException(422,'role chỉ nhận own hoặc market')
    with db() as c:
        _expire_chrome_jobs(c)
        shop=c.execute('SELECT * FROM shops WHERE id=?',(payload.shop_id,)).fetchone()
        if not shop or shop['is_demo']: raise HTTPException(404,'Không tìm thấy shop riêng.')
        try: url=validate_shop_url(payload.target_url or shop['url'])
        except ValueError as e: raise HTTPException(422,str(e))
        if payload.role == 'own' and url != shop['url']:
            raise HTTPException(422,'Dữ liệu own chỉ có thể lấy từ URL của shop đang chọn.')
        count=c.execute("SELECT COUNT(*) AS cnt FROM crawl_jobs WHERE status IN ('queued','running')").fetchone()['cnt']
        if count >= 3: raise HTTPException(429,'Hàng đợi đang đủ 3 lượt, hãy thử lại sau.')
        if payload.role == 'market' and url.lower() == shop['url'].lower():
            raise HTTPException(422,'Hãy nhập URL shop đối thủ khác với shop đang phân tích.')
        jid=str(uuid.uuid4())
        created_at = datetime.now()
        if payload.browser == 'chrome':
            result_token = uuid.uuid4().hex
            result_expires_at = (created_at + timedelta(minutes=5)).isoformat()
            c.execute('''INSERT INTO crawl_jobs
                (id,shop_id,target_url,role,status,created_at,browser,result_token,result_expires_at,error,read_details,detail_limit)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                (jid,payload.shop_id,url,payload.role,'running',created_at.isoformat(),'chrome',
                 result_token,result_expires_at,'Đang chờ Chrome đọc sản phẩm từ trang shop.',
                 int(payload.read_details),payload.detail_limit))
        else:
            c.execute('INSERT INTO crawl_jobs(id,shop_id,target_url,role,status,created_at) VALUES(?,?,?,?,?,?)',
                     (jid,payload.shop_id,url,payload.role,'queued',created_at.isoformat()))
    if payload.browser == 'chrome':
        return {'job_id':jid,'status':'running','target_url':url,'role':payload.role,
                'browser':'chrome','interactive':False,'result_token':result_token,
                'result_expires_at':result_expires_at,'read_details':payload.read_details,
                'detail_limit':payload.detail_limit}
    if payload.interactive:
        executor.submit(_process_crawl_job,jid,True)
    else:
        executor.submit(_process_crawl_job,jid)
    return {'job_id':jid,'status':'queued','target_url':url,'role':payload.role,
            'interactive':payload.interactive}


@app.post('/api/competitors/product-jobs', status_code=202)
def start_competitor_product(payload: CompetitorProductRequest):
    try:
        target = validate_shop_url(payload.target_url)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    sku = _product_url_identity(payload.product_url)
    if not sku:
        raise HTTPException(422, 'Hãy chọn liên kết sản phẩm Shopee công khai hợp lệ.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        _expire_chrome_jobs(c)
        shop = c.execute('SELECT * FROM shops WHERE id=?', (payload.shop_id,)).fetchone()
        if not shop or shop['is_demo']:
            raise HTTPException(404, 'Không tìm thấy shop riêng.')
        own = c.execute("SELECT * FROM observations WHERE shop_id=? AND role='own' AND sku=? "
                        'ORDER BY snapshot_date DESC,id DESC LIMIT 1',
                        (payload.shop_id, payload.own_sku)).fetchone()
        if not own:
            raise HTTPException(404, 'Không tìm thấy sản phẩm của shop để đối chiếu.')
        if target.lower() == shop['url'].lower():
            raise HTTPException(422, 'Hãy chọn shop đối thủ khác với shop đang phân tích.')
        own_urls = c.execute("SELECT sku,product_url FROM observations WHERE shop_id=? AND role='own'",
                             (payload.shop_id,)).fetchall()
        if any(sku == _product_url_identity(row['product_url']) or sku == row['sku'] for row in own_urls):
            raise HTTPException(422, 'Sản phẩm đã chọn thuộc shop đang phân tích, không phải đối thủ.')
        if c.execute("SELECT COUNT(*) FROM crawl_jobs WHERE status IN ('queued','running')").fetchone()[0] >= 3:
            raise HTTPException(429, 'Hàng đợi đang đủ 3 lượt, hãy thử lại sau.')
        job_id, token = str(uuid.uuid4()), uuid.uuid4().hex
        now = datetime.now()
        expires = (now + timedelta(minutes=5)).isoformat()
        c.execute('''INSERT INTO crawl_jobs
            (id,shop_id,target_url,role,status,created_at,browser,result_token,result_expires_at,
             error,read_details,detail_limit,detail_total)
            VALUES(?,?,?,'market','running',?,'chrome',?,?,?,1,1,1)''',
            (job_id, payload.shop_id, target, now.isoformat(), token, expires,
             'Đang đọc sản phẩm đối thủ để đối chiếu.'))
        c.execute('''INSERT INTO product_comparison_jobs(job_id,own_sku,product_url,query)
            VALUES(?,?,?,?)''', (job_id, payload.own_sku, payload.product_url, payload.query.strip()))
    return {'job_id':job_id, 'status':'running', 'browser':'chrome', 'role':'market',
            'result_token':token, 'result_expires_at':expires, 'target_url':target,
            'product_url':payload.product_url, 'own_sku':payload.own_sku, 'query':payload.query.strip()}


@app.post('/api/competitors/product-jobs/{job_id}/result')
def submit_competitor_product(job_id: str, payload: CompetitorProductResult):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        job = _require_chrome_result_job(c, job_id, payload.result_token)
        comparison = c.execute('SELECT * FROM product_comparison_jobs WHERE job_id=?', (job_id,)).fetchone()
        if not comparison:
            raise HTTPException(409, 'Lượt quét này không phải lượt đối chiếu sản phẩm.')
        now = datetime.now().isoformat()
        if payload.error:
            error = payload.error.strip()
            c.execute("""UPDATE crawl_jobs SET status='failed',error=?,completed_at=?,result_token='',
                detail_failed=1 WHERE id=?""", (error, now, job_id))
            return {'job_id':job_id, 'status':'failed', 'rows_imported':0,
                    'detail_completed':0, 'detail_failed':1, 'error':error}
        sku = _product_url_identity(comparison['product_url'])
        if _product_url_identity(payload.detail.url) != sku:
            raise HTTPException(422, 'Trang chi tiết không khớp sản phẩm đối thủ cần đọc.')
        source = urlparse(job['target_url']).path.strip('/')
        existing = next((dict(row) for row in c.execute(
            "SELECT * FROM observations WHERE shop_id=? AND role='market' AND sku=? "
            'ORDER BY snapshot_date DESC,id DESC', (job['shop_id'], sku))
            if norm(row['source_shop']) == norm(source)), None)
        fresh = existing or canonical_rows([{
            'sku':sku, 'source_shop':source, 'name':payload.detail.name,
            'category':'Chưa phân loại', 'product_url':payload.detail.url,
        }], 'market', source, '')[0]
        snapshot = date.today().isoformat()
        if existing and existing['snapshot_date'] != snapshot:
            # A new product-page read does not re-observe the older report's
            # monthly metrics, stock, views, or listing promotion.
            fresh.update(price=None, units_30d=None, revenue_30d=None, views_30d=None, stock=None)
        source = fresh['source_shop']
        detail = {**payload.detail.model_dump(), 'status':'done', 'collected_at':now, 'last_error':''}
        observed = enrich_product({**fresh, 'detail':detail, 'category':'Chưa phân loại',
                                   'rating':None, 'review_count':None, 'sold_total':None})
        fresh.update(name=payload.detail.name, product_url=payload.detail.url)
        for field in ('rating', 'review_count', 'sold_total'):
            fresh[field] = observed[field]
        if observed['category_path']:
            fresh['category'] = observed['category']
        # A detail page may select a different variant. Preserve an existing
        # listing price; a newly discovered product uses the displayed minimum.
        if fresh.get('price') is None:
            fresh['price'] = price_range(payload.detail.price_text)[0]
        insert_obs(c, job['shop_id'], 'market', [fresh], snapshot, 'chrome_product_comparison')
        c.execute('''INSERT INTO product_details
            (shop_id,role,source_shop,sku,status,detail_json,error,collected_at,last_attempt_at,last_error)
            VALUES(?,'market',?,?,'done',?,'',?,?,'')
            ON CONFLICT(shop_id,role,source_shop,sku) DO UPDATE SET
              status='done',detail_json=excluded.detail_json,error='',collected_at=excluded.collected_at,
              last_attempt_at=excluded.last_attempt_at,last_error='' ''',
            (job['shop_id'], source, sku, json.dumps(payload.detail.model_dump(), ensure_ascii=False), now, now))
        c.execute('''INSERT INTO product_comparison_links
            (shop_id,own_sku,source_shop,sku,query,product_url,collected_at) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(shop_id,own_sku,source_shop,sku) DO UPDATE SET
              query=excluded.query,product_url=excluded.product_url,collected_at=excluded.collected_at''',
            (job['shop_id'], comparison['own_sku'], source, sku, comparison['query'], payload.detail.url, now))
        c.execute('''INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date)
            VALUES(?,?,'market',1,?,?)''',
            (job['shop_id'], 'Chrome đối chiếu sản phẩm: ' + job['target_url'], now, snapshot))
        c.execute("""UPDATE crawl_jobs SET status='done',rows_imported=1,detail_completed=1,
            detail_failed=0,error='',completed_at=?,result_token='' WHERE id=?""", (now, job_id))
    return {'job_id':job_id, 'status':'done', 'rows_imported':1, 'detail_completed':1, 'detail_failed':0}


@app.get('/api/crawl/jobs')
def crawl_jobs(shop_id:str,all_rows:bool=False):
    with db() as c:
        _expire_chrome_jobs(c)
        return [_public_crawl_job(r) for r in c.execute('SELECT * FROM crawl_jobs WHERE shop_id=? ORDER BY created_at DESC' + ('' if all_rows else ' LIMIT 30'),(shop_id,))]


@app.post('/api/crawl/jobs/{job_id}/browser-result')
def submit_browser_crawl_result(job_id: str, payload: BrowserCrawlResult):
    with db() as c:
        # Serialize result acceptance so two callbacks cannot consume one token.
        c.execute('BEGIN IMMEDIATE')
        job = _require_chrome_result_job(c, job_id, payload.result_token)
        if c.execute('SELECT 1 FROM product_comparison_jobs WHERE job_id=?', (job_id,)).fetchone():
            raise HTTPException(409, 'Lượt đối chiếu sản phẩm chỉ nhận trang sản phẩm đã chọn.')
        if job['detail_total']:
            raise HTTPException(409, 'Danh sách đã lưu; lượt quét đang đọc chi tiết từng sản phẩm.')
        shop = c.execute('SELECT * FROM shops WHERE id=?', (job['shop_id'],)).fetchone()
        products = _products_from_browser_pages(payload.pages, job, shop)
        error = (payload.error or '').strip()
        if not products and not error:
            error = 'Chrome chưa đọc được sản phẩm hiển thị. Hãy mở đúng trang shop, chờ sản phẩm tải rồi quét lại.'
        completed_at = datetime.now().isoformat()
        if error:
            c.execute("""UPDATE crawl_jobs SET status='failed',error=?,completed_at=?,result_token=''
                WHERE id=?""", (error, completed_at, job_id))
            return {'job_id':job_id, 'status':'failed', 'rows_imported':0, 'error':error}
        snapshot_date = date.today().isoformat()
        # Repeated clicks replace this day's live Chrome capture, including
        # products no longer returned. Preserve older dates and other sources.
        c.execute('''DELETE FROM observations WHERE shop_id=? AND role=? AND source_shop=?
            AND snapshot_date=? AND data_origin='chrome_live_dom' ''',
            (job['shop_id'], job['role'], products[0]['source_shop'], snapshot_date))
        insert_obs(c, job['shop_id'], job['role'], products, snapshot_date, 'chrome_live_dom')
        c.execute('''INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date)
            VALUES(?,?,?,?,?,?)''',
            (job['shop_id'], 'Chrome trực tiếp: ' + job['target_url'], job['role'], len(products),
             completed_at, snapshot_date))
        if job['read_details']:
            detail_products = products[:job['detail_limit']]
            c.executemany('''INSERT INTO crawl_job_products(job_id,sku,source_shop,product_url,name)
                VALUES(?,?,?,?,?)''', [(job_id, product['sku'], product['source_shop'],
                                      product['product_url'], product['name']) for product in detail_products])
            expires_at = (datetime.now() + timedelta(minutes=5)).isoformat()
            c.execute('''UPDATE crawl_jobs SET rows_imported=?, detail_total=?,
                result_expires_at=?, error=? WHERE id=?''',
                (len(products), len(detail_products), expires_at,
                 f'Đã lưu {len(products)} sản phẩm; đang đọc chi tiết 0/{len(detail_products)}.', job_id))
            return {'job_id':job_id, 'status':'running', 'rows_imported':len(products),
                    'snapshot_date':snapshot_date, 'data_origin':'chrome_live_dom',
                    'detail_total':len(detail_products), 'detail_completed':0, 'detail_failed':0,
                    'details_sampled':len(detail_products)<len(products),
                    'products':[{key: product[key] for key in ('sku', 'product_url', 'name')}
                                for product in detail_products]}
        c.execute("""UPDATE crawl_jobs SET status='done',rows_imported=?,error='',completed_at=?,result_token=''
            WHERE id=?""", (len(products), completed_at, job_id))
    return {'job_id':job_id, 'status':'done', 'rows_imported':len(products),
            'snapshot_date':snapshot_date, 'data_origin':'chrome_live_dom'}


@app.post('/api/crawl/jobs/{job_id}/product-result')
def submit_product_detail(job_id: str, payload: BrowserProductResult):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        job = _require_chrome_result_job(c, job_id, payload.result_token)
        if not job['read_details'] or not job['detail_total']:
            raise HTTPException(409, 'Lượt quét chưa có danh sách để đọc chi tiết.')
        sku = _product_url_identity(payload.product_url)
        product = c.execute('SELECT * FROM crawl_job_products WHERE job_id=? AND sku=?',
                            (job_id, sku)).fetchone() if sku else None
        if not product:
            raise HTTPException(422, 'Sản phẩm không thuộc danh sách của lượt quét này.')
        if payload.detail and _product_url_identity(payload.detail.url) != sku:
            raise HTTPException(422, 'Trang chi tiết không khớp sản phẩm cần đọc.')
        now = datetime.now().isoformat()
        error = (payload.error or '').strip()
        status = 'failed' if error else 'done'
        key = (job['shop_id'], job['role'], product['source_shop'], sku)
        if payload.detail:
            encoded_detail = json.dumps(payload.detail.model_dump(), ensure_ascii=False)
            c.execute('''INSERT INTO product_details
                (shop_id,role,source_shop,sku,status,detail_json,error,collected_at,last_attempt_at,last_error)
                VALUES(?,?,?,?,?,?,?, ?,?,?)
                ON CONFLICT(shop_id,role,source_shop,sku) DO UPDATE SET
                status='done',detail_json=excluded.detail_json,error='',collected_at=excluded.collected_at,
                last_attempt_at=excluded.last_attempt_at,last_error='' ''',
                (*key, 'done', encoded_detail, '', now, now, ''))
        else:
            # A blocked or unavailable page must not erase a prior successful capture.
            c.execute('''INSERT INTO product_details
                (shop_id,role,source_shop,sku,status,error,last_attempt_at,last_error)
                VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(shop_id,role,source_shop,sku) DO UPDATE SET
                last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error,
                error=CASE WHEN product_details.status='done' THEN '' ELSE excluded.error END''',
                (*key, 'failed', error, now, error))
        c.execute('''UPDATE crawl_job_products SET status=?,error=?,completed_at=?
            WHERE job_id=? AND sku=?''', (status, error, now, job_id, sku))
        progress = c.execute('''SELECT
            SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS detail_completed,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS detail_failed
            FROM crawl_job_products WHERE job_id=?''', (job_id,)).fetchone()
        completed, failed = progress['detail_completed'], progress['detail_failed']
        attempted = completed + failed
        note = f'Đã đọc chi tiết {attempted}/{job["detail_total"]} sản phẩm ({completed} thành công, {failed} lỗi).'
        expires_at = (datetime.now() + timedelta(minutes=5)).isoformat()
        c.execute('''UPDATE crawl_jobs SET detail_completed=?,detail_failed=?,error=?,result_expires_at=?
            WHERE id=?''', (completed, failed, note, expires_at, job_id))
        return {'job_id':job_id, 'status':'running', 'rows_imported':job['rows_imported'],
                'detail_total':job['detail_total'], 'detail_completed':completed,
                'detail_failed':failed, 'error':note}


@app.post('/api/crawl/jobs/{job_id}/finish-details')
def finish_product_details(job_id: str, payload: FinishProductDetails):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        job = _require_chrome_result_job(c, job_id, payload.result_token)
        if not job['read_details'] or not job['detail_total']:
            raise HTTPException(409, 'Lượt quét chưa có danh sách để đọc chi tiết.')
        error = (payload.error or '').strip()
        attempted = job['detail_completed'] + job['detail_failed']
        if attempted < job['detail_total'] and not error:
            raise HTTPException(409, 'Chưa đọc hết chi tiết sản phẩm của lượt quét.')
        partial = bool(error or job['detail_failed'] or attempted < job['detail_total'])
        note = ''
        if partial:
            note = (f'Đã lưu danh sách {job["rows_imported"]} sản phẩm và chi tiết '
                    f'{job["detail_completed"]}/{job["detail_total"]}; {job["detail_failed"]} lỗi.')
            top = c.execute('''SELECT error,COUNT(*) n FROM crawl_job_products
                WHERE job_id=? AND status='failed' AND error<>'' GROUP BY error ORDER BY n DESC LIMIT 1''',
                (job_id,)).fetchone()
            if top:
                note += f' Lỗi phổ biến ({top["n"]} sản phẩm): {top["error"][:200]}'
            if error:
                note += ' ' + error
        c.execute('''UPDATE crawl_jobs SET status='done',error=?,completed_at=?,result_token=''
            WHERE id=?''', (note, datetime.now().isoformat(), job_id))
        return {'job_id':job_id, 'status':'done', 'rows_imported':job['rows_imported'],
                **_detail_progress(job), 'partial':partial, 'error':note,
                'details_sampled':job['detail_total']<job['rows_imported']}


@app.get('/api/crawl/jobs/{job_id}')
def crawl_job(job_id:str):
    with db() as c:
        _expire_chrome_jobs(c)
        found=c.execute('SELECT * FROM crawl_jobs WHERE id=?',(job_id,)).fetchone()
    if not found: raise HTTPException(404,'Không tìm thấy lượt crawl')
    return _public_crawl_job(found)


class CrawlScheduleRequest(BaseModel):
    shop_id: str
    target_url: str
    role: str = 'market'
    interval_hours: int = 24
    enabled: bool = True


@app.post('/api/crawl/schedules')
def save_crawl_schedule(payload:CrawlScheduleRequest):
    if not 24 <= payload.interval_hours <= 720:
        raise HTTPException(422,'Lịch tối thiểu 24 giờ/lượt, tối đa 30 ngày/lượt.')
    if payload.role not in ('own','market'): raise HTTPException(422,'role không hợp lệ')
    try: target=validate_shop_url(payload.target_url)
    except ValueError as e: raise HTTPException(422,str(e))
    with db() as c:
        shop=c.execute('SELECT * FROM shops WHERE id=?',(payload.shop_id,)).fetchone()
        if not shop or shop['is_demo']: raise HTTPException(404,'Không tìm thấy shop')
        if payload.role=='own' and target!=shop['url']:
            raise HTTPException(422,'Dữ liệu own phải thuộc về shop đã chọn')
        if payload.role=='market' and target.lower()==shop['url'].lower():
            raise HTTPException(422,'Hãy nhập URL shop đối thủ khác với shop đang phân tích.')
        # One target per 24 hours or slower.
        next_run=(datetime.now()+timedelta(hours=payload.interval_hours)).isoformat()
        c.execute('''INSERT INTO crawl_targets(shop_id,target_url,role,interval_hours,enabled,next_run_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(shop_id,target_url,role) DO UPDATE SET
            interval_hours=excluded.interval_hours,enabled=excluded.enabled,next_run_at=excluded.next_run_at''',
            (payload.shop_id,target,payload.role,payload.interval_hours,int(payload.enabled),next_run))
        row=c.execute('SELECT * FROM crawl_targets WHERE shop_id=? AND target_url=? AND role=?',
                      (payload.shop_id,target,payload.role)).fetchone()
    return dict(row)


@app.get('/api/crawl/schedules')
def list_crawl_schedules(shop_id:str):
    with db() as c:
        return [dict(r) for r in c.execute('SELECT * FROM crawl_targets WHERE shop_id=? ORDER BY id DESC',(shop_id,))]


@app.delete('/api/crawl/schedules/{schedule_id}')
def delete_crawl_schedule(schedule_id:int,shop_id:str):
    with db() as c:
        changed=c.execute('DELETE FROM crawl_targets WHERE id=? AND shop_id=?',(schedule_id,shop_id))
        if not changed.rowcount: raise HTTPException(404,'Không tìm thấy lịch này')
    return {'ok':True}


scheduler_stop=Event()
_scheduler_thread=None

def scheduler_tick():
    if not crawler_enabled(): return
    now=datetime.now().isoformat()
    submit_after_commit=[]
    with db() as c:
        _expire_chrome_jobs(c)
        pending=c.execute('''SELECT * FROM crawl_targets WHERE enabled=1 AND next_run_at<=?
                             ORDER BY next_run_at LIMIT 3''',(now,)).fetchall()
        for r in pending:
            busy=c.execute("SELECT 1 FROM crawl_jobs WHERE status IN ('running','queued') LIMIT 1").fetchone()
            if busy: break
            job_id=str(uuid.uuid4())
            c.execute('INSERT INTO crawl_jobs(id,shop_id,target_url,role,status,created_at) VALUES(?,?,?,?,?,?)',
                     (job_id,r['shop_id'],r['target_url'],r['role'],'queued',now))
            c.execute('UPDATE crawl_targets SET last_run_at=?,next_run_at=? WHERE id=?',
                     (now,(datetime.now()+timedelta(hours=r['interval_hours'])).isoformat(),r['id']))
            submit_after_commit.append(job_id)
    # Submit only after commit, or a fast worker can miss the newly created row.
    for jid in submit_after_commit:
        executor.submit(_process_crawl_job,jid)


def scheduler_loop():
    # Local single-process MVP only. Use a distributed queue in production.
    while not scheduler_stop.wait(60):
        try: scheduler_tick()
        except (sqlite3.Error, pgcompat.Error): pass


def start_local_scheduler():
    global _scheduler_thread
    if not crawler_enabled(): return
    if _scheduler_thread is None or not _scheduler_thread.is_alive():
        scheduler_stop.clear()
        _scheduler_thread=Thread(target=scheduler_loop,name='marketlens-scheduler',daemon=True)
        _scheduler_thread.start()


# Optional push connector for integrations that have obtained platform/data-owner permission.
# This endpoint NEVER fetches Shopee and is disabled unless MARKET_INGEST_KEY is configured.
class AuthorizedBatch(BaseModel):
    shop_id: str
    role: str
    snapshot_date: str
    products: list[dict]


@app.post('/api/integrations/push')
def ingest_authorized(payload: AuthorizedBatch, x_ingest_key: str | None = __import__('fastapi').Header(default=None)):
    import hmac
    expected = os.environ.get('MARKET_INGEST_KEY')
    if not expected:
        raise HTTPException(503,'Kênh đẩy dữ liệu chưa được cấu hình')
    if not x_ingest_key or not hmac.compare_digest(expected,x_ingest_key):
        raise HTTPException(401,'Khóa tích hợp không hợp lệ')
    if payload.role not in ('own','market') or not 1 <= len(payload.products) <= 5000:
        raise HTTPException(422,'role hoặc số lượng sản phẩm không hợp lệ (1–5000)')
    try: date.fromisoformat(payload.snapshot_date)
    except ValueError: raise HTTPException(422,'Ngày snapshot không hợp lệ')
    with db() as c:
        shop=c.execute('SELECT * FROM shops WHERE id=?',(payload.shop_id,)).fetchone()
        if not shop or shop['is_demo']: raise HTTPException(404,'Shop tích hợp không tồn tại')
        items=canonical_rows(payload.products,payload.role,shop['name'],shop['category'])
        if not items: raise HTTPException(422,'Thiếu tên sản phẩm')
        insert_obs(c,payload.shop_id,payload.role,items,payload.snapshot_date,'authorized_connector')
        c.execute('INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date) VALUES(?,?,?,?,?,?)',
                 (payload.shop_id,'authorized-connector',payload.role,len(items),datetime.now().isoformat(),payload.snapshot_date))
        return {'ok':True,'imported':len(items)}

# Separate market-wide dataset: never mixes synthetic shop data into ML exports.
from category_market import install as install_category_market
category_schedule_tick = install_category_market(app, db, BrowserProductDetail, _product_url_identity)

from seller_workspace import install as install_seller_workspace
seller_report_tick = install_seller_workspace(app, db, report)
from listing_clone import install as install_listing_clone
install_listing_clone(app, db)
