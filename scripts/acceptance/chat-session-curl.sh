#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
REPO_REF="${REPO_REF:-./repo}"
INSTRUCTIONS="${INSTRUCTIONS:-Read exactly /workspace/repo/hello.txt with the read tool. Do not modify any files. Return a concise summary.}"
POLL_SECONDS="${POLL_SECONDS:-180}"
SSE_TIMEOUT_SECONDS="${SSE_TIMEOUT_SECONDS:-5}"

TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf -- "${TMP_DIR}"
}
trap cleanup EXIT

fail() {
  printf '[chat-session-curl] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[chat-session-curl] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

dump_response() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    sed -n '1,240p' "${file}" >&2
  fi
}

assert_json() {
  local expression="$1"
  local file="$2"
  if ! jq -e "${expression}" "${file}" >/dev/null; then
    dump_response "${file}"
    fail "JSON assertion failed: ${expression}"
  fi
}

assert_json_arg() {
  local arg_name="$1"
  local arg_value="$2"
  local expression="$3"
  local file="$4"
  if ! jq -e --arg "${arg_name}" "${arg_value}" "${expression}" "${file}" >/dev/null; then
    dump_response "${file}"
    fail "JSON assertion failed: ${expression}"
  fi
}

assert_sse_event() {
  local file="$1"
  local event_type="$2"
  if ! grep -Fqx -- "event: ${event_type}" "${file}"; then
    dump_response "${file}"
    fail "SSE stream did not contain event ${event_type}"
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
    status="$(curl -sS --connect-timeout 5 -o "${output}" -w '%{http_code}' \
      -X "${method}" -H 'content-type: application/json' \
      -d "${body}" "${BASE_URL}${path}")" || {
      dump_response "${output}"
      fail "request failed: ${method} ${path}"
    }
  else
    status="$(curl -sS --connect-timeout 5 -o "${output}" -w '%{http_code}' \
      -X "${method}" "${BASE_URL}${path}")" || {
      dump_response "${output}"
      fail "request failed: ${method} ${path}"
    }
  fi

  if [[ "${status}" != "${expected_status}" ]]; then
    dump_response "${output}"
    fail "expected HTTP ${expected_status} for ${method} ${path}, got ${status}"
  fi
}

poll_for_completion() {
  local session_id="$1"
  local run_id="$2"
  local output="${TMP_DIR}/run.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    curl_json GET "/chat-sessions/${session_id}/runs/${run_id}" '' 200 "${output}"
    status="$(jq -r '.status // empty' "${output}")"
    case "${status}" in
      completed)
        cp -- "${output}" "${TMP_DIR}/run-completed.json"
        log "run ${run_id} reached completed"
        return
        ;;
      failed|cancelled)
        dump_response "${output}"
        fail "run ${run_id} reached ${status}"
        ;;
      created|provisioning|running)
        sleep 1
        ;;
      *)
        dump_response "${output}"
        fail "run ${run_id} returned unknown status: ${status}"
        ;;
    esac
  done

  dump_response "${output}"
  fail "run ${run_id} did not complete within ${POLL_SECONDS}s"
}

capture_sse() {
  local session_id="$1"
  local run_id="$2"
  local output="${TMP_DIR}/events.sse"
  local headers="${TMP_DIR}/events.headers"
  local exit_code

  set +e
  timeout "${SSE_TIMEOUT_SECONDS}" curl -sS -N -D "${headers}" \
    "${BASE_URL}/chat-sessions/${session_id}/runs/${run_id}/events?after=0" >"${output}"
  exit_code=$?
  set -e

  if [[ "${exit_code}" != "0" && "${exit_code}" != "124" ]]; then
    dump_response "${output}"
    fail "SSE request failed with exit code ${exit_code}"
  fi
  grep -Eiq '^content-type: text/event-stream' "${headers}" || {
    dump_response "${headers}"
    dump_response "${output}"
    fail "events endpoint did not return text/event-stream"
  }
  [[ -s "${output}" ]] || fail "events endpoint returned no data"
}

validate_sse() {
  local run_id="$1"
  local output="${TMP_DIR}/events.sse"
  local jsonl="${TMP_DIR}/events.jsonl"
  local events_json="${TMP_DIR}/events.json"
  local last_sequence

  for event_type in \
    sandbox_created sandbox_provisioning_started sandbox_ready \
    agent_tool_call agent_tool_result run_completed run_result_ready; do
    assert_sse_event "${output}" "${event_type}"
  done

  awk '
    /^id: / {
      if ($2 !~ /^[0-9]+$/) exit 1
      current = $2 + 0
      if (seen && current <= previous) exit 1
      previous = current
      seen = 1
    }
    END { exit seen ? 0 : 1 }
  ' "${output}" || {
    dump_response "${output}"
    fail 'SSE event IDs were not strictly increasing'
  }

  awk '/^data: / { sub(/^data: /, ""); print }' "${output}" >"${jsonl}"
  if ! jq -s '.' "${jsonl}" >"${events_json}"; then
    dump_response "${output}"
    fail 'SSE event data was not valid JSON'
  fi
  assert_json_arg run_id "${run_id}" \
    'length > 0 and all(.[]; .runId == $run_id and .streamId == $run_id and (.sequence | type) == "number")' \
    "${events_json}"

  last_sequence="$(awk '/^id: / { id = $2 } END { print id }' "${output}")"
  [[ "${last_sequence}" =~ ^[0-9]+$ ]] || fail 'SSE stream had no final sequence'
  log "replayed run events through sequence ${last_sequence}"
}

require_command curl
require_command jq
require_command timeout

[[ "${POLL_SECONDS}" =~ ^[1-9][0-9]*$ ]] || fail 'POLL_SECONDS must be a positive integer'
[[ "${SSE_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || fail 'SSE_TIMEOUT_SECONDS must be a positive integer'

log "checking ${BASE_URL}/health"
curl_json GET /health '' 200 "${TMP_DIR}/health.json"
assert_json '.status == "ok" and .checks.database.status == "ok"' "${TMP_DIR}/health.json"

log 'creating chat session'
create_body="$(jq -cn --arg ref "${REPO_REF}" '{repo: {source: "fixture", ref: $ref}}')"
curl_json POST /chat-sessions "${create_body}" 201 "${TMP_DIR}/session.json"
assert_json '.chatSessionId | startswith("chat_")' "${TMP_DIR}/session.json"
SESSION_ID="$(jq -r '.chatSessionId' "${TMP_DIR}/session.json")"

log "sending message to ${SESSION_ID}"
message_body="$(jq -cn --arg content "${INSTRUCTIONS}" '{content: $content}')"
curl_json POST "/chat-sessions/${SESSION_ID}/messages" "${message_body}" 202 "${TMP_DIR}/create.json"
assert_json '.run.taskRunId | startswith("run_")' "${TMP_DIR}/create.json"
assert_json '.run.status == "created" and (.run.eventsUrl | endswith("/events"))' "${TMP_DIR}/create.json"
RUN_ID="$(jq -r '.run.taskRunId' "${TMP_DIR}/create.json")"

log "checking initial snapshot for ${RUN_ID}"
curl_json GET "/chat-sessions/${SESSION_ID}/runs/${RUN_ID}" '' 200 "${TMP_DIR}/initial-run.json"
assert_json_arg run_id "${RUN_ID}" \
  '.taskRunId == $run_id and .eventsUrl == ("/chat-sessions/'"${SESSION_ID}"'/runs/" + $run_id + "/events") and .resultUrl == ("/chat-sessions/'"${SESSION_ID}"'/runs/" + $run_id + "/result")' \
  "${TMP_DIR}/initial-run.json"

poll_for_completion "${SESSION_ID}" "${RUN_ID}"
curl_json GET "/chat-sessions/${SESSION_ID}/runs/${RUN_ID}/result" '' 200 "${TMP_DIR}/result.json"
assert_json_arg run_id "${RUN_ID}" \
  '.taskRunId == $run_id and .status == "completed" and .exitReason == "completed" and (.diff | type) == "string" and (.agentSummary | type) == "string" and (.agentSummary | length) > 0' \
  "${TMP_DIR}/result.json"

capture_sse "${SESSION_ID}" "${RUN_ID}"
validate_sse "${RUN_ID}"

log 'checking terminal cancellation response'
curl_json DELETE "/chat-sessions/${SESSION_ID}/runs/${RUN_ID}" '' 409 "${TMP_DIR}/cancel.json"
assert_json '.error.code == "run_already_terminal"' "${TMP_DIR}/cancel.json"

printf 'PASS chat session curl flow (%s / %s)\n' "${SESSION_ID}" "${RUN_ID}"
