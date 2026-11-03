import csv
import importlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

import seller_workspace


def costs(**changes):
    return {'unit_cost': 45000, 'platform_fee_pct': 15, 'payment_fee_pct': 0, 'tax_pct': 0,
            'packaging_cost': 5000, 'shipping_cost': 0, 'other_unit_cost': 0,
            'ad_cost_per_order': 12000, 'target_margin_pct': 20, **changes}


def import_products(client, shop_id, rows, role='own'):
    data = io.StringIO()
    writer = csv.DictWriter(data, fieldnames=['sku', 'name', 'price', 'units_30d', 'revenue_30d', 'category', 'product_url'])
    writer.writeheader()
    for row in rows:
        writer.writerow({'category': 'Gia dụng', **row})
    result = client.post('/api/import', data={'shop_id': shop_id, 'role': role, 'snapshot_date': '2026-10-15'},
                         files={'file': ('seller-test.csv', data.getvalue().encode(), 'text/csv')})
    assert result.status_code == 200, result.text


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'seller-workspace.db'))
    import app
    app = importlib.reload(app)
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={'url': 'https://shopee.vn/seller_workspace_test', 'category': 'Gia dụng'}).json()
    other = client.post('/api/shops', json={'url': 'https://shopee.vn/seller_other_shop', 'category': 'Gia dụng'}).json()
    import_products(client, shop['id'], [
        {'sku': '12.1', 'name': 'Hộp đựng thực phẩm', 'price': 99999, 'units_30d': 10, 'revenue_30d': 999990},
        {'sku': '12.2', 'name': 'Kệ để đồ', 'price': 99000, 'units_30d': 10, 'revenue_30d': 990000},
    ])
    import_products(client, other['id'], [{'sku': '98.1', 'name': 'SKU shop khác', 'price': 10000}])
    return app, client, shop, other


def analysis(workspace, shop_id=None):
    _, client, shop, _ = workspace
    result = client.get('/api/seller/analysis', params={'shop_id': shop_id or shop['id']})
    assert result.status_code == 200, result.text
    return result.json()


def save(workspace, sku='12.1', values=None, shop_id=None):
    _, client, shop, _ = workspace
    return client.put(f'/api/seller/products/{sku}/inputs', params={'shop_id': shop_id or shop['id']},
                      json=values if values is not None else costs())


def create_action(workspace, sku='12.1'):
    _, client, shop, _ = workspace
    data = analysis(workspace)
    strategy = next(row for row in data.get('strategies_available', data['strategies']) if row.get('sku') == sku)
    result = client.post('/api/seller/actions', params={'shop_id': shop['id']},
                         json={'strategy_key': strategy['key'], 'sku': sku})
    assert result.status_code == 200, result.text
    return result.json()


def update_action(workspace, action_id, **changes):
    _, client, shop, _ = workspace
    return client.patch(f'/api/seller/actions/{action_id}', params={'shop_id': shop['id']}, json=changes)


def test_optimizer_uses_imported_price_and_entered_costs_instead_of_fixed_document_values(workspace):
    _, client, shop, _ = workspace
    for sku, expected in [('12.1', 22999.15), ('12.2', 22150)]:
        assert save(workspace, sku).status_code == 200
        result = client.post('/api/seller/optimize', params={'shop_id': shop['id']}, json={'sku': sku})
        assert result.status_code == 200, result.text
        data = result.json()
        assert data['ready'] and data['cost_complete'] and data['actual_profit'] == expected
        assert data['contribution_per_order'] == expected
        baseline = next(row for row in data['scenarios'] if row['key'] == 'baseline')
        assert baseline['price'] == (99999 if sku == '12.1' else 99000)
        assert data['break_even_price'] == 72941.18 and data['target_price'] == 95384.62
    override = client.post('/api/seller/optimize', params={'shop_id': shop['id']},
                           json={'sku': '12.1', 'inputs': {'unit_cost': 50000}}).json()
    assert override['contribution_per_order'] == 17999.15
    assert analysis(workspace)['inputs']['12.1']['unit_cost'] == 45000


def test_unknown_costs_are_nullable_and_do_not_inherit_dashboard_demo_fees(workspace):
    data = analysis(workspace)
    assert data['source'] == 'local_database' and data['is_demo'] is False
    assert data['summary']['product_count'] == 2 and data['summary']['contribution_30d'] is None
    for row in data['products']:
        assert row['inputs']['platform_fee_pct'] is None and row['optimizer']['actual_profit'] is None
        assert row['metrics']['orders_30d'] is None and row['metrics']['conversion_pct'] is None
    assert save(workspace, values={'unit_cost': 45000, 'platform_fee_pct': 15}).status_code == 200
    product = next(row for row in analysis(workspace)['products'] if row['sku'] == '12.1')
    assert product['optimizer']['ready'] and not product['optimizer']['cost_complete']
    assert product['optimizer']['actual_profit'] is None
    assert {'payment_fee_pct', 'tax_pct', 'shipping_cost'} <= set(product['optimizer']['missing'])


def test_partial_updates_merge_clear_nullable_fields_and_survive_server_reload(workspace):
    app, client, shop, _ = workspace
    assert save(workspace, values=costs(orders_30d=10, visits_30d=200)).status_code == 200
    saved = save(workspace, values={'packaging_cost': 7000, 'shipping_cost': None}).json()['inputs']
    assert saved['unit_cost'] == 45000 and saved['packaging_cost'] == 7000 and saved['shipping_cost'] is None
    app = importlib.reload(app)
    result = TestClient(app.app).get('/api/seller/analysis', params={'shop_id': shop['id']})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['inputs']['12.1'] == saved
    product = next(row for row in data['products'] if row['sku'] == '12.1')
    assert product['metrics']['conversion_pct'] == 5
    assert product['optimizer']['actual_profit'] is None and 'shipping_cost' in product['optimizer']['missing']


def test_invalid_combined_fee_after_merge_is_422_and_leaves_saved_values_unchanged(workspace):
    _, client, shop, _ = workspace
    assert save(workspace, values={'platform_fee_pct': 15}).status_code == 200
    previous = analysis(workspace)['inputs']
    result = save(workspace, values={'payment_fee_pct': 85})
    assert result.status_code == 422, result.text
    result = client.post('/api/seller/optimize', params={'shop_id': shop['id']},
                         json={'sku': '12.1', 'inputs': {'payment_fee_pct': 90}})
    assert result.status_code == 422, result.text
    assert analysis(workspace)['inputs'] == previous


@pytest.mark.parametrize('field,value', [
    ('orders_30d', 2.5), ('visits_30d', 1.5), ('ad_impressions', 10.1),
    ('ad_clicks', .5), ('ad_orders_30d', 1.1), ('unit_cost', -1),
    ('platform_fee_pct', 100), ('unit_cost', True), ('orders_30d', False),
])
def test_invalid_amounts_and_fractional_counts_are_rejected_without_persisting(workspace, field, value):
    assert save(workspace, values={field: value}).status_code == 422
    assert analysis(workspace)['inputs'] == {}


def test_foreign_and_market_only_skus_cannot_modify_another_shops_seller_inputs(workspace):
    _, client, shop, other = workspace
    import_products(client, shop['id'], [{'sku': '88.1', 'name': 'Chỉ là đối thủ', 'price': 20000}], role='market')
    for sku in ('98.1', '88.1', 'missing'):
        assert save(workspace, sku, values=costs()).status_code == 404
        assert client.post('/api/seller/optimize', params={'shop_id': shop['id']}, json={'sku': sku}).status_code == 404
    assert save(workspace, '12.1', values=costs(), shop_id=other['id']).status_code == 404
    assert analysis(workspace)['inputs'] == analysis(workspace, other['id'])['inputs'] == {}


def test_action_creation_is_deduplicated_including_simultaneous_requests(workspace):
    app, client, shop, _ = workspace
    selected = next(row for row in analysis(workspace)['strategies_available'] if row.get('sku') == '12.1')
    payload = {'strategy_key': selected['key'], 'sku': '12.1'}
    barrier = Barrier(2)

    def execute():
        barrier.wait(timeout=5)
        response = client.post('/api/seller/actions', params={'shop_id': shop['id']}, json=payload)
        assert response.status_code == 200, response.text
        return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(lambda _: execute(), range(2)))
    assert first['id'] == second['id']
    third = client.post('/api/seller/actions', params={'shop_id': shop['id']}, json=payload).json()
    assert third['id'] == first['id']
    with app.db() as c:
        assert c.execute('SELECT count(*) FROM seller_actions WHERE shop_id=?', (shop['id'],)).fetchone()[0] == 1
        assert c.execute('SELECT count(*) FROM seller_action_events WHERE action_id=?', (first['id'],)).fetchone()[0] == 1


def test_action_notes_status_events_and_start_baseline_are_persisted(workspace, monkeypatch):
    app, _, _, _ = workspace
    clock = [datetime(2026, 10, 15, tzinfo=timezone.utc)]
    monkeypatch.setattr(seller_workspace, 'now', lambda: clock[0])
    assert save(workspace, values=costs(orders_30d=5)).status_code == 200
    action = create_action(workspace)
    assert action['status'] == 'todo' and action['started_at'] is None
    assert action['baseline']['product']['metrics']['orders_30d'] == 5
    noted = update_action(workspace, action['id'], notes='Đã đối soát biểu phí').json()
    assert noted['started_at'] is None and noted['notes'] == 'Đã đối soát biểu phí'
    clock[0] += timedelta(days=2)
    assert save(workspace, values={'orders_30d': 8}).status_code == 200
    started = update_action(workspace, action['id'], status='doing').json()
    assert started['started_at'] == clock[0].isoformat()
    assert started['baseline']['product']['metrics']['orders_30d'] == 8
    clock[0] += timedelta(days=1)
    assert save(workspace, values={'orders_30d': 10}).status_code == 200
    done = update_action(workspace, action['id'], status='done', notes='Đã hoàn tất').json()
    assert done['completed_at'] == clock[0].isoformat() and done['started_at'] == started['started_at']
    assert done['baseline'] == started['baseline']
    assert update_action(workspace, action['id'], status='invalid').status_code == 422
    with app.db() as c:
        events = [dict(row) for row in c.execute('SELECT * FROM seller_action_events WHERE action_id=? ORDER BY id', (action['id'],))]
    assert [row['status'] for row in events] == ['todo', 'todo', 'doing', 'done']
    assert json.loads(events[-1]['kpi_json'])['product']['metrics']['orders_30d'] == 10
    repeat = create_action(workspace)
    assert repeat['id'] != action['id'] and repeat['status'] == 'todo'


def test_actions_and_reports_are_scoped_to_selected_shop_and_stale_recommendations_fail(workspace):
    _, client, shop, other = workspace
    action = create_action(workspace)
    assert client.patch(f'/api/seller/actions/{action["id"]}', params={'shop_id': other['id']},
                        json={'status': 'doing'}).status_code == 404
    assert client.post('/api/seller/actions', params={'shop_id': shop['id']},
                       json={'strategy_key': 'obsolete', 'sku': '12.1'}).status_code == 409
    assert client.post('/api/seller/actions', params={'shop_id': shop['id']},
                       json={'strategy_key': action['strategy_key'], 'sku': '98.1'}).status_code == 409
    report = client.post('/api/seller/reports', params={'shop_id': shop['id']}, json={'period_days': 7}).json()
    assert client.get(f'/api/seller/reports/{report["id"]}/export', params={'shop_id': other['id']}).status_code == 404
    assert analysis(workspace, other['id'])['actions'] == analysis(workspace, other['id'])['reports'] == []


def test_seven_and_fourteen_day_reviews_start_at_doing_are_idempotent_and_survive_reload(workspace, monkeypatch):
    app, _, _, _ = workspace
    clock = [datetime(2026, 10, 1, tzinfo=timezone.utc)]
    monkeypatch.setattr(seller_workspace, 'now', lambda: clock[0])
    action = create_action(workspace)
    clock[0] += timedelta(days=20)
    app.seller_report_tick()
    assert analysis(workspace)['reports'] == []
    started = update_action(workspace, action['id'], status='doing').json()
    started_at = clock[0]
    assert started['started_at'] == started_at.isoformat()
    clock[0] = started_at + timedelta(days=7, microseconds=-1)
    app.seller_report_tick()
    assert analysis(workspace)['reports'] == []
    clock[0] += timedelta(microseconds=1)
    app.seller_report_tick()
    first = analysis(workspace)['reports']
    assert len(first) == 1 and first[0]['period_days'] == 7 and first[0]['kind'] == 'action_review'
    assert first[0]['action_id'] == action['id']
    app.seller_report_tick()
    assert analysis(workspace)['reports'] == first
    app = importlib.reload(app)
    app.seller_report_tick()
    assert analysis(workspace)['reports'] == first
    clock[0] = started_at + timedelta(days=14)
    app.seller_report_tick()
    app.seller_report_tick()
    reviews = analysis(workspace)['reports']
    assert len(reviews) == 2 and {row['period_days'] for row in reviews} == {7, 14}
    assert all('30 ngày' in ' '.join(row['limitations']) and 'không khẳng định' in ' '.join(row['limitations']) for row in reviews)


def test_sku_review_compares_its_metrics_not_other_product_changes(workspace, monkeypatch):
    app, _, _, _ = workspace
    clock = [datetime(2026, 10, 15, tzinfo=timezone.utc)]
    monkeypatch.setattr(seller_workspace, 'now', lambda: clock[0])
    assert save(workspace, '12.1', costs(orders_30d=5)).status_code == 200
    assert save(workspace, '12.2', costs(orders_30d=3)).status_code == 200
    action = create_action(workspace, '12.1')
    update_action(workspace, action['id'], status='doing')
    assert save(workspace, '12.2', {'orders_30d': 50}).status_code == 200
    clock[0] += timedelta(days=7)
    app.seller_report_tick()
    result = analysis(workspace)['reports'][0]
    assert result['comparison_scope'] == 'sku'
    assert result['product_baseline']['sku'] == result['product_current']['sku'] == '12.1'
    orders = next(row for row in result['comparison'] if row['metric'] == 'orders_30d')
    assert (orders['before'], orders['after'], orders['delta']) == (5, 5, 0)
    assert result['summary']['orders_30d'] == 55
    assert save(workspace, '12.1', {'orders_30d': 7}).status_code == 200
    clock[0] += timedelta(days=7)
    app.seller_report_tick()
    result = next(row for row in analysis(workspace)['reports'] if row['period_days'] == 14)
    orders = next(row for row in result['comparison'] if row['metric'] == 'orders_30d')
    assert (orders['before'], orders['after'], orders['delta']) == (5, 7, 2)


def test_html_report_escapes_imported_user_strings_and_json_preserves_data(workspace, monkeypatch):
    app, client, shop, _ = workspace
    clock = [datetime(2026, 10, 15, tzinfo=timezone.utc)]
    monkeypatch.setattr(seller_workspace, 'now', lambda: clock[0])
    name = '<script>alert("seller")</script> & hộp'
    import_products(client, shop['id'], [{'sku': '12.1', 'name': name, 'price': 99999}])
    action = create_action(workspace)
    assert name in action['title']
    update_action(workspace, action['id'], status='doing')
    clock[0] += timedelta(days=7)
    app.seller_report_tick()
    report = analysis(workspace)['reports'][0]
    endpoint = f'/api/seller/reports/{report["id"]}/export'
    html = client.get(endpoint, params={'shop_id': shop['id'], 'format': 'html'})
    assert html.status_code == 200 and '<script>' not in html.text
    assert '&lt;script&gt;' in html.text and '&amp;' in html.text
    assert 'attachment;' in html.headers['content-disposition']
    exported = client.get(endpoint, params={'shop_id': shop['id'], 'format': 'json'})
    assert exported.status_code == 200 and name in exported.json()['title']
    assert client.get(endpoint, params={'shop_id': shop['id'], 'format': 'csv'}).status_code == 422
    assert client.post('/api/seller/reports', params={'shop_id': shop['id']}, json={'period_days': 30}).status_code == 422


def test_workspace_operations_do_not_rewrite_collected_observations(workspace, monkeypatch):
    app, client, shop, _ = workspace
    clock = [datetime(2026, 10, 15, tzinfo=timezone.utc)]
    monkeypatch.setattr(seller_workspace, 'now', lambda: clock[0])
    with app.db() as c:
        before = [tuple(row) for row in c.execute('SELECT * FROM observations ORDER BY id')]
    save(workspace, values=costs(orders_30d=10, visits_30d=100))
    client.post('/api/seller/optimize', params={'shop_id': shop['id']}, json={'sku': '12.1'})
    action = create_action(workspace)
    update_action(workspace, action['id'], status='doing', notes='Thử nghiệm cục bộ')
    clock[0] += timedelta(days=14)
    app.seller_report_tick()
    client.post('/api/seller/reports', params={'shop_id': shop['id']}, json={'period_days': 14})
    with app.db() as c:
        after = [tuple(row) for row in c.execute('SELECT * FROM observations ORDER BY id')]
    assert after == before


def test_sku_sales_plan_can_create_action_even_when_it_is_outside_shop_top_ten(workspace):
    app, client, shop, _ = workspace
    import_products(client, shop['id'], [
        {'sku': f'12.{i}', 'name': f'Hộp sản phẩm {i}', 'price': 50000+i, 'units_30d': i}
        for i in range(3, 18)
    ])
    data = analysis(workspace)
    overview = {row['key'] for row in data['strategies']}
    assert len(overview) == 10 and len(data['strategies_available']) > 10
    plan_strategy = next(row for product in data['products'] for row in product['sales_plan']['strategies'] if row['key'] not in overview)
    result = client.post('/api/seller/actions', params={'shop_id': shop['id']},
                         json={'strategy_key': plan_strategy['key'], 'sku': plan_strategy['sku']})
    assert result.status_code == 200, result.text
    action = result.json()
    assert action['strategy_key'] == plan_strategy['key'] and action['sku'] == plan_strategy['sku']
    assert action['plan'] == plan_strategy
    assert action['plan']['steps'] and action['plan']['measurement'] and action['plan']['prerequisites'] and action['plan']['stop']
    app = importlib.reload(app)
    restarted = TestClient(app.app).get('/api/seller/analysis', params={'shop_id': shop['id']}).json()
    persisted = next(row for row in restarted['actions'] if row['id'] == action['id'])
    assert persisted['plan'] == plan_strategy and persisted['baseline'] == action['baseline']


def test_optimizer_sales_plan_responds_to_override_data_without_persisting_it(workspace):
    _, client, shop, _ = workspace
    endpoint = '/api/seller/optimize'
    original = client.post(endpoint, params={'shop_id': shop['id']}, json={'sku': '12.1'}).json()
    original_ads = next(row for row in original['sales_plan']['diagnosis'] if row['channel'] == 'ads')
    assert original_ads['status'] == 'unknown'
    entered = costs(orders_30d=30, visits_30d=1000, ad_spend=120000, ad_revenue=600000,
                    ad_orders_30d=30, ad_clicks=100, ad_impressions=1000)
    response = client.post(endpoint, params={'shop_id': shop['id']}, json={'sku': '12.1', 'inputs': entered})
    assert response.status_code == 200, response.text
    result = response.json()
    ads = next(row for row in result['sales_plan']['diagnosis'] if row['channel'] == 'ads')
    assert ads['status'] == 'scale'
    strategy = next(row for row in result['sales_plan']['strategies'] if row['channel'] == 'ads')
    assert strategy['steps'] and strategy['measurement'] and '7 ngày' in ' '.join(strategy['steps'])
    assert analysis(workspace)['inputs'] == {}


def test_market_evidence_history_uses_only_selected_shop_sku_and_latest_record_per_day(workspace):
    app,client,shop,other=workspace
    with app.db() as c:
        c.executemany('''INSERT INTO observations(shop_id,role,source_shop,sku,name,price,sold_total,review_count,snapshot_date,data_origin)
          VALUES(?,?,?,?,?,?,?,?,?,?)''',[
            (shop['id'],'own','older source','12.1','Hộp',99000,10,2,'2026-10-14','user_import'),
            (shop['id'],'own','same-day newer source','12.1','Hộp',99999,20,3,'2026-10-15','chrome_live_dom'),
            (shop['id'],'own','another sku','12.2','Kệ',99000,9999,999,'2026-10-14','user_import'),
            (shop['id'],'market','foreign role','12.1','Đối thủ',10000,8888,888,'2026-10-13','user_import'),
            (other['id'],'own','foreign shop','12.1','Shop khác',10000,7777,777,'2026-10-13','user_import'),
        ])
    def no_inference(*args,**kwargs):
        raise AssertionError('Read-only market evidence must not call Ollama')
    app.app.state.seller_ai.transport=no_inference
    response=client.get('/api/seller/products/12.1/market-evidence',params={'shop_id':shop['id']})
    assert response.status_code==200,response.text
    data=response.json()
    assert data['shop_id']==shop['id'] and data['sku']=='12.1' and data['source']=='local_database'
    assert data['observation_days']==2 and [row['day'] for row in data['history']]==['2026-10-14','2026-10-15']
    assert [row['sold_total'] for row in data['history']]==[10,20]
    assert [row['review_count'] for row in data['history']]==[2,3]
    assert all(row['sold_precision']=='unknown' for row in data['history'])
    assert not any('velocity' in row for row in data['history'])
    assert 'độ chính xác' in ' '.join(data['limitations'])


def test_market_evidence_is_not_available_for_foreign_or_market_only_skus(workspace):
    _,client,shop,_=workspace
    import_products(client,shop['id'],[{'sku':'88.1','name':'Đối thủ riêng','price':20000}],role='market')
    for sku in ('98.1','88.1','missing'):
        assert client.get(f'/api/seller/products/{sku}/market-evidence',params={'shop_id':shop['id']}).status_code==404
    assert client.get('/api/seller/products/12.1/market-evidence',params={'shop_id':'missing'}).status_code==404


def test_market_evidence_enriches_real_competitors_but_price_range_requires_matching_specs(workspace):
    app,client,shop,_=workspace
    attrs=[{'name':name,'value':value} for name,value in (
        ('Thương hiệu','Hòa Phát'),('Chất liệu','Nhựa PP'),('Dung tích','500ml'),
        ('Số lượng trong gói','2 cái'),('Công dụng','Hộp đựng thực phẩm'))]
    with app.db() as c:
        for sku,name,price,material in [('88.1','Hộp tương đương',88000,'Nhựa PP'),('88.2','Hộp khác chất liệu',999000,'Thủy tinh')]:
            c.execute('''INSERT INTO observations(shop_id,role,source_shop,sku,name,category,price,sold_total,review_count,rating,product_url,snapshot_date,data_origin)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (shop['id'],'market','Rival '+sku,sku,name,'Gia dụng',price,1200,56,4.8,'https://shopee.vn/product/'+sku.replace('.','/'),'2026-10-15','chrome_live_dom'))
            detail={'attributes':[{**item,'value':material if item['name']=='Chất liệu' else item['value']} for item in attrs],
                    'sold_text':'1.2k+ Sold','review_count_text':'56 đánh giá'}
            c.execute('''INSERT INTO product_details(shop_id,role,source_shop,sku,status,detail_json,collected_at,last_attempt_at)
              VALUES(?,?,?,?,?,?,?,?)''',(shop['id'],'market','Rival '+sku,sku,'done',json.dumps(detail),'2026-10-15','2026-10-15'))
        c.execute('''INSERT INTO product_details(shop_id,role,source_shop,sku,status,detail_json,collected_at,last_attempt_at)
          VALUES(?,?,?,?,?,?,?,?)''',(shop['id'],'own',shop['name'],'12.1','done',json.dumps({'attributes':attrs}),'2026-10-15','2026-10-15'))
    response=client.get('/api/seller/products/12.1/market-evidence',params={'shop_id':shop['id']})
    assert response.status_code==200,response.text
    reference=response.json()['competitors']
    assert reference['count']==1 and reference['min']==reference['max']==88000
    assert reference['different_count']==1 and reference['candidate_count']==2
    matched=next(row for row in reference['candidates'] if row['sku']=='88.1')
    assert matched['equivalence']['status']=='equivalent'
    assert matched['sold_total']==1200 and matched['review_count']==56 and matched['rating']==4.8
    assert matched['sold_approx'] is True and matched['sold_lower_bound'] is True
    assert matched['product_url']=='https://shopee.vn/product/88/1'


def test_saved_market_model_requires_public_sku_identity_and_get_never_trains_or_writes(workspace):
    app,client,shop,_=workspace
    with app.db() as c:
        c.execute('''INSERT INTO market_ml_models(id,created_at,status,algorithm,training_cutoff,product_count,data_product_count,artifact_json)
          VALUES(?,?,?,?,?,?,?,?)''',('saved-model','2026-10-15T10:00:00','trained','kmeans_standardized_log_features','2026-10-15',20,20,'{}'))
        c.execute('INSERT INTO market_ml_predictions VALUES(?,?,?,?,?,?,?)',
                  ('saved-model','12.1','10001',72,'Nhóm đã học','Vị thế hiện tại, không phải dự báo','{}'))
    endpoint='/api/seller/products/12.1/market-evidence'
    assert client.get(endpoint,params={'shop_id':shop['id']}).json()['ml'] is None
    with app.db() as c:
        c.execute("UPDATE observations SET product_url='https://shopee.vn/product/12/1' WHERE shop_id=? AND role='own' AND sku='12.1'",(shop['id'],))
        before={table:c.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in
                ('observations','market_ml_models','market_ml_predictions','seller_ai_jobs')}
    response=client.get(endpoint,params={'shop_id':shop['id']})
    assert response.status_code==200,response.text
    ml=response.json()['ml']
    assert ml['ml_signal_score']==72 and ml['model_id']=='saved-model'
    assert ml['freshness']=='saved_not_revalidated' and 'không phải dự báo' in ml['basis']
    with app.db() as c:
        after={table:c.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in before}
    assert after==before
