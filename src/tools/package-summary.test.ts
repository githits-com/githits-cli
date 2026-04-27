import { describe, expect, it, mock } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "../services/index.js";
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
    expect(tool.description).toContain("package overview");
    expect(Object.keys(tool.schema)).toEqual(["registry", "package_name"]);
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

  it("returns JSON-stringified lean envelope in content[0].text on success", async () => {
    const tool = createPackageSummaryTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.version).toBe("4.18.2");
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
});
