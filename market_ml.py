"""Learn category-specific product groups from real, current market snapshots.

The fitted model describes market position. It does not forecast future sales,
invent daily observations, or treat rounded public counters as exact growth.
Only the standard library is used so persisted JSON artifacts remain portable.
"""
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import date, datetime, timezone
import math
import random


SCHEMA_VERSION = 1
ALGORITHM = 'kmeans_standardized_log_features'
FEATURE_NAMES = ['log1p_price', 'log1p_sold_total', 'log1p_review_count', 'rating']
CORE_FIELDS = ('price', 'sold_total', 'review_count')
MIN_PRODUCTS = 20
MAX_ITERATIONS = 60


def _number(value, maximum=None):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) and result >= 0 and (maximum is None or result <= maximum) else None


def _median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else ordered[middle - 1] + (ordered[middle] - ordered[middle - 1]) / 2


def _mean(values):
    return sum(value / len(values) for value in values) if values else None


def _day(value):
    try:
        return date.fromisoformat(str(value)).isoformat()
    except (TypeError, ValueError):
        return ''


def _stamp(value):
    text = str(value or '')
    try:
        datetime.fromisoformat(text)
        return text
    except (TypeError, ValueError):
        return ''


def _latest_rows(rows):
    """Latest row wins, including when its metrics are missing; never backfill old sales."""
    latest = {}
    try:
        sources = iter(rows)
    except TypeError:
        return []
    for source in sources:
        try:
            item = dict(source)
        except (TypeError, ValueError):
            continue
        sku, category = item.get('sku'), item.get('category_id')
        if sku is None or category is None or not str(sku).strip() or not str(category).strip():
            continue
        item['sku'], item['category_id'] = str(sku).strip(), str(category).strip()
        item['day'] = _day(item.get('day'))
        item['collected_at'] = _stamp(item.get('collected_at'))
        for field in CORE_FIELDS:
            item[field] = _number(item.get(field))
        item['rating'] = _number(item.get('rating'), 5)
        item['sold_approx'] = item.get('sold_approx') in (True, 1, '1', 'true', 'True')
        item['_synthetic'] = item.get('is_demo') in (True, 1, '1', 'true', 'True') or str(item.get('data_origin', '')).lower() in ('demo', 'synthetic')
        key = (item['category_id'], item['sku'])
        rank = (item['day'], item['collected_at'])
        if key not in latest or rank > (latest[key]['day'], latest[key]['collected_at']):
            latest[key] = item
    return [latest[key] for key in sorted(latest)]


def _vector(row, imputers):
    values = []
    for field in CORE_FIELDS:
        value = row[field] if row[field] is not None else imputers[field]
        values.append(math.log1p(value))
    rating = (row['rating'] if row['rating'] is not None else imputers['rating']) if imputers['rating'] is not None else None
    values.append(rating if rating is not None else 0.0)
    return values


def _distance(left, right):
    return sum((a - b) ** 2 for a, b in zip(left, right))


def _nearest(vector, centroids):
    return min(range(len(centroids)), key=lambda index: (_distance(vector, centroids[index]), index))


def _kmeans(vectors, k):
    """Seeded KMeans++ initialization and bounded Lloyd updates."""
    rng = random.Random(0)
    centroids = [vectors[rng.randrange(len(vectors))][:]]
    while len(centroids) < k:
        distances = [min(_distance(vector, center) for center in centroids) for vector in vectors]
        total = sum(distances)
        if total <= 1e-12:
            break
        target = rng.random() * total
        cumulative = 0.0
        chosen = len(vectors) - 1
        for index, distance in enumerate(distances):
            cumulative += distance
            if distance > 0 and cumulative >= target:
                chosen = index
                break
        centroids.append(vectors[chosen][:])
    iterations = 0
    for iterations in range(1, MAX_ITERATIONS + 1):
        buckets = [[] for _ in centroids]
        for vector in vectors:
            buckets[_nearest(vector, centroids)].append(vector)
        # Remove an empty group rather than invent members or synthetic points.
        updated = [[_mean([v[j] for v in bucket]) for j in range(4)] for bucket in buckets if bucket]
        converged = len(updated) == len(centroids) and sum(_distance(a, b) for a, b in zip(updated, centroids)) <= 1e-10
        centroids = updated
        if converged:
            break
    return centroids, [_nearest(vector, centroids) for vector in vectors], iterations


def _percentile(value, reference):
    """Midrank empirical percentile: ties share a rank rather than gaining an arbitrary order."""
    return (bisect_left(reference, value) + bisect_right(reference, value)) / (2 * len(reference))


def _segment(center_rank, cluster_count):
    if cluster_count == 1:
        return 'Nhóm sản phẩm tương đồng'
    if center_rank >= 2 / 3:
        return 'Nhóm đã bán và đánh giá cao'
    if center_rank <= 1 / 3:
        return 'Nhóm ít lịch sử bán và đánh giá'
    return 'Nhóm bán và đánh giá trung bình'


def _fit_group(category_id, rows):
    imputers = {field: _median([row[field] for row in rows if row[field] is not None]) for field in (*CORE_FIELDS, 'rating')}
    vectors = [_vector(row, imputers) for row in rows]
    mean = [_mean([vector[j] for vector in vectors]) for j in range(4)]
    scale = [math.sqrt(_mean([(vector[j] - mean[j]) ** 2 for vector in vectors])) for j in range(4)]
    scale = [value if value > 1e-12 else 1.0 for value in scale]
    standardized = [[(value - mean[j]) / scale[j] for j, value in enumerate(vector)] for vector in vectors]
    k = min(4, max(2, len(rows) // MIN_PRODUCTS), len({tuple(v) for v in standardized}))
    centroids, labels, iterations = _kmeans(standardized, k)
    evidence = [(vector[1] + vector[2]) / 2 for vector in standardized]
    reference = sorted(evidence)
    # Give cluster identifiers a stable interpretation, ascending by learned demand.
    order = sorted(range(len(centroids)), key=lambda i: ((centroids[i][1] + centroids[i][2]) / 2, centroids[i][0], i))
    profiles = []
    for cluster_id, old_id in enumerate(order):
        indices = [i for i, label in enumerate(labels) if label == old_id]
        center_evidence = _mean([evidence[i] for i in indices])
        center_rank = _percentile(center_evidence, reference)
        profiles.append({
            'cluster_id': cluster_id, 'segment': _segment(center_rank, len(centroids)),
            'training_count': len(indices),
            'price_median': _median([rows[i]['price'] for i in indices]),
            'sold_total_median': _median([rows[i]['sold_total'] for i in indices]),
            'review_count_median': _median([rows[i]['review_count'] for i in indices]),
            'rating_median': _median([rows[i]['rating'] for i in indices if rows[i]['rating'] is not None]),
            'approximate_sold_count': sum(rows[i]['sold_approx'] for i in indices),
            'evidence_center': center_evidence, 'evidence_percentile': center_rank,
            'evidence_distribution': sorted(evidence[i] for i in indices),
        })
    return {
        'category_id': category_id, 'training_count': len(rows),
        'imputers': imputers, 'scaler': {'mean': mean, 'scale': scale},
        'centroids': [centroids[index] for index in order], 'cluster_profiles': profiles,
        'iterations': iterations, 'approximate_sold_count': sum(row['sold_approx'] for row in rows),
        'missing_rating_count': sum(row['rating'] is None for row in rows),
        'training_cutoff': max(row['collected_at'] or row['day'] for row in rows),
        'reference_evidence': reference,
    }


def train_market_model(rows):
    """Return a serializable artifact; insufficient categories are explicitly waiting.

    Core training measurements must all be observed. Public rounded counters are
    permitted for current position and counted in model metadata, never growth.
    """
    latest = _latest_rows(rows)
    grouped = defaultdict(list)
    for row in latest:
        grouped[row['category_id']].append(row)
    artifact = {
        'schema_version': SCHEMA_VERSION, 'algorithm': ALGORITHM, 'status': 'waiting',
        'trained_at': datetime.now(timezone.utc).isoformat(), 'training_cutoff': None,
        'training_product_count': 0, 'training_observation_count': 0,
        'feature_names': FEATURE_NAMES[:], 'minimum_products_per_category': MIN_PRODUCTS,
        'score_interpretation': 'Vị thế đã bán và đánh giá trong dữ liệu đã thu thập; không phải xác suất hay dự báo tương lai.',
        'score_method': 'Mean of the empirical rank of learned cluster evidence and within-cluster evidence rank, scaled to 0–100.',
        'groups': [], 'waiting_groups': [],
    }
    trained_skus = set()
    for category_id in sorted(grouped):
        eligible = [row for row in grouped[category_id] if row['day'] and not row['_synthetic'] and all(row[field] is not None for field in CORE_FIELDS)]
        if len(eligible) < MIN_PRODUCTS:
            artifact['waiting_groups'].append({'category_id': category_id, 'available_product_count': len(grouped[category_id]),
                'eligible_product_count': len(eligible), 'minimum_products': MIN_PRODUCTS,
                'reason': 'Cần ít nhất 20 sản phẩm duy nhất có giá, số đã bán và lượng đánh giá hợp lệ trong ngành hàng.'})
            continue
        artifact['groups'].append(_fit_group(category_id, eligible))
        trained_skus.update(row['sku'] for row in eligible)
        artifact['training_observation_count'] += len(eligible)
    artifact['training_product_count'] = len(trained_skus)
    if artifact['groups']:
        artifact['status'] = 'trained'
        artifact['training_cutoff'] = max(group['training_cutoff'] for group in artifact['groups'])
        artifact['reason'] = f"Đã học từ {len(trained_skus)} sản phẩm của {len(artifact['groups'])} ngành hàng; chỉ mô tả vị thế hiện tại."
    else:
        artifact['reason'] = 'Chưa đủ dữ liệu thực: mỗi ngành cần ít nhất 20 sản phẩm có giá, số đã bán và lượng đánh giá.'
    return artifact


def _waiting(reason, category_id):
    return {'status': 'waiting', 'cluster_id': None, 'segment': None, 'ml_signal_score': None,
            'reason': reason, 'model_scope': category_id, 'imputed_fields': []}


def _valid_group(group):
    try:
        count = group['training_count']
        means, scales = group['scaler']['mean'], group['scaler']['scale']
        centroids, profiles = group['centroids'], group['cluster_profiles']
        numeric = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        if not isinstance(count, int) or count < MIN_PRODUCTS or not all(isinstance(value, list) for value in (means, scales, centroids, profiles)) or len(means) != 4 or len(scales) != 4 or not 1 <= len(centroids) <= 4 or len(profiles) != len(centroids):
            return False
        if not all(numeric(v) for v in means) or not all(numeric(v) and v > 0 for v in scales):
            return False
        if any(not isinstance(center, list) or len(center) != 4 or not all(numeric(v) for v in center) for center in centroids):
            return False
        if any(not numeric(group['imputers'][field]) or _number(group['imputers'][field]) is None for field in CORE_FIELDS):
            return False
        if group['imputers']['rating'] is not None and (not numeric(group['imputers']['rating']) or _number(group['imputers']['rating'], 5) is None):
            return False
        if not _stamp(group['training_cutoff']):
            return False
        for index, profile in enumerate(profiles):
            reference = profile['evidence_distribution']
            if profile['cluster_id'] != index or not isinstance(reference, list) or not reference or not all(numeric(v) for v in reference):
                return False
            if reference != sorted(reference) or not numeric(profile['evidence_percentile']) or not 0 <= profile['evidence_percentile'] <= 1 or not isinstance(profile['segment'], str) or not isinstance(profile['training_count'], int):
                return False
        return True
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def score_market_model(artifact, rows):
    """Assign current products using frozen parameters, including after JSON reload."""
    latest = _latest_rows(rows)
    # The public contract maps SKU to one score; prefer its most recent category
    # when the same product appears in more than one category catalogue.
    by_sku = {}
    for row in sorted(latest, key=lambda r: (r['day'], r['collected_at'], r['category_id'])):
        by_sku[row['sku']] = row
    if not isinstance(artifact, dict) or artifact.get('schema_version') != SCHEMA_VERSION or artifact.get('algorithm') != ALGORITHM or artifact.get('feature_names') != FEATURE_NAMES or artifact.get('status') != 'trained':
        return {sku: _waiting('Chưa có mô hình ngành hàng hợp lệ; cần thu thập đủ dữ liệu và huấn luyện.', row['category_id']) for sku, row in by_sku.items()}
    raw_groups = artifact.get('groups')
    groups = {str(group.get('category_id')): group for group in raw_groups if isinstance(group, dict)} if isinstance(raw_groups, list) else {}
    result = {}
    for sku, row in by_sku.items():
        category_id = row['category_id']
        group = groups.get(category_id)
        if row['_synthetic']:
            result[sku] = _waiting('Dữ liệu demo hoặc tổng hợp không được dùng để suy luận thị trường.', category_id)
            continue
        if not group or not _valid_group(group):
            result[sku] = _waiting('Ngành hàng chưa có mô hình đủ dữ liệu; cần ít nhất 20 sản phẩm hợp lệ để huấn luyện.', category_id)
            continue
        missing = [field for field in CORE_FIELDS if row[field] is None]
        if len(missing) > 1:
            result[sku] = _waiting('Thiếu quá nhiều giá trị quan sát; không tính điểm bằng dữ liệu thay thế.', category_id)
            continue
        vector = _vector(row, group['imputers'])
        standardized = [(value - group['scaler']['mean'][j]) / group['scaler']['scale'][j] for j, value in enumerate(vector)]
        cluster_id = _nearest(standardized, group['centroids'])
        profile = group['cluster_profiles'][cluster_id]
        evidence = (standardized[1] + standardized[2]) / 2
        within_rank = _percentile(evidence, profile['evidence_distribution'])
        score = round(50 * (profile['evidence_percentile'] + within_rank), 1)
        imputed = missing + (['rating'] if row['rating'] is None and group['imputers']['rating'] is not None else [])
        notes = [f"Nhóm học từ {profile['training_count']} sản phẩm; điểm mô tả vị thế đã bán/đánh giá, không dự báo doanh số."]
        if row['sold_approx']:
            notes.append('Số đã bán công khai đã làm tròn.')
        if imputed:
            notes.append('Dùng trung vị ngành cho trường thiếu: ' + ', '.join(imputed) + '; không thay đổi dữ liệu gốc.')
        if group['imputers']['rating'] is None:
            notes.append('Ngành hàng chưa có điểm sao; đặc trưng điểm sao được bỏ qua.')
        result[sku] = {'status': 'scored', 'cluster_id': cluster_id, 'segment': profile['segment'],
            'ml_signal_score': score, 'reason': ' '.join(notes), 'model_scope': category_id,
            'imputed_fields': imputed, 'training_cutoff': group['training_cutoff']}
    return result
