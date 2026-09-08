import argparse
import json
import os
from pathlib import Path

from datasets import load_dataset

DATASET_NAME = "SWE-bench/SWE-bench_Lite"
DATASET_REVISION = "b0dde1093fe417d83b7184254edf8199c1f0dff5"
DEFAULT_SPLIT = os.environ.get("SWE_BENCH_SPLIT", "dev")
VISIBLE_FIELDS = (
    "instance_id",
    "repo",
    "base_commit",
    "problem_statement",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", default=DEFAULT_SPLIT, choices=["dev", "test"])
    parser.add_argument(
        "--revision",
        default=os.environ.get("SWE_BENCH_DATASET_REVISION", DATASET_REVISION),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="include every task in the pinned selected split",
    )
    parser.add_argument("--instance-id", action="append")
    parser.add_argument(
        "--output",
        default=os.environ.get("SWE_BENCH_MANIFEST_PATH"),
    )
    return parser.parse_args()


def image_for(row: dict) -> str | None:
    value = row.get("image")
    if value is None or str(value).strip() == "":
        return None
    return str(value)


def main() -> None:
    args = parse_args()
    if not args.revision or len(args.revision) < 7:
        raise SystemExit("--revision must be an explicit dataset revision")
    dataset = load_dataset(DATASET_NAME, split=args.split, revision=args.revision)
    rows = sorted(dataset, key=lambda row: str(row["instance_id"]))
    selected_ids = args.instance_id or [
        value.strip()
        for value in os.environ.get("SWE_BENCH_INSTANCE_IDS", "").split(",")
        if value.strip()
    ]
    if args.all and selected_ids:
        raise SystemExit("--all cannot be combined with --instance-id values")
    if args.all:
        selected_ids = [str(row["instance_id"]) for row in rows]
    if not selected_ids:
        raise SystemExit(
            f"select at least one --instance-id from the {len(rows)} available {args.split} tasks"
        )
    if len(set(selected_ids)) != len(selected_ids):
        raise SystemExit("duplicate --instance-id values are not allowed")
    available_ids = {str(row["instance_id"]) for row in rows}
    missing = [
        instance_id for instance_id in selected_ids if instance_id not in available_ids
    ]
    if missing:
        raise SystemExit(
            f"task(s) not found in {DATASET_NAME}:{args.split}: {', '.join(missing)}"
        )
    rows = [row for row in rows if str(row["instance_id"]) in selected_ids]
    tasks = []
    for row in rows:
        task = {field: str(row[field]) for field in VISIBLE_FIELDS}
        task.update(
            {
                "split": args.split,
                "dataset_name": DATASET_NAME,
                "dataset_revision": args.revision,
                "dataset_task_count": len(dataset),
                "task_count": len(rows),
            }
        )
        image = image_for(row)
        if image is not None:
            task["image"] = image
        tasks.append(task)
    output = Path(
        args.output or f"swe-bench-lite/.data/tasks/swe-bench-lite-{args.split}.jsonl"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    Path(
        os.environ.get("SWE_BENCH_FIXTURE_ROOT", "swe-bench-lite/.data/fixtures")
    ).mkdir(parents=True, exist_ok=True)
    output.write_text(
        "".join(f"{json.dumps(task, sort_keys=True)}\n" for task in tasks),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "manifest": str(output),
                "dataset_name": DATASET_NAME,
                "dataset_revision": args.revision,
                "split": args.split,
                "dataset_task_count": len(dataset),
                "task_count": len(tasks),
                "instance_ids": [task["instance_id"] for task in tasks],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
