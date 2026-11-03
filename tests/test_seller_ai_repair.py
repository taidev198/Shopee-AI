import copy
import json

import pytest

import seller_ai
from seller_ai_repair import targeted_repair, merge_model_patch
from seller_ai_runtime import generation_schema, semantic_diagnostics
from test_seller_ai import ai_workspace, model_plan, enqueue, completed_job
from test_seller_ai_runtime import sequence_transport


def test_only_flagged_fields_can_change_and_original_plan_is_untouched():
    candidate=model_plan();original=copy.deepcopy(candidate)
    schema=generation_schema(seller_ai.ModelPlan.model_json_schema(),{'product.name':{'value':'Hộp'}})
    repair=targeted_repair(candidate,[{'field':'summary'},{'field':'strategies.1.steps.0'}],schema)
    assert set(repair['schema']['required'])=={'summary','strategies.1.steps.0'}
    assert repair['token_budget']<4096
    result=merge_model_patch(repair,{'summary':'Thông tin cần đối soát.','strategies.1.steps.0':'Kiểm tra ảnh với sản phẩm mẫu.'})
    assert result['summary']=='Thông tin cần đối soát.'
    assert result['strategies'][0]==candidate['strategies'][0]
    assert result['strategies'][1]['steps'][1:]==candidate['strategies'][1]['steps'][1:]
    assert candidate==original
    for patch in ({'summary':'x'},{'summary':'x','strategies.1.steps.0':'x','ads_decision':'controlled_scale'},None):
        with pytest.raises(ValueError):merge_model_patch(repair,patch)


def test_long_overview_repairs_have_room_for_complete_prose_and_preserve_correct_numbers():
    candidate=model_plan();candidate['summary']='Tổng quan có số liệu đúng và các điều kiện kinh doanh. '*40
    schema=generation_schema(seller_ai.ModelPlan.model_json_schema())
    repair=targeted_repair(candidate,[{'field':'summary','type':'unsupported_orders_claim'},
                                      {'field':'listing_drafts.description','type':'unsupported_marketing_claim'}],schema)
    assert 2048<=repair['token_budget']<=3072
    assert 'pattern' not in repair['schema']['properties']['summary']
    assert 'maxLength' not in repair['schema']['properties']['summary']
    corrected='Đã bán cộng dồn 100 sản phẩm, không phải số đơn trong 30 ngày.'
    result=merge_model_patch(repair,{'summary':corrected,'listing_drafts.description':'Mô tả đúng thông tin sản phẩm đã ghi nhận.'})
    assert result['summary']==corrected
    assert result['strategies']==candidate['strategies']


def test_rich_diagnosis_is_saved_and_semantically_checked(ai_workspace):
    candidate=model_plan()
    candidate['diagnosis'][0].update(insight='Dữ liệu hiện có cần đối soát trước khi thử quảng cáo.',
                                     recommendation='Xác nhận trần chi và cơ sở chi phí của đúng SKU.')
    sequence_transport(ai_workspace,[candidate])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done'
    assert result['result']['diagnosis'][0]['insight']==candidate['diagnosis'][0]['insight']
    assert result['result']['diagnosis'][0]['recommendation']==candidate['diagnosis'][0]['recommendation']
    candidate['diagnosis'][0]['insight']='Ảnh hiện tại mờ.'
    assert {'field':'diagnosis.0.insight','type':'unsupported_image_claim'} in semantic_diagnostics(candidate,{})


def test_missing_required_string_fields_are_filled_by_model_without_rewriting_plan(ai_workspace):
    invalid=model_plan()
    for item in invalid['strategies']:
        item.pop('confidence');item.pop('priority_tier')
    sequence_transport(ai_workspace,[invalid,model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_mode']=='targeted'
    calls=ai_workspace['stub'].inference_calls
    assert set(calls[1]['payload']['format']['properties'])=={f'strategies.{n}.{key}' for n in range(len(invalid['strategies'])) for key in ('confidence','priority_tier')}
    assert result['result']['summary']==invalid['summary']
    assert calls[1]['payload']['options']['num_predict']<3072


def test_missing_fields_and_semantic_error_are_fixed_together_in_one_small_response(ai_workspace):
    invalid=model_plan();invalid['strategies'][0].pop('confidence');invalid['summary']='Ảnh hiện tại mờ.'
    sequence_transport(ai_workspace,[invalid,model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_mode']=='targeted'
    patch=ai_workspace['stub'].inference_calls[1]['payload']
    assert set(patch['format']['properties'])=={'summary','strategies.0.confidence'}
    assert 'Ảnh hiện tại mờ.' not in patch['prompt']


def test_wrong_enum_and_missing_field_are_repaired_together_without_replaying_bad_value(ai_workspace):
    invalid=model_plan();invalid['diagnosis'][0]['channel']='PRIVATE-INVALID-CHANNEL'
    invalid['strategies'][0].pop('confidence')
    sequence_transport(ai_workspace,[invalid,model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_mode']=='targeted'
    patch=ai_workspace['stub'].inference_calls[1]['payload']
    assert set(patch['format']['properties'])=={'diagnosis.0.channel','strategies.0.confidence'}
    assert 'PRIVATE-' not in patch['prompt']


def test_invalid_type_with_missing_field_uses_full_validation_repair(ai_workspace):
    invalid=model_plan();invalid['strategies'][0].pop('confidence');invalid['strategies'][0]['steps']='not a list'
    sequence_transport(ai_workspace,[invalid,model_plan()])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_mode']=='full'


def test_missing_object_or_intermediate_path_never_gets_partial_repair():
    candidate=model_plan();candidate.pop('listing_drafts')
    schema=generation_schema(seller_ai.ModelPlan.model_json_schema())
    assert targeted_repair(candidate,[{'field':'listing_drafts'}],schema) is None
    assert targeted_repair(candidate,[{'field':'listing_drafts.description'}],schema) is None


def test_more_than_sixteen_missing_errors_do_not_hide_unrepaired_fields(ai_workspace):
    invalid=model_plan();invalid['strategies']=[copy.deepcopy(invalid['strategies'][0]) for _ in range(8)]
    invalid.pop('summary')
    for item in invalid['strategies']:
        item.pop('confidence');item.pop('priority_tier')
    with pytest.raises(seller_ai.AIResultError) as caught:
        ai_workspace['service']._validate_result({'done':True,'response':json.dumps(invalid)}, {}, {})
    assert caught.value.code=='schema_invalid'
    assert caught.value.candidate is None and len(caught.value.diagnostics)==16


def test_missing_item_repairs_whole_missing_array_with_grounded_ids():
    candidate=model_plan();candidate['diagnosis'][0]['missing']=['product.name']
    facts={'product.name':{'value':'Hộp'},'metrics.ad_spend':{'value':None}}
    repair=targeted_repair(candidate,[{'field':'diagnosis.0.missing.0'}],generation_schema(seller_ai.ModelPlan.model_json_schema(),facts))
    assert list(repair['fields'])==['diagnosis.0.missing']
    assert merge_model_patch(repair,{'diagnosis.0.missing':[]})['diagnosis'][0]['missing']==[]
    with pytest.raises(ValueError):merge_model_patch(repair,{'diagnosis.0.missing':['product.name']})
    assert candidate['diagnosis'][0]['missing']==['product.name']


@pytest.mark.parametrize('path',['ads_decision','strategies.99.steps.0','strategies.0','__class__.secret','summary.extra'])
def test_invalid_or_nontext_paths_do_not_create_targeted_repairs(path):
    assert targeted_repair(model_plan(),[{'field':path}],generation_schema(seller_ai.ModelPlan.model_json_schema())) is None


def test_patch_still_runs_full_plan_validation_and_cannot_introduce_unobserved_claims(ai_workspace):
    invalid=model_plan();invalid['summary']='Ảnh hiện tại mờ.'
    sequence_transport(ai_workspace,[invalid,{'summary':'Listing thiếu phân loại.'}])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='failed' and result['failure_code']=='unsupported_claim'
    assert result['telemetry']['repair_mode']=='targeted'
    assert len(ai_workspace['stub'].inference_calls)==2


def test_patch_cannot_change_unflagged_fields_even_with_valid_values(ai_workspace):
    invalid=model_plan();invalid['summary']='Ảnh hiện tại mờ.'
    sequence_transport(ai_workspace,[invalid,{'summary':'Cần kiểm tra.','ads_decision':'controlled_scale'}])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='failed' and result['failure_code']=='patch_invalid'
    assert result['result'] is None
    with ai_workspace['db']() as c:
        row=dict(c.execute('select * from seller_ai_jobs where id=?',(result['job_id'],)).fetchone())
    assert 'Ảnh hiện tại mờ.' not in json.dumps(row,ensure_ascii=False)


def test_partial_correction_still_checks_financial_eligibility_of_unchanged_fields(ai_workspace):
    invalid=model_plan();invalid['summary']='Ảnh hiện tại mờ.';invalid['ads_decision']='controlled_scale'
    sequence_transport(ai_workspace,[invalid,{'summary':'Cần đối chiếu dữ liệu bán hàng.'}])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='failed' and result['failure_code']=='unsafe_ads_scale'
    assert result['result'] is None and result['telemetry']['repair_mode']=='targeted'


def test_model_repairs_only_unsupported_ad_budget_before_saving_plan(ai_workspace):
    invalid=model_plan()
    invalid['strategies'][0]['steps']=['Chạy quảng cáo với ngân sách 50.000 VND/ngày trong 3 ngày.']
    safe_step='Xác nhận trần ngân sách với người bán và đối chiếu điểm hòa vốn trước khi thử.'
    sequence_transport(ai_workspace,[invalid,{'strategies.0.steps.0':safe_step}])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_mode']=='targeted'
    assert result['result']['strategies'][0]['steps']==[safe_step]
    assert result['result']['summary']==invalid['summary']
    patch=ai_workspace['stub'].inference_calls[1]['payload']
    assert set(patch['format']['properties'])=={'strategies.0.steps.0'}
    assert '50.000 VND' not in patch['prompt']


def test_quoted_contribution_amount_is_checked_against_engine_before_saving(ai_workspace):
    ai_workspace['state']['shop-a']['products'][0]['metrics']['contribution_per_order']=2404.4
    invalid=model_plan();invalid['summary']='SKU có biên lợi nhuận đóng góp dương (2.404.400 VND/đơn).'
    fixed='Biên đóng góp cần được đọc cùng cơ sở chi phí trong dữ liệu engine.'
    sequence_transport(ai_workspace,[invalid,{'summary':fixed}])
    created=enqueue(ai_workspace);result=completed_job(ai_workspace,created.json()['job_id'])
    assert result['status']=='done' and result['telemetry']['repair_mode']=='targeted'
    assert result['result']['summary']==fixed
    assert result['result']['evidence_catalog']['metrics.contribution_per_order']['value']==2404.4
    assert set(ai_workspace['stub'].inference_calls[1]['payload']['format']['properties'])=={'summary'}


@pytest.mark.parametrize('text',['Tạo mã giảm giá 5-10% cho loại 2.','Áp dụng giảm giá 4,59%.'])
def test_discount_percent_requires_costs_and_strict_headroom(text):
    plan=model_plan();plan['strategies'][0]['steps']=[text]
    assert any(d['type']=='unsafe_promotion_value' for d in semantic_diagnostics(plan,{}))
    facts={'optimizer.cost_complete':{'value':True},'optimizer.max_discount_pct':{'value':4.59}}
    assert any(d['type']=='unsafe_promotion_value' for d in semantic_diagnostics(plan,facts))
    plan['strategies'][0]['steps']=['Kiểm tra chi phí trước khi quyết định mức ưu đãi.']
    assert not any(d['type']=='unsafe_promotion_value' for d in semantic_diagnostics(plan,facts))


def test_cumulative_sales_are_not_orders_when_order_data_is_unknown():
    plan=model_plan();plan['summary']='Tổng số đơn 39 và điểm đánh giá 5.0.'
    assert {'field':'summary','type':'unsupported_orders_claim'} in semantic_diagnostics(plan,{'product.sold_total':{'value':39}})
    plan['summary']='Đã bán cộng dồn 39 sản phẩm; chưa xác nhận số đơn 30 ngày.'
    assert not any(d['type']=='unsupported_orders_claim' for d in semantic_diagnostics(plan,{}))


def test_unexpected_cjk_is_repaired_without_rejecting_recorded_brand_characters():
    plan=model_plan();plan['summary']='Listing đã齐'
    assert {'field':'summary','type':'unsupported_language'} in semantic_diagnostics(plan,{})
    plan['summary']='Nhãn hiệu 小米 đã được ghi nhận.'
    assert not any(d['type']=='unsupported_language' for d in semantic_diagnostics(plan,{'product.name':{'value':'小米'}}))


def test_new_environmental_claim_is_not_published_without_source_and_verification_is_allowed():
    plan=model_plan();plan['strategies'][0]['channel']='positioning'
    plan['strategies'][0]['steps']=["Thêm từ khóa 'thân thiện môi trường' vào mô tả."]
    assert any(d['type']=='unsupported_marketing_claim' for d in semantic_diagnostics(plan,{}))
    plan['strategies'][0]['steps']=['Kiểm tra sản phẩm có chứng nhận xanh không trước khi quyết định nội dung.']
    assert not any(d['type']=='unsupported_marketing_claim' for d in semantic_diagnostics(plan,{}))
