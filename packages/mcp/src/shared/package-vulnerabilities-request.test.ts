import { describe, expect, it } from "bun:test";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";
import {
  buildPackageVulnerabilitiesParams,
  SEVERITY_LABEL_TO_CVSS,
  supportsVulnerabilitiesRegistry,
  UnsupportedVulnerabilitiesRegistryError,
} from "./package-vulnerabilities-request.js";

describe("buildPackageVulnerabilitiesParams", () => {
  it("maps lowercase registry to uppercase backend enum", () => {
    const { params } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
    });
    expect(params.registry).toBe("NPM");
    expect(params.packageName).toBe("express");
  });

  it("trims whitespace on packageName and version", () => {
    const { params } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "  express  ",
      version: "  4.18.0  ",
    });
    expect(params.packageName).toBe("express");
    expect(params.version).toBe("4.18.0");
  });

  it("passes version through when supplied", () => {
    const { params } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
      version: "4.18.0",
    });
    expect(params.version).toBe("4.18.0");
  });

  it("rejects tag-style versions with a leading v", () => {
    expect(() =>
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        version: "v4.18.0",
      }),
    ).toThrow(InvalidPackageSpecError);
  });

  it("allows v-prefixed Swift versions", () => {
    const { params } = buildPackageVulnerabilitiesParams({
      registry: "swift",
      packageName: "github.com/apple/swift-crypto",
      version: "v3.11.0",
    });
    expect(params.registry).toBe("SWIFT");
    expect(params.version).toBe("v3.11.0");
  });

  it("omits version when not supplied", () => {
    const { params } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
    });
    expect(params.version).toBeUndefined();
  });

  it("maps severity labels to CVSS floats (lowercase)", () => {
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "low",
      }).params.minSeverity,
    ).toBe(0.1);
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "medium",
      }).params.minSeverity,
    ).toBe(4.0);
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "high",
      }).params.minSeverity,
    ).toBe(7.0);
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "critical",
      }).params.minSeverity,
    ).toBe(9.0);
  });

  it("tolerates uppercase severity input", () => {
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "CRITICAL",
      }).params.minSeverity,
    ).toBe(9.0);
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "  High  ",
      }).params.minSeverity,
    ).toBe(7.0);
  });

  it("returns explicit filter metadata with canonical severity labels", () => {
    const { filter } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
      minSeverity: "  High  ",
      includeWithdrawn: true,
    });
    expect(filter).toEqual({ minSeverity: "high", includeWithdrawn: true });
  });

  it("maps advisory scope to backend enum and echoes non-default scope", () => {
    const { params, filter } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
      advisoryScope: "non-affecting",
    });
    expect(params.advisoryScope).toBe("NON_AFFECTING");
    expect(filter).toEqual({ advisoryScope: "non_affecting" });

    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        advisoryScope: "all",
      }).params.advisoryScope,
    ).toBe("ALL");
  });

  it("does not echo default affected advisory scope", () => {
    const { params, filter } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
      advisoryScope: "affected",
    });
    expect(params.advisoryScope).toBe("AFFECTED");
    expect(filter).toBeUndefined();
  });

  it("does not echo omitted or false filters", () => {
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
      }).filter,
    ).toBeUndefined();
    expect(
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        includeWithdrawn: false,
      }).filter,
    ).toBeUndefined();
  });

  it("rejects unknown severity labels", () => {
    expect(() =>
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        minSeverity: "severe",
      }),
    ).toThrow(InvalidPackageSpecError);
  });

  it("rejects unknown advisory scopes", () => {
    expect(() =>
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "express",
        advisoryScope: "historic",
      }),
    ).toThrow(InvalidPackageSpecError);
  });

  it("passes includeWithdrawn through", () => {
    const { params } = buildPackageVulnerabilitiesParams({
      registry: "npm",
      packageName: "express",
      includeWithdrawn: true,
    });
    expect(params.includeWithdrawn).toBe(true);
  });

  it("rejects empty packageName", () => {
    expect(() =>
      buildPackageVulnerabilitiesParams({ registry: "npm", packageName: "" }),
    ).toThrow(InvalidPackageSpecError);
    expect(() =>
      buildPackageVulnerabilitiesParams({
        registry: "npm",
        packageName: "   ",
      }),
    ).toThrow(InvalidPackageSpecError);
  });

  it("rejects totally unknown registries with generic message", () => {
    try {
      buildPackageVulnerabilitiesParams({
        registry: "cargo",
        packageName: "serde",
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedRegistryError);
      expect((error as Error).message).toContain("Unsupported registry");
    }
  });

  it("rejects known-but-unsupported registries with tool-specific message", () => {
    const unsupported = ["vcpkg", "zig"];
    for (const registry of unsupported) {
      try {
        buildPackageVulnerabilitiesParams({
          registry,
          packageName: "x",
        });
        throw new Error(`expected throw for ${registry}`);
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedVulnerabilitiesRegistryError);
        expect((error as Error).message).toBe(
          `pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift. Got: ${registry}.`,
        );
      }
    }
  });

  it("accepts all supported registries", () => {
    const supported = [
      "npm",
      "pypi",
      "hex",
      "crates",
      "nuget",
      "maven",
      "packagist",
      "rubygems",
      "go",
      "swift",
    ];
    for (const registry of supported) {
      expect(() =>
        buildPackageVulnerabilitiesParams({
          registry,
          packageName: "x",
        }),
      ).not.toThrow();
    }
  });
});

describe("supportsVulnerabilitiesRegistry", () => {
  it("accepts the supported registries", () => {
    expect(supportsVulnerabilitiesRegistry("NPM")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("PYPI")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("HEX")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("CRATES")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("NUGET")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("MAVEN")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("PACKAGIST")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("RUBYGEMS")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("GO")).toBe(true);
    expect(supportsVulnerabilitiesRegistry("SWIFT")).toBe(true);
  });

  it("rejects the unsupported registries", () => {
    expect(supportsVulnerabilitiesRegistry("ZIG")).toBe(false);
    expect(supportsVulnerabilitiesRegistry("VCPKG")).toBe(false);
  });
});

describe("SEVERITY_LABEL_TO_CVSS", () => {
  it("covers the four severity labels with CVSS thresholds", () => {
    expect(SEVERITY_LABEL_TO_CVSS.low).toBe(0.1);
    expect(SEVERITY_LABEL_TO_CVSS.medium).toBe(4.0);
    expect(SEVERITY_LABEL_TO_CVSS.high).toBe(7.0);
    expect(SEVERITY_LABEL_TO_CVSS.critical).toBe(9.0);
  });
});
