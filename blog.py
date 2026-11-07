"""Public SEO blog: /blog, /blog/<slug>, /sitemap.xml and /robots.txt (server-rendered, no login)."""
import html
import json
import os
import re
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from blog_posts import POSTS, REFERENCE_NOTE, REFERENCE_URL

BY_SLUG = {p['slug']: p for p in POSTS}
CSS = '/static/blog.css?v=20261107-blog-01'
BRAND = 'MarketLens'


def site_url(request=None):
    """Canonical origin: SITE_URL, else Render's external URL, else the request's own origin."""
    for name in ('SITE_URL', 'RENDER_EXTERNAL_URL'):
        value = os.environ.get(name, '').strip().rstrip('/')
        if value.startswith(('https://', 'http://')):
            return value
    return str(request.base_url).rstrip('/') if request is not None else ''


def esc(value):
    return html.escape(str(value), quote=True)


def vi_date(iso):
    y, m, d = (int(x) for x in iso.split('-'))
    return f'{d:02d}/{m:02d}/{y}'


def toc(body):
    items = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', body)
    if not items:
        return ''
    links = ''.join(f'<li><a href="#{esc(i)}">{t}</a></li>' for i, t in items)
    return f'<nav class="toc" aria-label="Mục lục"><strong>Mục lục</strong><ol>{links}</ol></nav>'


def card(post):
    url = f'/blog/{post["slug"]}'
    return (
        f'<article class="post-card"><span class="post-cat">{esc(post["category"])}</span>'
        f'<h3><a href="{url}">{esc(post["title"])}</a></h3><p>{esc(post["summary"])}</p>'
        f'<div class="post-meta"><time datetime="{post["published"]}">{vi_date(post["published"])}</time>'
        f' · {post["minutes"]} phút đọc</div><a class="read-more" href="{url}">Đọc bài viết →</a></article>'
    )


def home_cards(limit=3):
    """HTML cards for the landing page (server-rendered so crawlers see the links)."""
    return ''.join(card(p) for p in POSTS[:limit])


def header():
    return (
        '<header class="blog-header"><div class="wrap"><a class="brand" href="/">market<span>lens</span></a>'
        '<nav aria-label="Điều hướng"><a href="/">Trang chủ</a><a href="/blog" aria-current="page">Blog</a>'
        '<a href="/login">Đăng nhập</a><a class="btn" href="/register">Đăng ký</a></nav></div></header>'
    )


def footer():
    return (
        '<footer class="blog-footer"><div class="wrap"><p>© MarketLens · Công cụ phân tích shop, đối thủ và xu hướng cho người bán Shopee.</p>'
        '<p><a href="/">Trang chủ</a> · <a href="/blog">Blog</a> · <a href="/privacy">Chính sách quyền riêng tư</a> · <a href="/terms">Điều khoản dịch vụ</a></p></div></footer>'
    )


def page(title, description, canonical, body, extra_head='', og_type='website', keywords=''):
    kw = f'<meta name="keywords" content="{esc(keywords)}">' if keywords else ''
    return (
        '<!doctype html><html lang="vi"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{esc(title)}</title><meta name="description" content="{esc(description)}">{kw}'
        '<meta name="robots" content="index, follow, max-image-preview:large">'
        f'<link rel="canonical" href="{esc(canonical)}">'
        f'<meta property="og:type" content="{og_type}"><meta property="og:site_name" content="{BRAND}">'
        f'<meta property="og:locale" content="vi_VN"><meta property="og:title" content="{esc(title)}">'
        f'<meta property="og:description" content="{esc(description)}"><meta property="og:url" content="{esc(canonical)}">'
        f'<meta name="twitter:card" content="summary"><meta name="twitter:title" content="{esc(title)}">'
        f'<meta name="twitter:description" content="{esc(description)}">'
        f'<link rel="stylesheet" href="{CSS}">{extra_head}</head><body>'
        f'{header()}<main id="main">{body}</main>{footer()}</body></html>'
    )


def json_ld(data):
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + '</script>'


def index_html(base):
    body = (
        '<section class="blog-hero"><div class="wrap"><p class="eyebrow">BLOG MARKETLENS</p>'
        '<h1>Kinh nghiệm bán hàng trên Shopee: từ chọn hàng đến tối ưu lợi nhuận</h1>'
        '<p>Hướng dẫn thực tế cho người bán: đăng sản phẩm, đặt giá, nghiên cứu đối thủ, tìm sản phẩm xu hướng và làm ảnh, video. '
        'Mỗi bài có ví dụ cụ thể và checklist để áp dụng ngay.</p></div></section>'
        f'<section class="wrap"><div class="post-grid">{"".join(card(p) for p in POSTS)}</div>'
        f'{REFERENCE_NOTE}'
        '<div class="cta-box"><h2>Muốn thấy số liệu của chính shop bạn?</h2>'
        '<p>Đăng ký MarketLens để thu thập sản phẩm, so sánh đối thủ và tính lãi từng SKU.</p>'
        '<a class="btn" href="/register">Đăng ký tài khoản</a></div></section>'
    )
    canonical = base + '/blog'
    graph = json_ld({
        '@context': 'https://schema.org', '@type': 'Blog', 'name': 'Blog MarketLens', 'url': canonical, 'inLanguage': 'vi',
        'blogPost': [{'@type': 'BlogPosting', 'headline': p['title'], 'url': f'{base}/blog/{p["slug"]}', 'datePublished': p['published']} for p in POSTS],
    })
    return page('Blog bán hàng Shopee: hướng dẫn, mẹo và phân tích | MarketLens',
                'Blog MarketLens: hướng dẫn bán hàng trên Shopee, tối ưu tiêu đề, tính giá và lợi nhuận, nghiên cứu đối thủ, chọn sản phẩm xu hướng.',
                canonical, body, graph, keywords='blog bán hàng shopee, kinh nghiệm bán hàng shopee, hướng dẫn shopee')


def post_html(post, base):
    canonical = f'{base}/blog/{post["slug"]}'
    faq_items = ''.join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in post['faq'])
    related = ''.join(card(BY_SLUG[s]) for s in post['related'] if s in BY_SLUG)
    operator = os.environ.get('LEGAL_OPERATOR_NAME', '').strip() or BRAND
    body = (
        '<div class="wrap article-wrap"><nav class="crumbs" aria-label="Đường dẫn"><a href="/">Trang chủ</a> › <a href="/blog">Blog</a> › '
        f'<span>{esc(post["category"])}</span></nav>'
        f'<article class="article"><header><span class="post-cat">{esc(post["category"])}</span><h1>{esc(post["h1"])}</h1>'
        f'<div class="post-meta">Đăng ngày <time datetime="{post["published"]}">{vi_date(post["published"])}</time> · {post["minutes"]} phút đọc · {esc(BRAND)}</div></header>'
        f'{toc(post["body"])}<div class="prose">{post["body"]}</div>'
        f'<section class="faq" aria-labelledby="faq-title"><h2 id="faq-title">Câu hỏi thường gặp</h2>{faq_items}</section>'
        f'{REFERENCE_NOTE}'
        '<div class="cta-box"><h2>Áp dụng ngay với dữ liệu của shop bạn</h2>'
        '<p>MarketLens giúp thu thập sản phẩm, so sánh đối thủ và tính lãi từng SKU để bạn quyết định dựa trên số liệu.</p>'
        '<a class="btn" href="/register">Đăng ký tài khoản</a> <a class="btn btn-ghost" href="/#xem-thu">Xem bản xem thử</a></div></article>'
        f'<section class="related" aria-labelledby="related-title"><h2 id="related-title">Bài viết liên quan</h2><div class="post-grid">{related}</div></section></div>'
    )
    graph = json_ld({
        '@context': 'https://schema.org',
        '@graph': [
            {'@type': 'BlogPosting', 'headline': post['h1'], 'description': post['description'], 'inLanguage': 'vi',
             'datePublished': post['published'], 'dateModified': post['published'], 'mainEntityOfPage': canonical, 'url': canonical,
             'keywords': post['keywords'], 'articleSection': post['category'],
             'author': {'@type': 'Organization', 'name': operator}, 'publisher': {'@type': 'Organization', 'name': BRAND, 'url': base}},
            {'@type': 'BreadcrumbList', 'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': 'Trang chủ', 'item': base + '/'},
                {'@type': 'ListItem', 'position': 2, 'name': 'Blog', 'item': base + '/blog'},
                {'@type': 'ListItem', 'position': 3, 'name': post['title'], 'item': canonical}]},
            {'@type': 'FAQPage', 'mainEntity': [
                {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in post['faq']]},
        ],
    })
    og = f'<meta property="article:published_time" content="{post["published"]}"><meta property="article:section" content="{esc(post["category"])}">'
    return page(f'{post["title"]} | {BRAND}', post['description'], canonical, body, og + graph, 'article', post['keywords'])


def sitemap_xml(base):
    urls = [(base + '/', '2026-11-07', '1.0'), (base + '/blog', max(p['published'] for p in POSTS), '0.8')]
    urls += [(f'{base}/blog/{p["slug"]}', p['published'], '0.7') for p in POSTS]
    urls += [(base + '/privacy', '2026-11-07', '0.3'), (base + '/terms', '2026-11-07', '0.3')]
    rows = ''.join(f'<url><loc>{esc(u)}</loc><lastmod>{d}</lastmod><priority>{p}</priority></url>' for u, d, p in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>'


def robots_txt(base):
    return (
        'User-agent: *\nAllow: /\nAllow: /static/\nDisallow: /api/\nDisallow: /user\nDisallow: /system\n'
        f'Disallow: /login\nDisallow: /register\n\nSitemap: {base}/sitemap.xml\n'
    )


def install(app):
    router = APIRouter(include_in_schema=False)
    cache = {'Cache-Control': 'public, max-age=300'}

    @router.get('/blog')
    def blog_index(request: Request):
        return Response(index_html(site_url(request)), media_type='text/html; charset=utf-8', headers=cache)

    @router.get('/blog/{slug}')
    def blog_post(slug: str, request: Request):
        post = BY_SLUG.get(slug)
        if not post:
            raise HTTPException(404, 'Không tìm thấy bài viết')
        return Response(post_html(post, site_url(request)), media_type='text/html; charset=utf-8', headers=cache)

    @router.get('/sitemap.xml')
    def sitemap(request: Request):
        return Response(sitemap_xml(site_url(request)), media_type='application/xml; charset=utf-8', headers=cache)

    @router.get('/robots.txt')
    def robots(request: Request):
        return Response(robots_txt(site_url(request)), media_type='text/plain; charset=utf-8', headers=cache)

    app.include_router(router)
