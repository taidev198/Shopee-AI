import hashlib
import importlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

import auth


SYSTEM_PASSWORD='System-Password-For-Tests-2026!'
USER_PASSWORD='User-Password-For-Tests-2026!'


@pytest.fixture
def auth_app(tmp_path,monkeypatch):
    monkeypatch.setenv('MARKET_DB',str(tmp_path/'auth.db'))
    import app
    return importlib.reload(app)


def anonymous(app):
    return TestClient(app.app,headers={'Origin':'http://testserver'})


def bootstrap(app):
    client=anonymous(app)
    response=client.post('/api/auth/setup',json={'username':'test-system','password':SYSTEM_PASSWORD})
    assert response.status_code==200,response.text
    client.headers['X-CSRF-Token']=response.json()['csrf_token']
    return client,response.json()['account']


def login(app,username,password):
    client=anonymous(app)
    response=client.post('/api/auth/login',json={'username':username,'password':password})
    assert response.status_code==200,response.text
    client.headers['X-CSRF-Token']=response.json()['csrf_token']
    return client


@pytest.fixture
def accounts(auth_app):
    system,account=bootstrap(auth_app)
    assigned=system.post('/api/shops',json={'url':'https://shopee.vn/assigned_auth_shop'}).json()
    foreign=system.post('/api/shops',json={'url':'https://shopee.vn/foreign_auth_shop'}).json()
    response=system.post('/api/auth/accounts',json={'username':'test-user','password':USER_PASSWORD,'shop_ids':[assigned['id']]})
    assert response.status_code==200,response.text
    user=login(auth_app,'test-user',USER_PASSWORD)
    return auth_app,system,user,account,response.json(),assigned,foreign


def test_password_hashes_are_salted_strong_and_constant_time_verified():
    first,second=auth.password_hash(USER_PASSWORD),auth.password_hash(USER_PASSWORD)
    assert first!=second and first.startswith('pbkdf2_sha256$600000$')
    assert auth.password_matches(USER_PASSWORD,first)
    assert not auth.password_matches('Wrong-Password-For-Tests',first)
    assert not auth.password_matches(USER_PASSWORD,'not-a-hash')


def test_first_setup_is_atomic_and_stores_only_session_token_digest(auth_app):
    assert anonymous(auth_app).get('/api/auth/me').json()=={'authenticated':False,'setup_required':True}
    barrier=Barrier(2)
    def setup_once(index):
        client=anonymous(auth_app);barrier.wait(timeout=5)
        response=client.post('/api/auth/setup',json={'username':f'system-{index}','password':SYSTEM_PASSWORD})
        return client,response
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(setup_once,range(2)))
    assert sorted(response.status_code for _,response in results)==[200,409]
    client,response=next(item for item in results if item[1].status_code==200)
    cookie=response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=strict' in cookie and 'path=/' in cookie
    token=client.cookies.get(auth.COOKIE_NAME)
    assert token and len(token)==43
    with auth_app.db() as c:
        assert c.execute('SELECT count(*) FROM auth_accounts').fetchone()[0]==1
        row=c.execute('SELECT * FROM auth_sessions').fetchone()
        assert row['token_hash']==hashlib.sha256(token.encode()).hexdigest() and row['token_hash']!=token
        assert c.execute('SELECT password_hash FROM auth_accounts').fetchone()[0]!=SYSTEM_PASSWORD
    assert anonymous(auth_app).get('/api/auth/me').json()['setup_required'] is False


def test_anonymous_access_is_guest_only_and_direct_shells_require_login(auth_app):
    client=anonymous(auth_app)
    assert client.get('/').status_code==200 and client.get('/api/health').status_code==200
    for path in ('/api/shops','/api/dashboard?shop_id=demo','/api/category-market/products','/api/auth/accounts'):
        assert client.get(path).status_code==401,path
    for path in ('/user','/system','/workspace','/static/index.html','/static/system.html'):
        response=client.get(path,follow_redirects=False)
        assert response.status_code==307 and response.headers['location'].startswith('/setup?'),path
    bootstrap(auth_app)
    assert client.get('/setup',follow_redirects=False).headers['location']=='/login'
    assert client.get('/user',follow_redirects=False).headers['location'].startswith('/login?')


@pytest.mark.parametrize('origin,host',[
    ('https://evil.example','testserver'),('http://evil.example','evil.example'),
    ('http://testserver','evil.example'),('null','testserver'),('', 'testserver'),
])
def test_bootstrap_rejects_cross_origin_or_untrusted_host(auth_app,origin,host):
    client=anonymous(auth_app)
    response=client.post('/api/auth/setup',headers={'Origin':origin,'Host':host},
                         json={'username':'system-test','password':SYSTEM_PASSWORD})
    assert response.status_code==403
    assert auth_app.app.state.auth.setup_required()


def test_dns_rebinding_does_not_treat_testserver_host_as_trusted_in_uvicorn_scope():
    scope={'type':'http','scheme':'http','server':('127.0.0.1',8000),
           'headers':[(b'host',b'testserver:8000'),(b'origin',b'http://testserver:8000')]}
    assert not auth.same_local_origin(scope)
    scope['headers']=[(b'host',b'localhost:8000'),(b'origin',b'http://127.0.0.1:8000')]
    assert not auth.same_local_origin(scope)
    scope['headers']=[(b'host',b'localhost:8000'),(b'origin',b'http://localhost:8000')]
    assert auth.same_local_origin(scope)
    scope['headers']=[(b'host',b'localhost:9000'),(b'origin',b'http://localhost:9000')]
    assert not auth.same_local_origin(scope)


def test_me_has_no_password_or_session_secret_and_session_survives_server_reload(accounts):
    app,system,user,system_account,user_account,assigned,_=accounts
    data=user.get('/api/auth/me').json()
    assert data['account']['id']==user_account['id'] and data['account']['role']=='user'
    assert data['assigned_shop_ids']==[assigned['id']] and data['csrf_token']
    assert 'password' not in str(data).lower() and 'token_hash' not in str(data)
    cookie=user.cookies.get(auth.COOKIE_NAME)
    app=importlib.reload(app)
    restarted=anonymous(app);restarted.cookies.set(auth.COOKIE_NAME,cookie)
    assert restarted.get('/api/auth/me').json()['account']['id']==user_account['id']


def test_logout_revokes_the_server_session_and_expired_sessions_cannot_access_data(accounts,monkeypatch):
    app,_,user,_,_,_,_=accounts
    token=user.cookies.get(auth.COOKIE_NAME)
    assert user.post('/api/auth/logout').status_code==200
    stolen=anonymous(app);stolen.cookies.set(auth.COOKIE_NAME,token)
    assert stolen.get('/api/shops').status_code==401
    user=login(app,'test-user',USER_PASSWORD)
    stamp=auth.now();monkeypatch.setattr(auth,'now',lambda:stamp+auth.SESSION_SECONDS+1)
    assert user.get('/api/shops').status_code==401


def test_signed_mutations_require_csrf_and_same_local_origin(accounts):
    _,system,_,_,_,_,_=accounts
    body={'url':'https://shopee.vn/csrf_guard_shop'}
    assert system.post('/api/shops',headers={'X-CSRF-Token':''},json=body).status_code==403
    assert system.post('/api/shops',headers={'X-CSRF-Token':'wrong'},json=body).status_code==403
    assert system.post('/api/shops',headers={'Origin':'https://evil.example'},json=body).status_code==403
    assert system.post('/api/shops',json=body).status_code==200


def test_user_reads_only_assigned_shops_and_adding_existing_url_links_it(accounts):
    _,_,user,_,_,assigned,foreign=accounts
    assert [row['id'] for row in user.get('/api/shops').json()]==[assigned['id']]
    assert user.get('/api/dashboard',params={'shop_id':assigned['id']}).status_code==200
    assert user.get('/api/dashboard',params={'shop_id':foreign['id']}).status_code==403
    assert user.get('/api/seller/analysis',params={'shop_id':foreign['id']}).status_code==403
    claimed=user.post('/api/shops',json={'url':foreign['url']})
    assert claimed.status_code==200 and claimed.json()['id']==foreign['id']
    assert user.get('/api/dashboard',params={'shop_id':foreign['id']}).status_code==200
    created=user.post('/api/shops',json={'url':'https://shopee.vn/created_by_user'})
    assert created.status_code==200,created.text
    assert {row['id'] for row in user.get('/api/shops').json()}=={assigned['id'],foreign['id'],created.json()['id']}
    assert user.post('/api/shops',json={'url':created.json()['url']}).json()['id']==created.json()['id']


@pytest.mark.parametrize('method,path',[
    ('post','/api/import'),('post','/api/crawl/schedules'),('post','/api/crawl/import-html'),('get','/api/category-market/runs'),('post','/api/category-market/campaigns'),
    ('get','/api/category-market/schedules'),('post','/api/category-market/ml/train'),
    ('post','/api/integrations/push'),('put','/api/seller/ai/config'),('get','/api/auth/accounts'),
])
def test_user_cannot_use_system_operations_even_with_valid_session_and_csrf(accounts,method,path):
    _,_,user,_,_,_,_=accounts
    assert getattr(user,method)(path).status_code==403,path


def test_user_can_read_global_public_market_data_but_cannot_enter_system_page(accounts):
    _,_,user,_,_,_,_=accounts
    for path in ('/api/category-market/analysis','/api/category-market/products','/api/category-market/export','/api/seller/ai/config'):
        assert user.get(path).status_code==200,path
    for path in ('/system','/static/system.html'):
        response=user.get(path,follow_redirects=False)
        assert response.status_code==403
        assert response.headers['content-type'].startswith('text/html')
        assert 'Khu vực này dành cho System.' in response.text
        assert 'href="/user"' in response.text and 'href="/"' in response.text
        assert 'href="/static/auth.css"' in response.text
        assert response.headers['cache-control']=='no-store'
        assert '<script' not in response.text
    denied_api=user.get('/api/auth/accounts')
    assert denied_api.status_code==403
    assert denied_api.headers['content-type'].startswith('application/json')
    assert isinstance(denied_api.json()['detail'],str)
    assert user.get('/user').status_code==200


def test_shop_scope_checks_json_body_query_duplicates_and_replays_body_for_endpoint(accounts):
    app,system,user,_,_,assigned,foreign=accounts
    # Give the endpoint a real own SKU, then exercise JSON body replay on a User mutation.
    with app.db() as c:
        c.execute('''INSERT INTO observations(shop_id,role,source_shop,sku,name,price,snapshot_date,data_origin)
          VALUES(?,?,?,?,?,?,?,?)''',(assigned['id'],'own',assigned['name'],'12.1','Hộp',99000,'2026-10-16','user_import'))
    response=user.put('/api/seller/products/12.1/inputs',params={'shop_id':assigned['id']},json={'unit_cost':45000,'platform_fee_pct':15})
    assert response.status_code==200,response.text
    assert response.json()['inputs']['unit_cost']==45000
    assert user.post('/api/seller/ai/generate',json={'shop_id':foreign['id'],'sku':'12.1'}).status_code==403
    assert user.post('/api/seller/ai/generate',params={'shop_id':assigned['id']},json={'shop_id':foreign['id'],'sku':'12.1'}).status_code==403
    assert user.get('/api/dashboard',params=[('shop_id',foreign['id']),('shop_id',assigned['id'])]).status_code==403
    assert user.get('/api/dashboard',params=[('shop_id',assigned['id']),('shop_id',foreign['id'])]).status_code==403


def test_assignment_updates_are_atomic_and_immediately_revoke_old_shop_access(accounts):
    _,system,user,_,user_account,assigned,foreign=accounts
    endpoint='/api/auth/accounts/'+user_account['id']+'/shops'
    assert system.put(endpoint,json={'shop_ids':[foreign['id'],'missing']}).status_code==422
    assert user.get('/api/dashboard',params={'shop_id':assigned['id']}).status_code==200
    assert system.put(endpoint,json={'shop_ids':[foreign['id'],foreign['id']]}).status_code==200
    assert user.get('/api/dashboard',params={'shop_id':assigned['id']}).status_code==403
    assert user.get('/api/dashboard',params={'shop_id':foreign['id']}).status_code==200


def test_system_can_disable_user_and_revoke_sessions_but_cannot_change_existing_password_or_system_role(accounts):
    _,system,user,system_account,user_account,_,_=accounts
    endpoint='/api/auth/accounts/'+user_account['id']
    assert system.patch(endpoint,json={'password':'Replacement-Password-2026!'}).status_code==422
    assert system.post('/api/auth/accounts',json={'username':'elevated-user','password':USER_PASSWORD,'role':'system'}).status_code==422
    assert system.patch('/api/auth/accounts/'+system_account['id'],json={'active':False}).status_code==409
    assert system.patch(endpoint,json={'active':False}).status_code==200
    assert user.get('/api/shops').status_code==401
    public=system.get('/api/auth/accounts').json()
    assert 'password_hash' not in str(public) and 'csrf_token' not in str(public)


def test_failed_login_is_throttled_and_nonexistent_username_uses_dummy_password_check(auth_app,monkeypatch):
    bootstrap(auth_app)
    calls=[];verify=auth.password_matches
    def tracked(password,encoded):
        calls.append(encoded);return verify(password,encoded)
    monkeypatch.setattr(auth,'password_matches',tracked)
    client=anonymous(auth_app)
    for _ in range(8):
        assert client.post('/api/auth/login',json={'username':'missing-user','password':USER_PASSWORD}).status_code==401
    response=client.post('/api/auth/login',json={'username':'missing-user','password':USER_PASSWORD})
    assert response.status_code==429 and response.headers['retry-after']=='60'
    assert len(calls)==8 and all(value==auth._DUMMY_HASH for value in calls)
    stamp=auth.now();monkeypatch.setattr(auth,'now',lambda:stamp+61)
    assert client.post('/api/auth/login',json={'username':'missing-user','password':USER_PASSWORD}).status_code==401


def test_auth_and_protected_pages_are_not_cached(accounts):
    _,system,user,_,_,assigned,_=accounts
    for client,path in ((user,'/api/auth/me'),(user,'/user'),(system,'/system'),
                        (user,'/api/dashboard?shop_id='+assigned['id'])):
        response=client.get(path)
        assert response.headers['cache-control']=='no-store'
        assert 'cookie' in response.headers['vary'].lower()


def test_foreign_action_report_and_ai_job_ids_do_not_leak_through_an_assigned_shop_query(accounts):
    app,system,user,_,_,assigned,foreign=accounts
    with app.db() as c:
        c.execute('''INSERT INTO observations(shop_id,role,source_shop,sku,name,price,snapshot_date,data_origin)
          VALUES(?,?,?,?,?,?,?,?)''',(foreign['id'],'own',foreign['name'],'88.1','Sản phẩm shop khác',99000,'2026-10-16','user_import'))
    foreign_analysis=system.get('/api/seller/analysis',params={'shop_id':foreign['id']}).json()
    strategy=foreign_analysis['strategies_available'][0]
    action=system.post('/api/seller/actions',params={'shop_id':foreign['id']},
                       json={'strategy_key':strategy['key'],'sku':str(strategy.get('sku') or '')})
    assert action.status_code==200,action.text
    report=system.post('/api/seller/reports',params={'shop_id':foreign['id']},json={'period_days':7})
    assert report.status_code==200,report.text
    assert user.patch('/api/seller/actions/'+action.json()['id'],params={'shop_id':assigned['id']},json={'status':'doing'}).status_code==404
    assert user.get('/api/seller/reports/'+report.json()['id']+'/export',params={'shop_id':assigned['id']}).status_code==404
    def stub(path,payload=None,timeout=3):
        if path=='/api/tags':return {'models':[{'name':'qwen3.5:9b'}]}
        raise RuntimeError('Stub inference only')
    app.app.state.seller_ai.transport=stub
    job=system.post('/api/seller/ai/generate',json={'shop_id':foreign['id'],'sku':'88.1'})
    assert job.status_code==200,job.text
    app.app.state.seller_ai.executor.shutdown(wait=True)
    assert user.get('/api/seller/ai/jobs/'+job.json()['job_id'],params={'shop_id':assigned['id']}).status_code==404


def test_render_hostname_origin_is_accepted_only_for_exact_https_host(monkeypatch):
    from auth import same_local_origin
    monkeypatch.setenv('RENDER_EXTERNAL_HOSTNAME', 'shopee-ai.onrender.com')
    def scope(host, origin):
        return {'type': 'http', 'scheme': 'http', 'server': ('10.0.0.1', 10000),
                'headers': [(b'host', host.encode()), (b'origin', origin.encode())]}
    assert same_local_origin(scope('shopee-ai.onrender.com', 'https://shopee-ai.onrender.com'))
    assert not same_local_origin(scope('shopee-ai.onrender.com', 'https://evil.example'))
    assert not same_local_origin(scope('evil.example', 'https://evil.example'))
    assert not same_local_origin(scope('shopee-ai.onrender.com', 'http://shopee-ai.onrender.com'))


def test_user_can_collect_own_shop_products_but_not_foreign_shop_or_system_tools(accounts):
    _,system,user,_,_,assigned,foreign=accounts
    assert user.get('/api/crawl/config').status_code==200
    mine=user.post('/api/crawl/jobs',json={'shop_id':assigned['id'],'role':'own','browser':'chrome'})
    assert mine.status_code==202,mine.text
    job_id=mine.json()['job_id']
    assert user.get(f'/api/crawl/jobs/{job_id}').status_code==200
    assert [row['id'] for row in user.get('/api/crawl/jobs',params={'shop_id':assigned['id']}).json()]==[job_id]
    # Foreign shop: no start, no list, and foreign jobs cannot be read or fed results.
    assert user.post('/api/crawl/jobs',json={'shop_id':foreign['id'],'role':'own','browser':'chrome'}).status_code==403
    assert user.get('/api/crawl/jobs',params={'shop_id':foreign['id']}).status_code==403
    other=system.post('/api/crawl/jobs',json={'shop_id':foreign['id'],'role':'own','browser':'chrome'}).json()['job_id']
    assert user.get(f'/api/crawl/jobs/{other}').status_code==403
    assert user.post(f'/api/crawl/jobs/{other}/browser-result',json={'result_token':'x','pages':[]}).status_code==403
    assert user.get('/api/crawl/jobs/does-not-exist').status_code==403
    # Scheduling and saved-HTML import stay System-only.
    assert user.post('/api/crawl/schedules',json={'shop_id':assigned['id'],'target_url':assigned['url']}).status_code==403


def test_self_registration_creates_a_plain_user_without_shops(accounts):
    app,system,_,_,_,_,_=accounts
    visitor=anonymous(app)
    created=visitor.post('/api/auth/register',json={'username':'new-seller','password':USER_PASSWORD})
    assert created.status_code==200,created.text
    data=created.json()
    assert data['account']['role']=='user' and data['assigned_shop_ids']==[]
    visitor.headers['X-CSRF-Token']=data['csrf_token']
    assert visitor.get('/api/shops').json()==[]
    assert visitor.get('/system',follow_redirects=False).status_code==403
    assert visitor.get('/api/auth/accounts').status_code==403
    # The new user can add and collect a shop of their own.
    shop=visitor.post('/api/shops',json={'url':'https://shopee.vn/self_signup_shop'})
    assert shop.status_code==200 and [row['id'] for row in visitor.get('/api/shops').json()]==[shop.json()['id']]
    assert anonymous(app).post('/api/auth/register',json={'username':'NEW-SELLER','password':USER_PASSWORD}).status_code==409
    assert anonymous(app).post('/api/auth/register',json={'username':'short-pass','password':'short'}).status_code==422


def test_registration_is_blocked_before_the_system_account_exists_and_pages_exist(auth_app):
    visitor=anonymous(auth_app)
    assert visitor.post('/api/auth/register',json={'username':'too-early','password':USER_PASSWORD}).status_code==409
    assert visitor.get('/register',follow_redirects=False).status_code==307
    bootstrap(auth_app)
    page=anonymous(auth_app).get('/register')
    assert page.status_code==200 and 'authForm' in page.text


def test_user_actions_are_audited_and_only_system_can_read_the_log(accounts):
    app,system,user,_,user_account,assigned,_=accounts
    user.post('/api/shops',json={'url':'https://shopee.vn/audited_shop'})
    user.post('/api/crawl/jobs',json={'shop_id':assigned['id'],'role':'own','browser':'chrome'})
    user.post('/api/shops',json={'url':''})  # rejected -> still recorded with its status
    assert user.get('/api/auth/audit').status_code==403
    log=system.get('/api/auth/audit',params={'account_id':user_account['id'],'limit':50}).json()
    actions=[(row['action'],row['status']) for row in log['events']]
    assert ('Đăng nhập',200) in actions and ('Thêm shop',200) in actions and ('Bắt đầu thu thập shop',202) in actions
    assert any(row['action']=='Thêm shop' and row['status']>=400 for row in log['events'])
    crawl=[row for row in log['events'] if row['action']=='Bắt đầu thu thập shop'][0]
    assert crawl['username']=='test-user' and crawl['shop_id']==assigned['id'] and crawl['shop_name']
    assert system.get('/api/auth/audit',params={'q':'thu thập'}).json()['total']>=1
    listed={a['id']:a for a in system.get('/api/auth/accounts').json()['accounts']}[user_account['id']]
    assert listed['actions_30d']>=3 and listed['last_login'] and listed['last_active']
    # Failed logins are recorded without leaking the password.
    anonymous(app).post('/api/auth/login',json={'username':'test-user','password':'Wrong-Password-For-Tests'})
    failed=[row for row in system.get('/api/auth/audit',params={'q':'thất bại'}).json()['events']]
    assert failed and 'Wrong-Password' not in str(failed)


def test_system_can_reset_a_user_password_and_old_sessions_stop_working(accounts):
    app,system,user,_,user_account,_,_=accounts
    new='Brand-New-Password-2026!'
    assert user.put(f"/api/auth/accounts/{user_account['id']}/password",json={'password':new}).status_code==403
    assert system.put(f"/api/auth/accounts/{user_account['id']}/password",json={'password':'short'}).status_code==422
    assert system.put(f"/api/auth/accounts/{user_account['id']}/password",json={'password':new}).status_code==200
    assert user.get('/api/shops').status_code==401
    assert anonymous(app).post('/api/auth/login',json={'username':'test-user','password':USER_PASSWORD}).status_code==401
    assert anonymous(app).post('/api/auth/login',json={'username':'test-user','password':new}).status_code==200


def test_admin_account_is_seeded_from_environment_only_on_first_run(tmp_path,monkeypatch):
    monkeypatch.setenv('MARKET_DB',str(tmp_path/'seed.db'))
    monkeypatch.setenv('ADMIN_USERNAME','seed-admin');monkeypatch.setenv('ADMIN_PASSWORD','Seeded-Admin-Pass-2026!')
    import app
    app=importlib.reload(app)
    assert not app.app.state.auth.setup_required()
    client=anonymous(app)
    assert client.post('/api/auth/login',json={'username':'seed-admin','password':'Seeded-Admin-Pass-2026!'}).json()['account']['role']=='system'
    # A different password in the environment never overwrites an existing account.
    monkeypatch.setenv('ADMIN_PASSWORD','Another-Admin-Pass-2026!')
    app=importlib.reload(app)
    assert anonymous(app).post('/api/auth/login',json={'username':'seed-admin','password':'Another-Admin-Pass-2026!'}).status_code==401
    assert anonymous(app).post('/api/auth/login',json={'username':'seed-admin','password':'Seeded-Admin-Pass-2026!'}).status_code==200
    audit=app.app.state.auth.audit_list()
    assert any('seed' in row['action'] for row in audit['events'])


def test_invalid_seed_credentials_are_ignored(tmp_path,monkeypatch):
    monkeypatch.setenv('MARKET_DB',str(tmp_path/'badseed.db'))
    monkeypatch.setenv('ADMIN_USERNAME','seed-admin');monkeypatch.setenv('ADMIN_PASSWORD','short')
    import app
    app=importlib.reload(app)
    assert app.app.state.auth.setup_required()


def test_admin_is_generated_once_on_render_and_actions_are_logged(tmp_path,monkeypatch,caplog):
    monkeypatch.setenv('MARKET_DB',str(tmp_path/'render.db'))
    monkeypatch.delenv('ADMIN_USERNAME',raising=False);monkeypatch.delenv('ADMIN_PASSWORD',raising=False)
    monkeypatch.setenv('RENDER','true')
    import app
    with caplog.at_level('WARNING'):
        app=importlib.reload(app)
    message=next(r.getMessage() for r in caplog.records if 'ĐÃ TẠO TÀI KHOẢN ADMIN' in r.getMessage())
    password=message.split('mật khẩu "')[1].split('"')[0]
    assert not app.app.state.auth.setup_required()
    admin=login(app,'admin',password)
    assert admin.post('/api/shops',json={'url':'https://shopee.vn/admin_made'}).status_code==200
    new='Changed-Admin-Pass-2026!'
    assert admin.put('/api/auth/me/password',json={'current_password':'wrong-password-123','new_password':new}).status_code==403
    assert admin.put('/api/auth/me/password',json={'current_password':password,'new_password':new}).status_code==200
    assert anonymous(app).post('/api/auth/login',json={'username':'admin','password':new}).status_code==200
    actions={row['action'] for row in admin.get('/api/auth/audit').json()['events'] if row['username']=='admin'}
    assert {'Thêm shop','Đổi mật khẩu của chính mình','Đăng nhập'} <= actions
    # Restart: the stored account is kept and no new password is generated.
    caplog.clear()
    app=importlib.reload(app)
    assert not any('ĐÃ TẠO TÀI KHOẢN ADMIN' in r.getMessage() for r in caplog.records)
    assert anonymous(app).post('/api/auth/login',json={'username':'admin','password':new}).status_code==200
