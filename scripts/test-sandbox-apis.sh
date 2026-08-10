#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
HOST_FIXTURE_REPO_PATH="${HOST_FIXTURE_REPO_PATH:-./repo}"
API_FIXTURE_REPO_PATH="${API_FIXTURE_REPO_PATH:-}"
POLL_SECONDS="${POLL_SECONDS:-60}"
COMMAND_TIMEOUT_MS="${COMMAND_TIMEOUT_MS:-10000}"

TMP_DIR="$(mktemp -d)"
SANDBOX_ID=""
STOPPED_SANDBOX="false"

cleanup() {
  local exit_code=$?
  if [[ -n "${SANDBOX_ID}" && "${STOPPED_SANDBOX}" != "true" ]]; then
    curl -fsS -X DELETE "${BASE_URL}/sandboxes/${SANDBOX_ID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TMP_DIR}"
  exit "${exit_code}"
}
trap cleanup EXIT

log() {
  printf '[sandbox-api] %s\n' "$*"
}

fail() {
  printf '[sandbox-api] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

json_field() {
  local file="$1"
  local field="$2"
  node -e '
    const fs = require("node:fs");
    const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = process.argv[2].split(".").reduce((current, key) => current?.[key], input);
    if (value === undefined || value === null) process.exit(2);
    if (typeof value === "object") console.log(JSON.stringify(value));
    else console.log(String(value));
  ' "${file}" "${field}"
}

curl_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local expected_status="$4"
  local out_file="$5"
  local status

  if [[ -n "${body}" ]]; then
    status="$(curl -sS -o "${out_file}" -w '%{http_code}' \
      -X "${method}" \
      -H 'content-type: application/json' \
      -d "${body}" \
      "${BASE_URL}${path}")"
  else
    status="$(curl -sS -o "${out_file}" -w '%{http_code}' \
      -X "${method}" \
      "${BASE_URL}${path}")"
  fi

  if [[ "${status}" != "${expected_status}" ]]; then
    printf 'Expected HTTP %s for %s %s, got %s\n' "${expected_status}" "${method}" "${path}" "${status}" >&2
    printf 'Response body:\n' >&2
    sed -n '1,220p' "${out_file}" >&2
    exit 1
  fi
}

prepare_fixture_repo() {
  if [[ -d "${HOST_FIXTURE_REPO_PATH}/.git" ]]; then
    log "using existing fixture repo at ${HOST_FIXTURE_REPO_PATH}"
    return
  fi

  if [[ -e "${HOST_FIXTURE_REPO_PATH}" && ! -d "${HOST_FIXTURE_REPO_PATH}" ]]; then
    fail "${HOST_FIXTURE_REPO_PATH} exists but is not a directory"
  fi

  log "creating fixture repo at ${HOST_FIXTURE_REPO_PATH}"
  mkdir -p "${HOST_FIXTURE_REPO_PATH}"
  git -C "${HOST_FIXTURE_REPO_PATH}" init -b main >/dev/null
  git -C "${HOST_FIXTURE_REPO_PATH}" config user.email acceptance@example.test
  git -C "${HOST_FIXTURE_REPO_PATH}" config user.name acceptance
  printf 'hello from fixture\n' > "${HOST_FIXTURE_REPO_PATH}/hello.txt"
  git -C "${HOST_FIXTURE_REPO_PATH}" add hello.txt
  git -C "${HOST_FIXTURE_REPO_PATH}" commit -m fixture >/dev/null
}

wait_for_sandbox_ready() {
  local snapshot="$TMP_DIR/sandbox.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    curl_json GET "/sandboxes/${SANDBOX_ID}" "" 200 "${snapshot}"
    status="$(json_field "${snapshot}" status)"
    case "${status}" in
      ready)
        log "sandbox ready: ${SANDBOX_ID}"
        return
        ;;
      failed)
        sed -n '1,220p' "${snapshot}" >&2
        fail "sandbox provisioning failed"
        ;;
      *)
        sleep 1
        ;;
    esac
  done

  sed -n '1,220p' "${snapshot}" >&2 || true
  fail "sandbox did not become ready within ${POLL_SECONDS}s"
}

wait_for_command_done() {
  local command_id="$1"
  local snapshot="$TMP_DIR/command.json"
  local deadline=$((SECONDS + POLL_SECONDS))
  local status

  while (( SECONDS < deadline )); do
    curl_json GET "/sandboxes/${SANDBOX_ID}/commands/${command_id}" "" 200 "${snapshot}"
    status="$(json_field "${snapshot}" status)"
    case "${status}" in
      succeeded)
        log "command succeeded: ${command_id}"
        return
        ;;
      failed|timed_out|cancelled)
        sed -n '1,220p' "${snapshot}" >&2
        fail "command finished with status ${status}"
        ;;
      *)
        sleep 1
        ;;
    esac
  done

  sed -n '1,220p' "${snapshot}" >&2 || true
  fail "command did not finish within ${POLL_SECONDS}s"
}

require_command curl
require_command git
require_command node

log "checking health at ${BASE_URL}"
curl_json GET /health "" 200 "$TMP_DIR/health.json"

prepare_fixture_repo

log "checking unsupported create request validation"
curl_json POST /sandboxes '{"unexpectedField":"value"}' 400 "$TMP_DIR/create-invalid.json"
[[ "$(json_field "$TMP_DIR/create-invalid.json" error.code)" == "unsupported_request" ]] || fail "unexpected validation error code"

log "creating sandbox"
if [[ -n "${API_FIXTURE_REPO_PATH}" ]]; then
  create_body="$(node -e 'console.log(JSON.stringify({ fixtureRepoPath: process.argv[1] }))' "${API_FIXTURE_REPO_PATH}")"
else
  create_body='{}'
fi
curl_json POST /sandboxes "${create_body}" 202 "$TMP_DIR/create.json"
SANDBOX_ID="$(json_field "$TMP_DIR/create.json" sandboxId)"
[[ -n "${SANDBOX_ID}" ]] || fail "create response did not include sandboxId"

wait_for_sandbox_ready

log "checking event replay"
set +e
curl -sS -N --max-time 2 "${BASE_URL}/sandboxes/${SANDBOX_ID}/events?after=0" > "$TMP_DIR/events.sse"
events_exit=$?
set -e
if [[ "${events_exit}" != "0" && "${events_exit}" != "28" ]]; then
  sed -n '1,220p' "$TMP_DIR/events.sse" >&2
  fail "event replay curl failed with exit code ${events_exit}"
fi
grep -q 'event: sandbox_created' "$TMP_DIR/events.sse" || fail "event replay did not include sandbox_created"
grep -q 'event: sandbox_ready' "$TMP_DIR/events.sse" || fail "event replay did not include sandbox_ready"

log "checking unsafe command validation"
curl_json POST "/sandboxes/${SANDBOX_ID}/commands" '{"command":"pwd","cwd":"/tmp"}' 422 "$TMP_DIR/command-invalid.json"
[[ "$(json_field "$TMP_DIR/command-invalid.json" error.code)" == "unsafe_command_request" ]] || fail "unexpected command validation error code"

log "starting command"
command_body="$(node -e '
  console.log(JSON.stringify({
    command: "printf '\''curl acceptance\\n'\'' >> hello.txt",
    cwd: "/workspace/repo",
    env: { ACCEPTANCE_MODE: "curl" },
    timeoutMs: Number(process.argv[1]),
  }))
' "${COMMAND_TIMEOUT_MS}")"
curl_json POST "/sandboxes/${SANDBOX_ID}/commands" "${command_body}" 202 "$TMP_DIR/command-start.json"
COMMAND_ID="$(json_field "$TMP_DIR/command-start.json" commandId)"
[[ -n "${COMMAND_ID}" ]] || fail "command response did not include commandId"

wait_for_command_done "${COMMAND_ID}"

log "checking diff"
curl_json GET "/sandboxes/${SANDBOX_ID}/diff" "" 200 "$TMP_DIR/diff.json"
json_field "$TMP_DIR/diff.json" diff > "$TMP_DIR/diff.txt"
grep -q 'curl acceptance' "$TMP_DIR/diff.txt" || fail "diff did not include command change"

log "stopping sandbox"
curl_json DELETE "/sandboxes/${SANDBOX_ID}" "" 200 "$TMP_DIR/stop.json"
STOPPED_SANDBOX="true"
[[ "$(json_field "$TMP_DIR/stop.json" status)" == "stopped" ]] || fail "sandbox did not stop"

log "sandbox API curl flow passed"
