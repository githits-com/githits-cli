import { describe, expect, it, mock } from "bun:test";
import {
  AuthenticationError,
  GitHitsServiceImpl,
  TermsAcceptanceRequiredError,
} from "./githits-service.js";
import { RefreshingGitHitsService } from "./refreshing-githits-service.js";
import {
  createMockGitHitsService,
  createMockTokenProvider,
} from "./test-helpers.js";
import { createStaticTokenProvider } from "./token-provider.js";

describe("RefreshingGitHitsService", () => {
  const API_URL = "https://api.githits.com";

  describe("search", () => {
    it("preserves a backend provider 401 without refreshing or replaying", async () => {
      const provider = createMockTokenProvider();
      const fetchFn = mock(async () =>
        Response.json(
          {
            code: "REAUTH_REQUIRED",
            reauth_url: "https://dev.githits.com/auth/reauth",
          },
          { status: 401 },
        ),
      ) as unknown as typeof fetch;
      const service = new RefreshingGitHitsService(
        API_URL,
        provider,
        (url, token) => new GitHitsServiceImpl(url, token, fetchFn),
      );
      await expect(service.search({ query: "test" })).rejects.toMatchObject({
        code: "REAUTH_REQUIRED",
        reauthUrl: "https://dev.githits.com/auth/reauth",
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(provider.forceRefresh).not.toHaveBeenCalled();
    });
    it("delegates to inner service with token from provider", async () => {
      const innerService = createMockGitHitsService();
      const tokenProvider = createMockTokenProvider();
      const factory = mock((_url: string, _token: string) => innerService);

      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await service.search({ query: "test", language: "js" });

      expect(tokenProvider.getToken).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(API_URL, "mock-access-token");
      expect(innerService.search).toHaveBeenCalledWith({
        query: "test",
        language: "js",
      });
    });

    it("forwards the same request options to the initial call", async () => {
      const innerService = createMockGitHitsService();
      const tokenProvider = createMockTokenProvider();
      const factory = mock((_url: string, _token: string) => innerService);
      const options = { signal: new AbortController().signal };
      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await service.search({ query: "test" }, options);

      expect(innerService.search).toHaveBeenCalledWith(
        { query: "test" },
        options,
      );
    });

    it("retries with refreshed token on AuthenticationError", async () => {
      const failingService = createMockGitHitsService({
        search: mock(() =>
          Promise.reject(new AuthenticationError("Authentication required.")),
        ),
      });
      const successService = createMockGitHitsService({
        search: mock(() => Promise.resolve("result after refresh")),
      });

      let callCount = 0;
      const factory = mock((_url: string, _token: string) => {
        callCount++;
        return callCount === 1 ? failingService : successService;
      });

      const tokenProvider = createMockTokenProvider();
      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      const result = await service.search({ query: "test", language: "js" });

      expect(result).toBe("result after refresh");
      expect(tokenProvider.forceRefresh).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(factory).toHaveBeenCalledWith(API_URL, "mock-refreshed-token");
    });

    it("forwards the same request options to the refreshed call", async () => {
      const options = { signal: new AbortController().signal };
      const failingService = createMockGitHitsService({
        search: mock(() =>
          Promise.reject(new AuthenticationError("Authentication required.")),
        ),
      });
      const successService = createMockGitHitsService({
        search: mock(() => Promise.resolve("result after refresh")),
      });
      let callCount = 0;
      const factory = mock((_url: string, _token: string) => {
        callCount++;
        return callCount === 1 ? failingService : successService;
      });
      const service = new RefreshingGitHitsService(
        API_URL,
        createMockTokenProvider(),
        factory,
      );

      await service.search({ query: "test", sourceFormat: "mcp" }, options);

      expect(failingService.search).toHaveBeenCalledWith(
        { query: "test", sourceFormat: "mcp" },
        options,
      );
      expect(successService.search).toHaveBeenCalledWith(
        { query: "test", sourceFormat: "mcp" },
        options,
      );
    });

    it("does not refresh when the caller aborts after the initial failure", async () => {
      const controller = new AbortController();
      const reason = new Error("caller aborted");
      const failingService = createMockGitHitsService({
        search: mock(() => {
          controller.abort(reason);
          return Promise.reject(new AuthenticationError());
        }),
      });
      const forceRefresh = mock(() => Promise.resolve("unexpected-token"));
      const tokenProvider = createMockTokenProvider({ forceRefresh });
      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        mock(() => failingService),
      );

      await expect(
        service.search({ query: "test" }, { signal: controller.signal }),
      ).rejects.toBe(reason);
      expect(forceRefresh).not.toHaveBeenCalled();
    });

    it("does not retry when the caller aborts during token refresh", async () => {
      const controller = new AbortController();
      const reason = new Error("caller aborted during refresh");
      const failingService = createMockGitHitsService({
        search: mock(() => Promise.reject(new AuthenticationError())),
      });
      const forceRefresh = mock(async () => {
        controller.abort(reason);
        return "unexpected-token";
      });
      const tokenProvider = createMockTokenProvider({ forceRefresh });
      const factory = mock(() => failingService);
      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await expect(
        service.search({ query: "test" }, { signal: controller.signal }),
      ).rejects.toBe(reason);
      expect(forceRefresh).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("re-throws AuthenticationError when forceRefresh returns undefined", async () => {
      const failingService = createMockGitHitsService({
        search: mock(() =>
          Promise.reject(new AuthenticationError("Authentication required.")),
        ),
      });
      const factory = mock(() => failingService);
      const tokenProvider = createMockTokenProvider({
        forceRefresh: mock(() => Promise.resolve(undefined)),
      });

      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow(AuthenticationError);
    });

    it("refreshes and retries once when terms are accepted but the JWT claim is stale", async () => {
      const gatedService = createMockGitHitsService({
        search: mock(() => Promise.reject(new TermsAcceptanceRequiredError())),
      });
      const successService = createMockGitHitsService({
        search: mock(() => Promise.resolve("result after terms refresh")),
      });
      let callCount = 0;
      const factory = mock(() =>
        callCount++ === 0 ? gatedService : successService,
      );
      const tokenProvider = createMockTokenProvider();
      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      expect(await service.search({ query: "test" })).toBe(
        "result after terms refresh",
      );
      expect(tokenProvider.forceRefresh).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it("does not retry terms gating when a static token cannot refresh", async () => {
      const failure = new TermsAcceptanceRequiredError();
      const gatedService = createMockGitHitsService({
        search: mock(() => Promise.reject(failure)),
      });
      const factory = mock(() => gatedService);
      const tokenProvider = createStaticTokenProvider("ghi-static-token");
      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await expect(service.search({ query: "test" })).rejects.toBe(failure);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("no token available", () => {
    it("does not look up a token when the caller is already aborted", async () => {
      const controller = new AbortController();
      const reason = new Error("already cancelled");
      controller.abort(reason);
      const getToken = mock(() => Promise.resolve("unexpected-token"));
      const tokenProvider = createMockTokenProvider({ getToken });
      const service = new RefreshingGitHitsService(API_URL, tokenProvider);

      await expect(
        service.search({ query: "test" }, { signal: controller.signal }),
      ).rejects.toBe(reason);
      expect(getToken).not.toHaveBeenCalled();
    });

    it("throws AuthenticationError when getToken returns undefined", async () => {
      const tokenProvider = createMockTokenProvider({
        getToken: mock(() => Promise.resolve(undefined)),
      });
      const factory = mock(() => createMockGitHitsService());

      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow(AuthenticationError);
      // Factory should not be called when there's no token
      expect(factory).not.toHaveBeenCalled();
    });
  });

  describe("non-auth errors", () => {
    it("does not retry on non-AuthenticationError", async () => {
      const innerService = createMockGitHitsService({
        search: mock(() => Promise.reject(new Error("Server error (500)"))),
      });
      const tokenProvider = createMockTokenProvider();
      const factory = mock(() => innerService);

      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow("Server error (500)");
      expect(tokenProvider.forceRefresh).not.toHaveBeenCalled();
    });
  });
});
