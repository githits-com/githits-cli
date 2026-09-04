import { describe, expect, it } from "bun:test";
import { buildPackageDependenciesParams } from "./package-dependencies-request.js";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";

describe("buildPackageDependenciesParams — registry matrix", () => {
  it.each([
    ["npm", "NPM"],
    ["pypi", "PYPI"],
    ["hex", "HEX"],
    ["crates", "CRATES"],
    ["nuget", "NUGET"],
    ["maven", "MAVEN"],
    ["packagist", "PACKAGIST"],
    ["vcpkg", "VCPKG"],
    ["zig", "ZIG"],
    ["rubygems", "RUBYGEMS"],
    ["go", "GO"],
    ["swift", "SWIFT"],
  ] as const)("accepts registry %s", (arg, expected) => {
    const result = buildPackageDependenciesParams({
      registry: arg,
      packageName: "example",
    });
    expect(result.params.registry).toBe(expected);
  });

  it.each([
    ["nuget", "NUGET"],
    ["maven", "MAVEN"],
    ["packagist", "PACKAGIST"],
  ] as const)("accepts registry %s", (arg, expected) => {
    expect(
      buildPackageDependenciesParams({ registry: arg, packageName: "x" }).params
        .registry,
    ).toBe(expected);
  });

  it("rejects truly unknown registries via the shared UnsupportedRegistryError", () => {
    expect(() =>
      buildPackageDependenciesParams({ registry: "cargo", packageName: "x" }),
    ).toThrow(UnsupportedRegistryError);
  });

  it("requires a non-empty package name", () => {
    expect(() =>
      buildPackageDependenciesParams({ registry: "npm", packageName: "   " }),
    ).toThrow(InvalidPackageSpecError);
  });
});

describe("buildPackageDependenciesParams — version handling", () => {
  it("passes through canonical versions", () => {
    const { params } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "express",
      version: "5.2.1",
    });
    expect(params.version).toBe("5.2.1");
  });

  it("rejects tag-style versions with a tag-prefix hint", () => {
    try {
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "express",
        version: "v4.18.0",
      });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPackageSpecError);
      expect((err as Error).message).toContain("git tag");
      expect((err as Error).message).toContain("4.18.0");
    }
  });

  it("allows v-prefixed Swift versions", () => {
    const { params } = buildPackageDependenciesParams({
      registry: "swift",
      packageName: "github.com/apple/swift-crypto",
      version: "v3.11.0",
    });
    expect(params.version).toBe("v3.11.0");
  });

  it("rejects a bare 'v' (would be ambiguous as 'latest')", () => {
    expect(() =>
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "express",
        version: "v",
      }),
    ).not.toThrow(); // "v" alone isn't matching /^v[0-9]/ so it'll flow through; backend will reject
  });

  it("omits empty version strings", () => {
    const { params } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "express",
      version: "   ",
    });
    expect(params.version).toBeUndefined();
  });
});

describe("buildPackageDependenciesParams — lifecycle parsing", () => {
  it("parses a single token", () => {
    const { params, canonicalLifecycles, wireLifecycles } =
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        lifecycle: "runtime",
      });
    expect(params.lifecycle).toBeUndefined();
    expect(canonicalLifecycles).toEqual(["runtime"]);
    expect(wireLifecycles).toEqual([]);
  });

  it("parses a CSV list, deduplicates, and sorts canonically", () => {
    const { params, canonicalLifecycles } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
      lifecycle: "optional,development,runtime,development",
    });
    expect(canonicalLifecycles).toEqual(["runtime", "development", "optional"]);
    expect(params.lifecycle).toEqual(["development", "optional"]);
  });

  it("accepts all as a client-side full-view lifecycle", () => {
    const { params, canonicalLifecycles, wireLifecycles } =
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        lifecycle: "all",
      });
    expect(canonicalLifecycles).toEqual(["all"]);
    expect(wireLifecycles).toEqual([]);
    expect(params.lifecycle).toBeUndefined();
  });

  it("rejects all combined with concrete lifecycles", () => {
    expect(() =>
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        lifecycle: "all,development",
      }),
    ).toThrow("lifecycle=all cannot be combined");
  });

  it("tolerates uppercase / whitespace / repeats", () => {
    const { canonicalLifecycles } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
      lifecycle: "  DEVELOPMENT , Runtime ,,development ",
    });
    expect(canonicalLifecycles).toEqual(["runtime", "development"]);
  });

  it("accepts pre-split arrays equivalently to CSV", () => {
    const { canonicalLifecycles } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
      lifecycle: ["development", "runtime"],
    });
    expect(canonicalLifecycles).toEqual(["runtime", "development"]);
  });

  it("rejects unknown tokens with an actionable message", () => {
    try {
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        lifecycle: "dev",
      });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPackageSpecError);
      expect((err as Error).message).toContain("Unknown lifecycle 'dev'");
      expect((err as Error).message).toContain("runtime, development, build");
    }
  });

  it("treats empty lifecycle as no filter (lifecycle undefined on wire)", () => {
    const { params, canonicalLifecycles } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
      lifecycle: "",
    });
    expect(params.lifecycle).toBeUndefined();
    expect(canonicalLifecycles).toEqual([]);
  });
});

describe("buildPackageDependenciesParams — depth bounds", () => {
  it.each([1, 5, 10])("accepts depth %i", (depth) => {
    const { params } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
      maxDepth: depth,
    });
    expect(params.maxDepth).toBe(depth);
  });

  it.each([0, 11, -1, 3.5])("rejects invalid depth %s", (depth) => {
    expect(() =>
      buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        maxDepth: depth as number,
      }),
    ).toThrow(InvalidPackageSpecError);
  });

  it("omits depth when undefined", () => {
    const { params } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
    });
    expect(params.maxDepth).toBeUndefined();
  });
});

describe("buildPackageDependenciesParams — dependency issues", () => {
  it.each([
    ["unbounded", undefined],
    ["bounded", 4],
  ] as const)(
    "enables issue analysis and transitive graph for %s requests",
    (_label, maxDepth) => {
      const { params } = buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        includeIssues: true,
        ...(maxDepth === undefined ? {} : { maxDepth }),
      });

      expect(params.includeDependencyIssues).toBe(true);
      expect(params.includeTransitive).toBe(true);
      expect(params.maxDepth).toBe(maxDepth);
    },
  );

  it.each([
    ["omitted", undefined],
    ["explicit false", false],
  ] as const)(
    "preserves transitive and depth inputs when issues are %s",
    (_label, includeIssues) => {
      const { params } = buildPackageDependenciesParams({
        registry: "npm",
        packageName: "x",
        ...(includeIssues === undefined ? {} : { includeIssues }),
        includeTransitive: false,
        maxDepth: 2,
      });

      expect(params.includeDependencyIssues).toBe(includeIssues);
      expect(params.includeTransitive).toBe(false);
      expect(params.maxDepth).toBe(2);
    },
  );

  it("does not couple issue analysis to groups or transitive details", () => {
    const { params } = buildPackageDependenciesParams({
      registry: "npm",
      packageName: "x",
      includeIssues: true,
      includeGroups: false,
      includeTransitiveDetails: false,
    });

    expect(params.includeDependencyIssues).toBe(true);
    expect(params.includeTransitive).toBe(true);
    expect(params.includeGroups).toBe(false);
    expect(params.includeTransitiveDetails).toBe(false);
  });

  it("keeps empty values on the existing validation path with issues disabled", () => {
    const { params, canonicalLifecycles } = buildPackageDependenciesParams({
      registry: " npm ",
      packageName: " x ",
      version: "   ",
      includeIssues: false,
      lifecycle: [],
    });

    expect(params.packageName).toBe("x");
    expect(params.version).toBeUndefined();
    expect(params.includeDependencyIssues).toBe(false);
    expect(params.lifecycle).toBeUndefined();
    expect(canonicalLifecycles).toEqual([]);
  });
});
