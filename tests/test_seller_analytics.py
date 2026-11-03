import copy
import json

import pytest

from seller_analytics import analyze_shop, optimize_price


def product(sku='12.1', **changes):
    return {'sku':sku,'name':f'Sản phẩm {sku}','category':'Gia dụng','price':99000,
            'sold_total':1000,'rating':4.8,**changes}


def costs(**changes):
    return {'unit_cost':45000,'platform_fee_pct':15,'payment_fee_pct':0,'tax_pct':0,
            'packaging_cost':5000,'shipping_cost':0,'other_unit_cost':0,'ad_cost_per_order':12000,
            'target_margin_pct':20,**changes}


def report(*items):
    return {'shop':{'id':'shop'},'own_products':list(items),
            'assumptions':{'platform_fee_pct':12,'ads_fee_pct':8}}


def test_document_example_computes_each_price_scenario_from_entered_costs():
    result=optimize_price(product(),costs())
    assert result['ready'] and result['cost_complete']
    assert [item['price'] for item in result['scenarios']]==[89000,99000,109000]
    assert [item['contribution'] for item in result['scenarios']]==[13650,22150,30650]
    assert result['contribution_per_order']==22150
    assert result['break_even_price']==72941.18
    assert result['target_price']==95384.62
    assert result['max_discount_pct']==26.32
    assert result['experiment']['duration_days']==7
    assert result['experiment']['stop_threshold_configured'] is False
    assert 'nhóm đối chứng' in result['experiment']['interpretation']


def test_partial_document_costs_are_conditional_and_unknown_tax_shipping_are_not_actual_zero():
    entered={'unit_cost':45000,'platform_fee_pct':15,'packaging_cost':5000,'ad_cost_per_order':12000}
    result=optimize_price(product(),entered)
    assert result['ready'] and result['contribution_per_order']==22150
    assert result['cost_complete'] is False and result['actual_profit'] is None
    assert {'payment_fee_pct','tax_pct','shipping_cost','other_unit_cost'}<=set(result['missing'])
    assert all(item['actual_profit'] is None for item in result['scenarios'])
    assert any('thiếu' in note for note in result['assumptions'])


def test_unknown_costs_and_global_demo_assumptions_do_not_fabricate_profit_or_real_fee():
    result=analyze_shop(report(product()),{})
    row=result['products'][0]
    assert row['optimizer']['ready'] is False
    assert row['inputs']['platform_fee_pct'] is None
    assert row['metrics']['contribution_per_order'] is None
    assert row['metrics']['contribution_30d'] is None
    assert result['summary']['contribution_30d'] is None
    assert result['summary']['revenue_30d'] is None
    assert result['summary']['orders_30d'] is None
    assert row['segment']=='unknown'


def test_imported_cost_fields_work_and_manual_cost_changes_update_scenarios():
    source=product(cost=40000,platform_fee_pct=10)
    imported=optimize_price(source,{})
    manual=optimize_price(source,{'unit_cost':50000,'platform_fee_pct':20})
    assert imported['ready'] and imported['known_fee_pct']==10
    assert manual['contribution_per_order']<imported['contribution_per_order']
    assert manual['break_even_price']>imported['break_even_price']


@pytest.mark.parametrize('fields',[{'platform_fee_pct':100},{'platform_fee_pct':90,'payment_fee_pct':10},
    {'platform_fee_pct':-1},{'tax_pct':101},{'unit_cost':float('inf')},{'unit_cost':float('nan')},
    {'unit_cost':True}])
def test_invalid_or_infeasible_costs_never_produce_profit(fields):
    result=optimize_price(product(),costs(**fields))
    assert result['ready'] is False
    assert result['break_even_price'] is None and result['actual_profit'] is None
    assert all(item['contribution'] is None for item in result['scenarios'])
    json.dumps(result,allow_nan=False)


def test_infeasible_target_margin_keeps_baseline_cost_math_but_returns_no_target():
    result=optimize_price(product(),costs(target_margin_pct=85))
    assert result['ready'] and result['contribution_per_order']==22150
    assert result['target_price'] is None and result['errors']


def test_ad_allocation_uses_explicit_orders_never_reported_units_or_cumulative_sold():
    source=product(units_30d=100,sold_total=100000)
    missing=optimize_price(source,{'unit_cost':45000,'platform_fee_pct':15,'ad_spend':120000})
    assert missing['ad_cost_per_order'] is None
    allocated=optimize_price(source,{'unit_cost':45000,'platform_fee_pct':15,'ad_spend':120000,'orders_30d':10})
    assert allocated['ad_cost_per_order']==12000
    assert allocated['ad_allocation_basis']=='ad_spend_divided_by_successful_orders'
    explicit=optimize_price(source,{'unit_cost':45000,'platform_fee_pct':15,'ad_spend':120000,'orders_30d':10,'ad_cost_per_order':5000})
    assert explicit['ad_cost_per_order']==5000 and explicit['ad_allocation_basis']=='manual_per_order'


@pytest.mark.parametrize('spend,revenue,expected_roas,expected_acos',[(0,0,None,None),(0,100000,None,0),(10000,0,0,None),(10000,50000,5,20)])
def test_roas_and_acos_use_attributed_revenue_and_never_divide_by_zero(spend,revenue,expected_roas,expected_acos):
    inputs=costs(ad_spend=spend,ad_revenue=revenue)
    row=analyze_shop(report(product(revenue_30d=999999)),{'12.1':inputs})['products'][0]
    assert row['metrics']['roas']==expected_roas
    assert row['metrics']['acos_pct']==expected_acos
    json.dumps(row,allow_nan=False)


def test_ad_break_even_uses_margin_before_ads_and_requires_all_non_ad_costs():
    row=analyze_shop(report(product()),{'12.1':costs()})['products'][0]
    assert row['metrics']['break_even_roas']==2.899
    assert row['metrics']['break_even_acos_pct']==34.49
    incomplete=costs();incomplete.pop('tax_pct')
    row=analyze_shop(report(product()),{'12.1':incomplete})['products'][0]
    assert row['metrics']['break_even_roas'] is None


def test_conversion_uses_orders_and_known_same_period_visits_not_sold_total_or_units():
    source=product(units_30d=100,views_30d=500,sold_total=99999)
    missing=analyze_shop(report(source),{})['products'][0]
    assert missing['metrics']['conversion_pct'] is None
    views=analyze_shop(report(source),{'12.1':{'orders_30d':10}})['products'][0]
    assert views['metrics']['conversion_pct']==2
    assert views['metrics']['conversion_basis']=='successful_orders_per_product_view'
    visits=analyze_shop(report(source),{'12.1':{'orders_30d':10,'visits_30d':200}})['products'][0]
    assert visits['metrics']['conversion_pct']==5
    assert visits['metrics']['conversion_basis']=='successful_orders_per_visit'
    invalid=analyze_shop(report(source),{'12.1':{'orders_30d':201,'visits_30d':200}})['products'][0]
    assert invalid['metrics']['conversion_pct'] is None


def test_monthly_revenue_units_and_orders_have_distinct_bases_and_cumulative_is_not_revenue():
    rows=[product('12.1',revenue_30d=500000,units_30d=5),product('12.2',units_30d=10),product('12.3',sold_total=999999)]
    result=analyze_shop(report(*rows),{})
    assert result['summary']['revenue_30d']==1490000
    assert result['summary']['revenue_basis']=='mixed'
    assert result['summary']['units_30d']==15 and result['summary']['orders_30d'] is None
    assert result['summary']['coverage']['revenue']==2
    assert result['products'][2]['metrics']['revenue_share_pct'] is None
    assert sum(p['metrics']['revenue_share_pct'] or 0 for p in result['products'])==100


def test_monthly_contribution_requires_complete_costs_and_explicit_orders():
    source=product(units_30d=100)
    unknown=analyze_shop(report(source),{'12.1':costs()})
    assert unknown['summary']['contribution_30d'] is None
    known=analyze_shop(report(source),{'12.1':costs(orders_30d=10)})
    assert known['summary']['contribution_30d']==221500
    partial=costs(orders_30d=10);partial.pop('shipping_cost')
    assert analyze_shop(report(source),{'12.1':partial})['summary']['contribution_30d'] is None


def test_segmentation_and_priority_change_with_actual_inputs_and_no_fixed_skus():
    rows=[product(f'12.{i}',units_30d=units,detail={'collected_at':'2026-10-15','images':['a'],'description':'Mô tả','attributes':[{'name':'A','value':'B'}]}) for i,units in enumerate((0,10,20,200),1)]
    entered={row['sku']:costs(orders_30d=10,visits_30d=100) for row in rows}
    first=analyze_shop(report(*rows),entered)
    assert first['products'][0]['segment']=='slow'
    assert first['products'][-1]['segment']=='chief'
    entered['12.4']['unit_cost']=150000
    changed=analyze_shop(report(*rows),entered)
    assert changed['products'][-1]['segment']=='low_margin'
    assert changed['strategies'][0]['key']=='12.4:loss'
    assert all(item['priority']==round(item['impact']*item['confidence']*item['urgency']/item['effort'],2) for item in changed['strategies'])
    assert 0<len(changed['strategies'])<=10
    assert first['products'][-1]['health']['score']>changed['products'][-1]['health']['score']


def test_growth_is_a_conditional_candidate_from_same_category_conversion_not_an_invented_forecast():
    rows=[product(f'12.{i}') for i in range(1,4)]
    entered={row['sku']:costs(orders_30d=i*10,visits_30d=100) for i,row in enumerate(rows,1)}
    result=analyze_shop(report(*rows),entered)
    assert result['products'][-1]['segment']=='growth'
    assert 'chưa dự báo' in result['products'][-1]['segment_reason']
    assert all(p['metrics']['units_30d'] is None for p in result['products'])


def test_health_uses_configured_margin_target_and_cumulative_classification_keeps_its_basis():
    low_target=analyze_shop(report(product()),{'12.1':costs(target_margin_pct=20)})['products'][0]
    high_target=analyze_shop(report(product()),{'12.1':costs(target_margin_pct=40)})['products'][0]
    assert low_target['health']['components']['contribution']>high_target['health']['components']['contribution']
    rows=[product(f'12.{i}',sold_total=sold) for i,sold in enumerate((1,10,100,1000),1)]
    chief=analyze_shop(report(*rows),{})['products'][-1]
    assert chief['segment']=='chief' and 'tham khảo' in chief['segment_label']
    assert chief['health']['sales_basis']=='cumulative_sold_total'
    assert chief['metrics']['units_30d'] is None


@pytest.mark.parametrize('reported_basis', ['reported_30d', 'reported_or_imported'])
def test_chief_and_slow_labels_disclose_estimated_monthly_sales_without_changing_groups_or_health(reported_basis):
    rows=[product(f'12.{i}',units_30d=units,units_basis=reported_basis,sold_total=1000)
          for i,units in enumerate((0,10,20,200),1)]
    reported=analyze_shop(report(*rows),{})
    estimated=analyze_shop(report(*[{**row,'units_basis':'estimated_snapshot_delta'} for row in rows]),{})
    assert [p['segment'] for p in reported['products']]==[p['segment'] for p in estimated['products']]
    assert [p['health']['score'] for p in reported['products']]==[p['health']['score'] for p in estimated['products']]
    assert reported['summary']['segment_counts']==estimated['summary']['segment_counts']
    assert reported['products'][0]['segment']=='slow' and reported['products'][-1]['segment']=='chief'
    assert reported['products'][0]['segment_label']=='Bán chậm'
    assert reported['products'][-1]['segment_label']=='Sản phẩm chủ lực'
    assert 'ước tính' not in reported['products'][0]['segment_reason']
    assert 'ước tính' not in reported['products'][-1]['segment_reason']
    for index in (0,-1):
        assert 'tham khảo' in estimated['products'][index]['segment_label']
        assert 'ước tính 30 ngày' in estimated['products'][index]['segment_label']
        assert 'ước tính từ chênh lệch số đã bán' in estimated['products'][index]['segment_reason']


def test_cumulative_only_chief_remains_distinct_from_estimated_or_reported_monthly_sales():
    rows=[product(f'12.{i}',sold_total=sold) for i,sold in enumerate((0,10,20,200),1)]
    result=analyze_shop(report(*rows),{})
    low,chief=result['products'][0],result['products'][-1]
    assert low['segment']=='unknown'
    assert chief['segment']=='chief' and chief['segment_label']=='Chủ lực tham khảo · theo tổng đã bán'
    assert 'tích lũy' in chief['segment_reason'] and 'ước tính 30 ngày' not in chief['segment_label']
    assert chief['metrics']['units_30d'] is None and chief['health']['sales_basis']=='cumulative_sold_total'


def test_empty_and_missing_data_do_not_pad_strategies_or_create_health_scores():
    result=analyze_shop(report(),{})
    assert result['summary']['product_count']==0
    assert result['health']['score'] is None and result['strategies']==[]
    sparse=analyze_shop(report(product(rating=None)),{})
    assert sparse['health']['score'] is None
    assert sparse['products'][0]['health']['coverage']['known']==0


def test_analysis_is_pure_and_json_serializable_with_explicit_coverage():
    source=report(product(units_30d=10))
    entered={'12.1':costs(orders_30d=5,ad_spend=10000,ad_revenue=30000)}
    before=copy.deepcopy((source,entered))
    result=analyze_shop(source,entered)
    assert (source,entered)==before
    assert result==analyze_shop(source,entered)
    assert result['summary']['eligible_count']==1
    json.dumps(result,allow_nan=False)


def test_ad_funnel_metrics_change_with_reported_counts_and_reject_conflicting_basis():
    source=report(product())
    entered=costs(orders_30d=40,visits_30d=800,ad_spend=120000,ad_revenue=600000,
                  ad_impressions=10000,ad_clicks=200,ad_orders_30d=30)
    row=analyze_shop(source,{'12.1':entered})['products'][0]
    assert row['metrics']['ad_ctr_pct']==2
    assert row['metrics']['ad_cpc']==600
    assert row['metrics']['ad_conversion_pct']==15
    assert row['metrics']['ad_cpa']==4000
    assert next(item for item in row['sales_plan']['diagnosis'] if item['channel']=='ads')['status']=='scale'
    entered['ad_clicks']=20000
    changed=analyze_shop(source,{'12.1':entered})['products'][0]
    assert changed['metrics']['ad_ctr_pct'] is None
    assert changed['metrics']['ads_data_issues']
    assert next(item for item in changed['sales_plan']['diagnosis'] if item['channel']=='ads')['status']=='unknown'


def test_shop_priorities_keep_multiple_channels_while_each_sku_retains_full_plan():
    result=analyze_shop(report(*(product(f'12.{i}') for i in range(12))),{})
    assert len(result['strategies'])<=10
    assert sum(item.get('channel')=='ads' for item in result['strategies'])<=2
    assert len({item.get('channel') for item in result['strategies'] if item.get('channel')})>=3
    assert all(product['sales_plan']['strategies'] for product in result['products'])
    assert len(result['strategies_available'])>len(result['strategies'])
