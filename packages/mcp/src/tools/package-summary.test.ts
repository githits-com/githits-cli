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
    expect(tool.description).toContain(
      "Assess latest package health and adoption",
    );
    expect(tool.description).toContain("for example `npm` + `express`");
    expect(tool.description).toContain("[ARCHIVED]");
    expect(tool.description).toContain("verbose: true");
    expect(tool.description).toContain("pkg_vulns");
    expect(Object.keys(tool.schema)).toEqual([
      "registry",
      "package_name",
      "verbose",
      "format",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createPackageSummaryTool — happy path", () => {
  it("calls service.packageSummary with normalised params (uppercase registry)", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });
    const tool = createPackageSummaryTool(service);

    await tool.handler({ registry: "npm", package_name: "express" }, {});

    expect(packageSummary).toHaveBeenCalledTimes(1);
    const calls = packageSummary.mock.calls as unknown as Array<
      [{ registry: string; packageName: string }]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
  });

  it("returns compact text in content[0].text by default", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("express @ 4.18.2");
    expect(text).toContain("Repository");
    expect(text).toContain("63k stars, 14k forks, 123 issues");
    expect(text).toContain("Vulnerabilities");
    expect(text).not.toContain("Install");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("returns verbose text when verbose=true", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", verbose: true },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("GitHub");
    expect(text).toContain("Recent advisories");
    expect(text).toContain("Recent changes");
    expect(text).not.toContain("Usage");
  });

  it("returns JSON-stringified lean envelope when format=json", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.version).toBe("4.18.2");
    expect("install" in payload).toBe(false);
    expect("usage" in payload).toBe(false);
  });
});

describe("createPackageSummaryTool — validation errors via in-handler builder", () => {
  it("returns INVALID_ARGUMENT envelope for unknown registry", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "cargo", package_name: "serde" },
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

  it("returns INVALID_ARGUMENT envelope for empty package_name", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("returns INVALID_ARGUMENT envelope for whitespace-only package_name", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "   " },
      {},
    );
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
      { registry: "npm", package_name: "ghost" },
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
      { registry: "npm", package_name: "express" },
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
      { registry: "npm", package_name: "express", format: "json" },
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
