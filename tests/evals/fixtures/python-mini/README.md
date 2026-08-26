# Acme Tools

Acme Tools is a small package for evaluating repository-scoped coding work.

## Setup

Run the test suite from the repository root:

```bash
python -m pytest
```

The package can be installed in editable mode with:

```bash
python -m pip install -e .
```

## Commands

Create a normalized slug:

```bash
python -m acme_tools.cli slug "Hello, Acme Tools"
```

Calculate a total:

```bash
python -m acme_tools.cli total 2 3 5
```

Show active configuration:

```bash
python -m acme_tools.cli config
```

## API

`calculate_total` accepts a list of integers and an optional start and end
slice boundary. The end boundary is exclusive.

`normalize_slug` lowercases text, replaces whitespace with dashes, and removes
punctuation.

`load_config` reads `ACME_HOST`, `ACME_PORT`, and `ACME_DEBUG` values and also
accepts explicit overrides.
