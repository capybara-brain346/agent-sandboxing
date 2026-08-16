#!/usr/bin/env bash
set -euo pipefail

# This harness expects the API, Postgres, and Docker to already be running.
# Run it from any directory; the default fixture path is the repository's
# ./repo and therefore matches the default task-service configuration.
BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
POLL_SECONDS="${POLL_SECONDS:-30}"
SSE_TIMEOUT_SECONDS="${SSE_TIMEOUT_SECONDS:-5}"
FIXTURE_REPO_PATH="${FIXTURE_REPO_PATH:-}"
REPO_REF="${REPO_REF:-./repo}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
FIXTURE_REPO_PATH="${FIXTURE_REPO_PATH:-${PROJECT_ROOT}/repo}"

TMP_DIR="$(mktemp -d)"
FAILURE_REPO_BACKUP="${TMP_DIR}/repo.saved"
FAILURE_REPO_MOVED=false

cleanup() {
  local exit_code=$?

  # Do this first so an interrupted failure-path assertion cannot leave the
  # fixture missing for the next local run.
  if [[ "${FAILURE_REPO_MOVED}" == "true" && ! -e "${FIXTURE_REPO_PATH}" ]]; then
    mv -- "${FAILURE_REPO_BACKUP}" "${FIXTURE_REPO_PATH}" 2>/dev/null || true
  fi

  rm -rf -- "${TMP_DIR}"
  exit "${exit_code}"
}
trap cleanup EXIT

log() {
  printf '[task-acceptance] %s\n' "$*"
}

fail() {
  printf '[task-acceptance] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "${expected}" "${file}" || {
    printf '%s\n' "--- ${file} ---" >&2
    sed -n '1,240p' "${file}" >&2 || true
    fail "expected ${file} to contain: ${expected}"
  }
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "${unexpected}" "${file}"; then
    printf '%s\n' "--- ${file} ---" >&2
    sed -n '1,240p' "${file}" >&2 || true
    fail "expected ${file} not to contain: ${unexpected}"
  fi
}

assert_json() {
  local expression="$1"
  local file="$2"
  if ! jq -e "${expression}" "${file}" >/dev/null; then
    printf '%s\n' "--- ${file} ---" >&2
    sed -n '1,240p' "${file}" >&2 || true
    fail "JSON assertion failed: ${expression}"
  fi
}

assert_json_arg() {
  local arg_name="$1"
  local arg_value="$2"
  local expression="$3"
  local file="$4"
  if ! jq -e --arg "${arg_name}" "${arg_value}" "${expression}" "${file}" >/dev/null; then
    printf '%s\n' "--- ${file} ---" >&2
    sed -n '1,240p' "${file}" >&2 || true
    fail "JSON assertion failed: ${expression}"
  fi
}

# Store the response body separately from the status code. This also makes
# failed acceptance runs useful when the API returns an unexpected response.
curl_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  local expected_status="$4"
  local output="$5"
  local status

  if [[ -n "${body}" ]]; then
    status="$(curl -sS -o "${output}" -w '%{http_code}' \
      -X "${method}" \
      -H 'content-type: application/json' \
      -d "${body}" \
      "${BASE_URL}${path}")"
  else
    status="$(curl -sS -o "${output}" -w '%{http_code}' \
      -X "${method}" \
      "${BASE_URL}${path}")"
  fi

  if [[ "${status}" != "${expected_status}" ]]; then
    printf 'Expected HTTP %s for %s %s, got %s\n' \
      "${expected_status}" "${method}" "${path}" "${status}" >&2
    printf 'Response body:\n' >&2
    sed -n '1,240p' "${output}" >&2 || true
    exit 1
  fi
}

prepare_fixture_repo() {
  if [[ -d "${FIXTURE_REPO_PATH}/.git" ]]; then
    log "using fixture repo at ${FIXTURE_REPO_PATH}"
    return
  fi

  if [[ -e "${FIXTURE_REPO_PATH}" ]]; then
    fail "${FIXTURE_REPO_PATH} exists but is not a git directory"
  fi

  log "creating fixture repo at ${FIXTURE_REPO_PATH}"
  mkdir -p -- "${FIXTURE_REPO_PATH}"
  git -C "${FIXTURE_REPO_PATH}" init -b main >/dev/null
  git -C "${FIXTURE_REPO_PATH}" config user.email acceptance@example.test
  git -C "${FIXTURE_REPO_PATH}" config user.name 'Acceptance Test'
  printf 'hello\n' > "${FIXTURE_REPO_PATH}/hello.txt"
  git -C "${FIXTURE_REPO_PATH}" add hello.txt
  git -C "${FIXTURE_REPO_PATH}" commit -m fixture >/dev/null
}

fetch_task_snapshot() {
  local task_id="$1"
  local output="$2"
  local status

  if ! status="$(curl -sS -o "${output}" -w '%{http_code}' \
    "${BASE_URL}/tasks/${task_id}")"; then
    fail "could not fetch task ${task_id}"
  fi
  if [[ "${status}" != "200" ]]; then
    printf 'Expected HTTP 200 while polling task %s, got %s\n' \
      "${task_id}" "${status}" >&2
    sed -n '1,240p' "${output}" >&2 || true
    exit 1
  fi
}

wait_for_task_status() {
  local task_id="$1"
  local expected="$2"
  local snapshot="${TMP_DIR}/${task_id}.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    fetch_task_snapshot "${task_id}" "${snapshot}"
    status="$(jq -r '.status // empty' "${snapshot}")"
    if [[ "${status}" == "${expected}" ]]; then
      log "task ${task_id} reached ${expected}"
      return
    fi
    case "${status}" in
      completed|failed|cancelled)
        printf '%s\n' "--- ${snapshot} ---" >&2
        cat "${snapshot}" >&2
        fail "task ${task_id} reached ${status}, expected ${expected}"
        ;;
    esac
    sleep 1
  done

  printf '%s\n' "--- ${snapshot} ---" >&2
  cat "${snapshot}" >&2 || true
  fail "task ${task_id} did not reach ${expected} within ${POLL_SECONDS}s"
}

wait_for_terminal_task() {
  local task_id="$1"
  local snapshot="${TMP_DIR}/${task_id}-terminal.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    fetch_task_snapshot "${task_id}" "${snapshot}"
    status="$(jq -r '.status // empty' "${snapshot}")"
    case "${status}" in
      completed|failed|cancelled)
        log "task ${task_id} reached terminal state ${status}"
        return
        ;;
    esac
    sleep 1
  done

  printf '%s\n' "--- ${snapshot} ---" >&2
  cat "${snapshot}" >&2 || true
  fail "task ${task_id} did not reach a terminal state within ${POLL_SECONDS}s"
}

capture_sse() {
  local path="$1"
  local output="$2"
  local last_event_id="${3:-}"
  local exit_code

  set +e
  if [[ -n "${last_event_id}" ]]; then
    timeout "${SSE_TIMEOUT_SECONDS}" curl -sS -N \
      -H "Last-Event-ID: ${last_event_id}" \
      "${BASE_URL}${path}" > "${output}"
  else
    timeout "${SSE_TIMEOUT_SECONDS}" curl -sS -N \
      "${BASE_URL}${path}" > "${output}"
  fi
  exit_code=$?
  set -e

  # A live SSE stream is expected to be terminated by timeout. A clean server
  # close is also valid for a replay-only test.
  if [[ "${exit_code}" != "0" && "${exit_code}" != "124" ]]; then
    printf '%s\n' "--- ${output} ---" >&2
    sed -n '1,240p' "${output}" >&2 || true
    fail "SSE request ${path} failed with exit code ${exit_code}"
  fi
}

assert_sse_ordered() {
  local file="$1"
  if ! awk '
    /^id: / {
      if ($2 !~ /^[0-9]+$/) exit 1;
      current = $2 + 0;
      if (seen && current <= previous) exit 1;
      previous = current;
      seen = 1;
    }
    END { exit seen ? 0 : 1 }
  ' "${file}"; then
    printf '%s\n' "--- ${file} ---" >&2
    sed -n '1,240p' "${file}" >&2 || true
    fail "SSE events were not in strictly increasing sequence order"
  fi
}

extract_last_sse_id() {
  local file="$1"
  awk '/^id: / { id = $2 } END { if (id == "") exit 1; print id }' "${file}"
}

restore_fixture_repo() {
  if [[ "${FAILURE_REPO_MOVED}" != "true" ]]; then return; fi
  if [[ -e "${FIXTURE_REPO_PATH}" ]]; then
    fail "fixture path reappeared before failure-path cleanup"
  fi
  mv -- "${FAILURE_REPO_BACKUP}" "${FIXTURE_REPO_PATH}"
  FAILURE_REPO_MOVED=false
}

require_command curl
require_command git
require_command jq
require_command timeout

cd -- "${PROJECT_ROOT}"
prepare_fixture_repo

log "checking API health at ${BASE_URL}"
curl_json GET /health '' 200 "${TMP_DIR}/health.json"
assert_json '.status == "ok"' "${TMP_DIR}/health.json"

log "creating placeholder task"
create_body="$(jq -cn --arg repo "${REPO_REF}" \
  --arg instructions 'No-op placeholder task' \
  '{repoRef: $repo, instructions: $instructions}')"
curl_json POST /tasks "${create_body}" 202 "${TMP_DIR}/create.json"
assert_json '.taskId | startswith("task_")' "${TMP_DIR}/create.json"
assert_json '.status == "created"' "${TMP_DIR}/create.json"
TASK_ID="$(jq -r '.taskId' "${TMP_DIR}/create.json")"
assert_json_arg task_id "${TASK_ID}" \
  '.eventsUrl == ("/tasks/" + $task_id + "/events") and (has("sandboxId") | not)' \
  "${TMP_DIR}/create.json"

log "waiting for placeholder task completion"
wait_for_task_status "${TASK_ID}" completed
curl_json GET "/tasks/${TASK_ID}" '' 200 "${TMP_DIR}/snapshot.json"
assert_json '.status == "completed"' "${TMP_DIR}/snapshot.json"
assert_json '(has("sandboxId") | not) and (has("containerName") | not) and (has("workspacePath") | not)' \
  "${TMP_DIR}/snapshot.json"

log "checking task event replay and ordering"
capture_sse "/tasks/${TASK_ID}/events?after=0" "${TMP_DIR}/events-1.sse"
assert_contains "${TMP_DIR}/events-1.sse" 'event: task_created'
assert_contains "${TMP_DIR}/events-1.sse" 'event: sandbox_created'
assert_contains "${TMP_DIR}/events-1.sse" 'event: task_provisioning_started'
assert_contains "${TMP_DIR}/events-1.sse" 'event: sandbox_ready'
assert_contains "${TMP_DIR}/events-1.sse" 'event: task_running'
assert_contains "${TMP_DIR}/events-1.sse" 'event: task_completed'
assert_contains "${TMP_DIR}/events-1.sse" 'event: task_result_ready'
assert_not_contains "${TMP_DIR}/events-1.sse" 'containerName'
assert_sse_ordered "${TMP_DIR}/events-1.sse"
LAST_ID="$(extract_last_sse_id "${TMP_DIR}/events-1.sse")"
[[ "${LAST_ID}" =~ ^[0-9]+$ && "${LAST_ID}" -ge 1 ]] || fail "invalid final SSE sequence: ${LAST_ID}"

log "checking replay from an explicit cursor"
capture_sse "/tasks/${TASK_ID}/events?after=2" "${TMP_DIR}/events-2.sse"
FIRST_REPLAYED_ID="$(awk '/^id: / { print $2; exit }' "${TMP_DIR}/events-2.sse")"
[[ "${FIRST_REPLAYED_ID}" =~ ^[0-9]+$ && "${FIRST_REPLAYED_ID}" -gt 2 ]] || \
  fail "after=2 replay started at invalid sequence: ${FIRST_REPLAYED_ID}"
assert_contains "${TMP_DIR}/events-2.sse" 'event: task_result_ready'
assert_sse_ordered "${TMP_DIR}/events-2.sse"

log "checking replay from Last-Event-ID"
capture_sse "/tasks/${TASK_ID}/events" "${TMP_DIR}/events-3.sse" 2
FIRST_RESUMED_ID="$(awk '/^id: / { print $2; exit }' "${TMP_DIR}/events-3.sse")"
[[ "${FIRST_RESUMED_ID}" =~ ^[0-9]+$ && "${FIRST_RESUMED_ID}" -gt 2 ]] || \
  fail "Last-Event-ID replay started at invalid sequence: ${FIRST_RESUMED_ID}"
assert_contains "${TMP_DIR}/events-3.sse" 'event: task_result_ready'

log "checking completed task result"
curl_json GET "/tasks/${TASK_ID}/result" '' 200 "${TMP_DIR}/result.json"
assert_json '.status == "completed" and .exitReason == "completed" and .agentSummary == null and (.diff | type == "string") and (has("sandboxId") | not)' \
  "${TMP_DIR}/result.json"

log "checking cancellation smoke path"
cancel_body="$(jq -cn --arg repo "${REPO_REF}" \
  --arg instructions 'Cancel me' \
  '{repoRef: $repo, instructions: $instructions}')"
curl_json POST /tasks "${cancel_body}" 202 "${TMP_DIR}/cancel-create.json"
CANCEL_TASK_ID="$(jq -r '.taskId' "${TMP_DIR}/cancel-create.json")"
CANCEL_STATUS="$(curl -sS -o "${TMP_DIR}/cancel.json" -w '%{http_code}' \
  -X DELETE "${BASE_URL}/tasks/${CANCEL_TASK_ID}")"
case "${CANCEL_STATUS}" in
  202)
    assert_json_arg task_id "${CANCEL_TASK_ID}" \
      '.taskId == $task_id and .status == "cancelling" and (has("sandboxId") | not)' \
      "${TMP_DIR}/cancel.json"
    wait_for_terminal_task "${CANCEL_TASK_ID}"
    ;;
  200)
    assert_json_arg task_id "${CANCEL_TASK_ID}" \
      '.taskId == $task_id and .status == "cancelled" and (has("sandboxId") | not)' \
      "${TMP_DIR}/cancel.json"
    ;;
  409)
    assert_json '.error.code == "task_already_terminal"' "${TMP_DIR}/cancel.json"
    ;;
  *)
    printf 'Unexpected cancellation HTTP status: %s\n' "${CANCEL_STATUS}" >&2
    sed -n '1,240p' "${TMP_DIR}/cancel.json" >&2 || true
    exit 1
    ;;
esac

log "checking provisioning failure path"
if [[ -e "${FAILURE_REPO_BACKUP}" ]]; then
  fail "temporary failure fixture path already exists"
fi
mv -- "${FIXTURE_REPO_PATH}" "${FAILURE_REPO_BACKUP}"
FAILURE_REPO_MOVED=true
failure_body="$(jq -cn --arg repo "${REPO_REF}" \
  --arg instructions 'Should fail provisioning' \
  '{repoRef: $repo, instructions: $instructions}')"
curl_json POST /tasks "${failure_body}" 202 "${TMP_DIR}/failure-create.json"
FAILED_TASK_ID="$(jq -r '.taskId' "${TMP_DIR}/failure-create.json")"
wait_for_task_status "${FAILED_TASK_ID}" failed
capture_sse "/tasks/${FAILED_TASK_ID}/events?after=0" "${TMP_DIR}/failure-events.sse"
assert_contains "${TMP_DIR}/failure-events.sse" 'event: task_failed'
assert_contains "${TMP_DIR}/failure-events.sse" 'event: task_result_ready'
curl_json GET "/tasks/${FAILED_TASK_ID}/result" '' 200 "${TMP_DIR}/failure-result.json"
assert_json '.status == "failed" and .exitReason == "failed" and (has("sandboxId") | not)' \
  "${TMP_DIR}/failure-result.json"
restore_fixture_repo

printf 'PASS task service atomic MVP acceptance\n'
