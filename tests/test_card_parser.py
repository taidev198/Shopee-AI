import pytest

from crawl_worker import extract_public_cards


def parse(html):
    return extract_public_cards(html, 'https://shopee.vn/test_shop', 'Test shop')


@pytest.mark.parametrize('name_markup', [
    '<img alt="Áo thun">',
    '<div data-sqe="name">Áo</div>',
    'Áo thun',
])
def test_short_product_names_are_not_discarded(name_markup):
    rows = parse(f'<a href="/Ao-thun-i.123.456">{name_markup}<span>₫89.000</span></a>')
    assert len(rows) == 1
    assert rows[0]['name'] in ('Áo thun', 'Áo')
    assert rows[0]['price'] == 89000


@pytest.mark.parametrize('attribute', ['title', 'aria-label'])
def test_product_name_can_be_on_link_itself(attribute):
    rows = parse(f'<a href="/product/123/456" {attribute}="Áo thun">₫89.000</a>')
    assert len(rows) == 1
    assert rows[0]['name'] == 'Áo thun'


@pytest.mark.parametrize('wrapper_attribute', [
    'data-sqe="item"',
    'class="shop-search-result-view__item"',
    'class="shopee-search-item-result__item"',
    'class="shopee-search-item-result"',
])
def test_overlay_link_can_read_sibling_fields_in_one_known_card(wrapper_attribute):
    rows = parse(f'''
        <div {wrapper_attribute}>
          <a href="/Ao-thun-i.123.456"></a>
          <img alt="Áo thun">
          <span>₫89.000</span><span>Đã bán 1,2k</span>
        </div>
    ''')
    assert len(rows) == 1
    assert rows[0]['name'] == 'Áo thun'
    assert rows[0]['price'] == 89000
    assert rows[0]['sold_total'] == 1200
    assert rows[0]['units_30d'] is None
    assert rows[0]['revenue_30d'] is None


def test_known_wrapper_supplies_price_when_link_only_contains_image():
    rows = parse('''
        <div data-sqe="item">
          <a href="/Ao-thun-i.123.456"><img alt="Áo thun"></a>
          <span>₫89.000</span><span>Đã bán 20</span>
        </div>
    ''')
    assert rows[0]['price'] == 89000
    assert rows[0]['sold_total'] == 20


def test_generic_parent_is_not_assumed_to_be_a_product_card():
    assert parse('''
        <div class="page-section">
          <a href="/Ao-thun-i.123.456"></a>
          <img alt="Unrelated page banner"><span>₫89.000</span>
        </div>
    ''') == []


def test_parent_containing_multiple_products_does_not_mix_their_fields():
    assert parse('''
        <div data-sqe="item">
          <a href="/Ao-thun-i.123.456"></a>
          <a href="/Ao-khoac-i.123.789"></a>
          <img alt="Áo khoác"><span>₫189.000</span>
        </div>
    ''') == []


def test_card_ancestor_search_is_bounded():
    link = '<a href="/Ao-thun-i.123.456"></a>'
    for _ in range(4):
        link = f'<div>{link}</div>'
    assert parse(f'<div data-sqe="item">{link}<img alt="Áo thun"></div>') == []


def test_product_ids_are_matched_only_in_the_link_path():
    rows = parse('''
        <a href="/search?next=/product/123/456"><img alt="Search banner"></a>
        <a href="/test_shop?product=Ao-thun-i.123.456"><img alt="Shop banner"></a>
        <a href="/product/123/789?tracking=Ao-thun-i.999.111"><img alt="Áo thun"></a>
    ''')
    assert [row['sku'] for row in rows] == ['123.789']


@pytest.mark.parametrize('metadata', ['89.000', '₫89.000', 'Đã bán 20', 'Sold 20', '39 sold', '1k+ sold', '797 Sold/Month'])
def test_prices_and_sales_labels_are_not_used_as_product_names(metadata):
    assert parse(f'<a href="/Ao-thun-i.123.456">{metadata}</a>') == []


@pytest.mark.parametrize(('sales_label', 'expected'), [
    ('39 sold', 39),
    ('1k+ sold', 1000),
    ('1.2k sold', 1200),
    ('1,2k+ SOLD', 1200),
    ('Sold 39', 39),
    ('Sold 1k+', 1000),
])
def test_english_cumulative_sold_counts(sales_label, expected):
    rows = parse(f'<a href="/product/123/456"><img alt="Áo thun">₫89.000 {sales_label}</a>')
    assert rows[0]['sold_total'] == expected
    assert rows[0]['units_30d'] is None
    assert rows[0]['revenue_30d'] is None


@pytest.mark.parametrize('sales_label', [
    '797 Sold/Month', '797 Sold / Month', '1k+ sold/month',
    'Sold/Month 797', 'Sold 797/Month', 'Sold 1k+ / Month',
])
def test_monthly_sold_labels_are_not_cumulative_or_30_day_sales(sales_label):
    rows = parse(f'<a href="/product/123/456"><img alt="Áo thun">₫89.000 {sales_label}</a>')
    assert rows[0]['sold_total'] is None
    assert rows[0]['units_30d'] is None
    assert rows[0]['revenue_30d'] is None


@pytest.mark.parametrize('labels', ['797 Sold/Month 39 sold', '39 sold 797 Sold/Month'])
def test_mixed_monthly_and_cumulative_labels_only_read_cumulative_count(labels):
    rows = parse(f'<a href="/product/123/456"><img alt="Áo thun">₫89.000 {labels}</a>')
    assert rows[0]['sold_total'] == 39


@pytest.mark.parametrize('monthly_first', [True, False])
def test_duplicate_monthly_and_regular_cards_fill_missing_fields(monthly_first):
    monthly = '<a href="/product/123/456"><img alt="Áo thun">₫89.000 797 Sold/Month</a>'
    cumulative = '<a href="/product/123/456"><img alt="Áo thun">1k+ sold</a>'
    rows = parse(monthly + cumulative if monthly_first else cumulative + monthly)
    assert len(rows) == 1
    assert rows[0]['price'] == 89000
    assert rows[0]['sold_total'] == 1000
    assert rows[0]['units_30d'] is None


def test_duplicate_cards_keep_known_values_when_filling_a_missing_count():
    rows = parse('''
        <a href="/product/123/456"><img alt="Áo thun">₫89.000 797 Sold/Month</a>
        <a href="/product/123/456"><img alt="Áo khác">₫99.000 39 sold</a>
    ''')
    assert len(rows) == 1
    assert rows[0]['price'] == 89000
    assert rows[0]['name'] == 'Áo thun'
    assert rows[0]['sold_total'] == 39
