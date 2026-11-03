import copy

import pytest

from seller_matching import compare_equivalence, competitor_reference, specifications


def product(sku='12.1', **changes):
    attributes = {
        'Thương hiệu': 'Hòa Phát', 'Chất liệu': 'Nhựa PP', 'Kích thước': '10 x 20 cm',
        'Dung tích': '500 ml', 'Số lượng trong gói': '2 cái', 'Công dụng': 'Hộp đựng thực phẩm',
    }
    attributes.update(changes.pop('attributes', {}))
    attributes = [{'name': name, 'value': value} for name, value in attributes.items() if value is not None]
    return {'sku': sku, 'name': 'Hộp đựng thực phẩm Hòa Phát 500ml combo 2',
            'category': 'Nhà cửa & Đời sống', 'price': 99000,
            'detail': {'attributes': attributes}, **changes}


def test_recorded_brand_material_dimensions_pack_and_function_are_required_for_equivalence():
    result = compare_equivalence(product(), product('98.2', attributes={'Thương hiệu': 'HOA PHAT', 'Chất liệu': 'nhựa pp'}))
    assert result['status'] == 'equivalent' and result['comparable']
    assert result['conflicts'] == result['missing'] == []
    assert result['specifications']['brand'] == {'own': 'hoa phat', 'competitor': 'hoa phat'}


@pytest.mark.parametrize('attribute,value,field', [
    ('Thương hiệu', 'Thương hiệu khác', 'brand'),
    ('Chất liệu', 'Thủy tinh', 'material'),
    ('Kích thước', '10 x 30 cm', 'size'),
    ('Dung tích', '1000ml', 'capacity'),
    ('Số lượng trong gói', '3 cái', 'pack'),
    ('Công dụng', 'Bình tưới cây', 'function'),
    ('Model', 'MODEL-B', 'model'),
])
def test_any_recorded_specification_contradiction_is_different(attribute, value, field):
    own = product(attributes={'Model': 'MODEL-A'})
    result = compare_equivalence(own, product('98.2', attributes={attribute: value, 'Model': value if field == 'model' else 'MODEL-A'}))
    assert result['status'] == 'different' and not result['comparable']
    assert field in result['conflicts']


@pytest.mark.parametrize('capacity', ['0.5 l', '0,5 l', '0.5 lit', '500ml'])
def test_capacity_units_normalize_before_comparison(capacity):
    other = product('98.2', attributes={'Dung tích': capacity, 'Số lượng trong gói': '2 chiếc'})
    assert specifications(other)['capacity'] == '500ml'
    assert specifications(other)['pack'] == '2'
    assert compare_equivalence(product(), other)['comparable']


def test_unambiguous_capacity_and_pack_can_be_read_from_recorded_title():
    own = product(attributes={'Dung tích': None, 'Số lượng trong gói': None}, name='Hộp đựng thực phẩm 500ml combo 2')
    other = product('98.2', attributes={'Dung tích': None, 'Số lượng trong gói': None}, name='Hộp đựng thực phẩm 0.5l bộ 2')
    assert compare_equivalence(own, other)['comparable']
    ambiguous = product(attributes={'Dung tích': None, 'Kích thước': None}, name='Hộp đựng thực phẩm 500ml hoặc 1l combo 2')
    assert 'capacity' not in specifications(ambiguous)
    assert compare_equivalence(ambiguous, other)['status'] == 'review'


@pytest.mark.parametrize('missing,expected', [
    ({'Thương hiệu': None}, 'brand'),
    ({'Chất liệu': None}, 'material'),
    ({'Số lượng trong gói': None}, 'pack'),
    ({'Kích thước': None, 'Dung tích': None}, 'size_or_capacity'),
])
def test_unknown_required_specifications_need_review(missing, expected):
    other = product('98.2', attributes=missing, name='Hộp đựng thực phẩm')
    result = compare_equivalence(product(), other)
    assert result['status'] == 'review' and not result['comparable']
    assert expected in result['missing']


def test_similar_name_and_category_without_specs_cannot_be_called_equivalent():
    other = product('98.2', detail={})
    result = compare_equivalence(product(), other)
    assert result['status'] == 'review' and not result['comparable']
    assert {'brand', 'material'} <= set(result['missing'])


def test_category_or_function_mismatch_is_not_false_equivalence():
    wrong_category = compare_equivalence(product(), product('98.2', category='Đồ chơi'))
    assert not wrong_category['comparable'] and 'matching_category' in wrong_category['missing']
    wrong_function = compare_equivalence(product(), product('98.2', attributes={'Công dụng': 'Đồ chơi trẻ em'}))
    assert wrong_function['status'] == 'different' and 'function' in wrong_function['conflicts']
    no_function = compare_equivalence(
        product(attributes={'Công dụng': None}),
        product('98.2', attributes={'Công dụng': None}, name='Giá đỡ điện thoại'),
    )
    assert no_function['status'] == 'review' and 'matching_function' in no_function['missing']


def test_reference_price_range_uses_only_equivalent_same_category_products():
    rows = [product('98.1', price=88000), product('98.2', price=105000),
            product('98.3', price=1000, detail={}),
            product('98.4', price=2000, attributes={'Chất liệu': 'Thủy tinh'}),
            product('98.5', price=1, category='Đồ chơi')]
    result = competitor_reference(product(), rows)
    assert (result['count'], result['min'], result['max']) == (2, 88000, 105000)
    assert (result['review_count'], result['different_count'], result['candidate_count']) == (1, 1, 4)
    assert {row['sku'] for row in result['candidates'][:2]} == {'98.1', '98.2'}
    assert all(row['sku'] != '98.5' for row in result['candidates'])


def test_range_uses_all_equivalent_rows_even_when_candidate_preview_is_capped():
    result = competitor_reference(product(), [product(f'98.{i}', price=10000+i) for i in range(25)])
    assert result['count'] == result['candidate_count'] == 25
    assert result['candidates_truncated'] and len(result['candidates']) == 20
    assert (result['min'], result['max']) == (10000, 10024)


@pytest.mark.parametrize('price', [True, False, float('inf'), float('-inf'), float('nan'), -1, 0, None, '99000'])
def test_invalid_prices_never_form_an_equivalent_price_range(price):
    result = competitor_reference(product(), [product('98.1', price=price)])
    assert result['min'] is None and result['max'] is None
    with_valid = competitor_reference(product(), [product('98.1', price=price), product('98.2', price=99000)])
    assert with_valid['min'] == with_valid['max'] == 99000


def test_matching_does_not_modify_recorded_product_data():
    own, rows = product(), [product('98.2', attributes={'Dung tích': '0.5l'})]
    previous = copy.deepcopy((own, rows))
    competitor_reference(own, rows)
    assert (own, rows) == previous
