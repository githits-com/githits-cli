import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  DiscoveryIndexingEstimate,
  UnifiedSearchOutcome,
} from "@githits/core-internal";
import { documentationContributorOutcome } from "../../packages/mcp/src/services/test-helpers.js";
import { searchAction, searchStatusAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

const indexingEstimates: DiscoveryIndexingEstimate[] = [
  {
    kind: "REPOSITORY",
    targets: ["npm:express", "github:expressjs/express"],
    repositoryUrl: "https://github.com/expressjs/express",
    estimate: {
      lowerSeconds: 10,
      upperSeconds: 40,
      elapsedSeconds: 90,
      sampleCount: 30,
      source: "same_repository_refs",
    },
  },
  {
    kind: "DOCUMENTATION",
    targets: ["npm:express"],
    unavailableReason: "UNSUPPORTED_WORK",
  },
];

function outcome(
  status: string,
  entries: DiscoveryIndexingEstimate[] | undefined = indexingEstimates,
): UnifiedSearchOutcome {
  if (
    documentationContributorOutcome.state !== "completed" ||
    defaultUnifiedSearchOutcome.state !== "completed"
  )
    throw new Error("expected documentation fixture");
  return {
    state: "incomplete",
    completed: false,
    searchRef: "estimate-ref",
    result: {
      ...documentationContributorOutcome.result,
      results: defaultUnifiedSearchOutcome.result.results,
      sourceStatus: documentationContributorOutcome.result.sourceStatus.map(
        (source) => ({
          ...source,
          contributors: source.contributors?.map((contributor) =>
            contributor.kind === "DOCPACK"
              ? { ...contributor, state: "READY", freshness: "PROVISIONAL" }
              : contributor,
          ),
        }),
      ),
      partialResults: true,
    },
    progress: {
      searchRef: "estimate-ref",
      status,
      targetsTotal: 2,
      targetsReady: 1,
      elapsedMs: 600_000,
      query: "router",
      queryWarnings: [],
      sources: ["DOCS"],
      indexingEstimates: entries,
    },
  };
}

for (const operation of ["search", "search_status"] as const) {
  async function responses(
    value: UnifiedSearchOutcome,
    json: boolean,
  ): Promise<{ cli: string; mcp: string }> {
    const service = createMockCodeNavigationService({
      search: mock(() => Promise.resolve(value)),
      searchStatus: mock(() => Promise.resolve(value)),
    });
    const deps = {
      codeNavigationService: service,
      codeNavigationUrl: "https://backend.example.com",
      hasValidToken: true,
      mcpUrl: "https://mcp.example.com",
    };
    const log = spyOn(console, "log").mockImplementation(() => {});
    let cli: string;
    try {
      if (operation === "search")
        await searchAction("router", { in: ["npm:express"], json }, deps);
      else await searchStatusAction("estimate-ref", { json }, deps);
      cli = String(log.mock.calls[0]?.[0]);
    } finally {
      log.mockRestore();
    }
    const tool = createParityMcpTool(operation, {
      codeNavigationService: service,
    });
    const args =
      operation === "search"
        ? { target: "npm:express", query: "router" }
        : { search_ref: "estimate-ref" };
    const response = await tool.handler(
      { ...args, ...(json ? { format: "json" } : {}) },
      {},
    );
    expect(response.isError).toBeUndefined();
    return { cli, mcp: response.content[0]?.text ?? "" };
  }

  describe(`${operation} estimate parity`, () => {
    it("preserves full timing and provisional/partial evidence in both JSON surfaces", async () => {
      const { cli, mcp } = await responses(outcome("INDEXING"), true);
      const payload = JSON.parse(cli);
      expect(payload).toEqual(JSON.parse(mcp));
      expect(payload.progress.indexingEstimates).toEqual(indexingEstimates);
      expect(payload.progress.next).toBe(
        'search_status search_ref="estimate-ref" wait_timeout_ms=50000',
      );
      const result = operation === "search" ? payload : payload.result;
      expect(result.partialResults).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
      expect(JSON.stringify(result.sourceStatus)).toContain("PROVISIONAL");
    });

    it("uses CLI seconds and MCP milliseconds while retaining interim hits", async () => {
      const { cli, mcp } = await responses(outcome("INDEXING"), false);
      expect(cli).toContain(
        "Next: githits search-status estimate-ref --wait 50",
      );
      expect(mcp).toContain(
        'Next: search_status search_ref="estimate-ref" wait_timeout_ms=50000',
      );
      expect(cli).toContain("[1]");
      expect(mcp).toContain("[1]");
      expect(cli.toLowerCase()).not.toContain("eta");
    });

    it.each([
      [120, 130],
      [290, 300],
      [600, 300],
    ])(
      "uses a bounded long continuation for upper %s seconds",
      async (upperSeconds, seconds) => {
        const value = outcome("INDEXING", [
          {
            ...indexingEstimates[0]!,
            estimate: { upperSeconds },
          },
        ]);
        const { cli, mcp } = await responses(value, false);
        expect(cli).toContain(`--wait ${seconds}`);
        expect(mcp).toContain(`wait_timeout_ms=${seconds! * 1000}`);
        const json = JSON.parse((await responses(value, true)).cli);
        expect(json.progress.next).toContain(
          `wait_timeout_ms=${seconds! * 1000}`,
        );
      },
    );

    it.each([
      { entries: [] },
      { entries: undefined },
      { entries: [indexingEstimates[1]!] },
    ])("keeps default guidance without ranges %j", async ({ entries }) => {
      const value = outcome("SEARCHING", entries ? [...entries] : undefined);
      // Passing undefined explicitly models an existing injected service provider.
      if (entries === undefined) delete value.progress!.indexingEstimates;
      const { cli, mcp } = await responses(value, false);
      expect(cli).toContain("--wait 30");
      expect(mcp).toContain("wait_timeout_ms=30000");
      const json = JSON.parse((await responses(value, true)).cli);
      if (entries === undefined)
        expect(json.progress).not.toHaveProperty("indexingEstimates");
      else expect(json.progress.indexingEstimates).toEqual(entries);
    });

    it("keeps completed evidence retrieval at the default wait", async () => {
      const pending = outcome("INDEXING");
      if (!pending.result) throw new Error("expected result fixture");
      const completed: UnifiedSearchOutcome = {
        state: "completed",
        completed: true,
        searchRef: "estimate-ref",
        result: pending.result,
        progress: {
          ...pending.progress!,
          status: "COMPLETED",
          indexingEstimates: [],
        },
      };
      const { cli, mcp } = await responses(completed, false);
      expect(cli).toContain("--wait 30");
      expect(mcp).toContain("wait_timeout_ms=30000");
      const final = {
        ...completed,
        result: { ...completed.result, evidenceNotice: undefined },
      };
      const finalText = await responses(final, false);
      expect(finalText.cli).not.toContain("estimate-ref");
      expect(finalText.mcp).not.toContain("estimate-ref");
    });

    it.each(["DEFERRED", "FAILED", "TIMEOUT", "FUTURE_STATUS"])(
      "never polls %s even with timing and interim evidence",
      async (status) => {
        const { cli, mcp } = await responses(outcome(status), false);
        expect(cli).not.toContain("estimate-ref");
        expect(mcp).not.toContain("estimate-ref");
        const payload = JSON.parse(
          (await responses(outcome(status), true)).cli,
        );
        expect(payload.progress.indexingEstimates).toEqual(indexingEstimates);
        expect(payload.progress.next).not.toContain("search_status");
      },
    );
  });
}
