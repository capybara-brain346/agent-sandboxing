import re


def normalize_slug(value: str) -> str:
    normalized = value.strip().lower()
    normalized = re.sub(r"\s", "-", normalized)
    return re.sub(r"[^a-z0-9-]", "", normalized)
