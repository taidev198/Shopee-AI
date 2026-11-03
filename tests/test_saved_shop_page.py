import pytest

import crawl_worker
from crawl_worker import CrawlError, extract_saved_shop_page


SHOP_URL = 'https://shopee.vn/test_shop'


def card(item=2, name='Áo thun'):
    return f'<a href="/product/1/{item}"><img alt="{name}">₫89.000 <span>Đã bán 1,2k</span></a>'


def test_reads_saved_rendered_cards_without_network_or_scripts(monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError('Saved HTML import must not make network requests')

    monkeypatch.setattr(crawl_worker, 'urlopen', no_network)
    monkeypatch.setattr(crawl_worker, 'robots_allowed', no_network)
    html = f'''<html><head>
        <link rel="canonical" href="{SHOP_URL}">
        <meta property="og:url" content="{SHOP_URL}/?page=1">
        <script src="https://example.com/remote.js"></script>
        <script>throw new Error("Access denied; Verify you are human");</script>
        </head><body>{card()}</body></html>'''

    products = extract_saved_shop_page(html, SHOP_URL, 'Shop test', 'Áo')

    assert len(products) == 1
    assert products[0]['sku'] == '1.2'
    assert products[0]['product_url'] == 'https://shopee.vn/product/1/2'
    assert products[0]['source_shop'] == 'Shop test'
    assert products[0]['category'] == 'Áo'
    assert products[0]['price'] == 89000
    assert products[0]['sold_total'] == 1200
    assert products[0]['units_30d'] is None
    assert products[0]['revenue_30d'] is None


@pytest.mark.parametrize('metadata', [
    '<link rel="CANONICAL" href="/test_shop/">',
    '<meta property="og:url" content="https://www.shopee.vn/TEST_SHOP">',
    '<meta name="og:url" content="/test_shop?page=2">',
    '',
])
def test_accepts_same_shop_metadata_and_html_without_metadata(metadata):
    products = extract_saved_shop_page(metadata + card(), SHOP_URL, 'Shop test')
    assert len(products) == 1


@pytest.mark.parametrize('metadata', [
    '<link rel="canonical" href="/other_shop">',
    '<meta property="og:url" content="/other_shop">',
    '<link rel="canonical" href="/test_shop"><meta property="og:url" content="/other_shop">',
])
def test_rejects_different_shop_even_with_product_cards(metadata):
    with pytest.raises(CrawlError, match='không thuộc shop'):
        extract_saved_shop_page(metadata + card(), SHOP_URL, 'Shop test')


@pytest.mark.parametrize('source, reason', [
    ('https://example.com/test_shop', 'ngoài Shopee'),
    ('https://shopee.vn/buyer/login', 'đăng nhập'),
    ('https://shopee.vn/verify/traffic/error?is_logged_in=true', 'chặn lưu lượng'),
    ('http://shopee.vn/test_shop', 'không phải trang shop'),
    ('https://user:secret@shopee.vn/test_shop', 'không phải trang shop'),
    ('https://shopee.vn:443/test_shop', 'không phải trang shop'),
    ('https://shopee.vn:invalid/test_shop', 'không phải trang shop'),
])
def test_rejects_error_or_invalid_source_urls(source, reason):
    with pytest.raises(CrawlError, match=reason):
        extract_saved_shop_page(f'<link rel="canonical" href="{source}">' + card(), SHOP_URL, 'Shop test')


@pytest.mark.parametrize('html, reason', [
    ('<h1>Access denied</h1>', 'chặn truy cập'),
    ('<h1>Verify you are human</h1>', 'xác minh'),
    ('<form><input type="password"></form>', 'đăng nhập'),
    ('<html><body>Đang tải sản phẩm</body></html>', 'chưa chứa thẻ sản phẩm'),
    ('<script>document.write("product/1/2")</script>', 'chưa chứa thẻ sản phẩm'),
])
def test_rejects_error_documents_or_missing_rendered_cards(html, reason):
    with pytest.raises(CrawlError, match=reason):
        extract_saved_shop_page(html, SHOP_URL, 'Shop test')


def test_ignores_hidden_and_template_cards():
    hidden = f'''<template>{card(3)}</template><div hidden>{card(4)}</div>
        <div aria-hidden="true">{card(5)}</div><div style="display: none">{card(6)}</div>
        <div style="visibility:hidden">{card(7)}</div>'''
    products = extract_saved_shop_page(hidden + card(2), SHOP_URL, 'Shop test')
    assert [product['sku'] for product in products] == ['1.2']


def test_nested_styled_children_of_removed_hidden_parent_do_not_crash():
    html = f'''<div style="display:none">
        <span style="color:red">Access denied</span>
        <div style="display:none">{card(3)}</div>
        <a style="color:blue" href="/product/1/4"><img alt="Ẩn">₫99.000</a>
        </div>{card(2)}'''
    products = extract_saved_shop_page(html, SHOP_URL, 'Shop test')
    assert [product['sku'] for product in products] == ['1.2']


def test_deduplicates_cards_and_caps_saved_products_at_150():
    html = ''.join(card(item) for item in range(200)) + card(1)
    products = extract_saved_shop_page(html, SHOP_URL, 'Shop test')
    assert len(products) == 150
    assert len({product['sku'] for product in products}) == 150


def test_validates_target_before_parsing_saved_file():
    with pytest.raises(ValueError, match='HTTPS shop Shopee'):
        extract_saved_shop_page(card(), 'https://example.com/test_shop', 'Shop test')
