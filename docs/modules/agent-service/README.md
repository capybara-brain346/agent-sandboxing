# Agent Service — Slice 2 Tool Boundary

The Agent Service owns the future control-plane agent loop. This slice defines
only its internal sandbox-proxied tool boundary; it does not run a model, append
events, call the persisted command API, or expose an HTTP route. Slice 3 will
add the runner and event relay.

## Runtime boundary

Each factory receives a `Pick<SandboxRuntime, "simpleExec">`, the task's
container name, loaded `Config`, and the task `AbortSignal`. The factory returns
an AI SDK 7 `tool({ inputSchema, execute })` object. The registry contains
exactly these keys:

`read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.

The tools execute in `/workspace/repo` through `SandboxRuntime.simpleExec`.
They do not access Prisma, `SandboxService`, Docker, the event store, or
`process.env` directly. Every runtime call receives the task signal and either
`AGENT_TOOL_TIMEOUT_MS` or `AGENT_BASH_TIMEOUT_MS`.

## Tool contracts

- `read({ path })` returns `{ content, truncated }`. The content is capped at
  `AGENT_READ_MAX_BYTES`.
- `write({ path, content })` returns `{ bytesWritten }`. Content is sent as
  base64 through the shell and is capped at `AGENT_WRITE_MAX_BYTES`.
- `edit({ path, oldString, newString })` requires exactly one literal match,
  writes the replacement, and returns `{ diff, truncated }`. Files and the
  replacement are limited by the read/write limits; the returned replacement
  diff is capped at 1 KiB.
- `bash({ command })` returns bounded `{ stdout, stderr, exitCode, timedOut,
truncated }` output. Its timeout is `AGENT_BASH_TIMEOUT_MS` and its response
  budget is `AGENT_BASH_OUTPUT_MAX_BYTES`.
- `grep({ pattern, path? })` recursively returns numbered `matches`. Exit code
  1 is an empty match set.
- `find({ pattern, path? })` returns matching file paths in `paths`.
- `ls({ path? })` returns a detailed directory listing in `listing`.

`grep`, `find`, and `ls` have a fixed 50 KiB UTF-8 response budget and report
`truncated: true` when the budget is exceeded. All truncation preserves valid
UTF-8 boundaries.

## Validation and errors

Paths must be absolute lexical paths under `/workspace/repo`. Empty, relative,
traversal, NUL/control-character, shell-operator, and outside-workspace paths
are rejected. Generated path and data arguments use POSIX shell quoting; file
content is base64 encoded rather than interpolated as shell source.

The bash grammar permits only the allowlisted commands, with `|`, `&&`, and
`||` between command segments and redirects whose targets remain in the
workspace. It rejects newlines, semicolons, background execution, command
substitution, backticks, subshells, nested `sh`/`bash -c`, `xargs`, unsafe
`find` execution flags, outside-workspace paths, and test runners/invocations
including `npm test`, `npm run test`, `npx vitest`, `npx jest`, Playwright, and
Cypress.

Invalid input, oversized input, timeouts, non-zero command results, and
runtime failures become bounded `ServiceError`s with stable safe codes. Raw
runtime diagnostics are not copied into error messages. Cancellation remains an
`AbortError` so the future runner can stop the whole task cleanly.

## Configuration

The public runtime configuration contract is defined only in
[`src/config.ts`](../../../src/config.ts):

- `AGENT_TOOL_TIMEOUT_MS`: non-bash tool timeout, default 30 seconds.
- `AGENT_BASH_TIMEOUT_MS`: bash timeout, default 120 seconds.
- `AGENT_BASH_OUTPUT_MAX_BYTES`: bash response budget, default 50 KiB.
- `AGENT_READ_MAX_BYTES`: read/edit source budget, default 256 KiB.
- `AGENT_WRITE_MAX_BYTES`: write/edit result budget, default 1 MiB.

The tools are intentionally DB-independent and Docker-independent in tests;
tests mock only the `simpleExec` seam.
