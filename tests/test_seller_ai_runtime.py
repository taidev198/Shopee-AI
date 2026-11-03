"""Generation repair and validation tests use stub Ollama and temporary DBs."""
import copy
import json
import threading
from types import SimpleNamespace

import pytest

import seller_ai
from seller_ai_runtime import compact_schema, generation_schema, response_contract, compact_prompt_facts, parse_model_json, live_telemetry, numeric_telemetry, safe_diagnostics, semantic_diagnostics
from test_seller_ai import ai_workspace, model_plan, set_model_plan, enqueue, job, completed_job


def test_compact_schema_preserves_named_properties_and_every_required_field():
    original=seller_ai.ModelPlan.model_json_schema()
    schema=compact_schema(original)
    assert schema['$defs']['Strategy']['properties']['title']['type']=='string'
    assert schema['$defs']['ListingDrafts']['properties']['description']['type']=='string'
    assert {'hypothesis','tradeoff','priority_tier'}<=set(schema['$defs']['Strategy']['required'])
    def visit(node):
        if isinstance(node,dict):
            if 'required' in node:
                assert set(node['required'])<=set(node.get('properties',{}))
            if node.get('type') in ('string','object','array'):
                assert 'title' not in node and 'default' not in node
            for value in node.values():visit(value)
        elif isinstance(node,list):
            for value in node:visit(value)
    visit(schema)
    assert len(json.dumps(schema))<len(json.dumps(original))


def test_compact_prompt_facts_retains_all_values_ids_nulls_and_bases_without_repeated_labels():
    facts={'product.price':{'label':'Giá đã ghi nhận (₫)','value':99000},
           'metrics.units_30d':{'label':'Số lượng 30 ngày chưa rõ','value':None},
           'metrics.units_basis':{'label':'Cơ sở số lượng','value':'public_cumulative'},
           'detail.attributes':{'label':'Thuộc tính','value':[{'name':'Chất liệu','value':'PP'}]},
           'detail.images_count':{'label':'Số ảnh','value':0},
           'optimizer.cost_complete':{'label':'Chi phí đã đầy đủ','value':False}}
    original=copy.deepcopy(facts)
    compact=compact_prompt_facts(facts)
    assert facts==original and compact=={key:item['value'] for key,item in facts.items()}
    assert compact.keys()==facts.keys() and compact['metrics.units_30d'] is None
    assert compact['detail.images_count']==0 and compact['optimizer.cost_complete'] is False
    assert len(json.dumps(compact,ensure_ascii=False))<len(json.dumps(facts,ensure_ascii=False))
    assert 'label' not in compact


def test_full_overview_keeps_numeric_context_and_multi_step_analysis_without_grammar_length_limits():
    original=seller_ai.ModelPlan.model_json_schema();before=copy.deepcopy(original)
    profile=generation_schema(original)
    assert original==before
    assert profile['properties']['strategies']['maxItems']==8
    assert profile['properties']['diagnosis']['maxItems']==8
    assert 'pattern' not in profile['properties']['summary']
    assert original['properties']['strategies']['maxItems']==10
    assert 'maxLength' not in profile['properties']['summary']
    strategy=profile['$defs']['Strategy']['properties']
    assert 'maxLength' not in strategy['title'] and 'maxLength' not in strategy['rationale']
    assert 'maxLength' not in strategy['hypothesis'] and 'maxLength' not in strategy['tradeoff']
    assert {'hypothesis','tradeoff','priority_tier','title'}<=set(profile['$defs']['Strategy']['required'])
    for key,limit in (('steps',4),('measurement',3),('prerequisites',3)):
        assert strategy[key]['maxItems']==limit and strategy[key]['items']==original['$defs']['Strategy']['properties'][key]['items']
        assert original['$defs']['Strategy']['properties'][key]['maxItems']==5
    drafts=profile['$defs']['ListingDrafts']['properties']
    assert 'maxLength' not in drafts['description'] and original['$defs']['ListingDrafts']['properties']['description']['maxLength']==5000
    assert drafts['image_briefs']['maxItems']==5 and drafts['video_script']['maxItems']==8
    assert drafts['titles']['maxItems']==3
    diagnosis=profile['$defs']['Diagnosis']
    assert {'insight','recommendation'}<=set(diagnosis['required'])
    assert 'insight' not in original['$defs']['Diagnosis']['required']
    assert strategy['priority_tier']['enum']==['now','next','later']
    assert strategy['confidence']['enum']==['low','medium','high']


def test_explicit_response_contract_contains_required_keys_array_shapes_and_all_channel_values():
    schema=generation_schema(seller_ai.ModelPlan.model_json_schema())
    contract=response_contract(schema)
    assert set(schema['required'])<=set(contract)
    assert isinstance(contract['diagnosis'],list) and len(contract['diagnosis'])==1
    assert set(schema['$defs']['Diagnosis']['required'])<=set(contract['diagnosis'][0])
    assert isinstance(contract['strategies'],list) and len(contract['strategies'])==1
    strategy=contract['strategies'][0]
    assert set(schema['$defs']['Strategy']['required'])<=set(strategy)
    assert {'hypothesis','tradeoff','priority_tier','channel','title','rationale','evidence_ids','stop','confidence'}<=strategy.keys()
    assert strategy['channel'].split('|')==schema['$defs']['Strategy']['properties']['channel']['enum']
    assert len(strategy['channel'].split('|'))==12
    assert contract['diagnosis'][0]['channel']==strategy['channel']
    assert set(schema['$defs']['ListingDrafts']['required'])<=set(contract['listing_drafts'])
    assert contract['listing_drafts']['description']=='string'
    assert len(json.dumps(contract))<len(json.dumps(schema))/3
    assert '$defs' not in json.dumps(contract)


def test_generation_grammar_grounds_evidence_and_missing_ids_without_expanding_prompt_contract():
    facts={'product.name':{'value':'Known name'},'metrics.roas':{'value':None},'product.stock':{'value':0},
           'optimizer.cost_complete':{'value':False},'detail.variants':{'value':[]},
           'detail.variant_status':{'value':'unknown'},'detail.description':{'value':'   '}}
    schema=generation_schema(seller_ai.ModelPlan.model_json_schema(),facts)
    strategy=schema['$defs']['Strategy']['properties'];diagnosis=schema['$defs']['Diagnosis']['properties']
    assert strategy['evidence_ids']['items']['enum']==sorted(facts)
    assert diagnosis['evidence_ids']['items']['enum']==sorted(facts)
    assert diagnosis['missing']['items']['enum']==sorted(['metrics.roas','detail.variants','detail.variant_status','detail.description'])
    assert 'minItems' not in diagnosis['missing'] or diagnosis['missing']['minItems']==0
    contract=response_contract(schema)
    assert contract['diagnosis'][0]['missing']==['missing_fact_id']
    assert contract['diagnosis'][0]['evidence_ids']==['fact_id']
    assert contract['strategies'][0]['evidence_ids']==['fact_id']
    assert 'metrics.roas' not in json.dumps(contract)
    assert len(contract['strategies'][0]['channel'].split('|'))==12


def test_generation_grammar_allows_empty_missing_list_when_all_facts_are_known():
    schema=generation_schema(seller_ai.ModelPlan.model_json_schema(),{'product.name':{'value':'Known'},'product.stock':{'value':0}})
    missing=schema['$defs']['Diagnosis']['properties']['missing']
    assert missing['maxItems']==0 and missing['items']['type']=='string' and 'enum' not in missing['items']
    original=seller_ai.ModelPlan.model_json_schema()['$defs']['Diagnosis']['properties']['missing']
    assert original['maxItems']==8 and 'enum' not in original['items']


@pytest.mark.parametrize('content',['{"summary":"ok"}',
    '```json\n{"summary":"ok"}\n```','```\n{"summary":"ok"}\n```',
    '  ```JSON\r\n{"summary":"ok"}\r\n```  '])
def test_parser_accepts_only_plain_json_or_one_complete_json_code_fence(content):
    assert parse_model_json(content)=={'summary':'ok'}


@pytest.mark.parametrize('content',[
    'Đây là kết quả: {"summary":"ok"}',
    '```json\n{"summary":"ok"}\n```\nGiải thích thêm.',
    '```python\n{"summary":"ok"}\n```',
    '```json\n{"summary":"ok"}\n```\n```json\n{}\n```',
    '```json {"summary":"ok"}```',
    '{"summary":"ok",}',
])
def test_parser_does_not_extract_arbitrary_json_or_rewrite_invalid_model_text(content):
    with pytest.raises(json.JSONDecodeError):parse_model_json(content)


@pytest.mark.parametrize('status,expected',[
    ('running',{'duration_ms':12_000,'queue_duration_ms':1500}),
    ('queued',{'duration_ms':4.2,'queue_duration_ms':15_000}),
    ('done',{'duration_ms':4.2,'queue_duration_ms':1500}),
    ('failed',{'duration_ms':4.2,'queue_duration_ms':1500}),
])
def test_live_elapsed_time_uses_current_clock_only_for_active_phase(status,expected):
    stored={'duration_ms':4.2,'queue_duration_ms':1500}
    result=live_telemetry(stored,status,'2026-10-17T03:00:00Z','2026-10-17T03:00:03Z','2026-10-17T10:00:15+07:00')
    assert result==expected
    assert stored=={'duration_ms':4.2,'queue_duration_ms':1500}


def test_live_elapsed_time_rejects_invalid_timestamps_and_bounds_negative_or_extreme_values():
    assert live_telemetry({},'running','','invalid','2026-10-17T03:00:15Z')=={}
    assert live_telemetry({},'running','','2026-10-17T03:00:16Z','2026-10-17T03:00:15Z')['duration_ms']==0
    assert live_telemetry({},'queued','0001-01-01T00:00:00Z',None,'2026-10-17T03:00:15Z')['queue_duration_ms']==31_536_000_000
    assert live_telemetry({},'running','','2026-10-17T03:00:15','2026-10-17T03:00:16Z')=={}


def test_diagnostics_and_telemetry_never_echo_untrusted_error_keys_values_or_messages():
    errors=[{'loc':('strategies',0,'hypothesis'),'type':'missing','input':'SECRET-A'},
            {'loc':('SECRET-B',),'type':'extra_forbidden','msg':'SECRET-C','ctx':{'secret':'SECRET-D'}},
            {'loc':('summary',),'type':'SECRET-E'}]
    diagnostics=safe_diagnostics(errors,{'strategies','hypothesis','summary'})
    assert diagnostics==[{'field':'strategies.0.hypothesis','type':'missing'},
                         {'field':'<unknown>','type':'extra_forbidden'},
                         {'field':'summary','type':'validation_error'}]
    assert 'SECRET' not in json.dumps(diagnostics)
    assert numeric_telemetry({'prompt_eval_count':True,'eval_count':-1,'total_duration':float('inf'),
                             'load_duration':2**10000,'message':{'content':'SECRET'}})=={}
    assert numeric_telemetry({'prompt_eval_count':100,'eval_count':20,'total_duration':400_000_000})=={
        'prompt_eval_count':100,'eval_count':20,'total_duration_ms':400.0}


@pytest.mark.parametrize('text,kind',[
    ('Ảnh hiện tại chưa rõ.','unsupported_image_claim'),
    ('Ảnh sản phẩm bị mờ.','unsupported_image_claim'),
    ('Listing thiếu phân loại.','unsupported_variant_claim'),
    ('Sản phẩm chưa có biến thể.','unsupported_variant_claim'),
    ('Lợi nhuận gộp tốt.','unsupported_profit_claim'),
    ('Lãi đóng góp đang ở mức tốt.','unsupported_profit_claim'),
])
def test_narrow_semantic_guard_rejects_unobserved_claims_even_with_complete_costs(text,kind):
    plan=model_plan();plan['summary']=text
    facts={'detail.variant_status':{'value':'unknown'},'optimizer.cost_complete':{'value':True}}
    assert {'field':'summary','type':kind} in semantic_diagnostics(plan,facts)


@pytest.mark.parametrize('text',[
    'Cần kiểm tra ảnh hiện tại có bị mờ hay không.',
    'Giả thuyết: ảnh hiện tại chưa rõ; cần người bán xác minh.',
    'Chưa có dữ liệu phân loại; chưa xác minh listing hiện tại.',
    'Thiếu thông tin phân loại trong dữ liệu thu thập.',
    'Chưa đủ cơ sở kết luận lãi đóng góp tốt.',
    'Ghi nhận lãi đóng góp 2.404₫ theo chi phí đã khai báo; chưa có benchmark.',
    'Chưa có phân loại được ghi nhận.',
    'Chưa có phân loại ghi nhận.',
    'Chưa có biến thể nào được thu thập.',
    'Kiểm tra ảnh hiện tại có rõ quy cách chưa.',
    'Xác minh ảnh hiện tại có mờ hay không.',
    'Chụp ảnh mới rõ quy cách, không mờ.',
    'Chụp lại ảnh sản phẩm không bị mờ.',
])
def test_guard_accepts_explicit_unknowns_and_testable_hypotheses(text):
    plan=model_plan();plan['summary']=text
    assert semantic_diagnostics(plan,{})==[]


@pytest.mark.parametrize('proposal,unsupported',[
    ('Bổ sung ảnh mới rõ quy cách, không mờ.',
     'Bổ sung ảnh mới vì ảnh hiện tại mờ.'),
    ('Đề xuất ảnh mới không mờ và thể hiện rõ kích thước.',
     'Đề xuất ảnh mới do ảnh sản phẩm bị mờ.'),
    ('Ảnh mới giúp khách chưa quen sản phẩm hiểu rõ kích thước.',
     'Ảnh mới giúp thay thế ảnh hiện tại chưa rõ kích thước.'),
    ('Ảnh mới có thể hỗ trợ khách chưa quen sản phẩm hiểu rõ quy cách.',
     'Ảnh mới có thể hỗ trợ khách vì ảnh sản phẩm bị mờ.'),
    ('Nên bổ sung ảnh minh họa mới rõ quy cách, không mờ.',
     'Nên bổ sung ảnh minh họa mới vì ảnh hiện tại chưa rõ.'),
])
def test_new_photo_proposals_are_not_pixel_observations_but_existing_photo_claims_still_fail(proposal,unsupported):
    plan=model_plan();plan['strategies'][2]['rationale']=proposal
    assert semantic_diagnostics(plan,{})==[]
    plan['strategies'][2]['rationale']=unsupported
    assert {'field':'strategies.2.rationale','type':'unsupported_image_claim'} in semantic_diagnostics(plan,{})


@pytest.mark.parametrize('stop',[
    'Dừng nếu ROAS dưới 3.0 sau 3 ngày.',
    'Dừng sau 3 ngày nếu ROAS thấp hơn 3,0.',
    'Dừng nếu ROAS < 3 trong 7 ngày.',
    'Tạm dừng nếu ROAS không đạt mức 26,54.',
])
def test_ad_stop_roas_cannot_be_lower_than_engine_break_even(stop):
    plan=model_plan();plan['strategies'][0]['stop']=stop
    facts={'metrics.break_even_roas':{'value':26.5515}}
    assert {'field':'strategies.0.stop','type':'unsafe_ads_threshold'} in semantic_diagnostics(plan,facts)


@pytest.mark.parametrize('stop',[
    'Dừng nếu ROAS dưới 26.55 sau 3 ngày.',
    'Dừng nếu ROAS thấp hơn 26,56 sau 3 ngày.',
    'Dừng thử sau 3 ngày; đối chiếu ROAS với mức hòa vốn của engine.',
    'ROAS hiện tại 3.0; chưa quyết định thử nghiệm, cần đối soát dữ liệu.',
    'Dừng sau 3 ngày nếu chưa có dữ liệu ROAS đủ cơ sở.',
])
def test_ad_roas_guard_accepts_rounded_break_even_and_does_not_treat_days_or_observed_roas_as_threshold(stop):
    plan=model_plan();plan['strategies'][0]['stop']=stop
    plan['strategies'][0]['rationale']='ROAS hiện tại 3.0 thấp hơn hòa vốn 26.5515; cần đối soát trước.'
    assert not any(item['type']=='unsafe_ads_threshold' for item in semantic_diagnostics(plan,{'metrics.break_even_roas':{'value':26.5515}}))


@pytest.mark.parametrize('field,text',[
    ('steps','Chạy quảng cáo với ngân sách 50.000 VND/ngày trong 3 ngày.'),
    ('steps','Chạy thử với ngân sách 50k mỗi ngày.'),
    ('steps','Chi thử 200.000 đồng cho toàn bộ chiến dịch.'),
    ('rationale','Nên đặt ngân sách 1,5 triệu cho thử nghiệm quảng cáo.'),
    ('rationale','Đề xuất ngân sách 50k/ngày dù chi quảng cáo cùng kỳ đã là 50k.'),
])
def test_ad_strategy_cannot_choose_daily_or_total_money_budget_from_past_spend(field,text):
    plan=model_plan();strategy=plan['strategies'][0]
    strategy[field]=[text] if field=='steps' else text
    facts={'metrics.ad_spend':{'value':50000}}
    expected='strategies.0.steps.0' if field=='steps' else 'strategies.0.rationale'
    assert {'field':expected,'type':'unsupported_ads_budget'} in semantic_diagnostics(plan,facts)


def test_recorded_ad_spend_is_allowed_in_rationale_but_not_invented_as_a_daily_or_step_budget():
    plan=model_plan();strategy=plan['strategies'][0]
    strategy['rationale']='Chi quảng cáo đã ghi nhận 50.000 VND trong cùng kỳ 30 ngày.'
    strategy['steps']=['Yêu cầu người bán xác nhận trần ngân sách trước khi chạy; đối chiếu ROAS hòa vốn.']
    facts={'metrics.ad_spend':{'value':50000}}
    assert not any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,facts))
    assert any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,{}))
    strategy['rationale']='Chi quảng cáo đã ghi nhận 50.000 VND/ngày.'
    assert any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,facts))
    strategy['rationale']='Ngân sách hiện tại 50.000 VND.'
    assert any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,facts))


def test_ad_budget_guard_does_not_confuse_cpa_money_or_counts_with_a_budget_or_apply_to_other_channels():
    plan=model_plan();strategy=plan['strategies'][0]
    strategy['rationale']='CPA hiện tại 50.000 VND cần được đối soát, chưa quyết định ngân sách.'
    strategy['steps']=['Ghi nhận 50 lượt nhấp trong 3 ngày trước khi đối soát ROAS.']
    assert not any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,{}))
    strategy['rationale']='Chỉ số CPA hiện tại 50.000 VND, chưa quyết định ngân sách.'
    assert not any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,{}))
    strategy['channel']='price';strategy['steps']=['Đặt giá tham khảo 50.000 VND sau khi đối chiếu chi phí.']
    assert not any(item['type']=='unsupported_ads_budget' for item in semantic_diagnostics(plan,{}))


def test_service_posting_steps_cannot_turn_stainless_material_into_a_no_rust_guarantee():
    plan=model_plan();plan['strategies'][0]['channel']='service'
    plan['strategies'][0]['steps']=["Thêm badge 'Đảm bảo không gỉ 304 - Đổi trả nếu lỗi'."]
    facts={'detail.description':{'value':'Thép không gỉ: bền, chắc, hạn chế gỉ sét.'}}
    assert {'field':'strategies.0.steps.0','type':'unsupported_marketing_claim'} in semantic_diagnostics(plan,facts)
    plan['strategies'][0]['steps']=['Kiểm tra độ bền và chính sách đổi trả trước khi đăng cam kết.']
    assert not any(d['type']=='unsupported_marketing_claim' for d in semantic_diagnostics(plan,facts))


def test_unobserved_video_is_not_a_confirmed_missing_video():
    plan=model_plan();plan['summary']='Chưa có video và chưa xác nhận combo bán kèm.'
    facts={'detail.video_status':{'value':'unknown'}}
    assert {'field':'summary','type':'unsupported_video_claim'} in semantic_diagnostics(plan,facts)
    plan['summary']='Chưa quan sát video nên cần kiểm tra nội dung hiện có trước khi quay mới.'
    assert not any(d['type']=='unsupported_video_claim' for d in semantic_diagnostics(plan,facts))
    plan['summary']='Chưa có video.'
    facts['detail.video_status']['value']='observed_none'
    assert not any(d['type']=='unsupported_video_claim' for d in semantic_diagnostics(plan,facts))


def test_ad_financial_diagnostics_are_safe_and_offer_targeted_repair_instructions():
    diagnostics=[{'field':'strategies.0.stop','type':'unsafe_ads_threshold'},
                 {'field':'strategies.0.steps.0','type':'unsupported_ads_budget'}]
    assert [item['type'] for item in safe_diagnostics([{'loc':('strategies',0,'stop'),'type':'unsafe_ads_threshold'},
                                                    {'loc':('strategies',0,'steps',0),'type':'unsupported_ads_budget'}],{'strategies','stop','steps'})]==[item['type'] for item in diagnostics]
    from seller_ai_runtime import repair_task
    instructions=' '.join(repair_task(diagnostics)['corrections'])
    assert 'metrics.break_even_roas' in instructions and 'người bán xác nhận trần ngân sách' in instructions


@pytest.mark.parametrize('text',[
    'Biên lợi nhuận đóng góp dương (2.404.400 VND/đơn).',
    'Lãi đóng góp là 2,404,400 VND mỗi đơn.',
    'Contribution per order: 2.404.400 đồng.',
])
def test_quoted_contribution_money_cannot_multiply_engine_amount_by_a_thousand(text):
    plan=model_plan();plan['summary']=text
    assert {'field':'summary','type':'computed_money_mismatch'} in semantic_diagnostics(plan,{'metrics.contribution_per_order':{'value':2404.4}})


@pytest.mark.parametrize('amount',['2404.4','2.404,4','2,404.40','2.404','2404','2,404'])
def test_contribution_money_accepts_common_vnd_formats_and_rounding(amount):
    plan=model_plan();plan['summary']=f'Lãi đóng góp dương ({amount} VND/đơn).'
    assert not any(item['type']=='computed_money_mismatch' for item in semantic_diagnostics(plan,{'metrics.contribution_per_order':{'value':2404.4}}))


@pytest.mark.parametrize('text',[
    'Biên đóng góp 3.76%, giá bán 63.920 VND.',
    'Lãi đóng góp cần được đối chiếu với giá bán 63.920 VND.',
    'Giá bán hiện tại 63.920 VND; xem lãi đóng góp từ engine.',
    'Lãi đóng góp chưa được xác minh; giá sản phẩm 63.920 VND.',
])
def test_contribution_quote_guard_does_not_compare_percent_margin_or_other_selling_price(text):
    plan=model_plan();plan['summary']=text
    assert not any(item['type']=='computed_money_mismatch' for item in semantic_diagnostics(plan,{'metrics.contribution_per_order':{'value':2404.4}}))


def test_money_comparison_requires_a_known_engine_amount_and_also_checks_strategy_rationale():
    plan=model_plan();plan['strategies'][0]['rationale']='Lãi đóng góp 2.404.400 VND/đơn.'
    assert not any(item['type']=='computed_money_mismatch' for item in semantic_diagnostics(plan,{}))
    assert {'field':'strategies.0.rationale','type':'computed_money_mismatch'} in semantic_diagnostics(plan,{'optimizer.contribution_per_order':{'value':2404.4}})


@pytest.mark.parametrize('text',[
    'Chưa có doanh thu 30 ngày nên không thể tính ROAS thực tế hay điểm hòa vốn.',
    'Chưa thể tính ROAS hòa vốn.',
    'Không thể tính điểm hòa vốn khi chưa có doanh thu.',
])
def test_break_even_cannot_be_claimed_missing_when_engine_already_computed_it(text):
    plan=model_plan();plan['strategies'][0]['rationale']=text
    assert {'field':'strategies.0.rationale','type':'computed_break_even_missing'} in semantic_diagnostics(plan,{'metrics.break_even_roas':{'value':26.5515}})
    assert not any(item['type']=='computed_break_even_missing' for item in semantic_diagnostics(plan,{}))


@pytest.mark.parametrize('text',[
    'Chưa thể tính ROAS thực tế vì thiếu doanh thu 30 ngày.',
    'Không thể tính ROAS thực tế nhưng đã có điểm hòa vốn từ engine.',
    'Chưa thể tính ROAS thực tế; cần xác minh chi phí và điểm hòa vốn đã ghi nhận.',
    'Cần xác minh lại ROAS hòa vốn theo chi phí đã nhập.',
    'Chưa thể tính ROAS thực tế, cần đối chiếu điểm hòa vốn từ engine.',
])
def test_missing_actual_roas_or_verifying_existing_break_even_is_not_a_missing_break_even_claim(text):
    plan=model_plan();plan['strategies'][0]['rationale']=text
    assert not any(item['type']=='computed_break_even_missing' for item in semantic_diagnostics(plan,{'metrics.break_even_roas':{'value':26.5515}}))


def test_computed_money_and_break_even_diagnostics_have_safe_codes_and_repair_guidance():
    errors=[{'loc':('summary',),'type':'computed_money_mismatch'},
            {'loc':('strategies',0,'rationale'),'type':'computed_break_even_missing'}]
    diagnostics=safe_diagnostics(errors,{'summary','strategies','rationale'})
    assert [item['type'] for item in diagnostics]==['computed_money_mismatch','computed_break_even_missing']
    from seller_ai_runtime import repair_task
    instructions=' '.join(repair_task(diagnostics)['corrections'])
    assert 'VND' in instructions and 'ROAS thực tế còn thiếu' in instructions


@pytest.mark.parametrize('text',[
    'Ảnh hiện tại mờ.',
    'Ảnh hiện tại chưa rõ quy cách.',
    'Listing thiếu phân loại.',
    'Sản phẩm chưa có biến thể.',
    'Chụp ảnh mới vì ảnh hiện tại mờ.',
    'Kiểm tra kho: listing thiếu phân loại.',
])
def test_verification_exceptions_do_not_allow_assertions_of_unobserved_listing_defects(text):
    plan=model_plan();plan['summary']=text
    assert semantic_diagnostics(plan,{})


@pytest.mark.parametrize('draft',[
    'Rây tách bã hoàn toàn.', 'Không bám bẩn.', 'Phù hợp mọi loại nồi.',
    'Giống hình 100%.', 'Tay cầm không bị bỏng.', 'Rây chống gỉ sét.',
])
def test_marketing_guard_does_not_upgrade_source_qualifications(draft):
    plan=model_plan();plan['listing_drafts']['description']=draft
    facts={'detail.description':{'value':'Rây inox hạn chế gỉ sét, tay cầm bằng nhựa.'}}
    assert {'field':'listing_drafts.description','type':'unsupported_marketing_claim'} in semantic_diagnostics(plan,facts)
    facts['detail.description']['value']=draft
    assert semantic_diagnostics(plan,facts)==[]


def test_stainless_material_does_not_authorize_anti_rust_guarantee_alternative():
    facts={'detail.description':{'value':'Rây bằng thép không gỉ, hạn chế gỉ sét. Tay cầm nhựa.'}}
    plan=model_plan();plan['listing_drafts']['description']='Rây chống gỉ hoàn toàn.'
    assert {'field':'listing_drafts.description','type':'unsupported_marketing_claim'} in semantic_diagnostics(plan,facts)
    plan['listing_drafts']['description']='Rây chống gỉ.'
    assert {'field':'listing_drafts.description','type':'unsupported_marketing_claim'} in semantic_diagnostics(plan,facts)
    plan['listing_drafts']['description']='Rây bằng thép không gỉ, hạn chế gỉ sét.'
    assert semantic_diagnostics(plan,facts)==[]


def test_new_shooting_briefs_are_not_treated_as_observations_of_existing_pixels():
    plan=model_plan();plan['listing_drafts']['image_briefs']=['Kiểm tra ảnh mờ rồi chụp mới rõ quy cách.']
    plan['listing_drafts']['video_script']=['Thử cảnh minh họa tay cầm, không khẳng định không bị bỏng.']
    assert semantic_diagnostics(plan,{})==[]


def test_populated_fact_ids_cannot_be_claimed_missing_but_zero_false_and_unknown_are_distinguished():
    plan=model_plan()
    plan['diagnosis'][0]['missing']=['product.name','detail.description','product.stock','optimizer.cost_complete',
        'metrics.roas','detail.variants','empty.object','empty.text','detail.variant_status','Free prose needing confirmation']
    facts={'product.name':{'value':'Đã có tên'},'detail.description':{'value':'Đã có mô tả'},
           'product.stock':{'value':0},'optimizer.cost_complete':{'value':False},'metrics.roas':{'value':None},
           'detail.variants':{'value':[]},'empty.object':{'value':{}},'empty.text':{'value':'   '},
           'detail.variant_status':{'value':'unknown'}}
    assert semantic_diagnostics(plan,facts)==[{'field':f'diagnosis.0.missing.{index}','type':'fact_present'} for index in range(4)]


def test_evidence_keeps_all_bounded_catalog_values_beyond_the_old_650_character_preview():
    candidates=[{'sku':f'12.{index}','name':'Sản phẩm '+str(index)+' '+('mô tả '*40)} for index in range(5)]
    facts={'catalog.same_shop_candidates':{'label':'Ứng viên cùng shop; chưa xác minh combo','value':candidates}}
    rendered=seller_ai.SellerAIService._render_evidence(['catalog.same_shop_candidates'],facts)[0]
    assert len(rendered)>650 and '12.4' in rendered
    assert json.loads(rendered.split(': ',1)[1])==candidates


def test_default_generate_transport_is_explicit_fixed_loopback_and_rejects_unsafe_payloads(monkeypatch):
    requests=[]
    class Response:
        def __enter__(self):return self
        def __exit__(self,*unused):return False
        def read(self,*unused):return b'{"done":true,"response":"{}","eval_count":4}'
    class Opener:
        def open(self,request,**kwargs):requests.append(request);return Response()
    monkeypatch.setattr(seller_ai.urllib.request,'build_opener',lambda *handlers:Opener())
    monkeypatch.setenv('OLLAMA_HOST','https://remote.invalid')
    payload={'model':'qwen3.5:9b','system':'System instructions','prompt':'Untrusted source data',
             'format':{'type':'object'},'stream':False,'think':False,
             'options':{'num_ctx':12288,'num_predict':4096,'temperature':.25,'presence_penalty':0,'repeat_penalty':1,'top_p':.9}}
    result=seller_ai.request_ollama('/api/generate',payload)
    assert result['response']=='{}' and result['eval_count']==4
    assert requests[0].full_url=='http://127.0.0.1:11434/api/generate'
    assert json.loads(requests[0].data)==payload
    for change in ({'model':'qwen3.5:cloud'},{'endpoint':'https://remote.invalid'},
                   {'stream':True},{'think':True},{'format':'json'},
                   {'options':{'api_key':'PRIVATE'}},{'options':{'temperature':float('nan')}},
                   {'options':{'num_predict':1.5}},{'options':{'num_ctx':1000000}}):
        with pytest.raises(ValueError):seller_ai.request_ollama('/api/generate',{**payload,**change})
    with pytest.raises(ValueError):seller_ai.request_ollama('/api/chat',payload)
    assert len(requests)==1


def sequence_transport(workspace,plans,*,on_chat=None):
    stub=workspace['stub'];set_model_plan(workspace)
    counter={'count':0}
    def transport(path,payload=None,timeout=3):
        if path=='/api/generate':
            index=counter['count'];counter['count']+=1
            if on_chat:on_chat(index,payload,timeout)
            answer=plans[min(index,len(plans)-1)]
            if 'fields_to_rewrite' in json.loads(payload['prompt']) and 'strategies' in answer:
                patch={}
                for key in payload['format']['properties']:
                    value=answer
                    for part in key.split('.'):
                        value=value[int(part)] if isinstance(value,list) else value[part]
                    patch[key]=value
                answer=patch
            stub.reply={'done':True,'done_reason':'stop','response':json.dumps(answer,ensure_ascii=False),
                        'prompt_eval_count':100+index,'eval_count':50+index,'total_duration':400_000_000+index*100_000_000}
        return stub(path,payload,timeout)
    workspace['service'].transport=transport
    return counter


def test_one_schema_repair_keeps_model_and_facts_and_reports_safe_diagnostics_and_progress(ai_workspace):
    invalid=model_plan();invalid['strategies'][0].pop('hypothesis')
    invalid['strategies'][0]['PRIVATE-EXTRA-KEY']='PRIVATE-INVALID-OUTPUT'
    entered=threading.Event();release=threading.Event()
    def on_chat(index,payload,timeout):
        if index==1:
            entered.set();assert release.wait(3)
    count=sequence_transport(ai_workspace,[invalid,model_plan()],on_chat=on_chat)
    created=enqueue(ai_workspace);assert entered.wait(2)
    running=job(ai_workspace,created.json()['job_id']).json()
    assert running['status']=='running' and running['phase']=='repairing'
    assert running['telemetry']['repair_count']==1
    release.set();result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['failure_code']=='' and count['count']==2
    assert result['telemetry']['attempt_count']==2 and result['telemetry']['repair_count']==1
    assert result['telemetry']['input_format']=='compact_facts_v1'
    assert result['telemetry']['prompt_eval_count']==201 and result['telemetry']['eval_count']==101
    assert result['telemetry']['duration_ms']>=0 and result['telemetry']['queue_duration_ms']>=0
    assert [item['status'] for item in result['telemetry']['attempts']]==['schema_invalid','accepted']
    assert {'attempt':1,'field':'strategies.0.hypothesis','type':'missing'} in result['validation_diagnostics']
    calls=ai_workspace['stub'].inference_calls
    assert [item['payload']['model'] for item in calls]==[seller_ai.DEFAULT_MODEL]*2
    for index,call in enumerate(calls):
        assert call['payload']['options']=={'num_ctx':12288,'num_predict':6144,'temperature':.15 if index else .25,
                                            'presence_penalty':0,'repeat_penalty':1,'top_p':.9}
        assert call['payload']['format']['properties']['strategies']['maxItems']==8
        catalog_keys=sorted(json.loads(call['payload']['prompt'])['facts'])
        assert call['payload']['format']['$defs']['Strategy']['properties']['evidence_ids']['items']['enum']==catalog_keys
    inputs=[json.loads(item['payload']['prompt']) for item in calls]
    assert inputs[0]['facts']==inputs[1]['facts']
    assert 'output_schema' not in inputs[0] and 'output_schema' not in inputs[1]
    assert inputs[0]['response_contract']==inputs[1]['response_contract']==response_contract(calls[0]['payload']['format'])
    assert isinstance(inputs[0]['response_contract']['diagnosis'],list)
    assert 'contract_note' in inputs[0] and 'contract_note' in inputs[1]
    assert 'validation_errors' in inputs[1]
    assert 'PRIVATE-' not in json.dumps(result)
    assert 'PRIVATE-' not in calls[1]['payload']['prompt']
    with ai_workspace['db']() as connection:
        row=dict(connection.execute('SELECT * FROM seller_ai_jobs WHERE id=?',(result['job_id'],)).fetchone())
    assert 'PRIVATE-' not in json.dumps(row)
    catalog=json.loads(row['facts_json'])
    assert inputs[0]['facts']=={key:item['value'] for key,item in catalog.items()}
    assert catalog==result['result']['evidence_catalog']
    assert len(json.dumps(inputs[0]['facts']))<len(json.dumps(catalog))
    assert 'VND' in inputs[0]['data_contract'] and 'null' in inputs[0]['data_contract']
    assert inputs[0]['data_contract']==inputs[1]['data_contract']


@pytest.mark.parametrize('text',[
    'Ảnh hiện tại chưa rõ.', 'Listing thiếu phân loại.', 'Lợi nhuận gộp tốt.',
])
def test_semantic_failure_can_be_repaired_once_by_model(ai_workspace,text):
    invalid=model_plan();invalid['summary']=text
    count=sequence_transport(ai_workspace,[invalid,model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and count['count']==2
    assert result['telemetry']['repair_count']==1 and result['validation_diagnostics'][0]['type'].startswith('unsupported_')
    assert result['result']['summary']==model_plan()['summary']
    assert result['telemetry']['repair_mode']=='targeted'
    calls=ai_workspace['stub'].inference_calls
    assert set(calls[1]['payload']['format']['properties'])=={'summary'}
    assert calls[1]['payload']['options']['num_predict']<calls[0]['payload']['options']['num_predict']
    assert json.loads(calls[0]['payload']['prompt'])['facts']==json.loads(calls[1]['payload']['prompt'])['facts']
    assert len(calls[1]['payload']['system'])<len(calls[0]['payload']['system'])
    assert text not in calls[1]['payload']['prompt']


def test_false_missing_fact_is_repaired_with_same_full_catalog(ai_workspace):
    invalid=model_plan();invalid['diagnosis'][0]['missing']=['product.name','detail.description']
    corrected=model_plan();corrected['diagnosis'][0]['missing']=[]
    count=sequence_transport(ai_workspace,[invalid,corrected])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and count['count']==2
    assert result['telemetry']['route']=='/api/generate'
    assert len(result['validation_diagnostics'])==2 and all(item['type']=='fact_present' for item in result['validation_diagnostics'])
    assert all(item['path']=='/api/generate' for item in ai_workspace['stub'].inference_calls)


def test_repair_is_bounded_to_one_attempt_and_persists_failure_location_without_raw_output(ai_workspace):
    invalid=model_plan();invalid['strategies'][0]['tradeoff']=''
    count=sequence_transport(ai_workspace,[invalid])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='failed' and result['result'] is None and count['count']==2
    assert result['failure_code']=='schema_invalid' and result['telemetry']['repair_count']==1
    assert {item['attempt'] for item in result['validation_diagnostics']}=={1,2}
    assert all(item['field']=='strategies.0.tradeoff' for item in result['validation_diagnostics'])


def test_complete_fenced_valid_plan_is_accepted_without_a_model_repair(ai_workspace):
    set_model_plan(ai_workspace)
    ai_workspace['stub'].reply['response']='```json\n'+json.dumps(model_plan(),ensure_ascii=False)+'\n```'
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_count']==0
    assert len(ai_workspace['stub'].inference_calls)==1


def test_json_error_diagnostics_store_position_only_without_rejected_model_text(ai_workspace):
    text='```json\n{"summary":"PRIVATE-REJECTED-TEXT", bad}\n```'
    set_model_plan(ai_workspace,response=text)
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='failed' and result['failure_code']=='json_invalid'
    assert result['telemetry']['repair_count']==1 and len(result['validation_diagnostics'])==2
    assert all(isinstance(item['json_error_position'],int) and 0<=item['json_error_position']<=len(text)
               for item in result['validation_diagnostics'])
    assert 'PRIVATE-' not in json.dumps(result)
    assert 'PRIVATE-' not in ai_workspace['stub'].inference_calls[1]['payload']['prompt']


@pytest.mark.parametrize('changes',[{'done':False},{'done_reason':'length'},{'refusal':'no','response':'{}'}])
def test_refusal_and_truncation_are_terminal_without_automatic_repeat(ai_workspace,changes):
    set_model_plan(ai_workspace,**changes)
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='failed' and len(ai_workspace['stub'].inference_calls)==1
    assert result['telemetry']['repair_count']==0 and result['failure_code'] in ('truncated','refusal')


def test_repair_uses_remaining_total_deadline_not_another_full_300_seconds(ai_workspace,monkeypatch):
    clock={'value':0};monkeypatch.setattr(seller_ai,'time',SimpleNamespace(monotonic=lambda:clock['value']))
    invalid=model_plan();invalid['strategies'][0].pop('priority_tier')
    timeouts=[]
    def on_chat(index,payload,timeout):
        timeouts.append(timeout)
        if index==0:clock['value']=250
    sequence_transport(ai_workspace,[invalid,model_plan()],on_chat=on_chat)
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and timeouts==[300,50]


def test_old_saved_plan_fields_remain_readable_without_revalidation_or_network(ai_workspace):
    sequence_transport(ai_workspace,[model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    old=copy.deepcopy(result['result'])
    for item in old['strategies']:
        for key in ('hypothesis','tradeoff','priority_tier'):item.pop(key)
    with ai_workspace['db']() as connection:
        connection.execute('UPDATE seller_ai_jobs SET result_json=? WHERE id=?',(json.dumps(old),result['job_id']))
    reads=len(ai_workspace['stub'].calls)
    reread=job(ai_workspace,result['job_id']).json()
    assert reread['status']=='done' and 'hypothesis' not in reread['result']['strategies'][0]
    assert len(ai_workspace['stub'].calls)==reads


def test_public_running_job_derives_elapsed_time_without_persisting_it(ai_workspace,monkeypatch):
    sequence_transport(ai_workspace,[model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    with ai_workspace['db']() as connection:
        connection.execute("UPDATE seller_ai_jobs SET status='running',created_at=?,started_at=?,telemetry_json=? WHERE id=?",
                           ('2026-10-17T03:00:00Z','2026-10-17T03:00:03Z',json.dumps({'duration_ms':4.2,'phase':'generating'}),result['job_id']))
    monkeypatch.setattr(seller_ai,'_now',lambda:'2026-10-17T03:00:15Z')
    current=job(ai_workspace,result['job_id']).json()
    assert current['telemetry']['duration_ms']==12_000 and current['phase']=='generating'
    with ai_workspace['db']() as connection:
        stored=json.loads(connection.execute('SELECT telemetry_json FROM seller_ai_jobs WHERE id=?',(result['job_id'],)).fetchone()[0])
    assert stored['duration_ms']==4.2
