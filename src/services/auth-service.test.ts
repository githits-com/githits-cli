import { afterEach, describe, expect, it, mock } from "bun:test";
import { createServer } from "node:http";
import { FetchTimeoutError } from "../shared/fetch-timeout.js";
import { AuthServiceImpl, evaluateCallback } from "./auth-service.js";

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("AuthServiceImpl", () => {
  const service = new AuthServiceImpl();
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("generatePkceParams", () => {
    it("returns verifier, challenge, and state", () => {
      const params = service.generatePkceParams();
      expect(params.verifier).toBeDefined();
      expect(params.challenge).toBeDefined();
      expect(params.state).toBeDefined();
    });

    it("generates unique params each time", () => {
      const a = service.generatePkceParams();
      const b = service.generatePkceParams();
      expect(a.verifier).not.toBe(b.verifier);
      expect(a.state).not.toBe(b.state);
    });
  });

  describe("buildAuthUrl", () => {
    it("builds correct authorization URL with all parameters", () => {
      const url = service.buildAuthUrl({
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        clientId: "test-client-id",
        redirectUri: "http://127.0.0.1:8080/callback",
        state: "test-state",
        codeChallenge: "test-challenge",
      });

      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://auth.example.com");
      expect(parsed.pathname).toBe("/oauth/authorize");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "http://127.0.0.1:8080/callback",
      );
      expect(parsed.searchParams.get("state")).toBe("test-state");
      expect(parsed.searchParams.get("code_challenge")).toBe("test-challenge");
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    });
  });

  describe("discoverEndpoints", () => {
    it("throws on non-ok response", async () => {
      // Uses real fetch against non-existent server
      await expect(
        service.discoverEndpoints("http://127.0.0.1:1"),
      ).rejects.toThrow();
    });

    it("times out stalled discovery requests", async () => {
      const fetchFn = mock(() => new Promise<Response>(() => {}));
      const timeoutService = new AuthServiceImpl(asFetchFn(fetchFn), 1);

      await expect(
        timeoutService.discoverEndpoints("https://mcp.example.com"),
      ).rejects.toThrow(FetchTimeoutError);
    });
  });

  describe("startCallbackServer", () => {
    it("rejects before returning a handle when the callback port is unavailable", async () => {
      const occupiedServer = createServer();
      await new Promise<void>((resolve) => {
        occupiedServer.listen(0, "127.0.0.1", resolve);
      });
      const address = occupiedServer.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;

      try {
        await expect(
          service.startCallbackServer(port, "state"),
        ).rejects.toThrow("Failed to start callback server");
      } finally {
        await new Promise<void>((resolve, reject) => {
          occupiedServer.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    });
  });

  describe("refreshAccessToken", () => {
    it("accepts refresh responses that omit refresh_token", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "new-access-token",
              expires_in: 60,
            }),
            { status: 200 },
          ),
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await service.refreshAccessToken({
        tokenEndpoint: "https://auth.example.com/oauth/token",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "existing-refresh-token",
      });

      expect(result).toEqual({
        accessToken: "new-access-token",
        refreshToken: undefined,
        expiresIn: 60,
      });
    });

    it("times out stalled token refresh requests", async () => {
      const fetchFn = mock(() => new Promise<Response>(() => {}));
      const timeoutService = new AuthServiceImpl(asFetchFn(fetchFn), 1);

      await expect(
        timeoutService.refreshAccessToken({
          tokenEndpoint: "https://auth.example.com/oauth/token",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        }),
      ).rejects.toThrow(FetchTimeoutError);
    });
  });

  describe("evaluateCallback", () => {
    it("returns success outcome and clear success HTML", () => {
      const callback = evaluateCallback({
        code: "test-code",
        state: "state-ok",
        error: null,
        errorDescription: null,
        expectedState: "state-ok",
      });

      expect(callback.result).toEqual({
        type: "success",
        code: "test-code",
        state: "state-ok",
      });
      expect(callback.statusCode).toBe(200);
      expect(callback.html).toContain("signed in");
      expect(callback.html).toContain(
        "You can close this window and return to your terminal.",
      );
      expect(callback.html).toContain('data-copy="npx githits@latest --help"');
    });

    it("returns oauth error outcome and failure HTML", () => {
      const callback = evaluateCallback({
        code: null,
        state: null,
        error: "access_denied",
        errorDescription: "Denied",
        expectedState: "state-ok",
      });

      expect(callback.result).toEqual({
        type: "oauth_error",
        message: "access_denied: Denied",
      });
      expect(callback.statusCode).toBe(200);
      expect(callback.html).toContain("Sign-in failed");
      expect(callback.html).toContain("Access was denied.");
      expect(callback.html).toContain("Error code: <code>access_denied</code>");
      expect(callback.html).toContain(
        "To try again, run these commands in your terminal:",
      );
      expect(callback.html).toContain('data-copy="npx githits@latest logout"');
      expect(callback.html).toContain('data-copy="npx githits@latest login"');
    });

    it("returns invalid callback outcome for missing params", () => {
      const callback = evaluateCallback({
        code: null,
        state: "a",
        error: null,
        errorDescription: null,
        expectedState: "state-ok",
      });

      expect(callback.result).toEqual({
        type: "invalid_callback",
        message: "Authentication callback missing required parameters",
      });
      expect(callback.statusCode).toBe(400);
      expect(callback.html).toContain("Sign-in did not complete correctly.");
    });

    it("returns state mismatch outcome and security failure HTML", () => {
      const callback = evaluateCallback({
        code: "test-code",
        state: "wrong-state",
        error: null,
        errorDescription: null,
        expectedState: "expected-state",
      });

      expect(callback.result).toEqual({
        type: "state_mismatch",
        message: "Security validation failed (state mismatch)",
      });
      expect(callback.statusCode).toBe(400);
      expect(callback.html).toContain("Sign-in failed");
      expect(callback.html).toContain(
        "Sign-in could not be verified for security reasons.",
      );
    });
  });
});
