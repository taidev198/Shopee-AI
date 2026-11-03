"""Seller workspace calculations from saved product data and entered costs.

Health/priority scores are descriptive rules, not sales forecasts. Missing costs
remain visible; known-cost scenarios never become verified net profit.
"""
import math
import statistics
from collections import Counter


INPUT_FIELDS = ('unit_cost', 'platform_fee_pct', 'payment_fee_pct', 'tax_pct',
                'packaging_cost', 'shipping_cost', 'other_unit_cost', 'ad_cost_per_order',
                'ad_spend', 'orders_30d', 'visits_30d', 'ad_revenue', 'target_margin_pct', 'return_rate_pct',
                'ad_impressions', 'ad_clicks', 'ad_orders_30d')
COUNT_FIELDS = ('orders_30d', 'visits_30d', 'ad_impressions', 'ad_clicks', 'ad_orders_30d')
FEE_FIELDS = ('platform_fee_pct', 'payment_fee_pct', 'tax_pct')
FIXED_FIELDS = ('unit_cost', 'packaging_cost', 'shipping_cost', 'other_unit_cost', 'ad_cost_per_order')
COST_FIELDS = FEE_FIELDS + FIXED_FIELDS
SEGMENTS = {'chief': 'Sản phẩm chủ lực', 'growth': 'Ứng viên tăng trưởng',
            'low_margin': 'Lợi nhuận thấp', 'slow': 'Bán chậm', 'unknown': 'Chưa đủ dữ liệu phân nhóm'}


def _number(value, maximum=None):
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return value if math.isfinite(value) and value >= 0 and (maximum is None or value <= maximum) else None


def _round(value, digits=2):
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _total(values):
    known = [value for value in values if value is not None]
    try:
        return _round(math.fsum(known)) if known else None
    except OverflowError:
        return None


def _inputs(product, supplied):
    supplied = supplied if isinstance(supplied, dict) else {}
    values, invalid = {}, []
    for field in INPUT_FIELDS:
        raw = supplied.get(field)
        if raw is None:
            raw = product.get(field)
        if raw is None and field == 'unit_cost':
            raw = product.get('cost')
        values[field] = _number(raw, 100 if field.endswith('_pct') else None)
        if raw is not None and values[field] is None:
            invalid.append(field)
        if field in COUNT_FIELDS and values[field] is not None and not values[field].is_integer():
            values[field]=None
            invalid.append(field)
    basis = 'manual_per_order' if values['ad_cost_per_order'] is not None else None
    if values['ad_cost_per_order'] is None and values['ad_spend'] is not None:
        if values['orders_30d'] is not None and values['orders_30d'] > 0:
            values['ad_cost_per_order'] = values['ad_spend'] / values['orders_30d']
            basis = 'ad_spend_divided_by_successful_orders'
        elif values['ad_spend'] == 0:
            values['ad_cost_per_order'] = 0.0
            basis = 'reported_zero_ad_spend'
    values['ad_allocation_basis'] = basis
    values['invalid_fields'] = invalid
    return values


def optimize_price(product, inputs):
    values = _inputs(product, inputs)
    price = _number(product.get('price'))
    if price == 0:
        price = None
    missing = [field for field in COST_FIELDS if values[field] is None]
    required_missing = (['price'] if price is None else []) + [field for field in ('unit_cost','platform_fee_pct') if values[field] is None]
    fee_pct = math.fsum(values[field] for field in FEE_FIELDS if values[field] is not None)
    try:
        fixed_cost = math.fsum(values[field] for field in FIXED_FIELDS if values[field] is not None)
    except OverflowError:
        fixed_cost = None
    errors = []
    if values['invalid_fields']:
        errors.append('Giá trị nhập không hợp lệ: ' + ', '.join(values['invalid_fields']))
    if fixed_cost is None:
        errors.append('Tổng chi phí vượt phạm vi tính toán; cần kiểm tra dữ liệu nhập.')
    if fee_pct >= 100:
        errors.append('Tổng tỷ lệ phí và thuế phải nhỏ hơn 100% để tính giá hòa vốn.')
    target_margin = values['target_margin_pct']
    if target_margin is not None and fee_pct + target_margin >= 100:
        errors.append('Biên mục tiêu cộng tỷ lệ phí phải nhỏ hơn 100%; chưa có giá mục tiêu khả thi.')
    ready = not required_missing and fee_pct < 100 and fixed_cost is not None and not any(field in COST_FIELDS for field in values['invalid_fields'])
    complete = ready and not missing
    assumptions = ['Kịch bản chỉ tính các khoản đã nhập; khoản thiếu không được xác nhận là bằng 0.',
        'Chi phí và phân bổ quảng cáo cần cùng cơ sở một đơn vị SKU trong một đơn thành công.',
        'Chưa dự báo lượng đơn hoặc phản ứng chuyển đổi khi đổi giá; chưa mô hình hóa tổn thất đổi trả.']
    def scenario(key, label, sale_price):
        contribution = sale_price * (1 - fee_pct / 100) - fixed_cost if ready else None
        return {'key': key, 'label': label, 'price': sale_price,
                'price_change_pct': _round((sale_price / price - 1) * 100),
                'fee_amount': _round(sale_price * fee_pct / 100) if ready else None,
                'fixed_cost': _round(fixed_cost) if ready else None,
                'contribution': _round(contribution),
                'margin_pct': _round(100 * contribution / sale_price) if contribution is not None and sale_price > 0 else None,
                'cost_complete': complete, 'basis': 'entered_costs_only',
                'actual_profit': _round(contribution) if complete else None}
    scenarios = []
    if price is not None:
        rounding = 1000 if price >= 10000 else 1
        for key, label, change in [('lower','Giảm giá để kiểm chứng',-.1),('baseline','Giữ giá hiện tại',0),('higher','Tăng giá để kiểm chứng',.1)]:
            candidate = price if change == 0 else max(1, round(price * (1 + change) / rounding) * rounding)
            scenarios.append(scenario(key, label, candidate))
    baseline = next((row for row in scenarios if row['key'] == 'baseline'), {})
    break_even = fixed_cost / (1 - fee_pct / 100) if ready else None
    target_price = fixed_cost / (1 - (fee_pct + target_margin) / 100) if ready and target_margin is not None and fee_pct + target_margin < 100 else None
    pre_ad_complete = fixed_cost is not None and all(values[field] is not None for field in COST_FIELDS if field != 'ad_cost_per_order')
    before_ad = price * (1 - fee_pct / 100) - (fixed_cost - (values['ad_cost_per_order'] or 0)) if price is not None and pre_ad_complete and fee_pct < 100 else None
    return {'ready': ready, 'missing': required_missing + [field for field in missing if field not in required_missing],
            'invalid_fields': values['invalid_fields'], 'errors': errors, 'cost_complete': complete,
            'confidence': 'Tham khảo từ chi phí đã nhập' if complete else 'Tạm tính; còn khoản chi phí chưa có dữ liệu',
            'assumptions': assumptions, 'known_fee_pct': _round(fee_pct), 'known_fixed_cost': _round(fixed_cost),
            'ad_cost_per_order': _round(values['ad_cost_per_order']), 'ad_allocation_basis': values['ad_allocation_basis'],
            'contribution_per_order': baseline.get('contribution'), 'actual_profit': baseline.get('actual_profit'),
            'break_even_price': _round(break_even), 'target_price': _round(target_price),
            'max_discount_pct': _round(max(0, (price - break_even) / price * 100)) if price is not None and break_even is not None else None,
            'contribution_before_ads': _round(before_ad),
            'break_even_roas': _round(price / before_ad, 4) if before_ad is not None and before_ad > 0 else None,
            'break_even_acos_pct': _round(100 * before_ad / price) if before_ad is not None and before_ad > 0 else None,
            'scenarios': scenarios,
            'experiment': {'duration_days': 7, 'baseline_price': price,
                'metrics': ['orders_30d', 'conversion_pct', 'contribution_total', 'return_rate_pct'],
                'action': 'Ghi mức nền, thử một mức giá trong 7 ngày với cùng nguồn truy cập và điều kiện khuyến mãi; so sánh đơn thành công và tổng lãi đóng góp.',
                'stop': 'Dừng khi tổng lãi đóng góp hoặc chuyển đổi giảm vượt ngưỡng người bán đã cấu hình; chưa có ngưỡng thì cần cấu hình trước thử nghiệm.',
                'stop_threshold_configured': False,
                'interpretation': 'So sánh trước/sau chỉ mô tả biến động; cần nhóm đối chứng để kết luận tác động do thay đổi giá.'}}


def _metrics(product, inputs, optimizer):
    units = _number(product.get('units_30d'))
    revenue = _number(product.get('revenue_30d'))
    basis = 'reported' if revenue is not None else 'missing'
    if revenue is None and units is not None and _number(product.get('price')) is not None:
        revenue, basis = units * _number(product.get('price')), 'estimated_price_times_units'
    orders, visits = inputs['orders_30d'], inputs['visits_30d']
    conversion_basis = 'successful_orders_per_visit' if visits is not None else None
    if visits is None:
        visits = _number(product.get('views_30d'))
        conversion_basis = 'successful_orders_per_product_view' if visits is not None else None
    conversion = 100 * orders / visits if orders is not None and visits is not None and visits > 0 and orders <= visits else None
    spend, ad_revenue = inputs['ad_spend'], inputs['ad_revenue']
    detail = product.get('detail') if isinstance(product.get('detail'), dict) else {}
    impressions, clicks, ad_orders = (inputs[key] for key in ('ad_impressions', 'ad_clicks', 'ad_orders_30d'))
    ads_issues = []
    if impressions is not None and clicks is not None and clicks > impressions:
        ads_issues.append('Số lượt nhấp lớn hơn lượt hiển thị; cần đối soát cùng kỳ và cùng phạm vi quảng cáo.')
    if orders is not None and ad_orders is not None and ad_orders > orders:
        ads_issues.append('Đơn từ quảng cáo lớn hơn tổng đơn thành công; cần đối soát cách quy gán và cùng kỳ.')
    if clicks is not None and ad_orders is not None and ad_orders > clicks:
        ads_issues.append('Đơn được quy gán lớn hơn lượt nhấp; chưa tính chuyển đổi từ nhấp khi chưa đối soát cách quy gán.')
    return {'revenue_30d': _round(revenue), 'revenue_basis': basis,
        'units_30d': units, 'units_basis': product.get('units_basis') or ('reported_30d' if units is not None else 'missing'),
        'orders_30d': orders, 'visits_30d': visits, 'conversion_pct': _round(conversion),
        'conversion_basis': conversion_basis if conversion is not None else None,
        'sold_total': _number(product.get('sold_total')),
        'contribution_per_order': optimizer['contribution_per_order'], 'contribution_conditional': not optimizer['cost_complete'],
        'contribution_30d': _round(orders * optimizer['contribution_per_order']) if optimizer['cost_complete'] and orders is not None else None,
        'ad_spend': spend, 'ad_revenue': ad_revenue,
        'roas': _round(ad_revenue / spend, 4) if ad_revenue is not None and spend is not None and spend > 0 else None,
        'acos_pct': _round(100 * spend / ad_revenue) if spend is not None and ad_revenue is not None and ad_revenue > 0 else None,
        'break_even_roas': optimizer['break_even_roas'], 'break_even_acos_pct': optimizer['break_even_acos_pct'],
        'return_rate_pct': inputs['return_rate_pct'],
        'ad_impressions': impressions, 'ad_clicks': clicks, 'ad_orders_30d': ad_orders,
        'ad_ctr_pct': _round(100 * clicks / impressions) if impressions and clicks is not None and clicks <= impressions else None,
        'ad_cpc': _round(spend / clicks) if clicks and spend is not None else None,
        'ad_conversion_pct': _round(100 * ad_orders / clicks) if clicks and ad_orders is not None and ad_orders <= clicks else None,
        'ad_cpa': _round(spend / ad_orders) if ad_orders and spend is not None else None,
        'ads_data_issues': ads_issues,
        'review_count': _number(product.get('review_count')), 'rating': _number(product.get('rating'), 5),
        'image_count': len(detail['images']) if isinstance(detail.get('images'), list) else None,
        'title_length': len(str(product.get('name') or '')) or None,
        'description_length': len(str(detail.get('description') or '')) if 'description' in detail else None}


def _rank(value, reference):
    if value is None or len(reference) < 3:
        return None
    return 100 * (sum(item < value for item in reference) + .5 * sum(item == value for item in reference)) / len(reference)


def _content(product):
    detail = product.get('detail')
    if not isinstance(detail, dict) or not (detail.get('collected_at') or any(key in detail for key in ('images','description','attributes'))):
        return None, ['Chưa đọc được nội dung chi tiết sản phẩm']
    fields = {'tiêu đề': bool(detail.get('name') or product.get('name')), 'hình ảnh': bool(detail.get('images')),
              'mô tả': bool(str(detail.get('description') or '').strip()), 'thuộc tính': bool(detail.get('attributes'))}
    return 100 * sum(fields.values()) / len(fields), ['Thiếu ' + key for key,value in fields.items() if not value]


def _health(product, metrics, optimizer, sales_rank, conversion_rank):
    components, issues = {}, []
    content_score, content_issues = _content(product)
    if content_score is not None:
        components['content'] = content_score
    issues.extend(content_issues)
    if sales_rank is not None:
        components['sales_position'] = sales_rank
    if conversion_rank is not None:
        components['conversion_position'] = conversion_rank
    rating = _number(product.get('rating'), 5)
    if rating is not None and rating > 0:
        components['rating'] = 20 * rating
    if optimizer['cost_complete']:
        margin = next((x['margin_pct'] for x in optimizer['scenarios'] if x['key']=='baseline'), None)
        if margin is not None:
            target = product['inputs']['target_margin_pct']
            components['contribution'] = max(0, min(100, 100 * margin / target)) if target is not None and target > 0 else (100 if margin > 0 else 0)
    else:
        issues.append('Thiếu chi phí; chưa xác nhận lợi nhuận thực')
    if metrics['roas'] is not None and metrics['break_even_roas'] is not None:
        components['ads'] = min(100, 100 * metrics['roas'] / metrics['break_even_roas'])
        if metrics['roas'] < metrics['break_even_roas']:
            issues.append('ROAS thấp hơn mức hòa vốn theo chi phí đã nhập')
    if metrics['revenue_basis'] == 'missing':
        issues.append('Chưa có doanh thu 30 ngày; tổng đã bán không thay thế dữ liệu này')
    if metrics['conversion_pct'] is None:
        issues.append('Chưa đủ đơn thành công và lượt truy cập cùng kỳ để tính chuyển đổi')
    if metrics['return_rate_pct'] is not None and metrics['return_rate_pct'] > 0:
        issues.append('Cần đối soát nguyên nhân hoàn trả từ dữ liệu người bán')
    weights = {'content':.15,'sales_position':.15,'conversion_position':.15,'rating':.10,'contribution':.30,'ads':.15}
    coverage = sum(weights[key] for key in components)
    score = sum(value * weights[key] for key,value in components.items()) / coverage if len(components)>=2 and coverage>=.25 else None
    return {'score': _round(score,1), 'confidence': 'Tham khảo; không phải dự báo doanh số' if score is not None else 'Chưa đủ dữ liệu',
        'coverage': {'known':len(components),'total':6,'pct':_round(100*coverage,1),'components':list(components)},
        'components': {key:_round(value,1) for key,value in components.items()}, 'issues': issues,
        'basis': 'Quy tắc mô tả từ chỉ số đã biết; thành phần thiếu không được coi là 0.',
        'sales_basis': metrics.get('sales_position_basis')}


def _segment(product, metrics, optimizer, sales_rank, conversion_rank):
    margin = next((row['margin_pct'] for row in optimizer['scenarios'] if row['key']=='baseline'), None)
    target = product['inputs']['target_margin_pct']
    if optimizer['cost_complete'] and margin is not None and (margin <= 0 or target is not None and margin < target):
        return 'low_margin', 'Biên đóng góp không dương hoặc thấp hơn mục tiêu người bán đã nhập.'
    if sales_rank is not None and sales_rank >= 75:
        if metrics['units_30d'] is not None and metrics['units_basis'] == 'estimated_snapshot_delta':
            return 'chief', 'Nhóm sản lượng 30 ngày cao theo ước tính từ chênh lệch số đã bán; phân nhóm tham khảo, cần đối soát báo cáo cùng kỳ.'
        return 'chief', ('Nhóm sản lượng 30 ngày cao trong danh mục đã có dữ liệu.' if metrics['units_30d'] is not None else
                         'Nhóm tổng đã bán tích lũy cao; phân nhóm tạm thời, chưa xác nhận sản lượng hiện tại.')
    if metrics['units_30d'] == 0 or metrics['units_30d'] is not None and sales_rank is not None and sales_rank <= 25 or metrics['visits_30d'] is not None and metrics['visits_30d'] > 0 and metrics['orders_30d'] == 0:
        if metrics['units_30d'] is not None and metrics['units_basis'] == 'estimated_snapshot_delta':
            return 'slow', 'Có số bán 30 ngày ước tính từ chênh lệch số đã bán; sản lượng thấp hoặc có lượt truy cập nhưng chưa ghi nhận đơn thành công. Phân nhóm tham khảo, cần đối soát báo cáo cùng kỳ.'
        return 'slow', 'Sản lượng cùng kỳ thấp hoặc có lượt truy cập nhưng chưa ghi nhận đơn thành công.'
    if conversion_rank is not None and conversion_rank >= 50 and optimizer['cost_complete'] and margin is not None and margin > 0:
        return 'growth', 'Chuyển đổi tương đối tốt trong cùng ngành và biên đóng góp dương; ứng viên thử nghiệm, chưa dự báo tăng trưởng.'
    return 'unknown', 'Cần thêm chi phí, đơn thành công hoặc chỉ số cùng kỳ trước khi phân nhóm.'


def _strategy(key, sku, title, body, evidence, action, stop, confidence, impact, urgency, effort):
    return {'key':key,'sku':sku,'title':title,'body':body,'evidence':evidence,'action':action,'stop':stop,
        'confidence':confidence,'confidence_label':'Tham khảo từ dữ liệu đã ghi nhận',
        'impact':impact,'urgency':urgency,'effort':effort,'priority':_round(impact*confidence*urgency/effort,2)}


def _strategies(products):
    strategies = []
    incomplete = [p for p in products if not p['optimizer']['cost_complete']]
    if incomplete:
        counts=Counter(field for p in incomplete for field in p['optimizer']['missing'])
        strategies.append(_strategy('shop:complete-costs',None,f'Đối soát chi phí cho {len(incomplete)} SKU',
            'Chưa đủ cơ sở xác nhận lợi nhuận hoặc giá sàn của các SKU này.',
            [f'{field}: thiếu ở {count} SKU' for field,count in counts.most_common(5)],
            'Nhập giá vốn, từng loại phí và phân bổ quảng cáo; chỉ nhập 0 khi đã xác nhận khoản đó không phát sinh.',
            'Chưa áp dụng quyết định giá dựa trên lợi nhuận cho đến khi hoàn tất đối soát.',1,5,5,2))
    if products and any(p['metrics']['revenue_basis']=='missing' for p in products):
        count=sum(p['metrics']['revenue_basis']=='missing' for p in products)
        strategies.append(_strategy('shop:monthly-data',None,'Bổ sung báo cáo bán hàng cùng kỳ',
            'Số đã bán tích lũy chưa cho biết doanh thu hoặc nhịp bán hiện tại.',[f'{count} SKU thiếu doanh thu 30 ngày'],
            'Nhập doanh thu, số đơn thành công và lượt truy cập trong cùng khoảng 30 ngày.',
            'Không suy diễn doanh thu 30 ngày từ tổng đã bán.',1,4,4,2))
    for product in products:
        sku,name=product['sku'],product['name'];metrics=product['metrics'];optimizer=product['optimizer']
        contribution=metrics['contribution_per_order']
        if contribution is not None and contribution <= 0:
            strategies.append(_strategy(f'{sku}:loss',sku,f'Kiểm tra lãi đóng góp của {name}',
                'Ngay cả trong phạm vi khoản chi đã nhập, lãi đóng góp chưa dương.',[f'Lãi đóng góp tạm tính/đơn: {contribution:,.0f} ₫'],
                'Đối soát giá vốn và biểu phí, sau đó xem kịch bản giá hoặc chi phí thay thế; chưa tự thay giá trên Shopee.',
                'Dừng mở rộng khuyến mãi khi lãi đóng góp vẫn không dương.',.9 if optimizer['cost_complete'] else .7,5,5,1))
        if metrics['roas'] is not None and metrics['break_even_roas'] is not None and metrics['roas']<metrics['break_even_roas']:
            strategies.append(_strategy(f'{sku}:ads',sku,f'Đối soát quảng cáo của {name}',
                'ROAS ghi nhận thấp hơn điểm hòa vốn theo chi phí trước quảng cáo đã nhập.',
                [f"ROAS: {metrics['roas']}; hòa vốn: {metrics['break_even_roas']}"],
                'Kiểm tra doanh thu được quy gán và nhóm quảng cáo; thử điều chỉnh ngân sách có theo dõi cùng kỳ.',
                'Dừng thử nghiệm nếu tổng lãi đóng góp tiếp tục giảm vượt ngưỡng đã cấu hình.',.9,5,4,2))
        if product['segment'] in ('low_margin','growth','chief') and optimizer['ready']:
            strategies.append(_strategy(f'{sku}:price-test',sku,f'Thử nghiệm giá cho {name}',
                'Kịch bản thay đổi lãi mỗi đơn khi giữ chi phí đã nhập; chưa biết tác động đến số đơn.',
                [product['segment_reason'],f"Giá hiện tại: {product.get('price')} ₫",f"Giá hòa vốn trong phạm vi đã nhập: {optimizer['break_even_price']} ₫"],
                optimizer['experiment']['action'],optimizer['experiment']['stop'],.6,4,3,3))
        content_score,content_issues=_content(product)
        if content_issues:
            strategies.append(_strategy(f'{sku}:content',sku,f'Kiểm tra nội dung {name}',
                'Nội dung được ghi nhận còn thiếu; cần kiểm tra trước khi kết luận chất lượng listing.',content_issues,
                'Đọc lại trang chi tiết; nếu xác nhận thiếu, bổ sung ảnh, mô tả hoặc thuộc tính rồi thử nghiệm với mức nền đã lưu.',
                'Không kết luận thay đổi nội dung gây tăng doanh số nếu chưa có đối chứng.',.8 if content_score is not None else .5,3,2,2))
        if product['segment']=='slow':
            strategies.append(_strategy(f'{sku}:slow',sku,f'Tìm nguyên nhân bán chậm: {name}',product['segment_reason'],
                [f"Sản lượng 30 ngày: {metrics['units_30d']}",f"Đơn thành công: {metrics['orders_30d']}; lượt truy cập: {metrics['visits_30d']}"],
                'Kiểm tra tồn kho, nguồn truy cập và nội dung; chọn một yếu tố để thử trong cùng điều kiện so sánh.',
                'Dừng mở rộng khi chưa xác nhận lãi đóng góp hoặc chưa có dữ liệu đơn hàng hợp lệ.',.7,3,3,2))
    return sorted(strategies,key=lambda item:(-item['priority'],item['key']))


def _shop_priorities(strategies):
    selected, channels, skus = [], Counter(), Counter()
    for item in strategies:
        sku, channel = item.get('sku'), item.get('channel') or item['key'].rsplit(':', 1)[-1]
        urgent_loss = item['key'].endswith(':loss')
        if sku and not urgent_loss and (channels[channel] >= 2 or skus[sku] >= 2):
            continue
        selected.append(item)
        if sku:
            channels[channel] += 1
            skus[sku] += 1
        if len(selected) == 10:
            break
    return selected


def analyze_shop(report, inputs_by_sku):
    source=report.get('own_products') or report.get('products') or []
    inputs_by_sku=inputs_by_sku if isinstance(inputs_by_sku,dict) else {}
    unique={str(p['sku']):dict(p) for p in source if isinstance(p,dict) and p.get('sku') is not None}
    products=[]
    for sku,product in unique.items():
        values=_inputs(product,inputs_by_sku.get(sku,{}));optimizer=optimize_price(product,inputs_by_sku.get(sku,{}))
        item={**product,'sku':sku,'name':str(product.get('name') or sku),'inputs':values,'optimizer':optimizer}
        item['metrics']=_metrics(product,values,optimizer);products.append(item)
    monthly=[p['metrics']['units_30d'] for p in products if p['metrics']['units_30d'] is not None]
    cumulative=[p['metrics']['sold_total'] for p in products if p['metrics']['sold_total'] is not None]
    for product in products:
        metrics=product['metrics'];sales_rank=_rank(metrics['units_30d'],monthly) if metrics['units_30d'] is not None else _rank(metrics['sold_total'],cumulative)
        metrics['sales_position_pct']=_round(sales_rank,1)
        metrics['sales_position_basis']=(metrics['units_basis'] if metrics['units_30d'] is not None else 'cumulative_sold_total') if sales_rank is not None else None
        peers=[p['metrics']['conversion_pct'] for p in products if p.get('category')==product.get('category') and p['metrics']['conversion_basis']==metrics['conversion_basis'] and p['metrics']['conversion_pct'] is not None]
        conversion_rank=_rank(metrics['conversion_pct'],peers)
        product['health']=_health(product,metrics,product['optimizer'],sales_rank,conversion_rank)
        segment,reason=_segment(product,metrics,product['optimizer'],sales_rank,conversion_rank)
        product.update(segment=segment,segment_label=SEGMENTS[segment],segment_reason=reason)
        if segment=='chief' and metrics['units_30d'] is None:
            product['segment_label']='Chủ lực tham khảo · theo tổng đã bán'
        elif segment in ('chief','slow') and metrics['units_30d'] is not None and metrics['units_basis']=='estimated_snapshot_delta':
            product['segment_label']=('Chủ lực' if segment=='chief' else 'Bán chậm')+' tham khảo · ước tính 30 ngày'
    coverage={key:sum(check(p) for p in products) for key,check in {
        'revenue':lambda p:p['metrics']['revenue_30d'] is not None,'units':lambda p:p['metrics']['units_30d'] is not None,
        'orders':lambda p:p['metrics']['orders_30d'] is not None,'cost_complete':lambda p:p['optimizer']['cost_complete'],
        'conversion':lambda p:p['metrics']['conversion_pct'] is not None,'ads':lambda p:p['metrics']['roas'] is not None}.items()}
    bases={p['metrics']['revenue_basis'] for p in products if p['metrics']['revenue_basis']!='missing'}
    summary={'product_count':len(products),'revenue_30d':_total(p['metrics']['revenue_30d'] for p in products),
        'revenue_basis':next(iter(bases)) if len(bases)==1 else 'mixed' if bases else 'missing',
        'units_30d':_total(p['metrics']['units_30d'] for p in products),'orders_30d':_total(p['metrics']['orders_30d'] for p in products),
        'contribution_30d':_total(p['metrics']['contribution_30d'] for p in products),
        'eligible_count':coverage['cost_complete'],'coverage':coverage,'segment_counts':dict(Counter(p['segment'] for p in products))}
    total_revenue=summary['revenue_30d']
    for product in products:
        revenue=product['metrics']['revenue_30d']
        product['metrics']['revenue_share_pct']=_round(100*revenue/total_revenue) if revenue is not None and total_revenue is not None and total_revenue>0 else None
    from seller_sales_strategy import build_sales_plan
    for product in products:
        peers = [item for item in products if item['sku'] != product['sku'] and
                 item.get('category') == product.get('category')]
        conversions = [item['metrics']['conversion_pct'] for item in peers
                       if item['metrics']['conversion_basis'] == product['metrics']['conversion_basis'] and
                       item['metrics']['conversion_pct'] is not None]
        reviews = [_number(item.get('review_count')) for item in peers]
        reviews = [value for value in reviews if value is not None]
        context = {'own_category_conversion_median': statistics.median(conversions) if conversions else None,
                   'own_category_conversion_sample': len(conversions),
                   'conversion_basis': product['metrics']['conversion_basis'],
                   'own_category_review_median': statistics.median(reviews) if reviews else None,
                   'own_category_review_sample': len(reviews)}
        product['sales_plan'] = build_sales_plan(product, product['metrics'], product['optimizer'], context)
    strategies = _strategies(products)
    # The shop overview is concise; each SKU retains its full plan for execution.
    strategies += [item for product in products for item in product['sales_plan']['strategies']]
    strategies = list({item['key']: item for item in strategies}.values())
    strategies.sort(key=lambda item: (-item['priority'], item['key']))
    scores=[p['health']['score'] for p in products if p['health']['score'] is not None]
    issues=list(dict.fromkeys(issue for p in products for issue in p['health']['issues']))
    health={'score':_round(math.fsum(scores)/len(scores),1) if scores else None,
        'confidence':'Tham khảo theo dữ liệu đã biết; không phải dự báo' if scores else 'Chưa đủ dữ liệu',
        'coverage':{'known':len(scores),'total':len(products),'pct':_round(100*len(scores)/len(products),1) if products else 0},
        'issues':issues[:5],'basis':'Trung bình các Product Health Score đủ chỉ số; không gán điểm 0 cho SKU thiếu dữ liệu.'}
    return {'summary':summary,'health':health,'products':products,'strategies':_shop_priorities(strategies),
            'strategies_available':strategies}
