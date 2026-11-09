import importlib

from fastapi.testclient import TestClient


def test_privacy_and_terms_pages_are_public_and_use_configured_contact(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    monkeypatch.setenv('LEGAL_CONTACT_EMAIL', 'privacy@example.com')
    monkeypatch.setenv('LEGAL_OPERATOR_NAME', 'Cong ty <Test>')
    import importlib
    import app as app_module
    app_module = importlib.reload(app_module)
    with TestClient(app_module.app) as anonymous:  # not a legacy suite: no sign-in is added
        privacy = anonymous.get('/privacy')
        terms = anonymous.get('/terms')
    assert privacy.status_code == terms.status_code == 200
    assert 'Chính sách quyền riêng tư' in privacy.text and 'Privacy Policy' in privacy.text
    assert 'Điều khoản dịch vụ' in terms.text and 'Terms of Service' in terms.text
    assert 'privacy@example.com' in privacy.text and 'Cong ty &lt;Test&gt;' in terms.text
    assert '{{' not in privacy.text and '{{' not in terms.text


def test_tiktok_domain_verification_file_is_served_from_the_root(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    import app as app_module
    app_module = importlib.reload(app_module)
    with TestClient(app_module.app) as anonymous:
        ok = anonymous.get('/tiktok52i64oqL7BvVpAsDLQJn0k5TWMQZUrQq.txt')
        missing = anonymous.get('/tiktokunknowntoken123.txt')
        traversal = anonymous.get('/tiktok..%2Fapp.txt')
    assert ok.status_code == 200 and ok.headers['content-type'].startswith('text/plain')
    assert ok.text.strip() == 'tiktok-developers-site-verification=52i64oqL7BvVpAsDLQJn0k5TWMQZUrQq'
    assert missing.status_code == 404 and traversal.status_code in (404, 422)


def test_extension_zip_is_built_from_the_current_extension_files(tmp_path, monkeypatch):
    import io, json, zipfile
    from pathlib import Path
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    import app as app_module
    app_module = importlib.reload(app_module)
    root = Path(app_module.ROOT)
    with TestClient(app_module.app) as anonymous:
        response = anonymous.get('/static/marketlens-chrome-extension.zip')
    assert response.status_code == 200 and response.headers['content-type'] == 'application/zip'
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    manifest = json.loads(archive.read('browser-extension/manifest.json'))
    assert manifest['version'] == json.loads((root / 'browser-extension' / 'manifest.json').read_text())['version']
    # The deployable mirror must match the editable source, otherwise installs get an old extension.
    for source in (root / 'browser-extension').glob('*.js'):
        assert archive.read(f'browser-extension/{source.name}') == source.read_bytes(), source.name
