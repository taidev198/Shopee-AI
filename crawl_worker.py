"""Public-DOM Shopee collector using Playwright and robots.txt checks."""
from __future__ import annotations

import re
import time
import logging
from pathlib import Path
from html import unescape
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup

logger = logging.getLogger('uvicorn.error')
USER_AGENT = 'MarketLensResearchBot/0.2 (public-page observer)'
PRODUCT_PATTERNS = [re.compile(r'-i\.(\d+)\.(\d+)(?:\b|/|\?)'),
                    re.compile(r'/product/(\d+)/(\d+)(?:\b|/|\?)')]
PRICE_PATTERN = re.compile(r'(?:₫|\bVND\b|\bđ\b)\s*([0-9][0-9.,]*(?:\s*[kKmM])?)|([0-9][0-9.,]*(?:\s*[kKmM])?)\s*(?:₫|\bVND\b|\bđ\b)', re.I)
SOLD_PATTERN = [re.compile(r'(?:đã\s*bán|đã\s*bán\s*:)\s*([\d.,]+\s*[kKmM]?)', re.I),
                re.compile(r'([\d.,]+\s*[kKmM]?)\s*đã\s*bán', re.I),
                re.compile(r'(?<![\w.,])([\d.,]+\s*[kKmM]?)\s*\+?\s+sold\b(?!\s*/\s*month\b)', re.I),
                re.compile(r'\bsold\s*([\d.,]+\s*[kKmM]?)(?![\d.,kKmM]|\s*\+?\s*/\s*month\b)', re.I)]

class CrawlError(RuntimeError):
    pass

class CrawlBlocked(CrawlError):
    pass


def validate_shop_url(url: str) -> str:
    """Allow only canonical public Shopee Vietnam shop home pages; no SSRF."""
    p = urlparse(url.strip())
    if p.scheme != 'https' or p.hostname not in ('shopee.vn', 'www.shopee.vn') or p.username or p.password or p.port:
        raise ValueError('Chỉ hỗ trợ HTTPS shop Shopee Việt Nam.')
    # There are no arbitrary public hosts, query parameters or paths accepted.
    if p.query or p.fragment:
        raise ValueError('Hãy dùng URL trang chủ shop, không kèm tham số.')
    username = p.path.strip('/')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{2,80}', username):
        raise ValueError('URL phải có dạng https://shopee.vn/ten_shop')
    if username.lower() in ('search', 'mall', 'buyer', 'seller', 'product', 'api', 'cart', 'login'):
        raise ValueError('Đường dẫn này không phải trang shop.')
    return f'https://shopee.vn/{username}'


def parse_abbreviated(value: str) -> float | None:
    if not value:
        return None
    m = re.search(r'([\d.,]+)\s*([kKmM]?)', str(value))
    if not m:
        return None
    s, unit = m.groups()
    if unit:
        # 1,2k or 1.2k => 1200
        raw = s.replace(',', '.')
        try: return float(raw) * (1000 if unit.lower() == 'k' else 1_000_000)
        except ValueError: return None
    s = s.replace(',', '').replace('.', '') if re.fullmatch(r'\d{1,3}(?:[.,]\d{3})+',s) else s.replace(',', '.')
    try: return float(s)
    except ValueError: return None


def _item_ids(url: str):
    # Product-looking strings in search/redirect parameters are not product links.
    path = urlparse(url).path
    return next((m.groups() for p in PRODUCT_PATTERNS if (m := p.search(path))), None)


def _guess_product_name(a):
    def clean_name(value):
        candidate = ' '.join(str(value or '').split())
        if (len(candidate) < 2 or not re.search(r'[^\W\d_]', candidate) or
                PRICE_PATTERN.fullmatch(candidate) or
                re.fullmatch(r'[\d.,]+\s*[kKmM]?\s*\+?\s+sold(?:\s*/\s*month)?', candidate, re.I) or
                re.search(r'^(?:đã\s*bán|đánh\s*giá|sold\b)', candidate, re.I)):
            return ''
        return candidate[:300]

    # Image alt generally contains the product name on rendered shop cards.
    for img in a.select('img[alt]'):
        candidate = clean_name(img.get('alt'))
        if candidate and not re.search(r'^(?:shopee\b|logo\b|avatar\b|voucher\b|icon\b)', candidate, re.I):
            return candidate
    # select() searches descendants, so inspect the link's own metadata too.
    for attribute in ('title', 'aria-label'):
        candidate = clean_name(a.get(attribute))
        if candidate:
            return candidate
    for selector in ('[data-sqe="name"]', '[class*="line-clamp"]', '[title]'):
        for element in a.select(selector):
            candidate = clean_name(element.get('title') or element.get_text(' ',strip=True))
            if candidate: return candidate
    text = a.get_text('\n', strip=True)
    for line in text.splitlines():
        line=line.strip()
        candidate = clean_name(line)
        if candidate and not PRICE_PATTERN.search(line) and not re.search(r'^giảm',line,re.I):
            return candidate
    return ''


def extract_public_cards(html: str, page_url: str, shop_name: str, category: str = '') -> list[dict]:
    """Parse only visible hyperlink cards in saved/rendered HTML, no private API calls.

    Cards may contain cumulative sold and displayed price only. No 30d sales
    are manufactured by this parser. The layout of Shopee can change.
    """
    soup=BeautifulSoup(html,'html.parser')
    result: dict[str,dict]={}
    for a in soup.select('a[href]'):
        href = urldefrag(urljoin(page_url, unescape(a.get('href', ''))))[0]
        p = urlparse(href)
        if p.scheme != 'https' or p.hostname not in ('shopee.vn', 'www.shopee.vn'):
            continue
        ids = _item_ids(href)
        if not ids: continue
        shopid, itemid = ids
        card = a
        ancestor = a.parent
        # Some cards use an empty overlay link with sibling image/name/price.
        # Only widen to a nearby known item wrapper containing this one product.
        item_classes = {'shop-search-result-view__item',
                        'shopee-search-item-result__item',
                        'shopee-search-item-result'}
        for _ in range(4):
            if ancestor is None or ancestor.name in ('body', 'html', '[document]'):
                break
            if (ancestor.get('data-sqe') == 'item' or
                    item_classes.intersection(ancestor.get('class', []))):
                linked_ids = {_item_ids(link.get('href', ''))
                              for link in ancestor.select('a[href]')}
                linked_ids.discard(None)
                if linked_ids == {ids}:
                    card = ancestor
                break
            ancestor = ancestor.parent
        text = card.get_text(' ', strip=True)
        name = _guess_product_name(a) or _guess_product_name(card)
        if not name: continue
        prices=[parse_abbreviated(m.group(1) or m.group(2)) for m in PRICE_PATTERN.finditer(text)]
        prices=[x for x in prices if x is not None and x>0]
        price=min(prices) if prices else None
        sold_total=None
        # A price immediately before "Sold 39" is not a number-before-sold
        # label. Remove explicit currency amounts before matching sales text.
        sales_text = PRICE_PATTERN.sub(' ', text)
        for pattern in SOLD_PATTERN:
            found=pattern.search(sales_text)
            if found:
                sold_total=parse_abbreviated(found.group(1))
                break
        product={'sku':f'{shopid}.{itemid}', 'source_shop':shop_name,
                 'name':name, 'category':category or 'Chưa phân loại',
                 'price':price, 'units_30d':None, 'revenue_30d':None,
                 'sold_total':sold_total, 'views_30d':None, 'rating':None,
                 'review_count':None, 'cost':None, 'stock':None,
                 'product_url':href}
        if product['sku'] not in result:
            result[product['sku']]=product
        else:
            # Top Products and the regular list can repeat a SKU with different
            # displayed fields. Keep known values and fill only the gaps.
            previous = result[product['sku']]
            previous.update({key: value for key, value in product.items()
                             if previous.get(key) is None and value is not None})
    return list(result.values())


def robots_allowed(url: str, timeout=10) -> tuple[bool, float]:
    """Fail closed when robots.txt cannot be checked."""
    robots='https://shopee.vn/robots.txt'
    try:
        req=Request(robots,headers={'User-Agent':USER_AGENT})
        with urlopen(req, timeout=timeout) as response:
            if response.status != 200: return False,0
            content=response.read(1_000_000).decode('utf-8', errors='replace')
    except (URLError, HTTPError, OSError, TimeoutError):
        return False,0
    parser=RobotFileParser()
    parser.parse(content.splitlines())
    return parser.can_fetch(USER_AGENT,url), float(parser.crawl_delay(USER_AGENT) or 0)


def check_page_access(page_url: str, html: str, *, visible_text=None, password_visible=None):
    """Recognize actual error/login pages instead of reporting a parser failure."""
    parsed = urlparse(page_url)
    if parsed.hostname not in ('shopee.vn', 'www.shopee.vn'):
        raise CrawlBlocked('Trang chuyển hướng ngoài Shopee; đã dừng.')
    path = parsed.path.lower()
    if re.search(r'/(?:buyer/|account/)?login(?:/|$)', path):
        raise CrawlBlocked('Shopee chuyển trang shop sang trang đăng nhập. Phiên trình duyệt của bot chưa xem được sản phẩm.')
    if path.startswith('/verify/traffic/error'):
        raise CrawlBlocked('Shopee chuyển bot đến /verify/traffic/error (chặn lưu lượng truy cập). Trang shop và danh sách sản phẩm chưa được tải.')
    soup = BeautifulSoup(html, 'html.parser')
    for element in soup.select('script, style, noscript, template, [hidden], [aria-hidden="true"]'):
        if element.attrs is not None:
            element.decompose()
    for element in soup.select('[style]'):
        if element.attrs is not None and re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)', element.get('style', ''), re.I):
            element.decompose()
    visible_text = (soup.get_text(' ', strip=True) if visible_text is None else visible_text).lower()
    if (re.search(r'^/(?:captcha|verify)(?:/|$)', path) or
            'xác minh bạn không phải robot' in visible_text or
            'verify you are human' in visible_text or
            'security verification' in visible_text):
        raise CrawlBlocked('Shopee yêu cầu xác minh/CAPTCHA; bot chưa truy cập được danh sách sản phẩm.')
    if any(message in visible_text for message in (
            'hoạt động bất thường', 'unusual traffic', 'access denied', 'truy cập bị từ chối')):
        raise CrawlBlocked('Shopee đang chặn truy cập tự động trong phiên trình duyệt của bot.')
    if password_visible is None:
        password_visible = soup.select_one('input[type="password"]') is not None
    if (password_visible and
            not any(_item_ids(a['href']) for a in soup.select('a[href]'))):
        raise CrawlBlocked('Trang hiển thị biểu mẫu đăng nhập thay vì danh sách sản phẩm.')


def _read_shop_page(page, shop_name, category):
    html = page.content()
    is_visible = '(elements) => elements.some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")'
    check_page_access(page.url, html,
                      visible_text=page.locator('body').inner_text(),
                      password_visible=page.locator('input[type="password"]').evaluate_all(is_visible))
    if page.locator('iframe[src*="captcha"], [id*="captcha"]').evaluate_all(
            is_visible):
        raise CrawlBlocked('Shopee yêu cầu xác minh/CAPTCHA; bot chưa truy cập được danh sách sản phẩm.')
    return extract_public_cards(html, page.url, shop_name, category)


def _same_shop_page(page_url, target_url):
    current, target = urlparse(page_url), urlparse(target_url)
    return (current.hostname in ('shopee.vn', 'www.shopee.vn') and
            current.path.rstrip('/').lower() == target.path.rstrip('/').lower())


def extract_saved_shop_page(html: str, target_url: str, shop_name: str,
                            category: str = '') -> list[dict]:
    """Read rendered product cards from user-saved HTML without opening it.

    URL metadata, when provided, must identify the requested shop. A saved
    document only contains the cards loaded before saving; scripts and remote
    assets are never executed or fetched to load more products.
    """
    target_url = validate_shop_url(target_url)
    soup = BeautifulSoup(html, 'html.parser')
    source_urls = []
    for link in soup.find_all('link', href=True):
        if 'canonical' in [str(value).lower() for value in link.get('rel', [])]:
            source_urls.append(link['href'])
    for meta in soup.find_all('meta', content=True):
        if str(meta.get('property') or meta.get('name') or '').lower() == 'og:url':
            source_urls.append(meta['content'])
    for source in source_urls:
        try:
            source_url = urljoin(target_url, str(source).strip())
            parsed = urlparse(source_url)
            invalid_source = (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port)
        except ValueError as error:
            raise CrawlError('URL nguồn trong file HTML không phải trang shop Shopee hợp lệ.') from error
        if invalid_source:
            raise CrawlError('URL nguồn trong file HTML không phải trang shop Shopee hợp lệ.')
        check_page_access(source_url, '')
        if not _same_shop_page(source_url, target_url):
            raise CrawlError(f'File HTML không thuộc shop đang chọn: {target_url}. Hãy lưu lại đúng trang shop.')
    # Exclude markup that was never a displayed card, such as HTML templates.
    for element in soup.select('script, style, noscript, template, [hidden], [aria-hidden="true"]'):
        if element.attrs is not None:
            element.decompose()
    for element in soup.select('[style]'):
        if element.attrs is not None and re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)', element.get('style', ''), re.I):
            element.decompose()
    rendered_html = str(soup)
    check_page_access(target_url, rendered_html)
    products = extract_public_cards(rendered_html, target_url, shop_name, category)
    if not products:
        raise CrawlError('File HTML chưa chứa thẻ sản phẩm đọc được. Hãy mở đúng trang shop, chờ sản phẩm hiển thị, cuộn để tải thêm rồi lưu lại trang HTML.')
    return products[:150]


def crawl_public_shop(url: str, shop_name: str, category: str = '', max_scrolls: int = 3,
                      *, interactive: bool = False, user_data_dir=None, on_status=None) -> list[dict]:
    """Retrieve a single public shop page using Playwright's real browser.

    Assisted mode lets the user sign in manually in a visible browser.
    Only the requested shop page is collected; login is never automated.
    """
    url=validate_shop_url(url)
    allowed, delay=robots_allowed(url)
    if not allowed:
        raise CrawlBlocked('robots.txt không cho phép thu thập hoặc không thể xác minh quyền truy cập.')
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout, Error as BrowserError
    except ImportError as e:
        raise CrawlError('Thiếu Playwright. Chạy: pip install playwright && python -m playwright install chromium') from e
    max_scrolls = max(0,min(int(max_scrolls),4))
    with sync_playwright() as p:
        browser = None
        page = None
        try:
            context_options = dict(user_agent=USER_AGENT, locale='vi-VN', viewport={'width':1366,'height':850})
            if interactive or user_data_dir:
                profile = Path(user_data_dir or Path(__file__).parent / '.browser-profile')
                profile.mkdir(parents=True, exist_ok=True, mode=0o700)
                browser = p.chromium.launch_persistent_context(
                    user_data_dir=str(profile), headless=not interactive, **context_options)
                page = browser.new_page()
            else:
                browser=p.chromium.launch(headless=True)
                page=browser.new_page(**context_options)
            if interactive and on_status:
                on_status(f'Trình duyệt đã mở. Hãy đăng nhập nếu cần, rồi mở {url}. Chờ tối đa 3 phút; đóng trình duyệt để dừng.')
            try:
                response=page.goto(url, wait_until='domcontentloaded',timeout=25000)
            except BrowserTimeout:
                if not interactive:
                    raise
                response = None  # The user may finish navigation in the visible browser.
            if not interactive and (response is None or response.status>=400):
                raise CrawlBlocked(f'Trang từ chối hoặc lỗi HTTP: {response.status if response else "no response"}.')
            # Wait for actual cards, not a fixed 1.7 seconds after the HTML shell.
            products = []
            deadline = time.monotonic() + (180 if interactive else 15)
            last_note = None
            last_block = None
            while True:
                if interactive:
                    pages = [tab for tab in browser.pages if not tab.is_closed()]
                    if not pages:
                        raise CrawlError('Đã đóng trình duyệt hỗ trợ trước khi đọc được sản phẩm.')
                    matching = [tab for tab in pages if _same_shop_page(tab.url, url)]
                    if matching:
                        page = matching[-1]
                    elif page.is_closed():
                        page = pages[-1]
                try:
                    # Do not import recommended products from the homepage after login.
                    check_page_access(page.url, '')
                    if not _same_shop_page(page.url, url):
                        raise CrawlBlocked(f'Hãy mở lại đúng trang shop: {url}')
                    products = _read_shop_page(page, shop_name, category)
                    last_block = None
                    note = 'Đang chờ danh sách sản phẩm hiển thị trên trang shop...'
                except CrawlBlocked as error:
                    if not interactive:
                        raise
                    last_block = error
                    note = f'{error} Bạn có thể thao tác trực tiếp trong trình duyệt, rồi mở lại {url}.'
                if interactive and on_status and note != last_note:
                    on_status(note)
                    last_note = note
                if products or time.monotonic() >= deadline:
                    break
                # Poll local rendered state only; never refresh/retry the blocked URL.
                page.wait_for_timeout(1000 if interactive else 500)
            if not products and last_block:
                raise CrawlBlocked(f'Hết 3 phút chờ thao tác. {last_block}')
            if interactive and products and on_status:
                on_status('Đã thấy sản phẩm. Đang đọc và lưu dữ liệu...')
            collected = {product['sku']: product for product in products}
            for _ in range(max_scrolls):
                if not _same_shop_page(page.url, url):
                    raise CrawlBlocked('Trang shop đã thay đổi trong khi thu thập. Hãy quét lại đúng shop.')
                page.mouse.wheel(0,750)
                page.wait_for_timeout(max(1500,int(delay*1000)))
                for product in _read_shop_page(page, shop_name, category):
                    previous = collected.get(product['sku'])
                    if previous:
                        previous.update({key: value for key, value in product.items() if value is not None})
                    else:
                        collected[product['sku']] = product
            if not collected:
                soup = BeautifulSoup(page.content(), 'html.parser')
                links = sum(bool(_item_ids(urljoin(page.url, a['href']))) for a in soup.select('a[href]'))
                final_url = urlparse(page.url)._replace(query='', fragment='').geturl()
                message = (f'Không có sản phẩm sau khi chờ tải và cuộn trang. '
                           f'URL: {final_url}; tiêu đề: {page.title()[:80] or "(trống)"}; '
                           f'link sản phẩm: {links}. ')
                message += ('Có link nhưng chưa đọc được tên/thẻ sản phẩm.' if links else
                            'Trang trả về không hiển thị danh sách sản phẩm cho bot.')
                raise CrawlError(message)
            return list(collected.values())[:150]
        except BrowserTimeout as e:
            raise CrawlError('Hết thời gian tải trang Shopee. Không tự động thử lại liên tục.') from e
        except BrowserError as e:
            if 'Executable doesn\'t exist' in str(e):
                raise CrawlError('Thiếu Chromium. Chạy: .venv/bin/python -m playwright install chromium') from e
            if interactive and ('Target closed' in str(e) or 'has been closed' in str(e)):
                raise CrawlError('Đã đóng trình duyệt hỗ trợ trước khi hoàn tất thu thập.') from e
            if interactive and ('XServer' in str(e) or 'Missing X server' in str(e)):
                raise CrawlError('Chế độ mở trình duyệt cần máy có giao diện đồ họa. Hãy chạy ứng dụng trực tiếp trên Mac.') from e
            raise CrawlError(f'Lỗi trình duyệt thu thập: {str(e)[:250]}') from e
        except CrawlError as e:
            final_url = urlparse(page.url)._replace(query='', fragment='').geturl() if page else url
            logger.warning('Crawler stopped: url=%s; reason=%s', final_url, e)
            raise
        finally:
            if browser is not None:
                browser.close()
