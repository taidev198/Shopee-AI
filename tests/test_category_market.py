import importlib
import sqlite3
import pytest
from fastapi.testclient import TestClient
from category_market import features, category_url


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    import app
    app = importlib.reload(app)
    return TestClient(app.app)


def create(c, **kw):
    response = c.post('/api/category-market/campaigns', json={
        'categories': [{'name': 'Gia dụng', 'url': 'https://shopee.vn/Gia-dung-cat.10001'}], **kw})
    assert response.status_code == 200, response.text
    return response.json()['run_ids'][0]


def test_resume_dedupe_export(client):
    rid = create(client, max_pages=2, max_products=2)
    assert create(client) == rid
    root = f'/api/category-market/runs/{rid}'
    assert client.get(root+'/next').json()['type'] == 'listing'
    body = {'page':0,'urls':['https://shopee.vn/product/12/34']*2,'has_next':True}
    assert client.post(root+'/listing',json=body).json()['added'] == 1
    assert client.post(root+'/listing',json=body).status_code == 409
    client.post(root+'/pause',json={'error':'network'})
    assert client.get(root+'/next').json() == {'type':'detail','url':'https://shopee.vn/product/12/34'}
    detail = {'url':'https://shopee.vn/product/12/35','name':'Invalid'}
    assert client.post(root+'/detail',json=detail).status_code == 422
    detail.update(url='https://shopee.vn/product/12/34', name='=test', sold_text='1k+ Sold',price_text='89.000₫')
    assert client.post(root+'/detail',json=detail).json()['saved']
    assert not client.post(root+'/detail',json=detail).json()['saved']
    assert client.get(root+'/next').json()['page'] == 1
    body.update(page=1)
    assert client.post(root+'/listing',json=body).json()['listing_done']
    assert client.get(root+'/next').json()['type'] == 'done'
    data=client.get('/api/category-market/products').json()
    assert data['product_count'] == data['snapshot_count'] == 1
    assert data['eligible_count'] == 0
    p=data['products'][0]
    assert p['sold_approx'] == 1 and p['sold_total'] == 1000 and p['price'] == 89000
    assert "'=test" in client.get('/api/category-market/export').text
    assert 'synthetic_demo' not in client.get('/api/category-market/export?format=jsonl').text
    assert create(client) != rid


def test_caps_skip_and_invalid(client):
    rid=create(client,max_products=1)
    root=f'/api/category-market/runs/{rid}'
    assert client.post(root+'/listing',json={'page':0,'urls':['https://evil.com/product/12/34'],'has_next':False}).status_code==422
    assert client.get(root+'/next').json()['page']==0
    assert client.post(root+'/listing',json={'page':0,'urls':['https://shopee.vn/product/12/34','https://shopee.vn/product/12/35'],'has_next':True}).json()=={'added':1,'listing_done':True}
    assert client.post(root+'/skip',json={'error':'unavailable'}).status_code==200
    assert client.get('/api/category-market/runs').json()[0]['status']=='partial'
    assert client.get(root+'/next').json()['type']=='done'


def test_features_no_future_leakage_or_rounded_delta():
    rows=[{'sku':'12.34','day':f'2026-10-{day:02}','sold_total':sold,'sold_approx':0} for day,sold in [(1,10),(3,30),(5,90),(7,20)]]
    f=features(rows)
    assert f[0]['velocity'] is None
    assert f[1]['velocity']==10 and f[1]['trend_score'] is None
    assert f[2]['velocity']==30 and f[2]['acceleration']==20 and f[2]['trend_score']>0
    assert f[3]['velocity'] is None
    assert features(rows[:3])==f[:3]
    rows[1]['sold_approx']=1
    assert all(x['velocity'] is None for x in features(rows))


@pytest.mark.parametrize('url',['http://shopee.vn/test-cat.1','https://shopee.vn.evil.com/test-cat.1','https://x@shopee.vn/test-cat.1','https://shopee.vn/search','https://shopee.vn:443/test-cat.1'])
def test_category_url_rejects_invalid(url):
    with pytest.raises(ValueError): category_url(url)


def test_full_scan_ignores_sample_caps(client):
    rid=create(client,full_scan=True,max_pages=1,max_products=1)
    root=f'/api/category-market/runs/{rid}'
    for page in range(2):
        url=f'https://shopee.vn/product/12/{34+page}'
        result=client.post(root+'/listing',json={'page':page,'urls':[url],'has_next':True})
        assert result.json()=={'added':1,'listing_done':False}
        assert client.post(root+'/detail',json={'url':url,'name':'SP'}).status_code==200
    assert client.get(root+'/next').json()['page']==2
    assert client.get('/api/category-market/runs').json()[0]['discovered']==2


def test_schedule_due_coalesces_and_toggle_stops_auto(client,monkeypatch):
    import category_market
    monkeypatch.setattr(category_market,'now',lambda:'2026-10-14T10:00:00+07:00')
    payload={'categories':[{'name':'Gia dụng','url':'https://shopee.vn/Gia-dung-cat.10001'}],
             'start_at':'2026-10-10T09:00:00+07:00','interval_hours':24,'full_scan':True}
    assert client.post('/api/category-market/schedules',json=payload).status_code==200
    schedule=client.get('/api/category-market/schedules').json()[0]
    sid=schedule['id']
    assert schedule['next_run_at']=='2026-10-15T09:00:00+07:00'
    rid=client.get('/api/category-market/scheduled-ready').json()['run_ids'][0]
    assert len(client.get('/api/category-market/runs').json())==1
    for _ in range(3):
        assert client.get('/api/category-market/scheduled-ready').json()['run_ids']==[rid]
    assert client.patch('/api/category-market/schedules/'+sid,json={'enabled':False}).status_code==200
    assert client.get('/api/category-market/scheduled-ready').json()['run_ids']==[]
    assert client.get(f'/api/category-market/runs/{rid}/next?automatic=true').json()['type']=='paused'
    assert client.get(f'/api/category-market/runs/{rid}/next').json()['type']=='listing'
    assert client.post('/api/category-market/schedules/'+sid+'/run').json()['run_ids']==[rid]
    assert client.get('/api/category-market/schedules').json()[0]['next_run_at']==schedule['next_run_at']
    payload.update(start_at='2026-10-16T08:00:00+07:00',interval_hours=168)
    client.post('/api/category-market/schedules',json=payload)
    schedules=client.get('/api/category-market/schedules').json()
    assert len(schedules)==1 and schedules[0]['id']==sid and schedules[0]['enabled']==1
    assert schedules[0]['interval_hours']==168


def test_schedule_does_not_repeat_paused_and_can_start_next_day(client,monkeypatch):
    import category_market
    monkeypatch.setattr(category_market,'now',lambda:'2026-10-14T10:00:00+07:00')
    payload={'categories':[{'name':'Test','url':'https://shopee.vn/Test-cat.10002'}], 'start_at':'2026-10-14T10:00:00+07:00'}
    client.post('/api/category-market/schedules',json=payload)
    rid=client.get('/api/category-market/scheduled-ready').json()['run_ids'][0]
    client.post(f'/api/category-market/runs/{rid}/pause',json={'error':'captcha'})
    monkeypatch.setattr(category_market,'now',lambda:'2026-10-16T10:00:00+07:00')
    assert client.get('/api/category-market/scheduled-ready').json()['run_ids']==[]
    assert len(client.get('/api/category-market/runs').json())==1
    client.post(f'/api/category-market/runs/{rid}/listing',json={'page':0,'urls':[],'has_next':False})
    monkeypatch.setattr(category_market,'now',lambda:'2026-10-17T10:00:00+07:00')
    new=client.get('/api/category-market/scheduled-ready').json()['run_ids']
    assert len(new)==1 and new[0]!=rid


def test_schedule_requires_timezone(client):
    payload={'categories':[{'name':'Test','url':'https://shopee.vn/Test-cat.10002'}], 'start_at':'2026-10-14T10:00:00'}
    assert client.post('/api/category-market/schedules',json=payload).status_code==422
    payload.update(start_at='2026-10-14T10:00:00+07:00',interval_hours=0)
    assert client.post('/api/category-market/schedules',json=payload).status_code==422


def test_full_scan_replaces_incomplete_sample_without_losing_observations(client):
    sampled=create(client,max_products=1)
    root=f'/api/category-market/runs/{sampled}'
    client.post(root+'/listing',json={'page':0,'urls':['https://shopee.vn/product/12/34'],'has_next':True})
    exhaustive=create(client,full_scan=True)
    assert exhaustive!=sampled
    runs={r['id']:r for r in client.get('/api/category-market/runs').json()}
    assert runs[sampled]['status']=='partial'
    assert runs[exhaustive]['full_scan']==1 and runs[exhaustive]['page']==0
    assert create(client,full_scan=True)==exhaustive


def test_full_scan_continues_duplicate_page_to_new_products_and_actual_end(client):
    rid=create(client,full_scan=True,max_pages=1,max_products=1)
    root=f'/api/category-market/runs/{rid}'
    first='https://shopee.vn/product/12/34'
    assert client.post(root+'/listing',json={'page':0,'urls':[first],'has_next':True}).json()=={'added':1,'listing_done':False}
    assert client.post(root+'/detail',json={'url':first,'name':'Sản phẩm đầu'}).json()['saved']
    assert client.post(root+'/listing',json={'page':1,'urls':[first],'has_next':True}).json()=={'added':0,'listing_done':False}
    assert client.get(root+'/next').json()['page']==2
    run=next(r for r in client.get('/api/category-market/runs').json() if r['id']==rid)
    assert run['status']=='pending' and 'tiếp tục' in run['error']
    second='https://shopee.vn/product/12/35'
    assert client.post(root+'/listing',json={'page':2,'urls':[first,second],'has_next':False}).json()=={'added':1,'listing_done':True}
    assert client.get(root+'/next').json()=={'type':'detail','url':second}
    assert client.post(root+'/detail',json={'url':second,'name':'Sản phẩm trang sau'}).json()['saved']
    assert client.get(root+'/next').json()['type']=='done'
    assert client.get('/api/category-market/products').json()['product_count']==2


def test_exhaustive_upgrade_rejects_stale_sample_checkpoint_and_preserves_saved_data(client):
    sampled=create(client,max_products=10,max_pages=5)
    old=f'/api/category-market/runs/{sampled}'
    first='https://shopee.vn/product/12/34'
    in_flight='https://shopee.vn/product/12/35'
    client.post(old+'/listing',json={'page':0,'urls':[first,in_flight],'has_next':True})
    saved={'url':first,'name':'Đã lưu trước khi nâng cấp','price_text':'89.000₫'}
    assert client.post(old+'/detail',json=saved).json()['saved']
    assert client.get(old+'/next').json()=={'type':'detail','url':in_flight}
    exhaustive=create(client,full_scan=True,max_pages=1,max_products=1)
    assert exhaustive!=sampled
    assert client.post(old+'/detail',json={'url':in_flight,'name':'Kết quả trình duyệt về muộn'}).status_code==409
    assert client.post(old+'/listing',json={'page':1,'urls':[in_flight],'has_next':True}).status_code==409
    assert client.post(old+'/skip',json={'error':'Kết quả lỗi về muộn'}).status_code==409
    assert client.post(old+'/pause',json={'error':'Thông báo dừng về muộn'}).status_code==200
    assert client.post(old+'/detail',json=saved).json()=={'saved':False}
    assert client.get(old+'/next').json()['type']=='done'
    assert create(client,full_scan=True)==exhaustive
    data=client.get('/api/category-market/products').json()
    assert data['product_count']==1 and data['products'][0]['name']==saved['name']
    runs={r['id']:r for r in client.get('/api/category-market/runs').json()}
    assert runs[sampled]['status']=='partial' and runs[sampled]['completed']==1
    assert runs[exhaustive]['status']=='pending' and runs[exhaustive]['page']==0


def test_full_scan_queue_survives_application_reload_without_restarting_listing(client):
    rid=create(client,full_scan=True,max_pages=1,max_products=1)
    root=f'/api/category-market/runs/{rid}'
    urls=['https://shopee.vn/product/12/34','https://shopee.vn/product/12/35']
    client.post(root+'/listing',json={'page':0,'urls':urls,'has_next':True})
    client.post(root+'/detail',json={'url':urls[0],'name':'Đã checkpoint'})
    client.post(root+'/pause',json={'error':'Đóng trình duyệt'})
    import app
    restarted=TestClient(importlib.reload(app).app)
    assert restarted.get(root+'/next').json()=={'type':'detail','url':urls[1]}
    assert create(restarted,full_scan=True)==rid
    assert restarted.post(root+'/detail',json={'url':urls[1],'name':'Tiếp tục hàng đợi'}).json()['saved']
    assert restarted.get(root+'/next').json()['page']==1
    run=next(r for r in restarted.get('/api/category-market/runs').json() if r['id']==rid)
    assert run['completed']==run['discovered']==2 and run['listing_done']==0


def test_resume_paused_listing_preserves_page_good_queue_and_saved_snapshots(client):
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    for page in (0,1):
        url=f'https://shopee.vn/product/12/{34+page}'
        client.post(root+'/listing',json={'page':page,'urls':[url],'has_next':True})
        client.post(root+'/detail',json={'url':url,'name':f'Đã lưu {page}'})
    before=client.get('/api/category-market/export?format=jsonl').text
    client.post(root+'/pause',json={'error':'Lỗi kết nối trang tiếp theo'})
    assert client.post(root+'/resume',json={}).json()=={'run_id':rid,'status':'pending','requeued':0}
    assert client.get(root+'/next').json()['page']==2
    run=next(r for r in client.get('/api/category-market/runs').json() if r['id']==rid)
    assert run['page']==2 and run['listing_done']==0
    assert run['completed']==run['discovered']==2 and run['error']==''
    assert client.get('/api/category-market/export?format=jsonl').text==before


def test_resume_partial_retries_only_failed_products_and_is_idempotent(client):
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    saved='https://shopee.vn/product/12/34'
    failed='https://shopee.vn/product/12/35'
    client.post(root+'/listing',json={'page':0,'urls':[saved,failed],'has_next':False})
    client.post(root+'/detail',json={'url':saved,'name':'Dữ liệu tốt','sold_text':'12 Sold'})
    before=client.get('/api/category-market/export?format=jsonl').text
    client.post(root+'/skip',json={'error':'Trang sản phẩm chưa tải'})
    assert client.get(root+'/next').json()['type']=='done'
    assert client.post(root+'/detail',json={'url':failed,'name':'Chưa cho phép retry'}).status_code==409
    assert client.post(root+'/resume',json={}).json()=={'run_id':rid,'status':'pending','requeued':1}
    assert client.post(root+'/resume',json={}).json()=={'run_id':rid,'status':'pending','requeued':0}
    assert client.get(root+'/next').json()=={'type':'detail','url':failed}
    run=next(r for r in client.get('/api/category-market/runs').json() if r['id']==rid)
    assert run['completed']==1 and run['failed']==0 and run['discovered']==2
    assert run['page']==1 and run['listing_done']==1 and run['error']==''
    assert client.get('/api/category-market/export?format=jsonl').text==before
    assert client.post(root+'/detail',json={'url':saved,'name':'Không được ghi đè'}).json()=={'saved':False}
    assert client.post(root+'/detail',json={'url':failed,'name':'Đã thử lại thành công'}).json()['saved']
    assert client.get(root+'/next').json()['type']=='done'
    after=client.get('/api/category-market/export?format=jsonl').text
    assert client.post(root+'/resume',json={}).json()=={'run_id':rid,'status':'done','requeued':0}
    assert client.get('/api/category-market/export?format=jsonl').text==after


def test_resume_paused_run_requeues_earlier_failures_without_restarting_remaining_work(client):
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    urls=[f'https://shopee.vn/product/12/{number}' for number in (34,35,36)]
    client.post(root+'/listing',json={'page':0,'urls':urls,'has_next':True})
    client.post(root+'/detail',json={'url':urls[0],'name':'Đã lưu'})
    client.post(root+'/skip',json={'error':'SP thứ hai lỗi'})
    client.post(root+'/pause',json={'error':'Tạm dừng ở SP thứ ba'})
    assert client.post(root+'/resume',json={}).json()['requeued']==1
    assert client.get(root+'/next').json()=={'type':'detail','url':urls[1]}
    client.post(root+'/detail',json={'url':urls[1],'name':'Đã thử lại'})
    assert client.get(root+'/next').json()=={'type':'detail','url':urls[2]}


def test_resume_cannot_revive_superseded_sample_or_compete_with_another_active_run(client):
    sampled=create(client,max_products=1)
    sample_root=f'/api/category-market/runs/{sampled}'
    client.post(sample_root+'/listing',json={'page':0,'urls':['https://shopee.vn/product/12/34'],'has_next':True})
    exhaustive=create(client,full_scan=True)
    runs={r['id']:r for r in client.get('/api/category-market/runs').json()}
    assert runs[sampled]['superseded']==1 and runs[exhaustive]['superseded']==0
    assert client.post(sample_root+'/resume',json={}).status_code==409
    # Even after its replacement finishes, a superseded cursor stays unusable.
    client.post(f'/api/category-market/runs/{exhaustive}/listing',json={'page':0,'urls':[],'has_next':False})
    assert client.post(sample_root+'/resume',json={}).status_code==409
    partial=create(client,full_scan=True)
    root=f'/api/category-market/runs/{partial}'
    client.post(root+'/listing',json={'page':0,'urls':['https://shopee.vn/product/12/35'],'has_next':False})
    client.post(root+'/skip',json={'error':'Cần thử lại'})
    current=create(client,full_scan=True)
    assert current!=partial
    assert client.post(root+'/resume',json={}).status_code==409
    assert client.get(f'/api/category-market/runs/{current}/next').json()['type']=='listing'
    assert client.get(root+'/next').json()['type']=='done'


def test_resume_missing_run_returns_not_found(client):
    assert client.post('/api/category-market/runs/not-found/resume',json={}).status_code==404


def test_legacy_superseded_samples_are_migrated_once_and_remain_unresumable(tmp_path,monkeypatch):
    path=tmp_path/'legacy.db'
    with sqlite3.connect(path) as c:
        c.executescript('''
          CREATE TABLE market_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT UNIQUE NOT NULL);
          CREATE TABLE market_runs(id TEXT PRIMARY KEY,category_id TEXT NOT NULL,created_at TEXT NOT NULL,
            max_pages INTEGER NOT NULL,max_products INTEGER NOT NULL,page INTEGER DEFAULT 0,
            listing_done INTEGER DEFAULT 0,status TEXT DEFAULT 'pending',error TEXT DEFAULT '',
            full_scan INTEGER NOT NULL DEFAULT 0,schedule_id TEXT NOT NULL DEFAULT '');
          INSERT INTO market_categories VALUES('10001','Gia dụng','https://shopee.vn/Gia-dung-cat.10001');
          INSERT INTO market_runs(id,category_id,created_at,max_pages,max_products,status,error)
            VALUES('legacy','10001','2026-10-14',5,150,'partial','Đã chuyển sang lượt quét hết ngành hàng mới; dữ liệu đã lưu được giữ nguyên.');
        ''')
    monkeypatch.setenv('MARKET_DB',str(path))
    import app
    migrated=TestClient(importlib.reload(app).app)
    run=next(r for r in migrated.get('/api/category-market/runs').json() if r['id']=='legacy')
    assert run['superseded']==1
    assert migrated.post('/api/category-market/runs/legacy/resume',json={}).status_code==409
    with sqlite3.connect(path) as c:
        c.execute("UPDATE market_runs SET error='Ghi chú đã được đổi' WHERE id='legacy'")
    reopened=TestClient(importlib.reload(app).app)
    run=next(r for r in reopened.get('/api/category-market/runs').json() if r['id']=='legacy')
    assert run['superseded']==1 and run['error']=='Ghi chú đã được đổi'
    assert reopened.post('/api/category-market/runs/legacy/resume',json={}).status_code==409


def test_timeout_skip_is_bound_to_its_product_and_repeated_request_never_skips_next_sku(client):
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    first,second=['https://shopee.vn/product/12/'+number for number in ('34','35')]
    client.post(root+'/listing',json={'page':0,'urls':[first,second],'has_next':False})
    payload={'url':first,'error':'Trang chi tiết hết thời gian chờ'}
    assert client.post(root+'/skip',json=payload).json()=={'skipped':True}
    assert client.post(root+'/skip',json=payload).json()=={'skipped':False}
    assert client.get(root+'/next').json()=={'type':'detail','url':second}
    result=next(row for row in client.get('/api/category-market/runs').json() if row['id']==rid)
    assert (result['discovered'],result['completed'],result['failed'])==(2,0,1)
    assert result['listing_done']==1 and result['page']==1
    assert client.post(root+'/detail',json={'url':second,'name':'Đã đọc sản phẩm còn lại'}).json()['saved']
    before=client.get('/api/category-market/export?format=jsonl').text
    assert client.post(root+'/skip',json=payload).json()=={'skipped':False}
    result=next(row for row in client.get('/api/category-market/runs').json() if row['id']==rid)
    assert result['status']=='partial' and result['failed']==1 and result['completed']==1
    assert client.post(root+'/resume',json={}).json()['requeued']==1
    assert client.get(root+'/next').json()=={'type':'detail','url':first}
    assert client.get('/api/category-market/export?format=jsonl').text==before
    assert client.post(root+'/detail',json={'url':first,'name':'Sản phẩm thử lại'}).json()['saved']
    assert client.get(root+'/next').json()['type']=='done'
    assert client.post(root+'/skip',json=payload).json()=={'skipped':False}
    result=next(row for row in client.get('/api/category-market/runs').json() if row['id']==rid)
    assert result['status']=='done' and result['completed']==2 and result['failed']==0


def test_delayed_timeout_for_already_saved_product_leaves_next_pending_product_untouched(client):
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    first,second=['https://shopee.vn/product/12/'+number for number in ('34','35')]
    client.post(root+'/listing',json={'page':0,'urls':[first,second],'has_next':False})
    assert client.post(root+'/detail',json={'url':first,'name':'Checkpoint tốt','sold_text':'12 Sold'}).json()['saved']
    before=client.get('/api/category-market/export?format=jsonl').text
    response=client.post(root+'/skip',json={'url':'https://www.shopee.vn/Ten-san-pham-i.12.34?source=listing','error':'Callback timeout về muộn'})
    assert response.status_code==200 and response.json()=={'skipped':False}
    assert client.get(root+'/next').json()=={'type':'detail','url':second}
    assert client.get('/api/category-market/export?format=jsonl').text==before
    result=next(row for row in client.get('/api/category-market/runs').json() if row['id']==rid)
    assert result['completed']==1 and result['failed']==0


@pytest.mark.parametrize('url',[
    'https://evil.example/product/12/34','https://shopee.vn.evil.example/product/12/34',
    'https://name@shopee.vn/product/12/34','https://shopee.vn:443/product/12/34',
    'https://shopee.vn/search?redirect=/product/12/34','https://shopee.vn/product/12/99','',
])
def test_skip_rejects_invalid_or_unqueued_url_without_advancing_queue(client,url):
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    first='https://shopee.vn/product/12/34'
    client.post(root+'/listing',json={'page':0,'urls':[first],'has_next':False})
    assert client.post(root+'/skip',json={'url':url,'error':'Không đọc được'}).status_code==422
    assert client.get(root+'/next').json()=={'type':'detail','url':first}
    result=next(row for row in client.get('/api/category-market/runs').json() if row['id']==rid)
    assert result['failed']==0 and result['completed']==0


def test_skip_cannot_target_product_queued_in_another_category_run(client):
    first=create(client,full_scan=True)
    other=client.post('/api/category-market/campaigns',json={'full_scan':True,'categories':[
        {'name':'Ngành khác','url':'https://shopee.vn/Khac-cat.10002'}]}).json()['run_ids'][0]
    first_root=f'/api/category-market/runs/{first}'
    other_root=f'/api/category-market/runs/{other}'
    urls=['https://shopee.vn/product/12/34','https://shopee.vn/product/12/35']
    for root,url in zip((first_root,other_root),urls):
        client.post(root+'/listing',json={'page':0,'urls':[url],'has_next':False})
    assert client.post(first_root+'/skip',json={'url':urls[1],'error':'Lỗi ở ngành khác'}).status_code==422
    assert client.get(first_root+'/next').json()=={'type':'detail','url':urls[0]}
    assert client.get(other_root+'/next').json()=={'type':'detail','url':urls[1]}


def test_url_bound_skip_does_not_revive_a_superseded_sample(client):
    old=create(client,max_products=1)
    root=f'/api/category-market/runs/{old}'
    first='https://shopee.vn/product/12/34'
    client.post(root+'/listing',json={'page':0,'urls':[first],'has_next':True})
    replacement=create(client,full_scan=True)
    assert replacement!=old
    assert client.post(root+'/skip',json={'url':first,'error':'Timeout của lượt cũ'}).status_code==409
    rows={row['id']:row for row in client.get('/api/category-market/runs').json()}
    assert rows[old]['superseded']==1 and rows[old]['failed']==0
    assert rows[replacement]['failed']==0 and rows[replacement]['status']=='pending'


def test_concurrent_repeated_timeout_skips_only_one_sku(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    rid=create(client,full_scan=True)
    root=f'/api/category-market/runs/{rid}'
    first,second=['https://shopee.vn/product/12/'+number for number in ('34','35')]
    client.post(root+'/listing',json={'page':0,'urls':[first,second],'has_next':False})
    barrier=Barrier(2)
    def skip_once(_):
        barrier.wait(timeout=5)
        response=client.post(root+'/skip',json={'url':first,'error':'Timeout lặp'})
        assert response.status_code==200,response.text
        return response.json()['skipped']
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(skip_once,range(2)))
    assert sorted(results)==[False,True]
    assert client.get(root+'/next').json()=={'type':'detail','url':second}
    result=next(row for row in client.get('/api/category-market/runs').json() if row['id']==rid)
    assert result['failed']==1 and result['completed']==0
