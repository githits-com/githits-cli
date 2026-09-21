import { describe, expect, it } from "bun:test";
import { buildPackageChangelogParams } from "./package-changelog-request.js";

describe("buildPackageChangelogParams — package-only targets", () => {
  it("accepts a bare latest target and produces uppercase registry", () => {
    const { params, mode, explicitFilterFields } = buildPackageChangelogParams({
      target: "npm:express",
    });
    expect(mode).toBe("latest");
    expect(params.registry).toBe("NPM");
    expect(params.packageName).toBe("express");
    expect(params.version).toBeUndefined();
    expect(params.fromVersion).toBeUndefined();
    expect(explicitFilterFields.size).toBe(0);
  });

  it("accepts an exact selected release", () => {
    const { params, mode, explicitFilterFields } = buildPackageChangelogParams({
      target: "npm:express@5.2.1",
    });
    expect(mode).toBe("exact");
    expect(params.version).toBe("5.2.1");
    expect(params.fromVersion).toBeUndefined();
    expect(params.toVersion).toBeUndefined();
    expect(params.limit).toBeUndefined();
    expect(explicitFilterFields.has("version")).toBe(true);
  });

  it("accepts a registry-compatible constraint as exact", () => {
    const { params, mode } = buildPackageChangelogParams({
      target: "npm:express@^5.0.0",
    });
    expect(mode).toBe("exact");
    expect(params.version).toBe("^5.0.0");
  });

  it("accepts a closed interval as range", () => {
    const { params, mode, explicitFilterFields } = buildPackageChangelogParams({
      target: "npm:express@4.21.2..5.2.1",
    });
    expect(mode).toBe("range");
    expect(params.fromVersion).toBe("4.21.2");
    expect(params.toVersion).toBe("5.2.1");
    expect(explicitFilterFields.has("fromVersion")).toBe(true);
    expect(explicitFilterFields.has("toVersion")).toBe(true);
  });

  it("accepts a lower-open interval as range to latest", () => {
    const { params, mode } = buildPackageChangelogParams({
      target: "npm:express@4.21.2..",
    });
    expect(mode).toBe("range");
    expect(params.fromVersion).toBe("4.21.2");
    expect(params.toVersion).toBeUndefined();
  });

  it("accepts an upper-cap target as latest", () => {
    const { params, mode, explicitFilterFields } = buildPackageChangelogParams({
      target: "npm:express@..5.2.1",
    });
    expect(mode).toBe("latest");
    expect(params.toVersion).toBe("5.2.1");
    expect(explicitFilterFields.has("toVersion")).toBe(true);
  });

  it("rejects a missing target", () => {
    expect(() => buildPackageChangelogParams({})).toThrow(/package spec/);
  });

  it("rejects repository and site targets without producing params", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "github:expressjs/express",
      }),
    ).toThrow(/package-only/);
    expect(() =>
      buildPackageChangelogParams({
        target: "https://github.com/expressjs/express",
      }),
    ).toThrow(/package-only/);
  });
});

describe("buildPackageChangelogParams — CLI flag adaptation", () => {
  it("accepts flag-only --from / --to on a bare target", () => {
    const { params, mode } = buildPackageChangelogParams({
      target: "npm:express",
      fromVersion: "4.21.2",
      toVersion: "5.2.1",
    });
    expect(mode).toBe("range");
    expect(params.fromVersion).toBe("4.21.2");
    expect(params.toVersion).toBe("5.2.1");
  });

  it("accepts --to as a latest-mode cap on a bare target", () => {
    const { params, mode } = buildPackageChangelogParams({
      target: "npm:express",
      toVersion: "5.2.1",
      limit: 5,
    });
    expect(mode).toBe("latest");
    expect(params.toVersion).toBe("5.2.1");
    expect(params.limit).toBe(5);
  });

  it("accepts --limit on an upper-cap target", () => {
    const { params, mode } = buildPackageChangelogParams({
      target: "npm:express@..5.2.1",
      limit: 3,
    });
    expect(mode).toBe("latest");
    expect(params.limit).toBe(3);
  });

  it("rejects --from on an exact target", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@5.2.1",
        fromVersion: "4.0.0",
      }),
    ).toThrow(/single-release/);
  });

  it("rejects --to on an exact target", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@5.2.1",
        toVersion: "5.3.0",
      }),
    ).toThrow(/single-release/);
  });

  it("rejects --limit on an exact target", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@5.2.1",
        limit: 5,
      }),
    ).toThrow(/drop `limit`/);
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@5.2.1",
        limit: 5,
      }),
    ).not.toThrow(/--from/);
  });

  it("rejects duplicate --from against an inline from bound", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@4.21.2..5.2.1",
        fromVersion: "4.0.0",
      }),
    ).toThrow(/already contains a from version/);
  });

  it("rejects duplicate --to against an inline to bound", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@4.21.2..5.2.1",
        toVersion: "5.3.0",
      }),
    ).toThrow(/already contains a to version/);
  });

  it("rejects --limit with a lower-bound interval", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@4.21.2..",
        limit: 10,
      }),
    ).toThrow(/latest-mode/);
  });

  it("rejects --from + --limit together", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express",
        fromVersion: "4.0.0",
        limit: 10,
      }),
    ).toThrow(/latest-mode/);
  });
});

describe("buildPackageChangelogParams — version validation", () => {
  it("rejects tag-style fromVersion flags", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express",
        fromVersion: "v4.18.0",
      }),
    ).toThrow(/--from/);
  });

  it("rejects tag-style exact versions", () => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express@v5.2.1",
      }),
    ).toThrow(/git tag/);
  });

  it("allows v-prefixed Swift versions", () => {
    const { params } = buildPackageChangelogParams({
      target: "swift:github.com/apple/swift-crypto@v3.10.0..v3.11.0",
    });
    expect(params.registry).toBe("SWIFT");
    expect(params.fromVersion).toBe("v3.10.0");
    expect(params.toVersion).toBe("v3.11.0");
  });

  it("sends canonical Go range bounds to the backend", () => {
    const { params } = buildPackageChangelogParams({
      target: "go:golang.org/x/text@0.27.0..v0.28.0",
    });
    expect(params.fromVersion).toBe("v0.27.0");
    expect(params.toVersion).toBe("v0.28.0");
  });

  it("canonicalises Go exact pins", () => {
    const { params } = buildPackageChangelogParams({
      target: "go:golang.org/x/text@0.28.0",
    });
    expect(params.version).toBe("v0.28.0");
  });

  it.each([
    "5.0.0-rc.1",
    "2.32.0.dev0",
    "1.7.0-rc.5",
    "4.0.0-alpha",
    "1.0.0+build.1",
  ])("accepts pre-release / build version '%s' as exact", (version) => {
    const { params } = buildPackageChangelogParams({
      target: `npm:express@${version}`,
    });
    expect(params.version).toBe(version);
  });

  it("treats whitespace-only fromVersion as absent", () => {
    const { params, explicitFilterFields } = buildPackageChangelogParams({
      target: "npm:express",
      fromVersion: "   ",
    });
    expect(params.fromVersion).toBeUndefined();
    expect(explicitFilterFields.has("fromVersion")).toBe(false);
  });
});

describe("buildPackageChangelogParams — limit validation", () => {
  it.each([0, 51, 3.5, -1])("rejects out-of-range limit %s", (limit) => {
    expect(() =>
      buildPackageChangelogParams({
        target: "npm:express",
        limit,
      }),
    ).toThrow(/1 and 50/);
  });

  it("accepts limit at boundaries (1 and 50)", () => {
    const low = buildPackageChangelogParams({
      target: "npm:express",
      limit: 1,
    });
    expect(low.params.limit).toBe(1);
    const high = buildPackageChangelogParams({
      target: "npm:express",
      limit: 50,
    });
    expect(high.params.limit).toBe(50);
  });
});
