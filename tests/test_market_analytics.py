import json
import math

import pytest

from market_analytics import build_analytics, product_metrics, latest_product_rows


CATEGORIES = [
    {'id': 'a', 'name': 'Gia dụng', 'url': 'https://shopee.vn/Gia-dung-cat.1'},
    {'id': 'b', 'name': 'Thời trang', 'url': 'https://shopee.vn/Thoi-trang-cat.2'},
    {'id': 'c', 'name': 'Chưa quét', 'url': 'https://shopee.vn/Chua-quet-cat.3'},
]


def row(sku='10.1', day='2026-10-14', category_id='a', **values):
    return {'sku': sku, 'day': day, 'category_id': category_id,
            'category': next((cat['name'] for cat in CATEGORIES if cat['id'] == category_id), ''),
            'name': f'Sản phẩm {sku}', 'url': 'https://shopee.vn/product/' + sku.replace('.', '/'),
            'collected_at': day + 'T09:00:00+07:00', 'price': 100000,
            'sold_total': 10, 'sold_approx': 0, 'rating': 4.8, 'review_count': 3,
            'raw_json': '{}', **values}


def analyse(rows, **values):
    return build_analytics(rows, CATEGORIES, [], **values)


def test_empty_database_preserves_all_category_choices_and_unknown_prices():
    data = analyse([])
    assert data['summary']['product_count'] == data['summary']['snapshot_count'] == 0
    assert data['summary']['category_count'] == 0
    assert data['summary']['catalog_category_count'] == 3
    assert {cat['id'] for cat in data['categories']} == {'a', 'b', 'c'}
    assert all(cat['product_count'] == 0 and cat['sold_total'] is None for cat in data['categories'])
    assert all(band['count'] == 0 and band['min'] is None for band in data['price_bands'])
    assert data['basis']['window_start'] is None and data['basis']['window_end'] is None
    assert data['top_products'] == data['top_shops'] == data['trend_candidates'] == data['history'] == []


def test_one_day_rounded_counters_rank_as_cumulative_sales_without_inventing_growth():
    data = analyse([row(sold_total=1000, sold_approx=1), row('20.1', sold_total=500, sold_approx=1)])
    assert data['summary']['approx_sales_count'] == 2
    assert data['summary']['exact_sales_count'] == data['summary']['history_ready_count'] == 0
    assert data['summary']['day_count'] == 1
    assert data['trend_candidates'] == []
    assert all(product['velocity'] is None and product['trend_score'] is None for product in data['top_products'])
    assert data['basis']['sales'] == 'public_cumulative'
    assert 'cộng dồn' in data['basis']['sales_label']
    assert data['history'] == [{'day': '2026-10-14', 'product_count': 2, 'sold_known': 2, 'exact_count': 0}]


def test_cross_category_membership_is_filtered_before_deduping_global_product_and_shop_counts():
    rows = [row(price=100, sold_total=10), row(category_id='b', price=200, sold_total=20,
                                           collected_at='2026-10-14T10:00:00+07:00')]
    global_data = analyse(rows)
    assert global_data['summary']['product_count'] == global_data['summary']['snapshot_count'] == 1
    assert global_data['summary']['shop_count'] == 1 and global_data['summary']['category_count'] == 2
    assert global_data['top_products'][0]['price'] == 200
    assert global_data['top_shops'][0]['sold_total'] == 20
    categories = {cat['id']: cat for cat in global_data['categories']}
    assert categories['a']['product_count'] == categories['b']['product_count'] == 1
    assert categories['a']['sold_total'] == 10 and categories['b']['sold_total'] == 20
    filtered = analyse(rows, category_id='a')
    assert filtered['top_products'][0]['category_id'] == 'a' and filtered['top_products'][0]['price'] == 100
    assert filtered['top_shops'][0]['sold_total'] == 10
    assert len(filtered['categories']) == 3


def test_time_window_is_anchored_to_latest_saved_day_and_not_current_clock_or_selected_category():
    data = analyse([row(day='2026-10-01'), row('20.1', day='2026-10-20', category_id='b')], days=7)
    assert data['basis']['window_start'] == '2026-10-14'
    assert data['basis']['window_end'] == '2026-10-20'
    assert data['summary']['product_count'] == 1
    assert data['top_products'][0]['sku'] == '20.1'
    filtered = analyse([row(day='2026-10-01'), row('20.1', day='2026-10-20', category_id='b')], category_id='a', days=7)
    assert filtered['summary']['product_count'] == 0
    assert filtered['basis']['window_end'] == '2026-10-20'
    assert len(filtered['categories']) == 3


def test_exact_observed_growth_uses_elapsed_days_and_requires_three_distinct_days():
    rows = [row(day=f'2026-10-{day:02}', sold_total=sold) for day, sold in [(1, 10), (3, 30), (5, 90)]]
    data = analyse(rows)
    product = data['top_products'][0]
    assert product['observation_days'] == 3
    assert product['velocity'] == 30 and product['acceleration'] == 20
    assert product['trend_score'] > 0
    assert data['trend_candidates'] == [product]
    assert data['summary']['history_ready_count'] == 1
    assert 'không phải dự báo' in product['reason']
    two_days = analyse(rows, days=3)['top_products'][0]
    assert two_days['velocity'] == 30 and two_days['trend_score'] is None
    assert two_days['observation_days'] == 2
    assert analyse(rows, days=3)['trend_candidates'] == []


@pytest.mark.parametrize('values', [
    [(10, 1), (30, 1), (90, 1)],
    [(10, 1), (30, 0), (90, 0)],
    [(100, 0), (30, 0), (90, 0)],
    [(10, 0), (30, 0), (20, 0)],
    [(None, 0), (30, 0), (90, 0)],
])
def test_rounded_missing_and_reset_counters_cannot_become_hot_trends(values):
    rows = [row(day=f'2026-10-{index + 1:02}', sold_total=sold, sold_approx=approx)
            for index, (sold, approx) in enumerate(values)]
    data = analyse(rows)
    assert data['trend_candidates'] == []
    assert data['top_products'][0]['trend_score'] is None
    assert data['summary']['history_ready_count'] == 0


def test_flat_exact_history_is_ready_but_is_not_ranked_as_growth():
    data = analyse([row(day=f'2026-10-{day:02}', sold_total=10) for day in (1, 2, 3)])
    assert data['top_products'][0]['trend_score'] == data['top_products'][0]['velocity'] == 0
    assert data['summary']['history_ready_count'] == 1
    assert data['trend_candidates'] == []


def test_sales_ranking_is_separate_from_growth_and_unknown_sales_sort_last():
    rows = [row('10.1', sold_total=None), row('20.1', sold_total=100000, sold_approx=1),
            *[row('30.1', day=f'2026-10-{day:02}', sold_total=sold) for day, sold in [(12, 10), (13, 20), (14, 60)]]]
    data = analyse(rows)
    assert [product['sku'] for product in data['top_products']] == ['20.1', '30.1', '10.1']
    assert [product['sku'] for product in data['trend_candidates']] == ['30.1']


def test_missing_nonfinite_and_negative_numbers_stay_null_and_json_is_strictly_finite():
    data = analyse([row(price=math.inf, sold_total=math.nan, review_count=-1, rating=7),
                    row('20.1', price=-100, sold_total=True, review_count='4', rating=-1)])
    for product in data['top_products']:
        assert product['price'] is product['sold_total'] is product['review_count'] is product['rating'] is None
    assert data['top_shops'][0]['sold_total'] is None
    assert data['summary']['exact_sales_count'] == data['summary']['approx_sales_count'] == 0
    json.dumps(data, allow_nan=False)
    overflow = analyse([row(sold_total=1e308), row('10.2', sold_total=1e308)])
    assert overflow['top_shops'][0]['sold_total'] is None
    json.dumps(overflow, allow_nan=False)


def test_known_zero_is_distinct_from_missing_and_price_band_counts_cover_every_known_price():
    data = analyse([row(price=0, sold_total=0, review_count=0, rating=0),
                    row('10.2', price=None, sold_total=None), row('20.1', price=100), row('30.1', price=400)])
    category = next(cat for cat in data['categories'] if cat['id'] == 'a')
    assert category['price_min'] == 0 and category['price_median'] == 100 and category['price_max'] == 400
    assert category['sold_known'] == 3
    assert len(data['price_bands']) == 4
    assert sum(band['count'] for band in data['price_bands']) == 3
    equal = analyse([row(price=100), row('20.1', price=100)])
    assert sum(band['count'] for band in equal['price_bands']) == 2


def test_shop_grouping_uses_unique_latest_skus_and_only_saved_public_identity():
    rows = [row(raw_json=json.dumps({'shop_name': 'Cửa hàng thật', 'shop_url': 'https://shopee.vn/real_shop?tracking=1'})),
            row(day='2026-10-13', sold_total=1), row('10.2', sold_total=30, price=300000),
            row('20.1', raw_json=json.dumps({'shop_url': 'https://u:p@shopee.vn/evil'}))]
    data = analyse(rows)
    shops = {shop['shop_id']: shop for shop in data['top_shops']}
    assert shops['10']['product_count'] == 2 and shops['10']['sold_total'] == 40
    assert shops['10']['review_count'] == 6 and shops['10']['price_median'] == 200000
    assert shops['10']['shop_name'] == 'Cửa hàng thật' and shops['10']['shop_url'] == 'https://shopee.vn/real_shop'
    assert shops['20']['shop_name'] == 'Shop #20' and shops['20']['shop_url'] == 'https://shopee.vn/shop/20'
    assert all('raw_json' not in product for product in data['top_products'])


def test_same_day_duplicate_selects_latest_instant_across_timezones_and_does_not_fake_extra_history():
    data = analyse([row(price=100, collected_at='2026-10-14T10:00:00+07:00'),
                    row(price=200, collected_at='2026-10-14T04:00:00+00:00')])
    assert data['summary']['snapshot_count'] == 1 and data['summary']['day_count'] == 1
    assert data['top_products'][0]['price'] == 200
    assert data['top_products'][0]['observation_days'] == 1
    assert data['summary']['latest_at'] == '2026-10-14T04:00:00+00:00'


def test_invalid_identity_date_raw_payload_and_url_cannot_leak_into_product_links():
    valid = row(url='javascript:alert(1)', raw_json='["not a detail object"]')
    data = analyse([valid, row('invalid'), row(day='2026-02-30'), row('0.1'), row('1.0')])
    assert data['summary']['product_count'] == 1
    assert data['top_products'][0]['url'] == 'https://shopee.vn/product/10/1'
    assert 'raw_json' not in json.dumps(data)


def test_all_product_metrics_are_not_truncated_and_match_builder_filters():
    rows = [row(f'10.{index + 1}', sold_total=index) for index in range(40)]
    data = analyse(rows, limit=3)
    assert data['summary']['product_count'] == 40 and len(data['top_products']) == 3
    metrics = product_metrics(rows, 'a', 7)
    assert len(metrics) == 40 and latest_product_rows(rows, 'a', 7) == metrics
    assert {product['sku'] for product in data['top_products']} <= {product['sku'] for product in metrics}
    assert product_metrics(rows, 'b') == []


def test_run_coverage_respects_selected_category_without_changing_snapshot_counts():
    runs = [{'category_id': 'a', 'status': 'pending', 'discovered': 10, 'completed': 4},
            {'category_id': 'a', 'status': 'paused', 'discovered': 2, 'completed': 1},
            {'category_id': 'b', 'status': 'done', 'discovered': 3, 'completed': 3}]
    data = build_analytics([row()], CATEGORIES, runs, category_id='a')
    assert data['coverage'] == {'runs': 2, 'pending': 1, 'paused': 1, 'done': 0, 'partial': 0, 'discovered': 12, 'completed': 5}
    assert data['summary']['product_count'] == data['summary']['snapshot_count'] == 1


def test_exact_review_growth_is_explicit_fallback_when_public_sales_are_rounded():
    rows = [row(day=f'2026-10-{day:02}', sold_total=1000, sold_approx=1, review_count=reviews,
                raw_json=json.dumps({'review_count_text': f'{reviews} ratings'}))
            for day, reviews in [(1, 10), (3, 14), (5, 24)]]
    data = analyse(rows)
    product = data['top_products'][0]
    assert product['review_approx'] == 0
    assert product['velocity'] is None and product['acceleration'] is None
    assert product['review_velocity'] == 5 and product['review_acceleration'] == 3
    assert product['trend_basis'] == 'reviews' and product['trend_score'] > 0
    assert data['trend_candidates'] == [product]
    assert 'lượt đánh giá' in product['reason'] and 'không phải số bán hay dự báo' in product['reason']
    assert data['summary']['history_ready_count'] == 1
    assert data['top_shops'][0]['review_known'] == 1 and data['top_shops'][0]['review_approx_count'] == 0


@pytest.mark.parametrize('text', ['1k ratings', '1.2K ratings', '2m ratings', '1.000+ ratings', ''])
def test_rounded_or_unproven_review_precision_cannot_supply_growth(text):
    rows = [row(day=f'2026-10-{day:02}', sold_total=1000, sold_approx=1, review_count=reviews,
                raw_json=json.dumps({'review_count_text': text}))
            for day, reviews in [(1, 1000), (2, 1200), (3, 1400)]]
    data = analyse(rows)
    assert data['top_products'][0]['review_approx'] == 1
    assert data['top_products'][0]['review_velocity'] is None
    assert data['top_products'][0]['trend_basis'] is None
    assert data['trend_candidates'] == []
    assert data['top_shops'][0]['review_approx_count'] == 1


@pytest.mark.parametrize('counts', [[10, 5, 20], [10, 20, 5], [10, None, 20]])
def test_review_counter_reset_or_missing_day_is_not_a_growth_fallback(counts):
    data = analyse([row(day=f'2026-10-{index + 1:02}', sold_total=1000, sold_approx=1, review_count=count,
                        raw_json=json.dumps({'review_count_text': f'{count} ratings'}))
                    for index, count in enumerate(counts)])
    assert data['top_products'][0]['trend_score'] is None
    assert data['top_products'][0]['trend_basis'] is None
    assert data['trend_candidates'] == []


def test_sales_growth_takes_priority_when_both_exact_counters_have_history():
    data = analyse([row(day=f'2026-10-{index + 1:02}', sold_total=sold, review_count=reviews,
                        raw_json=json.dumps({'review_count_text': f'{reviews} ratings'}))
                    for index, (sold, reviews) in enumerate([(10, 10), (20, 30), (40, 90)])])
    product = data['top_products'][0]
    assert product['trend_basis'] == 'sales'
    assert product['velocity'] == 20 and product['review_velocity'] == 60


def test_flat_review_fallback_does_not_claim_increasing_activity():
    data = analyse([row(day=f'2026-10-{day:02}', sold_total=1000,sold_approx=1,review_count=10,
                        raw_json=json.dumps({'review_count_text':'10 ratings'})) for day in (1,2,3)])
    assert data['top_products'][0]['trend_basis']=='reviews'
    assert data['top_products'][0]['trend_score']==0
    assert 'chưa tăng' in data['top_products'][0]['reason']
    assert data['trend_candidates']==[]
