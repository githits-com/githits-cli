import { describe, expect, it } from "bun:test";
import { buildPackageChangelogParams } from "./package-changelog-request.js";

describe("buildPackageChangelogParams — addressing XOR", () => {
  it("accepts spec-only input and produces uppercase registry", () => {
    const { params, explicitFilterFields } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
    });
    expect(params.registry).toBe("NPM");
    expect(params.packageName).toBe("express");
    expect(params.repoUrl).toBeUndefined();
    expect(explicitFilterFields.size).toBe(0);
  });

  it("accepts repo-url-only input and leaves registry/name empty", () => {
    const { params } = buildPackageChangelogParams({
      repoUrl: "https://github.com/expressjs/express",
    });
    expect(params.repoUrl).toBe("https://github.com/expressjs/express");
    expect(params.registry).toBeUndefined();
    expect(params.packageName).toBeUndefined();
  });

  it("treats blank spec fields as absent for repo-url input", () => {
    const { params } = buildPackageChangelogParams({
      registry: " ",
      packageName: "\t",
      repoUrl: "https://github.com/expressjs/express",
    });

    expect(params.repoUrl).toBe("https://github.com/expressjs/express");
    expect(params.registry).toBeUndefined();
    expect(params.packageName).toBeUndefined();
  });

  it("rejects when both spec and repo-url are provided", () => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "npm",
        packageName: "express",
        repoUrl: "https://github.com/expressjs/express",
      }),
    ).toThrow(/not both/);
  });

  it("rejects when neither addressing form is provided", () => {
    expect(() => buildPackageChangelogParams({})).toThrow(/spec/);
  });

  it("rejects a non-URL-shaped repo-url value", () => {
    expect(() => buildPackageChangelogParams({ repoUrl: "not a url" })).toThrow(
      /URL/,
    );
  });

  it("rejects a spec with an unknown registry", () => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "obscure",
        packageName: "example",
      }),
    ).toThrow(/Unsupported registry/);
  });
});

describe("buildPackageChangelogParams — `<spec>@<version>` rejection", () => {
  it("rejects specVersion with a hint redirecting to --to / --from", () => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "npm",
        packageName: "express",
        specVersion: "4.18.0",
      }),
    ).toThrow(/--to|--from/);
  });
});

describe("buildPackageChangelogParams — mode mutual exclusion", () => {
  it("rejects --from + --limit together", () => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "npm",
        packageName: "express",
        fromVersion: "4.0.0",
        limit: 10,
      }),
    ).toThrow(/latest-mode/);
  });

  it("accepts --from alone (range mode)", () => {
    const { params, explicitFilterFields } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      fromVersion: "4.0.0",
    });
    expect(params.fromVersion).toBe("4.0.0");
    expect(params.limit).toBeUndefined();
    expect(explicitFilterFields.has("fromVersion")).toBe(true);
  });

  it("accepts --limit alone (latest mode)", () => {
    const { params, explicitFilterFields } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      limit: 5,
    });
    expect(params.limit).toBe(5);
    expect(explicitFilterFields.has("limit")).toBe(true);
  });

  it("accepts --to in either mode", () => {
    const latest = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      toVersion: "5.0.0",
    });
    expect(latest.params.toVersion).toBe("5.0.0");
    expect(latest.explicitFilterFields.has("toVersion")).toBe(true);

    const range = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      fromVersion: "4.0.0",
      toVersion: "5.0.0",
    });
    expect(range.params.fromVersion).toBe("4.0.0");
    expect(range.params.toVersion).toBe("5.0.0");
  });
});

describe("buildPackageChangelogParams — version validation", () => {
  it("rejects tag-style fromVersion", () => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "npm",
        packageName: "express",
        fromVersion: "v4.18.0",
      }),
    ).toThrow(/git tag/);
  });

  it("rejects tag-style toVersion", () => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "npm",
        packageName: "express",
        toVersion: "V5.0.0",
      }),
    ).toThrow(/git tag/);
  });

  it("allows v-prefixed Swift versions", () => {
    const { params } = buildPackageChangelogParams({
      registry: "swift",
      packageName: "github.com/apple/swift-crypto",
      fromVersion: "v3.10.0",
      toVersion: "v3.11.0",
    });
    expect(params.registry).toBe("SWIFT");
    expect(params.fromVersion).toBe("v3.10.0");
    expect(params.toVersion).toBe("v3.11.0");
  });

  it.each([
    "5.0.0-rc.1",
    "2.32.0.dev0",
    "1.7.0-rc.5",
    "4.0.0-alpha",
    "1.0.0+build.1",
  ])("accepts pre-release / build version '%s' on --from", (version) => {
    const { params } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      fromVersion: version,
    });
    expect(params.fromVersion).toBe(version);
  });
});

describe("buildPackageChangelogParams — limit validation", () => {
  it.each([0, 51, 3.5, -1])("rejects out-of-range limit %s", (limit) => {
    expect(() =>
      buildPackageChangelogParams({
        registry: "npm",
        packageName: "express",
        limit,
      }),
    ).toThrow(/1 and 50/);
  });

  it("accepts limit at boundaries (1 and 50)", () => {
    const low = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      limit: 1,
    });
    expect(low.params.limit).toBe(1);
    const high = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      limit: 50,
    });
    expect(high.params.limit).toBe(50);
  });
});

describe("buildPackageChangelogParams — filter tracking", () => {
  it("tracks gitRef as explicit when set", () => {
    const { explicitFilterFields } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      gitRef: "main",
    });
    expect(explicitFilterFields.has("gitRef")).toBe(true);
  });

  it("treats whitespace-only gitRef as absent", () => {
    const { params, explicitFilterFields } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      gitRef: "   ",
    });
    expect(params.gitRef).toBeUndefined();
    expect(explicitFilterFields.has("gitRef")).toBe(false);
  });

  it("treats whitespace-only fromVersion as absent", () => {
    const { params, explicitFilterFields } = buildPackageChangelogParams({
      registry: "npm",
      packageName: "express",
      fromVersion: "   ",
    });
    expect(params.fromVersion).toBeUndefined();
    expect(explicitFilterFields.has("fromVersion")).toBe(false);
  });
});
