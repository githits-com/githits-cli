import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { AuthenticationError, GitHitsServiceImpl } from "./githits-service.js";

// Helper to mock global fetch with proper typing
function mockFetch(impl: () => Promise<Response>) {
  const fn = mock(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("GitHitsServiceImpl", () => {
  const API_URL = "https://api.githits.com";
  const TOKEN = "test-token";
  let service: GitHitsServiceImpl;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    service = new GitHitsServiceImpl(API_URL, TOKEN);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("search", () => {
    it("sends correct request and returns markdown", async () => {
      const fn = mockFetch(() =>
        Promise.resolve(new Response("# Result\nCode example here")),
      );

      const result = await service.search({
        query: "hello world",
        language: "javascript",
      });

      expect(result).toBe("# Result\nCode example here");
      expect(fn).toHaveBeenCalledTimes(1);

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe(`${API_URL}/search`);
      expect(call[1].method).toBe("POST");

      const body = JSON.parse(call[1].body as string);
      expect(body.query).toBe("hello world");
      expect(body.language).toBe("javascript");
      expect(body.license_mode).toBe("strict");
      expect(body.include_explanation).toBe(false);

      const headers = call[1].headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
    });

    it("sends x-githits-* telemetry headers on REST requests", async () => {
      // Pins the contract that `GitHitsServiceImpl.headers()` spreads
      // the telemetry headers onto every REST call, not just that the
      // shared builder emits them.
      const fn = mockFetch(() => Promise.resolve(new Response("result")));
      await service.search({ query: "probe", language: "javascript" });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const headers = call[1].headers as Record<string, string>;
      expect(headers["x-githits-client-name"]).toBe("githits-cli");
      expect(headers["x-githits-client-version"]).toMatch(/^\S+$/);
      expect(headers["x-githits-session-id"]).toMatch(/^[0-9a-f]{16}$/);
    });

    it("passes custom license_mode", async () => {
      const fn = mockFetch(() => Promise.resolve(new Response("result")));

      await service.search({
        query: "test",
        language: "python",
        licenseMode: "yolo",
      });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.license_mode).toBe("yolo");
    });

    it("omits language from JSON when not provided", async () => {
      const fn = mockFetch(() => Promise.resolve(new Response("result")));

      await service.search({ query: "test" });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body).not.toHaveProperty("language");
    });

    it("passes include_explanation when set", async () => {
      const fn = mockFetch(() => Promise.resolve(new Response("result")));

      await service.search({
        query: "test",
        language: "python",
        includeExplanation: true,
      });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.include_explanation).toBe(true);
    });

    it("throws AuthenticationError on 401", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 401 })));

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow(AuthenticationError);
      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow("Authentication required");
    });

    it("throws on 500 with status code", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 500 })));

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow("Server error (500)");
    });

    it("includes response body in 500 error", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response("Internal: database connection failed", { status: 502 }),
        ),
      );

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow(
        "Server error (502): Internal: database connection failed",
      );
    });
  });

  describe("getLanguages", () => {
    it("returns array of languages", async () => {
      const languages = [
        {
          id: "1",
          name: "javascript",
          display_name: "JavaScript",
          aliases: ["js"],
        },
      ];
      mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify(languages), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const result = await service.getLanguages();
      expect(result).toEqual(languages);
    });

    it("throws AuthenticationError on 401", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 401 })));

      await expect(service.getLanguages()).rejects.toThrow(AuthenticationError);
    });

    it("throws on 500 with status code", async () => {
      mockFetch(() =>
        Promise.resolve(new Response("service unavailable", { status: 503 })),
      );

      await expect(service.getLanguages()).rejects.toThrow(
        "Server error (503): service unavailable",
      );
    });
  });

  describe("submitFeedback", () => {
    it("sends correct request with field mapping", async () => {
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await service.submitFeedback({
        solutionId: "uuid-123",
        accepted: true,
        feedbackText: "Helpful",
      });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      // Verify field mapping: solutionId -> solution_id
      expect(body.solution_id).toBe("uuid-123");
      expect(body.accepted).toBe(true);
      expect(body.feedback_text).toBe("Helpful");
    });

    it("throws AuthenticationError on 401", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 401 })));

      await expect(
        service.submitFeedback({ solutionId: "id", accepted: true }),
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws on 404 with detail from JSON body", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Example abc-123 not found" }),
            { status: 404 },
          ),
        ),
      );

      await expect(
        service.submitFeedback({ solutionId: "abc-123", accepted: true }),
      ).rejects.toThrow("Example abc-123 not found");
    });

    it("throws generic message on 404 with empty body", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 404 })));

      await expect(
        service.submitFeedback({ solutionId: "abc-123", accepted: true }),
      ).rejects.toThrow("Resource not found.");
    });

    it("throws on 500 with status code", async () => {
      mockFetch(() =>
        Promise.resolve(new Response("internal error", { status: 500 })),
      );

      await expect(
        service.submitFeedback({ solutionId: "id", accepted: true }),
      ).rejects.toThrow("Server error (500): internal error");
    });

    it("sends null solution_id when not provided (generic feedback)", async () => {
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await service.submitFeedback({
        accepted: true,
        feedbackText: "code_grep regex is great",
      });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.solution_id).toBeNull();
      expect(body.accepted).toBe(true);
      expect(body.feedback_text).toBe("code_grep regex is great");
    });

    it("sends null feedback_text when not provided", async () => {
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await service.submitFeedback({
        solutionId: "uuid-123",
        accepted: false,
      });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.feedback_text).toBeNull();
    });
  });
});
