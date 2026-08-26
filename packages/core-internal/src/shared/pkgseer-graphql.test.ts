import { describe, expect, it, mock } from "bun:test";
import type { ServiceDiagnostics } from "../services/runtime-diagnostics.js";
import { FetchTimeoutError } from "./fetch-timeout.js";
import {
  PkgseerTransportError,
  postPkgseerGraphql,
} from "./pkgseer-graphql.js";
import { createClientHeaderBuilder } from "./request-headers.js";
import { TermsAcceptanceRequiredError } from "./terms-acceptance.js";

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

  it("centralizes HTTP terms-gate classification for all consumers", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        makeResponse(
          JSON.stringify({
            code: "TERMS_ACCEPTANCE_REQUIRED",
            acceptance_url: "https://acceptance.example.test/settings/privacy",
          }),
          { status: 403 },
        ),
      ),
    );

    await expect(
      postPkgseerGraphql({
        endpointUrl: ENDPOINT,
        token: TOKEN,
        query: "query { x }",
        variables: {},
        fetchFn: asFetchFn(fetchFn),
      }),
    ).rejects.toMatchObject({
      name: TermsAcceptanceRequiredError.name,
      acceptanceUrl: "https://acceptance.example.test/settings/privacy",
    });
  });

  it("centralizes GraphQL terms-gate classification for all consumers", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(
        makeResponse(
          JSON.stringify({
            data: null,
            errors: [
              {
                extensions: { code: "TERMS_ACCEPTANCE_REQUIRED" },
              },
            ],
          }),
        ),
      ),
    );

    await expect(
      postPkgseerGraphql({
        endpointUrl: ENDPOINT,
        token: TOKEN,
        query: "query { x }",
        variables: {},
        fetchFn: asFetchFn(fetchFn),
      }),
    ).rejects.toBeInstanceOf(TermsAcceptanceRequiredError);
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
      userAgent: "githits-cli/1.2.3",
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
      userAgent: "githits-cli/1.2.3",
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
      userAgent: "githits-cli/1.2.3",
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
      userAgent: "githits-cli/1.2.3",
    });

    expect(capturedHeaders?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(capturedHeaders?.["Content-Type"]).toBe("application/json");
    expect(capturedHeaders?.["User-Agent"]).toBe("githits-cli/1.2.3");
  });

  it("sends x-githits-* telemetry headers from buildClientHeaders", async () => {
    // Pins the contract that the transport layer spreads the
    // telemetry headers onto every request — not just that the
    // module under `src/shared/request-headers.ts` builds them.
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
      clientHeaders: createClientHeaderBuilder({
        clientName: "githits-cli",
        clientVersion: "1.2.3",
        env: {},
        ppid: 42,
      }),
    });

    expect(capturedHeaders?.["x-githits-client-name"]).toBe("githits-cli");
    expect(capturedHeaders?.["x-githits-client-version"]).toBe("1.2.3");
    expect(capturedHeaders?.["x-githits-session-id"]).toMatch(/^[0-9a-f]{16}$/);
    // Authorization still wins over any hypothetical x-githits-*
    // collision — spread order (headers first, hardcoded second)
    // guarantees this, but pin it.
    expect(capturedHeaders?.Authorization).toBe(`Bearer ${TOKEN}`);
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

  it("rejects insecure remote endpoints before attaching authorization", async () => {
    const fetchFn = mock(() => Promise.resolve(makeResponse(VALID_JSON)));

    await expect(
      postPkgseerGraphql({
        endpointUrl: "http://attacker.test",
        token: TOKEN,
        query: "query { x }",
        variables: {},
        fetchFn: asFetchFn(fetchFn),
      }),
    ).rejects.toThrow("package/source service URL");
    expect(fetchFn).not.toHaveBeenCalled();
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

  it("throws PkgseerTransportError with timeout cause when fetch stalls", async () => {
    const fetchFn = mock(() => new Promise<Response>(() => {}));

    try {
      await postPkgseerGraphql({
        endpointUrl: ENDPOINT,
        token: TOKEN,
        query: "query { x }",
        variables: {},
        fetchFn: asFetchFn(fetchFn),
        timeoutMs: 1,
      });
      throw new Error("expected PkgseerTransportError");
    } catch (error) {
      expect(error).toBeInstanceOf(PkgseerTransportError);
      expect((error as PkgseerTransportError).cause).toBeInstanceOf(
        FetchTimeoutError,
      );
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
    const events: Array<{ area: string; event: Record<string, unknown> }> = [];
    const diagnostics: ServiceDiagnostics = {
      withOperation: async <T>(_name: string, operation: () => Promise<T>) =>
        operation(),
      isEnabled: (area) => area === "pkg-graphql",
      debug: (area, event) => events.push({ area, event }),
    };
    const fetchFn = mock(() => Promise.reject(new Error("ENOTFOUND")));
    try {
      await postPkgseerGraphql({
        endpointUrl: ENDPOINT,
        token: TOKEN,
        query: "query { x }",
        variables: {},
        fetchFn: asFetchFn(fetchFn),
        diagnostics,
      });
    } catch {
      // expected
    }

    expect(events).toEqual([
      {
        area: "pkg-graphql",
        event: { event: "transport-error", errorName: "Error", hasCause: true },
      },
    ]);
    // PII guards: no URL, no token, no query text.
    expect(JSON.stringify(events)).not.toContain("pkgseer.dev");
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(JSON.stringify(events)).not.toContain("query { x }");
  });
});
