"""Copy products collected from other shops into editable listing drafts.

A draft is built from what MarketLens already stored for a product (observation +
detail read by the Chrome extension): name, description, images, attributes,
variants.  Drafts can be exported as a Mass Upload style spreadsheet or sent to the
Chrome extension, which fills Shopee's "add product" form in the user's own Seller Centre.
"""
import io
import json
import re
import unicodedata
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from pydantic import BaseModel, ConfigDict, Field

MAX_IMAGES = 9
MAX_DRAFTS_PER_REQUEST = 50
IMAGE_HOST = re.compile(r'^https://[a-z0-9.-]+\.(?:susercontent\.com|shopee\.(?:vn|sg)|shopeemobile\.com)/', re.I)


def _norm(value):
    text = unicodedata.normalize('NFKD', str(value or '').replace('đ', 'd').replace('Đ', 'D'))
    text = ''.join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r'[^a-z0-9]+', '_', text).strip('_')


class SourceRef(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_shop: str = Field(min_length=1, max_length=300)
    sku: str = Field(min_length=1, max_length=200)


class DraftCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    shop_id: str
    items: list[SourceRef] = Field(min_length=1, max_length=MAX_DRAFTS_PER_REQUEST)
    markup_pct: float = Field(default=0, ge=-90, le=500)


class DraftUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = Field(default=None, max_length=300)
    price: float | None = Field(default=None, ge=0, le=1_000_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    weight_g: int | None = Field(default=None, ge=0, le=1_000_000)
    images: list[str] | None = Field(default=None, max_length=MAX_IMAGES)
    attributes: list[dict] | None = Field(default=None, max_length=50)
    variants: list[dict] | None = Field(default=None, max_length=10)
    status: str | None = Field(default=None, pattern='^(draft|ready|posted)$')


def _clean_images(values):
    seen, out = set(), []
    for value in values or []:
        value = str(value or '').strip()
        if IMAGE_HOST.match(value) and value not in seen:
            seen.add(value)
            out.append(value)
        if len(out) >= MAX_IMAGES:
            break
    return out


def _clean_pairs(values, keys):
    out = []
    for item in values or []:
        if isinstance(item, dict):
            row = {key: item.get(key) for key in keys}
            if all(value not in (None, '', []) for value in row.values()):
                out.append(row)
    return out


def _clean_variants(values):
    out = []
    for item in values or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get('name') or '').strip()[:120]
        options = [str(option).strip()[:200] for option in item.get('options') or [] if str(option).strip()][:50]
        if name and options:
            out.append({'name': name, 'options': options})
    return out


def draft_dict(row):
    data = dict(row)
    for key in ('images', 'attributes', 'variants'):
        data[key] = json.loads(data.pop(key + '_json') or '[]')
    return data


def install(app, db):
    router = APIRouter(prefix='/api/listings')
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS listing_drafts(
          id TEXT PRIMARY KEY,shop_id TEXT NOT NULL REFERENCES shops(id),
          source_role TEXT NOT NULL DEFAULT 'market',source_shop TEXT NOT NULL,source_sku TEXT NOT NULL,
          source_url TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',price REAL,stock INTEGER NOT NULL DEFAULT 0,
          weight_g INTEGER NOT NULL DEFAULT 0,images_json TEXT NOT NULL DEFAULT '[]',
          attributes_json TEXT NOT NULL DEFAULT '[]',variants_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
          UNIQUE(shop_id,source_role,source_shop,source_sku));
        CREATE INDEX IF NOT EXISTS idx_listing_drafts_shop ON listing_drafts(shop_id,created_at);
        ''')

    def require_shop(c, shop_id):
        if not c.execute('SELECT 1 FROM shops WHERE id=?', (shop_id,)).fetchone():
            raise HTTPException(404, 'Không tìm thấy shop')

    def latest_observation(c, shop_id, source_shop, sku):
        for row in c.execute('''SELECT * FROM observations WHERE shop_id=? AND role='market' AND sku=?
                                ORDER BY snapshot_date DESC,id DESC''', (shop_id, sku)):
            if _norm(row['source_shop']) == _norm(source_shop):
                return row
        return None

    def detail_for(c, shop_id, source_shop, sku):
        for row in c.execute("SELECT * FROM product_details WHERE shop_id=? AND role='market' AND sku=?", (shop_id, sku)):
            if _norm(row['source_shop']) == _norm(source_shop):
                try:
                    return json.loads(row['detail_json'] or '{}') if row['status'] == 'done' else {}
                except ValueError:
                    return {}
        return {}

    @router.get('/sources')
    def sources(shop_id: str, q: str = '', limit: int = 200):
        """Products of other shops that can be copied (latest observation each)."""
        limit = max(1, min(limit, 500))
        needle = _norm(q)
        with db() as c:
            require_shop(c, shop_id)
            latest = {}
            for row in c.execute("SELECT * FROM observations WHERE shop_id=? AND role='market' ORDER BY snapshot_date ASC,id ASC", (shop_id,)):
                latest[(_norm(row['source_shop']), row['sku'])] = row
            details = {}
            for row in c.execute("SELECT * FROM product_details WHERE shop_id=? AND role='market'", (shop_id,)):
                details[(_norm(row['source_shop']), row['sku'])] = row['status']
            drafted = {(_norm(row['source_shop']), row['source_sku']): row['id'] for row in c.execute(
                "SELECT id,source_shop,source_sku FROM listing_drafts WHERE shop_id=?", (shop_id,))}
        rows = []
        for key, row in latest.items():
            if needle and needle not in _norm(row['name']) and needle not in key[0]:
                continue
            rows.append({'source_shop': row['source_shop'], 'sku': row['sku'], 'name': row['name'], 'price': row['price'],
                         'sold_total': row['sold_total'], 'product_url': row['product_url'],
                         'has_detail': details.get(key) == 'done', 'draft_id': drafted.get(key)})
        rows.sort(key=lambda item: (item['sold_total'] or 0), reverse=True)
        return rows[:limit]

    @router.get('/drafts')
    def list_drafts(shop_id: str):
        with db() as c:
            require_shop(c, shop_id)
            return [draft_dict(row) for row in c.execute(
                'SELECT * FROM listing_drafts WHERE shop_id=? ORDER BY created_at DESC,id', (shop_id,))]

    @router.post('/drafts')
    def create_drafts(payload: DraftCreate):
        now = datetime.now().isoformat()
        created, skipped = [], []
        with db() as c:
            require_shop(c, payload.shop_id)
            for item in payload.items:
                observation = latest_observation(c, payload.shop_id, item.source_shop, item.sku)
                if observation is None:
                    skipped.append({'sku': item.sku, 'reason': 'Không tìm thấy sản phẩm trong dữ liệu đã thu thập.'})
                    continue
                existing = c.execute('SELECT id FROM listing_drafts WHERE shop_id=? AND source_role=? AND source_shop=? AND source_sku=?',
                                     (payload.shop_id, 'market', observation['source_shop'], item.sku)).fetchone()
                if existing:
                    skipped.append({'sku': item.sku, 'reason': 'Đã có bản nháp.', 'draft_id': existing['id']})
                    continue
                detail = detail_for(c, payload.shop_id, observation['source_shop'], item.sku)
                price = observation['price']
                if price is not None:
                    price = round(price * (1 + payload.markup_pct / 100))
                draft_id = str(uuid.uuid4())
                categories = detail.get('categories') or []
                c.execute('''INSERT INTO listing_drafts(id,shop_id,source_role,source_shop,source_sku,source_url,name,description,
                    category,price,stock,weight_g,images_json,attributes_json,variants_json,status,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                          (draft_id, payload.shop_id, 'market', observation['source_shop'], item.sku,
                           observation['product_url'] or detail.get('url') or '',
                           (detail.get('name') or observation['name'])[:120], str(detail.get('description') or '')[:5000],
                           ' > '.join(str(value) for value in categories) or (observation['category'] or ''),
                           price, 0, 0, json.dumps(_clean_images(detail.get('images'))),
                           json.dumps(_clean_pairs(detail.get('attributes'), ('name', 'value'))),
                           json.dumps(_clean_variants(detail.get('variants'))), 'draft', now, now))
                created.append(draft_id)
            rows = [draft_dict(c.execute('SELECT * FROM listing_drafts WHERE id=?', (draft_id,)).fetchone()) for draft_id in created]
        return {'created': rows, 'skipped': skipped}

    def get_draft(c, shop_id, draft_id):
        row = c.execute('SELECT * FROM listing_drafts WHERE id=? AND shop_id=?', (draft_id, shop_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Không tìm thấy bản nháp.')
        return row

    @router.put('/drafts/{draft_id}')
    def update_draft(draft_id: str, shop_id: str, payload: DraftUpdate):
        changes = payload.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(422, 'Không có thay đổi nào.')
        columns, values = [], []
        for key, value in changes.items():
            if key == 'images':
                value = json.dumps(_clean_images(value)); key = 'images_json'
            elif key == 'attributes':
                value = json.dumps(_clean_pairs(value, ('name', 'value'))); key = 'attributes_json'
            elif key == 'variants':
                value = json.dumps(_clean_variants(value)); key = 'variants_json'
            elif value is None and key in ('name', 'description', 'category', 'stock', 'weight_g', 'status'):
                raise HTTPException(422, f'Trường {key} không được để trống.')
            columns.append(f'{key}=?')
            values.append(value)
        with db() as c:
            get_draft(c, shop_id, draft_id)
            c.execute(f'UPDATE listing_drafts SET {",".join(columns)},updated_at=? WHERE id=? AND shop_id=?',
                      (*values, datetime.now().isoformat(), draft_id, shop_id))
            return draft_dict(get_draft(c, shop_id, draft_id))

    @router.delete('/drafts/{draft_id}')
    def delete_draft(draft_id: str, shop_id: str):
        with db() as c:
            get_draft(c, shop_id, draft_id)
            c.execute('DELETE FROM listing_drafts WHERE id=? AND shop_id=?', (draft_id, shop_id))
        return {'deleted': draft_id}

    @router.get('/export')
    def export(shop_id: str, ids: str = ''):
        wanted = [value for value in ids.split(',') if value]
        with db() as c:
            require_shop(c, shop_id)
            rows = [draft_dict(row) for row in c.execute(
                'SELECT * FROM listing_drafts WHERE shop_id=? ORDER BY created_at DESC,id', (shop_id,))]
        if wanted:
            rows = [row for row in rows if row['id'] in set(wanted)]
        if not rows:
            raise HTTPException(404, 'Chưa có bản nháp nào để xuất.')
        return Response(build_workbook(rows), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="marketlens-listing-drafts.xlsx"'})

    app.include_router(router)


def variant_rows(draft):
    """One spreadsheet row per variant combination (first two groups), or one row when there are none."""
    groups = draft['variants'][:2]
    if not groups:
        return [('', '', '', '')]
    first = groups[0]
    second = groups[1] if len(groups) > 1 else None
    rows = []
    for option in first['options']:
        if second:
            rows.extend((first['name'], option, second['name'], other) for other in second['options'])
        else:
            rows.append((first['name'], option, '', ''))
    return rows


HEADERS = ['Ngành hàng', 'Tên sản phẩm', 'Mô tả sản phẩm', 'SKU sản phẩm', 'Tên nhóm phân loại 1', 'Phân loại hàng 1',
           'Tên nhóm phân loại 2', 'Phân loại hàng 2', 'Giá (VND)', 'Kho hàng', 'Cân nặng (g)', 'Ảnh bìa'] + \
          [f'Hình ảnh sản phẩm {n}' for n in range(1, 9)] + ['Thuộc tính', 'Link sản phẩm gốc']


def build_workbook(drafts):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Sản phẩm'
    ws.append(HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='EE4D2D')
    for draft in drafts:
        images = draft['images']
        attributes = '; '.join(f"{item['name']}: {item['value']}" for item in draft['attributes'])
        for g1, o1, g2, o2 in variant_rows(draft):
            ws.append([draft['category'], draft['name'], draft['description'], f"ML-{draft['source_sku']}"[:100], g1, o1, g2, o2,
                       draft['price'], draft['stock'], draft['weight_g'] or None, images[0] if images else '',
                       *[(images[n] if len(images) > n else '') for n in range(1, 9)], attributes, draft['source_url']])
    for column, width in zip('ABCDEFGHIJKL', (28, 40, 60, 18, 18, 18, 18, 18, 14, 10, 12, 50)):
        ws.column_dimensions[column].width = width
    guide = wb.create_sheet('Hướng dẫn')
    for line in ('Tệp này là bảng dữ liệu để đăng sản phẩm lên Kênh Người Bán (banhang.shopee.vn).',
                 'Shopee dùng mẫu Đăng hàng loạt khác nhau theo ngành hàng: vào Sản phẩm > Thêm nhiều sản phẩm, tải mẫu của ngành hàng, rồi sao chép các cột tương ứng từ sheet "Sản phẩm" sang mẫu đó.',
                 'Kiểm tra lại ngành hàng, thuộc tính bắt buộc, cân nặng, kích thước và giá trước khi tải lên.',
                 'Ảnh và mô tả lấy từ shop khác: chỉ đăng khi bạn có quyền sử dụng; nội dung của người khác có thể bị báo vi phạm sở hữu trí tuệ.'):
        guide.append([line])
    guide.column_dimensions['A'].width = 140
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
