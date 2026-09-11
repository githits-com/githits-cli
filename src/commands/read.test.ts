import { describe, expect, it, spyOn } from "bun:test";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import {
  createMockCodeNavigationService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import { registerCodeReadCommand } from "./code/read.js";
import { registerDocsReadCommand } from "./docs/read.js";
import {
  type ReadCommandDependencies,
  readAction,
  registerReadCommand,
} from "./read.js";

function deps(): ReadCommandDependencies {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
  };
}

describe("top-level read", () => {
  it("registers new syntax and marks legacy commands deprecated in help", () => {
    const root = new Command();
    const read = registerReadCommand(root);
    expect(read.name()).toBe("read");
    expect(read.helpInformation()).toContain("--lines");
    expect(
      registerCodeReadCommand(new Command("code")).helpInformation(),
    ).toContain("Deprecated: use githits read");
    expect(
      registerDocsReadCommand(new Command("docs")).helpInformation(),
    ).toContain("Deprecated: use githits read");
  });

  it("reads docs fragments unchanged with no default range or wait", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const target = "https://docs.example.test/guide#routing";
      await readAction(target, undefined, { json: true, wait: "0" }, services);
      expect(
        services.packageIntelligenceService!.readPackageDoc,
      ).toHaveBeenCalledWith({ pageId: target });
      expect(services.codeNavigationService!.readFile).not.toHaveBeenCalled();
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toHaveProperty(
        "content",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("overrides a docs fragment with a one-sided range", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "https://docs.example.test/guide#routing",
        "",
        { json: true, lines: "10-" },
        services,
      );
      expect(
        services.packageIntelligenceService!.readPackageDoc,
      ).toHaveBeenCalledWith({
        pageId: "https://docs.example.test/guide#routing",
        startLine: 10,
      });
    } finally {
      log.mockRestore();
    }
  });

  it("reads code with no MCP cap, preserving explicit zero wait", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "npm:example",
        "src/index.ts",
        { json: true, wait: "0" },
        services,
      );
      expect(services.codeNavigationService!.readFile).toHaveBeenCalledWith({
        target: { registry: "NPM", packageName: "example", version: undefined },
        filePath: "src/index.ts",
        startLine: undefined,
        endLine: undefined,
        waitTimeoutMs: 0,
      });
      expect(
        services.packageIntelligenceService!.readPackageDoc,
      ).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("retains repo-url addressing and path-suffix line ranges", async () => {
    const services = deps();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await readAction(
        "src/index.ts:3-8",
        undefined,
        {
          json: true,
          repoUrl: "https://github.com/owner/repo",
          gitRef: "abc123",
        },
        services,
      );
      expect(services.codeNavigationService!.readFile).toHaveBeenCalledWith(
        expect.objectContaining({
          target: {
            repoUrl: "https://github.com/owner/repo",
            gitRef: "abc123",
          },
          filePath: "src/index.ts",
          startLine: 3,
          endLine: 8,
        }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("keeps default stdout content-only", async () => {
    const output: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string,
    ) => {
      output.push(chunk);
      return true;
    }) as typeof process.stdout.write);
    try {
      await readAction("npm:example", "src/index.ts", {}, deps());
      expect(output.join("")).toStartWith("// Express entry point");
      expect(output.join("")).not.toContain("Deprecated");
    } finally {
      write.mockRestore();
    }
  });

  it.each([
    { start: "1" },
    { end: "20" },
    { gitRef: "main" },
    { wait: "-1" },
    { wait: "60001" },
  ])(
    "rejects invalid docs options before a service call: %j",
    async (options) => {
      const services = deps();
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      try {
        await expect(
          readAction(
            "docs-id",
            undefined,
            { ...options, json: true },
            services,
          ),
        ).rejects.toThrow("exit");
        expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toHaveProperty(
          "code",
          "INVALID_ARGUMENT",
        );
        expect(
          services.packageIntelligenceService!.readPackageDoc,
        ).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it("requires authentication before interpreting targets", async () => {
    await expect(
      readAction(undefined, undefined, {}, { ...deps(), hasValidToken: false }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
