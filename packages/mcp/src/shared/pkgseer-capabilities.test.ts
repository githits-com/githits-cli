import { describe, expect, it } from "bun:test";
import { PKGSEER_REGISTRY_ARGS } from "@githits/core-internal";
import {
  SUPPORTED_DEPS_REGISTRIES_LIST,
  SUPPORTED_DEPS_REGISTRY_ARGS,
  SUPPORTED_VULN_REGISTRIES,
  SUPPORTED_VULN_REGISTRIES_HUMAN,
  SUPPORTED_VULN_REGISTRIES_LIST,
  SUPPORTED_VULN_REGISTRY_ARGS,
  supportsVulnerabilitiesRegistry,
} from "./pkgseer-capabilities.js";

describe("pkgseer capability matrices", () => {
  it("lists every known dependency registry in canonical order", () => {
    expect(SUPPORTED_DEPS_REGISTRY_ARGS).toEqual(PKGSEER_REGISTRY_ARGS);
    expect(SUPPORTED_DEPS_REGISTRIES_LIST).toBe(
      PKGSEER_REGISTRY_ARGS.join(", "),
    );
  });

  it("supports only the deployed vulnerability registry set", () => {
    expect(SUPPORTED_VULN_REGISTRY_ARGS).toEqual([
      "npm",
      "pypi",
      "hex",
      "crates",
      "nuget",
      "maven",
      "packagist",
      "rubygems",
      "go",
      "swift",
    ]);
    expect(SUPPORTED_VULN_REGISTRIES_LIST).toBe(
      "npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, swift",
    );
    expect(SUPPORTED_VULN_REGISTRIES_HUMAN).toBe(
      "npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift",
    );
    expect([...SUPPORTED_VULN_REGISTRIES]).toEqual([
      "NPM",
      "PYPI",
      "HEX",
      "CRATES",
      "NUGET",
      "MAVEN",
      "PACKAGIST",
      "RUBYGEMS",
      "GO",
      "SWIFT",
    ]);

    for (const registry of SUPPORTED_VULN_REGISTRIES) {
      expect(supportsVulnerabilitiesRegistry(registry)).toBe(true);
    }
    expect(supportsVulnerabilitiesRegistry("VCPKG")).toBe(false);
    expect(supportsVulnerabilitiesRegistry("ZIG")).toBe(false);
  });
});
