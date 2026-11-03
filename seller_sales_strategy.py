"""Recorded-data sales diagnostics and experiments, without uplift predictions.

The 30 attributed-order gate is an operating rule, not statistical significance.
Image/video collection coverage never establishes visual quality or absence.
"""
import math
import re
import unicodedata
from collections import Counter
from urllib.parse import urlparse


AD_SCALE_ORDERS_MIN = 30
REVIEW_CHECK_COUNT = 10


def _number(value, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return value if math.isfinite(value) and value >= 0 and (maximum is None or value <= maximum) else None
    except OverflowError:
        return None


def _signed(value):
    try:
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None
    except OverflowError:
        return None


def _count(value):
    value = _number(value)
    return value if value is not None and int(value) == value else None


def _text(value, limit=500):
    return re.sub(r'\s+', ' ', value).strip()[:limit] if isinstance(value, str) else ''


def _normal(value):
    return ''.join(char for char in unicodedata.normalize('NFD', _text(value, 50000).lower().replace('đ', 'd'))
                   if unicodedata.category(char) != 'Mn')


def _money(value):
    return f'{value:,.0f}'.replace(',', '.') + ' ₫'


def _urls(value):
    result = set()
    for candidate in value if isinstance(value, list) else []:
        if not isinstance(candidate, str):
            continue
        try:
            parsed = urlparse(candidate)
            if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password:
                result.add(candidate)
        except ValueError:
            continue
    return result


def _strategy(sku, channel, status, title, body, evidence, steps, measurement, prerequisites,
              stop, confidence=.7, impact=3, urgency=3, effort=2):
    return {'key': f'{sku}:sales:{channel}', 'sku': sku, 'channel': channel, 'status': status,
            'title': title, 'body': body, 'evidence': evidence, 'action': '\n'.join(f'{index + 1}. {step}' for index, step in enumerate(steps)),
            'steps': steps, 'measurement': measurement, 'prerequisites': prerequisites, 'stop': stop,
            'confidence': confidence,
            'confidence_label': 'Độ chắc chắn của chẩn đoán quy tắc; không phải xác suất tăng doanh số',
            'impact': impact, 'urgency': urgency, 'effort': effort,
            'priority': round(impact * confidence * urgency / effort, 2)}


def build_sales_plan(product, metrics, optimizer, peer_context=None):
    product = product if isinstance(product, dict) else {}
    metrics = metrics if isinstance(metrics, dict) else {}
    optimizer = optimizer if isinstance(optimizer, dict) else {}
    peers = peer_context if isinstance(peer_context, dict) else {}
    detail = product.get('detail') if isinstance(product.get('detail'), dict) else {}
    sku = str(product.get('sku') or 'unidentified')
    name = _text(product.get('name')) or 'SKU đang phân tích'
    diagnosis, strategies = [], []
    captured = bool(detail.get('collected_at') or detail.get('status') == 'done')
    attributes = [item for item in detail.get('attributes', []) if isinstance(item, dict)] if isinstance(detail.get('attributes'), list) else []
    specification_aliases = {
        'material': {'chat lieu', 'material'},
        'dimension': {'kich thuoc', 'size', 'dimensions', 'dung tich', 'capacity', 'volume', 'trong luong', 'weight'},
        'function': {'cong dung', 'loai san pham', 'product type', 'function'},
        'brand': {'thuong hieu', 'brand'},
        'pack': {'so luong trong goi', 'so luong trong combo', 'pack size', 'so luong'},
    }
    specs = {}
    for item in attributes:
        for key, aliases in specification_aliases.items():
            value = _text(item.get('value'), 140)
            if _normal(item.get('name')) in aliases and value and _normal(value) not in ('no brand', 'khong thuong hieu', 'n/a'):
                specs[key] = value

    def diagnose(channel, label, status, evidence, missing=()):
        diagnosis.append({'channel': channel, 'label': label, 'status': status, 'evidence': evidence, 'missing': list(missing)})

    # Ads: do not infer ad orders from total orders, units, or cumulative sales.
    roas, break_even = _number(metrics.get('roas')), _number(metrics.get('break_even_roas'))
    contribution = _signed(metrics.get('contribution_per_order'))
    before_ads = _signed(optimizer.get('contribution_before_ads'))
    ad_orders = _count(metrics.get('ad_orders_30d'))
    clicks, impressions = _count(metrics.get('ad_clicks')), _count(metrics.get('ad_impressions'))
    spend = _number(metrics.get('ad_spend'))
    total_orders = _count(metrics.get('orders_30d'))
    data_issues = [_text(issue) for issue in metrics.get('ads_data_issues', []) if _text(issue)] if isinstance(metrics.get('ads_data_issues'), list) else []
    if clicks is not None and impressions is not None and clicks > impressions:
        data_issues.append('Số nhấp quảng cáo lớn hơn số lượt hiển thị')
    if ad_orders is not None and clicks is not None and ad_orders > clicks:
        data_issues.append('Đơn quy gán quảng cáo lớn hơn số nhấp trong cơ sở cùng kỳ')
    if ad_orders is not None and total_orders is not None and ad_orders > total_orders:
        data_issues.append('Đơn quy gán quảng cáo lớn hơn tổng đơn thành công cùng kỳ')
    ad_evidence = []
    for value, label in ((impressions, 'Lượt hiển thị quảng cáo'), (clicks, 'Lượt nhấp quảng cáo'), (ad_orders, 'Đơn thành công quy gán quảng cáo / 30 ngày')):
        if value is not None:
            ad_evidence.append(f'{label}: {value:g}')
    if roas is not None:
        ad_evidence.append(f'ROAS ghi nhận: {roas:g}')
    if break_even is not None:
        ad_evidence.append(f'ROAS hòa vốn theo chi phí đã nhập: {break_even:g}')
    if clicks is not None and impressions is not None and impressions > 0 and clicks <= impressions:
        ad_evidence.append(f'CTR tính từ dữ liệu nhập: {100 * clicks / impressions:.2f}%')
    if spend is not None and ad_orders is not None and ad_orders > 0:
        ad_evidence.append(f'CPA quy gán tính từ dữ liệu nhập: {_money(spend / ad_orders)} / đơn')
    ad_evidence += list(dict.fromkeys(data_issues))
    ad_missing = []
    if not optimizer.get('cost_complete'):
        ad_missing.append('Đối soát đủ chi phí một đơn thành công')
    if roas is None:
        ad_missing.append('ROAS từ chi quảng cáo và doanh thu quy gán cùng kỳ')
    if break_even is None:
        ad_missing.append('Điểm hòa vốn quảng cáo từ chi phí trước quảng cáo')
    if ad_orders is None:
        ad_missing.append('Số đơn thành công quy gán quảng cáo; không thay bằng tổng đã bán')
    if clicks is None or impressions is None:
        ad_missing.append('Lượt hiển thị và nhấp cùng kỳ để xác định chỗ rơi trong phễu')
    loss = not data_issues and ((optimizer.get('cost_complete') and contribution is not None and contribution <= 0) or
                               (roas is not None and break_even is not None and roas < break_even))
    scalable = not data_issues and bool(optimizer.get('cost_complete')) and contribution is not None and contribution > 0 and \
        roas is not None and break_even is not None and roas > break_even and before_ads is not None and before_ads > 0 and \
        ad_orders is not None and ad_orders >= AD_SCALE_ORDERS_MIN
    if data_issues:
        ad_status = 'unknown'
        title = f'Đối soát số liệu quảng cáo của {name}'
        body = 'Các số đếm quảng cáo chưa cùng cơ sở hoặc đang mâu thuẫn; chưa dùng để quyết định ngân sách.'
        steps = ['Xuất báo cáo cùng khoảng ngày và cùng cửa sổ quy gán.', 'Đối soát hiển thị, nhấp, đơn thành công và doanh thu quy gán của đúng SKU.', 'Tính lại ROAS, CPA và lãi đóng góp sau khi thống nhất cơ sở.']
    elif loss:
        ad_status = 'fix'
        title = f'Khoanh phần quảng cáo chưa hòa vốn của {name}'
        body = 'Lãi đóng góp chưa dương hoặc ROAS thấp hơn hòa vốn theo dữ liệu đã ghi nhận; chưa có cơ sở tăng ngân sách.'
        steps = ['Tách báo cáo từng nhóm quảng cáo trong cùng kỳ, kiểm tra đơn thành công và doanh thu quy gán.', 'Chọn một nhóm chưa hòa vốn để giảm hoặc dừng thử; giữ nguyên các nhóm khác làm mốc so sánh.', 'Đối soát giá vốn, chi phí và listing trước khi đưa phần ngân sách đó chạy lại.']
    elif scalable:
        ad_status = 'scale'
        title = f'Thử mở rộng có kiểm soát quảng cáo của {name}'
        body = 'Chi phí đã đủ, lãi mỗi đơn dương và ROAS cao hơn hòa vốn trong mẫu đơn quảng cáo đã ghi nhận. Đây là điều kiện thử, chưa bảo đảm hiệu quả khi tăng ngân sách.'
        ad_evidence.append(f'Ngưỡng vận hành: ít nhất {AD_SCALE_ORDERS_MIN} đơn quảng cáo cùng kỳ; không phải bằng chứng có ý nghĩa thống kê')
        ad_evidence.append(f'CPA hòa vốn lý thuyết: {_money(before_ads)} / đơn, theo lãi trước quảng cáo; cần đặt trần thử thấp hơn để còn lãi')
        steps = ['Chọn một nhóm quảng cáo đang có hiệu quả, ghi mức ngân sách, CPA, ROAS và tổng lãi nền.', 'Đặt mức ngân sách thử và trần CPA thấp hơn lãi đóng góp trước quảng cáo; giữ nguyên giá và nội dung.', 'Đánh giá sau kỳ thử 7 ngày hoặc khi đạt hạn mức chi đã đặt; mở rộng tiếp chỉ khi tổng lãi vẫn đáp ứng mục tiêu.']
    else:
        ad_status = 'unknown' if ad_missing else 'test'
        title = f'Đo phễu quảng cáo trước khi tăng chi cho {name}'
        body = 'Chưa đủ bằng chứng để mở rộng. Cần tách vấn đề hiển thị, nhấp và chuyển đổi thay vì chỉ nhìn ROAS hoặc số đã bán tích lũy.'
        if ad_orders is not None and ad_orders < AD_SCALE_ORDERS_MIN:
            ad_evidence.append(f'Mẫu {ad_orders:g} đơn quảng cáo còn dưới ngưỡng vận hành {AD_SCALE_ORDERS_MIN}; ngưỡng này không bảo đảm ý nghĩa thống kê')
        steps = ['Ghi hiển thị, nhấp, đơn thành công và doanh thu quy gán của đúng SKU trong cùng kỳ.', 'Đối soát đầy đủ chi phí; đặt hạn mức chi thử trước khi chạy.', 'Giữ ngân sách ổn định, thử một thay đổi listing hoặc nhóm tiếp cận rồi so CTR, chuyển đổi và tổng lãi.']
    diagnose('ads', 'Quảng cáo & phễu chuyển đổi', ad_status, ad_evidence, ad_missing)
    strategies.append(_strategy(sku, 'ads', ad_status, title, body, ad_evidence, steps,
        ['Lượt hiển thị, nhấp, CTR', 'Đơn thành công quy gán, CPA, ROAS cùng kỳ', 'Tổng lãi đóng góp và ngân sách đã chi'],
        ad_missing + ['Xác nhận cùng SKU, khoảng ngày và cơ sở quy gán; cấu hình hạn mức chi thử'],
        'Dừng mở rộng hoặc giảm phần thử khi CPA vượt trần đã cấu hình, ROAS xuống dưới hòa vốn, hoặc tổng lãi giảm vượt ngưỡng đã đặt.',
        confidence=.9 if loss else .65 if scalable else .8, impact=5, urgency=5 if loss else 4, effort=2))

    # Peer comparisons are only within the observed shop/category and same basis.
    conversion = _number(metrics.get('conversion_pct'), 100)
    peer_conversion = _number(peers.get('own_category_conversion_median'), 100)
    peer_sample = _count(peers.get('own_category_conversion_sample'))
    weak_conversion = conversion is not None and peer_conversion is not None and peer_sample is not None and peer_sample >= 5 and \
        metrics.get('conversion_basis') and peers.get('conversion_basis') == metrics.get('conversion_basis') and conversion < peer_conversion
    conversion_evidence = [f'Chuyển đổi ghi nhận {conversion:g}% thấp hơn trung vị {peer_conversion:g}% của {peer_sample:g} SKU cùng shop, cùng ngành và cùng cơ sở; không phải chuẩn toàn sàn'] if weak_conversion else []

    # Public rating aggregates are evidence of collected feedback, not sentiment.
    rating = _number(product.get('rating'), 5)
    reviews = _number(product.get('review_count'))
    review_text = _text(detail.get('review_count_text'))
    review_evidence = []
    if rating is not None:
        review_evidence.append(f'Điểm đánh giá ghi nhận: {rating:g}/5')
    if reviews is not None:
        suffix = ' (hiển thị làm tròn/cận dưới)' if re.search(r'\d[\d.,]*\s*[kKmM](?:\b|\+)|\+', review_text) else ''
        review_evidence.append(f'Lượt đánh giá ghi nhận: {reviews:g}{suffix}')
    peer_reviews = _number(peers.get('own_category_review_median'))
    review_sample = _count(peers.get('own_category_review_sample'))
    low_peer = reviews is not None and peer_reviews is not None and review_sample is not None and review_sample >= 5 and reviews < peer_reviews
    if low_peer:
        review_evidence.append(f'Trung vị {peer_reviews:g} lượt đánh giá trong {review_sample:g} SKU cùng shop/ngành; không phải đối thủ hay chuẩn toàn sàn')
    review_status = 'unknown' if rating is None or reviews is None else 'fix' if rating < 4 and reviews >= REVIEW_CHECK_COUNT else 'test'
    review_missing = ['Nội dung phản hồi và nguyên nhân hoàn trả từ báo cáo được cung cấp']
    if rating is None:
        review_missing.append('Điểm đánh giá đã ghi nhận')
    if reviews is None:
        review_missing.append('Số lượt đánh giá đã ghi nhận')
    diagnose('reviews', 'Đánh giá & niềm tin', review_status, review_evidence, review_missing)
    if review_status in ('unknown', 'fix') or reviews is not None and (reviews < REVIEW_CHECK_COUNT or low_peer):
        if review_status == 'fix':
            review_evidence.append('Mốc rà soát nội bộ: dưới 4/5 với ít nhất 10 lượt đánh giá; không suy đoán nguyên nhân từ điểm sao')
        strategies.append(_strategy(sku, 'reviews', review_status,
            f'Kiểm tra phản hồi và trải nghiệm thực nhận của {name}',
            'Điểm sao và số lượt phản hồi chưa cho biết nguyên nhân. Ưu tiên đọc phản hồi thực, chất lượng giao hàng và kỳ vọng do listing tạo ra.',
            review_evidence,
            ['Đối chiếu phản hồi và lý do hoàn trả được người bán cung cấp; nhóm vấn đề về quy cách, sử dụng và giao nhận.',
             'Chọn một vấn đề có bằng chứng để sửa ở nội dung hoặc khâu xử lý, ghi thời điểm và SKU liên quan.',
             'Sau khi giao thành công, mời khách phản hồi trung thực qua tính năng phù hợp của sàn; không mua/tạo đánh giá hoặc gắn ưu đãi với điểm sao.'],
            ['Số đánh giá mới và phân bố điểm nếu có dữ liệu', 'Tỷ lệ hoàn trả, vấn đề lặp lại và chuyển đổi cùng kỳ'],
            ['Có quyền sử dụng dữ liệu phản hồi/đơn hàng; chưa có nội dung thì chưa kết luận nguyên nhân'],
            'Dừng thông điệp hoặc thay đổi nếu phản hồi cho thấy mô tả sai, khiếu nại hoặc hoàn trả tăng; không dùng tăng điểm sao làm bằng chứng tăng đơn.',
            confidence=.85 if review_status == 'fix' else .6, impact=4, urgency=4 if review_status == 'fix' else 2, effort=2))

    images = _urls(detail.get('images'))
    image_known = captured or bool(images)
    image_evidence = [f'Đã ghi nhận {len(images)} URL ảnh khác nhau; số lượng không chứng minh độ rõ nét hoặc chất lượng ảnh'] if image_known else []
    image_status = 'unknown' if not image_known else 'fix' if not images else 'test'
    diagnose('images', 'Ảnh đại diện & ảnh giải thích', image_status, image_evidence,
             ['Chưa đánh giá trực quan độ rõ, bố cục, thông số và mức khớp với hàng giao'])
    if not image_known or len(images) < 3 or weak_conversion:
        strategies.append(_strategy(sku, 'images', image_status, f'Thử một ảnh giải thích rõ hơn cho {name}',
            'Độ phủ ảnh được thu thập chưa cho biết ảnh có trả lời đúng thắc mắc của khách hay không. Kiểm tra ảnh thật trước khi thay.',
            image_evidence + conversion_evidence,
            ['Mở listing thật, xác nhận ảnh đã được đọc đủ; kiểm tra ảnh chính có thể hiện đúng sản phẩm và số lượng combo.',
             'Tạo một phương án ảnh chính hoặc ảnh thông số từ thông tin đã xác nhận, thể hiện kích thước/chất liệu/cách dùng phù hợp.',
             'Chỉ đổi một ảnh, giữ tiêu đề, giá và nguồn truy cập ổn định trong kỳ thử.'],
            ['CTR nếu có cùng nguồn hiển thị', 'Đơn thành công/lượt truy cập cùng cơ sở', 'Phản hồi nhầm quy cách và tổng lãi'],
            ['Có ảnh và thông số sản phẩm đúng thực tế; không suy đoán chất lượng từ số URL ảnh'],
            'Dừng phương án nếu thông tin gây hiểu nhầm hoặc chuyển đổi/tổng lãi giảm vượt ngưỡng người bán đã đặt.',
            confidence=.65, impact=4 if weak_conversion else 3, urgency=3, effort=2))

    title_text = _text(detail.get('name') or product.get('name'), 500)
    title_evidence = [f'Tiêu đề ghi nhận: {title_text}'] if title_text else []
    spec_labels = {'material': 'Chất liệu', 'dimension': 'Kích thước/dung tích', 'function': 'Công dụng',
                   'brand': 'Thương hiệu', 'pack': 'Số lượng trong combo'}
    additions = [f'{spec_labels[key]}: {value}' for key, value in specs.items() if _normal(value) not in _normal(title_text)]
    title_tokens = re.findall(r'[a-z0-9]+', _normal(title_text))
    repeated = [phrase for phrase, count in Counter(' '.join(pair) for pair in zip(title_tokens, title_tokens[1:])).items()
                if count >= 2 and len(phrase) > 5][:3]
    if repeated:
        title_evidence.append('Cụm từ xuất hiện lặp để người bán rà soát: ' + '; '.join(repeated) + '; chưa phải điểm SEO')
    if len(title_text) > 120:
        title_evidence.append(f'Tiêu đề ghi nhận {len(title_text)} ký tự, vượt mốc rà soát nội bộ 120; đây không phải giới hạn chính thức của Shopee')
    title_status = 'unknown' if not title_text else 'test'
    diagnose('title', 'Tiêu đề & ý định tìm kiếm', title_status, title_evidence,
             [] if specs else ['Thông số đã xác nhận để phân biệt đúng SKU'])
    if not title_text or additions or weak_conversion or repeated or len(title_text) > 120 or len(title_text.split()) < 3:
        facts = '; '.join(additions[:3]) if additions else 'chưa có thông số được xác nhận để thêm vào tiêu đề'
        core = re.sub(r'^\[[^\]]+\]\s*', '', title_text)
        base_words, seen_words = [], set()
        for word in core.split():
            token = _normal(word).strip('.,;:|-/')
            if token and token not in seen_words:
                base_words.append(word.strip('.,;:|-/')); seen_words.add(token)
            if len(base_words) >= 6:
                break
        draft = ' '.join(base_words)
        draft_facts = [value for value in specs.values() if _normal(value) not in _normal(draft)][:3]
        if draft_facts:
            draft += ' – ' + ' – '.join(draft_facts)
        strategies.append(_strategy(sku, 'title', title_status, f'Kiểm chứng tiêu đề theo đúng quy cách của {name}',
            'Tên giống nhau hoặc nhiều từ khóa chưa chứng minh khả năng bán. Dùng công dụng và thông số đã ghi nhận để phân biệt đúng mặt hàng.',
            title_evidence + [f'Thông tin để đối chiếu: {facts}'] + conversion_evidence,
            ([f'Bản nháp cấu trúc cần người bán kiểm chứng: “{draft}”. Chỉ dùng từ đã ghi nhận, chưa tự xuất bản.'] if draft else []) +
            ['Giữ cụm tên sản phẩm chính; đối chiếu các thông số đã ghi nhận: ' + facts + '.',
             'Soạn một phương án tiêu đề rõ công dụng và quy cách, bỏ từ lặp hoặc khẳng định chưa có bằng chứng.',
             'Thử riêng tiêu đề trong 7 ngày; giữ ảnh, giá và quảng cáo ổn định, ghi mốc thay đổi.'],
            ['Hiển thị và CTR theo cùng nguồn nếu có dữ liệu', 'Chuyển đổi, đơn thành công và phản hồi về quy cách'],
            ['Người bán xác nhận thông số và tính phù hợp trước khi xuất bản; không tự thêm chứng nhận/thương hiệu'],
            'Dừng hoặc sửa nếu tiêu đề không khớp hàng giao, hút nhấp sai nhu cầu hoặc tổng lãi/chuyển đổi giảm vượt ngưỡng đã cấu hình.',
            confidence=.75 if specs else .5, impact=3, urgency=3, effort=2))

    description = _text(detail.get('description'), 50000)
    desc_known = captured or bool(description)
    desc_normal = _normal(description)
    gaps = []
    if 'dimension' not in specs and not re.search(r'\d+(?:[.,]\d+)?\s*(?:mm|cm|ml|lit|kg|g|m|l)\b', desc_normal):
        gaps.append('kích thước/dung tích nếu áp dụng')
    if 'material' not in specs and not re.search(r'\b(?:inox|thep|nhua|go|silicon|cotton|vai|steel|plastic|wood)\b', desc_normal):
        gaps.append('chất liệu nếu áp dụng')
    if 'function' not in specs and not re.search(r'\b(?:dung de|su dung|cach dung|cong dung|huong dan|use|usage)\b', desc_normal):
        gaps.append('công dụng/cách dùng')
    desc_evidence = [f'Đã ghi nhận {len(description)} ký tự mô tả; độ dài không phải điểm chất lượng'] if desc_known else []
    if gaps:
        desc_evidence.append('Chưa thấy bằng chứng rõ trong mô tả/thuộc tính: ' + ', '.join(gaps))
    desc_status = 'unknown' if not desc_known else 'fix' if not description else 'test'
    diagnose('description', 'Mô tả & thông số', desc_status, desc_evidence, gaps)
    if not desc_known or not description or gaps:
        strategies.append(_strategy(sku, 'description', desc_status, f'Làm rõ thông số và cách dùng của {name}',
            'Nội dung thiếu trong bản đọc có thể do thu thập chưa đủ. Xác nhận listing và thông số trước khi bổ sung; không tạo thông tin sản phẩm.',
            desc_evidence,
            ['Đối chiếu mô tả trên trang thật và tài liệu sản phẩm; xác nhận phần còn thiếu: ' + (', '.join(gaps) or 'nội dung mô tả đã ghi nhận') + '.',
             'Bổ sung một khối thông tin đã xác nhận về quy cách, chất liệu hoặc cách dùng phù hợp; nêu rõ nội dung trong combo.',
             'Giữ giá, tiêu đề và ảnh ổn định; ghi nhận mốc thay đổi, câu hỏi lặp lại và chuyển đổi.'],
            ['Câu hỏi lặp lại, phản hồi nhầm quy cách nếu được cung cấp', 'Đơn thành công/lượt truy cập, hoàn trả cùng kỳ'],
            ['Thông số có bằng chứng; bỏ qua trường không áp dụng, không tự tạo chứng nhận hoặc hướng dẫn chưa được xác nhận'],
            'Dừng nội dung có thông tin sai hoặc khi khiếu nại/hoàn trả tăng; chưa có dữ liệu thì chỉ ghi nhận thử nghiệm, không kết luận tăng trưởng.',
            confidence=.7 if desc_known else .5, impact=3, urgency=3, effort=2))

    videos = _urls(detail.get('videos'))
    video_observed = bool(videos) or detail.get('video_observed') is True or product.get('video_observed') is True
    video_evidence = [f'Đã ghi nhận {len(videos)} video trong lần kiểm tra có xác nhận'] if video_observed else [
        'Bộ thu thập hiện chưa xác nhận trường video; danh sách rỗng/thiếu không chứng minh listing không có video']
    video_status = 'test' if video_observed else 'unknown'
    diagnose('video', 'Video & minh họa sử dụng', video_status, video_evidence,
             [] if video_observed else ['Kiểm tra thủ công listing có video và nội dung video hiện tại'])
    if not video_observed or not videos or weak_conversion:
        strategies.append(_strategy(sku, 'video', video_status, f'Đối chiếu video và thử minh họa cách dùng {name}',
            'Chưa chấm chất lượng hoặc kết luận thiếu video từ dữ liệu thu thập. Video chỉ là phương án cần kiểm tra theo nhu cầu giải thích sản phẩm.',
            video_evidence + conversion_evidence,
            ['Mở listing, xác nhận đã có video hay chưa và video có khớp đúng biến thể/đơn vị bán không.',
             'Nếu cần thử, quay một tình huống sử dụng thật với cận cảnh quy cách và kết quả có thể kiểm chứng; không dùng lời hứa chưa có bằng chứng.',
             'Chỉ bổ sung hoặc thay video, giữ các yếu tố khác ổn định trong kỳ thử 7 ngày.'],
            ['Lượt xem/hoàn tất video nếu nguồn có cung cấp', 'Chuyển đổi, câu hỏi cách dùng và hoàn trả cùng kỳ'],
            ['Người bán kiểm tra video thực tế; có quyền sử dụng hình ảnh và xác nhận đúng thông số'],
            'Dừng video gây hiểu nhầm cách dùng hoặc khi phản hồi/hoàn trả tăng; không quy lượt xem video thành số đơn.',
            confidence=.5 if not video_observed else .65, impact=2, urgency=2, effort=3))

    strategies.sort(key=lambda row: (-row['priority'], row['channel']))
    first = strategies[0]['title'] if strategies else 'Tiếp tục ghi nhận dữ liệu cùng kỳ'
    summary = ('Có điều kiện thử mở rộng quảng cáo có kiểm soát; chưa dự báo tăng doanh số.' if scalable else
               'Ưu tiên đối soát phần chưa hòa vốn trước khi tăng ngân sách.' if loss else
               'Chưa đủ cơ sở mở rộng quảng cáo; ưu tiên dữ liệu phễu và một thay đổi listing có thể đo.')
    return {'summary': summary + ' Việc đầu tiên: ' + first + '.', 'diagnosis': diagnosis, 'strategies': strategies[:8]}
