import { describe, expect, it, mock } from "bun:test";
import { TermsAcceptanceRequiredError } from "../shared/terms-acceptance.js";
import {
  AGENTIC_ASK_MAX_RESPONSE_BYTES,
  type AgenticAskCliResponse,
  AgenticAskConnectionError,
  AgenticAskHttpError,
  type AgenticAskMcpResponse,
  AgenticAskRequestTimeoutError,
  AgenticAskResponseTooLargeError,
  AgenticAskServiceImpl,
  type AgenticAskUrlResponse,
  MalformedAgenticAskResponseError,
  normalizeAgenticAskThreadId,
  parseAgenticAskToolCallId,
} from "./agentic-ask-service.js";
import { ASK_NEEDS_TARGET_WIRE } from "./ask-needs-target.fixture.js";
import { createMockTokenProvider } from "./test-helpers.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";
const THREAD_ID = "018f47a6-7b32-7b1e-8f45-6a2d39c81720";

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    source_format: "cli",
    tool_call_id: TOOL_CALL_ID,
    thread_id: THREAD_ID,
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

function mcpResponseBody(overrides: Record<string, unknown> = {}) {
  return {
    source_format: "mcp",
    tool_call_id: TOOL_CALL_ID,
    thread_id: THREAD_ID,
    answer_markdown: "Use the documented API.",
    sources: [
      {
        name: "code_read",
        arguments: {
          target: "npm:example",
          path: "src/index.ts",
          start_line: 10,
          end_line: 20,
        },
      },
      {
        name: "docs_read",
        arguments: {
          page_id: "docs:example:guide",
          start_line: 3,
          end_line: 8,
        },
      },
    ],
    ...overrides,
  };
}

function urlResponseBody(overrides: Record<string, unknown> = {}) {
  return {
    source_format: "url",
    tool_call_id: TOOL_CALL_ID,
    thread_id: THREAD_ID,
    answer_markdown: "Use the documented API.",
    sources: [
      {
        url: "https://github.com/example/project/blob/main/src/index.ts#L10-L20",
      },
      { url: "https://example.com/docs/guide#L3-L8" },
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

function clarificationFetch(body: unknown): typeof fetch {
  return Object.assign(async () => Response.json(body), {
    preconnect: () => undefined,
  });
}

describe("AgenticAskServiceImpl", () => {
  it("accepts a backend target clarification without answer identifiers", async () => {
    const service = createService(clarificationFetch(ASK_NEEDS_TARGET_WIRE));
    const result = await service.ask({
      question: "How does codex handle chat compaction?",
    });
    expect("outcome" in result && result.outcome).toBe("needs_target");
    if (!("outcome" in result)) throw new Error("Expected clarification");
    expect(
      result.resolution.targets.map((target) => target.canonicalKey),
    ).toEqual(["github:openai/codex", "npm:@openai/codex", "npm:codex"]);
    expect(result.resolution.targets[0]?.match?.confidence).toBe("MEDIUM");
    expect(result.resolution.targets[0]?.groupKey).toBe("github:openai/codex");
    expect(result.resolution.protectedMatches[0]?.canonicalKey).toBe(
      "npm:codex",
    );
    expect(result.resolution.targetsTruncated).toBe(true);
    expect(result).not.toHaveProperty("thread_id");
    expect(result).not.toHaveProperty("answer_markdown");
  });

  it("accepts empty candidates without inventing a best target", async () => {
    const service = createService(
      clarificationFetch({
        ...ASK_NEEDS_TARGET_WIRE,
        resolution: {
          ...ASK_NEEDS_TARGET_WIRE.resolution,
          best: null,
          targets: [],
        },
      }),
    );
    const result = await service.ask({
      question: "How does UnknownProject work?",
    });
    if (!("outcome" in result)) throw new Error("Expected clarification");
    expect(result.resolution.best).toBeUndefined();
    expect(result.resolution.targets).toEqual([]);
  });

  it.each([{ target: "github:openai/codex" }, { threadId: THREAD_ID }])(
    "rejects clarification for an already bound request: %j",
    async (subject) => {
      const service = createService(clarificationFetch(ASK_NEEDS_TARGET_WIRE));
      await expect(
        service.ask({ ...subject, question: "How?" }),
      ).rejects.toBeInstanceOf(MalformedAgenticAskResponseError);
    },
  );

  it("rejects malformed resolver candidates in a clarification", async () => {
    const service = createService(
      clarificationFetch({
        ...ASK_NEEDS_TARGET_WIRE,
        resolution: {
          ...ASK_NEEDS_TARGET_WIRE.resolution,
          targets: [{ canonicalKey: "github:openai/codex" }],
        },
      }),
    );
    await expect(service.ask({ question: "How?" })).rejects.toBeInstanceOf(
      MalformedAgenticAskResponseError,
    );
  });

  it.each([
    "https://docs.example/page?lang=en&view=full#section",
    "repo-doc:sha:pinned",
    "docs:example:guide",
  ])("preserves emitted CLI documentation read targets: %s", async (target) => {
    const body: AgenticAskCliResponse = {
      ...responseBody(),
      source_format: "cli",
      sources: [
        {
          command: "npx",
          arguments: [
            "githits@latest",
            "docs",
            "read",
            "--lines",
            "3-8",
            "--",
            target,
          ],
        },
      ],
    };
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse(body)),
    ) as unknown as typeof fetch;

    const result = await createService(fetchFn).ask({
      question: "How does Express routing work?",
    });

    expect(result).toEqual(body);
  });

  it.each([
    "https://docs.example/page?lang=en&view=full#section",
    "repo-doc:sha:pinned",
    "docs:example:guide",
  ])("preserves emitted MCP documentation read targets: %s", async (target) => {
    const body: AgenticAskMcpResponse = {
      ...mcpResponseBody(),
      source_format: "mcp",
      sources: [
        {
          name: "docs_read",
          arguments: { page_id: target, start_line: 3, end_line: 8 },
        },
      ],
    };
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse(body)),
    ) as unknown as typeof fetch;

    const result = await createService(fetchFn).ask({
      target: "npm:express",
      question: "How does routing work?",
      sourceFormat: "mcp",
    });

    expect(result).toEqual(body);
  });

  it.each([
    {
      subject: {},
      message:
        "GitHits could not answer this question for a supported target. Clarify the question or specify a public package or repository.",
    },
    {
      subject: { target: "npm:example" },
      message:
        "GitHits could not validate this Ask request or its target. Check the question and use a repository such as github:owner/repo#ref or a package such as npm:prisma@version. To correct a thread's target, start a new request without thread_id.",
    },
    {
      subject: { threadId: THREAD_ID },
      message:
        "GitHits could not validate this Ask request or its target. Check the question and use a repository such as github:owner/repo#ref or a package such as npm:prisma@version. To correct a thread's target, start a new request without thread_id.",
    },
  ])(
    "keeps 400 guidance accurate for the supplied subject: %j",
    async ({ subject, message }) => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse({ detail: "private provider detail" }, { status: 400 }),
        ),
      ) as unknown as typeof fetch;
      await expect(
        createService(fetchFn).ask({ ...subject, question: "How?" }),
      ).rejects.toMatchObject({
        code: "INVALID_TARGET",
        status: 400,
        message,
        retryable: false,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["cli", "url"] as const)(
    "omits target and thread_id for a question-only %s request",
    async (sourceFormat) => {
      let capturedInit: RequestInit | undefined;
      const fetchFn = mock(
        (_url: string | URL | Request, init?: RequestInit) => {
          capturedInit = init;
          return Promise.resolve(
            jsonResponse(
              sourceFormat === "url" ? urlResponseBody() : responseBody(),
            ),
          );
        },
      ) as unknown as typeof fetch;

      const service = createService(fetchFn);
      const question = "How does Express routing work?";
      if (sourceFormat === "url") {
        await service.ask({ question, sourceFormat });
      } else {
        await service.ask({ question });
      }
      expect(JSON.parse(String(capturedInit?.body))).toEqual({
        question,
        source_format: sourceFormat,
      });
    },
  );

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

    expect(result).toEqual(responseBody() as unknown as AgenticAskCliResponse);
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

  it("requests and validates MCP source calls when selected by the caller", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock((_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(jsonResponse(mcpResponseBody()));
    }) as unknown as typeof fetch;

    const result = await createService(fetchFn).ask({
      target: "npm:example",
      question: "How is the client created?",
      sourceFormat: "mcp",
    });

    expect(result).toEqual(
      mcpResponseBody() as unknown as AgenticAskMcpResponse,
    );
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      target: "npm:example",
      question: "How is the client created?",
      source_format: "mcp",
    });
  });

  it("continues a thread without resending its target", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock((_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(jsonResponse());
    }) as unknown as typeof fetch;

    await createService(fetchFn).ask({
      threadId: THREAD_ID,
      question: "Where is that choice checked?",
    });

    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      thread_id: THREAD_ID,
      question: "Where is that choice checked?",
      source_format: "cli",
    });
  });

  it("requests and validates upstream URLs when selected by the caller", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock((_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(
        jsonResponse(
          urlResponseBody({
            usage: { input_tokens: 1 },
            future_field: true,
          }),
        ),
      );
    }) as unknown as typeof fetch;

    const result = await createService(fetchFn).ask({
      target: "npm:example",
      question: "How is the client created?",
      sourceFormat: "url",
    });

    expect(result).toEqual(
      urlResponseBody() as unknown as AgenticAskUrlResponse,
    );
    expect(result).not.toHaveProperty("usage");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      target: "npm:example",
      question: "How is the client created?",
      source_format: "url",
    });
  });

  it("rejects malformed URL sources and a mismatched response format", async () => {
    const invalidBodies = [
      responseBody(),
      urlResponseBody({ sources: [{ url: "javascript:alert(1)" }] }),
      urlResponseBody({ sources: [{ url: "not a URL" }] }),
      urlResponseBody({ sources: [{ url: " https://example.com/source" }] }),
      urlResponseBody({ sources: [{ url: "https://example.com/source " }] }),
      urlResponseBody({ sources: [{ url: "https://example.com/a\nb" }] }),
      urlResponseBody({ sources: [{ url: "https://example.com/a\tb" }] }),
      urlResponseBody({ sources: [{ href: "https://example.com" }] }),
    ];

    for (const body of invalidBodies) {
      const service = createService(
        mock(() =>
          Promise.resolve(jsonResponse(body)),
        ) as unknown as typeof fetch,
      );
      await expect(
        service.ask({
          target: "npm:example",
          question: "How?",
          sourceFormat: "url",
        }),
      ).rejects.toBeInstanceOf(MalformedAgenticAskResponseError);
    }
  });

  it("rejects malformed MCP calls and a mismatched response format", async () => {
    const invalidBodies = [
      responseBody(),
      mcpResponseBody({
        sources: [
          {
            name: "code_read",
            arguments: {
              target: "npm:example",
              path: "src/index.ts",
              start_line: 0,
              end_line: 20,
            },
          },
        ],
      }),
      mcpResponseBody({ sources: [{ name: "shell", arguments: {} }] }),
    ];

    for (const body of invalidBodies) {
      const service = createService(
        mock(() =>
          Promise.resolve(jsonResponse(body)),
        ) as unknown as typeof fetch,
      );
      await expect(
        service.ask({
          target: "npm:example",
          question: "How?",
          sourceFormat: "mcp",
        }),
      ).rejects.toBeInstanceOf(MalformedAgenticAskResponseError);
    }
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

  it("refreshes an OAuth token once after a terms gate", async () => {
    const forceRefresh = mock(() => Promise.resolve("fresh-token"));
    const tokenProvider = createMockTokenProvider({
      getToken: mock(() => Promise.resolve("stale.jwt.token")),
      forceRefresh,
    });
    let requestCount = 0;
    const fetchFn = mock(() => {
      requestCount += 1;
      return Promise.resolve(
        requestCount === 1
          ? new Response(
              JSON.stringify({ code: "TERMS_ACCEPTANCE_REQUIRED" }),
              { status: 403 },
            )
          : jsonResponse(),
      );
    }) as unknown as typeof fetch;

    await createService(fetchFn, { tokenProvider }).ask({
      target: "npm:example",
      question: "How is it used?",
    });

    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
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

  it("rejects non-CLI, non-v7, and malformed responses", async () => {
    const invalidBodies = [
      responseBody({ source_format: "mcp" }),
      responseBody({ tool_call_id: "018f47a6-7b32-4a1e-8f45-6a2d39c81720" }),
      responseBody({ answer_markdown: "" }),
      responseBody({
        sources: [{ command: "npx", arguments: ["attacker-package"] }],
      }),
      responseBody({
        sources: [
          {
            command: "npx",
            arguments: ["githits@latest", "code", "read", "npm:example"],
          },
        ],
      }),
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

  it("strips additive response fields, including usage", async () => {
    const service = createService(
      mock(() =>
        Promise.resolve(
          jsonResponse(
            responseBody({
              usage: { input_tokens: 1 },
              future_field: true,
            }),
          ),
        ),
      ) as unknown as typeof fetch,
    );

    const response = await service.ask({
      target: "npm:example",
      question: "How?",
    });

    expect(response).not.toHaveProperty("usage");
    expect(response).not.toHaveProperty("future_field");
  });

  it("preserves the shared terms-acceptance gate on 403", async () => {
    const service = createService(
      mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: "TERMS_ACCEPTANCE_REQUIRED",
              terms_url: "https://githits.com/legal/terms-of-service/",
              acceptance_url: "https://app.githits.com/settings/privacy",
            }),
            { status: 403 },
          ),
        ),
      ) as unknown as typeof fetch,
    );

    await expect(
      service.ask({ target: "npm:example", question: "How?" }),
    ).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);
  });

  it("preserves ACCESS_DENIED when the 403 body cannot be read", async () => {
    const service = createService(
      mock(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("connection reset"));
              },
            }),
            { status: 403 },
          ),
        ),
      ) as unknown as typeof fetch,
    );

    await expect(
      service.ask({ target: "npm:example", question: "How?" }),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
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

  it("maps a successful-response stream reset to a connection error", async () => {
    const service = createService(
      mock(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("connection reset"));
              },
            }),
          ),
        ),
      ) as unknown as typeof fetch,
    );

    await expect(
      service.ask({ target: "npm:example", question: "How?" }),
    ).rejects.toBeInstanceOf(AgenticAskConnectionError);
  });

  it.each([
    [400, "INVALID_TARGET", false],
    [401, "AUTH_REQUIRED", false],
    [403, "ACCESS_DENIED", false],
    [404, "THREAD_NOT_FOUND", false],
    [409, "INVALID_REQUEST", false],
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
            "X-GitHits-Thread-Id": THREAD_ID,
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
        threadId: THREAD_ID,
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

describe("normalizeAgenticAskThreadId", () => {
  it("accepts one UUIDv7 and normalizes case", () => {
    expect(normalizeAgenticAskThreadId(THREAD_ID.toUpperCase())).toBe(
      THREAD_ID,
    );
  });

  it.each([
    undefined,
    null,
    "",
    "not-a-uuid",
    "018f47a6-7b32-4b1e-8f45-6a2d39c81720",
    `${THREAD_ID}, ${THREAD_ID}`,
    `${THREAD_ID}\nspoofed`,
    ` ${THREAD_ID}`,
  ])("rejects unsafe or ambiguous value %s", (value) => {
    expect(normalizeAgenticAskThreadId(value)).toBeUndefined();
  });
});

describe("Ask target diagnostics", () => {
  const detail = {
    code: "TARGET_RESOLUTION_FAILED",
    message: "The target lookup found no supported match.",
    hint: "Check the exact repository or registry/package identity.",
    reason: "missing_best",
  };

  it("preserves syntax guidance when no resolver reason is present", async () => {
    const syntax = {
      code: "INVALID_TARGET_SYNTAX",
      message: "Invalid target syntax.",
      hint: "Use github:owner/repo[#ref] or registry:package[@version].",
    };
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse({ detail: syntax }, { status: 400 })),
    ) as unknown as typeof fetch;
    await expect(
      createService(fetchFn).ask({
        target: "prisma",
        question: "How?",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_TARGET",
      targetError: syntax,
      message: `${syntax.message} ${syntax.hint}`,
    });
  });

  it.each(["cli", "mcp", "url"] as const)(
    "preserves validated target guidance for %s",
    async (sourceFormat) => {
      const fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse(
            { detail },
            {
              status: 400,
              headers: {
                "X-GitHits-Tool-Call-Id": TOOL_CALL_ID,
                "X-GitHits-Thread-Id": THREAD_ID,
              },
            },
          ),
        ),
      ) as unknown as typeof fetch;
      const service = createService(fetchFn);
      const request = { target: "github:prisma/prisma", question: "How?" };
      const result =
        sourceFormat === "cli"
          ? service.ask({ ...request, sourceFormat })
          : sourceFormat === "mcp"
            ? service.ask({ ...request, sourceFormat })
            : service.ask({ ...request, sourceFormat });
      await expect(result).rejects.toMatchObject({
        code: "INVALID_TARGET",
        message: `${detail.message} ${detail.hint}`,
        targetError: detail,
        status: 400,
        retryable: false,
        toolCallId: TOOL_CALL_ID,
        threadId: THREAD_ID,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { detail: "private provider detail" },
    { detail: { ...detail, code: "INTERNAL_ERROR" } },
    { detail: { ...detail, reason: "private provider detail" } },
    { detail: { ...detail, message: "private provider detail\u001b[31m" } },
    { detail: { ...detail, hint: "private provider detail".repeat(100) } },
  ])("does not expose an unrecognized error body: %j", async (body) => {
    const fetchFn = mock(() =>
      Promise.resolve(jsonResponse(body, { status: 400 })),
    ) as unknown as typeof fetch;
    try {
      await createService(fetchFn).ask({
        target: "npm:prisma",
        question: "How?",
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AgenticAskHttpError);
      expect((error as Error).message).not.toContain("private provider detail");
      expect((error as AgenticAskHttpError).targetError).toBeUndefined();
      expect((error as Error).message).toContain("github:owner/repo#ref");
    }
  });

  it("bounds streamed error bodies and retains 400 recovery guidance", async () => {
    let cancelled = false;
    const fetchFn = mock(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(16_385));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 400 },
        ),
      ),
    ) as unknown as typeof fetch;
    await expect(
      createService(fetchFn).ask({ target: "npm:prisma", question: "How?" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_TARGET",
      targetError: undefined,
    });
    expect(cancelled).toBe(true);
  });
});
