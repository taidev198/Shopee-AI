import importlib
from urllib.parse import parse_qsl, urlencode, urlsplit

import pytest
from bs4 import BeautifulSoup
from fastapi.testclient import TestClient

from ui_roles import SYSTEM_VIEWS, USER_VIEWS, area_for_view


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'ui-roles.db'))
    import app
    app = importlib.reload(app)
    client = TestClient(app.app, headers={'Origin':'http://testserver'})
    result = client.post('/api/auth/setup',json={'username':'role-test-system','password':'Role-Test-System-Password-2026!'})
    assert result.status_code == 200, result.text
    client.headers['X-CSRF-Token'] = result.json()['csrf_token']
    return client


@pytest.mark.parametrize('view', sorted(USER_VIEWS))
def test_legacy_user_views_redirect_to_user_area_preserving_selection(client, view):
    query = [('view', view), ('shop_id', 'selected-shop')]
    response = client.get('/workspace?' + urlencode(query), follow_redirects=False)
    assert response.status_code == 307
    destination = urlsplit(response.headers['location'])
    assert destination.path == '/user' and not destination.netloc
    assert parse_qsl(destination.query) == query


@pytest.mark.parametrize('view', sorted(SYSTEM_VIEWS))
def test_legacy_collection_views_redirect_to_system_area_preserving_selection(client, view):
    query = [('view', view), ('shop_id', 'selected-shop')]
    response = client.get('/workspace?' + urlencode(query), follow_redirects=False)
    assert response.status_code == 307
    destination = urlsplit(response.headers['location'])
    assert destination.path == '/system' and parse_qsl(destination.query) == query


@pytest.mark.parametrize('area,view,target', [
    ('user', 'crawler', 'system'), ('user', 'categoryMarket', 'system'),
    ('user', 'marketSchedules', 'system'), ('user', 'imports', 'system'),
    ('system', 'overview', 'user'), ('system', 'shopAnalysis', 'user'),
    ('system', 'marketAnalysis', 'user'), ('system', 'opportunities', 'user'),
])
def test_direct_wrong_area_links_redirect_to_the_matching_area(client, area, view, target):
    query = [('view', view), ('shop_id', 'shop-123')]
    response = client.get('/' + area + '?' + urlencode(query), follow_redirects=False)
    assert response.status_code == 307
    destination = urlsplit(response.headers['location'])
    assert destination.path == '/' + target and parse_qsl(destination.query) == query


def test_legacy_redirect_preserves_unicode_repeated_blank_and_url_like_query_values(client):
    query = [('view', 'categoryMarket'), ('shop_id', 'Gia dụng & đời sống'),
             ('filter', 'rây 500ml / inox'), ('filter', 'phòng bếp'), ('empty', ''),
             ('return_to', '//untrusted.example/\r\nInjected: value')]
    response = client.get('/workspace?' + urlencode(query), follow_redirects=False)
    assert response.status_code == 307
    destination = urlsplit(response.headers['location'])
    assert destination.path == '/system' and not destination.netloc
    assert parse_qsl(destination.query, keep_blank_values=True) == query
    assert '\r' not in response.headers['location'] and '\n' not in response.headers['location']


@pytest.mark.parametrize('views,target', [
    (['crawler', 'products'], 'system'), (['products', 'crawler'], 'user'),
    (['unknown', 'crawler'], 'user'),
])
def test_duplicate_view_keys_follow_the_same_first_value_as_browser_url_search_params(client, views, target):
    query = [('view', value) for value in views]
    response = client.get('/workspace?' + urlencode(query), follow_redirects=False)
    destination = urlsplit(response.headers['location'])
    assert destination.path == '/' + target
    assert parse_qsl(destination.query) == query


def test_guest_alias_redirects_to_canonical_home_and_preserves_query(client):
    response = client.get('/guest?campaign=Gi%E1%BB%9Bi+thi%E1%BB%87u', follow_redirects=False)
    assert response.status_code == 307
    destination = urlsplit(response.headers['location'])
    assert destination.path == '/' and parse_qsl(destination.query) == [('campaign', 'Giới thiệu')]


def test_home_serves_guest_without_reading_workspace_or_system_views(client):
    response = client.get('/')
    assert response.status_code == 200 and response.headers['content-type'].startswith('text/html')
    soup = BeautifulSoup(response.text, 'html.parser')
    assert not soup.select('.sidebar [data-view]')
    assert not soup.select('script[src*="/static/app.js"]')


@pytest.mark.parametrize('area', ['user', 'system'])
def test_unknown_view_stays_in_its_area_for_client_default_guard(client, area):
    response = client.get('/' + area + '?view=unrecognized', follow_redirects=False)
    assert response.status_code == 200 and 'location' not in response.headers


def test_user_and_system_page_sidebars_contain_only_their_own_views(client):
    user = client.get('/user')
    system = client.get('/system')
    assert user.status_code == system.status_code == 200
    user_soup, system_soup = (BeautifulSoup(response.text, 'html.parser') for response in (user, system))
    user_views = {node['data-view'] for node in user_soup.select('.sidebar [data-view]')}
    system_views = {node['data-view'] for node in system_soup.select('.sidebar [data-view]')}
    assert {'overview', 'shopAnalysis', 'products', 'optimizer', 'actions'} <= user_views <= USER_VIEWS
    assert system_views == SYSTEM_VIEWS
    assert user_views.isdisjoint(system_views)


def test_authenticated_system_keeps_existing_local_api_access(client):
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/shops').status_code == 200
    assert client.get('/api/dashboard', params={'shop_id': 'demo'}).status_code == 200


def test_unknown_views_default_to_the_callers_area_and_known_sets_are_disjoint():
    assert not USER_VIEWS & SYSTEM_VIEWS
    assert area_for_view('unknown') == 'user'
    assert area_for_view('unknown', 'system') == 'system'
