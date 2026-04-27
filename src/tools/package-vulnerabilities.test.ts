import { describe, expect, it, mock } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultVulnerabilityReport,
} from "../services/test-helpers.js";
import { createPackageVulnerabilitiesTool } from "./package-vulnerabilities.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createPackageVulnerabilitiesTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("pkg_vulns");
    expect(tool.description).toContain("npm, PyPI, Hex, or");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "include_withdrawn",
      "min_severity",
      "package_name",
      "registry",
      "version",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createPackageVulnerabilitiesTool — happy path", () => {
  it("calls service.packageVulnerabilities with normalised params", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const tool = createPackageVulnerabilitiesTool(service);

    await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        version: "4.18.0",
        min_severity: "high",
        include_withdrawn: true,
      },
      {},
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [
        {
          registry: string;
          packageName: string;
          version?: string;
          minSeverity?: number;
          includeWithdrawn?: boolean;
        },
      ]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.version).toBe("4.18.0");
    expect(calls[0]?.[0]?.minSeverity).toBe(7.0);
    expect(calls[0]?.[0]?.includeWithdrawn).toBe(true);
  });

  it("returns JSON-stringified lean envelope on success", async () => {
    const tool = createPackageVulnerabilitiesTool(
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
    expect(payload.version).toBe("4.18.0");
    expect((payload.summary as { total: number }).total).toBe(6);
  });

  it("surfaces requestedVersion when caller passes a real-diff version", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", version: "4.17" },
      {},
    );
    const payload = parseText(result) as { requestedVersion?: string };
    expect(payload.requestedVersion).toBe("4.17");
  });

  it("rejects tag-style versions with INVALID_ARGUMENT", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", version: "v4.18.0" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("without a leading 'v'");
  });
});

describe("createPackageVulnerabilitiesTool — validation errors via in-handler builder", () => {
  it("returns INVALID_ARGUMENT envelope for unsupported registry (vcpkg)", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "vcpkg", package_name: "foo" },
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
    expect(payload.error).toBe(
      "pkg vulns only supports npm, pypi, hex, and crates. Got: vcpkg.",
    );
  });

  it("returns INVALID_ARGUMENT envelope for truly unknown registry", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "cargo", package_name: "serde" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.toLowerCase()).toContain("unsupported registry");
  });

  it("returns INVALID_ARGUMENT envelope for empty package_name", async () => {
    const tool = createPackageVulnerabilitiesTool(
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
});

describe("createPackageVulnerabilitiesTool — service errors", () => {
  it("classifies PackageIntelligenceTargetNotFoundError as NOT_FOUND envelope", async () => {
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createPackageVulnerabilitiesTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "ghost" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("NOT_FOUND");
  });

  it("classifies unexpected Error as UNKNOWN", async () => {
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock(() => Promise.reject(new Error("boom"))),
    });
    const tool = createPackageVulnerabilitiesTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });
});
