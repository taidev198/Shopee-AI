"""Deterministic explanations generated from the current filtered analysis.

Templates describe measured evidence; product names, counts and conclusions are
selected from the database result, never from a hand-written market assessment.
"""


def _number(value):
    return f'{value:,.0f}'.replace(',', '.')


def build_insights(analysis):
    summary = analysis.get('summary', {})
    insights = []
    products = analysis.get('top_products', [])
    if products and products[0].get('sold_total') is not None:
        product = products[0]
        sold = ('≥ ' if product.get('sold_approx') else '') + _number(product['sold_total'])
        insights.append({'kind': 'leading_product', 'title': 'Sản phẩm dẫn đầu số đã bán trong mẫu',
                         'body': f"{product['name']}: {sold} đã bán cộng dồn. Xếp hạng trong {_number(summary.get('product_count', 0))} sản phẩm đã quan sát, không phải doanh số trong cửa sổ thời gian.",
                         'url': product.get('url'), 'evidence': {'sku': product['sku'], 'sold_total': product['sold_total'], 'approximate': bool(product.get('sold_approx'))}})
    bands = [band for band in analysis.get('price_bands', []) if band.get('count', 0) > 0]
    if bands:
        band = max(bands, key=lambda item: item['count'])
        total = sum(item['count'] for item in bands)
        insights.append({'kind': 'price_concentration', 'title': 'Khoảng giá xuất hiện nhiều nhất',
                         'body': f"{band['label']}: {_number(band['count'])}/{_number(total)} sản phẩm có giá ({band['count'] / total:.1%}). Đây là phân bố của mẫu đang lọc, chưa chứng minh mức giá nào dễ bán hơn.",
                         'evidence': {'label': band['label'], 'count': band['count'], 'priced_products': total}})
    trends = analysis.get('trend_candidates', [])
    if trends:
        product = trends[0]
        reviews = product.get('trend_basis') == 'reviews'
        velocity = product.get('review_velocity' if reviews else 'velocity')
        insights.append({'kind': 'observed_growth', 'title': 'Tín hiệu tăng trưởng đã quan sát',
                         'body': f"{product['name']}: {velocity:.2f} {'đánh giá' if reviews else 'sản phẩm bán'}/ngày theo các lần ghi nhận chính xác. Cần kiểm chứng thêm; đây là tăng trưởng quá khứ.",
                         'url': product.get('url'), 'evidence': {'sku': product['sku'], 'basis': product['trend_basis'], 'velocity': velocity}})
    else:
        insights.append({'kind': 'history_gap', 'title': 'Chưa đủ cơ sở xác định hot trend',
                         'body': f"Kho đang lọc có {_number(summary.get('day_count', 0))} ngày ghi nhận và {_number(summary.get('history_ready_count', 0))} sản phẩm đủ lịch sử. Hệ thống tự tính tăng trưởng khi có ít nhất 3 ngày với số bán hoặc lượt đánh giá chính xác.",
                         'evidence': {'day_count': summary.get('day_count', 0), 'history_ready_count': summary.get('history_ready_count', 0)}})
    model = analysis.get('model', {})
    if model.get('status') == 'trained':
        insights.append({'kind': 'learned_position', 'title': 'Kết quả mô hình đã học từ database',
                         'body': f"Đã học từ {_number(model.get('training_product_count', 0))} sản phẩm của {_number(model.get('groups_count', 0))} ngành, chấm được {_number(model.get('coverage_count', 0))} sản phẩm. Các nhóm và điểm vị thế được tính từ tham số đã học, không phải dự báo bán chạy.",
                         'evidence': {'model_id': model.get('model_id'), 'training_product_count': model.get('training_product_count', 0), 'coverage_count': model.get('coverage_count', 0)}})
    return insights
