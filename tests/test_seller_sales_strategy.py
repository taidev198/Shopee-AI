import copy
import json
import math

import pytest

from seller_sales_strategy import build_sales_plan, AD_SCALE_ORDERS_MIN


def product(**changes):
    return {'sku': '12.34', 'name': 'Rây lọc thực phẩm', 'category': 'Đồ gia dụng',
            'rating': 4.8, 'review_count': 25,
            'detail': {'status': 'done', 'collected_at': '2026-10-15T09:00:00+07:00',
                       'images': ['https://images.example/a.jpg'],
                       'description': 'Rây lọc dùng để lọc thực phẩm.',
                       'attributes': [{'name': 'Chất liệu', 'value': 'Inox 304'},
                                      {'name': 'Kích thước', 'value': '20 cm'}]}, **changes}


def metrics(**changes):
    return {'contribution_per_order': 22150, 'roas': 4, 'break_even_roas': 2.899,
            'ad_spend': 300000, 'ad_orders_30d': 40, 'orders_30d': 50,
            'ad_impressions': 10000, 'ad_clicks': 500, 'conversion_pct': 5,
            'conversion_basis': 'successful_orders_per_visit', **changes}


def optimizer(**changes):
    return {'cost_complete': True, 'contribution_before_ads': 34150, **changes}


def channel(plan, name):
    return next(row for row in plan['diagnosis'] if row['channel'] == name)


def strategy(plan, name):
    return next(row for row in plan['strategies'] if row['channel'] == name)


def test_scale_requires_complete_positive_finances_and_attributed_order_gate_with_disclosed_rule():
    plan = build_sales_plan(product(), metrics(), optimizer())
    ads = strategy(plan, 'ads')
    assert channel(plan, 'ads')['status'] == ads['status'] == 'scale'
    assert any('30' in text and 'không phải' in text for text in ads['evidence'])
    assert any('34.150 ₫' in text and 'CPA' in text for text in ads['evidence'])
    assert any('5.00%' in text for text in ads['evidence'])
    assert any('7.500 ₫' in text for text in ads['evidence'])
    assert any('giữ nguyên giá và nội dung' in text for text in ads['steps'])
    assert 'CPA' in ads['stop'] and 'tổng lãi' in ads['stop']
    assert 'chưa bảo đảm' in ads['body']
    assert AD_SCALE_ORDERS_MIN == 30


@pytest.mark.parametrize('metric_changes,cost_changes', [
    ({'ad_orders_30d': None}, {}), ({'ad_orders_30d': 29}, {}),
    ({'ad_orders_30d': 29.5}, {}), ({'roas': None}, {}),
    ({'roas': 2.899}, {}), ({'break_even_roas': None}, {}),
    ({'contribution_per_order': None}, {}), ({}, {'cost_complete': False}),
    ({}, {'contribution_before_ads': None}),
])
def test_missing_or_small_sample_evidence_never_recommends_scaling(metric_changes, cost_changes):
    plan = build_sales_plan(product(), metrics(**metric_changes), optimizer(**cost_changes))
    assert channel(plan, 'ads')['status'] != 'scale'
    assert 'Thử mở rộng' not in strategy(plan, 'ads')['title']


@pytest.mark.parametrize('values', [{'contribution_per_order': 0}, {'contribution_per_order': -1000}, {'roas': 1}])
def test_loss_evidence_prioritizes_containing_ads_and_fixing_before_new_spend(values):
    plan = build_sales_plan(product(), metrics(**values), optimizer())
    ads = strategy(plan, 'ads')
    assert ads['status'] == 'fix'
    assert plan['strategies'][0]['channel'] == 'ads'
    assert 'chưa có cơ sở tăng ngân sách' in ads['body']
    assert any('giảm hoặc dừng' in step for step in ads['steps'])


@pytest.mark.parametrize('values', [
    {'ad_clicks': 12000, 'ad_impressions': 10000}, {'ad_orders_30d': 40, 'ad_clicks': 20},
    {'ad_orders_30d': 40, 'orders_30d': 30}, {'ads_data_issues': ['Khác khoảng ngày']},
])
def test_inconsistent_ads_data_cannot_support_scale_or_causal_diagnosis(values):
    plan = build_sales_plan(product(), metrics(**values), optimizer())
    assert channel(plan, 'ads')['status'] == 'unknown'
    assert 'Đối soát số liệu' in strategy(plan, 'ads')['title']


def test_total_orders_and_cumulative_sales_are_not_substituted_for_ad_orders():
    plan = build_sales_plan(product(sold_total=100000), metrics(ad_orders_30d=None, orders_30d=10000), optimizer())
    assert channel(plan, 'ads')['status'] == 'unknown'
    assert any('không thay bằng tổng đã bán' in text for text in channel(plan, 'ads')['missing'])


def test_images_count_and_missing_collector_evidence_do_not_claim_image_quality():
    data = product()
    data['detail']['images'] = ['https://images.example/a.jpg'] * 3 + ['https://images.example/b.jpg']
    plan = build_sales_plan(data, {}, {})
    images = channel(plan, 'images')
    assert any('2 URL' in text and 'không chứng minh' in text for text in images['evidence'])
    assert any('kiểm tra ảnh chính' in text for text in strategy(plan, 'images')['steps'])
    unknown = build_sales_plan(product(detail={'status': 'failed', 'images': []}), {}, {})
    assert channel(unknown, 'images')['status'] == 'unknown'
    assert not channel(unknown, 'images')['evidence']


@pytest.mark.parametrize('detail', [{}, {'videos': []}, {'status': 'done', 'videos': []}])
def test_absent_or_empty_video_without_observation_flag_remains_unknown(detail):
    plan = build_sales_plan(product(detail=detail), {}, {})
    video = channel(plan, 'video')
    assert video['status'] == 'unknown'
    assert any('không chứng minh listing không có video' in text for text in video['evidence'])
    assert any('xác nhận đã có video hay chưa' in step for step in strategy(plan, 'video')['steps'])


def test_explicit_video_evidence_is_used_without_inventing_quality():
    data = product(); data['detail']['videos'] = ['https://video.example/demo.mp4']
    plan = build_sales_plan(data, {}, {})
    assert channel(plan, 'video')['status'] == 'test'
    assert any('1 video' in text for text in channel(plan, 'video')['evidence'])
    assert not any(row['channel'] == 'video' for row in plan['strategies'])
    data['detail']['videos'] = []; data['detail']['video_observed'] = True
    assert any('0 video' in text for text in channel(build_sales_plan(data, {}, {}), 'video')['evidence'])


def test_title_experiment_uses_only_recorded_attributes_and_one_variable():
    title = strategy(build_sales_plan(product(), {}, {}), 'title')
    assert any('Inox 304' in text and '20 cm' in text for text in title['evidence'])
    assert any('giữ ảnh, giá và quảng cáo ổn định' in step for step in title['steps'])
    assert not any('chứng nhận' in text for text in title['evidence'])
    assert any('không tự thêm chứng nhận' in text for text in title['prerequisites'])


def test_description_names_specific_missing_evidence_without_fabricating_specs():
    data = product(); data['detail']['attributes'] = []; data['detail']['description'] = 'Sản phẩm đẹp, tiện lợi.'
    description = channel(build_sales_plan(data, {}, {}), 'description')
    assert set(description['missing']) == {'kích thước/dung tích nếu áp dụng', 'chất liệu nếu áp dụng', 'công dụng/cách dùng'}
    assert description['status'] == 'test'
    action = strategy(build_sales_plan(data, {}, {}), 'description')
    assert any('bỏ qua trường không áp dụng' in text for text in action['prerequisites'])
    data['detail']['description'] = ''
    assert channel(build_sales_plan(data, {}, {}), 'description')['status'] == 'fix'


def test_low_ratings_trigger_feedback_review_not_an_invented_negative_reason():
    plan = build_sales_plan(product(rating=3.8, review_count=20), {}, {})
    reviews = strategy(plan, 'reviews')
    assert reviews['status'] == 'fix'
    assert any('không suy đoán nguyên nhân' in text for text in reviews['evidence'])
    assert any('không mua/tạo đánh giá' in text and 'không' in text for text in reviews['steps'])
    assert any('phản hồi thực' in text for text in [reviews['body']])
    small = build_sales_plan(product(rating=3.8, review_count=2), {}, {})
    assert channel(small, 'reviews')['status'] == 'test'


def test_rounded_review_count_is_disclosed_and_good_large_review_sample_is_not_forced_into_a_task():
    data = product(review_count=1000); data['detail']['review_count_text'] = '1k+ ratings'
    plan = build_sales_plan(data, {}, {})
    assert any('làm tròn/cận dưới' in text for text in channel(plan, 'reviews')['evidence'])
    assert not any(row['channel'] == 'reviews' for row in plan['strategies'])


def test_peer_context_is_only_used_with_sufficient_same_shop_category_and_same_basis():
    data = product(); data['detail']['images'] = [f'https://images.example/{index}.jpg' for index in range(5)]
    peers = {'own_category_conversion_median': 10, 'own_category_conversion_sample': 6,
             'conversion_basis': 'successful_orders_per_visit'}
    plan = build_sales_plan(data, metrics(conversion_pct=5), optimizer(), peers)
    image = strategy(plan, 'images')
    assert any('6 SKU cùng shop' in text and 'không phải chuẩn toàn sàn' in text for text in image['evidence'])
    peers['conversion_basis'] = 'successful_orders_per_product_view'
    mismatch = build_sales_plan(data, metrics(), optimizer(), peers)
    assert not any(row['channel'] == 'images' for row in mismatch['strategies'])


def test_empty_sparse_and_nonfinite_data_have_six_diagnoses_with_safe_focused_actions():
    sparse = build_sales_plan({}, {'roas': math.nan, 'ad_orders_30d': math.inf}, {'contribution_before_ads': math.inf})
    assert len(sparse['diagnosis']) == 6 and 0 < len(sparse['strategies']) <= 8
    assert all(row['status'] == 'unknown' for row in sparse['diagnosis'])
    assert all(row['steps'] and row['measurement'] and row['prerequisites'] and row['stop'] for row in sparse['strategies'])
    assert all(row['priority'] == round(row['impact'] * row['confidence'] * row['urgency'] / row['effort'], 2) for row in sparse['strategies'])
    json.dumps(sparse, allow_nan=False)


def test_plan_is_pure_deterministic_and_uses_current_product_identity():
    data, measures, costs = product(sku='99.88', name='Mặt hàng mới'), metrics(), optimizer()
    before = copy.deepcopy((data, measures, costs))
    plan = build_sales_plan(data, measures, costs)
    assert (data, measures, costs) == before
    assert plan == build_sales_plan(data, measures, costs)
    assert all(row['sku'] == '99.88' and row['key'].startswith('99.88:sales:') for row in plan['strategies'])
    assert all('12.34' not in row['key'] for row in plan['strategies'])
    assert all('10%' not in row['action'] for row in plan['strategies'])


def test_repeated_long_title_gets_a_verified_fact_draft_even_without_missing_specifications():
    name=('Rây lọc thực phẩm Inox 304 20 cm rây lọc thực phẩm Inox 304 20 cm ')*3
    plan=build_sales_plan(product(name=name),{}, {})
    title=strategy(plan,'title')
    assert any('chưa phải điểm SEO' in line for line in title['evidence'])
    assert any('không phải giới hạn chính thức' in line for line in title['evidence'])
    assert any('Bản nháp cấu trúc' in line and 'chưa tự xuất bản' in line for line in title['steps'])
    assert not any('material:' in line or 'dimension:' in line for line in title['evidence'])


def test_description_checks_do_not_drop_specifications_after_the_first_500_characters():
    row=product()
    row['detail']['attributes']=[]
    row['detail']['description']='Giới thiệu sản phẩm. '*40+' Kích thước 16,5 x 30 cm. Chất liệu inox. Công dụng: dùng để lọc thực phẩm.'
    result=build_sales_plan(row,metrics(),optimizer())
    description=channel(result,'description')
    assert description['missing']==[]
    assert not any(item['channel']=='description' for item in result['strategies'])
