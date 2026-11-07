import importlib
import json
import re

from fastapi.testclient import TestClient


def make_client(tmp_path, monkeypatch, site='', today='2099-01-01'):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    monkeypatch.delenv('RENDER_EXTERNAL_URL', raising=False)
    monkeypatch.setenv('BLOG_TODAY', today)  # default: everything published; scheduling tests pass a real date
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
    import blog
    newest = blog.visible_posts()[:3]
    assert len(newest) == 3
    for post in newest:
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
        assert len(with_steps) >= 33
        for post in with_steps:
            image = anonymous.get(f'/blog/steps/{post["slug"]}.svg')
            assert image.status_code == 200 and image.headers['content-type'].startswith('image/svg+xml')
            assert 'market' in image.text and 'MarketLens thiết kế' in image.text
            assert f'src="/blog/steps/{post["slug"]}.svg"' in anonymous.get(f'/blog/{post["slug"]}').text
        assert anonymous.get('/blog/steps/none.svg').status_code == 404


def test_blog_has_unique_posts_and_valid_related(tmp_path, monkeypatch):
    import blog_posts
    slugs = [p['slug'] for p in blog_posts.POSTS]
    assert len(slugs) == len(set(slugs)) >= 33
    for post in blog_posts.POSTS:
        for slug in post['related']:
            assert slug in slugs, (post['slug'], slug)


def test_scheduled_posts_stay_hidden_until_their_date(tmp_path, monkeypatch):
    import blog_posts
    future = [p for p in blog_posts.POSTS if p['published'] > '2026-11-07']
    assert future, 'queue should contain scheduled posts'
    first = future[0]
    second = next(p for p in future if p['published'] > first['published'])  # a post scheduled for a later day
    with make_client(tmp_path, monkeypatch, 'https://shop.example.com', today='2026-11-08') as anonymous:
        for path in (f'/blog/{first["slug"]}', f'/blog/cover/{first["slug"]}.svg', f'/blog/steps/{first["slug"]}.svg'):
            assert anonymous.get(path).status_code == 404, path
        listing = anonymous.get('/blog').text + anonymous.get('/').text + anonymous.get('/sitemap.xml').text
        assert first['slug'] not in listing and second['slug'] not in listing
    with make_client(tmp_path, monkeypatch, 'https://shop.example.com', today=first['published']) as anonymous:
        assert anonymous.get(f'/blog/{first["slug"]}').status_code == 200
        assert first['slug'] in anonymous.get('/blog').text and first['slug'] in anonymous.get('/sitemap.xml').text
        assert second['slug'] not in anonymous.get('/blog').text  # next one is still scheduled
        assert anonymous.get(f'/blog/{second["slug"]}').status_code == 404


def test_scheduled_posts_only_link_to_posts_published_before_them(tmp_path, monkeypatch):
    import blog_posts
    dates = {p['slug']: p['published'] for p in blog_posts.POSTS}
    for post in blog_posts.POSTS:
        linked = set(re.findall(r'href="/blog/([^"#/]+)"', post['body'])) | set(post['related'])
        for slug in linked:
            assert slug in dates, (post['slug'], slug)
            assert dates[slug] <= post['published'], f'{post["slug"]} ({post["published"]}) links to later post {slug} ({dates[slug]})'


def test_queue_posts_publish_five_per_day_in_order():
    import collections
    import blog_posts
    dates = [p['published'] for p in blog_posts.QUEUE]
    assert dates == sorted(dates) and dates[0] == '2026-11-09'
    per_day = collections.Counter(dates)
    assert max(per_day.values()) == blog_posts.PER_DAY == 5
    assert all(count == 5 for day, count in per_day.items() if day != dates[-1])  # only the last day may be partial
