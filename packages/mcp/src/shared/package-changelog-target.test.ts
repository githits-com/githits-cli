import { describe, expect, it } from "bun:test";
import { parsePackageChangelogTarget } from "./package-changelog-target.js";

describe("parsePackageChangelogTarget", () => {
  it("parses a bare latest package target", () => {
    expect(parsePackageChangelogTarget("npm:express")).toEqual({
      mode: "latest",
      registry: "npm",
      name: "express",
    });
  });

  it("parses a scoped npm latest target", () => {
    expect(parsePackageChangelogTarget("npm:@types/node")).toEqual({
      mode: "latest",
      registry: "npm",
      name: "@types/node",
    });
  });

  it("parses an exact selected release", () => {
    expect(parsePackageChangelogTarget("npm:express@5.2.1")).toEqual({
      mode: "exact",
      registry: "npm",
      name: "express",
      version: "5.2.1",
    });
  });

  it("parses a scoped npm exact pin", () => {
    expect(parsePackageChangelogTarget("npm:@types/node@22.0.0")).toEqual({
      mode: "exact",
      registry: "npm",
      name: "@types/node",
      version: "22.0.0",
    });
  });

  it("treats a registry-compatible constraint as one selected release", () => {
    expect(parsePackageChangelogTarget("npm:express@^5.0.0")).toEqual({
      mode: "exact",
      registry: "npm",
      name: "express",
      version: "^5.0.0",
    });
  });

  it("parses a closed interval", () => {
    expect(parsePackageChangelogTarget("npm:express@4.21.2..5.2.1")).toEqual({
      mode: "range",
      registry: "npm",
      name: "express",
      fromVersion: "4.21.2",
      toVersion: "5.2.1",
    });
  });

  it("parses a lower-bound interval to latest", () => {
    expect(parsePackageChangelogTarget("npm:express@4.21.2..")).toEqual({
      mode: "range",
      registry: "npm",
      name: "express",
      fromVersion: "4.21.2",
    });
  });

  it("parses an upper-cap as latest mode", () => {
    expect(parsePackageChangelogTarget("npm:express@..5.2.1")).toEqual({
      mode: "latest",
      registry: "npm",
      name: "express",
      toVersion: "5.2.1",
    });
  });

  it("parses representative non-npm registries", () => {
    expect(parsePackageChangelogTarget("pypi:requests@2.32.0")).toMatchObject({
      registry: "pypi",
      name: "requests",
      mode: "exact",
    });
    expect(
      parsePackageChangelogTarget("crates:serde@1.0.0..1.0.210"),
    ).toMatchObject({
      registry: "crates",
      name: "serde",
      mode: "range",
    });
  });

  it("rejects an empty interval", () => {
    expect(() => parsePackageChangelogTarget("npm:express@..")).toThrow(
      /Empty changelog interval/,
    );
  });

  it("rejects more than one interval delimiter", () => {
    expect(() => parsePackageChangelogTarget("npm:express@4..5..6")).toThrow(
      /at most one '\.\.'/,
    );
  });

  it("rejects a three-dot interval", () => {
    expect(() =>
      parsePackageChangelogTarget("npm:express@4.21.2...5.2.1"),
    ).toThrow(/'\.\.\.' is not supported/);
  });

  it("rejects a missing registry prefix", () => {
    expect(() => parsePackageChangelogTarget("express")).toThrow(
      /registry prefix/,
    );
  });

  it("rejects an unsupported registry", () => {
    expect(() => parsePackageChangelogTarget("obscure:example")).toThrow(
      /Unsupported registry/,
    );
  });

  it("rejects repository and site targets before classifying a suffix", () => {
    expect(() =>
      parsePackageChangelogTarget("github:expressjs/express"),
    ).toThrow(/package-only/);
    expect(() =>
      parsePackageChangelogTarget("https://github.com/expressjs/express"),
    ).toThrow(/package-only/);
    expect(() => parsePackageChangelogTarget("site:expressjs.com")).toThrow(
      /package-only/,
    );
  });

  it("rejects empty and whitespace-only input", () => {
    expect(() => parsePackageChangelogTarget("")).toThrow(/cannot be empty/);
    expect(() => parsePackageChangelogTarget("   ")).toThrow(/cannot be empty/);
  });
});
