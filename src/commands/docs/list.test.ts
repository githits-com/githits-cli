import { describe, expect, it, mock, spyOn } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import {
  createMockPackageIntelligenceService,
  defaultPackageDocsList,
} from "../../services/test-helpers.js";
import { type DocsListCommandDependencies, docsListAction } from "./list.js";

describe("docsListAction", () => {
  function createDeps(
    overrides: Partial<DocsListCommandDependencies> = {},
  ): DocsListCommandDependencies {
    return {
      packageIntelligenceService: createMockPackageIntelligenceService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl: "https://mcp.githits.com",
      ...overrides,
    };
  }

  it("renders source badges and page IDs in terminal output", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await docsListAction("npm:express@5.2.1", {}, createDeps());

    const output = writes.join("");
    expect(output).toContain("123-getting-started");
    expect(output).toContain("[crawled]");
    expect(output).toContain("[repo]");
    expect(output).toContain(
      "githits docs read 'https://hexdocs.pm/express/getting-started.html'",
    );
    expect(output.match(/hexdocs\.pm/g)).toHaveLength(1);
    writeSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is provided", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await docsListAction("npm:express@5.2.1", { json: true }, createDeps());

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(payload.name).toBe("express");
    expect(payload.pages[0].pageId).toBe("123-getting-started");
    expect(payload.pages[1].filePath).toBe("README.md");
    logSpy.mockRestore();
  });

  it("shell-quotes publisher URL targets in per-page terminal follow-ups", async () => {
    const docsReadTarget =
      "https://docs.example.test/guide with spaces;$(echo nope)?q='quoted'&x=*";
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
      listPackageDocs: mock(() =>
        Promise.resolve({
          registry: "npm",
          packageName: "example",
          pages: [
            {
              id: "legacy-crawled-id",
              docsReadTarget,
              title: "Publisher guide",
              sourceKind: "CRAWLED" as const,
              sourceUrl: "https://docs.example.test/guide with spaces",
            },
          ],
          pageInfo: { hasNextPage: false },
        }),
      ),
    });

    try {
      await docsListAction(
        "npm:example",
        {},
        createDeps({ packageIntelligenceService: service }),
      );

      expect(writes.join("")).toContain(
        `githits docs read 'https://docs.example.test/guide with spaces;$(echo nope)?q='"'"'quoted'"'"'&x=*'`,
      );
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
      listPackageDocs: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });

    try {
      await docsListAction(
        "npm:ghost",
        { json: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.error).toBe("Package not found");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("throws AuthRequiredError before calling the service when unauthenticated", async () => {
    const listPackageDocs = mock(() => Promise.resolve(defaultPackageDocsList));
    const service = createMockPackageIntelligenceService({ listPackageDocs });

    await expect(
      docsListAction(
        "npm:express",
        {},
        createDeps({
          packageIntelligenceService: service,
          hasValidToken: false,
        }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    expect(listPackageDocs).not.toHaveBeenCalled();
  });
});
