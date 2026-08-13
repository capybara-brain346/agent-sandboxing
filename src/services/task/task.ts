import { ServiceError } from "../../shared/errors";
import type {
  CreateTaskRequest,
  TaskCancellationResponse,
  CreateTaskResponse,
  TaskResult,
  TaskServicePort,
  TaskSnapshot,
  PublicTaskEvent,
} from "../../types/task.types";

/**
 * Phase 1 only defines the task boundary. The lifecycle implementation is
 * added in the following phases; keeping the production dependency explicit
 * prevents the route layer from reaching into sandbox internals meanwhile.
 */
export class TaskService implements TaskServicePort {
  private unavailable(): never {
    throw new ServiceError(
      "task_service_unavailable",
      "Task Service is not implemented",
      501,
    );
  }

  async create(_input: CreateTaskRequest): Promise<CreateTaskResponse> {
    return this.unavailable();
  }

  async get(_taskId: string): Promise<TaskSnapshot> {
    return this.unavailable();
  }

  async eventsAfter(
    _taskId: string,
    _after: number,
  ): Promise<PublicTaskEvent[]> {
    return this.unavailable();
  }

  async result(_taskId: string): Promise<TaskResult> {
    return this.unavailable();
  }

  async cancel(_taskId: string): Promise<TaskCancellationResponse> {
    return this.unavailable();
  }
}

export const taskService = new TaskService();
