"""Local page areas and compatibility redirects; API access is unchanged."""
from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, RedirectResponse


USER_VIEWS = frozenset(('overview', 'myShops', 'shopAnalysis', 'products', 'optimizer',
                        'competitors', 'marketAnalysis', 'opportunities', 'strategy', 'actions', 'reports'))
SHARED_VIEWS = frozenset(('crawler',))  # shop collection: both User and System workspaces
SYSTEM_VIEWS = frozenset(('categoryMarket', 'marketSchedules', 'imports', 'users'))


def area_for_view(view, default='user'):
    if view in SHARED_VIEWS:
        return default
    if view in SYSTEM_VIEWS:
        return 'system'
    if view in USER_VIEWS:
        return 'user'
    return default


def install(app, root):
    router = APIRouter(include_in_schema=False)
    static = Path(root) / 'static'

    def selected_view(request):
        # URLSearchParams.get() in the page client uses the first occurrence.
        return next((value for key, value in request.query_params.multi_items() if key == 'view'), '')

    def redirect(request, path):
        query = urlencode(request.query_params.multi_items())
        return RedirectResponse(path + ('?' + query if query else ''), status_code=307)

    @router.get('/')
    def home():
        return FileResponse(static / 'guest.html')

    @router.get('/guest')
    def guest(request: Request):
        return redirect(request, '/')

    @router.get('/login')
    def login(request: Request):
        account = getattr(request.state, 'auth', None)
        if account:
            return redirect(request, '/system' if account['role'] == 'system' else '/user')
        return FileResponse(static / 'auth.html')

    @router.get('/register')
    def register(request: Request):
        if request.app.state.auth.setup_required():
            return redirect(request, '/setup')
        account = getattr(request.state, 'auth', None)
        if account:
            return redirect(request, '/system' if account['role'] == 'system' else '/user')
        return FileResponse(static / 'auth.html')

    @router.get('/setup')
    def setup(request: Request):
        if not request.app.state.auth.setup_required():
            account = getattr(request.state, 'auth', None)
            return redirect(request, ('/system' if account['role'] == 'system' else '/user') if account else '/login')
        return FileResponse(static / 'auth.html')

    @router.get('/workspace')
    def workspace(request: Request):
        view = selected_view(request)
        return redirect(request, '/' + ('system' if view in SHARED_VIEWS else area_for_view(view)))

    @router.get('/user')
    def user(request: Request):
        if area_for_view(selected_view(request), 'user') == 'system':
            return redirect(request, '/system')
        return FileResponse(static / 'index.html')

    @router.get('/system')
    def system(request: Request):
        if area_for_view(selected_view(request), 'system') == 'user':
            return redirect(request, '/user')
        return FileResponse(static / 'system.html')

    app.include_router(router)
