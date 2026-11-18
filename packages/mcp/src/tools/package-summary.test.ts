import { describe, expect, it, mock } from "bun:test";
import {
  AuthenticationError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import {
  createMockPackageIntelligenceService,
  defaultPackageSummary,
} from "../services/test-helpers.js";
import { createPackageSummaryTool } from "./package-summary.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createPackageSummaryTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("pkg_info");
    expect(tool.description).toContain("Assess package health and adoption");
    expect(tool.description).toContain("[ARCHIVED]");
    expect(tool.description).toContain("verbose: true");
    expect(tool.description).toContain("selected-release affected count");
    expect(tool.description).toContain("package-wide advisory history count");
    expect(tool.description).toContain(
      "separate package-wide advisory history count",
    );
    expect(tool.schema.verbose?.description).toContain(
      "published-version count",
    );
    expect(tool.schema.format?.description).toContain("downloads.refreshedAt");
    expect(tool.schema.format?.description).toContain("advisoryHistory.total");
    expect(tool.description).toContain(
      "Historical counts are not current-version risk",
    );
    expect(tool.schema.verbose?.description).toContain(
      "advisory history (all versions)",
    );
    expect(tool.description).not.toContain("`advisory_scope:");
    expect(Object.keys(tool.schema)).toEqual(["target", "verbose", "format"]);
    expect(tool.schema.target?.description).toContain(
      "for example npm:express or npm:@types/node",
    );
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createPackageSummaryTool — happy path", () => {
  it("calls service.packageSummary with normalised params (uppercase registry)", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });
    const tool = createPackageSummaryTool(service);

    await tool.handler({ target: "npm:express" }, {});

    expect(packageSummary).toHaveBeenCalledTimes(1);
    const calls = packageSummary.mock.calls as unknown as Array<
      [{ registry: string; packageName: string; includeVerboseFields: boolean }]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.includeVerboseFields).toBe(false);
  });

  it("normalizes a trimmed uppercase scoped npm target exactly", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService({ packageSummary }),
    );

    await tool.handler({ target: " NPM:@types/node " }, {});

    expect(packageSummary).toHaveBeenCalledWith({
      registry: "NPM",
      packageName: "@types/node",
      includeVerboseFields: false,
    });
  });

  it("normalizes a Maven target exactly", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService({ packageSummary }),
    );

    await tool.handler(
      { target: "maven:org.apache.commons:commons-lang3" },
      {},
    );

    expect(packageSummary).toHaveBeenCalledWith({
      registry: "MAVEN",
      packageName: "org.apache.commons:commons-lang3",
      includeVerboseFields: false,
    });
  });

  it("requests verbose fields for verbose text and JSON", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });
    const tool = createPackageSummaryTool(service);

    await tool.handler({ target: "npm:express", verbose: true }, {});
    await tool.handler({ target: "npm:express", format: "json" }, {});

    const calls = packageSummary.mock.calls as unknown as Array<
      [{ includeVerboseFields: boolean }]
    >;
    expect(calls.map(([params]) => params.includeVerboseFields)).toEqual([
      true,
      true,
    ]);
  });

  it("returns compact text in content[0].text by default", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ target: "npm:express" }, {});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("express @ 4.18.2");
    expect(text).toContain("Repository");
    expect(text).toContain("63k stars, 14k forks, 123 issues");
    expect(text).toContain("Vulnerabilities");
    expect(text.replace(/\s+/g, " ")).toContain(
      "Latest: 5 affected Native history: 5 known advisories across all versions",
    );
    expect(text).not.toContain("githits pkg vulns");
    expect(text).not.toContain("Install");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("returns verbose text when verbose=true", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { target: "npm:express", verbose: true },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("GitHub");
    expect(text).toContain("Native advisory history (all versions)");
    expect(text).toContain("Recent changes");
    expect(text).toContain("Versions");
    expect(text).toContain("214 published");
    expect(text).toContain("refreshed 2024-06-15");
    expect(text).not.toContain("Usage");
  });

  it("returns JSON-stringified lean envelope when format=json", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { target: "npm:express", format: "json" },
      {},
    );
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.version).toBe("4.18.2");
    expect(payload.versionCount).toBe(214);
    expect((payload.downloads as Record<string, unknown>).refreshedAt).toBe(
      "2024-06-15",
    );
    expect(payload.advisoryHistory).toMatchObject({ total: 5 });
    expect("install" in payload).toBe(false);
    expect("usage" in payload).toBe(false);
  });

  it("keeps package history evidence in text without an inline action", async () => {
    const summary = structuredClone(defaultPackageSummary);
    summary.security = {
      vulnerabilityCount: 0,
      allVulnerabilityCount: 5,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService({
        packageSummary: mock(() => Promise.resolve(summary)),
      }),
    );

    const result = await tool.handler({ target: "npm:express" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Latest: none affected");
    expect(text).toContain(
      "Native history: 5 known advisories across all versions",
    );
    expect(text).not.toContain("Inspect history");
    expect(text).not.toContain("githits pkg vulns");
  });
});

describe("createPackageSummaryTool — compact target validation", () => {
  it.each([
    [
      "npm:express@5.2.1",
      "pkg_info returns the default selected release; omit @5.2.1.",
    ],
    [
      "npm:@types/node@22.0.0",
      "pkg_info returns the default selected release; omit @22.0.0.",
    ],
  ])(
    "rejects pinned target %s without calling service",
    async (target, error) => {
      const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
      const tool = createPackageSummaryTool(
        createMockPackageIntelligenceService({ packageSummary }),
      );

      const result = await tool.handler({ target, format: "json" }, {});

      expect(result.isError).toBe(true);
      expect(parseText(result)).toEqual({
        error,
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
      expect(packageSummary).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "   ",
    "express",
    "npm:",
    "npm:express@",
    "madeup:express",
    "github:expressjs/express",
    "site:expressjs.com",
  ])(
    "rejects invalid compact target %j without calling service",
    async (target) => {
      const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
      const tool = createPackageSummaryTool(
        createMockPackageIntelligenceService({ packageSummary }),
      );

      const result = await tool.handler({ target, format: "json" }, {});

      expect(result.isError).toBe(true);
      expect(parseText(result)).toMatchObject({
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
      expect(packageSummary).not.toHaveBeenCalled();
    },
  );
});

describe("createPackageSummaryTool — validation errors via shared parsing", () => {
  it("returns INVALID_ARGUMENT envelope for unknown registry", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { target: "foobar:serde", format: "json" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      retryable: boolean;
      error: string;
    };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.retryable).toBe(false);
    expect(payload.error.toLowerCase()).toContain("registry");
  });

  it("returns INVALID_ARGUMENT envelope for a missing package name", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ target: "npm:", format: "json" }, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("returns INVALID_ARGUMENT envelope for whitespace-only target", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ target: "   ", format: "json" }, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });
});

describe("createPackageSummaryTool — service errors", () => {
  it("classifies PackageIntelligenceTargetNotFoundError as NOT_FOUND envelope", async () => {
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createPackageSummaryTool(service);
    const result = await tool.handler(
      { target: "npm:ghost", format: "json" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      error: string;
      retryable: boolean;
    };
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.retryable).toBe(false);
    expect(payload.error).toBe("Package not found");
  });

  it("classifies unexpected Error as UNKNOWN envelope", async () => {
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() => Promise.reject(new Error("boom"))),
    });
    const tool = createPackageSummaryTool(service);
    const result = await tool.handler(
      { target: "npm:express", format: "json" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });

  it("preserves server auth rejection source in MCP envelope", async () => {
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() =>
        Promise.reject(
          new AuthenticationError(
            "GitHits could not accept the authentication token.",
            "server",
          ),
        ),
      ),
    });
    const tool = createPackageSummaryTool(service);
    const result = await tool.handler(
      { target: "npm:express", format: "json" },
      {},
    );

    expect(result.isError).toBe(true);
    expect(parseText(result)).toEqual({
      error: "GitHits could not accept the authentication token.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: {
        authSource: "server",
        action:
          "Re-authenticate with `githits login` or update GITHITS_API_TOKEN if set. If this persists, contact support@githits.com.",
      },
    });
  });
});

for (const mode of ["github", "provenance", "both", "security"] as const) {
  it.each(["text", "verbose", "json"] as const)(
    `retains readable ${mode} partial summary in %s without isError`,
    async (format) => {
      const summary = structuredClone(defaultPackageSummary);
      const facts = {
        code: "RATE_LIMITED" as const,
        retryable: true,
        rateLimitScope: "repository_provider" as const,
        tokenSource: "app" as const,
        retryAfterMs: 1501,
        retryAfterSeconds: 1.501,
        repoUrl: "https://github.com/example/repo",
        gitRef: null,
      };
      if (mode === "github" || mode === "both") {
        delete summary.package.githubRepository;
        summary.package.githubRepositoryError = {
          ...facts,
          message: "GitHub metadata temporarily unavailable (RATE_LIMITED).",
        };
      }
      if (mode === "provenance" || mode === "both") {
        delete summary.package.registryRepository;
        summary.package.registryRepositoryError = {
          ...facts,
          message:
            "Registry provenance and lifecycle warnings temporarily unavailable (RATE_LIMITED).",
        };
      }
      if (mode === "security") {
        delete summary.security!.vulnerabilityCount;
        summary.securityError = {
          ...facts,
          message:
            "Selected-release vulnerability assessment temporarily unavailable (RATE_LIMITED).",
        };
      }
      const packageSummary = mock(async () => summary);
      const tool = createPackageSummaryTool(
        createMockPackageIntelligenceService({ packageSummary }),
      );
      const result = await tool.handler(
        {
          target: "npm:express",
          format: format === "json" ? "json" : "text",
          verbose: format === "verbose",
        },
        {},
      );
      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      if (mode === "security") {
        const payload = format === "json" ? JSON.parse(text) : undefined;
        if (payload) {
          expect(payload.vulnerabilities).toBeUndefined();
          expect(payload.securityError).toEqual(summary.securityError);
          expect(payload.advisoryHistory.total).toBe(5);
        } else expect(text).toContain("Latest: unavailable");
      }

      if (format === "json") {
        expect(JSON.parse(text)).toMatchObject({
          name: "express",
          version: "4.18.2",
          ...(mode === "github" || mode === "both"
            ? { githubError: summary.package.githubRepositoryError }
            : {}),
          ...(mode === "provenance" || mode === "both"
            ? { provenanceError: summary.package.registryRepositoryError }
            : {}),
        });
        expect(JSON.parse(text)).toHaveProperty("downloads");
      } else {
        expect(text).toContain("express @ 4.18.2 | MIT");
        expect(text.replace(/\s+/g, " ")).toContain("Try again in 2 seconds.");
        if (mode === "both")
          expect(text.replace(/\s+/g, " ")).toContain(
            "GitHub metadata, registry provenance and lifecycle warnings temporarily unavailable",
          );
        if (mode === "github")
          expect(text).toContain(
            "GitHub metadata temporarily unavailable (RATE_LIMITED).",
          );
        if (mode === "provenance")
          expect(text.replace(/\s+/g, " ")).toContain(
            "Registry provenance and lifecycle warnings temporarily unavailable (RATE_LIMITED).",
          );
      }
      expect(packageSummary).toHaveBeenCalledTimes(1);
    },
  );
}
