import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  FetchTimeoutError,
} from "../shared/fetch-timeout.js";
import { createClientHeaderBuilder } from "../shared/request-headers.js";
import {
  ApiRateLimitError,
  AuthenticationError,
  GitHitsServiceImpl,
} from "./githits-service.js";

// Helper to mock global fetch with proper typing
function mockFetch(impl: () => Promise<Response>) {
  const fn = mock(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

async function captureRateLimitError(
  operation: () => Promise<unknown>,
): Promise<ApiRateLimitError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof ApiRateLimitError) return error;
    throw error;
  }
  throw new Error("Expected ApiRateLimitError");
}

async function captureFetchTimeoutError(
  operation: () => Promise<unknown>,
): Promise<FetchTimeoutError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof FetchTimeoutError) return error;
    throw error;
  }
  throw new Error("Expected FetchTimeoutError");
}

describe("GitHitsServiceImpl", () => {
  const API_URL = "https://api.githits.com";
  const TOKEN = "test-token";
  let service: GitHitsServiceImpl;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    service = new GitHitsServiceImpl(API_URL, TOKEN, undefined, undefined, {
      clientHeaders: createClientHeaderBuilder({
        clientName: "githits-cli",
        clientVersion: "1.2.3",
        env: {},
        ppid: 42,
      }),
      userAgent: "githits-cli/1.2.3",
    });
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
      expect(headers["x-githits-client-version"]).toBe("1.2.3");
      expect(headers["x-githits-session-id"]).toMatch(/^[0-9a-f]{16}$/);
      expect(headers["User-Agent"]).toBe("githits-cli/1.2.3");
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

    it("classifies stalled requests as timeouts", async () => {
      const fetchFn = mock(() => new Promise<Response>(() => {}));
      const timeoutService = new GitHitsServiceImpl(
        API_URL,
        TOKEN,
        asFetchFn(fetchFn),
        1,
      );

      const error = await captureFetchTimeoutError(() =>
        timeoutService.search({ query: "probe" }),
      );

      expect(error.timeoutMs).toBe(1);
      expect(error.message).toBe("Request to GitHits timed out. Try again.");
    });

    it("uses the extended default request timeout", async () => {
      const timeoutSpy = spyOn(AbortSignal, "timeout");
      mockFetch(() => Promise.resolve(new Response("result")));

      try {
        await service.search({ query: "probe" });

        expect(timeoutSpy).toHaveBeenCalledWith(240_000);
      } finally {
        timeoutSpy.mockRestore();
      }
    });

    it("supports a runtime-specific example request timeout", async () => {
      const timeoutSpy = spyOn(AbortSignal, "timeout");
      mockFetch(() => Promise.resolve(new Response("result")));
      const hostedService = new GitHitsServiceImpl(
        API_URL,
        TOKEN,
        undefined,
        undefined,
        { exampleRequestTimeoutMs: 225_000 },
      );

      try {
        await hostedService.search({ query: "probe" });

        expect(timeoutSpy).toHaveBeenCalledWith(225_000);
      } finally {
        timeoutSpy.mockRestore();
      }
    });

    it("classifies injected AbortError failures as timeouts", async () => {
      const cause = new DOMException("aborted", "AbortError");
      const abortService = new GitHitsServiceImpl(
        API_URL,
        TOKEN,
        asFetchFn(mock(() => Promise.reject(cause))),
      );

      try {
        await abortService.search({ query: "probe" });
        throw new Error("Expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          "Request to GitHits timed out. Try again.",
        );
        expect((error as Error & { cause?: unknown }).cause).toBe(cause);
      }
    });

    it("classifies fetch TypeError failures as connection errors", async () => {
      const cause = new TypeError("fetch failed");
      const offlineService = new GitHitsServiceImpl(
        API_URL,
        TOKEN,
        asFetchFn(mock(() => Promise.reject(cause))),
      );

      try {
        await offlineService.search({ query: "probe" });
        throw new Error("Expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Could not connect to GitHits",
        );
        expect((error as Error).message).toContain("GITHITS_API_URL");
        expect((error as Error & { cause?: unknown }).cause).toBe(cause);
      }
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
      ).rejects.toThrow("GitHits could not accept the authentication token.");
    });

    it("uses a stable public message and preserves delay-seconds on 429", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Internal response detail." }),
            {
              status: 429,
              headers: { "Retry-After": "30" },
            },
          ),
        ),
      );

      const error = await captureRateLimitError(() =>
        service.search({ query: "test" }),
      );

      expect(error.name).toBe("ApiRateLimitError");
      expect(error.message).toBe("Request rate limited.");
      expect(error.message).not.toContain("Internal response detail");
      expect(error.status).toBe(429);
      expect(error.retryAfterSeconds).toBe(30);
    });

    it("parses a future HTTP-date Retry-After and rounds up", async () => {
      const nowMs = Date.UTC(2030, 0, 1, 0, 0, 0, 250);
      const dateNow = spyOn(Date, "now").mockReturnValue(nowMs);
      mockFetch(() =>
        Promise.resolve(
          new Response("Internal response detail.", {
            status: 429,
            headers: {
              "Retry-After": new Date(
                Date.UTC(2030, 0, 1, 0, 0, 5),
              ).toUTCString(),
            },
          }),
        ),
      );

      try {
        const error = await captureRateLimitError(() =>
          service.search({ query: "test" }),
        );

        expect(error.message).toBe("Request rate limited.");
        expect(error.retryAfterSeconds).toBe(5);
      } finally {
        dateNow.mockRestore();
      }
    });

    it("uses a generic message when a 429 has no API detail", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 429 })));

      const error = await captureRateLimitError(() =>
        service.search({ query: "test" }),
      );

      expect(error.message).toBe("Request rate limited.");
      expect(error.retryAfterSeconds).toBeUndefined();
    });

    it.each([
      ["empty", ""],
      ["negative", "-1"],
      ["fractional", "1.5"],
      ["invalid", "not-a-date"],
      ["non-HTTP date", "2030-01-02"],
      ["past HTTP-date", "Tue, 01 Jan 2019 00:00:00 GMT"],
      ["unsafe integer", "999999999999999999999999"],
    ])("ignores Retry-After value: %s", async (_description, retryAfter) => {
      const dateNow = spyOn(Date, "now").mockReturnValue(Date.UTC(2030, 0, 1));
      mockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Internal response detail." }),
            {
              status: 429,
              headers: { "Retry-After": retryAfter },
            },
          ),
        ),
      );

      try {
        const error = await captureRateLimitError(() =>
          service.search({ query: "test" }),
        );

        expect(error.retryAfterSeconds).toBeUndefined();
      } finally {
        dateNow.mockRestore();
      }
    });

    it("throws on 500 with status code", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 500 })));

      await expect(
        service.search({ query: "test", language: "js" }),
      ).rejects.toThrow("Server error (500)");
    });

    it("does not include an HTML or plain-text body in 500 errors", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response("<!doctype html>database connection failed", {
            status: 502,
          }),
        ),
      );

      try {
        await service.search({ query: "test", language: "js" });
        throw new Error("Expected request to fail");
      } catch (error) {
        expect((error as Error).message).toBe(
          "Server error (502). Try again shortly.",
        );
        expect((error as Error).message).not.toContain("doctype");
        expect((error as Error).message).not.toContain("database");
      }
    });

    it("includes safe JSON detail in 500 errors", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "Backend unavailable" }), {
            status: 503,
          }),
        ),
      );

      await expect(service.search({ query: "test" })).rejects.toThrow(
        "Server error (503). Try again shortly. Backend unavailable",
      );
    });

    it("does not expose raw rate-limit response bodies", async () => {
      mockFetch(() =>
        Promise.resolve(new Response("slow down", { status: 429 })),
      );

      const error = await captureRateLimitError(() =>
        service.search({ query: "test" }),
      );

      expect(error.message).toBe("Request rate limited.");
      expect(error.message).not.toContain("slow down");
    });
  });

  describe("getLanguages", () => {
    it("keeps the standard request timeout", async () => {
      const timeoutSpy = spyOn(AbortSignal, "timeout");
      mockFetch(() =>
        Promise.resolve(
          new Response("[]", {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      try {
        await service.getLanguages();

        expect(timeoutSpy).toHaveBeenCalledWith(DEFAULT_FETCH_TIMEOUT_MS);
      } finally {
        timeoutSpy.mockRestore();
      }
    });

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
        "Server error (503). Try again shortly.",
      );
    });

    it("rejects malformed language payloads", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 1, name: "javascript" }]), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(service.getLanguages()).rejects.toThrow(
        "GitHits returned an invalid languages response.",
      );
    });
  });

  describe("searchLanguages", () => {
    it("calls backend-ranked language search with query and limit", async () => {
      const languages = [
        {
          id: "2",
          name: "typescript",
          display_name: "TypeScript",
          aliases: ["ts"],
          search_priority: 10,
        },
      ];
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify(languages), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const result = await service.searchLanguages("c#", 10);

      expect(result).toEqual(languages);
      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe(`${API_URL}/languages?query=c%23&limit=10`);
    });

    it("throws AuthenticationError on 401", async () => {
      mockFetch(() => Promise.resolve(new Response("", { status: 401 })));

      await expect(service.searchLanguages("ts")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("rejects malformed language search payloads", async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ languages: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(service.searchLanguages("ts")).rejects.toThrow(
        "GitHits returned an invalid languages response.",
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

    it("sends optional example and tool targets when provided", async () => {
      const fn = mockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await service.submitFeedback({
        exampleId: "example-123",
        accepted: false,
        feedbackText: "Wrong result",
        toolName: "get_example",
      });

      const call = fn.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string);
      expect(body.example_id).toBe("example-123");
      expect(body.accepted).toBe(false);
      expect(body.feedback_text).toBe("Wrong result");
      expect(body.tool_name).toBe("get_example");
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
      ).rejects.toThrow("Server error (500). Try again shortly.");
    });

    it("omits solution_id when not provided (generic feedback)", async () => {
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
      expect("solution_id" in body).toBe(false);
      expect("example_id" in body).toBe(false);
      expect(body.accepted).toBe(true);
      expect(body.feedback_text).toBe("code_grep regex is great");

      const headers = call[1].headers as Record<string, string>;
      expect(headers["x-githits-session-id"]).toMatch(/^[0-9a-f]{16}$/);
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
