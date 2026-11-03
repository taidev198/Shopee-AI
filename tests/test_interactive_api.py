import importlib

import pytest
from fastapi.testclient import TestClient

from crawl_worker import CrawlBlocked, extract_public_cards


@pytest.fixture
def assisted_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'assisted.db'))
    import app
    app = importlib.reload(app)

    class InlineExecutor:
        def submit(self, fn, *args):
            return fn(*args)

    monkeypatch.setattr(app, 'executor', InlineExecutor())
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={
        'url': 'https://shopee.vn/familys_house',
        'category': 'Nhà cửa & Đời sống',
    }).json()
    return app, client, shop


def product_fixture(url, shop_name, category):
    return extract_public_cards('''
      <a href="/Hop-dung-do-i.123456.56789">
        <img alt="Hộp đựng đồ gấp gọn đa năng" />
        <span>₫89.000</span><span>Đã bán 120</span>
      </a>
    ''', url, shop_name, category)


def test_interactive_job_reports_progress_and_clears_note_on_success(assisted_app, monkeypatch):
    app, client, shop = assisted_app
    calls = []

    def collector(url, shop_name, category, **kwargs):
        calls.append(kwargs)
        assert kwargs['interactive'] is True
        assert kwargs['user_data_dir'] == str(app.BROWSER_PROFILE)
        kwargs['on_status']('Hãy mở lại trang shop trong Chromium.')
        with app.db() as conn:
            running = conn.execute('SELECT * FROM crawl_jobs').fetchone()
            assert running['status'] == 'running'
            assert running['error'] == 'Hãy mở lại trang shop trong Chromium.'
        return product_fixture(url, shop_name, category)

    monkeypatch.setattr(app, 'crawl_public_shop', collector)
    response = client.post('/api/crawl/jobs', json={
        'shop_id': shop['id'], 'role': 'own', 'interactive': True,
    })
    assert response.status_code == 202
    assert response.json()['interactive'] is True
    result = client.get('/api/crawl/jobs/' + response.json()['job_id']).json()
    assert len(calls) == 1
    assert result['status'] == 'done'
    assert result['rows_imported'] == 1
    assert result['error'] == ''
    report = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    assert report['kpis']['own_products'] == 1


@pytest.mark.parametrize('explicit_false', [False, True])
def test_background_without_profile_preserves_basic_collector_call(assisted_app, monkeypatch, explicit_false):
    app, client, shop = assisted_app
    calls = []

    def collector(url, shop_name, category):
        calls.append((url, shop_name, category))
        return product_fixture(url, shop_name, category)

    monkeypatch.setattr(app, 'crawl_public_shop', collector)
    payload = {'shop_id': shop['id'], 'role': 'own'}
    if explicit_false:
        payload['interactive'] = False
    response = client.post('/api/crawl/jobs', json=payload)
    assert response.status_code == 202
    assert response.json()['interactive'] is False
    result = client.get('/api/crawl/jobs/' + response.json()['job_id']).json()
    assert result['status'] == 'done'
    assert len(calls) == 1


def test_existing_browser_profile_is_reused_by_background_jobs(assisted_app, monkeypatch):
    app, client, shop = assisted_app
    app.BROWSER_PROFILE.mkdir()
    calls = []

    def collector(url, shop_name, category, **kwargs):
        calls.append(kwargs)
        assert kwargs['interactive'] is False
        assert kwargs['user_data_dir'] == str(app.BROWSER_PROFILE)
        kwargs['on_status']('Đang đọc sản phẩm hiển thị.')
        return product_fixture(url, shop_name, category)

    monkeypatch.setattr(app, 'crawl_public_shop', collector)
    response = client.post('/api/crawl/jobs', json={
        'shop_id': shop['id'], 'role': 'own', 'interactive': False,
    })
    result = client.get('/api/crawl/jobs/' + response.json()['job_id']).json()
    assert len(calls) == 1
    assert result['status'] == 'done'
    assert result['error'] == ''


def test_failed_interactive_job_keeps_failure_reason_and_imports_nothing(assisted_app, monkeypatch):
    app, client, shop = assisted_app
    failure = 'Shopee vẫn chặn truy cập sau khi chờ bạn mở trang shop.'

    def collector(*args, **kwargs):
        kwargs['on_status']('Đang chờ bạn mở trang shop.')
        raise CrawlBlocked(failure)

    monkeypatch.setattr(app, 'crawl_public_shop', collector)
    response = client.post('/api/crawl/jobs', json={
        'shop_id': shop['id'], 'role': 'own', 'interactive': True,
    })
    result = client.get('/api/crawl/jobs/' + response.json()['job_id']).json()
    assert result['status'] == 'failed'
    assert result['error'] == failure
    assert result['rows_imported'] == 0
    with app.db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM imports WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 0
        assert conn.execute('SELECT COUNT(*) FROM observations WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 0
