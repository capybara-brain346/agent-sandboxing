#!/bin/sh
set -eu
for task in bun-sourcemap-leak cargo-flight-dispatch html-js-filter nextjs-performance wal-recovery-ordering; do
  npm run eval:terminal-bench:oracle -- "$task"
  npm run eval:terminal-bench:run -- "$task"
done
