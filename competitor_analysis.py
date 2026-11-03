"""Comparisons within the collected sample, using observed product data only."""

import math
import re
import statistics
import unicodedata
from collections import defaultdict
from urllib.parse import urlparse

from crawl_worker import parse_abbreviated


def normalized(value):
    text = ''.join(c for c in unicodedata.normalize('NFD', str(value or ''))
                   if unicodedata.category(c) != 'Mn').lower().replace('đ', 'd')
    return re.sub(r'[^a-z0-9]+', '_', text).strip('_')


def known_category(value):
    return normalized(value) not in ('', 'chua_phan_loai', 'uncategorized', 'shopee')


def _number(value, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and (value > 0 if positive else value >= 0) else None


def _display_number(value):
    text = str(value or '').strip()
    # Do not mistake arbitrary explanatory text or a range for a single metric.
    match = re.fullmatch(
        r'(?:(?:đã\s+bán|da\s+ban|sold|ratings?|đánh\s+giá)\s*[:：]?\s*)?'
        r'([\d.,]+\s*[kKmM]?\s*\+?)'
        r'(?:\s*(?:sold|ratings?|đánh\s+giá|lượt\s+bán))?', text, re.I)
    if not match:
        return None
    return _number(parse_abbreviated(match.group(1)))


def price_range(price_text, fallback=None):
    """Read the visible price or variant price range, excluding other labels."""
    text = str(price_text or '').strip()
    currency = r'(?:₫|đ|vnđ|vnd)?'
    amount = r'([\d][\d.,]*(?:\s*[kKmM])?)'
    expression = rf'{currency}\s*{amount}\s*{currency}'
    match = re.fullmatch(rf'{expression}(?:\s*[-–—~]\s*{expression})?', text, re.I)
    if match:
        values = [value for raw in match.groups() if raw is not None
                  if (value := _number(parse_abbreviated(raw), positive=True)) is not None]
        if values:
            return min(values), max(values)
    value = _number(fallback, positive=True)
    return value, value


def enrich_product(product):
    """Fill missing analytics fields from a saved successful public detail page.

    Listing prices remain authoritative: detail prices can describe a different
    selected variant or promotion. The original detail text stays available.
    """
    item = dict(product)
    detail = item.get('detail') or {}
    usable = detail.get('status') == 'done'
    path = [str(value).strip() for value in detail.get('categories', [])
            if known_category(value)] if usable else []
    item['category_path'] = path
    item['category_source'] = 'observation'
    if not known_category(item.get('category')) and path:
        item['category'] = path[-1]
        item['category_source'] = 'product_detail'
    collected = detail.get('collected_at', '') if usable else ''
    item['detail_collected_at'] = collected
    item['detail_stale'] = bool(usable and (
        (collected and collected[:10] < str(item.get('snapshot_date', ''))[:10]) or
        detail.get('last_error')))
    for field, raw_field in (('rating', 'rating_text'), ('review_count', 'review_count_text'),
                             ('sold_total', 'sold_text')):
        item[field + '_source'] = 'observation' if item.get(field) is not None else 'missing'
        if item.get(field) is None and usable:
            parsed = _display_number(detail.get(raw_field))
            if parsed is not None and (field != 'rating' or parsed <= 5):
                item[field] = parsed
                item[field + '_source'] = 'product_detail'
    raw_sold = str(detail.get('sold_text', '')) if usable else ''
    item['sold_lower_bound'] = bool('+' in raw_sold and
                                    _display_number(raw_sold) == item.get('sold_total'))
    item['price_min'], item['price_max'] = price_range(
        detail.get('price_text') if usable else '', item.get('price'))
    item['price_range_source'] = ('product_detail' if usable and
                                  price_range(detail.get('price_text'))[0] is not None else 'listing')
    return item


def _source_identity(value):
    parsed = urlparse(str(value or ''))
    if parsed.hostname in ('shopee.vn', 'www.shopee.vn'):
        return normalized(parsed.path.strip('/'))
    return normalized(value)


def without_self(own, market, shop):
    names = {_source_identity(shop.get('name')), _source_identity(shop.get('url'))}
    names.update(_source_identity(product.get('source_shop')) for product in own)
    names.discard('')
    return [product for product in market
            if _source_identity(product.get('source_shop')) not in names]


def _median(products):
    prices = [value for product in products
              if (value := _number(product.get('price'), positive=True)) is not None]
    return statistics.median(prices) if prices else None


def _gap(price, reference):
    return round((price / reference - 1) * 100, 1) if price is not None and reference else None


def _sum_known(products, field):
    values = [value for product in products
              if (value := _number(product.get(field))) is not None]
    return sum(values) if values else None


def _coverage(products, field, positive=False):
    return sum(_number(product.get(field), positive=positive) is not None for product in products)


def _category_path(product):
    path = [part for part in product.get('category_path', []) if known_category(part)]
    if not path and known_category(product.get('category')):
        path = [part.strip() for part in re.split(r'\s*[>/]\s*', product['category'])
                if known_category(part)]
    return path


def _category_key(product):
    leaf = normalized(product.get('category'))
    # "Others" occurs under many unrelated Shopee branches.
    if leaf in ('others', 'other', 'khac'):
        path = _category_path(product)
        return '/'.join(normalized(part) for part in path) if len(path) > 1 else ''
    return leaf


def category_reference(product, own, shop):
    """Return a stated match and its own-product comparison set."""
    category = _category_key(product)
    if known_category(product.get('category')) and category:
        exact = [item for item in own if _category_key(item) == category]
        if exact:
            return 'exact', exact, product['category']
    path = _category_path(product)
    # Compare the deepest shared ancestor. A shared root is a broad comparison,
    # never evidence that two products are interchangeable.
    for parent in reversed(path[:-1]):
        reference = [item for item in own
                     if normalized(parent) in {normalized(part) for part in _category_path(item)}]
        if reference:
            return 'parent', reference, parent
    shop_category = shop.get('category')
    if known_category(shop_category) and normalized(shop_category) in {
            normalized(part) for part in path}:
        return 'shop_category', [], shop_category
    return None, [], None


def rank_recommendations(own, market, shop, scorer, platform_fee, ads_fee):
    own_names = {normalized(product.get('name')) for product in own}
    ranked = []
    for product in market:
        if normalized(product.get('name')) in own_names or _number(product.get('price'), positive=True) is None:
            continue
        match, reference, category = category_reference(product, own, shop)
        if match is None:
            continue
        score = scorer(product, reference, market, platform_fee, ads_fee)
        if score is None:
            continue
        median = _median(reference)
        gap = _gap(product['price'], median)
        labels = {'exact': 'Cùng nhóm hàng', 'parent': 'Cùng nhóm hàng rộng',
                  'shop_category': 'Phù hợp ngành hàng shop đã khai báo'}
        reasons = list(score['reasons'])
        if match == 'exact':
            reasons.append(f'Cùng nhóm hàng {category}; cần kiểm tra quy cách trước khi chọn nhập.')
        elif match == 'parent':
            reasons.append(f'Chỉ trùng nhóm rộng {category}; chưa xác nhận cùng công dụng hoặc quy cách.')
        else:
            reasons.append('Phù hợp ngành hàng đã khai báo; chưa có sản phẩm của shop để so sánh giá.')
        if median is None:
            reasons.append('Chưa đủ giá cùng nhóm của shop để so sánh phân khúc.')
        if product.get('sold_lower_bound'):
            reasons.append('Số đã bán có dấu + là mức hiển thị tối thiểu, không phải số bán chính xác.')
        if product.get('detail_stale'):
            reasons.append('Thông tin chi tiết giữ từ lần đọc trước; cần quét lại để cập nhật.')
        ranked.append({**product, **score, 'reasons': reasons, 'category_match': match,
                       'category_match_label': labels[match], 'comparison_category': category,
                       'own_category_median_price': median, 'price_gap_pct': gap})
    ranked.sort(key=lambda item: (-item['score'], -item['demand_score'], normalized(item.get('source_shop')),
                                  str(item.get('sku'))))
    return ranked


def product_query(product):
    name = str(product.get('name') or '').strip()
    cleaned = re.sub(r'^\s*(?:\[[^\]]{1,120}\]\s*)+', '', name)
    cleaned = re.sub(r'^\s*(?:\([^)]{1,80}\)\s*)+', '', cleaned)
    cleaned = re.sub(r'^\s*(?:\d{1,3}[.)\-:]\s+)+', '', cleaned)
    cleaned = re.sub(r'^(?:(?:\d+(?:\s*[-/+]\s*\d+)*\s*)?(?:combo|set|bộ)\s*\d*\s*[/+\-]?\s*)+',
                     '', cleaned, flags=re.I)
    cleaned = re.sub(r'^(?:(?:sale|freeship|xả\s+kho|giảm\s+giá)\b\s*'
                     r'(?:\d+\s*%\s*)?[-:–]?\s*)+', '', cleaned, flags=re.I)
    cleaned = re.split(r'[,;\n+]', cleaned, maxsplit=1)[0]
    words = []
    for word in cleaned.split():
        if not words or normalized(word) != normalized(words[-1]):
            words.append(word)
    words = words[:6]
    for index, word in enumerate(words):
        if index >= 3 and normalized(word) in ('de', 'kem'):
            words = words[:index]
            break
    while words and normalized(words[-1]) in ('de', 'va', 'cho', 'co', 'kem'):
        words.pop()
    return ' '.join(words)[:100].strip(' -–:')


def discovery_queries(own):
    """Build a few public product searches from the shop's actual catalog."""
    grouped = defaultdict(list)
    for product in own:
        if known_category(product.get('category')):
            key = _category_key(product)
            if key:
                grouped[key].append(product)
    queries = []
    seen = set()
    groups = sorted(grouped.values(), key=lambda items: (-len(items), _category_key(items[0])))
    for products in groups:
        representatives = sorted(products, key=lambda product: (
            -(_number(product.get('sold_total')) or 0),
            -(_number(product.get('review_count')) or 0), str(product.get('sku', ''))))
        for product in representatives:
            name = str(product.get('name') or '').strip()
            query = product_query(product)
            if len(query) < 4 or normalized(query) in seen:
                continue
            seen.add(normalized(query))
            queries.append({'query': query, 'category': product['category'],
                            'own_product_name': name})
            break
        if len(queries) == 3:
            break
    return queries


_NAME_STOPWORDS = set(('san pham combo set bo cai chiec shop family house chinh hang cao cap da nang '
                      'tien loi tot gia re moi mau dung cho va voi nhieu loai kich thuoc '
                      'thuc pham inox nhua thep go silicon tay cam dai chac chan qua '
                      've sinh lam sach').split())


def _name_tokens(product):
    name = re.sub(r'^\s*(?:\[[^\]]{1,120}\]\s*)+', '', str(product.get('name') or ''))
    return {word for word in normalized(name).split('_')
            if len(word) >= 2 and not word.isdigit() and word not in _NAME_STOPWORDS}


def top_own_products(own, limit=10):
    monthly = [item for item in own if _number(item.get('units_30d')) is not None]
    cumulative = [item for item in own if _number(item.get('sold_total')) is not None]
    candidates = monthly or cumulative or own
    field = 'units_30d' if monthly else 'sold_total'
    return sorted(candidates, key=lambda item: (-(_number(item.get(field)) or 0),
                  -(_number(item.get('review_count')) or 0), str(item.get('sku'))))[:limit]


def product_comparisons(own, market, links=()):
    linked = {(str(link['own_sku']), _source_identity(link['source_shop']), str(link['sku']))
              for link in links}
    rows = []
    for item in top_own_products(own):
        own_tokens = _name_tokens(item)
        matches = []
        for competitor in market:
            direct = (str(item['sku']), _source_identity(competitor['source_shop']),
                      str(competitor['sku'])) in linked
            tokens = _name_tokens(competitor)
            common = len(own_tokens & tokens)
            overlap = common / min(len(own_tokens), len(tokens)) if own_tokens and tokens else 0
            jaccard = common / len(own_tokens | tokens) if own_tokens or tokens else 0
            if not direct and not (common >= 2 and overlap >= .5 and jaccard >= .15):
                continue
            own_path, other_path = _category_path(item), _category_path(competitor)
            if (not direct and own_path and other_path and
                    _category_key(item) != _category_key(competitor) and
                    normalized(own_path[0]) != normalized(other_path[0])):
                continue
            matches.append({**competitor,
                            'match_kind': 'direct_search' if direct else 'name_similarity',
                            'match_label': 'Ứng viên từ lượt tìm trực tiếp; cần đối chiếu quy cách' if direct else
                                           'Tên tương tự; chưa xác nhận cùng mẫu hoặc quy cách',
                            'match_score': round(100 * (.6 * overlap + .4 * jaccard), 1)})
        matches.sort(key=lambda product: (
            product['match_kind'] != 'direct_search', -product['match_score'],
            -(_number(product.get('sold_total')) or 0), _source_identity(product['source_shop']),
            str(product['sku'])))
        prices_min = [product['price_min'] for product in matches if product.get('price_min') is not None]
        prices_max = [product['price_max'] for product in matches if product.get('price_max') is not None]
        if item.get('units_30d') is not None:
            basis = 'estimated_30d' if item.get('units_basis') == 'estimated_snapshot_delta' else 'reported_30d'
        else:
            basis = 'cumulative_sold' if item.get('sold_total') is not None else 'unknown'
        rows.append({'own_product': item, 'ranking_basis': basis, 'query': product_query(item),
                     'competitors': matches[:20], 'competitors_truncated':len(matches)>20, 'summary': {
                         'shop_count': len({_source_identity(product['source_shop']) for product in matches}),
                         'product_count': len(matches),
                         'price_min': min(prices_min) if prices_min else None,
                         'price_max': max(prices_max) if prices_max else None,
                         'sold_count': _coverage(matches, 'sold_total'),
                         'review_count_known': _coverage(matches, 'review_count'),
                     }})
    return rows


def build_analysis(own, market, recommendations, comparison_links=()):
    grouped = defaultdict(list)
    for product in market:
        grouped[_source_identity(product.get('source_shop'))].append(product)
    shops = []
    for products in grouped.values():
        ratings = [product['rating'] for product in products
                   if _number(product.get('rating')) is not None and product['rating'] <= 5]
        snapshots = [product['snapshot_date'] for product in products if product.get('snapshot_date')]
        shops.append({
            'source_shop': products[0]['source_shop'], 'product_count': len(products),
            'median_price': _median(products), 'price_count': _coverage(products, 'price', True),
            'rating_mean': round(statistics.mean(ratings), 2) if ratings else None,
            'rating_count': len(ratings), 'review_count_sum': _sum_known(products, 'review_count'),
            'review_count_known': _coverage(products, 'review_count'),
            'sold_total_sum': _sum_known(products, 'sold_total'),
            'sold_count': _coverage(products, 'sold_total'),
            'sold_lower_bound_count': sum(bool(product.get('sold_lower_bound')) for product in products),
            'units_30d_sum': _sum_known(products, 'units_30d'),
            'monthly_count': _coverage(products, 'units_30d'),
            'monthly_estimated_count': sum(product.get('units_basis') == 'estimated_snapshot_delta'
                                           for product in products),
            'latest_snapshot': max(snapshots) if snapshots else None,
            'oldest_snapshot': min(snapshots) if snapshots else None,
            'detail_count': sum((product.get('detail') or {}).get('status') == 'done'
                                for product in products),
        })
    shops.sort(key=lambda item: (-item['product_count'], normalized(item['source_shop'])))
    categories = defaultdict(lambda: {'own': [], 'market': []})
    for side, products in (('own', own), ('market', market)):
        for product in products:
            key = _category_key(product) or 'chua_phan_loai'
            categories[key][side].append(product)
    category_rows = []
    for key, group in categories.items():
        samples = group['own'] + group['market']
        label = samples[0].get('category') or 'Chưa phân loại'
        if normalized(label) in ('others', 'other', 'khac') and len(_category_path(samples[0])) > 1:
            label = ' > '.join(_category_path(samples[0])[-2:])
        own_median, market_median = _median(group['own']), _median(group['market'])
        category_rows.append({
            'category': label, 'own_count': len(group['own']), 'market_count': len(group['market']),
            'own_median_price': own_median, 'market_median_price': market_median,
            'gap_pct': _gap(market_median, own_median)
                       if known_category(label) and key != 'chua_phan_loai' else None,
            'shop_count': len({_source_identity(product.get('source_shop')) for product in group['market']}),
        })
    category_rows.sort(key=lambda item: (-item['market_count'], -item['own_count'], normalized(item['category'])))
    return {
        'summary': {
            'shop_count': len(shops), 'product_count': len(market), 'own_product_count': len(own),
            'own_median_price': _median(own), 'market_median_price': _median(market),
            'price_count': _coverage(market, 'price', True), 'rating_count': _coverage(market, 'rating'),
            'sold_count': _coverage(market, 'sold_total'), 'monthly_count': _coverage(market, 'units_30d'),
        },
        'shops': shops, 'categories': category_rows, 'recommendations': recommendations[:20],
        'discovery_queries': discovery_queries(own),
        'product_comparisons': product_comparisons(own, market, comparison_links),
    }
