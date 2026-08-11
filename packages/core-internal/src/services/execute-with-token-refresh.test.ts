import { describe, expect, it, mock } from "bun:test";
import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import { TermsAcceptanceRequiredError } from "./githits-service.js";

describe("executeWithTokenRefresh", () => {
  it("never calls the refresh hook for an opaque ghi-* token", async () => {
    const forceRefresh = mock(() => Promise.resolve("unexpected-token"));
    const executeWithToken = mock(() =>
      Promise.reject(new TermsAcceptanceRequiredError()),
    );

    await expect(
      executeWithTokenRefresh({
        getToken: mock(() => Promise.resolve("ghi-static-token")),
        forceRefresh,
        executeWithToken,
        shouldRefresh: () => true,
      }),
    ).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);

    expect(forceRefresh).not.toHaveBeenCalled();
    expect(executeWithToken).toHaveBeenCalledTimes(1);
  });
});
