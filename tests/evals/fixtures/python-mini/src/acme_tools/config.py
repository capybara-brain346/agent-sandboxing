import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    debug: bool


def load_config(
    env: Mapping[str, str] | None = None,
    overrides: Mapping[str, str] | None = None,
) -> Settings:
    environment = dict(os.environ if env is None else env)
    values = {**(overrides or {}), **environment}
    return Settings(
        host=values.get("ACME_HOST", "127.0.0.1"),
        port=int(values.get("ACME_PORT", "8000")),
        debug=values.get("ACME_DEBUG", "false").lower() in {"1", "true", "yes"},
    )
