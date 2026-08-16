import { ServiceError } from "../../../shared/errors";
import {
  shellQuote,
  hasControlCharacter,
  workspacePathFromArgument,
  validateWorkspacePath,
} from "./helpers";

export const ALLOWED_COMMANDS = new Set([
  "cd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "echo",
  "printf",
  "grep",
  "find",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sed",
  "awk",
  "git",
  "node",
  "npm",
  "npx",
  "cp",
  "mv",
  "rm",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "tee",
  "diff",
  "cmp",
  "file",
  "stat",
  "du",
  "df",
  "env",
  "pwd",
  "which",
  "type",
  "sh",
  "bash",
  "true",
  "false",
  "exit",
  "sleep",
  "time",
  "date",
  "dirname",
  "basename",
  "realpath",
  "readlink",
  "tar",
  "gzip",
  "gunzip",
  "unzip",
]);

const TEST_COMMANDS = /(?:vitest|jest|playwright|cypress|mocha)/i;
const FIND_EXECUTION_FLAGS = new Set([
  "-exec",
  "-execdir",
  "-delete",
  "-ok",
  "-okdir",
]);

type WordToken = { kind: "word"; value: string; quoted: boolean };
type OperatorToken = {
  kind: "operator";
  value: "|" | "&&" | "||" | ">" | ">>" | "<";
};
type Token = WordToken | OperatorToken;
type Segment = { words: WordToken[]; redirects: WordToken[] };

const unsafeCommand = (message: string): never => {
  throw new ServiceError("unsafe_command", message, 422);
};

const tokenize = (command: string): Token[] => {
  const tokens: Token[] = [];
  let word = "";
  let quoted = false;
  let quote: "'" | '"' | undefined;

  const flush = (): void => {
    if (word.length > 0) {
      tokens.push({ kind: "word", value: word, quoted });
      word = "";
      quoted = false;
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;

    if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
      quoted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      quoted = true;
      continue;
    }
    if (character === "\\") unsafeCommand("Backslash escapes are not allowed");
    if (/\s/.test(character)) {
      flush();
      continue;
    }

    if (character === "&") {
      if (command[index + 1] !== "&")
        unsafeCommand("Background execution is not allowed");
      flush();
      tokens.push({ kind: "operator", value: "&&" });
      index += 1;
      continue;
    }
    if (character === "|") {
      if (command[index + 1] === "|") {
        flush();
        tokens.push({ kind: "operator", value: "||" });
        index += 1;
      } else {
        flush();
        tokens.push({ kind: "operator", value: "|" });
      }
      continue;
    }
    if (character === ">" || character === "<") {
      flush();
      if (character === ">" && command[index + 1] === ">") {
        tokens.push({ kind: "operator", value: ">>" });
        index += 1;
      } else {
        tokens.push({ kind: "operator", value: character });
      }
      continue;
    }

    word += character;
  }

  if (quote) unsafeCommand("Unterminated shell quote");
  flush();
  return tokens;
};

const parseSegments = (tokens: Token[]): Segment[] => {
  const segments: Segment[] = [];
  let current: Segment = { words: [], redirects: [] };
  let expectRedirectTarget = false;

  for (const token of tokens) {
    if (token.kind === "operator") {
      if (token.value === "|" || token.value === "&&" || token.value === "||") {
        if (expectRedirectTarget || current.words.length === 0)
          unsafeCommand("Malformed command grammar");
        segments.push(current);
        current = { words: [], redirects: [] };
        continue;
      }
      if (expectRedirectTarget) unsafeCommand("Malformed redirection");
      expectRedirectTarget = true;
      continue;
    }

    if (expectRedirectTarget) {
      current.redirects.push(token);
      expectRedirectTarget = false;
    } else current.words.push(token);
  }

  if (expectRedirectTarget || current.words.length === 0)
    unsafeCommand("Malformed command grammar");
  segments.push(current);
  return segments;
};

const commandName = (segment: Segment): { index: number; name: string } => {
  const index = segment.words.findIndex(
    ({ value }) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value),
  );
  if (index === -1) unsafeCommand("A command is required");
  const word = segment.words[index];
  if (word === undefined) return unsafeCommand("A command is required");
  return { index, name: word.value.toLowerCase() };
};

const validatePathLikeWord = (token: WordToken): void => {
  const { value } = token;
  if (value.split("/").includes(".."))
    unsafeCommand("Path traversal is not allowed");
  if (value.startsWith("/")) validateWorkspacePath(value);
  else if (value.includes("/")) workspacePathFromArgument(value);

  const equalsIndex = value.indexOf("=");
  if (equalsIndex > 0 && value.slice(equalsIndex + 1).startsWith("/"))
    validateWorkspacePath(value.slice(equalsIndex + 1));
};

const rejectTestInvocation = (name: string, args: string[]): void => {
  const lowered = args.map((value) => value.toLowerCase());
  if (name === "npm") {
    if (lowered[0] === "test" || lowered[0] === "t")
      unsafeCommand("Test commands are not allowed");
    if (
      lowered[0] === "run" &&
      lowered[1] !== undefined &&
      /^test(?:$|[:_-])/.test(lowered[1])
    )
      unsafeCommand("Test commands are not allowed");
    if (
      lowered[0] === "exec" &&
      lowered.some((value) => TEST_COMMANDS.test(value))
    )
      unsafeCommand("Test commands are not allowed");
  }
  if (name === "npx" && lowered.some((value) => TEST_COMMANDS.test(value)))
    unsafeCommand("Test commands are not allowed");
};

export const validateBashCommand = (command: string): string => {
  if (typeof command !== "string" || command.trim().length === 0)
    return unsafeCommand("Command must not be empty");
  if (hasControlCharacter(command))
    return unsafeCommand("Control characters are not allowed");
  if (
    command.includes("`") ||
    command.includes("$") ||
    command.includes("(") ||
    command.includes(")") ||
    command.includes(";")
  )
    return unsafeCommand("Command substitution and subshells are not allowed");

  const segments = parseSegments(tokenize(command.trim()));
  for (const segment of segments) {
    for (const token of [...segment.words, ...segment.redirects])
      validatePathLikeWord(token);

    for (const value of segment.words.map((token) =>
      token.value.toLowerCase(),
    )) {
      if (value === "xargs" || FIND_EXECUTION_FLAGS.has(value))
        unsafeCommand("Unsafe command flags are not allowed");
    }

    const { index, name } = commandName(segment);
    if (!ALLOWED_COMMANDS.has(name))
      unsafeCommand(`Command '${name}' is not allowed`);

    const args = segment.words.slice(index + 1).map(({ value }) => value);
    rejectTestInvocation(name, args);

    if (
      (name === "sh" || name === "bash") &&
      args.some(
        (value) =>
          value === "-c" || value === "--command" || /^-[^-]*c/.test(value),
      )
    )
      unsafeCommand("Nested shells are not allowed");
    if (
      name === "env" &&
      args.some(
        (value) =>
          !value.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value),
      )
    )
      unsafeCommand("env may not launch another command");
    if (
      name === "find" &&
      args.some((value) => FIND_EXECUTION_FLAGS.has(value.toLowerCase()))
    )
      unsafeCommand("Unsafe find execution flags are not allowed");
    if (
      name === "node" &&
      args.some((value) => value === "-e" || value === "--eval")
    )
      unsafeCommand("Inline node scripts are not allowed");
  }

  return command.trim();
};

export { shellQuote };
