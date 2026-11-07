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
