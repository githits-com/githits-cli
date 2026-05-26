import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type DocsReadCommandDependencies,
  docsReadAction,
} from "../commands/docs/read.js";
import { PackageIntelligenceTargetNotFoundError } from "../services/index.js";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { isProcessExitSentinel } from "./parity-test-helpers.js";
import { createReadPackageDocTool } from "./read-package-doc.js";

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
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await docsReadAction(pageId, { json: true }, deps);
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
  args: { page_id: string },
  readPackageDocMock?: () => Promise<unknown>,
): Promise<unknown> {
  const service = createMockPackageIntelligenceService(
    readPackageDocMock ? { readPackageDoc: readPackageDocMock as never } : {},
  );
  const tool = createReadPackageDocTool(service);
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
});
