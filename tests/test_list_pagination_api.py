import importlib
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def market_app(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'pagination.db'))
    import app
    app = importlib.reload(app)
    client = TestClient(app.app)
    shop = client.post('/api/shops', json={'url': 'https://shopee.vn/pagination_shop', 'category': 'Nhà cửa & Đời sống'}).json()
    other = client.post('/api/shops', json={'url': 'https://shopee.vn/another_shop'}).json()
    return app, client, shop, other


def test_dashboard_all_rows_exposes_older_imports_without_changing_default_or_shop_scope(market_app):
    app, client, shop, other = market_app
    with app.db() as c:
        c.executemany('INSERT INTO imports(shop_id,filename,role,rows_imported,imported_at,snapshot_date) VALUES(?,?,?,?,?,?)',
            [(shop['id'], f'import-{i}.csv', 'own', i+1, f'2026-10-14T10:{i:02}:00', '2026-10-14') for i in range(25)] +
            [(other['id'], 'other-shop.csv', 'own', 1, '2026-10-15T00:00:00', '2026-10-14')])
    default = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    complete = client.get('/api/dashboard', params={'shop_id': shop['id'], 'all_rows': True}).json()
    assert len(default['imports']) == 20 and len(complete['imports']) == 25
    assert default['imports'] == complete['imports'][:20]
    assert complete['imports'][-1]['filename'] == 'import-0.csv'
    assert all(row['shop_id'] == shop['id'] for row in complete['imports'])
    assert default['kpis'] == complete['kpis']


def test_dashboard_all_rows_exposes_market_and_opportunities_beyond_display_caps(market_app):
    app, client, shop, other = market_app
    with app.db() as c:
        c.executemany('''INSERT INTO observations(shop_id,role,source_shop,sku,name,category,price,
            units_30d,sold_total,snapshot_date,data_origin) VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
            [(shop['id'], 'market', 'competitor_shop', f'12.{i+1}', f'Sản phẩm đối thủ {i+1}',
              'Nhà cửa & Đời sống', 10000+i, 10+i, 100+i, '2026-10-14', 'user_import') for i in range(312)] +
            [(other['id'], 'market', 'private_other_shop', '99.1', 'Không thuộc shop này',
              'Nhà cửa & Đời sống', 9000, 10, 100, '2026-10-14', 'user_import')])
    default = client.get('/api/dashboard', params={'shop_id': shop['id']}).json()
    complete = client.get('/api/dashboard', params={'shop_id': shop['id'], 'all_rows': True}).json()
    assert len(default['market_products']) == 300 and len(complete['market_products']) == 312
    assert len(default['opportunities']) == 60 and len(complete['opportunities']) == 312
    assert default['market_products'] == complete['market_products'][:300]
    assert default['opportunities'] == complete['opportunities'][:60]
    assert default['market_products_truncated'] is True and complete['market_products_truncated'] is False
    assert default['market_products_total'] == complete['market_products_total'] == 312
    assert default['kpis'] == complete['kpis']
    assert default['competitor_analysis'] == complete['competitor_analysis']
    assert all(row['shop_id'] == shop['id'] for row in complete['market_products'])


def test_all_crawl_jobs_preserve_filter_order_and_callback_token_redaction(market_app):
    app, client, shop, other = market_app
    with app.db() as c:
        c.executemany('''INSERT INTO crawl_jobs(id,shop_id,target_url,role,status,created_at,result_token)
            VALUES(?,?,?,?,?,?,?)''',
            [(f'job-{i}', shop['id'], shop['url'], 'own', 'done', f'2026-10-14T10:{i:02}:00', f'secret-{i}') for i in range(35)] +
            [('other-job', other['id'], other['url'], 'own', 'done', '2026-10-15T00:00:00', 'other-secret')])
    default = client.get('/api/crawl/jobs', params={'shop_id': shop['id']}).json()
    complete = client.get('/api/crawl/jobs', params={'shop_id': shop['id'], 'all_rows': True}).json()
    assert len(default) == 30 and len(complete) == 35
    assert default == complete[:30]
    assert complete[0]['id'] == 'job-34' and complete[-1]['id'] == 'job-0'
    assert all(row['shop_id'] == shop['id'] and 'result_token' not in row for row in complete)


def test_all_category_runs_include_older_history_and_unchanged_queue_counts(market_app):
    app, client, *_ = market_app
    with app.db() as c:
        c.execute('INSERT INTO market_categories VALUES(?,?,?)', ('10001', 'Gia dụng', 'https://shopee.vn/Gia-dung-cat.10001'))
        c.executemany('''INSERT INTO market_runs(id,category_id,created_at,max_pages,max_products,status)
            VALUES(?,?,?,?,?,?)''',
            [(f'run-{i:03}', '10001', (datetime(2026,10,14)+timedelta(minutes=i)).isoformat(), 5, 150, 'paused') for i in range(305)])
        c.executemany('INSERT INTO market_queue(run_id,sku,url,status) VALUES(?,?,?,?)',
            [('run-000', f'12.{i}', f'https://shopee.vn/product/12/{i}', status) for i,status in enumerate(('done','failed','pending'),1)])
    default = client.get('/api/category-market/runs').json()
    complete = client.get('/api/category-market/runs', params={'all_rows': True}).json()
    assert len(default) == 300 and len(complete) == 305
    assert default == complete[:300]
    assert complete[-1]['id'] == 'run-000'
    assert (complete[-1]['discovered'],complete[-1]['completed'],complete[-1]['failed']) == (3,1,1)


def test_all_category_products_keep_latest_sku_dedup_category_filter_and_raw_json_private(market_app):
    app, client, *_ = market_app
    with app.db() as c:
        c.executemany('INSERT INTO market_categories VALUES(?,?,?)',
            [('10001','Gia dụng','https://shopee.vn/Gia-dung-cat.10001'),('10002','Ngành khác','https://shopee.vn/Khac-cat.10002')])
        rows = [(f'12.{i+1}','2026-10-14','10001',f'SP {i+1}',f'https://shopee.vn/product/12/{i+1}',
                 '2026-10-14T10:00:00+07:00',10000+i,100+i,0,4.8,10,'{"private_raw":"not in list"}') for i in range(505)]
        rows += [('12.1','2026-10-13','10001','SP cũ','https://shopee.vn/product/12/1',
                  '2026-10-13T10:00:00+07:00',9000,50,0,4.8,5,'{}'),
                 ('99.1','2026-10-14','10002','Khác','https://shopee.vn/product/99/1',
                  '2026-10-14T10:00:00+07:00',10000,100,0,4.8,10,'{}')]
        c.executemany('INSERT INTO market_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', rows)
    default = client.get('/api/category-market/products', params={'category_id':'10001'}).json()
    complete = client.get('/api/category-market/products', params={'category_id':'10001','all_rows':True}).json()
    assert len(default['products']) == 500 and len(complete['products']) == 505
    assert default['products'] == complete['products'][:500]
    assert complete['product_count'] == default['product_count'] == 505
    assert complete['snapshot_count'] == default['snapshot_count'] == 506
    assert len({row['sku'] for row in complete['products']}) == 505
    assert all(row['category_id']=='10001' and 'raw_json' not in row for row in complete['products'])
    assert next(row for row in complete['products'] if row['sku']=='12.1')['price'] == 10000
    assert len(client.get('/api/category-market/products',params={'all_rows':True}).json()['products']) == 506


@pytest.mark.parametrize('path', ['/api/dashboard','/api/crawl/jobs','/api/category-market/runs','/api/category-market/products'])
def test_all_rows_is_an_explicit_validated_boolean(market_app, path):
    _, client, shop, _ = market_app
    response = client.get(path,params={'shop_id':shop['id'],'all_rows':'not-a-boolean'})
    assert response.status_code == 422
