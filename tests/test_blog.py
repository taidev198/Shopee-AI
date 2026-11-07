import importlib
import json
import re

from fastapi.testclient import TestClient


def make_client(tmp_path, monkeypatch, site=''):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    monkeypatch.delenv('RENDER_EXTERNAL_URL', raising=False)
    if site:
        monkeypatch.setenv('SITE_URL', site)
    else:
        monkeypatch.delenv('SITE_URL', raising=False)
    import app as app_module
    return TestClient(importlib.reload(app_module).app)


def test_blog_pages_are_public_and_seo_complete(tmp_path, monkeypatch):
    import blog_posts
    with make_client(tmp_path, monkeypatch, 'https://shop.example.com') as anonymous:
        index = anonymous.get('/blog')
        assert index.status_code == 200 and '<h1>' in index.text
        assert '<link rel="canonical" href="https://shop.example.com/blog">' in index.text
        for post in blog_posts.POSTS:
            page = anonymous.get(f'/blog/{post["slug"]}')
            assert page.status_code == 200, post['slug']
            text = page.text
            assert text.count('<h1>') == 1
            assert len(post['title']) <= 62 and len(post['description']) <= 165, post['slug']
            assert f'<link rel="canonical" href="https://shop.example.com/blog/{post["slug"]}">' in text
            assert 'property="og:title"' in text and 'name="description"' in text
            graph = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', text, re.S).group(1))
            kinds = {item['@type'] for item in graph['@graph']}
            assert kinds == {'BlogPosting', 'BreadcrumbList', 'FAQPage'}
            assert 'banhang.shopee.vn/edu/article' in text  # reference link
            for h2 in re.findall(r'<h2 id="([^"]+)">', post['body']):
                assert f'href="#{h2}"' in text  # table of contents
            for related in post['related']:
                assert related in {p["slug"] for p in blog_posts.POSTS}
        assert anonymous.get('/blog/khong-ton-tai').status_code == 404


def test_internal_links_in_articles_resolve(tmp_path, monkeypatch):
    import blog_posts
    with make_client(tmp_path, monkeypatch) as anonymous:
        for post in blog_posts.POSTS:
            for link in re.findall(r'href="(/blog/[^"#]+)"', post['body']):
                assert anonymous.get(link).status_code == 200, (post['slug'], link)


def test_sitemap_and_robots(tmp_path, monkeypatch):
    import blog_posts
    with make_client(tmp_path, monkeypatch, 'https://shop.example.com') as anonymous:
        sitemap = anonymous.get('/sitemap.xml')
        robots = anonymous.get('/robots.txt')
    assert sitemap.status_code == robots.status_code == 200
    assert 'xml' in sitemap.headers['content-type']
    for url in ['/', '/blog', '/privacy', '/terms'] + [f'/blog/{p["slug"]}' for p in blog_posts.POSTS]:
        assert f'<loc>https://shop.example.com{url}</loc>' in sitemap.text
    assert 'Sitemap: https://shop.example.com/sitemap.xml' in robots.text
    assert 'Disallow: /api/' in robots.text


def test_home_page_links_to_blog_and_has_seo_tags(tmp_path, monkeypatch):
    import blog_posts
    with make_client(tmp_path, monkeypatch, 'https://shop.example.com') as anonymous:
        home = anonymous.get('/')
    assert home.status_code == 200 and '{{' not in home.text
    assert '<link rel="canonical" href="https://shop.example.com/">' in home.text
    assert 'href="#blog"' in home.text and 'id="blog"' in home.text and 'href="/blog"' in home.text
    for post in blog_posts.POSTS[:3]:
        assert f'href="/blog/{post["slug"]}"' in home.text
    assert 'banhang.shopee.vn/edu/article' in home.text


def test_cover_images_are_served_and_referenced(tmp_path, monkeypatch):
    import blog_posts
    with make_client(tmp_path, monkeypatch, 'https://shop.example.com') as anonymous:
        for post in blog_posts.POSTS:
            image = anonymous.get(f'/blog/cover/{post["slug"]}.svg')
            assert image.status_code == 200 and image.headers['content-type'].startswith('image/svg+xml')
            assert image.text.startswith('<svg') and 'viewBox' in image.text
            page = anonymous.get(f'/blog/{post["slug"]}').text
            assert f'src="/blog/cover/{post["slug"]}.svg"' in page and 'alt="Minh họa:' in page
            assert f'content="https://shop.example.com/blog/cover/{post["slug"]}.svg"' in page
        assert anonymous.get('/blog/cover/none.svg').status_code == 404
        assert '/blog/cover/' in anonymous.get('/').text


def test_step_diagrams_are_served_with_watermark(tmp_path, monkeypatch):
    import blog_posts
    with make_client(tmp_path, monkeypatch) as anonymous:
        with_steps = [p for p in blog_posts.POSTS if p['steps']]
        assert len(with_steps) >= 18
        for post in with_steps:
            image = anonymous.get(f'/blog/steps/{post["slug"]}.svg')
            assert image.status_code == 200 and image.headers['content-type'].startswith('image/svg+xml')
            assert 'market' in image.text and 'MarketLens thiết kế' in image.text
            assert f'src="/blog/steps/{post["slug"]}.svg"' in anonymous.get(f'/blog/{post["slug"]}').text
        assert anonymous.get('/blog/steps/none.svg').status_code == 404


def test_blog_has_at_least_nineteen_unique_posts(tmp_path, monkeypatch):
    import blog_posts
    slugs = [p['slug'] for p in blog_posts.POSTS]
    assert len(slugs) == len(set(slugs)) >= 19
    for post in blog_posts.POSTS:
        for slug in post['related']:
            assert slug in slugs, (post['slug'], slug)
