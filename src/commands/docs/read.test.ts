import { describe, expect, it, mock, spyOn } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import {
  createMockPackageIntelligenceService,
  defaultPackageDocResult,
} from "../../services/test-helpers.js";
import { type DocsReadCommandDependencies, docsReadAction } from "./read.js";

describe("docsReadAction", () => {
  function createDeps(
    overrides: Partial<DocsReadCommandDependencies> = {},
  ): DocsReadCommandDependencies {
    return {
      packageIntelligenceService: createMockPackageIntelligenceService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl: "https://mcp.githits.com",
      ...overrides,
    };
  }

  it("renders raw content by default", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await docsReadAction(
      "github:expressjs/express@abc123/README.md",
      {},
      createDeps(),
    );

    expect(writes.join("")).toContain("# Express");
    writeSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is provided", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await docsReadAction(
      "github:expressjs/express@abc123/README.md",
      { json: true },
      createDeps(),
    );

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(payload.pageId).toBe("github:expressjs/express@abc123/README.md");
    expect(payload.filePath).toBe("README.md");
    logSpy.mockRestore();
  });

  it("passes URL targets through and returns target, ID, provenance, and range", async () => {
    const docsReadTarget =
      "https://expressjs.com/en/guide/routing.html?publisher=express";
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const readPackageDoc = mock(() =>
      Promise.resolve({
        page: {
          id: "legacy-routing-id",
          docsReadTarget,
          content: "one\ntwo\nthree",
          source: { url: docsReadTarget },
        },
      }),
    );
    const service = createMockPackageIntelligenceService({ readPackageDoc });

    try {
      await docsReadAction(
        docsReadTarget,
        { lines: "2-2", json: true },
        createDeps({ packageIntelligenceService: service }),
      );

      expect(readPackageDoc).toHaveBeenCalledWith({ pageId: docsReadTarget });
      const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
      expect(payload).toMatchObject({
        docsReadTarget,
        pageId: "legacy-routing-id",
        sourceUrl: docsReadTarget,
        startLine: 2,
        endLine: 2,
        content: "two",
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("renders distinct URL target and stable ID once in verbose output", async () => {
    const docsReadTarget = "https://expressjs.com/en/guide/routing.html";
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const service = createMockPackageIntelligenceService({
      readPackageDoc: mock(() =>
        Promise.resolve({
          page: {
            id: "legacy-routing-id",
            docsReadTarget,
            content: "routing",
            source: { url: docsReadTarget },
          },
        }),
      ),
    });

    try {
      await docsReadAction(
        docsReadTarget,
        { verbose: true },
        createDeps({ packageIntelligenceService: service }),
      );

      const output = writes.join("");
      expect(output).toContain(`docsReadTarget: ${docsReadTarget}`);
      expect(output).toContain("pageId: legacy-routing-id");
      expect(output.match(/expressjs\.com/g)).toHaveLength(1);
      expect(output).not.toContain(`source: ${docsReadTarget}`);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("routes service classification through --json error envelope", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      readPackageDoc: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Doc page not found"),
        ),
      ),
    });

    try {
      await docsReadAction(
        "missing-page",
        { json: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.error).toBe("Doc page not found");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("throws AuthRequiredError before calling the service when unauthenticated", async () => {
    const readPackageDoc = mock(() => Promise.resolve(defaultPackageDocResult));
    const service = createMockPackageIntelligenceService({ readPackageDoc });

    await expect(
      docsReadAction(
        "github:expressjs/express@abc123/README.md",
        {},
        createDeps({
          packageIntelligenceService: service,
          hasValidToken: false,
        }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    expect(readPackageDoc).not.toHaveBeenCalled();
  });
});
