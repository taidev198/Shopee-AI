"""Local accounts, revocable sessions, CSRF and server-side workspace access."""
import hashlib
import hmac
import os
import json
import math
import re
import secrets
import threading
import time
import uuid
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse


COOKIE_NAME = 'marketlens_session'
PASSWORD_ROUNDS = 600000
SESSION_SECONDS = 12 * 60 * 60
SAFE_METHODS = frozenset(('GET', 'HEAD', 'OPTIONS'))
_DUMMY_HASH = 'pbkdf2_sha256$600000$' + '00' * 16 + '$' + '00' * 32
_SYSTEM_ACCESS_DENIED_HTML = '''<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Không có quyền truy cập System · MarketLens</title><link rel="stylesheet" href="/static/auth.css"></head>
<body class="auth-page"><main class="auth-layout"><section class="auth-intro">
<a class="auth-brand" href="/">Market<span>Lens</span></a><span class="auth-eyebrow">PHÂN QUYỀN KHÔNG GIAN LÀM VIỆC</span>
<h1>Khu vực này dành cho System.</h1><p>Tài khoản User có thể phân tích các shop được cấp quyền trong không gian User.</p>
<a class="auth-back" href="/">← Về trang chủ Guest</a></section><section class="auth-card" aria-labelledby="access-title">
<h2 id="access-title">Bạn chưa có quyền truy cập</h2><p>System quản lý thu thập dữ liệu, nguồn nhập và tài khoản. Hãy liên hệ người quản trị khi cần cập nhật dữ liệu hoặc quyền shop.</p>
<a class="auth-submit" href="/user">Mở không gian User →</a><p class="auth-help">Mã phản hồi: 403 · Không có quyền truy cập System.</p>
</section></main></body></html>'''


def now():
    return time.time()


def password_hash(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PASSWORD_ROUNDS)
    return f'pbkdf2_sha256${PASSWORD_ROUNDS}${salt.hex()}${digest.hex()}'


def password_matches(password, encoded):
    try:
        algorithm, rounds, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or int(rounds) != PASSWORD_ROUNDS:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError, OverflowError):
        return False


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Credentials(StrictModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=12, max_length=256)

    @field_validator('username')
    @classmethod
    def valid_username(cls, value):
        value = value.strip()
        if len(value) < 3 or not value.isprintable() or any(char.isspace() for char in value):
            raise ValueError('Tên đăng nhập cần 3–80 ký tự và không có khoảng trắng.')
        return value


class NewUser(Credentials):
    shop_ids: list[str] = Field(default_factory=list, max_length=1000)


class NewPassword(StrictModel):
    password: str = Field(min_length=12, max_length=256)


class PasswordChange(StrictModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class ShopAssignments(StrictModel):
    shop_ids: list[str] = Field(max_length=1000)


class AccountState(StrictModel):
    active: bool


class AuthService:
    def __init__(self, db):
        self.db = db
        self.failures = {}
        self.signups = {}
        self.failure_lock = threading.Lock()
        with db() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS auth_accounts(
              id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('system','user')),
              active INTEGER NOT NULL DEFAULT 1,created_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS auth_sessions(
              token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES auth_accounts(id),
              csrf_token TEXT NOT NULL,created_at REAL NOT NULL,expires_at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS auth_session_account ON auth_sessions(account_id);
            CREATE TABLE IF NOT EXISTS auth_account_shops(
              account_id TEXT NOT NULL REFERENCES auth_accounts(id),shop_id TEXT NOT NULL REFERENCES shops(id),
              PRIMARY KEY(account_id,shop_id));
            CREATE TABLE IF NOT EXISTS auth_audit(
              id INTEGER PRIMARY KEY AUTOINCREMENT,ts REAL NOT NULL,account_id TEXT NOT NULL DEFAULT '',
              username TEXT NOT NULL DEFAULT '',role TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,
              method TEXT NOT NULL DEFAULT '',path TEXT NOT NULL DEFAULT '',shop_id TEXT NOT NULL DEFAULT '',
              status INTEGER NOT NULL DEFAULT 0,ip TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '');
            CREATE INDEX IF NOT EXISTS auth_audit_ts ON auth_audit(ts);
            CREATE INDEX IF NOT EXISTS auth_audit_account ON auth_audit(account_id,ts);
            ''')
        self.audit_count = 0

    AUDIT_RETENTION_DAYS = 90

    def audit(self, action, account=None, *, username='', method='', path='', shop_id='', status=0, ip='', detail=''):
        """Append one activity row. Never raises: auditing must not break the request."""
        try:
            stamp = now()
            account = account or {}
            with self.db() as c:
                c.execute('INSERT INTO auth_audit(ts,account_id,username,role,action,method,path,shop_id,status,ip,detail) '
                          'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                          (stamp, account.get('id', ''), account.get('username', username or ''), account.get('role', ''),
                           action[:160], method, path[:300], shop_id[:80], int(status), ip[:64], detail[:500]))
                self.audit_count += 1
                if self.audit_count % 200 == 0:
                    c.execute('DELETE FROM auth_audit WHERE ts<?', (stamp - self.AUDIT_RETENTION_DAYS * 86400,))
        except Exception:  # noqa: BLE001
            pass

    def audit_list(self, limit=50, offset=0, account_id='', query=''):
        limit, offset = max(1, min(int(limit), 200)), max(0, int(offset))
        where, params = [], []
        if account_id:
            where.append('a.account_id=?'); params.append(account_id)
        if query:
            where.append('(a.action LIKE ? OR a.username LIKE ? OR a.path LIKE ?)'); params += [f'%{query}%'] * 3
        clause = ('WHERE ' + ' AND '.join(where)) if where else ''
        with self.db() as c:
            total = c.execute(f'SELECT COUNT(*) FROM auth_audit a {clause}', params).fetchone()[0]
            rows = c.execute(f'''SELECT a.id,a.ts,a.account_id,a.username,a.role,a.action,a.method,a.path,a.shop_id,
                a.status,a.ip,a.detail,s.name AS shop_name FROM auth_audit a LEFT JOIN shops s ON s.id=a.shop_id
                {clause} ORDER BY a.ts DESC,a.id DESC LIMIT ? OFFSET ?''', params + [limit, offset]).fetchall()
        return {'total': total, 'events': [dict(row) for row in rows]}

    def activity_stats(self):
        with self.db() as c:
            last = {row['account_id']: row['ts'] for row in c.execute(
                "SELECT account_id,MAX(ts) AS ts FROM auth_audit WHERE account_id<>'' GROUP BY account_id")}
            login = {row['account_id']: row['ts'] for row in c.execute(
                "SELECT account_id,MAX(ts) AS ts FROM auth_audit WHERE action='Đăng nhập' AND account_id<>'' GROUP BY account_id")}
            counts = {row['account_id']: row['n'] for row in c.execute(
                "SELECT account_id,COUNT(*) AS n FROM auth_audit WHERE account_id<>'' AND ts>? GROUP BY account_id",
                (now() - 30 * 86400,))}
        return last, login, counts

    def seed_admin(self):
        """First deploy: store a System account in the database (hashed) when none exists.

        Credentials come from ADMIN_USERNAME/ADMIN_PASSWORD. On Render (RENDER set) or with
        MARKETLENS_SEED_ADMIN=1, a missing password is generated once and printed in the server log.
        The environment is only read while the table is empty: afterwards the DB is the single source.
        """
        import logging
        log = logging.getLogger('marketlens.auth')
        if not self.setup_required():
            with self.db() as c:
                n = c.execute('SELECT COUNT(*) FROM auth_accounts').fetchone()[0]
            log.warning('Seed admin: DB đã có %d tài khoản nên không tạo admin mới (chỉ seed khi bảng auth_accounts trống).', n)
            return False
        username = os.environ.get('ADMIN_USERNAME', '').strip()
        password = os.environ.get('ADMIN_PASSWORD', '')
        generated = False
        if not password:
            if not (os.environ.get('RENDER') or os.environ.get('MARKETLENS_SEED_ADMIN') == '1'):
                log.warning('Seed admin: chưa có tài khoản nào; mở /setup để tạo System hoặc đặt ADMIN_USERNAME/ADMIN_PASSWORD.')
                return False
            password, generated = secrets.token_urlsafe(15), True
        try:
            payload = Credentials(username=username or 'admin', password=password)
        except ValueError:
            log.warning('ADMIN_USERNAME/ADMIN_PASSWORD không hợp lệ (tên 3–80 ký tự không khoảng trắng, mật khẩu 12–256 ký tự); bỏ qua seed.')
            return False
        try:
            self.setup(payload)
        except HTTPException:
            return False  # an account already exists: never overwrite
        self.audit('Khởi tạo tài khoản System (seed)', username=payload.username,
                   detail='mật khẩu tự sinh' if generated else 'từ ADMIN_PASSWORD')
        if generated:
            log.warning('ĐÃ TẠO TÀI KHOẢN ADMIN: tên đăng nhập "%s", mật khẩu "%s" (chỉ hiển thị một lần, hãy đổi ngay sau khi đăng nhập).',
                        payload.username, password)
        else:
            log.warning('Đã tạo tài khoản System "%s" từ biến môi trường.', payload.username)
        return True

    def change_password(self, account, current, new):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT * FROM auth_accounts WHERE id=?', (account['id'],)).fetchone()
            if not row or not password_matches(current, row['password_hash']):
                raise HTTPException(403, 'Mật khẩu hiện tại không đúng.')
            c.execute('UPDATE auth_accounts SET password_hash=? WHERE id=?', (password_hash(new), account['id']))
        return {'ok': True}

    def reset_password(self, account_id, password):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            self.user_account(c, account_id)
            c.execute('UPDATE auth_accounts SET password_hash=? WHERE id=?', (password_hash(password), account_id))
            c.execute('DELETE FROM auth_sessions WHERE account_id=?', (account_id,))
        return {'ok': True}

    def setup_required(self):
        with self.db() as c:
            return c.execute('SELECT 1 FROM auth_accounts LIMIT 1').fetchone() is None

    @staticmethod
    def public_account(row):
        return {key: (bool(row[key]) if key == 'active' else row[key]) for key in
                ('id', 'username', 'role', 'active', 'created_at')}

    def assigned_shop_ids(self, account_id):
        with self.db() as c:
            return [row[0] for row in c.execute('SELECT shop_id FROM auth_account_shops WHERE account_id=? ORDER BY shop_id', (account_id,))]

    def can_access_shop(self, account, shop_id):
        return account['role'] == 'system' or shop_id in self.assigned_shop_ids(account['id'])

    def authenticate(self, scope):
        cookie = SimpleCookie()
        try:
            cookie.load(Headers(scope=scope).get('cookie', ''))
            token = cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else ''
        except Exception:
            return None
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.db() as c:
            row = c.execute('''SELECT a.id,a.username,a.role,a.active,a.created_at,s.csrf_token,s.expires_at,s.token_hash
              FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id
              WHERE s.token_hash=? AND s.expires_at>? AND a.active=1''', (digest, now())).fetchone()
        return dict(row) if row else None

    def session(self, account):
        token, csrf, stamp = secrets.token_urlsafe(32), secrets.token_urlsafe(32), now()
        with self.db() as c:
            c.execute('DELETE FROM auth_sessions WHERE expires_at<=?', (stamp,))
            c.execute('INSERT INTO auth_sessions VALUES(?,?,?,?,?)',
                      (hashlib.sha256(token.encode()).hexdigest(), account['id'], csrf, stamp, stamp + SESSION_SECONDS))
        return token, {'authenticated': True, 'account': self.public_account(account), 'csrf_token': csrf,
                       'assigned_shop_ids': self.assigned_shop_ids(account['id']), 'setup_required': False}

    def setup(self, payload):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM auth_accounts LIMIT 1').fetchone():
                raise HTTPException(409, 'Tài khoản System đầu tiên đã được thiết lập. Hãy đăng nhập.')
            account_id = uuid.uuid4().hex
            c.execute('INSERT INTO auth_accounts VALUES(?,?,?,?,?,1,?)',
                      (account_id, payload.username, payload.username.casefold(), password_hash(payload.password), 'system', now()))
            account = dict(c.execute('SELECT * FROM auth_accounts WHERE id=?', (account_id,)).fetchone())
        self.audit('Khởi tạo tài khoản System', account, status=200)
        return self.session(account)

    def register(self, payload, request):
        """Self-service sign-up: always a plain User with no shops assigned."""
        ip = request.client.host if request.client else ''
        stamp = now()
        with self.failure_lock:
            recent = [value for value in self.signups.get(ip, []) if stamp-value < 3600]
            if len(recent) >= 10:
                raise HTTPException(429, 'Đăng ký quá nhiều lần từ địa chỉ này. Hãy thử lại sau.', headers={'Retry-After': '3600'})
            if len(self.signups) >= 512 and ip not in self.signups:
                self.signups.pop(next(iter(self.signups)))
            self.signups[ip] = recent + [stamp]
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM auth_accounts LIMIT 1').fetchone() is None:
                raise HTTPException(409, 'Hệ thống chưa có tài khoản System. Hãy khởi tạo trước.')
            if c.execute('SELECT 1 FROM auth_accounts WHERE username_key=?', (payload.username.casefold(),)).fetchone():
                raise HTTPException(409, 'Tên đăng nhập đã tồn tại.')
            account_id = uuid.uuid4().hex
            c.execute('INSERT INTO auth_accounts VALUES(?,?,?,?,?,1,?)',
                      (account_id, payload.username, payload.username.casefold(), password_hash(payload.password), 'user', now()))
            account = dict(c.execute('SELECT * FROM auth_accounts WHERE id=?', (account_id,)).fetchone())
        self.audit('Đăng ký tài khoản', account, ip=ip, status=200)
        return self.session(account)

    def login(self, payload, request):
        key = (request.client.host if request.client else '', payload.username.casefold())
        stamp = now()
        with self.failure_lock:
            attempts = [value for value in self.failures.get(key, []) if stamp-value < 60]
            if len(attempts) >= 8:
                raise HTTPException(429, 'Đăng nhập sai quá nhiều lần. Hãy thử lại sau một phút.', headers={'Retry-After': '60'})
            if len(self.failures) >= 512 and key not in self.failures:
                self.failures.pop(next(iter(self.failures)))
            self.failures[key] = attempts + [stamp]
        with self.db() as c:
            row = c.execute('SELECT * FROM auth_accounts WHERE username_key=?', (payload.username.casefold(),)).fetchone()
        matched = password_matches(payload.password, row['password_hash'] if row else _DUMMY_HASH)
        if not row or not row['active'] or not matched:
            self.audit('Đăng nhập thất bại', username=payload.username, ip=key[0], status=401)
            raise HTTPException(401, 'Tên đăng nhập hoặc mật khẩu không đúng.')
        with self.failure_lock:
            self.failures.pop(key, None)
        self.audit('Đăng nhập', dict(row), ip=key[0], status=200)
        return self.session(dict(row))

    def accounts(self):
        with self.db() as c:
            rows = [self.public_account(row) for row in c.execute('SELECT * FROM auth_accounts ORDER BY created_at,id')]
        last, login, counts = self.activity_stats()
        return [{**row, 'shop_ids': self.assigned_shop_ids(row['id']), 'last_active': last.get(row['id']),
                 'last_login': login.get(row['id']), 'actions_30d': counts.get(row['id'], 0)} for row in rows]

    @staticmethod
    def validate_shops(c, values):
        ids = sorted(set(values))
        if any(not c.execute('SELECT 1 FROM shops WHERE id=?', (shop_id,)).fetchone() for shop_id in ids):
            raise HTTPException(422, 'Có shop không tồn tại; chưa thay đổi phân quyền.')
        return ids

    def create_user(self, payload):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM auth_accounts WHERE username_key=?', (payload.username.casefold(),)).fetchone():
                raise HTTPException(409, 'Tên đăng nhập đã tồn tại.')
            shops = self.validate_shops(c, payload.shop_ids)
            account_id = uuid.uuid4().hex
            c.execute('INSERT INTO auth_accounts VALUES(?,?,?,?,?,1,?)',
                      (account_id, payload.username, payload.username.casefold(), password_hash(payload.password), 'user', now()))
            c.executemany('INSERT INTO auth_account_shops VALUES(?,?)', [(account_id, shop_id) for shop_id in shops])
            row = c.execute('SELECT * FROM auth_accounts WHERE id=?', (account_id,)).fetchone()
            return {**self.public_account(row), 'shop_ids': shops}

    def user_account(self, c, account_id):
        row = c.execute('SELECT * FROM auth_accounts WHERE id=?', (account_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Không tìm thấy tài khoản.')
        if row['role'] != 'user':
            raise HTTPException(409, 'Thao tác này chỉ áp dụng cho tài khoản User.')
        return row

    def assign_shops(self, account_id, payload):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self.user_account(c, account_id)
            shops = self.validate_shops(c, payload.shop_ids)
            c.execute('DELETE FROM auth_account_shops WHERE account_id=?', (account_id,))
            c.executemany('INSERT INTO auth_account_shops VALUES(?,?)', [(account_id, shop_id) for shop_id in shops])
            return {**self.public_account(row), 'shop_ids': shops}

    def set_active(self, account_id, active):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            self.user_account(c, account_id)
            c.execute('UPDATE auth_accounts SET active=? WHERE id=?', (int(active), account_id))
            if not active:
                c.execute('DELETE FROM auth_sessions WHERE account_id=?', (account_id,))
            row = c.execute('SELECT * FROM auth_accounts WHERE id=?', (account_id,)).fetchone()
        return {**self.public_account(row), 'shop_ids': self.assigned_shop_ids(account_id)}


def same_local_origin(scope):
    headers = Headers(scope=scope)
    try:
        host = urlsplit(scope.get('scheme', 'http') + '://' + headers.get('host', ''))
        origin = urlsplit(headers.get('origin', ''))
        loopback = {'localhost', '127.0.0.1', '::1'}
        server = scope.get('server') or ('', 0)
        if server[0] == 'testserver':
            loopback.add('testserver')
        hosted = os.environ.get('RENDER_EXTERNAL_HOSTNAME', '').strip().lower()
        if hosted and host.hostname == hosted and origin.scheme == 'https' and origin.hostname == hosted \
                and origin.port in (None, 443) and host.port in (None, 443) \
                and not (origin.username or origin.password or origin.path or origin.query or origin.fragment):
            return True
        host_port = host.port or (443 if host.scheme == 'https' else 80)
        origin_port = origin.port or (443 if origin.scheme == 'https' else 80)
        return bool(host.hostname in loopback and origin.hostname == host.hostname and host_port == server[1] and
                    host_port == origin_port and origin.scheme == host.scheme and not origin.username and
                    not origin.password and not origin.path and not origin.query and not origin.fragment)
    except (TypeError, ValueError):
        return False


def user_permission(path, method):
    if path == '/api/auth/logout':
        return 'global' if method == 'POST' else None
    if path == '/api/auth/me/password':
        return 'global' if method == 'PUT' else None
    if path == '/api/shops':
        return 'global' if method in ('GET', 'POST') else None
    if path == '/api/seller/ai/config':
        return 'global' if method == 'GET' else None
    if path in ('/api/category-market/analysis', '/api/category-market/products', '/api/category-market/export', '/api/category-market/ml/export'):
        return 'global' if method == 'GET' else None
    if path == '/api/crawl/config':
        return 'global' if method == 'GET' else None
    if path == '/api/crawl/jobs':
        return 'shop' if method in ('GET', 'POST') else None
    if re.fullmatch(r'/api/crawl/jobs/[^/]+', path):
        return 'job' if method == 'GET' else None
    if re.fullmatch(r'/api/crawl/jobs/[^/]+/(?:browser-result|product-result|finish-details)', path):
        return 'job' if method == 'POST' else None
    if path in ('/api/dashboard', '/api/export/opportunities', '/api/seller/analysis', '/api/seller/ai/shop'):
        return 'shop' if method == 'GET' else None
    if path in ('/api/seller/optimize', '/api/seller/actions', '/api/seller/reports', '/api/seller/ai/generate', '/api/seller/ai/shop-generate'):
        return 'shop' if method == 'POST' else None
    if re.fullmatch(r'/api/seller/products/[^/]+/(?:inputs|market-evidence)', path):
        return 'shop' if method == ('PUT' if path.endswith('/inputs') else 'GET') else None
    if re.fullmatch(r'/api/seller/actions/[^/]+', path):
        return 'shop' if method == 'PATCH' else None
    if re.fullmatch(r'/api/seller/(?:reports/[^/]+/export|ai/jobs/[^/]+)', path):
        return 'shop' if method == 'GET' else None
    return None

AUDIT_LABELS = (
    ('POST', r'/api/auth/logout', 'Đăng xuất'),
    ('PUT', r'/api/auth/me/password', 'Đổi mật khẩu của chính mình'),
    ('POST', r'/api/auth/accounts', 'Tạo tài khoản User'),
    ('PUT', r'/api/auth/accounts/[^/]+/shops', 'Gán quyền shop cho User'),
    ('PUT', r'/api/auth/accounts/[^/]+/password', 'Đặt lại mật khẩu User'),
    ('PATCH', r'/api/auth/accounts/[^/]+', 'Khóa/mở User'),
    ('DELETE', r'/api/auth/accounts/[^/]+', 'Khóa User'),
    ('POST', r'/api/shops', 'Thêm shop'),
    ('POST', r'/api/crawl/jobs', 'Bắt đầu thu thập shop'),
    ('POST', r'/api/crawl/jobs/[^/]+/finish-details', 'Hoàn tất đọc chi tiết sản phẩm'),
    ('POST', r'/api/crawl/schedules', 'Đặt lịch thu thập'),
    ('DELETE', r'/api/crawl/schedules/[^/]+', 'Xóa lịch thu thập'),
    ('POST', r'/api/crawl/import-html', 'Nhập sản phẩm từ HTML'),
    ('POST', r'/api/import', 'Nhập dữ liệu từ tệp'),
    ('POST', r'/api/seller/ai/shop-generate', 'Chạy phân tích AI toàn shop'),
    ('POST', r'/api/seller/ai/generate', 'Chạy phân tích AI sản phẩm'),
    ('PUT', r'/api/seller/ai/config', 'Đổi cấu hình AI'),
    ('POST', r'/api/seller/optimize', 'Tối ưu sản phẩm'),
    ('POST', r'/api/seller/actions', 'Tạo hành động'),
    ('PATCH', r'/api/seller/actions/[^/]+', 'Cập nhật hành động'),
    ('POST', r'/api/seller/reports', 'Tạo báo cáo'),
    ('PUT', r'/api/seller/products/[^/]+/inputs', 'Cập nhật chi phí sản phẩm'),
    ('POST', r'/api/competitors/product-jobs', 'So sánh đối thủ'),
    ('POST', r'/api/category-market/.*', 'Thao tác thu thập ngành hàng'),
)
AUDIT_SKIP = re.compile(r'/api/crawl/jobs/[^/]+/(?:browser-result|product-result)$|/api/competitors/product-jobs/[^/]+/result$')


def audit_label(method, path):
    for verb, pattern, label in AUDIT_LABELS:
        if verb == method and re.fullmatch(pattern, path):
            return label
    return f'{method} {path}'


class AuthMiddleware:
    def __init__(self, app, service):
        self.app, self.service = app, service

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or not path.startswith('/api/') or scope.get('method', 'GET') in SAFE_METHODS:
            return await self._dispatch(scope, receive, send)
        outcome = {'status': 0}

        async def capture(message):
            if message['type'] == 'http.response.start':
                outcome['status'] = message['status']
            await send(message)
        try:
            await self._dispatch(scope, receive, capture)
        finally:
            state = scope.get('state', {})
            account = state.get('auth')
            if account and outcome['status'] and not AUDIT_SKIP.search(path):
                query = dict(parse_qsl(scope.get('query_string', b'').decode('utf-8', 'replace')))
                client = scope.get('client') or ('', 0)
                await run_in_threadpool(
                    self.service.audit, audit_label(scope['method'], path), account, method=scope['method'], path=path,
                    shop_id=state.get('audit_shop') or query.get('shop_id', ''), status=outcome['status'], ip=client[0] or '')

    async def _dispatch(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path, method = scope.get('path', ''), scope.get('method', 'GET')
        if (path.startswith('/api/') and path != '/api/health') or path in (
                '/user','/system','/workspace','/login','/setup','/register','/static/index.html','/static/system.html'):
            original_send = send
            async def no_store(message):
                if message['type'] == 'http.response.start':
                    headers = list(message.get('headers', []))
                    vary = ', '.join(value.decode('latin-1') for key,value in headers if key.lower() == b'vary')
                    if 'cookie' not in [value.strip().lower() for value in vary.split(',')]:
                        vary = (vary + ', ' if vary else '') + 'Cookie'
                    message = {**message,'headers':[(key,value) for key,value in headers if key.lower() not in
                        (b'cache-control',b'pragma',b'vary')] + [(b'cache-control',b'no-store'),(b'pragma',b'no-cache'),(b'vary',vary.encode('latin-1'))]}
                await original_send(message)
            send = no_store
        session = self.service.authenticate(scope)
        scope.setdefault('state', {})['auth'] = self.service.public_account(session) if session else None
        scope['state']['auth_session'] = session
        public = (path == '/api/health' and method == 'GET') or path in ('/api/auth/setup', '/api/auth/login', '/api/auth/register', '/api/auth/me')
        page_area = 'system' if path in ('/system', '/static/system.html') else 'user' if path in ('/user','/workspace','/static/index.html') else None
        if page_area:
            if not session:
                target = '/setup' if self.service.setup_required() else '/login'
                destination = scope.get('raw_path', path.encode()).decode('ascii', 'ignore')
                if scope.get('query_string'):
                    destination += '?' + scope['query_string'].decode('ascii', 'ignore')
                return await RedirectResponse(target+'?'+urlencode({'next': destination}),status_code=307)(scope,receive,send)
            if page_area == 'system' and session['role'] != 'system':
                return await HTMLResponse(_SYSTEM_ACCESS_DENIED_HTML,status_code=403)(scope,receive,send)
        if not path.startswith('/api/'):
            return await self.app(scope, receive, send)
        if not public and not session:
            return await JSONResponse({'detail':'Hãy đăng nhập để truy cập dữ liệu.'},status_code=401)(scope,receive,send)
        if method not in SAFE_METHODS:
            if not same_local_origin(scope):
                return await JSONResponse({'detail':'Nguồn yêu cầu không hợp lệ.'},status_code=403)(scope,receive,send)
            if path not in ('/api/auth/setup','/api/auth/login','/api/auth/register') and (not session or not hmac.compare_digest(Headers(scope=scope).get('x-csrf-token',''), session['csrf_token'])):
                return await JSONResponse({'detail':'Phiên yêu cầu thiếu hoặc sai mã CSRF. Tải lại trang rồi thử lại.'},status_code=403)(scope,receive,send)
        if public or session['role'] == 'system':
            return await self.app(scope, receive, send)
        permission = user_permission(path, method)
        if permission is None:
            return await JSONResponse({'detail':'Tài khoản User không có quyền thực hiện thao tác System này.'},status_code=403)(scope,receive,send)
        if permission == 'job':
            job_id = path.split('/')[4]
            with self.service.db() as c:
                job = c.execute('SELECT shop_id FROM crawl_jobs WHERE id=?', (job_id,)).fetchone()
            if job is None or job['shop_id'] not in set(self.service.assigned_shop_ids(session['id'])):
                return await JSONResponse({'detail':'Lượt thu thập không thuộc phạm vi được phân quyền.'},status_code=403)(scope,receive,send)
        if permission == 'shop':
            shops = [value for key,value in parse_qsl(scope.get('query_string',b'').decode('utf-8','replace'),keep_blank_values=True) if key == 'shop_id']
            messages = []
            if method not in SAFE_METHODS:
                body = bytearray()
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    messages.append(message);body.extend(message.get('body',b''))
                    if len(body) > 2 * 1024 * 1024:
                        return await JSONResponse({'detail':'Yêu cầu quá lớn.'},status_code=413)(scope,receive,send)
                    if not message.get('more_body'):
                        break
                try:
                    payload = json.loads(body) if body else {}
                except (ValueError, UnicodeDecodeError):
                    return await JSONResponse({'detail':'Nội dung JSON không hợp lệ.'},status_code=422)(scope,receive,send)
                if isinstance(payload,dict) and 'shop_id' in payload:
                    shops.append(payload['shop_id'])
            if shops and isinstance(shops[0], str):
                scope['state']['audit_shop'] = shops[0]
            assigned = set(self.service.assigned_shop_ids(session['id']))
            if not shops or any(not isinstance(value,str) or value not in assigned for value in shops):
                return await JSONResponse({'detail':'Shop không thuộc phạm vi được phân quyền.'},status_code=403)(scope,receive,send)
            if messages:
                original_receive, pending = receive, iter(messages)
                async def replay():
                    try:
                        return next(pending)
                    except StopIteration:
                        return await original_receive()
                receive = replay
        return await self.app(scope, receive, send)


def install(app, db):
    service = AuthService(db)
    router = APIRouter(prefix='/api/auth')

    def signed_response(request, result):
        token, data = result
        response = JSONResponse(data)
        response.set_cookie(COOKIE_NAME,token,max_age=SESSION_SECONDS,httponly=True,samesite='strict',
                            secure=request.url.scheme=='https',path='/')
        return response

    @router.get('/me')
    def me(request: Request):
        session = request.state.auth_session
        if session is None:
            return {'authenticated':False,'setup_required':service.setup_required()}
        return {'authenticated':True,'account':service.public_account(session),'csrf_token':session['csrf_token'],
                'assigned_shop_ids':service.assigned_shop_ids(session['id']),'setup_required':False}

    @router.post('/setup')
    def setup(payload: Credentials, request: Request):
        return signed_response(request,service.setup(payload))

    @router.post('/register')
    def register(payload: Credentials, request: Request):
        return signed_response(request,service.register(payload,request))

    @router.post('/login')
    def login(payload: Credentials, request: Request):
        return signed_response(request,service.login(payload,request))

    @router.post('/logout')
    def logout(request: Request):
        with db() as c:
            c.execute('DELETE FROM auth_sessions WHERE token_hash=?',(request.state.auth_session['token_hash'],))
        response=JSONResponse({'authenticated':False})
        response.delete_cookie(COOKIE_NAME,path='/',httponly=True,samesite='strict',secure=request.url.scheme=='https')
        return response

    @router.get('/accounts')
    def accounts():
        return {'accounts':service.accounts()}

    @router.post('/accounts')
    def create(payload: NewUser):
        return service.create_user(payload)

    @router.put('/me/password')
    def my_password(payload: PasswordChange, request: Request):
        return service.change_password(request.state.auth, payload.current_password, payload.new_password)

    @router.get('/audit')
    def audit(limit: int = 50, offset: int = 0, account_id: str = '', q: str = ''):
        return service.audit_list(limit, offset, account_id, q.strip()[:80])

    @router.put('/accounts/{account_id}/password')
    def password(account_id: str, payload: NewPassword):
        return service.reset_password(account_id, payload.password)

    @router.put('/accounts/{account_id}/shops')
    def shops(account_id: str,payload: ShopAssignments):
        return service.assign_shops(account_id,payload)

    @router.patch('/accounts/{account_id}')
    def state(account_id: str,payload: AccountState):
        return service.set_active(account_id,payload.active)

    @router.delete('/accounts/{account_id}')
    def deactivate(account_id: str):
        return service.set_active(account_id,False)

    app.state.auth=service
    service.seed_admin()
    app.include_router(router)
    app.add_middleware(AuthMiddleware,service=service)
    return service
