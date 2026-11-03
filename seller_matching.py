"""Conservative equivalence checks for declared product specifications.

Related names/categories are discovery candidates, not proof that two SKUs have
the same brand, size or pack. Missing specifications always require review.
"""
import re
import math
import unicodedata


def normalized(value):
    text = unicodedata.normalize('NFD', str(value or '').lower().replace('đ', 'd'))
    return re.sub(r'\s+', ' ', ''.join(char for char in text if unicodedata.category(char) != 'Mn')).strip()


def specifications(product):
    aliases = {'brand': ('thuong hieu', 'brand'), 'material': ('chat lieu', 'material'),
               'size': ('kich thuoc', 'size'), 'capacity': ('dung tich', 'capacity', 'volume'),
               'pack': ('so luong trong goi', 'so luong trong combo', 'pack size', 'so luong'),
               'function': ('loai san pham', 'cong dung', 'product type'),
               'model': ('model', 'ma san pham', 'dong san pham')}
    result = {}
    detail = product.get('detail') or {}
    for item in detail.get('attributes') or []:
        if not isinstance(item, dict):
            continue
        name, value = normalized(item.get('name')), normalized(item.get('value'))
        for field, names in aliases.items():
            if value and name in names:
                result[field] = value
    title = normalized(product.get('name'))
    if 'capacity' not in result:
        found = re.findall(r'(?<!\w)(\d+(?:[.,]\d+)?)\s*(ml|lit|l)(?!\w)', title)
        if len(found) == 1:
            value, unit = found[0]
            result['capacity'] = f"{float(value.replace(',', '.')) * (1 if unit == 'ml' else 1000):g}ml"
    if 'pack' not in result:
        found = re.search(r'(?:combo|bo|set|goi)\s*(\d+)\s*(?:cai|chiec|mon|san pham)?', title)
        if found:
            result['pack'] = str(int(found[1]))
    if 'capacity' in result:
        match = re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*(ml|lit|l)', result['capacity'])
        if match:
            result['capacity'] = f"{float(match[1].replace(',', '.')) * (1 if match[2] == 'ml' else 1000):g}ml"
    if 'pack' in result:
        match = re.fullmatch(r'(\d+)\s*(?:cai|chiec|mon|san pham)?', result['pack'])
        if match:
            result['pack'] = str(int(match[1]))
    return result


def compare_equivalence(own, other):
    left, right = specifications(own), specifications(other)
    compared = {field: {'own': left.get(field), 'competitor': right.get(field)} for field in left.keys() | right.keys()}
    conflicts = [field for field in compared if left.get(field) and right.get(field) and left[field] != right[field]]
    missing = [field for field in ('brand', 'material', 'pack') if field not in left or field not in right]
    missing += [field for field in compared if not left.get(field) or not right.get(field)]
    dimensions = any(field in left and field in right for field in ('size', 'capacity'))
    if not dimensions:
        missing.append('size_or_capacity')
    categories = [normalized(item.get('category')) for item in (own, other)]
    same_category = bool(categories[0] and categories[0] == categories[1] and categories[0] not in ('khac', 'chua phan loai'))
    if not same_category:
        missing.append('matching_category')
    if not (left.get('function') and right.get('function')):
        ignored = set(normalized(' '.join((left.get('brand', ''), right.get('brand', ''), left.get('material', ''), right.get('material', '')))).split())
        ignored.update(('combo', 'bo', 'set', 'chinh', 'hang', 'cao', 'cap', 're', 'gia', 'ml', 'lit'))
        tokens = [set(re.findall(r'[a-z]{2,}', normalized(item.get('name')))) - ignored for item in (own, other)]
        common = tokens[0] & tokens[1]
        if len(common) < 2 or len(common) / max(1, len(tokens[0] | tokens[1])) < .35:
            missing.append('matching_function')
    status = 'different' if conflicts else 'review' if missing else 'equivalent'
    return {'status': status, 'comparable': status == 'equivalent', 'specifications': compared,
            'conflicts': conflicts, 'missing': sorted(set(missing)),
            'label': {'different': 'Khác quy cách', 'review': 'Cần đối chiếu quy cách', 'equivalent': 'Khớp quy cách đã ghi nhận'}[status],
            'reason': 'Không dùng tên giống nhau làm bằng chứng tương đương; chỉ so giá trực tiếp khi thông số đã ghi nhận khớp.'}


def competitor_reference(own, candidates):
    comparisons = [{**{key: item.get(key) for key in ('sku', 'name', 'source_shop', 'price', 'product_url', 'category')},
                    'equivalence': compare_equivalence(own, item)} for item in candidates
                   if normalized(own.get('category')) == normalized(item.get('category'))]
    matched = [item for item in comparisons if item['equivalence']['comparable']]
    prices = [item['price'] for item in matched if isinstance(item.get('price'), (int, float)) and
              not isinstance(item['price'], bool) and math.isfinite(item['price']) and item['price'] > 0]
    return {'count': len(matched), 'min': min(prices) if prices else None, 'max': max(prices) if prices else None,
            'review_count': sum(item['equivalence']['status'] == 'review' for item in comparisons),
            'different_count': sum(item['equivalence']['status'] == 'different' for item in comparisons),
            'candidates': sorted(comparisons, key=lambda item: not item['equivalence']['comparable'])[:20],
            'candidate_count': len(comparisons), 'candidates_truncated': len(comparisons) > 20,
            'basis': 'Chỉ các thông số đã ghi nhận khớp; giá cộng dồn toàn ngành không được dùng làm giá đối thủ tương đương.'}
