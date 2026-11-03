import importlib
import os
import time
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from crawl_worker import (extract_public_cards, parse_abbreviated,
                          validate_shop_url, CrawlBlocked)

HTML_FIXTURE = '''
<html><body>
<a href="https://shopee.vn/Hop-dung-do-dep-i.123456.56789">
 <img alt="Hộp đựng đồ gấp gọn đa năng" />
 <span class="price">₫89.000</span><span>Đã bán 1,2k</span>
</a>
<a href="/Khan-microfiber-i.123456.56790">
 <img alt="Khăn lau bếp microfiber 5 chiếc" />
 <span>₫49.000</span><span>Đã bán 850</span>
</a>
<a href="https://evil.test/i.123456.444"><img alt="Fake item from outside site" />₫1.000</a>
<a href="https://shopee.vn/other-page">other link</a>
</body></html>
'''


def test_parser_dom_only_no_30_day_fabrication():
    rows=extract_public_cards(HTML_FIXTURE,'https://shopee.vn/testshop','Test shop','Nhà cửa & Đời sống')
    assert len(rows)==2
    assert rows[0]['sku']=='123456.56789'
    assert rows[0]['price']==89000
    assert rows[0]['sold_total']==1200
    assert rows[0]['units_30d'] is None
    assert rows[0]['revenue_30d'] is None
    assert rows[1]['sold_total']==850
    assert all(row['source_shop']=='Test shop' for row in rows)


def test_shop_url_strict():
    assert validate_shop_url('https://shopee.vn/familys_house')=='https://shopee.vn/familys_house'
    for url in ('http://shopee.vn/a', 'https://shopee.vn.evil.com/abc',
                'https://shopee.vn/abc?redirect=https://evil.com',
                'https://127.0.0.1:8000/admin', 'https://shopee.vn/product/42/1',
                'https://shopee.vn/login', 'file:///etc/passwd'):
        with pytest.raises(ValueError): validate_shop_url(url)


def test_units_parsing():
    assert parse_abbreviated('1,2k')==1200
    assert parse_abbreviated('3.5K')==3500
    assert parse_abbreviated('12.300')==12300
    assert parse_abbreviated('850')==850


@pytest.fixture
def appmod(tmp_path,monkeypatch):
    monkeypatch.setenv('MARKET_DB',str(tmp_path/'crawler.db'))
    monkeypatch.delenv('SHOPEE_CRAWL_AUTHORIZED',raising=False)
    monkeypatch.delenv('SHOPEE_PERMISSION_REFERENCE',raising=False)
    import app
    return importlib.reload(app)


def test_crawler_available_without_permission_configuration(appmod):
    client=TestClient(appmod.app)
    config=client.get('/api/crawl/config').json()
    assert config['enabled'] is True
    assert config['blockers'] == []
    # Demo data remains separate from real collection.
    assert client.post('/api/crawl/jobs',json={'shop_id':'demo','role':'own'}).status_code==404



def test_background_collect_without_permission_configuration(appmod,monkeypatch):
    # No real network traffic: the worker reads an offline HTML card fixture.
    monkeypatch.setattr(appmod,'crawl_public_shop',lambda url,shop_name,category:
                        extract_public_cards(HTML_FIXTURE,url,shop_name,category))
    client=TestClient(appmod.app)
    shop=client.post('/api/shops',json={'url':'https://shopee.vn/familys_house','category':'Nhà cửa & Đời sống'}).json()
    r=client.post('/api/crawl/jobs',json={'shop_id':shop['id'],'role':'own'})
    assert r.status_code==202,r.text
    job=None
    for _ in range(40):
        job=client.get('/api/crawl/jobs/'+r.json()['job_id']).json()
        if job['status'] in ('done','failed'): break
        time.sleep(.05)
    assert job['status']=='done',job
    assert job['rows_imported']==2
    d=client.get('/api/dashboard',params={'shop_id':shop['id']}).json()
    assert d['kpis']['own_products']==2
    assert d['kpis']['units_30d'] is None # first crawl cannot infer monthly units
    assert all(p['data_origin']=='browser_public_dom' for p in d['own_products'])


def test_blocked_shop_reason_is_saved_in_job_history(appmod, monkeypatch, caplog):
    message = 'Shopee chuyển bot đến /verify/traffic/error (chặn lưu lượng truy cập).'
    def blocked_collector(*args):
        raise CrawlBlocked(message)
    monkeypatch.setattr(appmod, 'crawl_public_shop', blocked_collector)
    client = TestClient(appmod.app)
    shop = client.post('/api/shops', json={'url': 'https://shopee.vn/familys_house'}).json()
    job = client.post('/api/crawl/jobs', json={'shop_id': shop['id'], 'role': 'own'}).json()
    for _ in range(40):
        result = client.get('/api/crawl/jobs/' + job['job_id']).json()
        if result['status'] == 'failed':
            break
        time.sleep(.05)
    assert result['status'] == 'failed'
    assert result['error'] == message
    assert result['rows_imported'] == 0
    assert message in caplog.text
    assert client.get('/api/dashboard', params={'shop_id': shop['id']}).json()['kpis']['own_products'] == 0


def test_snapshot_delta_marks_estimate_and_candidate(appmod):
    with appmod.db() as c:
        d0=(date.today()-timedelta(days=14)).isoformat()
        d1=date.today().isoformat()
        c.execute("INSERT INTO shops VALUES (?,?,?,?,?,?)",('shop','Other shop','https://shopee.vn/other_shop','Nhà cửa & Đời sống',0,'2026-10-13'))
        m={'sku':'1.2','source_shop':'other','name':'Kệ dán nhà tắm 3 tầng','category':'Nhà cửa & Đời sống',
           'price':85000.,'units_30d':None,'revenue_30d':None,'sold_total':200.,'views_30d':None,
           'rating':None,'review_count':None,'cost':None,'stock':None,'product_url':'https://shopee.vn/ke-i.1.2'}
        appmod.insert_obs(c,'shop','market',[m],d0,'browser_public_dom')
        m['sold_total']=242.
        appmod.insert_obs(c,'shop','market',[m],d1,'browser_public_dom')
    data=appmod.report('shop')
    assert data['opportunities'][0]['units_30d']==90.0
    assert data['opportunities'][0]['units_basis']=='estimated_snapshot_delta'
    assert data['opportunities'][0]['confidence']=='Thấp'
    assert 'ƯỚC TÍNH' in data['opportunities'][0]['reasons'][0]


def test_provisional_cumulative_does_not_claim_monthly_sales(appmod):
    with appmod.db() as c:
        c.execute("INSERT INTO shops VALUES (?,?,?,?,?,?)",('shop','Other shop','https://shopee.vn/other_shop','Nhà cửa & Đời sống',0,'2026-10-13'))
        m={'sku':'1.2','source_shop':'other','name':'Kệ dán nhà tắm 3 tầng','category':'Nhà cửa & Đời sống',
           'price':85000.,'units_30d':None,'revenue_30d':None,'sold_total':200.,'views_30d':None,
           'rating':None,'review_count':None,'cost':None,'stock':None,'product_url':'https://shopee.vn/ke-i.1.2'}
        appmod.insert_obs(c,'shop','market',[m],date.today().isoformat(),'browser_public_dom')
    data=appmod.report('shop')
    assert data['opportunities'][0]['is_provisional']==True
    assert data['opportunities'][0]['units_30d'] is None
    assert data['opportunities'][0]['confidence']=='Rất thấp'
    assert data['opportunities'][0]['score']<=65


def test_schedule_api_and_disable(appmod,monkeypatch):
    c=TestClient(appmod.app)
    shop=c.post('/api/shops',json={'url':'https://shopee.vn/familys_house','category':'Nhà cửa & Đời sống'}).json()
    bad=c.post('/api/crawl/schedules',json={'shop_id':shop['id'],'target_url':shop['url'],'interval_hours':2,'role':'own'})
    assert bad.status_code==422
    scheduled=c.post('/api/crawl/schedules',json={'shop_id':shop['id'],'target_url':shop['url'],'interval_hours':24,'role':'own'})
    assert scheduled.status_code==200,scheduled.text
    result=c.get('/api/crawl/schedules',params={'shop_id':shop['id']}).json()
    assert len(result)==1
    assert result[0]['interval_hours']==24
    deleted=c.delete(f"/api/crawl/schedules/{result[0]['id']}",params={'shop_id':shop['id']})
    assert deleted.status_code==200
    assert c.get('/api/crawl/schedules',params={'shop_id':shop['id']}).json()==[]


def test_scheduler_tick_commits_before_sending_worker(appmod,monkeypatch):
    c=TestClient(appmod.app)
    shop=c.post('/api/shops',json={'url':'https://shopee.vn/familys_house','category':'Nhà cửa & Đời sống'}).json()
    created=c.post('/api/crawl/schedules',json={'shop_id':shop['id'],'target_url':shop['url'],'role':'own','interval_hours':24}).json()
    seen=[]
    class FakeExecutor:
        def submit(self, fn, jid):
            with appmod.db() as conn:
                assert conn.execute('SELECT 1 FROM crawl_jobs WHERE id=?',(jid,)).fetchone()
            seen.append(jid)
    monkeypatch.setattr(appmod,'executor',FakeExecutor())
    with appmod.db() as conn:
        conn.execute('UPDATE crawl_targets SET next_run_at=? WHERE id=?',('2000-01-01T00:00:00',created['id']))
    appmod.scheduler_tick()
    assert len(seen)==1
    appmod.scheduler_tick()
    assert len(seen)==1 # queued, no duplicates


def test_worker_reaches_robots_without_permission_configuration(monkeypatch):
    import crawl_worker
    monkeypatch.delenv('SHOPEE_CRAWL_AUTHORIZED', raising=False)
    monkeypatch.delenv('SHOPEE_PERMISSION_REFERENCE', raising=False)
    checked=[]
    def disallow(url):
        checked.append(url)
        return False, 0
    monkeypatch.setattr(crawl_worker, 'robots_allowed', disallow)
    with pytest.raises(CrawlBlocked, match='robots.txt'):
        crawl_worker.crawl_public_shop('https://shopee.vn/test_shop', 'Test')
    assert checked == ['https://shopee.vn/test_shop']
