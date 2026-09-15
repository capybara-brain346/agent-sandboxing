import hashlib
import json
import os
import platform
import subprocess
from datetime import UTC, datetime
from pathlib import Path

DATASET = "terminal-bench/terminal-bench@4.0.0"
HARBOR_VERSION = "0.6.4"
PROMPT = "prompts/session-agent.yaml"
TOOLS = "src/services/agent/tools/profiles/profiles.yaml"


def value(name: str, default: str) -> str:
    return os.environ.get(name, default)


def integer(name: str, default: int) -> int:
    raw = value(name, str(default))
    try:
        result = int(raw)
    except ValueError as error:
        raise SystemExit(f"{name} must be an integer") from error
    if result < 1:
        raise SystemExit(f"{name} must be positive")
    return result


def digest(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def command(*args: str) -> str:
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"


def main() -> None:
    run_id = value("TERMINAL_BENCH_RUN_ID", f"terminal-bench-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{os.getpid()}")
    if not all(character.isalnum() or character in "._-" for character in run_id):
        raise SystemExit("TERMINAL_BENCH_RUN_ID contains unsupported characters")
    root = Path(value("TERMINAL_BENCH_RUNS_ROOT", "terminal-bench/.data/runs")) / run_id
    if root.exists():
        raise SystemExit(f"run already exists: {root}")
    root.mkdir(parents=True)
    manifest = {
        "run_id": run_id,
        "created_at": datetime.now(UTC).isoformat(),
        "dataset": DATASET,
        "repository_commit": command("git", "rev-parse", "HEAD"),
        "model": {
            "identifier": value("AGENT_MODEL", "openrouter:deepseek/deepseek-v4-flash"),
            "provider_route": "OpenRouter",
        },
        "prompt": {"path": PROMPT, "sha256": digest(PROMPT)},
        "tool_profile": {"name": "main", "path": TOOLS, "sha256": digest(TOOLS)},
        "limits": {
            "agent_max_steps": integer("AGENT_MAX_STEPS", 25),
            "task_timeout_seconds": integer("TERMINAL_BENCH_TASK_TIMEOUT_SECONDS", 1800),
            "tool_timeout_ms": integer("AGENT_TOOL_TIMEOUT_MS", 30000),
            "retry_policy": value("TERMINAL_BENCH_RETRY_POLICY", "none"),
        },
        "harbor": {
            "version": HARBOR_VERSION,
            "detected_version": command("harbor", "--version"),
            "environment_provider": value("TERMINAL_BENCH_ENVIRONMENT", "docker"),
        },
        "resources": {
            "cpus": integer("TERMINAL_BENCH_CPUS", os.cpu_count() or 1),
            "memory_mb": integer("TERMINAL_BENCH_MEMORY_MB", 4096),
            "gpus": integer("TERMINAL_BENCH_GPUS", 0) if value("TERMINAL_BENCH_GPUS", "0") != "0" else 0,
            "concurrency": integer("TERMINAL_BENCH_CONCURRENCY", 1),
            "platform": platform.platform(),
        },
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"run_id": run_id, "run_path": str(root), "manifest_path": str(root / "manifest.json")}))


if __name__ == "__main__":
    main()
