"""Analytics over saved public snapshots; no network access or generated data.

Sales rankings use public cumulative counters, including rounded lower bounds.
Observed growth is a separate calculation requiring consecutive exact counters.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import json
import math
import re
from urllib.parse import urlparse


LOCAL_TZ = timezone(timedelta(hours=7))


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return value if math.isfinite(value) and value >= 0 else None
    except OverflowError:
        return None


def _bounded_integer(value, default, lower, upper):
    number = _number(value)
    return max(lower, min(upper, int(number))) if number is not None else default


def _sum(values):
    values = [value for value in values if value is not None]
    if not values:
        return None
    try:
        return _number(math.fsum(values))
    except (OverflowError, ValueError):
        return None


def _median(values):
    values = sorted(value for value in values if value is not None)
    if not values:
        return None
    index = len(values) // 2
    return values[index] if len(values) % 2 else values[index - 1] / 2 + values[index] / 2


def _day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=LOCAL_TZ)
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def _text(value, limit=300):
    return re.sub(r'\s+', ' ', value).strip()[:limit] if isinstance(value, str) else ''


def _shop_url(value, shop_id):
    if isinstance(value, str):
        try:
            parsed = urlparse(value)
            path = parsed.path.rstrip('/')
            username = path.removeprefix('/')
            reserved = {'search', 'mall', 'buyer', 'seller', 'product', 'api', 'cart', 'login', 'verify', 'captcha', 'checkout'}
            public = (parsed.scheme == 'https' and parsed.hostname in ('shopee.vn', 'www.shopee.vn')
                      and not parsed.port and not parsed.username and not parsed.password)
            if public and (path == f'/shop/{shop_id}' or (
                    re.fullmatch(r'[a-z0-9_.-]{2,80}', username, re.I) and username.lower() not in reserved)):
                return 'https://shopee.vn' + path
        except ValueError:
            pass
    return f'https://shopee.vn/shop/{shop_id}'


def _raw(value):
    if isinstance(value, dict):
        return value
    try:
        result = json.loads(value) if isinstance(value, str) else {}
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def _normalise(rows):
    result = []
    for source in rows:
        row = dict(source)
        sku = str(row.get('sku', ''))
        if not re.fullmatch(r'[1-9]\d*\.[1-9]\d*', sku):
            continue
        observed_day = _day(row.get('day'))
        if observed_day is None:
            continue
        shop_id, product_id = sku.split('.')
        raw = _raw(row.get('raw_json'))
        # Missing precision metadata cannot establish exact sales growth.
        approximate = row.get('sold_approx') not in (False, 0, '0', 'false', 'False')
        review_text = _text(raw.get('review_count_text'))
        review_approximate = not review_text or bool(re.search(r'\d[\d.,]*\s*[kKmM](?:\b|\+)|\+', review_text))
        rating = _number(row.get('rating'))
        collected = row.get('collected_at')
        stamp = _timestamp(collected)
        result.append({
            'sku': sku, 'name': _text(row.get('name')) or f'Sản phẩm {product_id}',
            'url': f'https://shopee.vn/product/{shop_id}/{product_id}',
            'category_id': str(row.get('category_id') or ''), 'category': _text(row.get('category')),
            'shop_id': shop_id,
            'shop_name': _text(row.get('shop_name') or raw.get('shop_name') or raw.get('seller_name'), 120) or f'Shop #{shop_id}',
            'shop_url': _shop_url(row.get('shop_url') or raw.get('shop_url'), shop_id),
            'price': _number(row.get('price')), 'sold_total': _number(row.get('sold_total')),
            'sold_approx': int(approximate), 'review_count': _number(row.get('review_count')),
            'review_approx': int(review_approximate),
            'rating': rating if rating is not None and rating <= 5 else None,
            'day': observed_day.isoformat(), 'collected_at': collected if stamp else None,
            '_day': observed_day,
            '_timestamp': stamp or datetime.combine(observed_day, datetime.min.time(), LOCAL_TZ).astimezone(timezone.utc),
        })
    return result


def _window(rows, days):
    end = max((row['_day'] for row in rows), default=None)
    if end is None:
        return [], None, None
    start = end - timedelta(days=days - 1)
    return [row for row in rows if start <= row['_day'] <= end], start, end


def _daily_unique(rows):
    unique = {}
    for row in rows:
        key = row['sku'], row['day']
        previous = unique.get(key)
        order = row['_timestamp'], row['category_id'], row['name']
        if previous is None or order > (previous['_timestamp'], previous['category_id'], previous['name']):
            unique[key] = row
    return sorted(unique.values(), key=lambda row: (row['sku'], row['day']))


def _latest_products(rows):
    history = defaultdict(list)
    for row in _daily_unique(rows):
        history[row['sku']].append(row)
    result = []
    for snapshots in history.values():
        latest = snapshots[-1]
        product = {key: value for key, value in latest.items() if not key.startswith('_')}
        sales = _observed_change(snapshots, 'sold_total', 'sold_approx')
        reviews = _observed_change(snapshots, 'review_count', 'review_approx')
        reasons = {
            'insufficient': 'Cần ít nhất 3 ngày quan sát để tính xu hướng',
            'precision': 'Thiếu số bán chính xác hoặc số bán đã làm tròn; chưa tính tăng trưởng',
            'reset': 'Bộ đếm bán giảm hoặc reset; cần thêm dữ liệu trước khi tính xu hướng',
            'ready': 'Xu hướng quan sát từ 3 ngày có số bán chính xác; không phải dự báo',
        }
        product.update(observation_days=len(snapshots), velocity=sales['velocity'], acceleration=sales['acceleration'],
                       review_velocity=reviews['velocity'], review_acceleration=reviews['acceleration'],
                       trend_score=sales['score'], trend_basis='sales' if sales['score'] is not None else None,
                       reason=reasons[sales['status']])
        if sales['score'] is None and reviews['score'] is not None:
            product.update(trend_score=reviews['score'], trend_basis='reviews',
                           reason=('Tăng lượt đánh giá quan sát từ 3 ngày có số đếm chính xác; không phải số bán hay dự báo'
                                   if reviews['velocity'] > 0 else
                                   'Lượt đánh giá chưa tăng trong khoảng gần nhất; không phải số bán hay dự báo'))
        result.append(product)
    return result


def _observed_change(snapshots, field, approximate_field):
    result = {'velocity': None, 'acceleration': None, 'score': None, 'status': 'insufficient'}
    if len(snapshots) < 2:
        return result
    previous, latest = snapshots[-2:]
    if any(row[field] is None or row[approximate_field] for row in (previous, latest)):
        return {**result, 'status': 'precision'}
    if latest[field] < previous[field]:
        return {**result, 'status': 'reset'}
    result['velocity'] = (latest[field] - previous[field]) / (latest['_day'] - previous['_day']).days
    if len(snapshots) < 3:
        return result
    earlier = snapshots[-3]
    if earlier[field] is None or earlier[approximate_field]:
        return {**result, 'status': 'precision'}
    if previous[field] < earlier[field]:
        return {**result, 'status': 'reset'}
    previous_velocity = (previous[field] - earlier[field]) / (previous['_day'] - earlier['_day']).days
    velocity = result['velocity']
    result['acceleration'] = velocity - previous_velocity
    # log(a)-log(b) remains finite for very large valid counters.
    relative = max(0, math.log1p(velocity) - math.log1p(previous_velocity))
    result['score'] = round(min(100, 15 * math.log1p(velocity) + 15 * relative), 1)
    result['status'] = 'ready'
    return result


def product_metrics(rows, category_id='', days=7):
    """All latest unique products using the same filters as build_analytics."""
    days = _bounded_integer(days, 7, 1, 3650)
    window, _, _ = _window(_normalise(rows), days)
    return _latest_products([row for row in window if not category_id or row['category_id'] == str(category_id)])


latest_product_rows = product_metrics


def _latest_at(products):
    stamps = [(stamp, row['collected_at']) for row in products if (stamp := _timestamp(row.get('collected_at')))]
    return max(stamps)[1] if stamps else None


def _aggregate(products):
    prices = [row['price'] for row in products if row['price'] is not None]
    return {
        'product_count': len(products), 'shop_count': len({row['shop_id'] for row in products}),
        'price_min': min(prices) if prices else None, 'price_median': _median(prices), 'price_max': max(prices) if prices else None,
        'sold_total': _sum(row['sold_total'] for row in products),
        'sold_known': sum(row['sold_total'] is not None for row in products),
        'approx_count': sum(row['sold_total'] is not None and row['sold_approx'] for row in products),
    }


def _rank(product):
    return (product['sold_total'] is not None, product['sold_total'] or 0,
            product['review_count'] is not None, product['review_count'] or 0,
            product['rating'] or 0, product['sku'])


def _price_bands(products):
    prices = [row['price'] for row in products if row['price'] is not None]
    if not prices:
        return [{'label': f'Khoảng giá {index + 1}', 'min': None, 'max': None, 'count': 0} for index in range(4)]
    low, high = min(prices), max(prices)
    if low == high:
        low, high = 0, high * 2 if high else 4
        if not math.isfinite(high):
            high = max(prices)
    width = (high - low) / 4
    bands = []
    money = lambda number: f'{number:,.0f}'.replace(',', '.')
    for index in range(4):
        lower = low + width * index
        upper = high if index == 3 else low + width * (index + 1)
        bands.append({'label': f'{money(lower)}–{money(upper)} ₫', 'min': lower, 'max': upper,
                      'count': sum(lower <= value <= upper if index == 3 else lower <= value < upper for value in prices)})
    return bands


def build_analytics(rows, categories, runs, category_id='', days=7, limit=20, all_rows=False):
    days = _bounded_integer(days, 7, 1, 3650)
    limit = None if all_rows else _bounded_integer(limit, 20, 1, 100)
    category_id = str(category_id or '')
    normalised = _normalise(rows)
    window, start, end = _window(normalised, days)
    catalog = {str(row['id']): {'id': str(row['id']), 'name': _text(row.get('name')) or 'Chưa phân loại', 'url': row.get('url')}
               for source in categories for row in [dict(source)]}
    for row in normalised:
        catalog.setdefault(row['category_id'], {'id': row['category_id'], 'name': row['category'] or 'Chưa phân loại', 'url': None})
        row['category'] = row['category'] or catalog[row['category_id']]['name']
    selected = [row for row in window if not category_id or row['category_id'] == category_id]
    daily = _daily_unique(selected)
    products = _latest_products(selected)
    category_values = []
    for cid, metadata in catalog.items():
        members = _latest_products([row for row in window if row['category_id'] == cid])
        category_values.append({**metadata, **_aggregate(members)})
    category_values.sort(key=lambda row: (-row['product_count'], row['name'], row['id']))
    shops = defaultdict(list)
    for product in products:
        shops[product['shop_id']].append(product)
    shop_values = []
    for shop_id, members in shops.items():
        representative = max(members, key=lambda row: (row['day'], row['collected_at'] or '', row['shop_name'] != f'Shop #{shop_id}'))
        shop_values.append({'shop_id': shop_id, 'shop_name': representative['shop_name'], 'shop_url': representative['shop_url'],
                            'name': representative['shop_name'], 'url': representative['shop_url'],
                            'product_count': len(members), 'sold_total': _sum(row['sold_total'] for row in members),
                            'sold_known': sum(row['sold_total'] is not None for row in members),
                            'approx_count': sum(row['sold_total'] is not None and row['sold_approx'] for row in members),
                            'review_count': _sum(row['review_count'] for row in members),
                            'review_known': sum(row['review_count'] is not None for row in members),
                            'review_approx_count': sum(row['review_count'] is not None and row['review_approx'] for row in members),
                            'price_median': _median(row['price'] for row in members), 'latest_at': _latest_at(members)})
    shop_values.sort(key=lambda row: (row['sold_total'] is not None, row['sold_total'] or 0, row['product_count'], row['shop_id']), reverse=True)
    history = []
    for day in sorted({row['day'] for row in daily}):
        members = [row for row in daily if row['day'] == day]
        history.append({'day': day, 'product_count': len(members), 'sold_known': sum(row['sold_total'] is not None for row in members),
                        'exact_count': sum(row['sold_total'] is not None and not row['sold_approx'] for row in members)})
    selected_runs = [dict(row) for row in runs if not category_id or str(row['category_id']) == category_id]
    coverage = {'runs': len(selected_runs), **{status: sum(row.get('status') == status for row in selected_runs)
                                             for status in ('pending', 'paused', 'done', 'partial')}}
    for key in ('discovered', 'completed'):
        coverage[key] = sum(_bounded_integer(row.get(key), 0, 0, 10 ** 12) for row in selected_runs)
    trend_velocity = lambda row: row['review_velocity'] if row['trend_basis'] == 'reviews' else row['velocity']
    trend_acceleration = lambda row: row['review_acceleration'] if row['trend_basis'] == 'reviews' else row['acceleration']
    trends = [row for row in products if row['trend_score'] is not None and trend_velocity(row) > 0]
    trends.sort(key=lambda row: (row['trend_score'], trend_velocity(row), trend_acceleration(row), row['sku']), reverse=True)
    return {
        'filters': {'category_id': category_id, 'days': days},
        'basis': {'sales': 'public_cumulative', 'sales_label': 'Số bán cộng dồn công khai; gồm giá trị làm tròn hoặc cận dưới',
                  'trend': 'observed_exact_deltas', 'trend_label': 'Xu hướng từ số bán hoặc lượt đánh giá chính xác theo ngày; không phải dự báo',
                  'review_growth_label': 'Tăng lượt đánh giá quan sát; không phải số bán hay dự báo',
                  'ranking': 'sold_total', 'categories_scope': 'all_categories_in_time_window',
                  'window_start': start.isoformat() if start else None, 'window_end': end.isoformat() if end else None},
        'summary': {'product_count': len(products), 'shop_count': len(shops),
                    'category_count': len({row['category_id'] for row in selected}), 'catalog_category_count': len(catalog),
                    'snapshot_count': len(daily), 'day_count': len(history),
                    'exact_sales_count': sum(row['sold_total'] is not None and not row['sold_approx'] for row in products),
                    'approx_sales_count': sum(row['sold_total'] is not None and row['sold_approx'] for row in products),
                    'latest_at': _latest_at(products), 'history_ready_count': sum(row['trend_score'] is not None for row in products)},
        'categories': category_values, 'top_products': sorted(products, key=_rank, reverse=True)[:limit],
        'top_shops': shop_values[:limit], 'price_bands': _price_bands(products),
        'trend_candidates': trends[:limit], 'history': history, 'coverage': coverage,
    }
