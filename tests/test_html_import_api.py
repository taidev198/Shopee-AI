import importlib

import pytest
from fastapi.testclient import TestClient


URL = 'https://shopee.vn/familys_house'
HTML = f'''<!doctype html><html><head>
<meta charset="utf-8"><link rel="canonical" href="{URL}">
</head><body>
<a href="/Hop-dung-do-i.123456.56789"><img alt="Hộp đựng đồ gấp gọn">
<span>₫89.000</span><span>Đã bán 120</span></a>
</body></html>'''


@pytest.fixture
def html_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'html-import.db'))
    import app
    app = importlib.reload(app)
    # Import must not visit Shopee or start a collector/browser.
    def no_network(*args, **kwargs):
        pytest.fail('HTML import attempted browser collection')
    monkeypatch.setattr(app, 'crawl_public_shop', no_network)
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={'url': URL}).json()
    return app, client, shop


def upload(client, shop, html=HTML, filename='shop.html', **fields):
    data = {'shop_id': shop['id'], 'target_url': URL, 'role': 'own', 'snapshot_date': '2026-10-13'}
    data.update(fields)
    return client.post('/api/crawl/import-html', data=data,
                       files={'file': (filename, html.encode() if isinstance(html, str) else html, 'text/html')})


def test_html_capture_imports_actual_products_with_distinct_origin(html_app):
    app, client, shop = html_app
    response = upload(client, shop)
    assert response.status_code == 200, response.text
    assert response.json()['rows'] == 1
    report = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    assert report['kpis']['own_products'] == 1
    product = report['own_products'][0]
    assert product['name'] == 'Hộp đựng đồ gấp gọn'
    assert product['price'] == 89000
    assert product['sold_total'] == 120
    assert product['units_30d'] is None
    assert product['data_origin'] == 'saved_browser_dom'
    # Reimporting the same snapshot updates the product instead of duplicating it.
    assert upload(client, shop).status_code == 200
    with app.db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM observations WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 1


def test_market_html_uses_target_shop_name_and_role(html_app):
    app, client, shop = html_app
    target = 'https://shopee.vn/other_shop'
    response = upload(client, shop, HTML.replace(URL, target), role='market', target_url=target)
    assert response.status_code == 200, response.text
    report = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    assert report['kpis']['own_products'] == 0
    assert report['market_products'][0]['source_shop'] == 'other_shop'


@pytest.mark.parametrize(('html', 'filename', 'fields', 'status'), [
    (HTML, 'shop.mhtml', {}, 422),
    ('', 'shop.html', {}, 422),
    ('<h1>Access denied</h1>', 'shop.html', {}, 422),
    (HTML.replace(URL, 'https://shopee.vn/other_shop'), 'shop.html', {}, 422),
    (HTML, 'shop.html', {'role': 'invalid'}, 422),
    (HTML, 'shop.html', {'snapshot_date': 'not-a-date'}, 422),
    (HTML, 'shop.html', {'target_url': 'https://example.com/shop'}, 422),
    (HTML, 'shop.html', {'target_url': 'https://shopee.vn/other_shop'}, 422),
    (b'x' * (8 * 1024 * 1024 + 1), 'shop.html', {}, 413),
])
def test_invalid_imports_do_not_write_products_or_history(html_app, html, filename, fields, status):
    app, client, shop = html_app
    response = upload(client, shop, html, filename, **fields)
    assert response.status_code == status, response.text
    with app.db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM observations WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 0
        assert conn.execute('SELECT COUNT(*) FROM imports WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 0


def test_demo_import_is_rejected(html_app):
    _, client, _ = html_app
    assert upload(client, {'id': 'demo'}).status_code == 422
