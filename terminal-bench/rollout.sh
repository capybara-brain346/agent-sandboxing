#!/bin/sh
set -eu
: "${TERMINAL_BENCH_RUN_ID:?TERMINAL_BENCH_RUN_ID is required}"
npm run eval:terminal-bench:prepare
npm run eval:terminal-bench:run
