import copy
import json
import math

import pytest

from market_ml import train_market_model, score_market_model


def products(count=60, category='a', seller=100):
    rows = []
    for i in range(count):
        band = min(i // 20, 2)
        rows.append({'sku': f'{seller}.{i+1}', 'category_id': category, 'day': '2026-10-14',
            'collected_at': '2026-10-14T10:00:00+07:00', 'name': f'Sản phẩm {i}',
            'price': (10000, 100000, 300000)[band] + i % 7 * 100,
            'sold_total': (10, 1000, 30000)[band] + i % 5,
            'review_count': (1, 100, 3000)[band] + i % 3,
            'rating': (4.0, 4.5, 4.9)[band], 'sold_approx': int(i % 2 == 0)})
    return rows


def learned(artifact):
    return {key: value for key, value in artifact.items() if key != 'trained_at'}


def test_kmeans_fits_observed_category_groups_and_current_demand_position():
    rows = products()
    artifact = train_market_model(rows)
    assert artifact['status'] == 'trained'
    assert artifact['training_product_count'] == 60
    assert artifact['training_cutoff'] == '2026-10-14T10:00:00+07:00'
    group = artifact['groups'][0]
    assert group['training_count'] == sum(x['training_count'] for x in group['cluster_profiles']) == 60
    assert 1 <= len(group['centroids']) <= 4
    assert 1 <= group['iterations'] <= 60
    assert group['approximate_sold_count'] == 30
    scores = score_market_model(artifact, rows)
    assert scores[rows[-1]['sku']]['ml_signal_score'] > scores[rows[0]['sku']]['ml_signal_score']
    assert len({value['cluster_id'] for value in scores.values()}) > 1
    assert all(value['status'] == 'scored' and 0 <= value['ml_signal_score'] <= 100 for value in scores.values())
    assert all('không dự báo' in value['reason'] for value in scores.values())


def test_fit_is_deterministic_under_input_reordering_and_json_roundtrip():
    rows = products()
    first = train_market_model(rows)
    second = train_market_model(list(reversed(rows)))
    assert learned(first) == learned(second)
    restored = json.loads(json.dumps(first, allow_nan=False))
    assert score_market_model(first, rows) == score_market_model(restored, list(reversed(rows)))


def test_parameters_are_learned_from_data_and_change_when_the_market_changes():
    rows = products()
    changed = copy.deepcopy(rows)
    changed[0].update(price=990000, sold_total=900000, review_count=90000)
    first, second = train_market_model(rows), train_market_model(changed)
    assert first['groups'][0]['scaler'] != second['groups'][0]['scaler']
    assert first['groups'][0]['centroids'] != second['groups'][0]['centroids']
    assert first['groups'][0]['imputers']['price'] > 10000


def test_duplicates_are_not_training_samples_and_latest_missing_values_never_backfill():
    rows = products(20)
    old = [{**row, 'day': '2026-10-13', 'sold_total': 9999999} for row in rows]
    artifact = train_market_model(old + rows + rows)
    assert artifact['training_product_count'] == 20
    assert artifact['groups'][0]['imputers']['sold_total'] < 100
    latest_missing = {**rows[0], 'collected_at': '2026-10-14T11:00:00+07:00', 'sold_total': None}
    insufficient = train_market_model(old + rows + [latest_missing])
    assert insufficient['status'] == 'waiting'
    assert insufficient['waiting_groups'][0]['eligible_product_count'] == 19


def test_training_cutoff_uses_the_latest_used_collection_timestamp_with_day_fallback():
    rows = products(20)
    rows[0]['collected_at'] = '2026-10-14T12:00:00+07:00'
    assert train_market_model(rows)['training_cutoff'] == '2026-10-14T12:00:00+07:00'
    for row in rows:
        row.pop('collected_at')
    assert train_market_model(rows)['training_cutoff'] == '2026-10-14'


def test_threshold_is_per_category_and_unknown_category_is_not_scored_by_another_model():
    a, b = products(20), products(19, category='b', seller=200)
    artifact = train_market_model(a + b)
    assert artifact['status'] == 'trained'
    assert [group['category_id'] for group in artifact['groups']] == ['a']
    assert artifact['training_product_count'] == 20
    scores = score_market_model(artifact, b)
    assert all(value['status'] == 'waiting' and value['ml_signal_score'] is None for value in scores.values())


def test_rating_missing_values_use_learned_median_without_mutating_observations():
    rows = products(20)
    for row in rows[:5]:
        row['rating'] = None
    original = copy.deepcopy(rows)
    artifact = train_market_model(rows)
    assert artifact['groups'][0]['imputers']['rating'] == 4
    assert artifact['groups'][0]['missing_rating_count'] == 5
    score = score_market_model(artifact, rows[:1])[rows[0]['sku']]
    assert score['status'] == 'scored' and score['imputed_fields'] == ['rating']
    assert 'trung vị' in score['reason']
    assert rows == original


def test_all_missing_ratings_are_an_inactive_dimension_even_for_new_rated_products():
    rows = products(20)
    for row in rows:
        row['rating'] = None
    artifact = train_market_model(rows)
    assert artifact['groups'][0]['imputers']['rating'] is None
    unrated = score_market_model(artifact, rows[:1])[rows[0]['sku']]
    rated = score_market_model(artifact, [{**rows[0], 'rating': 5}])[rows[0]['sku']]
    assert (unrated['cluster_id'], unrated['ml_signal_score']) == (rated['cluster_id'], rated['ml_signal_score'])
    assert 'bỏ qua' in rated['reason']
    json.dumps(artifact, allow_nan=False)


def test_one_missing_core_feature_is_disclosed_but_too_little_observation_has_no_score():
    rows = products()
    artifact = train_market_model(rows)
    partial = {**rows[0], 'price': None}
    score = score_market_model(artifact, [partial])[partial['sku']]
    assert score['status'] == 'scored'
    assert score['imputed_fields'] == ['price']
    assert partial['price'] is None
    missing = {**rows[0], 'price': None, 'sold_total': None}
    score = score_market_model(artifact, [missing])[missing['sku']]
    assert score['status'] == 'waiting' and score['ml_signal_score'] is None and score['cluster_id'] is None


@pytest.mark.parametrize('bad', [None, '', 'unknown', float('nan'), float('inf'), -1, True])
def test_invalid_core_values_do_not_become_training_measurements(bad):
    rows = products(20)
    for row in rows:
        row['sold_total'] = bad
    artifact = train_market_model(rows)
    assert artifact['status'] == 'waiting' and artifact['groups'] == []
    assert artifact['training_product_count'] == 0
    assert all(value['ml_signal_score'] is None for value in score_market_model(artifact, rows).values())
    json.dumps(artifact, allow_nan=False)


def test_no_data_single_product_and_explicit_demo_data_never_produce_a_model():
    assert train_market_model([])['status'] == 'waiting'
    assert train_market_model(products(1))['status'] == 'waiting'
    demo = [{**row, 'is_demo': True} for row in products(30)]
    assert train_market_model(demo)['training_product_count'] == 0
    model = train_market_model(products(20))
    score = score_market_model(model, demo[:1])[demo[0]['sku']]
    assert score['status'] == 'waiting' and 'demo' in score['reason']


def test_invalid_row_containers_and_missing_identities_return_waiting_without_fabricated_products():
    for rows in (None, 7, [None, 'invalid', {}, {'sku': 'x'}, {'category_id': 'a'}]):
        artifact = train_market_model(rows)
        assert artifact['status'] == 'waiting' and artifact['training_product_count'] == 0
        assert score_market_model(artifact, rows) == {}


def test_future_targets_and_derived_trend_fields_cannot_influence_the_model():
    rows = products()
    contaminated = [{**row, 'sales_next_7d': 999999, 'future_price': 1, 'velocity': 900000,
                     'acceleration': 800000, 'trend_score': 100, 'reason': 'fake target'} for row in rows]
    first, second = train_market_model(rows), train_market_model(contaminated)
    assert learned(first) == learned(second)
    assert first['feature_names'] == ['log1p_price', 'log1p_sold_total', 'log1p_review_count', 'rating']
    assert score_market_model(first, rows) == score_market_model(first, contaminated)
    assert len({row['day'] for row in rows}) == 1
    assert 'dự báo' in first['score_interpretation']
    assert not any('forecast' in key or 'probability' in key for key in first)


def test_identical_products_form_one_real_cluster_with_shared_neutral_position():
    rows = [{**row, 'price': 10000, 'sold_total': 10, 'review_count': 1, 'rating': 4} for row in products(20)]
    artifact = train_market_model(rows)
    assert len(artifact['groups'][0]['centroids']) == 1
    scores = score_market_model(artifact, rows)
    assert {score['ml_signal_score'] for score in scores.values()} == {50}
    assert {score['segment'] for score in scores.values()} == {'Nhóm sản phẩm tương đồng'}


@pytest.mark.parametrize('damage', ['version', 'centroid', 'scale', 'groups', 'cutoff'])
def test_corrupt_or_incompatible_artifacts_return_waiting_instead_of_scores(damage):
    rows = products(20)
    artifact = train_market_model(rows)
    if damage == 'version': artifact['schema_version'] = 99
    if damage == 'centroid': artifact['groups'][0]['centroids'][0][0] = float('nan')
    if damage == 'scale': artifact['groups'][0]['scaler']['scale'][0] = 0
    if damage == 'groups': artifact['groups'] = None
    if damage == 'cutoff': artifact['groups'][0]['training_cutoff'] = 'not-a-date'
    assert all(score['status'] == 'waiting' and score['ml_signal_score'] is None for score in score_market_model(artifact, rows).values())


def test_extreme_finite_inputs_keep_the_persisted_artifact_json_finite():
    rows = [{**row, 'price': 1e308, 'sold_total': 1e308, 'review_count': 1e308} for row in products(20)]
    artifact = train_market_model(rows)
    json.dumps(artifact, allow_nan=False)
    assert artifact['status'] == 'trained'
    assert all(math.isfinite(score['ml_signal_score']) for score in score_market_model(artifact, rows).values())
