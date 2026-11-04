import importlib
import io
import json

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

import test_auth as auth_tests

IMG = 'https://down-vn.img.susercontent.com/file/abc123'


def seed_source(app, shop_id, with_detail=True):
    with app.db() as c:
        c.execute('''INSERT INTO observations(shop_id,role,source_shop,sku,name,category,price,sold_total,product_url,snapshot_date)
                     VALUES(?,?,?,?,?,?,?,?,?,?)''',
                  (shop_id, 'market', 'Shop Đối Thủ', '55.1', 'Hộp đựng cơm 3 ngăn', 'Nhà cửa', 100000, 900,
                   'https://shopee.vn/product/55/1', '2026-10-15'))
        if with_detail:
            detail = {'name': 'Hộp đựng cơm 3 ngăn cao cấp', 'description': 'Mô tả gốc\nDòng 2', 'images': [IMG, 'https://evil.example/x.jpg', IMG], 'description_images': [IMG.replace('1', '2'), 'https://evil.example/y.jpg'], 'video': 'https://down-vn.vod.susercontent.com/v/clip.mp4',
                      'attributes': [{'name': 'Chất liệu', 'value': 'Nhựa PP'}], 'categories': ['Nhà cửa', 'Hộp'],
                      'variants': [{'name': 'Màu', 'options': ['Đỏ', 'Xanh']}, {'name': 'Size', 'options': ['S', 'L']}]}
            c.execute('''INSERT INTO product_details(shop_id,role,source_shop,sku,status,detail_json,collected_at,last_attempt_at)
                         VALUES(?,?,?,?,?,?,?,?)''', (shop_id, 'market', 'Shop Đối Thủ', '55.1', 'done', json.dumps(detail),
                                                      '2026-10-15', '2026-10-15'))


@pytest.fixture
def auth_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'listing.db'))
    import app
    return importlib.reload(app)


@pytest.fixture
def clone(auth_app):
    system, _ = auth_tests.bootstrap(auth_app)
    shop = system.post('/api/shops', json={'url': 'https://shopee.vn/my_own_shop'}).json()
    seed_source(auth_app, shop['id'])
    return auth_app, system, shop


def create(client, shop_id, **extra):
    return client.post('/api/listings/drafts', json={'shop_id': shop_id, 'items': [{'source_shop': 'shop doi thu', 'sku': '55.1'}], **extra})


def test_draft_copies_images_description_attributes_and_variants_and_drops_foreign_images(clone):
    _, client, shop = clone
    source = client.get('/api/listings/sources', params={'shop_id': shop['id']}).json()[0]
    assert source['has_detail'] is True
    assert source['coverage'] == {'images': 3, 'description_images': 2, 'variants': 2, 'attributes': 1, 'video': True, 'brand': False, 'category': True, 'description': True}
    result = create(client, shop['id'], markup_pct=10)
    assert result.status_code == 200, result.text
    draft = result.json()['created'][0]
    assert draft['name'] == 'Hộp đựng cơm 3 ngăn cao cấp' and draft['description'] == 'Mô tả gốc\nDòng 2'
    assert draft['images'] == [IMG] and draft['price'] == 110000
    assert draft['category'] == 'Nhà cửa > Hộp' and draft['attributes'] == [{'name': 'Chất liệu', 'value': 'Nhựa PP'}]
    assert len(draft['variants']) == 2
    again = create(client, shop['id']).json()
    assert again['created'] == [] and again['skipped'][0]['draft_id'] == draft['id']
    assert client.get('/api/listings/sources', params={'shop_id': shop['id']}).json()[0]['draft_id'] == draft['id']


def test_unknown_source_is_skipped_and_edit_delete_work(clone):
    _, client, shop = clone
    missing = client.post('/api/listings/drafts', json={'shop_id': shop['id'], 'items': [{'source_shop': 'x', 'sku': '1'}]}).json()
    assert missing['created'] == [] and missing['skipped']
    draft = create(client, shop['id']).json()['created'][0]
    updated = client.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']},
                         json={'name': 'Tên mới', 'price': 123000, 'stock': 7, 'status': 'ready', 'images': [IMG, 'http://bad/x.png']})
    assert updated.status_code == 200 and updated.json()['name'] == 'Tên mới' and updated.json()['images'] == [IMG]
    assert client.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']}, json={'name': None}).status_code == 422
    assert client.delete(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']}).status_code == 200
    assert client.get('/api/listings/drafts', params={'shop_id': shop['id']}).json() == []


def test_export_has_one_row_per_variant_combination(clone):
    _, client, shop = clone
    create(client, shop['id'])
    response = client.get('/api/listings/export', params={'shop_id': shop['id']})
    assert response.status_code == 200
    rows = list(load_workbook(io.BytesIO(response.content))['Sản phẩm'].iter_rows(values_only=True))
    assert len(rows) == 1 + 4 and rows[1][1] == 'Hộp đựng cơm 3 ngăn cao cấp' and rows[1][11] == IMG
    assert {(row[5], row[7]) for row in rows[1:]} == {('Đỏ', 'S'), ('Đỏ', 'L'), ('Xanh', 'S'), ('Xanh', 'L')}


def test_user_can_only_use_drafts_of_assigned_shops(clone):
    app, system, shop = clone
    other = system.post('/api/shops', json={'url': 'https://shopee.vn/not_assigned'}).json()
    response = system.post('/api/auth/accounts', json={'username': 'clone-user', 'password': auth_tests.USER_PASSWORD, 'shop_ids': [shop['id']]})
    assert response.status_code == 200
    user = auth_tests.login(app, 'clone-user', auth_tests.USER_PASSWORD)
    assert create(user, shop['id']).status_code == 200
    assert create(user, other['id']).status_code == 403
    assert user.get('/api/listings/drafts', params={'shop_id': other['id']}).status_code == 403
    assert user.get('/api/listings/export', params={'shop_id': other['id']}).status_code == 403
    draft = user.get('/api/listings/drafts', params={'shop_id': shop['id']}).json()[0]
    assert user.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': other['id']}, json={'name': 'x'}).status_code == 403
    assert user.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']}, json={'name': 'ok'}).status_code == 200


def test_source_search_matches_each_word_of_name_or_shop_without_matching_inside_words(clone):
    _, client, shop = clone
    search = lambda q: client.get('/api/listings/sources', params={'shop_id': shop['id'], 'q': q}).json()
    assert len(search('hop com')) == 1 and len(search('HỘP')) == 1
    assert search('hop') and search('doi thu') and not search('xyz')
    with clone[0].db() as c:  # "hop" must not match the "shop" inside the shop name
        c.execute('''INSERT INTO observations(shop_id,role,source_shop,sku,name,category,price,sold_total,product_url,snapshot_date)
                     VALUES(?,?,?,?,?,?,?,?,?,?)''', (shop['id'], 'market', 'Shop ABC', '9', 'Kệ sách', '', 1, 1, '', '2026-10-15'))
    assert [row['name'] for row in search('hop')] == ['Hộp đựng cơm 3 ngăn']


def test_bulk_edit_applies_price_text_attribute_and_status_changes_to_selected_drafts_only(clone):
    app, client, shop = clone
    first = create(client, shop['id']).json()['created'][0]
    with app.db() as c:
        c.execute('''INSERT INTO observations(shop_id,role,source_shop,sku,name,category,price,sold_total,product_url,snapshot_date)
                     VALUES(?,?,?,?,?,?,?,?,?,?)''', (shop['id'], 'market', 'Shop Đối Thủ', '56.1', 'Bình nước', '', 50000, 1, '', '2026-10-15'))
    second = client.post('/api/listings/drafts', json={'shop_id': shop['id'], 'items': [{'source_shop': 'Shop Đối Thủ', 'sku': '56.1'}]}).json()['created'][0]
    bulk = lambda **body: client.post('/api/listings/drafts/bulk', json={'shop_id': shop['id'], **body})
    result = bulk(ids=[first['id']], price_mode='markup_pct', price_value=20, stock=9, weight_g=250, category='Nhà cửa > Bếp',
                  status='ready', name_prefix='[HOT] ', name_find='cao cấp', name_replace='PRO', description_append='\nFreeship',
                  attribute_name='Xuất xứ', attribute_value='Việt Nam')
    assert result.status_code == 200 and result.json()['updated'] == 1, result.text
    drafts = {row['id']: row for row in client.get('/api/listings/drafts', params={'shop_id': shop['id']}).json()}
    one, two = drafts[first['id']], drafts[second['id']]
    assert one['price'] == 120000 and one['stock'] == 9 and one['weight_g'] == 250 and one['status'] == 'ready'
    assert one['name'] == '[HOT] Hộp đựng cơm 3 ngăn PRO' and one['description'].endswith('\nFreeship')
    assert {'name': 'Xuất xứ', 'value': 'Việt Nam'} in one['attributes'] and one['category'] == 'Nhà cửa > Bếp'
    assert two['price'] == 50000 and two['stock'] == 100 and two['status'] == 'draft'
    assert bulk(all=True, price_mode='add', price_value=-1000).json()['updated'] == 2
    assert bulk(all=True, price_mode='set', price_value=77000).status_code == 200
    again = {row['id']: row for row in client.get('/api/listings/drafts', params={'shop_id': shop['id']}).json()}
    assert again[first['id']]['price'] == again[second['id']]['price'] == 77000
    assert bulk(ids=[]).status_code == 422 and bulk(all=True, price_mode='set').status_code == 422
    assert bulk(all=True, attribute_name='x').status_code == 422
    assert bulk(ids=[second['id']], delete=True).json()['deleted'] == 1
    assert [row['id'] for row in client.get('/api/listings/drafts', params={'shop_id': shop['id']}).json()] == [first['id']]


def test_user_bulk_edit_is_limited_to_assigned_shop(clone):
    app, system, shop = clone
    other = system.post('/api/shops', json={'url': 'https://shopee.vn/not_assigned_bulk'}).json()
    system.post('/api/auth/accounts', json={'username': 'bulk-user', 'password': auth_tests.USER_PASSWORD, 'shop_ids': [shop['id']]})
    user = auth_tests.login(app, 'bulk-user', auth_tests.USER_PASSWORD)
    create(user, shop['id'])
    assert user.post('/api/listings/drafts/bulk', json={'shop_id': other['id'], 'all': True, 'stock': 1}).status_code == 403
    assert user.post('/api/listings/drafts/bulk', json={'shop_id': shop['id'], 'all': True, 'stock': 1}).status_code == 200


def test_tiktok_export_uses_kilograms_and_its_own_guide(clone):
    _, client, shop = clone
    draft = create(client, shop['id']).json()['created'][0]
    client.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']}, json={'weight_g': 450, 'stock': 3})
    response = client.get('/api/listings/export', params={'shop_id': shop['id'], 'platform': 'tiktok'})
    assert response.status_code == 200 and 'tiktok' in response.headers['content-disposition']
    book = load_workbook(io.BytesIO(response.content))
    rows = list(book['Sản phẩm'].iter_rows(values_only=True))
    assert rows[0][10] == 'Cân nặng (kg)' and rows[1][10] == 0.45 and rows[1][9] == 3
    assert 'TikTok Shop' in book['Hướng dẫn']['A1'].value
    assert client.get('/api/listings/export', params={'shop_id': shop['id'], 'platform': 'other'}).status_code == 422


def test_delete_sources_removes_scan_data_but_keeps_drafts_and_user_scoping(clone):
    _, client, shop = clone
    draft = create(client, shop['id']).json()['created'][0]
    assert draft['desc_images'] == [IMG.replace('1', '2')]
    assert draft['video'] == 'https://down-vn.vod.susercontent.com/v/clip.mp4'
    cleared = client.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']}, json={'video': 'https://evil.example/v.mp4'}).json()
    assert cleared['video'] == ''
    result = client.post('/api/listings/sources/delete', json={'shop_id': shop['id'], 'items': [{'source_shop': 'shop doi thu', 'sku': '55.1'}]})
    assert result.json() == {'deleted': 1}
    assert client.get('/api/listings/sources', params={'shop_id': shop['id']}).json() == []
    assert len(client.get('/api/listings/drafts', params={'shop_id': shop['id']}).json()) == 1


def test_overwrite_refreshes_scanned_content_but_keeps_seller_edits(clone):
    auth_app, client, shop = clone
    draft = create(client, shop['id']).json()['created'][0]
    client.put(f"/api/listings/drafts/{draft['id']}", params={'shop_id': shop['id']}, json={'price': 123456, 'stock': 7, 'name': 'Tên tự sửa'})
    with auth_app.db() as c:
        row = c.execute("SELECT detail_json FROM product_details WHERE sku='55.1'").fetchone()
        detail = json.loads(row['detail_json']); detail['name'] = 'Tên mới từ Shopee'; detail['variants'] = [{'name': 'Màu', 'options': ['Vàng']}]
        c.execute("UPDATE product_details SET detail_json=? WHERE sku='55.1'", (json.dumps(detail),))
    plain = create(client, shop['id']).json()
    assert plain['created'] == [] and plain['updated'] == 0
    result = create(client, shop['id'], overwrite=True).json()
    assert result['updated'] == 1 and result['created'] == []
    fresh = client.get('/api/listings/drafts', params={'shop_id': shop['id']}).json()[0]
    assert fresh['name'] == 'Tên mới từ Shopee' and fresh['variants'] == [{'name': 'Màu', 'options': ['Vàng']}]
    assert fresh['price'] == 123456 and fresh['stock'] == 7
