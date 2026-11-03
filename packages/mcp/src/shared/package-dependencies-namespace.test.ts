import { describe, expect, it } from "bun:test";
import type {
  DependencyBundle,
  DependencyGraph,
  DependencyReport,
  TransitiveDependencySummary,
} from "@githits/core-internal";
import {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
} from "./package-dependencies-response.js";

interface NamespacedReport extends DependencyReport {
  dependencies: DependencyBundle & {
    transitive: TransitiveDependencySummary & {
      dependencyGraph: DependencyGraph;
    };
  };
}

function namespacedReport(): NamespacedReport {
  return {
    package: { registry: "PUB", name: "fixture", version: "1.0.0" },
    dependencies: {
      direct: [],
      transitive: {
        totalEdges: 2,
        uniquePackagesCount: 2,
        uniqueDependencies: ["flutter@0.0.0", "collection@1.0.0"],
        dependencyGraph: {
          formatVersion: 4,
          nodes: [
            { registry: "PUB", name: "fixture", version: "1.0.0" },
            { registry: "FLUTTER_SDK", name: "flutter", version: "0.0.0" },
            { registry: "PUB", name: "collection", version: "1.0.0" },
          ],
          edges: [
            { fromIndex: 0, toIndex: 1, constraint: "any" },
            { fromIndex: 1, toIndex: 2, constraint: "^1.0.0" },
          ],
        },
      },
    },
  };
}

describe("dependency graph namespaces", () => {
  it.each([false, true])(
    "retains node namespaces independently of importer output (%s)",
    (includeImporters) => {
      const payload = buildPackageDependenciesSuccessPayload(
        namespacedReport(),
        {
          includeTransitive: true,
          includeImporters,
        },
      );
      expect(payload.runtime).toEqual({ count: 0, items: [] });
      expect(payload.transitive).toMatchObject({ edges: 2, uniquePackages: 2 });
      expect(payload.transitive?.packages).toEqual([
        {
          registry: "flutter_sdk",
          name: "flutter",
          version: "0.0.0",
          ...(includeImporters
            ? {
                importers: [
                  {
                    registry: "pub",
                    name: "fixture",
                    version: "1.0.0",
                    constraint: "any",
                  },
                ],
              }
            : {}),
        },
        {
          registry: "pub",
          name: "collection",
          version: "1.0.0",
          ...(includeImporters
            ? {
                importers: [
                  {
                    registry: "flutter_sdk",
                    name: "flutter",
                    version: "0.0.0",
                    constraint: "^1.0.0",
                  },
                ],
              }
            : {}),
        },
      ]);
    },
  );

  it.each(["flutter@0.0.1", "flutter"])(
    "does not infer namespace or importer facts for a mismatched identity %s",
    (entry) => {
      const report = namespacedReport();
      report.dependencies.transitive.uniqueDependencies = [entry];
      const payload = buildPackageDependenciesSuccessPayload(report, {
        includeTransitive: true,
        includeImporters: true,
      });
      expect(payload.transitive?.packages).toEqual([
        entry.includes("@")
          ? { name: "flutter", version: "0.0.1" }
          : { name: "flutter" },
      ]);
    },
  );

  it("does not choose between same-name/version nodes in different namespaces", () => {
    const report = namespacedReport();
    report.dependencies.transitive.dependencyGraph.nodes.push({
      registry: "PUB",
      name: "flutter",
      version: "0.0.0",
    });
    const payload = buildPackageDependenciesSuccessPayload(report, {
      includeTransitive: true,
      includeImporters: true,
    });
    expect(payload.transitive?.packages?.[0]).toEqual({
      name: "flutter",
      version: "0.0.0",
    });
  });

  it("retains a namespace for an exact versionless node without adding a version", () => {
    const report = namespacedReport();
    report.dependencies.transitive.uniqueDependencies = ["flutter"];
    report.dependencies.transitive.dependencyGraph.nodes =
      report.dependencies.transitive.dependencyGraph.nodes.map((node) =>
        node.name === "flutter" ? { ...node, version: undefined } : node,
      );
    const payload = buildPackageDependenciesSuccessPayload(report, {
      includeTransitive: true,
    });
    expect(payload.transitive?.packages).toEqual([
      { registry: "flutter_sdk", name: "flutter" },
    ]);
  });

  it("does not invent namespaces when no graph was returned", () => {
    const fixture = namespacedReport();
    const report: DependencyReport = {
      ...fixture,
      dependencies: {
        ...fixture.dependencies,
        transitive: {
          ...fixture.dependencies.transitive,
          dependencyGraph: undefined,
        },
      },
    };
    const payload = buildPackageDependenciesSuccessPayload(report, {
      includeTransitive: true,
      includeImporters: true,
    });
    expect(payload.transitive?.packages).toEqual([
      { name: "flutter", version: "0.0.0" },
      { name: "collection", version: "1.0.0" },
    ]);
  });

  it("keeps source-qualified importers distinct in JSON and text", () => {
    const report = namespacedReport();
    const graph = report.dependencies.transitive.dependencyGraph;
    graph.nodes[0] = { registry: "PUB", name: "bridge", version: "0.0.0" };
    graph.nodes[1] = {
      registry: "FLUTTER_SDK",
      name: "bridge",
      version: "0.0.0",
    };
    graph.edges = [
      { fromIndex: 0, toIndex: 2, constraint: "^1.0.0" },
      { fromIndex: 1, toIndex: 2, constraint: "^1.0.0" },
    ];
    report.dependencies.transitive.uniqueDependencies = ["collection@1.0.0"];
    const payload = buildPackageDependenciesSuccessPayload(report, {
      includeTransitive: true,
      includeImporters: true,
    });
    expect(payload.transitive?.packages?.[0]?.importers).toEqual([
      {
        registry: "flutter_sdk",
        name: "bridge",
        version: "0.0.0",
        constraint: "^1.0.0",
      },
      {
        registry: "pub",
        name: "bridge",
        version: "0.0.0",
        constraint: "^1.0.0",
      },
    ]);
    const text = formatPackageDependenciesTerminal(report, {
      includeTransitive: true,
      verbose: true,
      useColors: false,
    });
    expect(text).toContain("bridge@0.0.0 (flutter_sdk)");
    expect(text).toContain("bridge@0.0.0,");
    expect(text).not.toContain("flutter_sdk:");
  });

  it("qualifies SDK package and importer labels without changing ordinary names", () => {
    const text = formatPackageDependenciesTerminal(namespacedReport(), {
      includeTransitive: true,
      verbose: true,
      useColors: false,
    });
    expect(text).toContain("flutter@0.0.0 (flutter_sdk)");
    expect(text).toContain("- ^1.0.0 required by flutter@0.0.0 (flutter_sdk)");
    expect(text).toContain("collection@1.0.0");
    expect(text).not.toContain("collection@1.0.0 (pub)");
  });

  it("retains SDK namespace in conflict importer labels", () => {
    const report = namespacedReport();
    report.dependencies.transitive.dependencyConflicts = [
      {
        packageName: "collection",
        requiredVersions: ["^1.0.0", "^2.0.0"],
        conflictingEdges: [
          {
            fromIndex: 1,
            toIndex: 2,
            versionConstraint: "^1.0.0",
            dependencyType: "runtime",
          },
          {
            fromIndex: 0,
            toIndex: 2,
            versionConstraint: "^2.0.0",
            dependencyType: "runtime",
          },
        ],
      },
    ];
    const text = formatPackageDependenciesTerminal(report, {
      includeTransitive: true,
      verbose: true,
      useColors: false,
    });
    expect(text.slice(text.indexOf("Conflicts (1):"))).toContain(
      "- ^1.0.0 required by flutter@0.0.0 (flutter_sdk)",
    );
  });
});
