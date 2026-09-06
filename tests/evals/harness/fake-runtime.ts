import path from "node:path";
import type { SimpleExecResult } from "../../../src/types/sandbox.types";
import type { AgentEvalToolExecution } from "./types";

const root = "/workspace/repo";

const ok = (stdout = "", stderr = ""): SimpleExecResult => ({
  stdout,
  stderr,
  exitCode: 0,
  timedOut: false,
  truncated: false,
});

const fail = (stderr: string): SimpleExecResult => ({
  stdout: "",
  stderr,
  exitCode: 1,
  timedOut: false,
  truncated: false,
});

const unquote = (value: string): string => {
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replaceAll("'\\''", "'");
  return value;
};

const relativePath = (workspacePath: string): string =>
  path.posix.relative(root, workspacePath);

const workspacePath = (filePath: string): string =>
  filePath.startsWith(root) ? filePath : path.posix.join(root, filePath);

const cloneFiles = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value]));

const changedFiles = (
  before: Record<string, string>,
  after: Record<string, string>,
): string[] => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
};

const lineMatches = (
  filePath: string,
  content: string,
  pattern: string,
): string[] =>
  content
    .split("\n")
    .flatMap((line, index) =>
      line.toLowerCase().includes(pattern.toLowerCase())
        ? [`${workspacePath(filePath)}:${index + 1}:${line}`]
        : [],
    );

const listDirectory = (
  files: Record<string, string>,
  directory: string,
): string => {
  const prefix = directory === root ? "" : `${relativePath(directory)}/`;
  const names = new Set<string>();
  for (const filePath of Object.keys(files))
    if (filePath.startsWith(prefix)) {
      const rest = filePath.slice(prefix.length);
      if (rest) names.add(rest.split("/")[0] ?? rest);
    }
  return [...names]
    .sort()
    .map((name) => `-rw-r--r-- 1 agent agent 0 Jan 1 00:00 ${name}`)
    .join("\n");
};

const findFiles = (
  files: Record<string, string>,
  searchPath: string,
  pattern: string,
): string => {
  const searchPrefix =
    searchPath === root ? "" : `${relativePath(searchPath)}/`;
  const needle = pattern.replaceAll("*", "").toLowerCase();
  return Object.keys(files)
    .filter((filePath) => filePath.startsWith(searchPrefix))
    .filter((filePath) =>
      path.posix.basename(filePath).toLowerCase().includes(needle),
    )
    .sort()
    .map(workspacePath)
    .join("\n");
};

export class FakeAgentRuntime {
  readonly executions: AgentEvalToolExecution[] = [];
  private files: Record<string, string>;

  constructor(files: Record<string, string>) {
    this.files = cloneFiles(files);
  }

  snapshot(): Record<string, string> {
    return cloneFiles(this.files);
  }

  simpleExec = async (
    _containerName: string,
    command: string,
  ): Promise<SimpleExecResult> => {
    const before = this.snapshot();
    const result = this.execute(command);
    this.executions.push({
      command,
      changedFiles: changedFiles(before, this.files),
    });
    return result;
  };

  private execute(command: string): SimpleExecResult {
    const read = command.match(/^cat -- (.+)$/);
    if (read) return this.read(unquote(read[1] ?? ""));

    const write = command.match(/^printf '%s' (.+) \| base64 --decode > (.+)$/);
    if (write)
      return this.write(
        unquote(write[2] ?? ""),
        Buffer.from(unquote(write[1] ?? ""), "base64").toString("utf8"),
      );

    const grep = command.match(/^grep -RIn -- (.+) (.+)$/);
    if (grep) return this.grep(unquote(grep[1] ?? ""), unquote(grep[2] ?? ""));

    const find = command.match(/^find (.+) -type f -iname (.+) -print$/);
    if (find)
      return ok(
        findFiles(this.files, unquote(find[1] ?? ""), unquote(find[2] ?? "")),
      );

    const ls = command.match(/^ls -la -- (.+)$/);
    if (ls) return ok(listDirectory(this.files, unquote(ls[1] ?? "")));

    if (/^(npm test|npm run typecheck|npm run lint)/.test(command))
      return ok("ok");
    if (/\b(rm|git reset|git checkout|mkfs|shutdown)\b/.test(command))
      return fail("destructive command blocked by fake eval runtime");
    return ok("ok");
  }

  private read(filePath: string): SimpleExecResult {
    const content = this.files[relativePath(filePath)];
    return content === undefined
      ? fail(`missing file: ${filePath}`)
      : ok(content);
  }

  private write(filePath: string, content: string): SimpleExecResult {
    this.files[relativePath(filePath)] = content;
    return ok();
  }

  private grep(pattern: string, searchPath: string): SimpleExecResult {
    const prefix = searchPath === root ? "" : `${relativePath(searchPath)}/`;
    const matches = Object.entries(this.files)
      .filter(([filePath]) => filePath.startsWith(prefix))
      .flatMap(([filePath, content]) => lineMatches(filePath, content, pattern))
      .join("\n");
    return { ...ok(matches), exitCode: matches ? 0 : 1 };
  }
}
