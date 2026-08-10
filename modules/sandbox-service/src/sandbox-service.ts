import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config";
import type {
  CommandRequest,
  CreateSandboxRequest,
  CreateSandboxResponse,
  DiffResponse,
  StartCommandResponse,
} from "./contracts";
import { CommandExecutionService } from "./command-execution-service";
import type { EventStore } from "./event-store";
import type { SandboxRuntime } from "./runtime";
import { SandboxLifecycleService } from "./sandbox-lifecycle-service";
import type { PublicEvent } from "./types";

export class SandboxService {
  private readonly lifecycle: SandboxLifecycleService;
  private readonly commands: CommandExecutionService;

  constructor(
    lifecycle: SandboxLifecycleService,
    commands: CommandExecutionService,
  );
  constructor(
    prisma: PrismaClient,
    events: EventStore,
    runtime: SandboxRuntime,
    config: Config,
    publish: (event: PublicEvent) => void,
  );
  constructor(
    lifecycleOrPrisma: SandboxLifecycleService | PrismaClient,
    commandsOrEvents: CommandExecutionService | EventStore,
    runtime?: SandboxRuntime,
    config?: Config,
    publish?: (event: PublicEvent) => void,
  ) {
    if (
      lifecycleOrPrisma instanceof SandboxLifecycleService &&
      commandsOrEvents instanceof CommandExecutionService
    ) {
      this.lifecycle = lifecycleOrPrisma;
      this.commands = commandsOrEvents;
      return;
    }

    if (!runtime || !config || !publish)
      throw new Error("SandboxService dependencies are incomplete");

    const prisma = lifecycleOrPrisma as PrismaClient;
    const events = commandsOrEvents as EventStore;
    this.lifecycle = new SandboxLifecycleService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );
    this.commands = new CommandExecutionService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );
  }

  async create(input: CreateSandboxRequest): Promise<CreateSandboxResponse> {
    return this.lifecycle.create(input);
  }

  async get(sandboxId: string): Promise<unknown> {
    return this.lifecycle.get(sandboxId);
  }

  async has(sandboxId: string): Promise<boolean> {
    return this.lifecycle.has(sandboxId);
  }

  async eventsAfter(sandboxId: string, after: number): Promise<PublicEvent[]> {
    return this.lifecycle.eventsAfter(sandboxId, after);
  }

  async startCommand(
    sandboxId: string,
    input: CommandRequest,
  ): Promise<StartCommandResponse> {
    return this.commands.startCommand(sandboxId, input);
  }

  async getCommand(sandboxId: string, commandId: string): Promise<unknown> {
    return this.commands.getCommand(sandboxId, commandId);
  }

  async diff(sandboxId: string): Promise<DiffResponse> {
    return this.lifecycle.diff(sandboxId);
  }

  async stop(sandboxId: string): Promise<unknown> {
    return this.lifecycle.stop(sandboxId);
  }
}
