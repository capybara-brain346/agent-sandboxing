import type {
  ApiErrorBody,
  CreateTaskRequest,
  CreateTaskResponse,
  TaskCancellationResponse,
  TaskResult,
  TaskSnapshot,
} from "./types";

// Empty string means same-origin, routed through the Vite dev proxy (see
// vite.config.ts) for `/tasks` and `/health`.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? "unknown_error",
      body?.error.message ?? `Request failed with status ${response.status}`,
    );
  }
  return (await response.json()) as T;
};

export const createTask = (
  input: CreateTaskRequest,
): Promise<CreateTaskResponse> =>
  request("/tasks", { method: "POST", body: JSON.stringify(input) });

export const getTask = (taskId: string): Promise<TaskSnapshot> =>
  request(`/tasks/${taskId}`);

export const getTaskResult = (taskId: string): Promise<TaskResult> =>
  request(`/tasks/${taskId}/result`);

export const cancelTask = (taskId: string): Promise<TaskCancellationResponse> =>
  request(`/tasks/${taskId}`, { method: "DELETE" });

export { API_BASE_URL };
