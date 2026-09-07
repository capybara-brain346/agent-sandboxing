import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Trace, TraceSink } from "../../types/trace.types";

export class LocalTraceSink implements TraceSink {
  constructor(private readonly path: string) {}

  async finishTrace(trace: Trace): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(trace)}\n`, "utf8");
  }
}
