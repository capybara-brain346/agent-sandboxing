import argparse
from collections.abc import Sequence

from .config import load_config
from .math_utils import calculate_total
from .text_utils import normalize_slug


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="acme-tools",
        description="Run Acme Tools commands.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    slug = commands.add_parser("slug", help="Normalize text as a slug")
    slug.add_argument("value")

    total = commands.add_parser("total", help="Calculate a total")
    total.add_argument("values", nargs="+", type=int)

    commands.add_parser("config", help="Show active settings")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "slug":
        print(normalize_slug(args.value))
    elif args.command == "total":
        print(calculate_total(args.values, 0, len(args.values)))
    else:
        settings = load_config()
        print(f"{settings.host}:{settings.port} debug={settings.debug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
