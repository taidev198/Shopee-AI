import importlib
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setenv('MARKET_DB', str(tmp_path / 'market.db'))
    import app
    module = importlib.reload(app)
    return TestClient(module.app), module


def collect_batch(client, size=20):
    response = client.post('/api/category-market/campaigns', json={
        'categories': [{'name': 'Ngành kiểm thử', 'url': 'https://shopee.vn/Test-cat.1'}], 'full_scan': True})
    rid = response.json()['run_ids'][0]
    urls = [f'https://shopee.vn/product/{10 + i % 3}/{100 + i}' for i in range(size)]
    for page, start in enumerate(range(0, size, 100)):
        assert client.post(f'/api/category-market/runs/{rid}/listing', json={
            'page': page, 'urls': urls[start:start + 100], 'has_next': start + 100 < size}).status_code == 200
    for i, url in enumerate(urls):
        response = client.post(f'/api/category-market/runs/{rid}/detail', json={
            'url': url, 'name': f'Sản phẩm {i}', 'price_text': f'{50000 + i * 10000}₫',
            'sold_text': f'{100 + i * 20} Sold', 'review_count_text': f'{10 + i} đánh giá',
            'rating_text': '4.8'})
        assert response.status_code == 200, response.text
    return rid, urls


def test_analysis_is_independent_of_demo_shop_and_validates_filters(workspace):
    client, _ = workspace
    data = client.get('/api/category-market/analysis').json()
    assert data['summary']['product_count'] == 0
    assert data['model']['status'] == 'waiting'
    assert data['ml_candidates'] == []
    assert client.get('/api/category-market/ml/export').status_code == 404
    assert client.get('/api/category-market/analysis?days=0').status_code == 422
    assert client.get('/api/category-market/analysis?limit=101').status_code == 422
    assert client.get('/api/category-market/analysis?category_id=unknown').status_code == 404


def test_real_checkpoint_pipeline_automatically_trains_and_persists_model_across_restart(workspace):
    client, app = workspace
    rid, urls = collect_batch(client)
    data = client.get('/api/category-market/analysis').json()
    assert data['summary']['product_count'] == 20
    assert data['summary']['shop_count'] == 3
    assert data['summary']['day_count'] == 1
    assert data['trend_candidates'] == []  # One observation day cannot prove growth.
    assert data['model']['status'] == 'trained'
    assert data['model']['training_product_count'] >= 20
    assert data['model']['coverage_count'] == 20
    assert data['ml_candidates']
    assert all(p['ml_signal_score'] is not None for p in data['ml_candidates'])
    model_id = data['model']['model_id']
    artifact = client.get('/api/category-market/ml/export').json()
    assert artifact['model_id'] == model_id
    assert artifact['groups'][0]['centroids']
    with app.db() as c:
        assert c.execute('SELECT COUNT(*) FROM market_ml_models').fetchone()[0] == 1
        assert c.execute('SELECT COUNT(*) FROM market_ml_predictions').fetchone()[0] == 20
        assert c.execute('SELECT COUNT(*) FROM market_snapshots').fetchone()[0] == 20
    assert client.post(f'/api/category-market/runs/{rid}/detail', json={'url': urls[0], 'name': 'Replay'}).json() == {'saved': False}
    restarted = TestClient(importlib.reload(app).app)
    restored = restarted.get('/api/category-market/analysis?category_id=1').json()
    assert restored['model']['model_id'] == model_id
    assert restored['summary']['product_count'] == 20


def test_analysis_full_lists_retain_filtered_rankings_beyond_display_limits(workspace):
    client, _ = workspace
    collect_batch(client, size=105)
    limited = client.get('/api/category-market/analysis?limit=100').json()
    assert limited['summary']['product_count'] == 105
    assert len(limited['top_products']) == 100
    complete = client.get('/api/category-market/analysis?category_id=1&all_rows=true').json()
    assert len(complete['top_products']) == 105
    assert len({row['sku'] for row in complete['top_products']}) == 105
    assert complete['top_products'][0]['sold_total'] == 2180
    assert complete['top_products'][-1]['sold_total'] == 100
    assert len(complete['top_shops']) == 3
    assert len(complete['ml_candidates']) == 105


def test_automatic_learning_detects_same_day_corrections_and_changes_data_derived_insights(workspace):
    client, app = workspace
    collect_batch(client)
    before = client.get('/api/category-market/analysis').json()
    old_model = client.get('/api/category-market/ml/export').json()
    with app.db() as c:
        # Counts and timestamps stay unchanged: a time/count-only trigger misses this.
        c.execute('UPDATE market_snapshots SET price=999999,sold_total=999999,review_count=777 WHERE sku=?', ('10.100',))
    assert client.get('/api/category-market/analysis').json()['model']['stale'] is True
    app.app.state.market_learning.tick()
    after = client.get('/api/category-market/analysis').json()
    new_model = client.get('/api/category-market/ml/export').json()
    assert after['model']['model_id'] != before['model']['model_id']
    assert after['model']['stale'] is False
    assert new_model['groups'][0]['scaler'] != old_model['groups'][0]['scaler']
    old_leader = next(item for item in before['insights'] if item['kind'] == 'leading_product')
    new_leader = next(item for item in after['insights'] if item['kind'] == 'leading_product')
    assert old_leader['evidence']['sku'] != new_leader['evidence']['sku']
    assert new_leader['evidence']['sku'] == '10.100'
    assert '999.999' in new_leader['body']
    app.app.state.market_learning.tick()
    assert client.get('/api/category-market/analysis').json()['model']['model_id'] == after['model']['model_id']


def test_startup_worker_recovers_changed_database_without_a_manual_train_request(workspace):
    client, app = workspace
    collect_batch(client)
    before = client.get('/api/category-market/analysis').json()['model']['model_id']
    with app.db() as c:
        c.execute('UPDATE market_snapshots SET price=123456 WHERE sku=?', ('10.100',))
    with client:
        assert app.app.state.market_learning.ready.wait(timeout=5)
        data = client.get('/api/category-market/analysis').json()
        assert data['model']['model_id'] != before
        assert data['learning']['enabled'] is True
        assert data['learning']['running'] is True
        assert data['learning']['state'] == 'ready'
    assert client.get('/api/category-market/analysis').json()['learning']['running'] is False


def test_data_committed_during_training_remains_stale_until_the_next_automatic_cycle(workspace, monkeypatch):
    client, app = workspace
    collect_batch(client)
    import market_pipeline
    original = market_pipeline.train_market_model
    with app.db() as c:
        c.execute('UPDATE market_snapshots SET price=123456 WHERE sku=?', ('10.100',))

    def concurrent_commit(data):
        artifact = original(data)
        with app.db() as c:
            c.execute('UPDATE market_snapshots SET price=654321 WHERE sku=?', ('11.101',))
        return artifact

    monkeypatch.setattr(market_pipeline, 'train_market_model', concurrent_commit)
    app.app.state.market_learning.tick()
    intermediate = client.get('/api/category-market/analysis').json()
    assert intermediate['model']['stale'] is True
    monkeypatch.setattr(market_pipeline, 'train_market_model', original)
    app.app.state.market_learning.tick()
    after = client.get('/api/category-market/analysis').json()
    assert after['model']['stale'] is False
    assert after['model']['model_id'] != intermediate['model']['model_id']


def test_automatic_training_error_preserves_data_and_last_model_then_recovers(workspace, monkeypatch):
    client, app = workspace
    collect_batch(client)
    before = client.get('/api/category-market/analysis').json()['model']['model_id']
    import market_pipeline
    original = market_pipeline.train_market_model
    with app.db() as c:
        c.execute('UPDATE market_snapshots SET price=123456 WHERE sku=?', ('10.100',))
    monkeypatch.setattr(market_pipeline, 'train_market_model', lambda data: (_ for _ in ()).throw(RuntimeError('temporary model failure')))
    assert app.app.state.market_learning.tick() is None
    failed = client.get('/api/category-market/analysis').json()
    assert failed['model']['model_id'] == before
    assert failed['summary']['product_count'] == 20
    assert failed['learning']['state'] == 'error'
    monkeypatch.setattr(market_pipeline, 'train_market_model', original)
    app.app.state.market_learning.tick()
    assert client.get('/api/category-market/analysis').json()['learning']['state'] == 'ready'


def test_corrupt_saved_artifact_does_not_break_observational_analysis_and_auto_recovers(workspace):
    client, app = workspace
    collect_batch(client)
    with app.db() as c:
        c.execute("UPDATE market_ml_models SET artifact_json='{broken'")
    data = client.get('/api/category-market/analysis').json()
    assert data['summary']['product_count'] == 20
    assert data['model']['status'] == 'waiting'
    app.app.state.market_learning.tick()
    assert client.get('/api/category-market/analysis').json()['model']['status'] == 'trained'


def test_automatic_learning_detects_deletions_and_retains_the_last_trained_model_without_repeating(workspace):
    client, app = workspace
    collect_batch(client)
    previous = client.get('/api/category-market/ml/export').json()['model_id']
    with app.db() as c:
        c.execute('DELETE FROM market_snapshots WHERE sku=?', ('10.100',))
    app.app.state.market_learning.tick()
    data = client.get('/api/category-market/analysis').json()
    assert data['summary']['product_count'] == 19
    assert data['learning']['state'] == 'waiting'
    assert data['model']['model_id'] == previous
    assert 'giữ mô hình' in data['model']['reason']
    with app.db() as c:
        versions = c.execute('SELECT COUNT(*) FROM market_ml_models').fetchone()[0]
    app.app.state.market_learning.tick()
    with app.db() as c:
        assert c.execute('SELECT COUNT(*) FROM market_ml_models').fetchone()[0] == versions


def test_training_failure_preserves_previous_model_and_product_checkpoints(workspace, monkeypatch):
    client, app = workspace
    collect_batch(client)
    before = client.get('/api/category-market/analysis').json()['model']['model_id']
    import market_pipeline

    def failure(_):
        raise RuntimeError('training unavailable')

    monkeypatch.setattr(market_pipeline, 'train_market_model', failure)
    assert client.post('/api/category-market/ml/train', json={}).status_code == 503
    assert client.get('/api/category-market/analysis').json()['model']['model_id'] == before
    with app.db() as c:
        assert c.execute('SELECT COUNT(*) FROM market_snapshots').fetchone()[0] == 20
        assert c.execute('SELECT COUNT(*) FROM market_queue WHERE status="done"').fetchone()[0] == 20


def test_model_candidates_are_selected_from_all_products_not_only_sales_top_list(workspace, monkeypatch):
    client, _ = workspace
    collect_batch(client)
    import market_pipeline

    def score(artifact, rows):
        return {r['sku']: {'ml_signal_score': 100 if r['sku'] == '10.100' else 1,
                          'segment': 'Phân nhóm kiểm thử', 'reason': 'Chỉ dùng trong kiểm thử', 'model_scope': '1'} for r in rows}

    monkeypatch.setattr(market_pipeline, 'score_market_model', score)
    data = client.get('/api/category-market/analysis?limit=1').json()
    assert data['top_products'][0]['sku'] != '10.100'
    assert data['ml_candidates'][0]['sku'] == '10.100'
    assert data['model']['coverage_count'] == 20
    assert 'raw_json' not in json.dumps(data)


def test_new_day_with_missing_training_features_does_not_retrain_on_every_checkpoint(workspace, monkeypatch):
    client, app = workspace
    collect_batch(client)
    import category_market
    from datetime import datetime, timedelta
    next_day = (datetime.fromisoformat(category_market.now()) + timedelta(days=1)).isoformat()
    monkeypatch.setattr(category_market, 'now', lambda: next_day)
    rid = client.post('/api/category-market/campaigns', json={
        'categories': [{'name': 'Ngành kiểm thử', 'url': 'https://shopee.vn/Test-cat.1'}], 'full_scan': True}).json()['run_ids'][0]
    urls = ['https://shopee.vn/product/99/901', 'https://shopee.vn/product/99/902']
    client.post(f'/api/category-market/runs/{rid}/listing', json={'page': 0, 'urls': urls, 'has_next': False})
    for url in urls:
        assert client.post(f'/api/category-market/runs/{rid}/detail', json={'url': url, 'name': 'Thiếu chỉ số'}).status_code == 200
    with app.db() as c:
        assert c.execute('SELECT COUNT(*) FROM market_ml_models').fetchone()[0] == 2
    model = client.get('/api/category-market/analysis').json()['model']
    assert model['status'] == 'trained'
    assert model['stale'] is True  # Second checkpoint is newer than the processed fingerprint.
    app.app.state.market_learning.tick()
    assert client.get('/api/category-market/analysis').json()['model']['stale'] is False
