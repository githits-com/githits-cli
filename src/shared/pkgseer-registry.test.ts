import { describe, expect, it } from "bun:test";
import {
  isKnownPkgseerRegistryArg,
  knownPkgseerRegistryArgs,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
  toPkgseerRegistryLowercase,
} from "./pkgseer-registry.js";

describe("toPkgseerRegistry", () => {
  it("maps every lowercase surface value to its uppercase backend enum", () => {
    const cases: Array<[PkgseerRegistryArg, PkgseerRegistry]> = [
      ["npm", "NPM"],
      ["pypi", "PYPI"],
      ["hex", "HEX"],
      ["crates", "CRATES"],
      ["nuget", "NUGET"],
      ["maven", "MAVEN"],
      ["zig", "ZIG"],
      ["vcpkg", "VCPKG"],
      ["packagist", "PACKAGIST"],
      ["rubygems", "RUBYGEMS"],
      ["go", "GO"],
      ["swift", "SWIFT"],
    ];

    for (const [arg, expected] of cases) {
      expect(toPkgseerRegistry(arg)).toBe(expected);
    }
  });
});

describe("toPkgseerRegistryLowercase", () => {
  it("round-trips every uppercase enum back to its lowercase arg", () => {
    for (const arg of knownPkgseerRegistryArgs()) {
      expect(toPkgseerRegistryLowercase(toPkgseerRegistry(arg))).toBe(arg);
    }
  });
});

describe("isKnownPkgseerRegistryArg", () => {
  it("accepts every registered lowercase surface value", () => {
    for (const arg of knownPkgseerRegistryArgs()) {
      expect(isKnownPkgseerRegistryArg(arg)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isKnownPkgseerRegistryArg("NPM")).toBe(false);
    expect(isKnownPkgseerRegistryArg("foobar")).toBe(false);
    expect(isKnownPkgseerRegistryArg("")).toBe(false);
  });
});
