def calculate_total(
    values: list[int], start: int = 0, end: int | None = None
) -> int:
    stop = len(values) - 1 if end is None else end
    return sum(values[start:stop])
