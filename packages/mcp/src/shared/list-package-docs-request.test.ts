import { describe, expect, it } from "bun:test";
import { buildListPackageDocsParams } from "./list-package-docs-request.js";

describe("buildListPackageDocsParams", () => {
  it.each([
    ["1.24.0", "v1.24.0"],
    ["v1.24.0", "v1.24.0"],
    ["0.0.0-20250807184922-2a7a1659af7b", "v0.0.0-20250807184922-2a7a1659af7b"],
    [
      "v0.0.0-20250807184922-2a7a1659af7b",
      "v0.0.0-20250807184922-2a7a1659af7b",
    ],
  ])("canonicalizes Go documentation version %s to %s", (input, expected) => {
    const { params } = buildListPackageDocsParams({
      registry: "go",
      packageName: "golang.org/x/text",
      version: input,
    });

    expect(params.version).toBe(expected);
  });

  it("normalizes Swift GitHub package names to canonical lowercase", () => {
    const { params } = buildListPackageDocsParams({
      registry: "swift",
      packageName: "github.com/yonaskolb/XcodeGen",
    });

    expect(params.registry).toBe("SWIFT");
    expect(params.packageName).toBe("github.com/yonaskolb/xcodegen");
  });

  it("preserves package name case for non-Swift registries", () => {
    const { params } = buildListPackageDocsParams({
      registry: "nuget",
      packageName: "Newtonsoft.Json",
    });

    expect(params.registry).toBe("NUGET");
    expect(params.packageName).toBe("Newtonsoft.Json");
  });

  it("preserves non-Go v-prefixed versions", () => {
    const { params } = buildListPackageDocsParams({
      registry: "npm",
      packageName: "express",
      version: "v5.2.1",
    });

    expect(params.version).toBe("v5.2.1");
  });

  it("preserves non-GitHub Swift package names", () => {
    const { params } = buildListPackageDocsParams({
      registry: "swift",
      packageName: "ExampleOrg/MixedCasePackage",
    });

    expect(params.registry).toBe("SWIFT");
    expect(params.packageName).toBe("ExampleOrg/MixedCasePackage");
  });
});
