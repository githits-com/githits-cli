import { describe, expect, it, mock, spyOn } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import {
  type DocsListCommandDependencies,
  docsListAction,
} from "../commands/docs/list.js";
import {
  createMockPackageIntelligenceService,
  defaultPackageDocsList,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<DocsListCommandDependencies> = {},
): DocsListCommandDependencies {
  return {
    packageIntelligenceService: createMockPackageIntelligenceService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  spec: string,
  deps: DocsListCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await docsListAction(spec, { json: true }, deps);
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
  args: { registry: string; package_name: string },
  listPackageDocsMock?: () => Promise<unknown>,
): Promise<unknown> {
  const service = createMockPackageIntelligenceService(
    listPackageDocsMock
      ? { listPackageDocs: listPackageDocsMock as never }
      : {},
  );
  const tool = createParityMcpTool("docs_list", {
    packageIntelligenceService: service,
  });
  const result = await tool.handler({ ...args, format: "json" }, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("list_package_docs parity", () => {
  it("PARITY-JSON-KEYS: happy path CLI === MCP", async () => {
    const cli = await cliJson("npm:express@5.2.1");
    const mcp = await mcpJson({ registry: "npm", package_name: "express" });
    expect(cli).toEqual(mcp);
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND CLI === MCP", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceTargetNotFoundError("Package not found"),
      ),
    );
    const cli = await cliJson(
      "npm:ghost",
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          listPackageDocs: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      { registry: "npm", package_name: "ghost" },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect(cli).toEqual({
      error: "Package not found",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("PARITY-JSON-KEYS: empty list CLI === MCP", async () => {
    const fn = mock(() =>
      Promise.resolve({
        ...defaultPackageDocsList,
        pages: [],
        pageInfo: { hasNextPage: false, totalCount: 0 },
      }),
    );
    const cli = await cliJson(
      "npm:express",
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          listPackageDocs: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      { registry: "npm", package_name: "express" },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });
});
