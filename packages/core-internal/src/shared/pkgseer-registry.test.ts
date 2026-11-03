import { describe, expect, it } from "bun:test";
import {
  isKnownPkgseerRegistryArg,
  knownPkgseerRegistryArgs,
  PKGSEER_REGISTRY_VALUES,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  parsePkgseerRegistryArg,
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
      ["pub", "PUB"],
    ];

    for (const [arg, expected] of cases) {
      expect(toPkgseerRegistry(arg)).toBe(expected);
    }
  });
});

describe("PKGSEER_REGISTRY_VALUES", () => {
  it("stays coupled to the shared registry map", () => {
    expect([...PKGSEER_REGISTRY_VALUES]).toEqual(
      knownPkgseerRegistryArgs().map(toPkgseerRegistry),
    );
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
  it("admits Pub and round-trips its registry values", () => {
    expect(isKnownPkgseerRegistryArg("pub")).toBe(true);
    expect(knownPkgseerRegistryArgs()).toContain("pub");
    expect(PKGSEER_REGISTRY_VALUES).toContain("PUB");
    expect(toPkgseerRegistry("pub")).toBe("PUB");
    expect(toPkgseerRegistryLowercase("PUB")).toBe("pub");
  });

  it("accepts every registered lowercase surface value", () => {
    for (const arg of knownPkgseerRegistryArgs()) {
      expect(isKnownPkgseerRegistryArg(arg)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isKnownPkgseerRegistryArg("NPM")).toBe(false);
    expect(isKnownPkgseerRegistryArg("foobar")).toBe(false);
    expect(isKnownPkgseerRegistryArg("")).toBe(false);
    expect(isKnownPkgseerRegistryArg("constructor")).toBe(false);
    expect(isKnownPkgseerRegistryArg("__proto__")).toBe(false);
  });
});

describe("parsePkgseerRegistryArg", () => {
  it("preserves every canonical registry spelling", () => {
    for (const arg of knownPkgseerRegistryArgs()) {
      expect(parsePkgseerRegistryArg(arg)).toBe(arg);
    }
  });

  it("normalizes Cargo spellings to the canonical crates registry", () => {
    expect(parsePkgseerRegistryArg("cargo")).toBe("crates");
    expect(parsePkgseerRegistryArg("CARGO")).toBe("crates");
    expect(parsePkgseerRegistryArg("  Cargo  ")).toBe("crates");
  });

  it("rejects unknown and unsafe property-like spellings", () => {
    for (const value of [
      "unknown",
      "golang",
      "swiftpm",
      "",
      "constructor",
      "__proto__",
    ]) {
      expect(parsePkgseerRegistryArg(value)).toBeUndefined();
    }
  });

  it("keeps cargo outside canonical guards and lists", () => {
    expect(isKnownPkgseerRegistryArg("cargo")).toBe(false);
    expect(knownPkgseerRegistryArgs()).not.toContain("cargo");
    expect(PKGSEER_REGISTRY_VALUES.map(String)).not.toContain("CARGO");
  });
});
