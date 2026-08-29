import { describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { ServiceError } from "../src/shared/errors";
import { createBashTool } from "../src/services/agent/tools/bash";
import { validateBashCommand } from "../src/services/agent/tools/bash-policy";
import { createEditTool } from "../src/services/agent/tools/edit";
import { createFindTool } from "../src/services/agent/tools/find";
import { createGrepTool } from "../src/services/agent/tools/grep";
import { createLsTool } from "../src/services/agent/tools/ls";
import { createPublishPullRequestTool } from "../src/services/agent/tools/publish-pull-request";
import { createPullRequestTool } from "../src/services/agent/tools/pull-request";
import { createReadTool } from "../src/services/agent/tools/read";
import { createToolRegistry } from "../src/services/agent/tools/registry";
import { createWriteTool } from "../src/services/agent/tools/write";
import type { SimpleExecResult } from "../src/types/sandbox.types";

const config = {
  AGENT_BASH_TIMEOUT_MS: 1200,
  AGENT_BASH_OUTPUT_MAX_BYTES: 32,
  AGENT_READ_MAX_BYTES: 8,
  AGENT_WRITE_MAX_BYTES: 32,
  AGENT_TOOL_TIMEOUT_MS: 300,
} as Config;

const success = (stdout = "", stderr = ""): SimpleExecResult => ({
  stdout,
  stderr,
  exitCode: 0,
  timedOut: false,
  truncated: false,
});

type RuntimeMock = {
  simpleExec: ReturnType<typeof vi.fn>;
};

type ExecutableTool = {
  execute(input: unknown): Promise<unknown>;
};

const execute = (candidate: unknown, input: unknown): Promise<unknown> =>
  (candidate as ExecutableTool).execute(input);

const runtime = (...results: SimpleExecResult[]): RuntimeMock => {
  const simpleExec = vi.fn();
  for (const result of results) simpleExec.mockResolvedValueOnce(result);
  if (results.length === 1) simpleExec.mockResolvedValue(results[0]);
  return { simpleExec };
};

const signal = new AbortController().signal;

describe("sandbox-proxied agent tools", () => {
  it("registers exactly the seven internal tools", () => {
    const tools = createToolRegistry(
      runtime(success()),
      "sandbox-1",
      config,
      signal,
    );
    expect(Object.keys(tools)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("registers backend-owned GitHub pull request tools", () => {
    const tools = createToolRegistry(
      runtime(success()),
      "sandbox-1",
      config,
      signal,
      { sessionId: "chat_1", messageId: "msg_1" },
      {
        publishPullRequest: vi.fn(),
        currentPullRequest: vi.fn(),
        pullRequest: vi.fn(),
      },
    );

    expect(Object.keys(tools)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
      "publish_pull_request",
      "pull_request",
    ]);
  });

  it("delegates pull request publication without branch or remote input", async () => {
    const fake = runtime(success());
    const github = {
      publishPullRequest: vi.fn(async () => ({
        success: true,
        action: "publish" as const,
        pullRequest: null,
        failure: null,
        github: null,
      })),
    };

    const result = await execute(
      createPublishPullRequestTool(
        fake,
        "sandbox-1",
        config,
        signal,
        "chat_1",
        "msg_1",
        github,
      ),
      { title: "Fix it", body: "Details", draft: false },
    );

    expect(result).toMatchObject({ success: true, action: "publish" });
    expect(github.publishPullRequest).toHaveBeenCalledWith(
      "chat_1",
      "msg_1",
      { runtime: fake, containerName: "sandbox-1" },
      { title: "Fix it", body: "Details", draft: false },
      { timeoutMs: 300, signal },
    );
  });

  it("reads the current session pull request without repository input", async () => {
    const github = {
      currentPullRequest: vi.fn(async () => ({
        provider: "github" as const,
        url: "https://github.test/pull/1",
        number: 1,
        branch: "agent/chat_1",
        baseBranch: "main",
        title: "Fix it",
        status: "open" as const,
        draft: true,
        failure: null,
      })),
      pullRequest: vi.fn(),
    };

    const result = await execute(
      createPullRequestTool(signal, "chat_1", "msg_1", github),
      { action: "read" },
    );

    expect(result).toMatchObject({
      success: true,
      action: "read",
      pullRequest: { number: 1 },
    });
    expect(github.currentPullRequest).toHaveBeenCalledWith("chat_1");
    expect(github.pullRequest).not.toHaveBeenCalled();
  });

  it("delegates pull request comments through the session-scoped GitHub service", async () => {
    const github = {
      currentPullRequest: vi.fn(),
      pullRequest: vi.fn(async () => ({
        success: true,
        action: "comment" as const,
        pullRequest: null,
        failure: null,
        github: null,
      })),
    };

    const result = await execute(
      createPullRequestTool(signal, "chat_1", "msg_1", github),
      { action: "comment", comment: "Looks good" },
    );

    expect(result).toMatchObject({ success: true, action: "comment" });
    expect(github.pullRequest).toHaveBeenCalledWith("chat_1", "msg_1", {
      action: "comment",
      comment: "Looks good",
    });
  });

  it.each([
    { action: "update" },
    { action: "comment", comment: "" },
    { action: "close", number: 0 },
  ])("rejects invalid pull request input: %o", async (input) => {
    const github = {
      currentPullRequest: vi.fn(),
      pullRequest: vi.fn(),
    };

    await expect(
      execute(createPullRequestTool(signal, "chat_1", "msg_1", github), input),
    ).rejects.toThrow();
    expect(github.currentPullRequest).not.toHaveBeenCalled();
    expect(github.pullRequest).not.toHaveBeenCalled();
  });

  it("reads bounded UTF-8 content with the task tool timeout", async () => {
    const fake = runtime(success("ééééé"));
    const result = await execute(
      createReadTool(fake, "sandbox-1", config, signal),
      { path: "/workspace/repo/it's.txt" },
    );

    expect(result).toEqual({ content: "éééé", truncated: true });
    expect(fake.simpleExec).toHaveBeenCalledWith(
      "sandbox-1",
      "cat -- '/workspace/repo/it'\\''s.txt'",
      "/workspace/repo",
      { timeoutMs: 300, signal },
    );
  });

  it("writes base64 input and reports UTF-8 bytes", async () => {
    const fake = runtime(success());
    const result = await execute(
      createWriteTool(fake, "sandbox-1", config, signal),
      { path: "/workspace/repo/out.txt", content: "hé" },
    );

    expect(result).toEqual({ bytesWritten: 3 });
    expect(fake.simpleExec).toHaveBeenCalledWith(
      "sandbox-1",
      expect.stringContaining("aMOp"),
      "/workspace/repo",
      { timeoutMs: 300, signal },
    );
  });

  it("edits exactly one match and returns a bounded diff", async () => {
    const fake = runtime(success("old"), success());
    const result = await execute(
      createEditTool(fake, "sandbox-1", config, signal),
      { path: "/workspace/repo/file.txt", oldString: "old", newString: "new" },
    );

    expect(result).toMatchObject({ truncated: false });
    expect(result).toMatchObject({
      diff: expect.stringContaining("-old\n+new"),
    });
    expect(fake.simpleExec).toHaveBeenCalledTimes(2);
  });

  it("rejects an oversized edit replacement and truncates large diffs safely", async () => {
    const fake = runtime(success("old"));
    await expect(
      execute(createEditTool(fake, "sandbox-1", config, signal), {
        path: "/workspace/repo/file.txt",
        oldString: "old",
        newString: "x".repeat(33),
      }),
    ).rejects.toMatchObject({ code: "tool_input_too_large" });
    expect(fake.simpleExec).toHaveBeenCalledTimes(0);

    const editConfig = {
      ...config,
      AGENT_READ_MAX_BYTES: 4096,
      AGENT_WRITE_MAX_BYTES: 4096,
    } as Config;
    const largeDiffRuntime = runtime(success("old"), success());
    const largeDiff = await execute(
      createEditTool(largeDiffRuntime, "sandbox-1", editConfig, signal),
      {
        path: "/workspace/repo/file.txt",
        oldString: "old",
        newString: "x".repeat(1500),
      },
    );
    expect(
      Buffer.byteLength((largeDiff as { diff: string }).diff),
    ).toBeLessThanOrEqual(1024);
    expect(largeDiff).toMatchObject({ truncated: true });
  });

  it.each([
    { oldString: "missing", code: "edit_target_not_found" },
    { oldString: "old", code: "edit_target_not_unique", source: "old\nold" },
  ])(
    "rejects an edit with an invalid target ($code)",
    async ({ oldString, code, source }) => {
      const fake = runtime(success(source ?? "before"));
      await expect(
        execute(createEditTool(fake, "sandbox-1", config, signal), {
          path: "/workspace/repo/file.txt",
          oldString,
          newString: "new",
        }),
      ).rejects.toMatchObject({ code });
      expect(fake.simpleExec).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects oversized writes and preserves valid UTF-8 output limits", async () => {
    const fake = runtime(success());
    await expect(
      execute(createWriteTool(fake, "sandbox-1", config, signal), {
        path: "/workspace/repo/file.txt",
        content: "x".repeat(33),
      }),
    ).rejects.toMatchObject({ code: "tool_input_too_large" });
    expect(fake.simpleExec).not.toHaveBeenCalled();
  });

  it("runs allowlisted pipelines and safe workspace redirects", async () => {
    const fake = runtime(success("ok"));
    const result = await execute(
      createBashTool(fake, "sandbox-1", config, signal),
      { command: "cat src/file.txt | grep name && printf ok > src/out.txt" },
    );

    expect(result).toMatchObject({
      stdout: "ok",
      exitCode: 0,
      truncated: false,
    });
    expect(fake.simpleExec).toHaveBeenCalledWith(
      "sandbox-1",
      "cat src/file.txt | grep name && printf ok > src/out.txt",
      "/workspace/repo",
      { timeoutMs: 1200, signal },
    );
  });

  it("returns non-zero bash output instead of failing the tool", async () => {
    const fake = runtime({
      stdout: "",
      stderr: "missing\n",
      exitCode: 2,
      timedOut: false,
      truncated: false,
    });
    const result = await execute(
      createBashTool(fake, "sandbox-1", config, signal),
      { command: "ls missing" },
    );

    expect(result).toEqual({
      stdout: "",
      stderr: "missing\n",
      exitCode: 2,
      timedOut: false,
      truncated: false,
    });
  });

  it.each([
    "npm test",
    "npm run test:unit",
    "npx vitest run",
    "cat file; echo injected",
    "sh -c 'cat secret'",
    "echo $(cat secret)",
    "cat ../../etc/passwd",
    "find . -exec cat {}",
    "xargs cat",
    "rm -rf /tmp/outside",
  ])("rejects unsafe bash grammar: %s", (command) => {
    expect(() => validateBashCommand(command)).toThrow(ServiceError);
  });

  it.each([
    "python -m pytest tests/test_config.py",
    "python3 verify_fix.py",
    "pytest tests/test_cli.py -k test_help",
    "uv run pytest tests/test_text_utils.py",
  ])("allows Python fixture verification: %s", (command) => {
    expect(validateBashCommand(command)).toBe(command);
  });

  it("treats grep exit code one as an empty match result", async () => {
    const fake = runtime({ ...success(), exitCode: 1 });
    const result = await execute(
      createGrepTool(fake, "sandbox-1", config, signal),
      { pattern: "not-found" },
    );
    expect(result).toEqual({ matches: "", truncated: false });
    expect(fake.simpleExec).toHaveBeenCalledWith(
      "sandbox-1",
      "grep -RIn -- 'not-found' '/workspace/repo'",
      "/workspace/repo",
      { timeoutMs: 300, signal },
    );
  });

  it("bounds grep, find, and ls responses at 50 KiB", async () => {
    const large = "é".repeat(30_000);
    const fake = runtime(success(large));
    const grepResult = await execute(
      createGrepTool(fake, "sandbox-1", config, signal),
      { pattern: "x" },
    );
    expect(
      Buffer.byteLength((grepResult as { matches: string }).matches),
    ).toBeLessThanOrEqual(50 * 1024);

    const findFake = runtime(success(large));
    const findResult = await execute(
      createFindTool(findFake, "sandbox-1", config, signal),
      { pattern: "*.ts" },
    );
    expect(
      Buffer.byteLength((findResult as { paths: string }).paths),
    ).toBeLessThanOrEqual(50 * 1024);
    expect(findFake.simpleExec).toHaveBeenCalledWith(
      "sandbox-1",
      "find '/workspace/repo' -type f -iname '*.ts' -print",
      "/workspace/repo",
      { timeoutMs: 300, signal },
    );

    const plainFindFake = runtime(success());
    await execute(createFindTool(plainFindFake, "sandbox-1", config, signal), {
      pattern: "tmux",
    });
    expect(plainFindFake.simpleExec).toHaveBeenCalledWith(
      "sandbox-1",
      "find '/workspace/repo' -type f -iname '*tmux*' -print",
      "/workspace/repo",
      { timeoutMs: 300, signal },
    );

    const lsFake = runtime(success(large));
    const lsResult = await execute(
      createLsTool(lsFake, "sandbox-1", config, signal),
      {},
    );
    expect(
      Buffer.byteLength((lsResult as { listing: string }).listing),
    ).toBeLessThanOrEqual(50 * 1024);
  });

  it("rejects traversal, relative paths, controls, and shell injection before execution", async () => {
    const fake = runtime(success());
    for (const path of [
      "relative.txt",
      "/workspace/repo/../secret",
      "/workspace/repo/file\u0000.txt",
      "/workspace/repo/file;touch /tmp/pwned",
    ]) {
      await expect(
        execute(createReadTool(fake, "sandbox-1", config, signal), { path }),
      ).rejects.toMatchObject({ code: "unsafe_path" });
    }
    expect(fake.simpleExec).not.toHaveBeenCalled();
  });

  it("wraps runtime failures without exposing raw diagnostics and propagates cancellation", async () => {
    const failed = {
      simpleExec: vi.fn().mockRejectedValue(new Error("secret token")),
    };
    await expect(
      execute(createReadTool(failed, "sandbox-1", config, signal), {
        path: "/workspace/repo/file.txt",
      }),
    ).rejects.toMatchObject({
      code: "tool_runtime_failure",
      message: expect.not.stringContaining("secret"),
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = runtime(success());
    await expect(
      execute(
        createReadTool(cancelled, "sandbox-1", config, controller.signal),
        {
          path: "/workspace/repo/file.txt",
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled.simpleExec).not.toHaveBeenCalled();
  });

  it("surfaces bash timeouts as service errors", async () => {
    const timedOut = runtime({ ...success(), timedOut: true, exitCode: null });
    await expect(
      execute(createBashTool(timedOut, "sandbox-1", config, signal), {
        command: "sleep 2",
      }),
    ).rejects.toMatchObject({ code: "tool_timeout" });
  });
});
