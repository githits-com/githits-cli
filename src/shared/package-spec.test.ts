import { describe, expect, it } from "bun:test";
import {
  InvalidPackageSpecError,
  parsePackageSpec,
  UnsupportedRegistryError,
} from "./package-spec.js";

describe("parsePackageSpec", () => {
  it("parses plain package name as npm registry (implicit)", () => {
    expect(parsePackageSpec("express")).toEqual({
      registry: "npm",
      registryExplicit: false,
      name: "express",
    });
  });

  it("parses explicit registry prefix", () => {
    expect(parsePackageSpec("pypi:requests")).toEqual({
      registry: "pypi",
      registryExplicit: true,
      name: "requests",
    });
  });

  it("parses version suffix with @", () => {
    expect(parsePackageSpec("npm:express@4.18.0")).toEqual({
      registry: "npm",
      registryExplicit: true,
      name: "express",
      version: "4.18.0",
    });
  });

  it("parses pypi package with version", () => {
    expect(parsePackageSpec("pypi:requests@2.33.1")).toEqual({
      registry: "pypi",
      registryExplicit: true,
      name: "requests",
      version: "2.33.1",
    });
  });

  it("preserves scoped npm names (leading @ is not a version delimiter)", () => {
    expect(parsePackageSpec("npm:@types/node")).toEqual({
      registry: "npm",
      registryExplicit: true,
      name: "@types/node",
    });
  });

  it("preserves scoped npm name without explicit prefix", () => {
    expect(parsePackageSpec("@types/node")).toEqual({
      registry: "npm",
      registryExplicit: false,
      name: "@types/node",
    });
  });

  it("parses packagist coordinate with slash-separated name", () => {
    expect(parsePackageSpec("packagist:psr/log@1.0.0")).toEqual({
      registry: "packagist",
      registryExplicit: true,
      name: "psr/log",
      version: "1.0.0",
    });
  });

  it("parses rubygems and go registry prefixes", () => {
    expect(parsePackageSpec("rubygems:rails@8.0.2")).toEqual({
      registry: "rubygems",
      registryExplicit: true,
      name: "rails",
      version: "8.0.2",
    });
    expect(parsePackageSpec("go:golang.org/x/text@0.26.0")).toEqual({
      registry: "go",
      registryExplicit: true,
      name: "golang.org/x/text",
      version: "0.26.0",
    });
  });

  it("throws UnsupportedRegistryError when the prefix is unknown", () => {
    expect(() => parsePackageSpec("foobar:baz")).toThrow(
      UnsupportedRegistryError,
    );
    try {
      parsePackageSpec("foobar:baz");
    } catch (err) {
      expect((err as Error).message).toContain("foobar");
      expect((err as Error).message).toContain("npm");
      expect((err as Error).message).toContain("pypi");
    }
  });

  it("throws InvalidPackageSpecError on empty input", () => {
    expect(() => parsePackageSpec("")).toThrow(InvalidPackageSpecError);
    expect(() => parsePackageSpec("   ")).toThrow(InvalidPackageSpecError);
  });

  it("throws InvalidPackageSpecError on trailing @ with no version", () => {
    expect(() => parsePackageSpec("npm:express@")).toThrow(
      InvalidPackageSpecError,
    );
  });

  it("throws InvalidPackageSpecError when registry prefix has no name", () => {
    expect(() => parsePackageSpec("npm:")).toThrow(InvalidPackageSpecError);
  });

  it("classifier can see InvalidPackageSpecError as INVALID_ARGUMENT (name contract)", () => {
    try {
      parsePackageSpec("");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).name).toBe("InvalidPackageSpecError");
    }
  });

  it("classifier can see UnsupportedRegistryError as INVALID_ARGUMENT (name contract)", () => {
    try {
      parsePackageSpec("foobar:baz");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).name).toBe("UnsupportedRegistryError");
    }
  });
});
