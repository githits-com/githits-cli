import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  PkgseerTransportError,
  postPkgseerGraphql,
} from "./pkgseer-graphql.js";

function makeResponse(
  body: string,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: init?.headers ?? { "Content-Type": "application/json" },
  });
}

/**
 * Cast helper — Bun's `mock()` return type is missing `preconnect`,
 * which `typeof fetch` requires. Tests only exercise the call-path,
 * so the cast is safe.
 */
function asFetchFn<T extends (...args: never[]) => unknown>(
  fn: T,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

const VALID_JSON = JSON.stringify({
  data: { packageSummary: { package: { name: "express" } } },
});

describe("postPkgseerGraphql", () => {
  const ENDPOINT = "https://pkgseer.dev";
  const TOKEN = "test-token";

  let originalDebug: string | undefined;

  beforeEach(() => {
    originalDebug = process.env.GITHITS_DEBUG;
    delete process.env.GITHITS_DEBUG;
  });

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.GITHITS_DEBUG;
    } else {
      process.env.GITHITS_DEBUG = originalDebug;
    }
  });

  it("returns structured response for 200 + valid JSON", async () => {
    const fetchFn = mock(() => Promise.resolve(makeResponse(VALID_JSON)));

    const result = await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: { registry: "NPM" },
      fetchFn: asFetchFn(fetchFn),
    });

    expect(result.status).toBe(200);
    expect(result.responseBody).toBe(VALID_JSON);
    expect(result.parsedBody).toEqual(JSON.parse(VALID_JSON));
  });

  it("returns parsedBody: null for 200 + invalid JSON", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        makeResponse("not-json", {
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const result = await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(result.status).toBe(200);
    expect(result.responseBody).toBe("not-json");
    expect(result.parsedBody).toBe(null);
  });

  it("returns structured response for 5xx + JSON body (does not throw)", async () => {
    const body = JSON.stringify({ detail: "upstream exploded" });
    const fetchFn = mock(() =>
      Promise.resolve(makeResponse(body, { status: 502 })),
    );

    const result = await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(result.status).toBe(502);
    expect(result.responseBody).toBe(body);
    expect(result.parsedBody).toEqual({ detail: "upstream exploded" });
  });

  it("returns parsedBody: null for 5xx + plain-text body", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        makeResponse("Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const result = await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(result.status).toBe(500);
    expect(result.responseBody).toBe("Server Error");
    expect(result.parsedBody).toBe(null);
  });

  it("sends Authorization, Content-Type, and User-Agent headers", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = mock((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(makeResponse(VALID_JSON));
    });

    await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(capturedHeaders?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(capturedHeaders?.["Content-Type"]).toBe("application/json");
    expect(capturedHeaders?.["User-Agent"]).toMatch(/^githits-cli\/\S+$/);
  });

  it("normalises trailing slashes on endpointUrl", async () => {
    let capturedUrl: string | undefined;
    const fetchFn = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(makeResponse(VALID_JSON));
    });

    await postPkgseerGraphql({
      endpointUrl: "https://pkgseer.dev///",
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(capturedUrl).toBe("https://pkgseer.dev/api/graphql");
  });

  it("calls fetchFn exactly once per request", async () => {
    const fetchFn = mock(() => Promise.resolve(makeResponse(VALID_JSON)));

    await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws PkgseerTransportError when fetch rejects (DNS/socket/abort)", async () => {
    const cause = new Error("ENOTFOUND");
    cause.name = "TypeError";
    const fetchFn = mock(() => Promise.reject(cause));

    try {
      await postPkgseerGraphql({
        endpointUrl: ENDPOINT,
        token: TOKEN,
        query: "query { x }",
        variables: {},
        fetchFn: asFetchFn(fetchFn),
      });
      throw new Error("expected PkgseerTransportError");
    } catch (error) {
      expect(error).toBeInstanceOf(PkgseerTransportError);
      expect((error as PkgseerTransportError).cause).toBe(cause);
    }
  });

  it("does not retry on 401 — caller owns refresh (negative scope assertion)", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(makeResponse("{}", { status: 401 })),
    );

    const result = await postPkgseerGraphql({
      endpointUrl: ENDPOINT,
      token: TOKEN,
      query: "query { x }",
      variables: {},
      fetchFn: asFetchFn(fetchFn),
    });

    expect(result.status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("emits one pkg-graphql debug line on transport failure (payload PII-safe)", async () => {
    process.env.GITHITS_DEBUG = "pkg-graphql";

    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    // Capture stderr for the duration of the call.
    // biome-ignore lint/suspicious/noExplicitAny: test-only monkeypatch
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as any;

    try {
      const fetchFn = mock(() => Promise.reject(new Error("ENOTFOUND")));
      try {
        await postPkgseerGraphql({
          endpointUrl: ENDPOINT,
          token: TOKEN,
          query: "query { x }",
          variables: {},
          fetchFn: asFetchFn(fetchFn),
        });
      } catch {
        // expected
      }
    } finally {
      process.stderr.write = originalWrite;
    }

    const combined = stderrLines.join("");
    expect(combined).toContain('"area":"pkg-graphql"');
    expect(combined).toContain('"event":"transport-error"');
    expect(combined).toContain('"hasCause":true');
    // PII guards: no URL, no token, no query text.
    expect(combined).not.toContain("pkgseer.dev");
    expect(combined).not.toContain(TOKEN);
    expect(combined).not.toContain("query { x }");
  });
});
