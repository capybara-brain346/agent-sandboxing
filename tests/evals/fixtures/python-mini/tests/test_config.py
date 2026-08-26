from acme_tools.config import Settings, load_config


def test_load_config_uses_defaults():
    assert load_config({}) == Settings("127.0.0.1", 8000, False)


def test_load_config_parses_environment_values():
    assert load_config(
        {"ACME_HOST": "0.0.0.0", "ACME_PORT": "9000", "ACME_DEBUG": "true"}
    ) == Settings("0.0.0.0", 9000, True)
