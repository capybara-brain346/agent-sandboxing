import { describe, expect, it } from "vitest";
import { ApiError, isSessionAuthFailure } from "../frontend/src/api/client";

describe("frontend authentication errors", () => {
  it("keeps GitHub reconnect failures out of the app login redirect", () => {
    expect(
      isSessionAuthFailure(
        new ApiError(
          401,
          "github_reconnect_required",
          "Reconnect GitHub to refresh repository access",
        ),
      ),
    ).toBe(false);
    expect(
      isSessionAuthFailure(new ApiError(401, "auth_required", "Login")),
    ).toBe(true);
  });
});
