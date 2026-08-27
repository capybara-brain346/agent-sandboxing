import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type ResultRecord = { caseId: string };

const isMissingFile = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );

const readRecords = async <T extends ResultRecord>(
  path: string,
): Promise<T[]> => {
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      if (index === lines.length - 1) return [];
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid eval result at ${path}:${index + 1}: ${message}`,
        {
          cause: error,
        },
      );
    }
    if (
      !record ||
      typeof record !== "object" ||
      typeof (record as { caseId?: unknown }).caseId !== "string"
    )
      throw new Error(
        `Invalid eval result at ${path}:${index + 1}: result record must contain a caseId`,
      );
    return [record as T];
  });
};

export const prepareResultFile = async <T extends ResultRecord>(
  path: string,
  resume: boolean,
): Promise<Map<string, T>> => {
  await mkdir(dirname(path), { recursive: true });
  if (!resume) {
    await writeFile(path, "", "utf8");
    return new Map();
  }

  let records: T[];
  try {
    records = await readRecords<T>(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    await writeFile(path, "", "utf8");
    records = [];
  }
  return new Map(records.map((record) => [record.caseId, record]));
};

export const appendResult = async <T>(
  path: string,
  result: T,
): Promise<void> => {
  await appendFile(path, `${JSON.stringify(result)}\n`, "utf8");
};
