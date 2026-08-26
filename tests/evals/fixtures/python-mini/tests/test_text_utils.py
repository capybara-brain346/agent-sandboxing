from acme_tools.text_utils import normalize_slug


def test_normalize_slug_lowercases_and_removes_punctuation():
    assert normalize_slug("Hello, World!") == "hello-world"


def test_normalize_slug_trims_outer_whitespace():
    assert normalize_slug("  hello world  ") == "hello-world"
