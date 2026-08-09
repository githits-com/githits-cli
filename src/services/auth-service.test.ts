import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { once } from "node:events";
import { createServer, ServerResponse } from "node:http";
import { connect } from "node:net";
import { FetchTimeoutError } from "@githits/core-internal";
import {
  AuthServiceImpl,
  type CallbackServerHandle,
  classifyTerminalRefreshError,
  evaluateCallback,
  TokenRefreshError,
} from "./auth-service.js";

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  if (port === 0) throw new Error("Failed to allocate a callback test port");
  return port;
}

interface CallbackTestServer {
  handle: CallbackServerHandle;
  port: number;
}

async function startCallbackTestServer(
  service: AuthServiceImpl,
  expectedState: string,
): Promise<CallbackTestServer> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const port = await getAvailablePort();
    try {
      return {
        handle: await service.startCallbackServer(port, expectedState),
        port,
      };
    } catch (error) {
      const portWasReallocated =
        error instanceof Error && error.message.includes("EADDRINUSE");
      if (!portWasReallocated || attempt === maxAttempts) throw error;
    }
  }
  throw new Error("Failed to start callback test server");
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
      const fetchFn = mock(() =>
        Promise.resolve(new Response("unavailable", { status: 503 })),
      );
      const injectedService = new AuthServiceImpl(asFetchFn(fetchFn));

      await expect(
        injectedService.discoverEndpoints("https://mcp.example.com"),
      ).rejects.toThrow("Failed to discover OAuth endpoints: 503");
    });

    it("times out stalled discovery requests", async () => {
      const fetchFn = mock(() => new Promise<Response>(() => {}));
      const timeoutService = new AuthServiceImpl(asFetchFn(fetchFn), 1);

      await expect(
        timeoutService.discoverEndpoints("https://mcp.example.com"),
      ).rejects.toThrow(FetchTimeoutError);
    });

    it("returns validated OAuth metadata", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({
            authorization_endpoint: "https://auth.example.com/authorize",
            token_endpoint: "https://auth.example.com/token",
            registration_endpoint: "https://auth.example.com/register",
          }),
        ),
      );
      const injectedService = new AuthServiceImpl(asFetchFn(fetchFn));

      await expect(
        injectedService.discoverEndpoints("https://mcp.example.com"),
      ).resolves.toEqual({
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
        registrationEndpoint: "https://auth.example.com/register",
      });
    });

    it("rejects insecure discovered endpoints", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({
            authorization_endpoint: "https://auth.example.com/authorize",
            token_endpoint: "http://attacker.test/token",
            registration_endpoint: "https://auth.example.com/register",
          }),
        ),
      );
      const injectedService = new AuthServiceImpl(asFetchFn(fetchFn));

      await expect(
        injectedService.discoverEndpoints("https://mcp.example.com"),
      ).rejects.toThrow("OAuth token endpoint");
    });
  });

  describe("registerClient", () => {
    it("sends the complete dynamic registration request", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({ client_id: "client-id", client_secret: "secret" }),
        ),
      );
      const injectedService = new AuthServiceImpl(asFetchFn(fetchFn));

      await expect(
        injectedService.registerClient({
          registrationEndpoint: "https://auth.example.com/register",
          redirectUris: [
            "http://127.0.0.1:8080/callback",
            "http://127.0.0.1:8080/callback?utm_source=githits-cli",
          ],
        }),
      ).resolves.toEqual({ clientId: "client-id", clientSecret: "secret" });

      const [url, init] = fetchFn.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://auth.example.com/register");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init.body))).toEqual({
        client_name: "GitHits CLI",
        redirect_uris: [
          "http://127.0.0.1:8080/callback",
          "http://127.0.0.1:8080/callback?utm_source=githits-cli",
        ],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      });
    });

    it("surfaces safe JSON errors without raw HTML bodies", async () => {
      const jsonFetch = mock(() =>
        Promise.resolve(
          jsonResponse({ detail: "Registration unavailable" }, 503),
        ),
      );
      const htmlFetch = mock(() =>
        Promise.resolve(
          new Response("<!doctype html>registration secret", { status: 500 }),
        ),
      );

      await expect(
        new AuthServiceImpl(asFetchFn(jsonFetch)).registerClient({
          registrationEndpoint: "https://auth.example.com/register",
          redirectUris: ["http://127.0.0.1:8080/callback"],
        }),
      ).rejects.toThrow(
        "Client registration failed with HTTP 503. Registration unavailable",
      );
      try {
        await new AuthServiceImpl(asFetchFn(htmlFetch)).registerClient({
          registrationEndpoint: "https://auth.example.com/register",
          redirectUris: ["http://127.0.0.1:8080/callback"],
        });
        throw new Error("Expected registration to fail");
      } catch (error) {
        expect((error as Error).message).toBe(
          "Client registration failed with HTTP 500.",
        );
        expect((error as Error).message).not.toContain("registration secret");
      }
    });

    it("rejects malformed success data and insecure endpoints before fetch", async () => {
      const malformedFetch = mock(() =>
        Promise.resolve(
          jsonResponse({ client_id: 123, client_secret: "secret" }),
        ),
      );
      await expect(
        new AuthServiceImpl(asFetchFn(malformedFetch)).registerClient({
          registrationEndpoint: "https://auth.example.com/register",
          redirectUris: ["http://127.0.0.1:8080/callback"],
        }),
      ).rejects.toThrow("missing required fields");

      const unusedFetch = mock(() => Promise.resolve(jsonResponse({})));
      await expect(
        new AuthServiceImpl(asFetchFn(unusedFetch)).registerClient({
          registrationEndpoint: "http://attacker.test/register",
          redirectUris: ["http://127.0.0.1:8080/callback"],
        }),
      ).rejects.toThrow("OAuth registration endpoint");
      expect(unusedFetch).not.toHaveBeenCalled();
    });
  });

  describe("exchangeCodeForTokens", () => {
    const params = {
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "http://127.0.0.1:8080/callback",
    };

    it("sends the complete authorization-code exchange", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 900,
          }),
        ),
      );
      const injectedService = new AuthServiceImpl(asFetchFn(fetchFn));

      await expect(
        injectedService.exchangeCodeForTokens(params),
      ).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 900,
      });
      const [url, init] = fetchFn.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(params.tokenEndpoint);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(
        Object.fromEntries(new URLSearchParams(String(init.body))),
      ).toEqual({
        grant_type: "authorization_code",
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: params.redirectUri,
      });
    });

    it("uses the default expiry only when expires_in is absent", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({
            access_token: "access-token",
            refresh_token: "refresh-token",
          }),
        ),
      );

      await expect(
        new AuthServiceImpl(asFetchFn(fetchFn)).exchangeCodeForTokens(params),
      ).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      });
    });

    it("accepts a positive numeric-string expiry", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: "900",
          }),
        ),
      );

      await expect(
        new AuthServiceImpl(asFetchFn(fetchFn)).exchangeCodeForTokens(params),
      ).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 900,
      });
    });

    it("sanitizes HTTP errors and rejects malformed success data", async () => {
      const htmlFetch = mock(() =>
        Promise.resolve(
          new Response("<!doctype html>token secret", { status: 502 }),
        ),
      );
      try {
        await new AuthServiceImpl(asFetchFn(htmlFetch)).exchangeCodeForTokens(
          params,
        );
        throw new Error("Expected exchange to fail");
      } catch (error) {
        expect((error as Error).message).toBe(
          "Token exchange failed with HTTP 502.",
        );
        expect((error as Error).message).not.toContain("token secret");
      }

      for (const payload of [
        {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 0,
        },
        {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: "not-a-number",
        },
        { access_token: 123, refresh_token: "refresh-token" },
      ]) {
        const malformedFetch = mock(() =>
          Promise.resolve(jsonResponse(payload)),
        );
        await expect(
          new AuthServiceImpl(asFetchFn(malformedFetch)).exchangeCodeForTokens(
            params,
          ),
        ).rejects.toThrow("Token response missing required fields");
      }
    });

    it("rejects insecure token endpoints before fetch", async () => {
      const fetchFn = mock(() => Promise.resolve(jsonResponse({})));

      await expect(
        new AuthServiceImpl(asFetchFn(fetchFn)).exchangeCodeForTokens({
          ...params,
          tokenEndpoint: "http://attacker.test/token",
        }),
      ).rejects.toThrow("OAuth token endpoint");
      expect(fetchFn).not.toHaveBeenCalled();
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

    it("serves the callback before force closing its kept-alive connection", async () => {
      const { handle, port } = await startCallbackTestServer(
        service,
        "expected-state",
      );
      const socket = connect(port, "127.0.0.1");
      socket.setEncoding("utf8");
      await once(socket, "connect");

      let response = "";
      const responseReceived = new Promise<void>((resolve) => {
        socket.on("data", (chunk: string) => {
          response += chunk;
          if (response.includes("</html>")) resolve();
        });
      });
      const socketClosed = once(socket, "close");
      socket.write(
        [
          "GET /callback?code=test-code&state=expected-state HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Connection: keep-alive",
          "",
          "",
        ].join("\r\n"),
      );

      try {
        await responseReceived;
        expect(response).toContain("HTTP/1.1 200 OK");
        expect(response).toContain("signed in");
        expect(await handle.result).toEqual({
          type: "success",
          code: "test-code",
          state: "expected-state",
        });

        await handle.close();
        await socketClosed;
        expect(socket.destroyed).toBe(true);
      } finally {
        socket.destroy();
        await handle.close().catch(() => {});
      }
    });

    it("settles a valid callback when the response closes before finish", async () => {
      const { handle, port } = await startCallbackTestServer(
        service,
        "expected-state",
      );
      const socket = connect(port, "127.0.0.1");
      await once(socket, "connect");
      const socketClosed = once(socket, "close");

      // A client-side destroy races the kernel flush and may still emit finish.
      // Destroying in end deterministically exercises the close-only path.
      const endSpy = spyOn(ServerResponse.prototype, "end").mockImplementation(
        function (this: ServerResponse): ServerResponse {
          this.destroy();
          return this;
        },
      );
      try {
        socket.write(
          [
            "GET /callback?code=test-code&state=expected-state HTTP/1.1",
            `Host: 127.0.0.1:${port}`,
            "Connection: keep-alive",
            "",
            "",
          ].join("\r\n"),
        );

        await socketClosed;
        expect(await handle.result).toEqual({
          type: "success",
          code: "test-code",
          state: "expected-state",
        });
      } finally {
        endSpy.mockRestore();
        socket.destroy();
        await handle.close().catch(() => {});
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

    it("accepts a positive numeric-string expiry", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({
            access_token: "new-access-token",
            expires_in: "60",
          }),
        ),
      );

      await expect(
        new AuthServiceImpl(asFetchFn(fetchFn)).refreshAccessToken({
          tokenEndpoint: "https://auth.example.com/oauth/token",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "existing-refresh-token",
        }),
      ).resolves.toEqual({
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

    it("throws typed refresh errors for OAuth error responses", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "Invalid Refresh Token: Already Used",
            }),
            { status: 400 },
          ),
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        service.refreshAccessToken({
          tokenEndpoint: "https://auth.example.com/oauth/token",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        }),
      ).rejects.toThrow(TokenRefreshError);

      try {
        await service.refreshAccessToken({
          tokenEndpoint: "https://auth.example.com/oauth/token",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TokenRefreshError);
        expect(classifyTerminalRefreshError(error)).toBe(
          "invalid_refresh_token",
        );
      }
    });

    it("does not include raw HTML in refresh error messages", async () => {
      const fetchFn = mock(() =>
        Promise.resolve(
          new Response("<!doctype html>refresh secret", { status: 500 }),
        ),
      );

      try {
        await new AuthServiceImpl(asFetchFn(fetchFn)).refreshAccessToken({
          tokenEndpoint: "https://auth.example.com/oauth/token",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        });
        throw new Error("Expected refresh to fail");
      } catch (error) {
        expect((error as Error).message).toBe(
          "Token refresh failed with HTTP 500",
        );
        expect((error as Error).message).not.toContain("refresh secret");
      }
    });

    it("does not classify terminal-shaped 5xx refresh errors as terminal", () => {
      const error = new TokenRefreshError(
        503,
        JSON.stringify({
          error: "invalid_client",
          error_description: "OAuth client not found",
        }),
      );

      expect(classifyTerminalRefreshError(error)).toBeUndefined();
    });

    it("does not classify terminal-shaped 3xx refresh errors as terminal", () => {
      const error = new TokenRefreshError(
        302,
        JSON.stringify({
          error: "invalid_client",
          error_description: "OAuth client not found",
        }),
      );

      expect(classifyTerminalRefreshError(error)).toBeUndefined();
    });

    it("normalizes and bounds JSON refresh error details", async () => {
      const description = `Invalid Refresh Token: Already Used\nsecond line ${"x".repeat(600)}`;
      const body = JSON.stringify({
        error: "invalid_grant",
        error_description: description,
      });
      const fetchFn = mock(() =>
        Promise.resolve(new Response(body, { status: 400 })),
      );

      try {
        await new AuthServiceImpl(asFetchFn(fetchFn)).refreshAccessToken({
          tokenEndpoint: "https://auth.example.com/oauth/token",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        });
        throw new Error("Expected refresh to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(TokenRefreshError);
        expect((error as Error).message).not.toContain("\n");
        expect((error as Error).message).toContain(
          "Invalid Refresh Token: Already Used second line",
        );
        expect((error as Error).message.length).toBeLessThan(550);
        expect(classifyTerminalRefreshError(error)).toBe(
          "invalid_refresh_token",
        );
      }
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
