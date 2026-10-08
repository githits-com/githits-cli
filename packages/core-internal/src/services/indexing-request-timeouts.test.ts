import { describe, expect, it, spyOn } from "bun:test";
import { CodeNavigationServiceImpl } from "./code-navigation-service.js";
import { GrepServiceImpl } from "./grep-service.js";
import { ListServiceImpl } from "./list-service.js";
import { ReadServiceImpl } from "./read-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

describe("indexing request wait and HTTP budgets", () => {
  for (const surface of [
    "search",
    "searchStatus",
    "list",
    "read",
    "grep",
    "listFiles",
    "readFile",
    "grepRepo",
  ] as const) {
    const maximum =
      surface === "search" || surface === "searchStatus"
        ? 120_000
        : surface === "list" || surface === "grep"
          ? 300_000
          : 60_000;
    it.each([undefined, 0, maximum])(
      `${surface} sends the effective wait for %s`,
      async (waitTimeoutMs) => {
        let variables: Record<string, unknown> | undefined;
        const fetchFn = (async (_input: unknown, init?: RequestInit) => {
          variables = JSON.parse(String(init?.body)).variables;
          throw new TypeError("fixture transport failure");
        }) as unknown as typeof fetch;
        const tokenProvider = createMockTokenProvider();
        const endpoint = "https://fixture.example.test";
        const code = new CodeNavigationServiceImpl(
          endpoint,
          tokenProvider,
          fetchFn,
        );
        const target = { repoUrl: "https://github.com/owner/repo" };
        const wait = { waitTimeoutMs };
        const calls: Record<typeof surface, () => Promise<unknown>> = {
          search: () =>
            code.search({ targets: [target], query: "fixture", ...wait }),
          searchStatus: () => code.searchStatus("fixture-ref", waitTimeoutMs),
          list: () =>
            new ListServiceImpl(endpoint, tokenProvider, fetchFn).list({
              target: "github:owner/repo",
              includeDetailedFields: false,
              ...wait,
            }),
          read: () =>
            new ReadServiceImpl(endpoint, tokenProvider, fetchFn).read({
              target: "github:owner/repo",
              path: "file.ts",
              ...wait,
            }),
          grep: () =>
            new GrepServiceImpl(endpoint, tokenProvider, fetchFn).grep({
              targets: [{ target: "github:owner/repo" }],
              pattern: "fixture",
              patternType: "LITERAL",
              caseSensitive: true,
              contextLinesBefore: 0,
              contextLinesAfter: 0,
              includeDetailedFields: false,
              ...wait,
            }),
          listFiles: () => code.listFiles({ target, ...wait }),
          readFile: () =>
            code.readFile({ target, filePath: "file.ts", ...wait }),
          grepRepo: () =>
            code.grepRepo({ target, pattern: "fixture", ...wait }),
        };
        const timeout = spyOn(AbortSignal, "timeout");
        try {
          await expect(calls[surface]()).rejects.toThrow("Could not reach");
          const effectiveWait = waitTimeoutMs ?? 30_000;
          expect(variables?.waitTimeoutMs).toBe(effectiveWait);
          expect(timeout).toHaveBeenCalledWith(
            Math.max(120_000, effectiveWait + 30_000),
          );
        } finally {
          timeout.mockRestore();
        }
      },
    );
  }

  it("keeps a direct grep continuation non-waiting", async () => {
    let variables: Record<string, unknown> | undefined;
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      variables = JSON.parse(String(init?.body)).variables;
      throw new TypeError("fixture transport failure");
    }) as unknown as typeof fetch;
    const service = new GrepServiceImpl(
      "https://fixture.example.test",
      createMockTokenProvider(),
      fetchFn,
    );
    await expect(
      service.grep({
        targets: [{ target: "npm:express" }],
        pattern: "fixture",
        patternType: "LITERAL",
        caseSensitive: true,
        contextLinesBefore: 0,
        contextLinesAfter: 0,
        includeDetailedFields: false,
        cursor: "opaque",
      }),
    ).rejects.toThrow("Could not reach");
    expect(variables?.waitTimeoutMs).toBe(0);
  });
});
