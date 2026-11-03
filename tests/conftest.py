"""Legacy feature tests sign in through the real auth API on their temporary DB.

Only the listed pre-authentication feature suites opt in to this migration.
New tests, including authentication/RBAC tests, remain anonymous by default.
There is no application-side testing bypass.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


LEGACY_FEATURE_SUITES = {
    'test_app.py', 'test_category_market.py', 'test_chrome_crawl_api.py',
    'test_competitor_analysis.py', 'test_crawler.py', 'test_html_import_api.py',
    'test_interactive_api.py', 'test_list_pagination_api.py', 'test_market_pipeline.py',
    'test_product_details_api.py', 'test_seller_ai.py', 'test_seller_workspace.py',
}


@pytest.fixture(autouse=True)
def legacy_system_session(request, monkeypatch):
    if Path(str(request.fspath)).name not in LEGACY_FEATURE_SUITES:
        return
    original_init = TestClient.__init__

    def signed_init(client, app, *args, **kwargs):
        original_init(client, app, *args, **kwargs)
        auth = getattr(getattr(app, 'state', None), 'auth', None)
        if auth is None:
            return
        with auth.db() as connection:
            database = connection.execute('PRAGMA database_list').fetchone()[2]
        production = Path(__file__).resolve().parents[1] / 'market.db'
        assert Path(database).resolve() != production, 'Tests must never create production accounts'
        client.headers['Origin'] = str(client.base_url).rstrip('/')
        state = client.get('/api/auth/me').json()
        action = 'setup' if state.get('setup_required') else 'login'
        response = client.post('/api/auth/' + action, json={
            'username': 'feature-test-system', 'password': 'Feature-Tests-Only-2026!',
        })
        assert response.status_code == 200, response.text
        client.headers['X-CSRF-Token'] = response.json()['csrf_token']

    monkeypatch.setattr(TestClient, '__init__', signed_init)
