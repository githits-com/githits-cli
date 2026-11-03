import { describe, expect, it } from "bun:test";
import {
  buildCodeDiffMcpParams,
  buildCodeDiffParams,
} from "./code-diff-request.js";
import { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";
import { buildGrepParams } from "./grep-request.js";
import { buildListPackageDocsParams } from "./list-package-docs-request.js";
import { buildListParams } from "./list-request.js";
import {
  InvalidPackageSpecError,
  parsePackageSpec,
  UnsupportedRegistryError,
} from "./package-spec.js";
import { buildReadFileParams } from "./read-file-request.js";
import { buildResolveTargetParams } from "./resolve-target-request.js";
import { buildUnifiedSearchParams } from "./unified-search-request.js";
import { parseUnifiedSearchTargetSpec } from "./unified-search-target.js";

// Synthetic native-valid identity: no claim that this release exists upstream.
const target = "pub:Synthetic_Pub@1.2.3+build.7";
const backendTarget = {
  registry: "PUB",
  packageName: "Synthetic_Pub",
  version: "1.2.3+build.7",
} as const;

describe("Pub target admission", () => {
  it("preserves native case and build metadata in the shared package parser", () => {
    expect(parsePackageSpec(target)).toEqual({
      registry: "pub",
      name: "Synthetic_Pub",
      version: "1.2.3+build.7",
      registryExplicit: true,
    });
  });

  it.each(["constructor", "__proto__", "unknown"])(
    "still rejects registry %s",
    (registry) => {
      expect(() => parsePackageSpec(`${registry}:path`)).toThrow(
        UnsupportedRegistryError,
      );
    },
  );

  it.each(["pub:", "pub:path@"])(
    "still rejects malformed target %s",
    (spec) => {
      expect(() => parsePackageSpec(spec)).toThrow(InvalidPackageSpecError);
    },
  );

  it("encodes PUB for code navigation and unified search", () => {
    expect(parseCodeNavigationTargetSpec(target)).toEqual(backendTarget);
    const searchTarget = parseUnifiedSearchTargetSpec(target);
    expect(searchTarget).toEqual(backendTarget);
    expect(
      buildUnifiedSearchParams({ target: searchTarget, query: "join" }).params
        .targets,
    ).toEqual([backendTarget]);
  });

  it("preserves exact Pub source locators in list and grep requests", () => {
    expect(
      buildListParams({ target, paths: ["lib/"], includeDetailedFields: true })
        .target,
    ).toBe(target);
    expect(
      buildGrepParams({
        targets: [{ target }],
        pattern: "join",
        includeDetailedFields: true,
      }).targets[0]?.target,
    ).toBe(target);
    expect(
      buildReadFileParams({
        target: parseCodeNavigationTargetSpec(target),
        filePath: "lib/path.dart",
      }).params.target,
    ).toEqual(backendTarget);
  });

  it("encodes Pub docs requests without renaming native identity", () => {
    expect(
      buildListPackageDocsParams({
        registry: "pub",
        packageName: "Synthetic_Pub",
        version: "1.2.3+build.7",
      }).params,
    ).toEqual(backendTarget);
  });

  it("encodes the Pub resolution filter and keeps canonical targets direct", () => {
    expect(
      buildResolveTargetParams({
        name: "path",
        registry: "pub",
        includeDetailedFields: false,
      }).registries,
    ).toEqual(["PUB"]);
    expect(() =>
      buildResolveTargetParams({
        name: "pub:path",
        includeDetailedFields: false,
      }),
    ).toThrow('Canonical target "pub:path" does not need resolution.');
  });

  it("preserves Pub comparison endpoints on both diff surfaces", () => {
    const cli = buildCodeDiffParams({
      target: "pub:Synthetic_Pub",
      range: "1.2.3+build.7..1.2.4+build.8",
      view: "name-status",
    });
    const mcp = buildCodeDiffMcpParams({
      target: "pub:Synthetic_Pub",
      from: "1.2.3+build.7",
      to: "1.2.4+build.8",
      view: "name-status",
    });
    expect(cli.params).toEqual({
      target: { registry: "PUB", packageName: "Synthetic_Pub" },
      from: "1.2.3+build.7",
      to: "1.2.4+build.8",
      mode: "inventory",
    });
    expect(mcp).toEqual(cli);
  });
});
