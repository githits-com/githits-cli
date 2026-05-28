import { describe, expect, it } from "bun:test";
import { buildListPackageDocsParams } from "./list-package-docs-request.js";

describe("buildListPackageDocsParams", () => {
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

  it("preserves non-GitHub Swift package names", () => {
    const { params } = buildListPackageDocsParams({
      registry: "swift",
      packageName: "ExampleOrg/MixedCasePackage",
    });

    expect(params.registry).toBe("SWIFT");
    expect(params.packageName).toBe("ExampleOrg/MixedCasePackage");
  });
});
