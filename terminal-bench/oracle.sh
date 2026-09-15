#!/bin/sh
set -eu
task=${1:?task name is required}
case "$task" in
  */*) ;;
  *) task="terminal-bench/$task" ;;
esac
harbor run -d terminal-bench/terminal-bench@4.0.0 -i "$task" -a oracle -k 1 -n 1 -o terminal-bench/.data/jobs
