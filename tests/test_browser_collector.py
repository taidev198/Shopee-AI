from contextlib import nullcontext
from types import SimpleNamespace

import pytest

import crawl_worker
from crawl_worker import CrawlBlocked, CrawlError, check_page_access


@pytest.mark.parametrize(('url', 'html', 'reason'), [
    ('https://shopee.vn/verify/traffic/error?next=shop', '', 'chặn lưu lượng'),
    ('https://shopee.vn/buyer/login?next=shop', '', 'đăng nhập'),
    ('https://shopee.vn/test_shop', '<h1>Verify you are human</h1>', 'xác minh'),
    ('https://shopee.vn/test_shop', '<h1>Access denied</h1>', 'chặn truy cập'),
    ('https://shopee.vn/test_shop', '<form><input type="password"></form>', 'đăng nhập'),
    ('https://example.com/redirect', '', 'ngoài Shopee'),
])
def test_error_pages_are_identified_before_parsing(url, html, reason):
    with pytest.raises(CrawlBlocked, match=reason):
        check_page_access(url, html)


def test_page_with_login_link_and_script_is_not_a_login_or_captcha_page():
    check_page_access('https://shopee.vn/test_shop', '''
        <a href="/buyer/login">Đăng nhập</a>
        <script>window.message = "Verify you are human";</script>
        <div hidden>Access denied</div>
        <a href="/Ao-thun-i.1.2"><img alt="Áo thun">₫89.000</a>
    ''')


def test_hidden_login_modal_and_verify_named_shop_are_not_blocked():
    check_page_access('https://shopee.vn/verify_house', '''
        <div style="display: none">Access denied<input type="password"></div>
        <div>Đang tải sản phẩm</div>
    ''')
    check_page_access('https://shopee.vn/captcha_house', '<p>Shop</p>')


def test_live_dom_visibility_takes_precedence_over_css_hidden_html():
    check_page_access('https://shopee.vn/test_shop', '''
        <div class="hidden-modal">Access denied<input type="password"></div>
    ''', visible_text='Đang tải sản phẩm', password_visible=False)


def test_nested_styled_children_of_hidden_parent_are_ignored_without_crash():
    check_page_access('https://shopee.vn/test_shop', '''
        <div style="display:none">
          <span style="color:red">Access denied</span>
          <input type="password" style="visibility:hidden">
        </div><p>Đang tải sản phẩm</p>
    ''')


def card(item, name):
    return f'<a href="/product/1/{item}"><img alt="{name}">₫89.000</a>'


class FakePage:
    def __init__(self, snapshots, url='https://shopee.vn/test_shop', status=200):
        self.snapshots = snapshots
        self.url = url
        self.status = status
        self.elapsed = 0
        self.scrolls = 0
        self.closed = False
        self.goto_calls = 0
        self.mouse = SimpleNamespace(wheel=self.scroll)

    def goto(self, *args, **kwargs):
        self.goto_calls += 1
        return SimpleNamespace(status=self.status)

    def is_closed(self):
        return self.closed

    def content(self):
        # The HTML shell arrives first. Cards appear on the first wait;
        # scrolling replaces the DOM to model a virtualized product list.
        if self.elapsed == 0:
            return '<html><body>Đang tải...</body></html>'
        return self.snapshots[min(self.scrolls, len(self.snapshots) - 1)]

    def title(self):
        return 'Shop test'

    def wait_for_timeout(self, milliseconds):
        self.elapsed += milliseconds / 1000

    def scroll(self, *args):
        self.scrolls += 1

    def locator(self, selector):
        return SimpleNamespace(evaluate_all=lambda expression: False, inner_text=lambda: 'Shop test')


def setup_browser(monkeypatch, page):
    import playwright.sync_api
    browser = SimpleNamespace(closed=False, pages=[page], new_page=lambda **kwargs: page)
    browser.close = lambda: setattr(browser, 'closed', True)
    def persistent(**kwargs):
        browser.launch_options = kwargs
        return browser
    runtime = SimpleNamespace(chromium=SimpleNamespace(
        launch=lambda **kwargs: browser, launch_persistent_context=persistent))
    monkeypatch.setattr(playwright.sync_api, 'sync_playwright', lambda: nullcontext(runtime))
    monkeypatch.setattr(crawl_worker, 'robots_allowed', lambda url: (True, 0))
    monkeypatch.setattr(crawl_worker.time, 'monotonic', lambda: page.elapsed)
    return browser


def test_waits_for_cards_and_keeps_products_removed_from_dom_after_scroll(monkeypatch):
    page = FakePage([card(1, 'Áo thun'), card(2, 'Áo khoác'), card(3, 'Quần')])
    browser = setup_browser(monkeypatch, page)
    products = crawl_worker.crawl_public_shop(page.url, 'Shop test', max_scrolls=2)
    assert {product['sku'] for product in products} == {'1.1', '1.2', '1.3'}
    assert all(product['units_30d'] is None for product in products)
    assert browser.closed


def test_real_traffic_error_url_is_not_reported_as_missing_cards(monkeypatch):
    page = FakePage([''], url='https://shopee.vn/verify/traffic/error')
    browser = setup_browser(monkeypatch, page)
    with pytest.raises(CrawlBlocked, match='/verify/traffic/error'):
        crawl_worker.crawl_public_shop('https://shopee.vn/test_shop', 'Shop test')
    assert page.scrolls == 0
    assert browser.closed


def test_empty_page_reports_where_it_failed_after_bounded_wait(monkeypatch):
    page = FakePage(['<html><body>Shop chưa hiển thị sản phẩm</body></html>'])
    browser = setup_browser(monkeypatch, page)
    with pytest.raises(CrawlError, match='link sản phẩm: 0'):
        crawl_worker.crawl_public_shop(page.url, 'Shop test', max_scrolls=0)
    assert page.elapsed == 15
    assert browser.closed


def test_http_404_is_reported_before_parsing(monkeypatch):
    page = FakePage([''], status=404)
    browser = setup_browser(monkeypatch, page)
    with pytest.raises(CrawlBlocked, match='HTTP: 404'):
        crawl_worker.crawl_public_shop(page.url, 'Shop test')
    assert browser.closed


def test_assisted_mode_waits_for_manual_login_and_ignores_homepage_products(monkeypatch, tmp_path):
    class ManualPage(FakePage):
        def goto(self, *args, **kwargs):
            response = super().goto(*args, **kwargs)
            self.url = 'https://shopee.vn/buyer/login'
            return response

        def wait_for_timeout(self, milliseconds):
            super().wait_for_timeout(milliseconds)
            self.url = ('https://shopee.vn/test_shop' if self.elapsed >= 2 else 'https://shopee.vn/')

        def content(self):
            return card(999, 'Sản phẩm trang chủ') if self.url.endswith('.vn/') else card(2, 'Áo thun')

    page = ManualPage([])
    browser = setup_browser(monkeypatch, page)
    notes = []
    profile = tmp_path / 'profile'
    products = crawl_worker.crawl_public_shop('https://shopee.vn/test_shop', 'Shop test', max_scrolls=0,
                                             interactive=True, user_data_dir=profile, on_status=notes.append)
    assert [product['sku'] for product in products] == ['1.2']
    assert any('đăng nhập' in note for note in notes)
    assert page.goto_calls == 1
    assert browser.launch_options['headless'] is False
    assert browser.launch_options['user_data_dir'] == str(profile)
    assert browser.closed


def test_assisted_block_times_out_without_reloading_or_fabricating_data(monkeypatch, tmp_path):
    page = FakePage([''], url='https://shopee.vn/verify/traffic/error')
    browser = setup_browser(monkeypatch, page)
    notes = []
    with pytest.raises(CrawlBlocked, match='Hết 3 phút.*chặn lưu lượng'):
        crawl_worker.crawl_public_shop('https://shopee.vn/test_shop', 'Shop test', max_scrolls=0,
                                      interactive=True, user_data_dir=tmp_path, on_status=notes.append)
    assert page.elapsed == 180
    assert page.goto_calls == 1
    assert page.scrolls == 0
    assert len(notes) == 2  # Initial instructions and one block note, not 180 duplicate writes.
    assert browser.closed


def test_user_can_stop_assisted_collection_by_closing_browser(monkeypatch, tmp_path):
    class ClosedPage(FakePage):
        def wait_for_timeout(self, milliseconds):
            super().wait_for_timeout(milliseconds)
            self.closed = True
    page = ClosedPage([''], url='https://shopee.vn/verify/traffic/error')
    browser = setup_browser(monkeypatch, page)
    with pytest.raises(CrawlError, match='Đã đóng trình duyệt hỗ trợ'):
        crawl_worker.crawl_public_shop('https://shopee.vn/test_shop', 'Shop test', interactive=True,
                                      user_data_dir=tmp_path)
    assert page.elapsed == 1
    assert browser.closed


def test_saved_profile_can_be_used_by_background_collection(monkeypatch, tmp_path):
    page = FakePage([card(1, 'Áo thun')])
    browser = setup_browser(monkeypatch, page)
    products = crawl_worker.crawl_public_shop(page.url, 'Shop test', max_scrolls=0, user_data_dir=tmp_path)
    assert len(products) == 1
    assert browser.launch_options['headless'] is True
    assert browser.closed
