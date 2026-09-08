import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prediction, SweBenchTask } from "./types";

const predictionFields = new Set([
  "instance_id",
  "model_name_or_path",
  "model_patch",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const validatePrediction = (value: unknown): Prediction => {
  if (!isRecord(value)) throw new Error("prediction must be an object");
  for (const field of Object.keys(value))
    if (!predictionFields.has(field))
      throw new Error(`prediction contains unsupported field ${field}`);
  for (const field of predictionFields) {
    if (typeof value[field] !== "string")
      throw new Error(`prediction field ${field} must be a string`);
  }
  return {
    instance_id: value.instance_id as string,
    model_name_or_path: value.model_name_or_path as string,
    model_patch: value.model_patch as string,
  };
};

export const validatePredictions = (
  predictions: Prediction[],
  expectedTaskIds: string[],
): void => {
  const ids = new Set<string>();
  for (const prediction of predictions) {
    if (ids.has(prediction.instance_id))
      throw new Error(`duplicate prediction for ${prediction.instance_id}`);
    ids.add(prediction.instance_id);
  }
  const expected = new Set(expectedTaskIds);
  for (const id of ids)
    if (!expected.has(id)) throw new Error(`prediction has unknown task ${id}`);
  if (ids.size !== expected.size)
    throw new Error("prediction set does not match the selected task set");
};

export const predictionForResult = (
  task: SweBenchTask,
  diff: string,
  model: string,
): Prediction => ({
  instance_id: task.instance_id,
  model_name_or_path: model,
  model_patch: diff,
});

export const writePredictions = async (
  filePath: string,
  predictions: Prediction[],
  expectedTaskIds: string[],
): Promise<string> => {
  const absolutePath = path.resolve(filePath);
  validatePredictions(predictions, expectedTaskIds);
  const contents = `${predictions.map((prediction) => JSON.stringify(prediction)).join("\n")}\n`;
  await writeFile(absolutePath, contents, "utf8");
  return absolutePath;
};

export const readPredictions = async (
  filePath: string,
): Promise<Prediction[]> => {
  const contents = await readFile(path.resolve(filePath), "utf8");
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => validatePrediction(JSON.parse(line) as unknown));
};

export const predictionSha256 = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path.resolve(filePath)))
    .digest("hex");
