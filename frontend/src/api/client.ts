import type {
  ApiErrorBody,
  ArtifactContent,
  AuthMe,
  ChatSession,
  ChatSessionListItem,
  ChatMessage,
  CreateChatSessionRequest,
  CreateMessageRequest,
  CreateMessageResponse,
  GitHubRepositoriesResponse,
  GitHubBranch,
  GitHubRepository,
  Page,
  PullRequestMetadata,
  MessageCancellationResponse,
  SessionResult,
  UpdateChatSessionRequest,
} from "./types";

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

export const isSessionAuthFailure = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 401 &&
  error.code !== "github_reconnect_required";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

export const getAuthMe = (): Promise<AuthMe> => request("/auth/me");

export const logout = (): Promise<void> =>
  request("/auth/logout", { method: "POST" });

const githubRepositoriesRequests = new Map<
  string,
  Promise<GitHubRepositoriesResponse>
>();

export const getGitHubRepositories = ({
  forceRefresh = false,
  cursor,
  limit,
}: {
  forceRefresh?: boolean;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<GitHubRepositoriesResponse> => {
  const query = new URLSearchParams();
  if (forceRefresh) query.set("forceRefresh", "true");
  if (cursor) query.set("cursor", cursor);
  if (limit) query.set("limit", String(limit));
  const suffix = query.toString();
  const path = `/github/repositories${suffix ? `?${suffix}` : ""}`;
  if (!forceRefresh) {
    const existing = githubRepositoriesRequests.get(path);
    if (existing) return existing;
  }

  const nextRequest = request<GitHubRepositoriesResponse>(path);
  githubRepositoriesRequests.set(path, nextRequest);
  void nextRequest.then(
    () => {
      if (githubRepositoriesRequests.get(path) === nextRequest)
        githubRepositoriesRequests.delete(path);
    },
    () => {
      if (githubRepositoriesRequests.get(path) === nextRequest)
        githubRepositoriesRequests.delete(path);
    },
  );
  return nextRequest;
};

export const getGitHubBranches = (
  repository: Pick<
    GitHubRepository,
    "repoId" | "owner" | "name" | "installationId"
  >,
): Promise<GitHubBranch[]> => {
  const query = new URLSearchParams({
    owner: repository.owner,
    name: repository.name,
    installationId: repository.installationId,
  });
  return request(
    `/github/repositories/${encodeURIComponent(repository.repoId)}/branches?${query}`,
  );
};

export const createChatSession = (
  input: CreateChatSessionRequest,
): Promise<ChatSession> =>
  request("/chat-sessions", { method: "POST", body: JSON.stringify(input) });

export const listChatSessions = (
  params: { limit?: number; cursor?: string } = {},
): Promise<Page<ChatSessionListItem>> => {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const suffix = query.toString();
  return request(`/chat-sessions${suffix ? `?${suffix}` : ""}`);
};

export const getChatSession = (sessionId: string): Promise<ChatSession> =>
  request(`/chat-sessions/${sessionId}`);

export const updateChatSession = (
  sessionId: string,
  input: UpdateChatSessionRequest,
): Promise<ChatSession> =>
  request(`/chat-sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

export const listMessages = (
  sessionId: string,
  params: { limit?: number; before?: string } = {},
): Promise<Page<ChatMessage>> => {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.before) query.set("before", params.before);
  const suffix = query.toString();
  return request(
    `/chat-sessions/${sessionId}/messages${suffix ? `?${suffix}` : ""}`,
  );
};

export const sendMessage = (
  sessionId: string,
  input: CreateMessageRequest,
): Promise<CreateMessageResponse> =>
  request(`/chat-sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getCurrentPullRequest = (
  sessionId: string,
): Promise<PullRequestMetadata | null> =>
  request(`/chat-sessions/${sessionId}/pull-request`);

export const getSessionResult = (sessionId: string): Promise<SessionResult> =>
  request(`/chat-sessions/${sessionId}/result`);

export const cancelSession = (
  sessionId: string,
): Promise<MessageCancellationResponse> =>
  request(`/chat-sessions/${sessionId}/cancel`, { method: "POST" });

export const getArtifact = (
  sessionId: string,
  artifactId: string,
): Promise<ArtifactContent> =>
  request(`/chat-sessions/${sessionId}/artifacts/${artifactId}`);

export { API_BASE_URL };
