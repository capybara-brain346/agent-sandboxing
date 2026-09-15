import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { takeUtf8Prefix } from "../src/shared/utf8";
import type {
  SimpleExecOptions,
  SimpleExecResult,
} from "../src/types/sandbox.types";

class Output {
  private readonly decoder = new StringDecoder("utf8");
  private readonly chunks: string[] = [];

  constructor(
    private readonly budget: { remaining: number; truncated: boolean },
  ) {}

  append(data: Buffer): void {
    const value = this.decoder.write(data);
    if (!value || this.budget.remaining === 0) {
      this.budget.truncated ||= Boolean(value);
      return;
    }
    const bounded = takeUtf8Prefix(value, this.budget.remaining);
    this.chunks.push(bounded);
    this.budget.remaining -= Buffer.byteLength(bounded);
    this.budget.truncated ||= bounded.length !== value.length;
  }

  finish(): string {
    const value = this.decoder.end();
    if (value && this.budget.remaining > 0) {
      const bounded = takeUtf8Prefix(value, this.budget.remaining);
      this.chunks.push(bounded);
      this.budget.remaining -= Buffer.byteLength(bounded);
      this.budget.truncated ||= bounded.length !== value.length;
    } else this.budget.truncated ||= Boolean(value);
    return this.chunks.join("");
  }
}

const abortError = (): Error =>
  Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

export class LocalProcessRuntime {
  constructor(
    private readonly workspace: string,
    private readonly outputMaxBytes: number,
  ) {}

  async simpleExec(
    _containerName: string,
    command: string,
    _cwd: string,
    options: SimpleExecOptions = {},
  ): Promise<SimpleExecResult> {
    if (options.signal?.aborted) throw abortError();
    const workspace = `'${this.workspace.replaceAll("'", "'\\''")}'`;
    const translated = command.replace(
      /\/workspace\/repo(?=\/|$)/g,
      () => workspace,
    );
    return new Promise((resolve, reject) => {
      const budget = { remaining: this.outputMaxBytes, truncated: false };
      const stdout = new Output(budget);
      const stderr = new Output(budget);
      const child = spawn("sh", ["-lc", translated], {
        cwd: this.workspace,
        env: { ...process.env, ...options.env },
        stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      });
      let settled = false;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      const clear = (): void => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clear();
        resolve({
          stdout: stdout.finish(),
          stderr: stderr.finish(),
          exitCode: timedOut ? null : exitCode,
          timedOut,
          truncated: budget.truncated,
        });
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        clear();
        child.kill("SIGKILL");
        reject(abortError());
      };
      child.stdout.on("data", (data: Buffer) => stdout.append(data));
      child.stderr.on("data", (data: Buffer) => stderr.append(data));
      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          clear();
          reject(error);
        }
      });
      child.once("close", finish);
      child.stdin?.end(options.stdin);
      if (options.signal)
        options.signal.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs)
        timer = setTimeout(() => {
          if (!settled) {
            timedOut = true;
            child.kill("SIGKILL");
          }
        }, options.timeoutMs);
    });
  }
}
