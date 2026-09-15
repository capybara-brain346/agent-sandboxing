#!/bin/sh
set -eu
task=${1-}
case "$task" in
  ""|*/*) ;;
  *) task="terminal-bench/$task" ;;
esac
npm run eval:terminal-bench:build-agent
if [ -n "$task" ]; then
  set -- -i "$task"
else
  set --
fi
PYTHONPATH=terminal-bench TERMINAL_BENCH_ENTRYPOINT=terminal-bench/.data/agent-runner.mjs harbor run -d terminal-bench/terminal-bench@4.0.0 "$@" --agent-import-path agent:TerminalBenchAgent -k 1 -n 1 -o terminal-bench/.data/jobs
