import { describe, expect, it, mock } from "bun:test";
import {
  AGENTIC_ASK_MAX_RESPONSE_BYTES,
  type AgenticAskCliResponse,
  AgenticAskHttpError,
  AgenticAskRequestTimeoutError,
  AgenticAskResponseTooLargeError,
  AgenticAskServiceImpl,
  MalformedAgenticAskResponseError,
  parseAgenticAskToolCallId,
} from "./agentic-ask-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    source_format: "cli",
    tool_call_id: TOOL_CALL_ID,
    answer_markdown: "Use the documented API.",
    sources: [
      {
        command: "npx",
        arguments: [
          "githits@latest",
          "code",
          "read",
          "--lines",
          "10-20",
          "--",
          "npm:example",
          "src/index.ts",
        ],
      },
      {
        command: "npx",
        arguments: [
          "githits@latest",
          "docs",
          "read",
          "--lines",
          "3-8",
          "--",
          "docs:example:guide",
        ],
      },
    ],
    ...overrides,
  };
}

function jsonResponse(
  body: unknown = responseBody(),
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function createService(
  fetchFn: typeof fetch,
  options: {
    tokenProvider?: ReturnType<typeof createMockTokenProvider>;
    timeoutMs?: number;
  } = {},
): AgenticAskServiceImpl {
  return new AgenticAskServiceImpl(
    "https://api.githits.test/",
    options.tokenProvider ?? createMockTokenProvider(),
    fetchFn,
    {
      clientHeaders: () => ({
        "x-githits-client-name": "githits-cli",
        "x-githits-client-version": "1.2.3",
        "x-githits-session-id": "session-id",
      }),
      userAgent: "githits-cli/1.2.3",
      timeoutMs: options.timeoutMs,
    },
  );
}

describe("AgenticAskServiceImpl", () => {
  it("sends the CLI source format with standard identity headers", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Promise.resolve(jsonResponse());
    }) as unknown as typeof fetch;

    const result = await createService(fetchFn).ask({
      target: "npm:example",
      question: "How is the client created?",
    });

    expect(result).toEqual(responseBody() as AgenticAskCliResponse);
    expect(capturedUrl).toBe("https://api.githits.test/ask");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.headers).toEqual({
      Authorization: "Bearer mock-access-token",
      "Content-Type": "application/json",
      "User-Agent": "githits-cli/1.2.3",
      "x-githits-client-name": "githits-cli",
      "x-githits-client-version": "1.2.3",
      "x-githits-session-id": "session-id",
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      target: "npm:example",
      question: "How is the client created?",
      source_format: "cli",
    });
  });

  it("accepts both OAuth JWT and opaque API-token credentials", async () => {
    for (const token of ["header.payload.signature", "ghi-static-token"]) {
      let authorization: string | undefined;
      const tokenProvider = createMockTokenProvider({
        getToken: mock(() => Promise.resolve(token)),
      });
      const fetchFn = mock(
        (_url: string | URL | Request, init?: RequestInit) => {
          const headers = init?.headers as Record<string, string> | undefined;
          authorization = headers?.Authorization;
          return Promise.resolve(jsonResponse());
        },
      ) as unknown as typeof fetch;

      await createService(fetchFn, { tokenProvider }).ask({
        target: "npm:example",
        question: "How is it used?",
      });

      expect(authorization).toBe(`Bearer ${token}`);
    }
  });

  it("refreshes an OAuth token once after a 401", async () => {
    const forceRefresh = mock(() => Promise.resolve("fresh-token"));
    const tokenProvider = createMockTokenProvider({
      getToken: mock(() => Promise.resolve("stale.jwt.token")),
      forceRefresh,
    });
    const seenTokens: string[] = [];
    const fetchFn = mock((_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seenTokens.push(headers?.Authorization ?? "");
      return Promise.resolve(
        seenTokens.length === 1
          ? new Response("", { status: 401 })
          : jsonResponse(),
      );
    }) as unknown as typeof fetch;

    await createService(fetchFn, { tokenProvider }).ask({
      target: "npm:example",
      question: "How is it used?",
    });

    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(seenTokens).toEqual([
      "Bearer stale.jwt.token",
      "Bearer fresh-token",
    ]);
  });

  it("does not attempt local refresh for an opaque API token", async () => {
    const forceRefresh = mock(() => Promise.resolve("unexpected"));
    const fetchFn = mock(() =>
      Promise.resolve(new Response("", { status: 401 })),
    ) as unknown as typeof fetch;
    const service = createService(fetchFn, {
      tokenProvider: createMockTokenProvider({
        getToken: mock(() => Promise.resolve("ghi-static-token")),
        forceRefresh,
      }),
    });

    await expect(
      service.ask({ target: "npm:example", question: "How?" }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(forceRefresh).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects non-CLI, non-v7, malformed, and usage-bearing responses", async () => {
    const invalidBodies = [
      responseBody({ source_format: "mcp" }),
      responseBody({ tool_call_id: "018f47a6-7b32-4a1e-8f45-6a2d39c81720" }),
      responseBody({ usage: { input_tokens: 1 } }),
      responseBody({ answer_markdown: "" }),
      { answer_markdown: "missing fields" },
    ];

    for (const body of invalidBodies) {
      const service = createService(
        mock(() =>
          Promise.resolve(jsonResponse(body)),
        ) as unknown as typeof fetch,
      );
      await expect(
        service.ask({ target: "npm:example", question: "How?" }),
      ).rejects.toBeInstanceOf(MalformedAgenticAskResponseError);
    }
  });

  it("rejects malformed JSON without exposing response content", async () => {
    const service = createService(
      mock(() =>
        Promise.resolve(new Response("{secret")),
      ) as unknown as typeof fetch,
    );

    await expect(
      service.ask({ target: "npm:example", question: "How?" }),
    ).rejects.toMatchObject({
      name: "MalformedAgenticAskResponseError",
      message: "GitHits returned an invalid Agentic Ask response.",
    });
  });

  it.each([
    [400, "INVALID_TARGET", false],
    [401, "AUTH_REQUIRED", false],
    [403, "ACCESS_DENIED", false],
    [422, "INVALID_REQUEST", false],
    [429, "RATE_LIMITED", true],
    [500, "EXECUTION_FAILED", false],
    [503, "SERVICE_UNAVAILABLE", true],
    [504, "TIMEOUT", true],
    [418, "HTTP_ERROR", false],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const fetchFn = mock(() =>
      Promise.resolve(
        new Response("private backend detail", {
          status,
          headers: {
            "X-GitHits-Tool-Call-Id": TOOL_CALL_ID,
            ...(status === 429 ? { "Retry-After": "17" } : {}),
          },
        }),
      ),
    ) as unknown as typeof fetch;

    try {
      await createService(fetchFn, {
        tokenProvider: createMockTokenProvider({
          getToken: mock(() => Promise.resolve("ghi-static-token")),
        }),
      }).ask({ target: "npm:example", question: "How?" });
      throw new Error("expected request failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AgenticAskHttpError);
      expect(error).toMatchObject({
        code,
        status,
        retryable,
        toolCallId: TOOL_CALL_ID,
        ...(status === 429 ? { retryAfterSeconds: 17 } : {}),
      });
      expect((error as Error).message).not.toContain("private backend");
    }
  });

  it("times out the entire request and aborts the transport", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchFn = mock((_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;

    await expect(
      createService(fetchFn, { timeoutMs: 5 }).ask({
        target: "npm:example",
        question: "How?",
      }),
    ).rejects.toBeInstanceOf(AgenticAskRequestTimeoutError);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse()),
    ) as unknown as typeof fetch;

    await expect(
      createService(fetchFn).ask(
        { target: "npm:example", question: "How?" },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before reading it", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      headers: {
        "Content-Length": String(AGENTIC_ASK_MAX_RESPONSE_BYTES + 1),
      },
    });

    await expect(
      createService(
        mock(() => Promise.resolve(response)) as unknown as typeof fetch,
      ).ask({ target: "npm:example", question: "How?" }),
    ).rejects.toBeInstanceOf(AgenticAskResponseTooLargeError);
    // Bun may invoke one stream pull while constructing the Response, but the
    // service cancels from the header without acquiring a reader.
    expect(pulls).toBeLessThanOrEqual(1);
    expect(cancelled).toBe(true);
  });

  it.each([undefined, "1", "not-a-number"])(
    "enforces the streamed body ceiling with Content-Length %s",
    async (contentLength) => {
      let cancelled = false;
      const chunk = new Uint8Array(AGENTIC_ASK_MAX_RESPONSE_BYTES / 2 + 1);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
          sent += 1;
          if (sent === 3) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const headers = new Headers();
      if (contentLength !== undefined) {
        headers.set("Content-Length", contentLength);
      }

      await expect(
        createService(
          mock(() =>
            Promise.resolve(new Response(body, { headers })),
          ) as unknown as typeof fetch,
        ).ask({ target: "npm:example", question: "How?" }),
      ).rejects.toBeInstanceOf(AgenticAskResponseTooLargeError);
      expect(cancelled).toBe(true);
    },
  );
});

describe("parseAgenticAskToolCallId", () => {
  it("accepts one UUIDv7 and normalizes case", () => {
    expect(parseAgenticAskToolCallId(TOOL_CALL_ID.toUpperCase())).toBe(
      TOOL_CALL_ID,
    );
  });

  it.each([
    null,
    "",
    "not-a-uuid",
    "018f47a6-7b32-4a1e-8f45-6a2d39c81720",
    `${TOOL_CALL_ID}, ${TOOL_CALL_ID}`,
    `${TOOL_CALL_ID}\nspoofed`,
    ` ${TOOL_CALL_ID}`,
  ])("rejects unsafe or ambiguous value %s", (value) => {
    expect(parseAgenticAskToolCallId(value)).toBeUndefined();
  });
});
