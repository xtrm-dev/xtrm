"""Tests for the typed --arg parser."""

import pytest

from mcpq.args import parse_args


def test_string_default():
    assert parse_args(["query=up"]) == {"query": "up"}


def test_string_with_equals_in_value():
    assert parse_args(["expr=a=b=c"]) == {"expr": "a=b=c"}


def test_int_type():
    assert parse_args(["limit:int=50"]) == {"limit": 50}


def test_float_type():
    assert parse_args(["threshold:float=0.95"]) == {"threshold": 0.95}


@pytest.mark.parametrize("val", ["true", "TRUE", "1", "yes", "on"])
def test_bool_truthy(val):
    assert parse_args([f"flag:bool={val}"]) == {"flag": True}


@pytest.mark.parametrize("val", ["false", "FALSE", "0", "no", "off"])
def test_bool_falsy(val):
    assert parse_args([f"flag:bool={val}"]) == {"flag": False}


def test_json_object():
    assert parse_args(['filter:json={"x":1,"y":[1,2]}']) == {
        "filter": {"x": 1, "y": [1, 2]}
    }


def test_json_array():
    assert parse_args(["tags:json=[\"a\",\"b\"]"]) == {"tags": ["a", "b"]}


def test_multiple_args_mixed_types():
    out = parse_args(["query=up", "limit:int=10", "fuzzy:bool=true"])
    assert out == {"query": "up", "limit": 10, "fuzzy": True}


def test_duplicate_last_wins():
    assert parse_args(["x=1", "x=2"]) == {"x": "2"}


def test_empty_list():
    assert parse_args([]) == {}


def test_missing_equals_raises():
    with pytest.raises(ValueError, match="missing '='"):
        parse_args(["badform"])


def test_empty_name_raises():
    with pytest.raises(ValueError, match="empty name"):
        parse_args(["=value"])


def test_unknown_type_raises():
    with pytest.raises(ValueError, match="unknown type"):
        parse_args(["x:wat=1"])


def test_bad_int_value_raises():
    with pytest.raises(ValueError, match="invalid value"):
        parse_args(["limit:int=abc"])


def test_bad_bool_value_raises():
    with pytest.raises(ValueError, match="invalid value"):
        parse_args(["flag:bool=maybe"])


def test_bad_json_raises():
    with pytest.raises(ValueError, match="invalid value"):
        parse_args(["x:json={notjson}"])
