import { describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "./githits-service.js";
import { RefreshingGitHitsService } from "./refreshing-githits-service.js";
import {
  createMockGitHitsService,
  createMockTokenProvider,
} from "./test-helpers.js";

describe("RefreshingGitHitsService", () => {
  const API_URL = "https://api.githits.com";

  describe("search", () => {
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
  });

  describe("getLanguages", () => {
    it("delegates to inner service", async () => {
      const innerService = createMockGitHitsService();
      const tokenProvider = createMockTokenProvider();
      const factory = mock(() => innerService);

      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      const result = await service.getLanguages();

      expect(result).toHaveLength(3);
      expect(innerService.getLanguages).toHaveBeenCalledTimes(1);
    });
  });

  describe("submitFeedback", () => {
    it("delegates to inner service", async () => {
      const innerService = createMockGitHitsService();
      const tokenProvider = createMockTokenProvider();
      const factory = mock(() => innerService);

      const service = new RefreshingGitHitsService(
        API_URL,
        tokenProvider,
        factory,
      );

      const result = await service.submitFeedback({
        solutionId: "id",
        accepted: true,
      });

      expect(result.success).toBe(true);
      expect(innerService.submitFeedback).toHaveBeenCalledTimes(1);
    });
  });

  describe("no token available", () => {
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
