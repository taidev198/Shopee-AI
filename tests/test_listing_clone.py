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
            detail = {'name': 'Hộp đựng cơm 3 ngăn cao cấp', 'description': 'Mô tả gốc\nDòng 2', 'images': [IMG, 'https://evil.example/x.jpg', IMG],
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
    assert client.get('/api/listings/sources', params={'shop_id': shop['id']}).json()[0]['has_detail'] is True
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
