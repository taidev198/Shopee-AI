import copy
import json

from seller_ai_strategy_context import DIVERSITY_PROMPT, SALES_CHANNELS, enrich_fact_catalog


def test_context_uses_recorded_variants_and_finance_without_generating_strategies():
    product = {'sku': '1', 'category': 'Nhà bếp', 'name': 'Rây lọc inox', 'stock': 12,
               'inputs': {'target_margin_pct': 20}, 'optimizer': {'max_discount_pct': 3.2},
               'detail': {'variants': [{'name': 'Kích thước', 'options': ['15 cm', '20 cm']}],
                          'categories': ['Nhà cửa', 'Nhà bếp']}}
    original = copy.deepcopy(product)
    result = enrich_fact_catalog({}, product, {'shop': {'id': 'shop-a'}})
    assert result['detail.variants']['value'][0]['options'] == ['15 cm', '20 cm']
    assert result['optimizer.max_discount_pct']['value'] == 3.2
    assert result['product.stock']['value'] == 12
    assert product == original and 'strategies' not in result


def test_bundle_context_stays_inside_same_shop_category_and_never_passes_secrets():
    product = {'sku': '1', 'category': 'Nhà bếp', 'name': 'Rây lọc inox'}
    peers = [
        {'sku': '2', 'name': 'Rây lọc 20cm', 'category': 'Nhà bếp', 'api_key': 'private-key'},
        {'sku': '3', 'name': 'Đồ shop khác', 'category': 'Nhà bếp', 'shop_id': 'shop-b'},
        {'sku': '4', 'name': 'Đồ đối thủ', 'category': 'Nhà bếp', 'role': 'market'},
        {'sku': '5', 'name': 'Áo thun', 'category': 'Thời trang'},
    ]
    result = enrich_fact_catalog({}, product, {'shop': {'id': 'shop-a'}, 'products': peers})
    assert [row['sku'] for row in result['catalog.same_shop_candidates']['value']] == ['2']
    serialized = json.dumps(result, ensure_ascii=False)
    assert all(value not in serialized for value in ('private-key', 'Đồ shop khác', 'Đồ đối thủ', 'Áo thun'))
    assert 'chưa xác nhận' in result['catalog.same_shop_candidates']['label']


def test_context_is_bounded_and_missing_or_invalid_numbers_remain_unknown():
    product = {'sku': '1', 'name': 'Rây', 'category': 'Bếp', 'stock': float('nan'),
               'detail': {'variants': [{'name': 'X'*1000, 'options': ['a'*1000]*100}]*100},
               'optimizer': {'max_discount_pct': True}}
    analysis = {'shop': {'id': 'a'}, 'products': [{'sku': str(i), 'name': 'X'*1000, 'category': 'Bếp'} for i in range(2, 100)]}
    result = enrich_fact_catalog({}, product, analysis)
    assert result['product.stock']['value'] is None
    assert result['optimizer.max_discount_pct']['value'] is None
    assert len(result['detail.variants']['value']) == 6
    assert len(result['catalog.same_shop_candidates']['value']) == 5
    assert len(json.dumps(result, allow_nan=False)) < 14000


def test_strategy_guidance_offers_commercial_choices_without_a_fixed_three_item_template():
    assert len(SALES_CHANNELS) == 12
    assert {'price', 'promotion', 'bundles', 'variants', 'service', 'positioning'} <= set(SALES_CHANNELS)
    assert 'đúng 3 chiến lược' not in DIVERSITY_PROMPT
    assert 'Không dùng danh sách hành động cố định' in DIVERSITY_PROMPT
    assert 'không thêm cho đủ số' in DIVERSITY_PROMPT
    assert 'hypothesis' in DIVERSITY_PROMPT and 'tradeoff' in DIVERSITY_PROMPT


def test_unknown_variants_and_customer_feedback_are_not_evidence_of_listing_gaps():
    product={'sku':'1','detail':{'variants':[]},'optimizer':{'scenarios':[{'key':'baseline','margin_pct':3.76}]}}
    facts=enrich_fact_catalog({},product,{'shop':{'id':'a'}})
    assert facts['detail.variant_status']['value']=='unknown'
    assert facts['detail.customer_feedback_status']['value']=='unknown'
    assert facts['optimizer.baseline_margin_pct']['value']==3.76
    product['detail']['variants']=[{'name':'Dung tích','options':['500ml','1l']}]
    assert enrich_fact_catalog({},product,{})['detail.variant_status']['value']=='observed'
