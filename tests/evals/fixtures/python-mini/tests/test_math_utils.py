from acme_tools.math_utils import calculate_total


def test_calculate_total_with_explicit_slice():
    assert calculate_total([2, 3, 5, 7], 1, 3) == 8


def test_calculate_total_with_empty_values():
    assert calculate_total([]) == 0
