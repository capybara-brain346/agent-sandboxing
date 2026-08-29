import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { AUTH_COOKIE_NAME, signSessionToken } from "../src/services/auth/auth";

vi.mock("../src/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}));

const { createApp } = await import("../src/server");
const testConfig = loadConfig();
const authCookie = `${AUTH_COOKIE_NAME}=${await signSessionToken(
  {
    sub: "user_1",
    login: "octo",
    avatarUrl: "https://github.com/octo.png",
    email: null,
  },
  testConfig.AUTH_COOKIE_SECRET,
)}`;

describe("HTTP wiring", () => {
  const app = createApp();

  beforeEach(() => vi.restoreAllMocks());

  it("reports health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("exposes strict chat-session routes", async () => {
    const response = await request(app)
      .post("/chat-sessions")
      .set("Cookie", authCookie)
      .set("Origin", new URL(testConfig.APP_BASE_URL).origin)
      .send({
        repo: { source: "fixture", ref: "./repo" },
        unexpected: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it.each([
    ["post", "/sandboxes"],
    ["get", "/sandboxes/sbox_1"],
    ["get", "/sandboxes/sbox_1/events"],
    ["post", "/sandboxes/sbox_1/commands"],
    ["get", "/sandboxes/sbox_1/commands/cmd_1"],
    ["get", "/sandboxes/sbox_1/diff"],
    ["delete", "/sandboxes/sbox_1"],
    ["post", "/tasks"],
    ["get", "/tasks/task_1"],
    ["get", "/tasks/task_1/events"],
    ["get", "/tasks/task_1/result"],
    ["delete", "/tasks/task_1"],
  ] as const)("returns 404 for retired route %s %s", async (method, path) => {
    const response = await request(app)[method](path);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });
});
