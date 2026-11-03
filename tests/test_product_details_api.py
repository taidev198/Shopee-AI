import importlib
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient


SHOP_URL = 'https://shopee.vn/familys_house'
PRODUCT_URL = 'https://shopee.vn/product/123456/56789'
SECOND_URL = 'https://shopee.vn/product/123456/56790'


@pytest.fixture
def details_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'details.db'))
    import app
    app = importlib.reload(app)

    class NoCollectorExecutor:
        def submit(self, *args, **kwargs):
            pytest.fail('Chrome job must not open a Playwright browser')

    monkeypatch.setattr(app, 'executor', NoCollectorExecutor())
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={'url': SHOP_URL}).json()
    return app, client, shop


def start(client, shop, **overrides):
    payload = {'shop_id': shop['id'], 'role': 'own', 'browser': 'chrome', 'read_details': True}
    payload.update(overrides)
    response = client.post('/api/crawl/jobs', json=payload)
    assert response.status_code == 202, response.text
    return response.json()


def listing(client, job, products=1):
    cards = [{'href': PRODUCT_URL, 'name': 'Hộp đựng đồ', 'text': '₫89.000 Đã bán 120'}]
    if products == 2:
        cards.append({'href': SECOND_URL, 'name': 'Kệ bếp', 'text': '₫150.000 Đã bán 4'})
    response = client.post(f'/api/crawl/jobs/{job["job_id"]}/browser-result', json={
        'result_token': job['result_token'],
        'pages': [{'url': job['target_url'], 'cards': cards}],
    })
    assert response.status_code == 200, response.text
    return response.json()


def detail(**overrides):
    value = {
        'url': PRODUCT_URL, 'name': 'Hộp đựng đồ có nắp',
        'description': 'Nhựa PP\nDung tích 5 lít',
        'images': ['https://down-vn.img.susercontent.com/file/example'],
        'attributes': [{'name': 'Chất liệu', 'value': 'Nhựa PP'}],
        'variants': [{'name': 'Màu sắc', 'options': ['Trắng', 'Xanh']}],
        'categories': ['Nhà cửa & Đời sống', 'Dụng cụ nhà bếp'],
        'price_text': '94.000₫', 'rating_text': '4.9',
        'review_count_text': '119 ratings', 'sold_text': '1k+ Sold', 'stock_text': 'IN STOCK',
    }
    value.update(overrides)
    return value


def submit(client, job, product_url=PRODUCT_URL, value=None, **fields):
    payload = {'result_token': job['result_token'], 'product_url': product_url}
    if value is not None:
        payload['detail'] = value
    payload.update(fields)
    return client.post(f'/api/crawl/jobs/{job["job_id"]}/product-result', json=payload)


def finish(client, job, **fields):
    return client.post(f'/api/crawl/jobs/{job["job_id"]}/finish-details', json={
        'result_token': job['result_token'], **fields})


def report(client, shop):
    return client.get('/api/dashboard', params={'shop_id': shop['id']}).json()


def test_listing_is_saved_before_details_and_only_listed_products_are_returned(details_app):
    app, client, shop = details_app
    job = start(client, shop)
    result = listing(client, job, products=2)
    assert result['status'] == 'running'
    assert result['rows_imported'] == result['detail_total'] == 2
    assert result['detail_completed'] == result['detail_failed'] == 0
    assert {item['sku'] for item in result['products']} == {'123456.56789', '123456.56790'}
    assert report(client, shop)['kpis']['own_products'] == 2
    assert all(item['detail'] is None for item in report(client, shop)['own_products'])
    with app.db() as conn:
        assert conn.execute('SELECT result_token FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()[0]
    # Replaying the listing cannot reset progress or overwrite a saved list.
    response = client.post(f'/api/crawl/jobs/{job["job_id"]}/browser-result', json={
        'result_token': job['result_token'], 'error': 'late list error'})
    assert response.status_code == 409


def test_each_detail_is_durable_idempotent_and_does_not_overwrite_listing_price(details_app):
    app, client, shop = details_app
    job = start(client, shop)
    listing(client, job, products=2)
    with app.db() as conn:
        conn.execute('UPDATE crawl_jobs SET result_expires_at=? WHERE id=?',
                     ((datetime.now() + timedelta(seconds=20)).isoformat(), job['job_id']))
    response = submit(client, job, value=detail())
    assert response.status_code == 200, response.text
    assert response.json()['detail_completed'] == 1
    assert submit(client, job, value=detail()).json()['detail_completed'] == 1
    product = next(p for p in report(client, shop)['own_products'] if p['sku'] == '123456.56789')
    assert product['price'] == 89000
    assert product['detail']['price_text'] == '94.000₫'
    assert product['detail']['description'] == 'Nhựa PP\nDung tích 5 lít'
    assert product['detail']['variants'][0]['options'] == ['Trắng', 'Xanh']
    assert product['detail']['status'] == 'done'
    with app.db() as conn:
        job_row = conn.execute('SELECT * FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()
        assert datetime.fromisoformat(job_row['result_expires_at']) > datetime.now() + timedelta(minutes=4)
        assert conn.execute('SELECT COUNT(*) FROM product_details').fetchone()[0] == 1
    assert finish(client, job).status_code == 409
    second = submit(client, job, product_url=SECOND_URL,
                    value=detail(url=SECOND_URL, name='Kệ bếp', description='Kệ inox'))
    assert second.json()['detail_completed'] == 2
    result = finish(client, job).json()
    assert result['status'] == 'done' and result['partial'] is False
    assert result['detail_completed'] == 2 and result['detail_failed'] == 0
    assert submit(client, job, value=detail()).status_code == 409
    assert finish(client, job).status_code == 409


def test_partial_failure_is_reported_and_saved_detail_survives_expiry(details_app):
    app, client, shop = details_app
    job = start(client, shop)
    listing(client, job, products=2)
    submit(client, job, value=detail())
    failed = submit(client, job, product_url=SECOND_URL, error='Trang sản phẩm không còn tồn tại.')
    assert failed.status_code == 200
    assert failed.json()['detail_completed'] == failed.json()['detail_failed'] == 1
    result = finish(client, job).json()
    assert result['partial'] is True
    assert '1/2' in result['error']
    by_sku = {product['sku']: product for product in report(client, shop)['own_products']}
    assert by_sku['123456.56789']['detail']['description']
    assert by_sku['123456.56790']['detail']['status'] == 'failed'
    another = start(client, shop)
    listing(client, another, products=2)
    submit(client, another, value=detail(description='Thông tin mới'))
    with app.db() as conn:
        conn.execute('UPDATE crawl_jobs SET result_expires_at=? WHERE id=?',
                     ((datetime.now() - timedelta(seconds=1)).isoformat(), another['job_id']))
    assert client.get(f'/api/crawl/jobs/{another["job_id"]}').json()['status'] == 'failed'
    saved = next(p for p in report(client, shop)['own_products'] if p['sku'] == '123456.56789')
    assert saved['detail']['description'] == 'Thông tin mới'


def test_explicit_abort_finishes_partial_without_discarding_list_or_details(details_app):
    _, client, shop = details_app
    job = start(client, shop)
    listing(client, job, products=2)
    submit(client, job, value=detail())
    result = finish(client, job, error='Chrome đã đóng.').json()
    assert result['status'] == 'done' and result['partial'] is True
    assert result['detail_completed'] == 1 and result['detail_total'] == 2
    assert 'Chrome đã đóng.' in result['error']
    assert report(client, shop)['kpis']['own_products'] == 2


def test_new_failure_keeps_previously_read_detail_and_records_last_error(details_app):
    _, client, shop = details_app
    first = start(client, shop)
    listing(client, first)
    submit(client, first, value=detail())
    finish(client, first)
    second = start(client, shop)
    listing(client, second)
    submit(client, second, error='Shopee yêu cầu xác minh.')
    finish(client, second)
    saved = report(client, shop)['own_products'][0]['detail']
    assert saved['status'] == 'done'
    assert saved['error'] == '' and saved['last_error'] == 'Shopee yêu cầu xác minh.'
    assert saved['description'] == 'Nhựa PP\nDung tích 5 lít'


@pytest.mark.parametrize('url', [
    'https://shopee.vn/product/123456/99999',
    'https://example.com/product/123456/56789',
    'https://shopee.vn/search?next=/product/123456/56789',
    'https://user@shopee.vn/product/123456/56789',
    'http://shopee.vn/product/123456/56789',
])
def test_unlisted_or_non_public_product_url_cannot_write_details(details_app, url):
    app, client, shop = details_app
    job = start(client, shop)
    listing(client, job)
    assert submit(client, job, product_url=url, value=detail()).status_code == 422
    with app.db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM product_details').fetchone()[0] == 0


def test_mismatched_detail_url_rejected_and_shop_role_are_isolated(details_app):
    app, client, shop = details_app
    own = start(client, shop)
    listing(client, own)
    assert submit(client, own, value=detail(url=SECOND_URL)).status_code == 422
    assert submit(client, own, value=detail(), result_token='wrong').status_code == 403
    submit(client, own, value=detail())
    finish(client, own)
    market = start(client, shop, role='market', target_url='https://shopee.vn/another_shop')
    listing(client, market)
    assert report(client, shop)['market_products'][0]['detail'] is None
    submit(client, market, value=detail(description='Sản phẩm đối thủ'))
    finish(client, market)
    saved = report(client, shop)
    assert saved['own_products'][0]['detail']['description'] == 'Nhựa PP\nDung tích 5 lít'
    assert saved['market_products'][0]['detail']['description'] == 'Sản phẩm đối thủ'
    other_shop = client.post('/api/shops', json={'url': 'https://shopee.vn/another_owner'}).json()
    other_job = start(client, other_shop)
    listing(client, other_job)
    assert report(client, other_shop)['own_products'][0]['detail'] is None
    with app.db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM product_details').fetchone()[0] == 2


@pytest.mark.parametrize('overrides', [
    {'description': 'a' * 50001},
    {'images': ['javascript:alert(1)']},
    {'images': ['https://user:pass@example.com/photo.jpg']},
    {'images': ['https://example.com/a.jpg'] * 31},
    {'variants': [{'name': 'Màu', 'options': ['a' * 301]}]},
    {'attributes': [{'name': 'Chất liệu', 'value': 'a' * 3001}]},
    {'categories': ['a' * 301]},
    {'unexpected_private_state': 'cookie'},
])
def test_invalid_or_unbounded_detail_rejected_without_progress(details_app, overrides):
    app, client, shop = details_app
    job = start(client, shop)
    listing(client, job)
    assert submit(client, job, value=detail(**overrides)).status_code == 422
    with app.db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM product_details').fetchone()[0] == 0
        row = conn.execute('SELECT * FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()
        assert row['detail_completed'] == row['detail_failed'] == 0


def test_missing_result_conflicting_result_and_pre_listing_result_are_rejected(details_app):
    _, client, shop = details_app
    job = start(client, shop)
    assert submit(client, job, value=detail()).status_code == 409
    assert finish(client, job, error='Stopped').status_code == 409
    listing(client, job)
    assert submit(client, job).status_code == 422
    assert submit(client, job, value=detail(), error='Error').status_code == 422
    assert submit(client, job, error='  ').status_code == 422


def test_new_schema_migrations_are_idempotent(details_app):
    app, _, _ = details_app
    app.setup()
    app.setup()
    with app.db() as conn:
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(crawl_jobs)')}
        assert {'read_details', 'detail_total', 'detail_completed', 'detail_failed'} <= columns


def test_expired_authenticated_callback_commits_failure_without_polling(details_app):
    app, client, shop = details_app
    job = start(client, shop)
    listing(client, job, products=2)
    assert submit(client, job, value=detail()).status_code == 200
    with app.db() as conn:
        conn.execute('UPDATE crawl_jobs SET result_expires_at=? WHERE id=?',
                     ((datetime.now() - timedelta(seconds=1)).isoformat(), job['job_id']))
    assert submit(client, job, product_url=SECOND_URL, error='Trang đã đóng.').status_code == 410
    # Inspect storage directly; no GET endpoint or later queue operation expires it.
    with app.db() as conn:
        saved = conn.execute('SELECT * FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()
        assert saved['status'] == 'failed'
        assert saved['result_token'] == ''
        assert saved['completed_at'] and 'Hết thời gian' in saved['error']
        assert saved['rows_imported'] == 2 and saved['detail_completed'] == 1
        assert conn.execute('SELECT COUNT(*) FROM product_details').fetchone()[0] == 1
