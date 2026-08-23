#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
POLL_SECONDS="${POLL_SECONDS:-180}"
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

  if [[ "${FAILURE_REPO_MOVED}" == "true" ]]; then
    if [[ -e "${FIXTURE_REPO_PATH}" && -e "${FAILURE_REPO_BACKUP}" ]]; then
      printf '[chat-session-acceptance] ERROR: fixture path reappeared before restore\n' >&2
      exit_code=1
    elif [[ -e "${FAILURE_REPO_BACKUP}" ]]; then
      mv -- "${FAILURE_REPO_BACKUP}" "${FIXTURE_REPO_PATH}" || exit_code=1
    elif [[ ! -e "${FIXTURE_REPO_PATH}" ]]; then
      printf '[chat-session-acceptance] ERROR: fixture backup was lost before restore\n' >&2
      exit_code=1
    fi
  fi

  rm -rf -- "${TMP_DIR}"
  exit "${exit_code}"
}
trap cleanup EXIT

log() {
  printf '[chat-session-acceptance] %s\n' "$*"
}

fail() {
  printf '[chat-session-acceptance] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

dump_file_safely() {
  local file="$1"
  local line

  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ -n "${OPENROUTER_API_KEY:-}" &&
      "${line}" == *"${OPENROUTER_API_KEY}"* ]]; then
      printf '[redacted sensitive output]\n' >&2
    else
      printf '%s\n' "${line}" >&2
    fi
  done < "${file}" || true
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "${expected}" "${file}" || {
    printf '%s\n' "--- ${file} ---" >&2
    dump_file_safely "${file}"
    fail "expected ${file} to contain: ${expected}"
  }
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "${unexpected}" "${file}"; then
    printf '%s\n' "--- ${file} ---" >&2
    dump_file_safely "${file}"
    fail "expected ${file} not to contain: ${unexpected}"
  fi
}

assert_json() {
  local expression="$1"
  local file="$2"
  if ! jq -e "${expression}" "${file}" >/dev/null; then
    printf '%s\n' "--- ${file} ---" >&2
    dump_file_safely "${file}"
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
    dump_file_safely "${file}"
    fail "JSON assertion failed: ${expression}"
  fi
}

assert_jsonl_arg() {
  local arg_name="$1"
  local arg_value="$2"
  local expression="$3"
  local file="$4"
  if ! jq -s -e --arg "${arg_name}" "${arg_value}" "${expression}" "${file}" >/dev/null; then
    printf '%s\n' "--- ${file} ---" >&2
    dump_file_safely "${file}"
    fail "JSONL assertion failed: ${expression}"
  fi
}

assert_jsonl_two_args() {
  local first_name="$1"
  local first_value="$2"
  local second_name="$3"
  local second_value="$4"
  local expression="$5"
  local file="$6"
  if ! jq -s -e \
    --arg "${first_name}" "${first_value}" \
    --arg "${second_name}" "${second_value}" \
    "${expression}" "${file}" >/dev/null; then
    printf '%s\n' "--- ${file} ---" >&2
    dump_file_safely "${file}"
    fail "JSONL assertion failed: ${expression}"
  fi
}

curl_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  local expected_status="$4"
  local output="$5"
  local status

  if [[ -n "${body}" ]]; then
    if ! status="$(curl -sS -o "${output}" -w '%{http_code}' \
      -X "${method}" -H 'content-type: application/json' \
      -d "${body}" "${BASE_URL}${path}")"; then
      printf 'Request failed for %s %s\n' "${method}" "${path}" >&2
      dump_file_safely "${output}"
      exit 1
    fi
  else
    if ! status="$(curl -sS -o "${output}" -w '%{http_code}' \
      -X "${method}" "${BASE_URL}${path}")"; then
      printf 'Request failed for %s %s\n' "${method}" "${path}" >&2
      dump_file_safely "${output}"
      exit 1
    fi
  fi

  if [[ "${status}" != "${expected_status}" ]]; then
    printf 'Expected HTTP %s for %s %s, got %s\n' \
      "${expected_status}" "${method}" "${path}" "${status}" >&2
    dump_file_safely "${output}"
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

fetch_run_snapshot() {
  local session_id="$1"
  local run_id="$2"
  local output="$3"
  local status

  status="$(curl -sS -o "${output}" -w '%{http_code}' \
    "${BASE_URL}/chat-sessions/${session_id}/runs/${run_id}")" ||
    fail "could not fetch run ${run_id}"
  if [[ "${status}" != "200" ]]; then
    printf 'Expected HTTP 200 while polling run %s, got %s\n' \
      "${run_id}" "${status}" >&2
    dump_file_safely "${output}"
    exit 1
  fi
}

wait_for_run_status() {
  local session_id="$1"
  local run_id="$2"
  local expected="$3"
  local snapshot="${TMP_DIR}/${run_id}.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    fetch_run_snapshot "${session_id}" "${run_id}" "${snapshot}"
    status="$(jq -r '.status // empty' "${snapshot}")"
    if [[ "${status}" == "${expected}" ]]; then
      log "run ${run_id} reached ${expected}"
      return
    fi
    case "${status}" in
      completed|failed|cancelled)
        printf '%s\n' "--- ${snapshot} ---" >&2
        dump_file_safely "${snapshot}"
        fail "run ${run_id} reached ${status}, expected ${expected}"
        ;;
    esac
    sleep 1
  done

  printf '%s\n' "--- ${snapshot} ---" >&2
  dump_file_safely "${snapshot}"
  fail "run ${run_id} did not reach ${expected} within ${POLL_SECONDS}s"
}

wait_for_terminal_run() {
  local session_id="$1"
  local run_id="$2"
  local snapshot="${TMP_DIR}/${run_id}-terminal.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    fetch_run_snapshot "${session_id}" "${run_id}" "${snapshot}"
    status="$(jq -r '.status // empty' "${snapshot}")"
    case "${status}" in
      completed|failed|cancelled)
        log "run ${run_id} reached terminal state ${status}"
        return
        ;;
    esac
    sleep 1
  done

  printf '%s\n' "--- ${snapshot} ---" >&2
  dump_file_safely "${snapshot}"
  fail "run ${run_id} did not reach a terminal state within ${POLL_SECONDS}s"
}

capture_sse() {
  local path="$1"
  local output="$2"
  local last_event_id="${3:-}"
  local exit_code

  set +e
  if [[ -n "${last_event_id}" ]]; then
    timeout "${SSE_TIMEOUT_SECONDS}" curl -sS -N \
      -H "Last-Event-ID: ${last_event_id}" "${BASE_URL}${path}" > "${output}"
  else
    timeout "${SSE_TIMEOUT_SECONDS}" curl -sS -N \
      "${BASE_URL}${path}" > "${output}"
  fi
  exit_code=$?
  set -e

  if [[ "${exit_code}" != "0" && "${exit_code}" != "124" ]]; then
    printf '%s\n' "--- ${output} ---" >&2
    dump_file_safely "${output}"
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
    dump_file_safely "${file}"
    fail "SSE events were not in strictly increasing sequence order"
  fi
}

extract_sse_json() {
  local sse_file="$1"
  local json_file="$2"
  awk '/^data: / { sub(/^data: /, ""); print }' "${sse_file}" > "${json_file}"
  [[ -s "${json_file}" ]] || fail "SSE stream ${sse_file} contained no event data"
}

assert_sse_event_type() {
  assert_contains "$1" "event: $2"
}

assert_no_provider_output() {
  local file="$1"
  if [[ -n "${OPENROUTER_API_KEY:-}" ]] &&
    grep -Fq -- "${OPENROUTER_API_KEY}" "${file}"; then
    fail "provider credential appeared in event output"
  fi
  for marker in OPENROUTER_API_KEY 'Bearer ' 'AI_APICallError' 'APICallError' \
    'provider_error' 'invalid_api_key' 'invalid api key'; do
    assert_not_contains "${file}" "${marker}"
  done
}

assert_agent_events() {
  local sse_file="$1"
  local run_id="$2"
  local sandbox_id="$3"
  local json_file="${sse_file}.jsonl"
  extract_sse_json "${sse_file}" "${json_file}"
  assert_no_provider_output "${sse_file}"

  assert_jsonl_arg run_id "${run_id}" \
    'all(.[]; .streamId == $run_id and .runId == $run_id)' "${json_file}"
  assert_jsonl_two_args run_id "${run_id}" sandbox_id "${sandbox_id}" \
    '[.[] | select(.type == "agent_tool_call" or .type == "agent_tool_result")] | length > 0 and all(.[]; .producerService == "agent" and .producerId == $run_id and .sandboxId == $sandbox_id and (.correlationId | type) == "string" and (.correlationId | length) > 0)' \
    "${json_file}"
  assert_jsonl_arg run_id "${run_id}" \
    '[.[] | select(.type == "agent_tool_call")] as $calls | [.[] | select(.type == "agent_tool_result")] as $results | ($calls | length) > 0 and ($calls | length) == ($results | length) and all($calls[]; (.payload.tool_name | type) == "string" and (.payload.tool_name | length) > 0 and (.payload.args | type) == "object") and all($calls[]; . as $call | ([ $results[] | select(.correlationId == $call.correlationId)] | if length == 1 then .[0] else null end) as $result | $result != null and $result.sequence > $call.sequence and $result.payload.tool_name == $call.payload.tool_name)' \
    "${json_file}"
  assert_jsonl \
    '[.[] | select(.type == "agent_tool_result")] as $results | ($results | length) > 0 and all($results[]; (.payload.tool_name | type) == "string" and (.payload.result_snippet | type) == "string" and (.payload.result_snippet | utf8bytelength) <= 500 and (.payload.truncated | type) == "boolean" and ((.payload.exit_code == null) or ((.payload.exit_code | type) == "number" and (.payload.exit_code | floor) == .payload.exit_code and .payload.exit_code >= 0 and .payload.exit_code <= 255)) and (.payload.duration_ms | type) == "number" and (.payload.duration_ms | floor) == .payload.duration_ms and .payload.duration_ms >= 0)' \
    "${json_file}"
}

assert_jsonl() {
  local expression="$1"
  local file="$2"
  if ! jq -s -e "${expression}" "${file}" >/dev/null; then
    printf '%s\n' "--- ${file} ---" >&2
    dump_file_safely "${file}"
    fail "JSONL assertion failed: ${expression}"
  fi
}

assert_fixture_unchanged() {
  local current_status="${TMP_DIR}/fixture-status.current"
  local current_diff="${TMP_DIR}/fixture-diff.current"
  local current_cached_diff="${TMP_DIR}/fixture-cached-diff.current"
  git -C "${FIXTURE_REPO_PATH}" status --porcelain=v1 > "${current_status}"
  git -C "${FIXTURE_REPO_PATH}" diff --binary > "${current_diff}"
  git -C "${FIXTURE_REPO_PATH}" diff --cached --binary > "${current_cached_diff}"
  cmp -s "${TMP_DIR}/fixture-status.before" "${current_status}" ||
    fail "agent run changed the host fixture status"
  cmp -s "${TMP_DIR}/fixture-diff.before" "${current_diff}" ||
    fail "agent run changed the host fixture worktree"
  cmp -s "${TMP_DIR}/fixture-cached-diff.before" "${current_cached_diff}" ||
    fail "agent run changed the host fixture index"
}

preflight() {
  local health_file="${TMP_DIR}/preflight-health.json"
  [[ "${NODE_ENV:-development}" != "test" ]] ||
    fail "NODE_ENV=test is not supported by the live acceptance harness"
  [[ -n "${OPENROUTER_API_KEY:-}" ]] ||
    fail "OPENROUTER_API_KEY must be configured for live acceptance"
  docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable"
  npx prisma migrate status >/dev/null 2>&1 ||
    fail "Postgres is unreachable or Prisma migrations are not applied"
  log "checking API health at ${BASE_URL}"
  curl_json GET /health '' 200 "${health_file}"
  assert_json '.status == "ok" and .checks.database.status == "ok"' "${health_file}"
}

restore_fixture_repo() {
  if [[ "${FAILURE_REPO_MOVED}" != "true" ]]; then return; fi
  [[ ! -e "${FIXTURE_REPO_PATH}" ]] ||
    fail "fixture path reappeared before failure-path cleanup"
  mv -- "${FAILURE_REPO_BACKUP}" "${FIXTURE_REPO_PATH}"
  FAILURE_REPO_MOVED=false
}

create_session() {
  local output="$1"
  local body
  body="$(jq -cn --arg ref "${REPO_REF}" '{repo: {source: "fixture", ref: $ref}}')"
  curl_json POST /chat-sessions "${body}" 201 "${output}"
  assert_json '(.chatSessionId | startswith("chat_")) and .status == "active" and .latestRun == null and (.sandboxId | not)' "${output}"
}

send_message() {
  local session_id="$1"
  local content="$2"
  local output="$3"
  local body
  body="$(jq -cn --arg content "${content}" '{content: $content}')"
  curl_json POST "/chat-sessions/${session_id}/messages" "${body}" 202 "${output}"
  assert_json '.run != null and (.run.taskRunId | startswith("run_")) and .run.status == "created"' "${output}"
}

require_command curl
require_command docker
require_command git
require_command jq
require_command npx
require_command timeout

cd -- "${PROJECT_ROOT}"
preflight
prepare_fixture_repo
git -C "${FIXTURE_REPO_PATH}" status --porcelain=v1 > "${TMP_DIR}/fixture-status.before"
git -C "${FIXTURE_REPO_PATH}" diff --binary > "${TMP_DIR}/fixture-diff.before"
git -C "${FIXTURE_REPO_PATH}" diff --cached --binary > "${TMP_DIR}/fixture-cached-diff.before"
if [[ -s "${TMP_DIR}/fixture-status.before" ||
  -s "${TMP_DIR}/fixture-diff.before" ||
  -s "${TMP_DIR}/fixture-cached-diff.before" ]]; then
  fail "fixture repo must have a clean worktree and index"
fi

log "creating chat session"
create_session "${TMP_DIR}/session-create.json"
SESSION_ID="$(jq -r '.chatSessionId' "${TMP_DIR}/session-create.json")"

READ_INSTRUCTIONS='Use the read tool to read exactly /workspace/repo/hello.txt. This is a read-only task: do not call write or edit, do not call bash, and do not modify any file. Then give a concise summary that includes what you read.'
log "sending read-only message to session ${SESSION_ID}"
send_message "${SESSION_ID}" "${READ_INSTRUCTIONS}" "${TMP_DIR}/read-create.json"
READ_RUN_ID="$(jq -r '.run.taskRunId' "${TMP_DIR}/read-create.json")"
READ_RUN_EVENTS_URL="/chat-sessions/${SESSION_ID}/runs/${READ_RUN_ID}/events"
assert_json_arg events_url "${READ_RUN_EVENTS_URL}" \
  '.run.eventsUrl == $events_url' "${TMP_DIR}/read-create.json"
wait_for_run_status "${SESSION_ID}" "${READ_RUN_ID}" completed
curl_json GET "/chat-sessions/${SESSION_ID}/runs/${READ_RUN_ID}" '' 200 "${TMP_DIR}/read-snapshot.json"
assert_json '.status == "completed"' "${TMP_DIR}/read-snapshot.json"
curl_json GET "/chat-sessions/${SESSION_ID}/runs/${READ_RUN_ID}/result" '' 200 "${TMP_DIR}/read-result.json"
assert_json '.status == "completed" and .exitReason == "completed" and (.agentSummary | type == "string") and (.agentSummary | length > 0) and .diff == ""' "${TMP_DIR}/read-result.json"

log "checking read-only run events, session provisioning, and cleanup"
capture_sse "/chat-sessions/${SESSION_ID}/runs/${READ_RUN_ID}/events?after=0" "${TMP_DIR}/read-events.sse"
for event_type in sandbox_created sandbox_provisioning_started sandbox_ready \
  agent_tool_call agent_tool_result run_completed run_result_ready; do
  assert_sse_event_type "${TMP_DIR}/read-events.sse" "${event_type}"
done
assert_sse_ordered "${TMP_DIR}/read-events.sse"
READ_SANDBOX_ID="$(awk '/^data: / { sub(/^data: /, ""); print }' "${TMP_DIR}/read-events.sse" | jq -s -r '[.[] | select(.type == "sandbox_created")][0].sandboxId // empty')"
[[ -n "${READ_SANDBOX_ID}" ]] || fail "first run did not expose a sandbox ID in its events"
assert_agent_events "${TMP_DIR}/read-events.sse" "${READ_RUN_ID}" "${READ_SANDBOX_ID}"
assert_jsonl_arg path /workspace/repo/hello.txt \
  '[.[] | select(.type == "agent_tool_call")] | any(.[]; .payload.tool_name == "read" and .payload.args.path == $path) and all(.[]; .payload.tool_name != "write" and .payload.tool_name != "edit")' \
  "${TMP_DIR}/read-events.sse.jsonl"
if docker ps -a --format '{{.Names}}' | grep -Fxq -- "sandbox-${READ_SANDBOX_ID}"; then
  log "session sandbox sandbox-${READ_SANDBOX_ID} remains running (expected: sandbox is session-owned and reused)"
else
  fail "session sandbox sandbox-${READ_SANDBOX_ID} was unexpectedly removed after the run completed"
fi
assert_fixture_unchanged

log "checking session SSE and run SSE cursor replay"
capture_sse "/chat-sessions/${SESSION_ID}/events?after=0" "${TMP_DIR}/session-events.sse"
for event_type in session_created message_created run_requested run_created run_completed run_result_ready; do
  assert_sse_event_type "${TMP_DIR}/session-events.sse" "${event_type}"
done
assert_sse_ordered "${TMP_DIR}/session-events.sse"

capture_sse "/chat-sessions/${SESSION_ID}/runs/${READ_RUN_ID}/events?after=2" "${TMP_DIR}/read-events-after-2.sse"
FIRST_REPLAYED_ID="$(awk '/^id: / { print $2; exit }' "${TMP_DIR}/read-events-after-2.sse")"
[[ "${FIRST_REPLAYED_ID}" =~ ^[0-9]+$ && "${FIRST_REPLAYED_ID}" -gt 2 ]] ||
  fail "after=2 replay started at invalid sequence: ${FIRST_REPLAYED_ID}"
assert_sse_ordered "${TMP_DIR}/read-events-after-2.sse"
capture_sse "/chat-sessions/${SESSION_ID}/runs/${READ_RUN_ID}/events" "${TMP_DIR}/read-events-last-id.sse" 2
FIRST_RESUMED_ID="$(awk '/^id: / { print $2; exit }' "${TMP_DIR}/read-events-last-id.sse")"
[[ "${FIRST_RESUMED_ID}" =~ ^[0-9]+$ && "${FIRST_RESUMED_ID}" -gt 2 ]] ||
  fail "Last-Event-ID replay started at invalid sequence: ${FIRST_RESUMED_ID}"
assert_sse_ordered "${TMP_DIR}/read-events-last-id.sse"

WRITE_LINE='agent acceptance edit'
WRITE_INSTRUCTIONS="Use the edit or write tool to make exactly this change in /workspace/repo/hello.txt: append one new final line containing exactly '${WRITE_LINE}'. Preserve every existing line and do not modify any other file. Verify the change with a read, then give a concise summary."
log "sending exact-edit message to the same session"
send_message "${SESSION_ID}" "${WRITE_INSTRUCTIONS}" "${TMP_DIR}/write-create.json"
WRITE_RUN_ID="$(jq -r '.run.taskRunId' "${TMP_DIR}/write-create.json")"
wait_for_run_status "${SESSION_ID}" "${WRITE_RUN_ID}" completed
curl_json GET "/chat-sessions/${SESSION_ID}/runs/${WRITE_RUN_ID}/result" '' 200 "${TMP_DIR}/write-result.json"
assert_json '.status == "completed" and .exitReason == "completed" and (.agentSummary | type == "string") and (.agentSummary | length > 0) and (.diff | type == "string") and (.diff | length > 0)' "${TMP_DIR}/write-result.json"
assert_contains "${TMP_DIR}/write-result.json" "+${WRITE_LINE}"
capture_sse "/chat-sessions/${SESSION_ID}/runs/${WRITE_RUN_ID}/events?after=0" "${TMP_DIR}/write-events.sse"
for event_type in agent_tool_call agent_tool_result run_completed run_result_ready; do
  assert_sse_event_type "${TMP_DIR}/write-events.sse" "${event_type}"
done
assert_sse_ordered "${TMP_DIR}/write-events.sse"
WRITE_SANDBOX_ID="$(awk '/^data: / { sub(/^data: /, ""); print }' "${TMP_DIR}/write-events.sse" | jq -s -r '[.[] | select(.type == "sandbox_created")][0].sandboxId // empty')"
[[ -z "${WRITE_SANDBOX_ID}" ]] ||
  fail "second run in the same session re-provisioned a sandbox instead of reusing it"
assert_agent_events "${TMP_DIR}/write-events.sse" "${WRITE_RUN_ID}" "${READ_SANDBOX_ID}"
assert_jsonl_arg path /workspace/repo/hello.txt \
  '[.[] | select(.type == "agent_tool_call")] | any(.[]; (.payload.tool_name == "edit" or .payload.tool_name == "write") and .payload.args.path == $path)' \
  "${TMP_DIR}/write-events.sse.jsonl"
assert_fixture_unchanged

log "checking one-active-run-per-session enforcement"
CONFLICT_BODY="$(jq -cn '{content: "Fix something else while a run might still be active"}')"
CONFLICT_STATUS="$(curl -sS -o "${TMP_DIR}/conflict.json" -w '%{http_code}' \
  -X POST -H 'content-type: application/json' -d "${CONFLICT_BODY}" \
  "${BASE_URL}/chat-sessions/${SESSION_ID}/messages")"
case "${CONFLICT_STATUS}" in
  409)
    assert_json '.error.code == "session_run_in_progress"' "${TMP_DIR}/conflict.json"
    ;;
  202)
    log "no run was active at send time; skipping conflict assertion for this timing window"
    CONFLICT_RUN_ID="$(jq -r '.run.taskRunId' "${TMP_DIR}/conflict.json")"
    wait_for_terminal_run "${SESSION_ID}" "${CONFLICT_RUN_ID}"
    ;;
  *)
    printf 'Unexpected concurrent-message HTTP status: %s\n' "${CONFLICT_STATUS}" >&2
    dump_file_safely "${TMP_DIR}/conflict.json"
    exit 1
    ;;
esac

log "checking cancellation smoke path"
send_message "${SESSION_ID}" "Cancel this live agent run immediately; no file changes are required." "${TMP_DIR}/cancel-create.json"
CANCEL_RUN_ID="$(jq -r '.run.taskRunId' "${TMP_DIR}/cancel-create.json")"
CANCEL_STATUS="$(curl -sS -o "${TMP_DIR}/cancel.json" -w '%{http_code}' \
  -X DELETE "${BASE_URL}/chat-sessions/${SESSION_ID}/runs/${CANCEL_RUN_ID}")"
case "${CANCEL_STATUS}" in
  202)
    assert_json_arg run_id "${CANCEL_RUN_ID}" \
      '.taskRunId == $run_id and .status == "cancelling"' \
      "${TMP_DIR}/cancel.json"
    wait_for_terminal_run "${SESSION_ID}" "${CANCEL_RUN_ID}"
    ;;
  200)
    assert_json_arg run_id "${CANCEL_RUN_ID}" \
      '.taskRunId == $run_id and .status == "cancelled"' \
      "${TMP_DIR}/cancel.json"
    ;;
  409)
    assert_json '.error.code == "run_already_terminal"' "${TMP_DIR}/cancel.json"
    ;;
  *)
    printf 'Unexpected cancellation HTTP status: %s\n' "${CANCEL_STATUS}" >&2
    dump_file_safely "${TMP_DIR}/cancel.json"
    exit 1
    ;;
esac
assert_fixture_unchanged

log "checking provisioning failure path in a fresh session"
[[ ! -e "${FAILURE_REPO_BACKUP}" ]] || fail "temporary failure fixture path already exists"
FAILURE_REPO_MOVED=true
mv -- "${FIXTURE_REPO_PATH}" "${FAILURE_REPO_BACKUP}"
create_session "${TMP_DIR}/failure-session-create.json"
FAILURE_SESSION_ID="$(jq -r '.chatSessionId' "${TMP_DIR}/failure-session-create.json")"
send_message "${FAILURE_SESSION_ID}" "Should fail provisioning" "${TMP_DIR}/failure-create.json"
FAILED_RUN_ID="$(jq -r '.run.taskRunId' "${TMP_DIR}/failure-create.json")"
wait_for_run_status "${FAILURE_SESSION_ID}" "${FAILED_RUN_ID}" failed
capture_sse "/chat-sessions/${FAILURE_SESSION_ID}/runs/${FAILED_RUN_ID}/events?after=0" "${TMP_DIR}/failure-events.sse"
assert_sse_event_type "${TMP_DIR}/failure-events.sse" run_failed
assert_sse_event_type "${TMP_DIR}/failure-events.sse" run_result_ready
curl_json GET "/chat-sessions/${FAILURE_SESSION_ID}/runs/${FAILED_RUN_ID}/result" '' 200 "${TMP_DIR}/failure-result.json"
assert_json '.status == "failed" and .exitReason == "failed"' "${TMP_DIR}/failure-result.json"
restore_fixture_repo
assert_fixture_unchanged

log "checking retired /tasks and /sandboxes routes"
RETIRED_STATUS="$(curl -sS -o "${TMP_DIR}/retired.json" -w '%{http_code}' "${BASE_URL}/tasks/nonexistent")"
[[ "${RETIRED_STATUS}" == "404" ]] || fail "expected /tasks/* to return 404, got ${RETIRED_STATUS}"
assert_json '.error.code == "not_found"' "${TMP_DIR}/retired.json"

printf 'PASS chat session atomic MVP + live agent acceptance\n'
