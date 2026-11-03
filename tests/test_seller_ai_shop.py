"""Shop-wide AI overview: one bounded call, product refs mapped back to real SKUs."""
import json
import sqlite3
import time

from seller_ai import SellerAIService
from seller_ai_shop import ShopAI, build_shop_facts
from tests.test_seller_ai import MODEL, StubOllama, make_analysis


def make_shop_ai(tmp_path, stub):
    path = tmp_path / 'ai.db'
    def db():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn
    analysis = make_analysis()
    service = SellerAIService(db, lambda shop_id: analysis, transport=stub)
    return ShopAI(service), service


def wait_done(shop_ai, shop_id='shop-a'):
    for _ in range(100):
        job = shop_ai.latest(shop_id)['job']
        if job['status'] in ('done', 'failed'):
            return shop_ai.latest(shop_id)
        time.sleep(.05)
    raise AssertionError('job did not finish')


def reply(refs):
    return {'response': json.dumps({
        'summary': 'Shop có 2 sản phẩm 下架.', 'priorities': [{'title': 'Ưu tiên', 'product_refs': refs,
        'why': 'Lý do', 'action': 'Việc làm'}], 'quick_wins': [], 'risks': [], 'data_gaps': []}),
        'done': True, 'done_reason': 'stop', 'eval_count': 100}


def test_facts_omit_missing_values_and_label_cumulative_sales(tmp_path):
    facts = build_shop_facts(make_analysis())
    assert facts['product_count'] == 2 and facts['_skus']
    assert all('sold_cumulative' in row or 'sold_total' not in row for row in facts['products'])
    assert all(None not in row.values() for row in facts['products'])


def test_job_maps_refs_to_real_skus_and_drops_invented_ones(tmp_path):
    stub = StubOllama(); stub.error = None; stub.reply = reply([1, 99])
    shop_ai, _ = make_shop_ai(tmp_path, stub)
    assert shop_ai.start('shop-a')['status'] == 'queued'
    state = wait_done(shop_ai)
    assert state['job']['status'] == 'done'
    priority = state['result']['priorities'][0]
    assert priority['products'][0]['sku'] in {'12.1', '12.2'}
    assert len(priority['products']) == 1 and 'product_refs' not in priority
    assert '下架' not in state['result']['summary']
    generate_calls = [c for c in stub.calls if c['path'] == '/api/generate']
    assert len(generate_calls) == 1 and generate_calls[0]['payload']['options']['num_predict'] <= 1500


def test_unchanged_shop_reuses_saved_result_without_another_model_call(tmp_path):
    stub = StubOllama(); stub.error = None; stub.reply = reply([1])
    shop_ai, _ = make_shop_ai(tmp_path, stub)
    shop_ai.start('shop-a'); wait_done(shop_ai)
    again = shop_ai.start('shop-a')
    assert again['cached'] is True and again['status'] == 'done'
    assert len([c for c in stub.calls if c['path'] == '/api/generate']) == 1


def test_incomplete_model_output_fails_without_saving_a_result(tmp_path):
    stub = StubOllama(); stub.error = None; stub.reply = {'response': '{"summary":', 'done': True, 'done_reason': 'length'}
    shop_ai, _ = make_shop_ai(tmp_path, stub)
    shop_ai.start('shop-a')
    state = wait_done(shop_ai)
    assert state['job']['status'] == 'failed' and state['result'] is None
