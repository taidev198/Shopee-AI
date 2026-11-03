import importlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def appmod(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path/'test.db'))
    import app
    importlib.reload(app)
    return app


def test_price_parsing(appmod):
    assert appmod.valfloat('1.234.567 ₫') == 1234567
    assert appmod.valfloat('12,5') == 12.5
    assert appmod.valfloat('not a number') is None


@pytest.mark.parametrize('enabled', [False, True])
def test_scheduler_lifespan(appmod, monkeypatch, enabled):
    monkeypatch.setattr(appmod, 'crawler_enabled', lambda: enabled)
    # Exercise repeated startup/shutdown without crawling or waiting for a tick.
    monkeypatch.setattr(appmod, 'scheduler_loop', lambda: appmod.scheduler_stop.wait())
    for _ in range(2):
        with TestClient(appmod.app) as client:
            assert client.get('/api/crawl/config').status_code == 200
            thread = appmod._scheduler_thread
            if enabled:
                assert thread is not None and thread.is_alive()
            else:
                assert thread is None
        assert appmod.scheduler_stop.is_set()
        if enabled:
            assert not thread.is_alive()


def test_demo_is_explicitly_synthetic(appmod):
    r=appmod.report('demo')
    assert r['shop']['is_demo'] == 1
    assert len(r['own_products']) == 7
    assert len(r['opportunities']) >= 1
    assert all(x['data_origin']=='synthetic_demo' for x in r['opportunities'])


def test_import_and_score(appmod):
    client=TestClient(appmod.app)
    s=client.post('/api/shops',json={'url':'https://shopee.vn/shop_123','category':'Nhà cửa & Đời sống'}).json()
    for role in ('own','market'):
        data=(Path(appmod.ROOT)/'samples'/f'{role}.csv').read_bytes()
        response=client.post('/api/import',data={'shop_id':s['id'],'role':role,'snapshot_date':'2026-10-12'},files={'file':(f'{role}.csv',data,'text/csv')})
        assert response.status_code==200,response.text
    r=client.get('/api/dashboard',params={'shop_id':s['id']}).json()
    assert r['kpis']['own_products']==3
    assert r['kpis']['market_products']==4
    assert len(r['opportunities'])==4
    assert all(x['confidence'] in ('Thấp','Trung bình') for x in r['opportunities'])
    assert client.get('/api/export/opportunities',params={'shop_id':s['id']}).status_code==200


def test_no_remote_crawling_by_url(appmod):
    c=TestClient(appmod.app)
    assert c.post('/api/shops',json={'url':'https://example.com/shop'}).status_code==422
    assert c.post('/api/shops',json={'url':'http://shopee.vn/shop_123'}).status_code==422
    s=c.post('/api/shops',json={'url':'https://shopee.vn/shop_123'}).json()
    assert appmod.report(s['id'])['kpis']['own_products']==0


def test_authorized_ingestion_disabled_without_key(appmod):
    c=TestClient(appmod.app)
    r=c.post('/api/integrations/push',json={'shop_id':'demo','role':'own','snapshot_date':'2026-10-12','products':[{'name':'ABC'}]})
    assert r.status_code==503
