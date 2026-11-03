"""Bounded commercial context for SKU-specific AI reasoning, never canned plans."""
import math
import re
import unicodedata


SALES_CHANNELS = ('ads', 'reviews', 'images', 'title', 'description', 'video',
                  'price', 'promotion', 'bundles', 'variants', 'service', 'positioning')

DIVERSITY_PROMPT = '''
Không dùng danh sách hành động cố định; thường 4–6 chiến lược, không thêm cho đủ số.
Cân nhắc 12 hướng ads, reviews, images, title, description, video, price, promotion, bundles, variants, service, positioning. Chọn hướng phù hợp với điểm nghẽn và dữ liệu SKU: tìm thấy → hiểu đúng → tin tưởng → chốt mua → giá trị đơn/mua lại. Không chỉ đổi tên cùng một việc.
Mỗi mục có priority_tier now/next/later theo thứ tự, hypothesis cần kiểm chứng, tradeoff, các bước thực hiện rõ ràng có thứ tự, cách đo trong cùng điều kiện và điều kiện dừng thay đổi đang thử. Không dừng chăm sóc khách vì khách không phản hồi. Không tự đặt ngưỡng tăng đơn hay gán CTR riêng từng ảnh nếu nguồn chưa hỗ trợ.
Đọc nguyên văn tên/mô tả trước khi đề nghị thêm từ khóa/thông số; đã có thì thử cách trình bày, không gọi là thiếu. Không gọi từ khóa là phổ biến khi chưa có dữ liệu. Bản nháp tiêu đề/mô tả không thêm combo, quà, chứng nhận hay đặc tính mới; ảnh/video là đề xuất sản xuất, không chứng minh cấp thép.
Khách mua kèm là giả thuyết, không phải hành vi đã biết. Giữ đúng SKU/tên ứng viên cùng shop; cùng ngành chưa chứng minh hợp combo. Mô tả/thuộc tính mâu thuẫn thì đối soát trước. Chi phí bất thường cần xác nhận đơn vị; không tự nhân1000. Lãi đóng góp dương chưa chứng minh lãi tốt. max_discount_pct là trần hòa vốn, không phải mức giảm khuyến nghị. Ưu tiên làm rõ cách bán và xác minh chi phí khi biên mỏng; thiếu chi phí chưa chốt ưu đãi.
'''


def _text(value, limit=300):
    return re.sub(r'\s+', ' ', value).strip()[:limit] if isinstance(value, str) else ''


def _number(value):
    try:
        return value if not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) else None
    except OverflowError:
        return None


def _strings(values, count, length):
    return [_text(value, length) for value in values[:count] if _text(value, length)] if isinstance(values, list) else []


def _variants(value):
    return [{'name': _text(group.get('name'), 100), 'options': _strings(group.get('options'), 12, 100)}
            for group in value[:6] if isinstance(group, dict)] if isinstance(value, list) else []


def _words(value):
    normalized = ''.join(char for char in unicodedata.normalize('NFD', _text(value, 500).lower().replace('đ', 'd'))
                         if unicodedata.category(char) != 'Mn')
    return set(re.findall(r'[a-z0-9]{2,}', normalized))


def enrich_fact_catalog(facts, product, analysis):
    """Add allowed source fields and same-shop candidates, without deciding tactics."""
    result = dict(facts)
    detail = product.get('detail') if isinstance(product.get('detail'), dict) else {}
    metrics = product.get('metrics') if isinstance(product.get('metrics'), dict) else {}
    optimizer = product.get('optimizer') if isinstance(product.get('optimizer'), dict) else {}
    health = product.get('health') if isinstance(product.get('health'), dict) else {}

    def add(key, label, value):
        result[key] = {'label': label, 'value': value}

    variants = _variants(detail.get('variants'))
    add('detail.variants', 'Phân loại và lựa chọn ghi nhận trên listing, chưa có doanh số từng phân loại', variants)
    add('detail.variant_status', 'Trạng thái quan sát phân loại; unknown không có nghĩa listing thiếu phân loại',
        'observed' if variants or detail.get('variants_observed') is True else 'unknown')
    add('detail.customer_feedback_status', 'Chưa thu thập nội dung phản hồi/tin nhắn khách; điểm sao không cho biết nhu cầu hay nguyên nhân', 'unknown')
    baseline = next((row for row in optimizer.get('scenarios', []) if isinstance(row, dict) and row.get('key') == 'baseline'), {})
    add('optimizer.baseline_margin_pct', 'Biên lãi đóng góp hiện tại do engine tính, có điều kiện theo độ đầy đủ chi phí', _number(baseline.get('margin_pct')))
    add('detail.categories', 'Đường dẫn ngành hàng ghi nhận', _strings(detail.get('categories'), 8, 140))
    add('product.stock', 'Số tồn hiển thị được ghi nhận; chưa đối soát tồn kho vận hành', _number(product.get('stock')))
    add('product.segment', 'Phân nhóm danh mục theo analytics; không phải dự báo',
        {'label': _text(product.get('segment_label'), 160), 'reason': _text(product.get('segment_reason'), 500)})
    add('product.health', 'Tín hiệu kiểm tra theo engine, không thay thế kiểm tra thực tế',
        {'score': _number(health.get('score')), 'issues': _strings(health.get('issues'), 6, 220)})
    for key, label in (
        ('max_discount_pct', 'Mức giảm tối đa có điều kiện theo chi phí đã khai báo; chưa gồm chi phí ưu đãi mới'),
        ('target_margin_pct', 'Biên đóng góp mục tiêu đã khai báo'),
    ):
        value = optimizer.get(key) if key != 'target_margin_pct' else (product.get('inputs') or {}).get(key)
        add('optimizer.' + key, label, _number(value))
    add('metrics.revenue_share_pct', 'Tỷ trọng doanh thu trong shop theo kỳ dữ liệu của engine', _number(metrics.get('revenue_share_pct')))

    shop_id = str((analysis.get('shop') or {}).get('id') or '')
    candidates = []
    words = _words(product.get('name'))
    products = analysis.get('products') if isinstance(analysis.get('products'), list) else []
    for peer in products:
        if (not isinstance(peer, dict) or str(peer.get('sku')) == str(product.get('sku'))
                or peer.get('role', 'own') != 'own' or peer.get('shop_id') not in (None, '', shop_id)
                or not product.get('category') or peer.get('category') != product.get('category')):
            continue
        candidates.append((len(words & _words(peer.get('name'))), {
            'sku': _text(str(peer.get('sku') or ''), 100), 'name': _text(peer.get('name'), 220),
            'category': _text(peer.get('category'), 140), 'price': _number(peer.get('price')),
        }))
    candidates.sort(key=lambda pair: (-pair[0], pair[1]['sku']))
    add('catalog.same_shop_candidates', 'SKU khác cùng shop/cùng ngành để cân nhắc bán kèm; chưa xác nhận hợp combo hay nhu cầu mua cùng',
        [row for _, row in candidates[:5]])
    return result
