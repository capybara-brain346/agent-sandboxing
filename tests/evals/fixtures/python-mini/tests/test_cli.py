from acme_tools.cli import build_parser, main


def test_slug_command(capsys):
    assert main(["slug", "Hello World"]) == 0
    assert capsys.readouterr().out == "hello-world\n"


def test_total_command(capsys):
    assert main(["total", "2", "3", "5"]) == 0
    assert capsys.readouterr().out == "10\n"


def test_config_command(capsys, monkeypatch):
    monkeypatch.setenv("ACME_PORT", "9100")
    assert main(["config"]) == 0
    assert capsys.readouterr().out == "127.0.0.1:9100 debug=False\n"


def test_help_describes_the_package():
    assert "Run Acme Tools commands." in build_parser().format_help()
