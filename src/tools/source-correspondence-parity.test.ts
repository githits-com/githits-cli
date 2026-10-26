import { describe, expect, it, mock, spyOn } from "bun:test";
import type { ListResult } from "@githits/core-internal";
import { listAction } from "../commands/list.js";
import { readAction } from "../commands/read.js";
import {
  createMockCodeNavigationService,
  createMockListService,
  createMockReadService,
  defaultReadFileResult,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

const identity = {
  registry: "MAVEN",
  packageName: "example:library",
  version: "1.2.3",
  repoUrl: "https://github.com/example/library",
  gitRef: "v1.2.3",
  commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
const target = "maven:example:library@1.2.3";
const resolution = {
  requested: { ...identity, releaseCorrespondence: null },
  resolvedRequested: { ...identity, releaseCorrespondence: "manifest_matched" },
  served: { ...identity, releaseCorrespondence: "unverified" },
  freshness: "current",
  availableVersions: [],
  availableRefs: [],
};

function listFixture(): ListResult {
  return {
    inventoryKind: "SOURCE",
    requestedTarget: target,
    canonicalTarget: target,
    entries: [{ kind: "FILE", path: "src/index.ts" }],
    hasMore: false,
    nextCursor: null,
    indexedVersion: "1.2.3",
    codeIndexState: "CURRENT",
    indexingStatus: "INDEXED",
    indexingRef: null,
    inventoryState: null,
    crawlStatus: null,
    coverageState: null,
    coverageReason: null,
    preparation: null,
    targetResolution: { ...resolution, freshnessReason: null },
  };
}

describe("source correspondence adapter parity", () => {
  it("discloses unified list uncertainty in compact CLI/MCP, preserving JSON states and silent paths", async () => {
    const listService = createMockListService({
      list: mock(async () => listFixture()),
    });
    const tool = createParityMcpTool("list", { listService });
    const out = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    const deps = {
      listService,
      hasValidToken: true,
      mcpUrl: "https://mcp.example.com",
    };
    try {
      await listAction(target, undefined, {}, deps);
      const cliText = out.mock.calls.map(([v]) => String(v)).join("");
      const mcp = await tool.handler({ target }, {});
      for (const text of [cliText, mcp.content[0]?.text ?? ""])
        expect(text.replace(/\s+/g, " ")).toContain(
          `match to library@1.2.3 unconfirmed`,
        );
      await listAction(target, undefined, { json: true }, deps);
      const cliJson = JSON.parse(String(log.mock.calls[0]?.[0]));
      const mcpJson = JSON.parse(
        (await tool.handler({ target, format: "json" }, {})).content[0]?.text ??
          "{}",
      );
      expect(cliJson).toEqual(mcpJson);
      expect(cliJson.targetResolution).toEqual({
        ...resolution,
        freshnessReason: null,
      });
      out.mockClear();
      await listAction(target, undefined, { silent: true }, deps);
      expect(out.mock.calls.map(([v]) => String(v)).join("")).toBe(
        "src/index.ts\n",
      );
    } finally {
      out.mockRestore();
      log.mockRestore();
    }
  });

  it("keeps read provenance in verbose CLI/MCP and identical structured JSON", async () => {
    const result = { ...defaultReadFileResult, targetResolution: resolution };
    const readService = createMockReadService({
      read: mock(async () => ({ source: "code" as const, result })),
    });
    const tool = createParityMcpTool("read", { readService });
    const out = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    const deps = {
      readService,
      codeNavigationService: createMockCodeNavigationService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl: "https://mcp.example.com",
    };
    try {
      await readAction(target, "src/index.ts", { verbose: true }, deps);
      const mcp = await tool.handler({ target, path: "src/index.ts" }, {});
      for (const text of [
        out.mock.calls.map(([v]) => String(v)).join(""),
        mcp.content[0]?.text ?? "",
      ])
        expect(text.replace(/\s+/g, " ")).toContain(
          `match to library@1.2.3 unconfirmed`,
        );
      expect(err).not.toHaveBeenCalled();
      await readAction(target, "src/index.ts", { json: true }, deps);
      const cliJson = JSON.parse(String(log.mock.calls[0]?.[0]));
      const mcpJson = JSON.parse(
        (
          await tool.handler(
            { target, path: "src/index.ts", format: "json" },
            {},
          )
        ).content[0]?.text ?? "{}",
      );
      expect(cliJson).toEqual(mcpJson);
      expect(cliJson.targetResolution).toEqual({
        ...resolution,
        suggestedRefs: [],
      });
      expect(err).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      log.mockRestore();
      err.mockRestore();
    }
  });
});
