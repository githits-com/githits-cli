import { describe, expect, it } from "bun:test";
import { knownPkgseerRegistryArgs } from "@githits/core-internal";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";
import { buildPackageSummaryParams } from "./package-summary-request.js";

describe("buildPackageSummaryParams", () => {
  it("maps lowercase registry to uppercase backend enum", () => {
    const { params } = buildPackageSummaryParams({
      registry: "npm",
      packageName: "express",
    });
    expect(params.registry).toBe("NPM");
    expect(params.packageName).toBe("express");
  });

  it("normalises whitespace on package name", () => {
    const { params } = buildPackageSummaryParams({
      registry: "npm",
      packageName: "  express  ",
    });
    expect(params.packageName).toBe("express");
  });

  it("normalises registry case and whitespace", () => {
    const { params } = buildPackageSummaryParams({
      registry: "  NPM  ",
      packageName: "express",
    });
    expect(params.registry).toBe("NPM");
  });

  it("rejects empty packageName with InvalidPackageSpecError", () => {
    expect(() =>
      buildPackageSummaryParams({ registry: "npm", packageName: "" }),
    ).toThrow(InvalidPackageSpecError);
    expect(() =>
      buildPackageSummaryParams({ registry: "npm", packageName: "   " }),
    ).toThrow(InvalidPackageSpecError);
  });

  it("rejects unknown registry with UnsupportedRegistryError", () => {
    expect(() =>
      buildPackageSummaryParams({ registry: "cargo", packageName: "serde" }),
    ).toThrow(UnsupportedRegistryError);
  });

  it("rejects empty registry", () => {
    expect(() =>
      buildPackageSummaryParams({ registry: "", packageName: "express" }),
    ).toThrow(UnsupportedRegistryError);
  });

  it("accepts every supported registry", () => {
    for (const registry of knownPkgseerRegistryArgs()) {
      expect(() =>
        buildPackageSummaryParams({ registry, packageName: "x" }),
      ).not.toThrow();
    }
  });
});
