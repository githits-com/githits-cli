import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceDocumentationSectionUnresolvedError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import {
  type DocsReadCommandDependencies,
  docsReadAction,
} from "../commands/docs/read.js";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<DocsReadCommandDependencies> = {},
): DocsReadCommandDependencies {
  return {
    packageIntelligenceService: createMockPackageIntelligenceService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  pageId: string,
  deps: DocsReadCommandDependencies = cliDeps(),
  lines?: string,
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await docsReadAction(pageId, { json: true, lines }, deps);
    } catch (error) {
      if (!isProcessExitSentinel(error)) throw error;
    }
    const raw =
      (logSpy.mock.calls[0]?.[0] as string | undefined) ??
      (errSpy.mock.calls[0]?.[0] as string | undefined);
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

async function mcpJson(
  args: { page_id: string; start_line?: number; end_line?: number },
  readPackageDocMock?: () => Promise<unknown>,
): Promise<unknown> {
  const service = createMockPackageIntelligenceService(
    readPackageDocMock ? { readPackageDoc: readPackageDocMock as never } : {},
  );
  const tool = createParityMcpTool("docs_read", {
    packageIntelligenceService: service,
  });
  const result = await tool.handler({ ...args, format: "json" }, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("read_package_doc parity", () => {
  it("PARITY-JSON-KEYS: happy path CLI === MCP", async () => {
    const cli = await cliJson("github:expressjs/express@abc123/README.md");
    const mcp = await mcpJson({
      page_id: "github:expressjs/express@abc123/README.md",
    });
    expect(cli).toEqual(mcp);
  });

  it("PARITY-RANGE: explicit fragment override CLI === MCP", async () => {
    const target = "https://docs.example.test/page#section";
    const fn = mock(() =>
      Promise.resolve({
        contentRange: {
          startLine: 2,
          endLine: 2,
          totalLines: 3,
        },
        page: {
          id: "stable-page-id",
          docsReadTarget: target,
          content: "two",
          source: { url: target },
        },
      }),
    );
    const cli = await cliJson(
      target,
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          readPackageDoc: fn,
        }),
      }),
      "2-2",
    );
    const mcp = await mcpJson(
      { page_id: target, start_line: 2, end_line: 2 },
      fn,
    );

    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      pageId: "stable-page-id",
      startLine: 2,
      endLine: 2,
      totalLines: 3,
      content: "two",
    });
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND CLI === MCP", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceTargetNotFoundError("Doc page not found"),
      ),
    );
    const cli = await cliJson(
      "missing-page",
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          readPackageDoc: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson({ page_id: "missing-page" }, fn as never);
    expect(cli).toEqual(mcp);
    expect(cli).toEqual({
      error: "Doc page not found",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("PARITY-ERROR-ENVELOPE: unresolved section CLI === MCP", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceDocumentationSectionUnresolvedError(
          "Documentation section is ambiguous",
          "ambiguous",
        ),
      ),
    );
    const deps = cliDeps({
      packageIntelligenceService: createMockPackageIntelligenceService({
        readPackageDoc: fn,
      }),
    });
    const target = "https://docs.example.test/page#duplicate";
    const cli = await cliJson(target, deps);
    const mcp = await mcpJson({ page_id: target }, fn);

    expect(cli).toEqual(mcp);
    expect(cli).toEqual({
      error: "Documentation section is ambiguous",
      code: "DOCUMENTATION_SECTION_UNRESOLVED",
      retryable: false,
      details: { reason: "ambiguous" },
    });
  });
});
