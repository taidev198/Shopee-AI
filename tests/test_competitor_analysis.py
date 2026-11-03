import importlib

import pytest
from fastapi.testclient import TestClient

from competitor_analysis import (enrich_product, without_self, discovery_queries, price_range,
                                 product_comparisons, product_query)


@pytest.fixture
def analysis_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'analysis.db'))
    import app
    app = importlib.reload(app)
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={
        'url': 'https://shopee.vn/my_shop', 'category': 'Kitchen',
    }).json()
    return app, client, shop


def product(sku='one', source='Other shop', **overrides):
    item = dict(sku=sku, source_shop=source, name='Product ' + sku, category='Kitchen',
                price=100, units_30d=None, revenue_30d=None, sold_total=None,
                views_30d=None, rating=None, review_count=None, cost=None, stock=None,
                product_url='', snapshot_date='2026-10-14', detail=None)
    item.update(overrides)
    return item


def insert(app, shop, role, products, snapshot='2026-10-14'):
    with app.db() as connection:
        app.insert_obs(connection, shop['id'], role, products, snapshot, 'user_import')


def saved_detail(**overrides):
    item = dict(status='done', categories=['Shopee', 'Home & Living', 'Kitchen'],
                rating_text='4.9', review_count_text='119 Ratings', sold_text='1k+ Sold',
                price_text='999.000₫', collected_at='2026-10-14T10:00:00', last_error='')
    item.update(overrides)
    return item


def test_detail_metrics_fill_missing_observations_without_replacing_listing_price():
    item = enrich_product(product(category='Chưa phân loại', detail=saved_detail()))
    assert item['category'] == 'Kitchen'
    assert item['category_path'] == ['Home & Living', 'Kitchen']
    assert item['rating'] == 4.9
    assert item['review_count'] == 119
    assert item['sold_total'] == 1000
    assert item['sold_lower_bound'] is True
    assert item['sold_total_source'] == 'product_detail'
    assert item['price'] == 100
    assert item['units_30d'] is None and item['revenue_30d'] is None


def test_observed_zero_and_categories_are_preserved():
    item = enrich_product(product(category='Imported category', rating=0, review_count=0,
                                  sold_total=0, detail=saved_detail()))
    assert item['category'] == 'Imported category'
    assert item['rating'] == item['review_count'] == item['sold_total'] == 0
    assert item['rating_source'] == 'observation'
    assert item['sold_lower_bound'] is False


def test_detail_freshness_and_unparseable_values():
    item = enrich_product(product(detail=saved_detail(
        collected_at='2026-10-13T10:00:00', rating_text='9.9',
        sold_text='1k - 2k Sold', review_count_text='See 99 Ratings')))
    assert item['detail_stale'] is True
    assert item['rating'] is item['sold_total'] is item['review_count'] is None
    assert enrich_product(product(detail=saved_detail(last_error='blocked')))['detail_stale'] is True
    failed = enrich_product(product(detail=saved_detail(status='failed')))
    assert failed['rating'] is None and failed['category_path'] == []


def test_even_medians_partial_coverage_and_zero_totals(analysis_app):
    app, _, shop = analysis_app
    insert(app, shop, 'own', [product('own1', 'my_shop', price=10), product('own2', 'my_shop', price=30)])
    insert(app, shop, 'market', [
        product('m1', 'Shop A', price=20, sold_total=0, units_30d=0, rating=4.5, review_count=0),
        product('m2', 'shop_a', price=40), product('m3', 'Shop A', price=None),
    ])
    analysis = app.report(shop['id'])['competitor_analysis']
    assert analysis['summary'] == dict(shop_count=1, product_count=3, own_product_count=2,
                                      own_median_price=20, market_median_price=30,
                                      price_count=2, rating_count=1, sold_count=1, monthly_count=1)
    seller = analysis['shops'][0]
    assert seller['median_price'] == 30
    assert seller['sold_total_sum'] == seller['units_30d_sum'] == seller['review_count_sum'] == 0
    assert seller['sold_count'] == seller['monthly_count'] == seller['review_count_known'] == 1
    assert seller['rating_mean'] == 4.5 and seller['rating_count'] == 1
    assert analysis['categories'][0]['gap_pct'] == 50


def test_missing_metrics_remain_unknown_in_shop_summary(analysis_app):
    app, _, shop = analysis_app
    insert(app, shop, 'market', [product(price=None)])
    seller = app.report(shop['id'])['competitor_analysis']['shops'][0]
    for field in ('median_price', 'rating_mean', 'sold_total_sum', 'units_30d_sum', 'review_count_sum'):
        assert seller[field] is None
    assert seller['price_count'] == seller['rating_count'] == seller['monthly_count'] == 0


def test_review_only_recommendations_are_explicitly_weak(analysis_app):
    app, _, shop = analysis_app
    insert(app, shop, 'own', [product('own', 'my_shop')])
    insert(app, shop, 'market', [product('new', review_count=100)])
    candidate = app.report(shop['id'])['competitor_analysis']['recommendations'][0]
    assert candidate['is_provisional'] is True and candidate['confidence'] == 'Rất thấp'
    assert candidate['score'] <= 65 and candidate['demand_score'] > 0
    assert 'Chỉ có lượt đánh giá' in candidate['reasons'][0]
    assert candidate['sold_total'] is candidate['units_30d'] is None


def test_price_comparison_uses_corresponding_category(analysis_app):
    app, _, shop = analysis_app
    insert(app, shop, 'own', [product('kitchen', 'my_shop', price=100),
                              product('beauty', 'my_shop', price=10000, category='Beauty')])
    insert(app, shop, 'market', [product('new', price=100, sold_total=50)])
    candidate = app.report(shop['id'])['competitor_analysis']['recommendations'][0]
    assert candidate['category_match'] == 'exact'
    assert candidate['own_category_median_price'] == 100
    assert candidate['price_gap_pct'] == 0 and candidate['price_fit'] == 100


def test_parent_category_match_is_disclosed_and_no_match_is_omitted(analysis_app):
    app, _, shop = analysis_app
    own = enrich_product(product('own', 'my_shop', category='Chưa phân loại', detail=saved_detail(
        categories=['Shopee', 'Home', 'Kitchen', 'Baking'])))
    market = enrich_product(product('new', category='Chưa phân loại', sold_total=10, detail=saved_detail(
        categories=['Shopee', 'Home', 'Kitchen', 'Pans'])))
    ranked = app.rank_recommendations([own], [market], shop, app.candidate_score, .12, .08)
    assert ranked[0]['category_match'] == 'parent'
    assert ranked[0]['comparison_category'] == 'Kitchen'
    assert any('Chỉ trùng nhóm rộng Kitchen' in reason for reason in ranked[0]['reasons'])
    other = product('unrelated', category='Beauty', sold_total=200)
    assert app.rank_recommendations([own], [other], shop, app.candidate_score, .12, .08) == []


def test_unclassified_categories_do_not_claim_price_comparability(analysis_app):
    app, _, shop = analysis_app
    insert(app, shop, 'own', [product('own', 'my_shop', category='Chưa phân loại')])
    insert(app, shop, 'market', [product('new', category='Chưa phân loại', sold_total=100)])
    analysis = app.report(shop['id'])['competitor_analysis']
    assert analysis['categories'][0]['gap_pct'] is None
    assert analysis['recommendations'] == []


def test_analysis_counts_full_sample_beyond_visible_product_limit(analysis_app):
    app, _, shop = analysis_app
    insert(app, shop, 'market', [product(str(index), price=index + 1) for index in range(301)])
    report = app.report(shop['id'])
    assert len(report['market_products']) == 300
    assert report['market_products_total'] == report['kpis']['market_products'] == 301
    assert report['market_products_truncated'] is True
    assert report['competitor_analysis']['summary']['product_count'] == 301
    assert report['competitor_analysis']['shops'][0]['median_price'] == 151


def test_self_source_excluded_but_shared_imported_sku_from_another_shop_is_preserved():
    own = [product('shared', 'My Shop')]
    market = [product('self', 'my_shop'), product('shared', 'Other Shop')]
    result = without_self(own, market, {'name': 'My Shop', 'url': 'https://shopee.vn/my_shop'})
    assert [item['source_shop'] for item in result] == ['Other Shop']


@pytest.mark.parametrize('upper_case', [False, True])
def test_cannot_start_competitor_crawl_from_own_shop_url(analysis_app, upper_case):
    _, client, shop = analysis_app
    response = client.post('/api/crawl/jobs', json={
        'shop_id': shop['id'], 'role': 'market', 'browser': 'chrome',
        'target_url': shop['url'].replace('my_shop', 'MY_SHOP') if upper_case else shop['url'],
    })
    assert response.status_code == 422
    assert 'URL shop đối thủ khác' in response.json()['detail']


def test_cannot_schedule_own_shop_as_a_competitor(analysis_app):
    _, client, shop = analysis_app
    response = client.post('/api/crawl/schedules', json={
        'shop_id': shop['id'], 'role': 'market', 'target_url': shop['url'], 'interval_hours': 24,
    })
    assert response.status_code == 422


def test_discovery_queries_use_dominant_catalog_categories_and_representative_products():
    own = [
        product('one', name="[family's house] Rây lọc thực phẩm Inox 304, tay cầm dài", sold_total=100),
        product('two', name='[Brand] Khay bánh', sold_total=10),
        product('three', name='01. SALE 50% - Túi đeo vai nữ có khóa kéo bền đẹp', category='Bags', sold_total=30),
        product('four', name='Freeship Bình nước 500ml nắp kín', category='Drinkware'),
        product('five', name='Thứ tư không nằm trong ba nhóm đầu', category='Zebra'),
    ]
    queries = discovery_queries(own)
    assert len(queries) == 3
    assert queries[0] == {
        'query': 'Rây lọc thực phẩm Inox 304', 'category': 'Kitchen',
        'own_product_name': "[family's house] Rây lọc thực phẩm Inox 304, tay cầm dài",
    }
    assert queries[1]['query'] == 'Túi đeo vai nữ có khóa'
    assert queries[2]['query'] == 'Bình nước 500ml nắp kín'
    assert all('shopee.vn/' not in item['query'] for item in queries)


def test_discovery_queries_without_data_and_without_classification_are_empty():
    assert discovery_queries([]) == []
    assert discovery_queries([product(category='Chưa phân loại')]) == []


def test_discovery_queries_remove_pack_counts_and_duplicate_words():
    queries = discovery_queries([
        product('cloth', category='Cleaning Cloths',
                name="[family's house] COMBO 10 KHĂN Khăn Lau Đa Năng Dày, thấm hút"),
        product('box', category='Food storage',
                name="[family's house] COMBO 10 Hộp Đựng Thực Phẩm Để Cánh Tủ Lạnh"),
    ])
    assert {item['query'] for item in queries} == {'KHĂN Lau Đa Năng Dày', 'Hộp Đựng Thực Phẩm'}


def test_generic_other_categories_under_different_parents_do_not_match(analysis_app):
    app, _, shop = analysis_app
    own = enrich_product(product('own', category='Chưa phân loại', detail=saved_detail(
        categories=['Shopee', 'Kitchen', 'Others'])))
    market = enrich_product(product('new', category='Chưa phân loại', sold_total=10,
                                    detail=saved_detail(categories=['Shopee', 'Beauty', 'Others'])))
    assert app.rank_recommendations([own], [market], shop, app.candidate_score, .12, .08) == []
    analysis = app.build_analysis([own], [market], [])
    assert len(analysis['categories']) == 2
    assert all(category['gap_pct'] is None for category in analysis['categories'])


def listing_job(client, shop, **overrides):
    payload = {'shop_id': shop['id'], 'role': 'own', 'browser': 'chrome', 'read_details': True}
    payload.update(overrides)
    started = client.post('/api/crawl/jobs', json=payload)
    assert started.status_code == 202, started.text
    job = started.json()
    cards = [{'href': f'https://shopee.vn/product/123456/{10000 + index}',
              'name': f'Product {index}', 'text': '₫89.000 Đã bán 120'} for index in range(25)]
    listed = client.post(f'/api/crawl/jobs/{job["job_id"]}/browser-result', json={
        'result_token': job['result_token'], 'pages': [{'url': shop['url'], 'cards': cards}],
    })
    assert listed.status_code == 200, listed.text
    return job, listed.json()


def test_detail_limit_preserves_full_list_and_finishes_selected_sample_without_errors(analysis_app):
    app, client, shop = analysis_app
    job, listing = listing_job(client, shop, detail_limit=20)
    assert listing['rows_imported'] == 25 and listing['detail_total'] == 20
    assert listing['details_sampled'] is True and len(listing['products']) == 20
    assert app.report(shop['id'])['kpis']['own_products'] == 25
    for product in listing['products']:
        response = client.post(f'/api/crawl/jobs/{job["job_id"]}/product-result', json={
            'result_token': job['result_token'], 'product_url': product['product_url'],
            'detail': {'url': product['product_url'], 'name': product['name']},
        })
        assert response.status_code == 200, response.text
    finished = client.post(f'/api/crawl/jobs/{job["job_id"]}/finish-details',
                           json={'result_token': job['result_token']}).json()
    assert finished['status'] == 'done' and finished['partial'] is False
    assert finished['detail_completed'] == 20 and finished['detail_failed'] == 0
    assert finished['details_sampled'] is True
    assert finished['error'] == ''


def test_own_scan_default_still_reads_every_product(analysis_app):
    _, client, shop = analysis_app
    job, listing = listing_job(client, shop)
    assert job['detail_limit'] == 150
    assert listing['rows_imported'] == listing['detail_total'] == len(listing['products']) == 25
    assert listing['details_sampled'] is False


@pytest.mark.parametrize('limit', [0, 151])
def test_invalid_detail_limit_is_rejected(analysis_app, limit):
    _, client, shop = analysis_app
    response = client.post('/api/crawl/jobs', json={
        'shop_id': shop['id'], 'role': 'own', 'browser': 'chrome',
        'read_details': True, 'detail_limit': limit,
    })
    assert response.status_code == 422


def test_detail_limit_migration_is_idempotent(analysis_app, tmp_path, monkeypatch):
    import sqlite3
    app, _, _ = analysis_app
    legacy = tmp_path / 'legacy-limit.db'
    with sqlite3.connect(legacy) as connection:
        connection.execute('''CREATE TABLE crawl_jobs (
            id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, target_url TEXT NOT NULL, role TEXT NOT NULL,
            status TEXT NOT NULL, rows_imported INTEGER DEFAULT 0, error TEXT DEFAULT '',
            created_at TEXT NOT NULL, completed_at TEXT DEFAULT '')''')
        connection.execute("INSERT INTO crawl_jobs(id,shop_id,target_url,role,status,created_at) "
                           "VALUES('legacy','shop','https://shopee.vn/shop','own','done','2026-10-14')")
    monkeypatch.setattr(app, 'DB', legacy)
    app.setup()
    app.setup()
    with app.db() as connection:
        assert connection.execute('SELECT detail_limit FROM crawl_jobs').fetchone()[0] == 150


@pytest.mark.parametrize('display,expected', [
    ('94.000₫', (94000, 94000)), ('₫24.000 - ₫52.000', (24000, 52000)),
    ('65.000₫ – 90.000₫', (65000, 90000)), ('₫20.000 - 50.000', (20000, 50000)),
    ('99.000', (99000, 99000)), ('Giảm 50% còn 90.000đ', (None, None)),
])
def test_visible_product_price_ranges(display, expected):
    assert price_range(display) == expected


def test_top_product_comparisons_preserve_cumulative_basis_and_per_product_metrics():
    own = [enrich_product(product('best', 'my_shop', name='Rây lọc bột inox', sold_total=1000)),
           enrich_product(product('second', 'my_shop', name='Khăn lau nhà', sold_total=10))]
    other = enrich_product(product('similar', name='Rây lọc bột tay cầm', sold_total=200,
                                   review_count=40, detail=saved_detail(price_text='₫50.000 - ₫80.000')))
    rows = product_comparisons(own, [other])
    assert rows[0]['own_product']['sku'] == 'best'
    assert rows[0]['ranking_basis'] == 'cumulative_sold'
    assert rows[0]['own_product']['units_30d'] is None
    matched = rows[0]['competitors'][0]
    assert matched['sold_total'] == 200 and matched['review_count'] == 40
    assert (matched['price_min'], matched['price_max']) == (50000, 80000)
    assert matched['match_kind'] == 'name_similarity'
    assert 'chưa xác nhận' in matched['match_label']
    assert rows[0]['summary'] == dict(shop_count=1, product_count=1, price_min=50000,
                                    price_max=80000, sold_count=1, review_count_known=1)
    assert rows[1]['competitors'] == []


def test_monthly_ranking_uses_known_monthly_cohort_without_mixing_cumulative_sales():
    own = [enrich_product(product('cumulative', sold_total=90000)),
           enrich_product(product('monthly', units_30d=12)),
           enrich_product(product('estimated', units_30d=20, units_basis='estimated_snapshot_delta'))]
    rows = product_comparisons(own, [])
    assert [row['own_product']['sku'] for row in rows] == ['estimated', 'monthly']
    assert [row['ranking_basis'] for row in rows] == ['estimated_30d', 'reported_30d']


def test_generic_words_and_category_conflicts_do_not_create_product_matches():
    own = enrich_product(product('own', name='Chai xịt vệ sinh giày Sneaker Geto',
                                 detail=saved_detail(categories=['Shopee', 'Men Shoes', 'Shoe Care']),
                                 category='Chưa phân loại'))
    kitchen = enrich_product(product('kitchen', name='Chai xịt vệ sinh làm sạch dầu mỡ bếp',
                                     detail=saved_detail(categories=['Shopee', 'Home Care', 'Cleaning']),
                                     category='Chưa phân loại'))
    generic = enrich_product(product('generic', name='Sản phẩm đa năng cao cấp chính hãng tiện lợi'))
    rows = product_comparisons([own], [kitchen, generic])
    assert rows[0]['competitors'] == []


def test_product_query_removes_complex_leading_quantity_and_brand():
    query = product_query(product(name="[Family's House] 1-2-3 Set 111 Quả Bóng Bay Nước + Vòi Tự Động"))
    assert query == 'Quả Bóng Bay Nước'


def test_product_comparison_summary_counts_all_matches_when_visible_matches_are_capped():
    own = enrich_product(product(name='Rây lọc bột'))
    market = [enrich_product(product(str(index), name='Rây lọc bột inox', sold_total=index))
              for index in range(25)]
    row = product_comparisons([own], market)[0]
    assert len(row['competitors']) == 20 and row['competitors_truncated'] is True
    assert row['summary']['product_count'] == 25


TARGET_PRODUCT = 'https://shopee.vn/product/654321/77777'


def start_product_comparison(app, client, shop, **overrides):
    insert(app, shop, 'own', [product('own', 'my_shop', name='Rây lọc bột', sold_total=100)])
    payload = dict(shop_id=shop['id'], own_sku='own', target_url='https://shopee.vn/other_shop',
                   product_url=TARGET_PRODUCT, query='Rây lọc bột')
    payload.update(overrides)
    return client.post('/api/competitors/product-jobs', json=payload)


def direct_detail(**overrides):
    value = dict(url=TARGET_PRODUCT, name='Ứng viên lấy từ trang sản phẩm thật',
                 categories=['Shopee', 'Home', 'Kitchen'], price_text='₫12.000 - ₫28.000',
                 rating_text='4.8', review_count_text='22 Ratings', sold_text='1,2k+ Sold')
    value.update(overrides)
    return value


def product_callback(client, job, **fields):
    return client.post(f'/api/competitors/product-jobs/{job["job_id"]}/result',
                       json={'result_token': job['result_token'], **fields})


def test_direct_product_capture_persists_link_range_counts_and_does_not_delete_catalog(analysis_app):
    app, client, shop = analysis_app
    insert(app, shop, 'market', [product('existing', 'other_shop', name='Existing catalog product', price=99)])
    started = start_product_comparison(app, client, shop)
    assert started.status_code == 202, started.text
    job = started.json()
    response = product_callback(client, job, detail=direct_detail())
    assert response.status_code == 200, response.text
    assert response.json() == dict(job_id=job['job_id'], status='done', rows_imported=1,
                                   detail_completed=1, detail_failed=0)
    report = app.report(shop['id'])
    assert report['kpis']['market_products'] == 2
    saved = next(item for item in report['market_products'] if item['sku'] == '654321.77777')
    assert saved['price'] == saved['price_min'] == 12000 and saved['price_max'] == 28000
    assert saved['review_count'] == 22 and saved['sold_total'] == 1200 and saved['sold_lower_bound'] is True
    assert saved['units_30d'] is None and saved['revenue_30d'] is None
    assert saved['data_origin'] == 'chrome_product_comparison'
    row = report['competitor_analysis']['product_comparisons'][0]
    assert row['competitors'][0]['match_kind'] == 'direct_search'
    assert 'cần đối chiếu' in row['competitors'][0]['match_label']
    with app.db() as connection:
        link = connection.execute('SELECT * FROM product_comparison_links').fetchone()
        assert link['own_sku'] == 'own' and link['query'] == 'Rây lọc bột'
        assert connection.execute('SELECT result_token FROM crawl_jobs WHERE id=?',
                                  (job['job_id'],)).fetchone()[0] == ''
    assert product_callback(client, job, detail=direct_detail()).status_code == 409


def test_direct_product_capture_preserves_existing_listing_price(analysis_app):
    from datetime import date
    app, client, shop = analysis_app
    insert(app, shop, 'market', [product('654321.77777', 'other_shop', price=89000, sold_total=950)],
           snapshot=date.today().isoformat())
    job = start_product_comparison(app, client, shop).json()
    assert product_callback(client, job, detail=direct_detail()).status_code == 200
    saved = app.report(shop['id'])['market_products'][0]
    assert saved['price'] == 89000
    assert saved['price_min'] == 12000 and saved['price_max'] == 28000
    assert saved['sold_total'] == 1200


def test_direct_product_capture_does_not_republish_old_snapshot_metrics_as_current(analysis_app):
    from datetime import date, timedelta
    app, client, shop = analysis_app
    previous = (date.today() - timedelta(days=10)).isoformat()
    insert(app, shop, 'market', [product('654321.77777', 'other_shop', price=89000, sold_total=950,
                                       rating=4.9, review_count=20, units_30d=500,
                                       revenue_30d=44500000, views_30d=1000, stock=10, cost=6000)],
           snapshot=previous)
    job = start_product_comparison(app, client, shop).json()
    assert product_callback(client, job, detail=direct_detail(
        rating_text='', review_count_text='', sold_text='')).status_code == 200
    saved = app.report(shop['id'])['market_products'][0]
    assert saved['snapshot_date'] == date.today().isoformat()
    assert saved['price'] == 12000 and saved['cost'] == 6000
    for field in ('units_30d', 'revenue_30d', 'views_30d', 'stock', 'rating', 'review_count', 'sold_total'):
        assert saved[field] is None
    with app.db() as connection:
        old = connection.execute('SELECT * FROM observations WHERE sku=? AND snapshot_date=?',
                                  ('654321.77777', previous)).fetchone()
        assert old['price'] == 89000 and old['units_30d'] == 500


def test_direct_product_callback_token_identity_and_job_kind_are_enforced(analysis_app):
    app, client, shop = analysis_app
    job = start_product_comparison(app, client, shop).json()
    wrong_token = {**job, 'result_token':'wrong'}
    assert product_callback(client, wrong_token, detail=direct_detail()).status_code == 403
    assert product_callback(client, job, detail=direct_detail(
        url='https://shopee.vn/product/654321/99999')).status_code == 422
    generic_result = client.post(f'/api/crawl/jobs/{job["job_id"]}/browser-result', json={
        'result_token':job['result_token'], 'pages':[], 'error':'wrong endpoint',
    })
    assert generic_result.status_code == 409
    assert app.report(shop['id'])['kpis']['market_products'] == 0
    assert product_callback(client, job, detail=direct_detail()).status_code == 200


def test_direct_product_callback_error_does_not_create_comparison_data(analysis_app):
    app, client, shop = analysis_app
    job = start_product_comparison(app, client, shop).json()
    response = product_callback(client, job, error='Trang sản phẩm yêu cầu xác minh')
    assert response.status_code == 200 and response.json()['status'] == 'failed'
    assert app.report(shop['id'])['kpis']['market_products'] == 0
    with app.db() as connection:
        assert connection.execute('SELECT COUNT(*) FROM product_comparison_links').fetchone()[0] == 0


@pytest.mark.parametrize('overrides,status', [
    ({'own_sku':'missing'}, 404), ({'target_url':'https://example.com/shop'}, 422),
    ({'target_url':'https://shopee.vn/my_shop'}, 422),
    ({'product_url':'http://shopee.vn/product/654321/77777'}, 422),
    ({'product_url':'https://shopee.vn/search?next=/product/654321/77777'}, 422),
    ({'query':'   '}, 422),
])
def test_direct_product_start_rejects_invalid_context(analysis_app, overrides, status):
    app, client, shop = analysis_app
    assert start_product_comparison(app, client, shop, **overrides).status_code == status


def test_direct_product_links_are_isolated_by_own_product_and_workspace(analysis_app):
    app, client, shop = analysis_app
    job = start_product_comparison(app, client, shop).json()
    assert product_callback(client, job, detail=direct_detail()).status_code == 200
    insert(app, shop, 'own', [product('different', 'my_shop', name='Bình nước thể thao', sold_total=5)])
    rows = app.report(shop['id'])['competitor_analysis']['product_comparisons']
    different = next(row for row in rows if row['own_product']['sku'] == 'different')
    assert different['competitors'] == []
    other = client.post('/api/shops', json={'url':'https://shopee.vn/another_workspace'}).json()
    insert(app, other, 'own', [product('own', 'another_workspace', name='Rây lọc bột', sold_total=100)])
    insert(app, other, 'market', [product('654321.77777', 'other_shop', name=direct_detail()['name'])])
    isolated = app.report(other['id'])['competitor_analysis']['product_comparisons'][0]
    assert isolated['competitors'] == []


def test_direct_product_callback_expiry_and_wrong_generic_job_are_rejected(analysis_app):
    app, client, shop = analysis_app
    job = start_product_comparison(app, client, shop).json()
    with app.db() as connection:
        connection.execute('UPDATE crawl_jobs SET result_expires_at=? WHERE id=?',
                           ('2000-01-01T00:00:00', job['job_id']))
    assert product_callback(client, job, detail=direct_detail()).status_code == 410
    generic = client.post('/api/crawl/jobs', json={
        'shop_id':shop['id'], 'role':'own', 'browser':'chrome',
    }).json()
    assert product_callback(client, generic, detail=direct_detail()).status_code == 409
