import { describe, expect, it } from "bun:test";
import type { DependencyReport } from "../services/index.js";
import {
  cratesFeatureDependencyReport,
  defaultDependencyReport,
  zeroDepDependencyReport,
} from "../services/test-helpers.js";
import {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
} from "./package-dependencies-response.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("buildPackageDependenciesSuccessPayload — runtime block", () => {
  it("emits runtime block with client-computed count when backend returned direct[]", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
    );
    expect(payload.runtime?.count).toBe(3);
    expect(payload.runtime?.items.length).toBe(3);
    expect(payload.runtime?.count).toBe(payload.runtime?.items.length);
  });

  it("emits runtime block with count:0 when direct[] is empty", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      zeroDepDependencyReport,
    );
    expect(payload.runtime).toEqual({ count: 0, items: [] });
  });

  it("omits runtime block entirely when dependencies is absent", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture);
    expect(payload.runtime).toBeUndefined();
  });

  it("omits runtime block when direct is undefined", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencies: {},
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture);
    expect(payload.runtime).toBeUndefined();
  });
});

describe("buildPackageDependenciesSuccessPayload — groups block", () => {
  it("omits groups block by default even when backend returned dependencyGroups", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
    );
    expect(payload.groups).toBeUndefined();
  });

  it("emits all groups when lifecycle=all was requested", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
      { canonicalLifecycles: ["all"] },
    );
    expect(payload.groups?.items.length).toBe(2);
    expect(payload.groups?.items[0]?.name).toBe("runtime");
    expect(payload.groups?.items[1]?.name).toBe("development");
  });

  it("emits only matching groups when a concrete lifecycle was requested", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
      { canonicalLifecycles: ["development"] },
    );
    expect(payload.groups?.items.map((entry) => entry.lifecycle)).toEqual([
      "development",
    ]);
  });

  it("omits groups block when dependencyGroups is absent", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      zeroDepDependencyReport,
    );
    expect(payload.groups).toBeUndefined();
  });

  it("emits groups.items:[] when backend returned non-null groups with zero items (filter-matched-nothing)", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencyGroups: { groups: [] },
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture, {
      canonicalLifecycles: ["development"],
    });
    expect(payload.groups).toEqual({ items: [] });
  });

  it("sorts groups: runtime first, then development, build, peer, optional (by defaultEnabled desc, name asc within optional)", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencyGroups: {
        groups: [
          {
            name: "zeta",
            lifecycle: "optional",
            conditionType: "feature",
            selectionMode: "additive",
            defaultEnabled: false,
            dependencies: [],
          },
          {
            name: "alpha",
            lifecycle: "optional",
            conditionType: "feature",
            selectionMode: "additive",
            defaultEnabled: true,
            dependencies: [],
          },
          {
            name: "peer",
            lifecycle: "peer",
            conditionType: "always",
            selectionMode: "required",
            dependencies: [],
          },
          {
            name: "dev",
            lifecycle: "development",
            conditionType: "always",
            selectionMode: "required",
            dependencies: [],
          },
          {
            name: "runtime",
            lifecycle: "runtime",
            conditionType: "always",
            selectionMode: "required",
            dependencies: [],
          },
        ],
      },
    };
    const names = buildPackageDependenciesSuccessPayload(fixture, {
      canonicalLifecycles: ["all"],
    }).groups?.items.map((g) => g.name);
    expect(names).toEqual(["runtime", "dev", "peer", "alpha", "zeta"]);
  });

  it("preserves duplicate {name, constraint} entries verbatim (dedup is terminal-only)", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      cratesFeatureDependencyReport,
      { canonicalLifecycles: ["all"] },
    );
    const netGroup = payload.groups?.items.find((g) => g.name === "net");
    expect(netGroup?.items.length).toBe(3); // libc, libc, mio — not deduped
    expect(netGroup?.items.filter((i) => i.name === "libc").length).toBe(2);
  });
});

describe("buildPackageDependenciesSuccessPayload — transitive block", () => {
  it("omits transitive entirely when not requested", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: { totalEdges: 80, uniquePackagesCount: 45 },
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture, {
      includeTransitive: false,
    });
    expect(payload.transitive).toBeUndefined();
  });

  it("emits transitive block with preprocessed `packages[]` (drops graph + uniqueDependencies)", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 80,
        uniquePackagesCount: 45,
        uniqueDependencies: ["accepts@2.0.0", "body-parser@2.2.2"],
        dependencyGraph: {
          formatVersion: 4,
          nodes: [
            { registry: "npm", name: "express", version: "5.2.1" },
            { registry: "npm", name: "accepts", version: "2.0.0" },
            { registry: "npm", name: "body-parser", version: "2.2.2" },
          ],
          edges: [
            {
              fromIndex: 0,
              toIndex: 1,
              constraint: "^2.0.0",
              dependencyType: "runtime",
            },
            {
              fromIndex: 0,
              toIndex: 2,
              constraint: "^2.2.1",
              dependencyType: "runtime",
            },
          ],
        },
      },
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture, {
      includeTransitive: true,
      includeImporters: true,
    });
    expect(payload.transitive?.edges).toBe(80);
    expect(payload.transitive?.uniquePackages).toBe(45);
    expect(payload.transitive?.packages).toEqual([
      {
        name: "accepts",
        version: "2.0.0",
        importers: [
          { name: "express", version: "5.2.1", constraint: "^2.0.0" },
        ],
      },
      {
        name: "body-parser",
        version: "2.2.2",
        importers: [
          { name: "express", version: "5.2.1", constraint: "^2.2.1" },
        ],
      },
    ]);
    // `dependencyGraph` stays on the service-level result for a
    // future `pkg deps-dag` command; this tool's envelope doesn't
    // surface it. `uniqueDependencies` is subsumed by `packages[]`.
    expect(
      (payload.transitive as unknown as Record<string, unknown>)
        .dependencyGraph,
    ).toBeUndefined();
    expect(
      (payload.transitive as unknown as Record<string, unknown>)
        .uniqueDependencies,
    ).toBeUndefined();
  });

  it("omits empty dependencyConflicts / circularDependencyCycles arrays", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 1,
        uniquePackagesCount: 1,
        dependencyConflicts: [],
        circularDependencyCycles: [],
      },
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture, {
      includeTransitive: true,
    });
    expect(payload.transitive?.conflicts).toBeUndefined();
    expect(payload.transitive?.circularDependencies).toBeUndefined();
  });

  it("maps typed conflicts / cycles straight to envelope (no raw passthrough)", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: [],
      transitive: {
        totalEdges: 0,
        uniquePackagesCount: 0,
        dependencyConflicts: [
          {
            packageName: "lodash",
            requiredVersions: ["^4", "^5"],
            conflictingEdges: [],
          },
        ],
        circularDependencyCycles: [
          {
            cycleStart: "a",
            circularPath: ["a", "b", "a"],
            displayChain: "a → b → a",
          },
        ],
      },
    };
    const payload = buildPackageDependenciesSuccessPayload(fixture, {
      includeTransitive: true,
    });
    expect(payload.transitive?.conflicts).toEqual([
      { name: "lodash", requiredVersions: ["^4", "^5"] },
    ]);
    expect(payload.transitive?.circularDependencies).toEqual([
      { cycle: ["a", "b", "a"] },
    ]);
  });
});

describe("buildPackageDependenciesSuccessPayload — filter echo", () => {
  it("omits filter when no canonical lifecycles", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
    );
    expect(payload.filter).toBeUndefined();
  });

  it("emits filter.lifecycles verbatim from canonical list", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
      { canonicalLifecycles: ["runtime", "optional"] },
    );
    expect(payload.filter).toEqual({ lifecycles: ["runtime", "optional"] });
  });
});

describe("buildPackageDependenciesSuccessPayload — version echo", () => {
  it("omits requestedVersion on exact match", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
      { requestedVersion: "5.2.1" },
    );
    expect(payload.requestedVersion).toBeUndefined();
  });

  it("surfaces requestedVersion on any non-empty divergence", () => {
    const payload = buildPackageDependenciesSuccessPayload(
      defaultDependencyReport,
      { requestedVersion: "5.2" },
    );
    expect(payload.requestedVersion).toBe("5.2");
  });
});

describe("formatPackageDependenciesTerminal — runtime view", () => {
  it("renders summary row + direct deps list + hidden-groups mention by name", () => {
    const output = formatPackageDependenciesTerminal(defaultDependencyReport, {
      useColors: false,
    });
    expect(output).toContain("express @ 5.2.1 | npm");
    expect(output).toContain("3 direct runtime dependencies");
    expect(output).toContain("Runtime dependencies:");
    expect(output).toContain("accepts");
    expect(output).toContain("^2.0.0");
    expect(output).toContain(
      "Hidden groups: development - use --lifecycle all.",
    );
  });

  it("renders zero-dep hot path under 3 lines", () => {
    const output = formatPackageDependenciesTerminal(zeroDepDependencyReport, {
      useColors: false,
    });
    const lines = output.trimEnd().split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(output).toContain("No direct runtime dependencies");
  });

  it("pluralises vocabulary correctly for 1 dep", () => {
    const fixture = clone(defaultDependencyReport);
    if (fixture.dependencies?.direct) {
      fixture.dependencies.direct = fixture.dependencies.direct.slice(0, 1);
    }
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
    });
    expect(output).toContain("1 direct runtime dependency");
  });

  it("suppresses hidden-groups hint when only runtime group exists", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencies: { direct: [{ name: "a", versionConstraint: "^1" }] },
      dependencyGroups: {
        groups: [
          {
            name: "runtime",
            lifecycle: "runtime",
            conditionType: "always",
            selectionMode: "required",
            dependencies: [{ name: "a", constraint: "^1" }],
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
    });
    expect(output).not.toContain("hidden - use --lifecycle all");
  });
});

describe("formatPackageDependenciesTerminal — groups view", () => {
  it("renders groups with lifecycle summary header", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).toContain("tokio @ 1.52.1 | crates");
    expect(output).toContain("Dependency groups:");
    expect(output).toContain("3 groups");
    expect(output).toContain("1 runtime, 2 optional");
  });

  it("collapses heading to `name` for always-typed groups", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).toMatch(/^\s+runtime\s*$/m);
  });

  it("renders `name (lifecycle, conditionType)` when conditionValue === name", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).toContain("full (optional, feature)");
    expect(output).toContain("net (optional, feature)");
  });

  it("renders `name (lifecycle, conditionType: conditionValue)` when they diverge", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencyGroups: {
        groups: [
          {
            name: "group-alias",
            lifecycle: "optional",
            conditionType: "feature",
            conditionValue: "the-feature-name",
            selectionMode: "additive",
            defaultEnabled: false,
            dependencies: [{ name: "dep", constraint: "^1" }],
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    expect(output).toContain(
      "group-alias (optional, feature: the-feature-name)",
    );
  });

  it("dedups duplicate {name, constraint} entries in terminal rendering", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        canonicalLifecycles: ["all"],
      },
    );
    const libcLines = output.split("\n").filter((l) => /^\s+libc\b/.test(l));
    expect(libcLines.length).toBe(1);
  });

  it("shows conditionType/selectionMode under --verbose", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        verbose: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).toContain("selectionMode:");
    expect(output).toContain("defaultEnabled:");
  });

  it("renders environmentMarkers block under --verbose when backend provides them", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencyGroups: {
        environmentMarkers: [
          { type: "extra", value: "async", raw: 'extra == "async"' },
          {
            type: "python_version",
            value: ">= 3.8",
            raw: 'python_version >= "3.8"',
          },
        ],
        groups: [
          {
            name: "runtime",
            lifecycle: "runtime",
            conditionType: "always",
            selectionMode: "required",
            dependencies: [{ name: "a", constraint: "^1" }],
          },
        ],
      },
    };
    const verbose = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      verbose: true,
      canonicalLifecycles: ["all"],
    });
    expect(verbose).toContain("environmentMarkers (2):");
    // Typed rendering — type: value per line, no JSON blob.
    expect(verbose).toContain("extra: async");
    expect(verbose).toContain("python_version: >= 3.8");
    expect(verbose).not.toContain('{"type":');

    const nonVerbose = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      verbose: false,
      canonicalLifecycles: ["all"],
    });
    expect(nonVerbose).not.toContain("environmentMarkers");
  });

  it("renders the filter-matched-nothing case with a helpful message", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencyGroups: { groups: [] },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["build"],
    });
    expect(output).toContain(
      "No dependency groups matched lifecycle filter: build.",
    );
  });
});

describe("formatPackageDependenciesTerminal — transitive view", () => {
  it("promotes edges + unique packages + depth into the summary line and flags no-conflicts case", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 80,
        uniquePackagesCount: 45,
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
      maxDepth: 3,
    });
    expect(output).toContain(
      "3 direct runtime dependencies | 80 transitive edges | 45 unique packages (max depth 3)",
    );
    expect(output).toContain("No version conflicts or circular dependencies");
  });

  it("omits depth from summary line when caller did not cap depth (MCP default path)", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 80,
        uniquePackagesCount: 45,
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    expect(output).toContain(
      "3 direct runtime dependencies | 80 transitive edges | 45 unique packages",
    );
    expect(output).not.toContain("depth");
  });

  it("replaces direct list with full transitive list (alphabetical, no truncation)", () => {
    const names = Array.from({ length: 25 }, (_, i) => `pkg-${i + 1}@1.0.0`);
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 25,
        uniquePackagesCount: 25,
        uniqueDependencies: names,
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    // Every transitive entry renders, no truncation hint, no "use -v".
    for (let i = 1; i <= 25; i++) {
      expect(output).toContain(`pkg-${i}@1.0.0`);
    }
    expect(output).not.toContain("use -v");
    expect(output).not.toContain("more");
    // Direct runtime list (accepts, body-parser, cookie) is absent —
    // Transitive output replaces it.
    expect(output).not.toMatch(/^\s\saccepts\s+\^2\.0\.0/m);
  });

  it("sorts transitive list alphabetically regardless of backend order", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 3,
        uniquePackagesCount: 3,
        uniqueDependencies: ["zulu@1.0.0", "alpha@2.0.0", "mike@3.0.0"],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    const depLines = output.split("\n").filter((l) => /^\s\s[a-z]/.test(l));
    expect(depLines.map((l) => l.trim().split(/@/)[0])).toEqual([
      "alpha",
      "mike",
      "zulu",
    ]);
  });

  it("adds multi-line `- constraint required by importer@version` provenance under transitive verbose output", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 3,
        uniquePackagesCount: 3,
        uniqueDependencies: ["accepts@2.0.0", "bytes@3.1.2"],
        dependencyGraph: {
          formatVersion: 4,
          nodes: [
            { registry: "npm", name: "express", version: "5.2.1" },
            { registry: "npm", name: "accepts", version: "2.0.0" },
            { registry: "npm", name: "bytes", version: "3.1.2" },
            { registry: "npm", name: "body-parser", version: "2.2.2" },
          ],
          edges: [
            {
              fromIndex: 0,
              toIndex: 1,
              constraint: "^2.0.0",
              dependencyType: "runtime",
            },
            {
              fromIndex: 0,
              toIndex: 3,
              constraint: "^2.2.1",
              dependencyType: "runtime",
            },
            {
              fromIndex: 3,
              toIndex: 2,
              constraint: "^3.0.0",
              dependencyType: "runtime",
            },
            {
              fromIndex: 0,
              toIndex: 2,
              constraint: "^3.1.0",
              dependencyType: "runtime",
            },
          ],
        },
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
      verbose: true,
    });
    expect(output).toContain("accepts@2.0.0");
    expect(output).toContain("- ^2.0.0 required by express@5.2.1");
    expect(output).toContain("bytes@3.1.2");
    // bytes has two importers with different constraints — one
    // bullet per unique constraint.
    expect(output).toContain("- ^3.0.0 required by body-parser@2.2.2");
    expect(output).toContain("- ^3.1.0 required by express@5.2.1");
  });

  it("collapses multiple importers with the same constraint onto one bullet", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 5,
        uniquePackagesCount: 5,
        uniqueDependencies: ["leaf@1.0.0"],
        dependencyGraph: {
          formatVersion: 4,
          nodes: [
            { registry: "npm", name: "root", version: "1.0.0" },
            { registry: "npm", name: "a", version: "1.0.0" },
            { registry: "npm", name: "b", version: "1.0.0" },
            { registry: "npm", name: "c", version: "1.0.0" },
            { registry: "npm", name: "leaf", version: "1.0.0" },
          ],
          edges: [
            {
              fromIndex: 0,
              toIndex: 1,
              constraint: "^1",
              dependencyType: "runtime",
            },
            {
              fromIndex: 0,
              toIndex: 2,
              constraint: "^1",
              dependencyType: "runtime",
            },
            {
              fromIndex: 0,
              toIndex: 3,
              constraint: "^1",
              dependencyType: "runtime",
            },
            // Three importers all expressing ^1 for leaf — group them.
            {
              fromIndex: 1,
              toIndex: 4,
              constraint: "^1",
              dependencyType: "runtime",
            },
            {
              fromIndex: 2,
              toIndex: 4,
              constraint: "^1",
              dependencyType: "runtime",
            },
            {
              fromIndex: 3,
              toIndex: 4,
              constraint: "^1",
              dependencyType: "runtime",
            },
          ],
        },
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
      verbose: true,
    });
    expect(output).toContain("    - ^1 required by a@1.0.0, b@1.0.0, c@1.0.0");
    // Not 3 separate bullets.
    expect(
      output.split("\n").filter((l) => l.includes("^1 required by")).length,
    ).toBe(1);
  });

  it("summary row combines counts + hidden-groups on one block", () => {
    const output = formatPackageDependenciesTerminal(defaultDependencyReport, {
      useColors: false,
    });
    // Both lines in the header block: count line then hidden-groups line.
    expect(output).toMatch(
      /3 direct runtime dependencies\nHidden groups: development - use --lifecycle all\./,
    );
  });

  it("omits hidden-groups line when lifecycle=all is active (nothing is hidden)", () => {
    const output = formatPackageDependenciesTerminal(defaultDependencyReport, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    expect(output).not.toContain("Hidden groups");
  });

  it("lists hidden groups by name across many lifecycles (no aggregate rollup)", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      { useColors: false },
    );
    // Tokio has one `full` group + one `net` group under optional —
    // both names appear in the hidden-groups line.
    expect(output).toContain("Hidden groups:");
    expect(output).toContain("full");
    expect(output).toContain("net");
  });

  it("groups view replaces the duplicated direct deps list", () => {
    const output = formatPackageDependenciesTerminal(defaultDependencyReport, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    const directIdx = output.indexOf("Runtime dependencies:");
    const groupsHeadingIdx = output.indexOf("2 groups");
    expect(directIdx).toBe(-1);
    expect(groupsHeadingIdx).toBeGreaterThan(0);
    expect(output).toContain("accepts      ^2.0.0");
    expect(output).not.toContain("accepts@2.0.0");
  });

  it("enriches runtime group rows with resolved versions when available", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      ...fixture.dependencies,
      transitive: {
        totalEdges: 3,
        uniquePackagesCount: 3,
        dependencyGraph: {
          formatVersion: 1,
          nodes: [
            { registry: "npm", name: "express", version: "5.2.1" },
            { registry: "npm", name: "accepts", version: "2.0.0" },
            { registry: "npm", name: "body-parser", version: "2.2.1" },
            { registry: "npm", name: "cookie", version: "0.7.1" },
          ],
          edges: [
            { fromIndex: 0, toIndex: 1, constraint: "^2.0.0" },
            { fromIndex: 0, toIndex: 2, constraint: "^2.2.1" },
            { fromIndex: 0, toIndex: 3, constraint: "^0.7.1" },
          ],
        },
      },
    };

    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    expect(output).toContain("accepts@2.0.0  ^2.0.0");
  });

  it("groups block composes beneath transitive list under transitive lifecycle output", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 3,
        uniquePackagesCount: 3,
        uniqueDependencies: ["alpha@1", "beta@2", "gamma@3"],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      includeTransitive: true,
      canonicalLifecycles: ["all"],
    });
    const transitiveIdx = output.indexOf("alpha@1");
    const groupsHeadingIdx = output.indexOf("2 groups");
    expect(transitiveIdx).toBeGreaterThan(0);
    expect(groupsHeadingIdx).toBeGreaterThan(transitiveIdx);
  });

  it("silently omits provenance when the dependency graph isn't fetched", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 1,
        uniquePackagesCount: 1,
        uniqueDependencies: ["accepts@2.0.0"],
        // No dependencyGraph — importers block degrades cleanly.
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
      verbose: true,
    });
    expect(output).toContain("accepts@2.0.0");
    expect(output).not.toContain("required by");
  });

  it("omits the uniqueDependencies block when backend returned none", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 0,
        uniquePackagesCount: 0,
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    expect(output).not.toContain("Unique transitive packages");
    // Still surfaces the no-conflicts acknowledgement.
    expect(output).toContain(
      "No version conflicts or circular dependencies detected.",
    );
  });

  it("surfaces conflict + cycle counts on the summary row when > 0", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 2,
        uniquePackagesCount: 2,
        dependencyConflicts: [
          {
            packageName: "lodash",
            requiredVersions: ["^4", "^5"],
            conflictingEdges: [],
          },
        ],
        circularDependencyCycles: [
          {
            cycleStart: "a",
            circularPath: ["a", "b", "a"],
            displayChain: "a → b → a",
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    expect(output).toMatch(/1 conflict\b/);
    expect(output).toMatch(/1 cycle\b/);
    // Compact mode — counts on summary, no listing, no hint.
    expect(output).not.toContain("Conflicts (1):");
    expect(output).not.toContain("Circular dependencies (1):");
    expect(output).not.toContain("use --verbose");
  });

  it("pluralises conflict/cycle nouns on the summary row", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 5,
        uniquePackagesCount: 5,
        dependencyConflicts: [
          {
            packageName: "a",
            requiredVersions: ["1", "2"],
            conflictingEdges: [],
          },
          {
            packageName: "b",
            requiredVersions: ["1", "2"],
            conflictingEdges: [],
          },
          {
            packageName: "c",
            requiredVersions: ["1", "2"],
            conflictingEdges: [],
          },
        ],
        circularDependencyCycles: [
          { cycleStart: "x", circularPath: ["x"], displayChain: "x" },
          { cycleStart: "y", circularPath: ["y"], displayChain: "y" },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    expect(output).toMatch(/3 conflicts\b/);
    expect(output).toMatch(/2 cycles\b/);
  });

  it("renders typed conflicts with `name: range1, range2, …` under --verbose", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 2,
        uniquePackagesCount: 2,
        dependencyConflicts: [
          {
            packageName: "string-width",
            requiredVersions: [
              "^4.2.3",
              "^4.2.0",
              "^4.1.0",
              "^5.1.2",
              "^5.0.1",
            ],
            conflictingEdges: [],
          },
          {
            packageName: "emoji-regex",
            requiredVersions: ["^8.0.0", "^9.2.2"],
            conflictingEdges: [],
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
      verbose: true,
    });
    expect(output).toContain("Conflicts (2):");
    // Alphabetical by name; ranges sorted.
    expect(output).toMatch(/emoji-regex:\s+\^8\.0\.0, \^9\.2\.2/);
    expect(output).toMatch(
      /string-width:\s+\^4\.1\.0, \^4\.2\.0, \^4\.2\.3, \^5\.0\.1, \^5\.1\.2/,
    );
  });

  it("renders typed circular dependencies as `a -> b -> a` arrow chain under --verbose", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 3,
        uniquePackagesCount: 3,
        circularDependencyCycles: [
          {
            cycleStart: "a",
            circularPath: ["a", "b", "a"],
            displayChain: "a → b → a",
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
      verbose: true,
    });
    expect(output).toContain("Circular dependencies (1):");
    expect(output).toContain("a -> b -> a");
  });

  it("keeps the zero-ack line when neither conflicts nor cycles are present", () => {
    const fixture = clone(defaultDependencyReport);
    fixture.dependencies = {
      direct: fixture.dependencies?.direct,
      transitive: {
        totalEdges: 1,
        uniquePackagesCount: 1,
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      includeTransitive: true,
    });
    expect(output).toContain(
      "No version conflicts or circular dependencies detected.",
    );
    // Summary has no conflict / cycle counts.
    expect(output).not.toMatch(/\bconflicts?\b.*direct runtime/);
  });
});

describe("formatPackageDependenciesTerminal — no-color", () => {
  it("sorts runtime items alphabetically regardless of backend order", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencies: {
        direct: [
          { name: "zeta", versionConstraint: "^1", type: "runtime" },
          { name: "alpha", versionConstraint: "^2", type: "runtime" },
          { name: "mid", versionConstraint: "^3", type: "runtime" },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
    });
    const depLines = output.split("\n").filter((l) => /^\s\s[a-z]/.test(l));
    expect(depLines.map((l) => l.trim().split(/\s+/)[0])).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("sorts group dependencies alphabetically regardless of backend order", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "NPM" },
      dependencyGroups: {
        groups: [
          {
            name: "runtime",
            lifecycle: "runtime",
            conditionType: "always",
            selectionMode: "required",
            dependencies: [
              { name: "zulu", constraint: "^1" },
              { name: "alpha", constraint: "^2" },
              { name: "mike", constraint: "^3" },
            ],
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    const depLines = output.split("\n").filter((l) => /^\s{4}[a-z]/.test(l));
    expect(depLines.map((l) => l.trim().split(/\s+/)[0])).toEqual([
      "alpha",
      "mike",
      "zulu",
    ]);
  });

  it("renames feature → extra in PyPI group headings (ecosystem vocabulary)", () => {
    const fixture: DependencyReport = {
      package: { name: "django", version: "6.0.4", registry: "PYPI" },
      dependencyGroups: {
        groups: [
          {
            name: "argon2",
            lifecycle: "optional",
            conditionType: "feature",
            conditionValue: "argon2",
            selectionMode: "additive",
            defaultEnabled: false,
            dependencies: [{ name: "argon2-cffi", constraint: ">=23.1.0" }],
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    expect(output).toContain("argon2 (optional, extra)");
    expect(output).not.toContain("(optional, feature)");
  });

  it("keeps `feature` vocabulary for Crates packages (Cargo's native term)", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).toContain("(optional, feature)");
    expect(output).not.toContain("(optional, extra)");
  });

  it("suppresses `selectionMode: required` in verbose mode (default-noise reduction)", () => {
    const output = formatPackageDependenciesTerminal(defaultDependencyReport, {
      useColors: false,
      showGroups: true,
      verbose: true,
      canonicalLifecycles: ["all"],
    });
    expect(output).not.toContain("selectionMode: required");
  });

  it("shows `selectionMode: additive` in verbose mode (load-bearing signal)", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        verbose: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).toContain("selectionMode: additive");
  });

  it("collapses group heading when conditionValue differs only in case", () => {
    const fixture: DependencyReport = {
      package: { name: "x", version: "1.0.0", registry: "CRATES" },
      dependencyGroups: {
        groups: [
          {
            name: "full",
            lifecycle: "optional",
            conditionType: "feature",
            conditionValue: "Full",
            selectionMode: "additive",
            defaultEnabled: false,
            dependencies: [{ name: "parking_lot", constraint: "^0.12.0" }],
          },
        ],
      },
    };
    const output = formatPackageDependenciesTerminal(fixture, {
      useColors: false,
      showGroups: true,
      canonicalLifecycles: ["all"],
    });
    expect(output).toContain("full (optional, feature)");
    expect(output).not.toContain("feature: Full");
  });

  it("contains no ANSI escape sequences when useColors is false", () => {
    const output = formatPackageDependenciesTerminal(
      cratesFeatureDependencyReport,
      {
        useColors: false,
        showGroups: true,
        verbose: true,
        canonicalLifecycles: ["all"],
      },
    );
    expect(output).not.toContain("\u001b[");
  });
});
