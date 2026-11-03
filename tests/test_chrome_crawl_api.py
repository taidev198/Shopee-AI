import importlib
import sqlite3
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient


URL = 'https://shopee.vn/familys_house'


@pytest.fixture
def chrome_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'chrome.db'))
    import app
    app = importlib.reload(app)

    class NoCollectorExecutor:
        def submit(self, *args, **kwargs):
            pytest.fail('Chrome job submitted a Playwright collector')

    monkeypatch.setattr(app, 'executor', NoCollectorExecutor())
    monkeypatch.setattr(app, 'crawl_public_shop', lambda *args, **kwargs: pytest.fail('Browser opened'))
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={'url': URL, 'category': 'Nhà cửa & Đời sống'}).json()
    return app, client, shop


def start(client, shop, **fields):
    payload = {'shop_id': shop['id'], 'role': 'own', 'browser': 'chrome'}
    payload.update(fields)
    response = client.post('/api/crawl/jobs', json=payload)
    assert response.status_code == 202, response.text
    return response.json()


def card(item='56789', name='Hộp đựng đồ', text='₫89.000 Đã bán 120'):
    return {'href': f'/Hop-dung-do-i.123456.{item}', 'name': name, 'text': text}


def finish(client, job, pages=None, **fields):
    payload = {'result_token': job['result_token'], 'pages': pages if pages is not None else [
        {'url': URL, 'cards': [card()]}]}
    payload.update(fields)
    return client.post(f'/api/crawl/jobs/{job["job_id"]}/browser-result', json=payload)


def counts(app, shop):
    with app.db() as conn:
        return tuple(conn.execute(f'SELECT COUNT(*) FROM {table} WHERE shop_id=?',
                                  (shop['id'],)).fetchone()[0]
                     for table in ('observations', 'imports'))


def test_click_creates_waiting_chrome_job_without_launching_playwright(chrome_app):
    app, client, shop = chrome_app
    job = start(client, shop)
    assert job['browser'] == 'chrome'
    assert job['status'] == 'running'
    assert job['target_url'] == URL
    assert len(job['result_token']) == 32
    assert datetime.fromisoformat(job['result_expires_at']) > datetime.now() + timedelta(minutes=4)
    status = client.get(f'/api/crawl/jobs/{job["job_id"]}').json()
    assert status['status'] == 'running'
    assert 'Chrome' in status['error']
    assert 'result_token' not in status
    assert 'result_token' not in client.get('/api/crawl/jobs', params={'shop_id': shop['id']}).json()[0]
    assert counts(app, shop) == (0, 0)


def test_live_pages_merge_duplicate_fields_and_save_atomically(chrome_app):
    app, client, shop = chrome_app
    job = start(client, shop)
    pages = [
        {'url': URL, 'cards': [card(text='₫89.000')]},
        {'url': URL + '?page=1', 'cards': [card(text='Đã bán 120'), card('56790', 'Kệ bếp', '₫150.000 Đã bán 4')]},
    ]
    response = finish(client, job, pages)
    assert response.status_code == 200, response.text
    assert response.json()['rows_imported'] == 2
    assert response.json()['data_origin'] == 'chrome_live_dom'
    report = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    by_sku = {product['sku']: product for product in report['own_products']}
    assert by_sku['123456.56789']['price'] == 89000
    assert by_sku['123456.56789']['sold_total'] == 120
    assert by_sku['123456.56789']['units_30d'] is None
    assert by_sku['123456.56790']['price'] == 150000
    assert counts(app, shop) == (2, 1)
    with app.db() as conn:
        stored_job = conn.execute('SELECT * FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()
        assert stored_job['status'] == 'done'
        assert stored_job['result_token'] == ''
        assert conn.execute('SELECT data_origin FROM observations WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 'chrome_live_dom'


def test_new_click_uses_new_dom_prices_and_count_for_same_snapshot(chrome_app):
    app, client, shop = chrome_app
    first = start(client, shop)
    assert finish(client, first).json()['rows_imported'] == 1
    second = start(client, shop)
    assert second['job_id'] != first['job_id']
    assert second['result_token'] != first['result_token']
    response = finish(client, second, [{'url': URL, 'cards': [
        card(text='₫97.000 Đã bán 130'), card('56790', 'Kệ bếp', '₫140.000')]}])
    assert response.status_code == 200, response.text
    assert response.json()['rows_imported'] == 2
    report = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    by_sku = {product['sku']: product for product in report['own_products']}
    assert len(by_sku) == 2
    assert by_sku['123456.56789']['price'] == 97000
    assert by_sku['123456.56789']['sold_total'] == 130
    assert counts(app, shop) == (2, 2)


@pytest.mark.parametrize('token', ['wrong-token', 'mã-không-hợp-lệ'])
def test_wrong_token_does_not_write_or_finish_the_job(chrome_app, token):
    app, client, shop = chrome_app
    job = start(client, shop)
    response = finish(client, job, result_token=token)
    assert response.status_code == 403
    assert counts(app, shop) == (0, 0)
    assert client.get(f'/api/crawl/jobs/{job["job_id"]}').json()['status'] == 'running'
    assert finish(client, job).status_code == 200


def test_new_click_replaces_today_live_capture_when_product_count_decreases(chrome_app):
    app, client, shop = chrome_app
    first = start(client, shop)
    assert finish(client, first, [{'url': URL, 'cards': [card(), card('56790')]}]).json()['rows_imported'] == 2
    second = start(client, shop)
    response = finish(client, second, [{'url': URL, 'cards': [card(text='₫97.000 Đã bán 130')]}])
    assert response.status_code == 200
    report = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    assert len(report['own_products']) == 1
    assert report['own_products'][0]['price'] == 97000
    assert counts(app, shop) == (1, 2)


@pytest.mark.parametrize('url', [
    'https://shopee.vn/other_shop', 'https://example.com/familys_house',
    'https://shopee.vn/verify/traffic/error', 'https://user@shopee.vn/familys_house',
    'https://shopee.vn:443/familys_house', 'http://shopee.vn/familys_house',
])
def test_wrong_shop_page_does_not_write_or_finish_the_job(chrome_app, url):
    app, client, shop = chrome_app
    job = start(client, shop)
    response = finish(client, job, [{'url': URL, 'cards': [card()]}, {'url': url, 'cards': [card('56790')]}])
    assert response.status_code == 422, response.text
    assert counts(app, shop) == (0, 0)
    assert client.get(f'/api/crawl/jobs/{job["job_id"]}').json()['status'] == 'running'


@pytest.mark.parametrize('href', [
    'https://example.com/Product-i.123456.56789',
    '/search?next=/product/123456/56789',
    'javascript:alert(1)', 'https://[bad-url',
    'https://user@shopee.vn/product/123456/56789',
])
def test_non_product_links_rejected_without_partial_import(chrome_app, href):
    app, client, shop = chrome_app
    job = start(client, shop)
    bad_card = card('56790')
    bad_card['href'] = href
    response = finish(client, job, [{'url': URL, 'cards': [card(), bad_card]}])
    assert response.status_code == 422, response.text
    assert counts(app, shop) == (0, 0)
    assert client.get(f'/api/crawl/jobs/{job["job_id"]}').json()['status'] == 'running'


def test_no_cards_finishes_failed_without_synthetic_products(chrome_app):
    app, client, shop = chrome_app
    job = start(client, shop)
    response = finish(client, job, [{'url': URL, 'cards': []}])
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'failed'
    assert response.json()['rows_imported'] == 0
    assert counts(app, shop) == (0, 0)
    with app.db() as conn:
        assert conn.execute('SELECT result_token FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()[0] == ''


def test_reported_browser_error_finishes_failed_without_import(chrome_app):
    app, client, shop = chrome_app
    job = start(client, shop)
    message = 'Chrome chưa cho phép đọc JavaScript từ ứng dụng.'
    response = finish(client, job, error=message)
    assert response.status_code == 200
    assert response.json()['status'] == 'failed'
    assert response.json()['error'] == message
    assert counts(app, shop) == (0, 0)


def test_completed_job_cannot_be_replayed(chrome_app):
    app, client, shop = chrome_app
    job = start(client, shop)
    assert finish(client, job).status_code == 200
    assert finish(client, job).status_code == 409
    assert counts(app, shop) == (1, 1)


def test_poll_expires_stalled_job_and_clears_capability(chrome_app):
    app, client, shop = chrome_app
    job = start(client, shop)
    with app.db() as conn:
        conn.execute('UPDATE crawl_jobs SET result_expires_at=? WHERE id=?',
                     ((datetime.now() - timedelta(seconds=1)).isoformat(), job['job_id']))
    assert finish(client, job).status_code == 410
    result = client.get('/api/crawl/jobs', params={'shop_id': shop['id']}).json()[0]
    assert result['status'] == 'failed'
    assert 'Hết thời gian' in result['error']
    assert counts(app, shop) == (0, 0)
    with app.db() as conn:
        assert conn.execute('SELECT result_token FROM crawl_jobs WHERE id=?', (job['job_id'],)).fetchone()[0] == ''


def test_expired_jobs_do_not_fill_queue(chrome_app):
    app, client, shop = chrome_app
    jobs = [start(client, shop) for _ in range(3)]
    assert client.post('/api/crawl/jobs', json={'shop_id': shop['id'], 'browser': 'chrome'}).status_code == 429
    with app.db() as conn:
        conn.execute('UPDATE crawl_jobs SET result_expires_at=?',
                     ((datetime.now() - timedelta(seconds=1)).isoformat(),))
    new_job = start(client, shop)
    assert new_job['job_id'] not in {job['job_id'] for job in jobs}


@pytest.mark.parametrize('pages', [
    [{'url': URL, 'cards': [card()] * 301}],
    [{'url': URL, 'cards': []}] * 6,
    [{'url': URL, 'cards': [card(text='x' * 5001)]}],
    [{'url': URL, 'cards': [card(text='x' * 5000)] * 300}] * 2,
])
def test_oversized_dom_results_rejected_without_writes(chrome_app, pages):
    app, client, shop = chrome_app
    job = start(client, shop)
    assert finish(client, job, pages).status_code == 422
    assert counts(app, shop) == (0, 0)
    assert client.get(f'/api/crawl/jobs/{job["job_id"]}').json()['status'] == 'running'


def test_setup_migrates_existing_crawl_jobs_idempotently(chrome_app, tmp_path, monkeypatch):
    app, _, _ = chrome_app
    legacy_db = tmp_path / 'legacy.db'
    with sqlite3.connect(legacy_db) as conn:
        conn.execute('''CREATE TABLE crawl_jobs (
            id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, target_url TEXT NOT NULL, role TEXT NOT NULL,
            status TEXT NOT NULL, rows_imported INTEGER DEFAULT 0, error TEXT DEFAULT '',
            created_at TEXT NOT NULL, completed_at TEXT DEFAULT '')''')
        conn.execute("INSERT INTO crawl_jobs(id,shop_id,target_url,role,status,created_at) VALUES('old','shop',?,'own','done',?)",
                     (URL, datetime.now().isoformat()))
    monkeypatch.setattr(app, 'DB', legacy_db)
    app.setup()
    app.setup()
    with app.db() as conn:
        row = conn.execute('SELECT * FROM crawl_jobs WHERE id=?', ('old',)).fetchone()
        assert row['browser'] == 'playwright'
        assert row['result_token'] == ''
        assert row['result_expires_at'] == ''
