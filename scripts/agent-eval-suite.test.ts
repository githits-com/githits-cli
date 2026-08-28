import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_EVAL_SAFETY_CLASSES,
  AGENT_EVAL_SUITE_NAMES,
  type AgentEvalSuiteManifest,
  type AgentEvalSuiteWorkload,
  loadSuiteManifest,
  selectSuiteWorkloads,
  validateSuiteManifest,
} from "./agent-eval-suite.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const BASE_FIXTURE_ENTRIES: AgentEvalSuiteWorkload[] = [
  {
    id: "stable-a",
    path: "eval/agentic/workloads/stable-a.md",
    safety: "stable",
    suites: ["stable-full"],
  },
  {
    id: "stateful-a",
    path: "eval/agentic/workloads/stateful-a.md",
    safety: "stateful",
    suites: ["stateful-manual"],
  },
  {
    id: "experimental-a",
    path: "eval/agentic/workloads/experimental-a.md",
    safety: "experimental",
    suites: ["experimental"],
  },
];

interface SuiteFixture {
  root: string;
  manifestPath: string;
  workloadsDir: string;
  entries: AgentEvalSuiteWorkload[];
}

function createSuiteFixture(
  entries: AgentEvalSuiteWorkload[] = BASE_FIXTURE_ENTRIES,
): SuiteFixture {
  const root = mkdtempSync(join(tmpdir(), "agent-eval-suite-test-"));
  const workloadsDir = join(root, "eval", "agentic", "workloads");
  mkdirSync(workloadsDir, { recursive: true });
  for (const entry of entries) {
    const path = join(root, entry.path);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `# ${entry.id}\n`);
  }
  const manifestPath = join(root, "eval", "agentic", "suites.json");
  writeJson(join(root, "eval", "agentic", "suites.json"), {
    schemaVersion: 1,
    workloads: entries,
  });
  return { root, manifestPath, workloadsDir, entries };
}

function copyEntries(): AgentEvalSuiteWorkload[] {
  return structuredClone(BASE_FIXTURE_ENTRIES);
}

function expectFixtureError(
  entries: AgentEvalSuiteWorkload[],
  expected: string,
  mutate?: (fixture: SuiteFixture) => void,
): void {
  const fixture = createSuiteFixture(entries);
  try {
    mutate?.(fixture);
    expect(() =>
      loadSuiteManifest({
        manifestPath: fixture.manifestPath,
        repoRoot: fixture.root,
        workloadsDir: fixture.workloadsDir,
      }),
    ).toThrow(expected);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("agent eval suites", () => {
  it("loads the checked-in manifest with the exact initial inventory", () => {
    const manifest = loadSuiteManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.workloads).toHaveLength(25);
    expect(
      manifest.workloads.filter((workload) => workload.safety === "stable"),
    ).toHaveLength(21);
    expect(
      manifest.workloads.filter((workload) => workload.safety === "stateful"),
    ).toHaveLength(1);
    expect(
      manifest.workloads.filter(
        (workload) => workload.safety === "experimental",
      ),
    ).toHaveLength(3);

    expect(
      selectSuiteWorkloads(manifest, "canary").map((item) => item.id),
    ).toEqual(["express-router", "package-overview-vulnerabilities"]);
    expect(
      selectSuiteWorkloads(manifest, "smoke").map((item) => item.id),
    ).toEqual([
      "docs-search-followup",
      "express-router",
      "global-example",
      "package-overview-vulnerabilities",
      "package-upgrade-safety",
      "unified-search-investigation",
    ]);
    expect(
      selectSuiteWorkloads(manifest, "stable-full").map((item) => item.id),
    ).toEqual([
      "code-file-navigation",
      "code-files-listing",
      "code-grep-investigation",
      "code-read-window",
      "docs-discovery",
      "docs-search-followup",
      "docs-search-noise",
      "express-router",
      "global-example",
      "opencode-compaction",
      "package-changelog",
      "package-changelog-range",
      "package-dependencies",
      "package-overview-vulnerabilities",
      "package-upgrade-safety",
      "package-vulnerability-filter",
      "package-vulnerability-history",
      "package-vulnerability-rubygems",
      "search-source-ergonomics",
      "site-search-explicit",
      "unified-search-investigation",
    ]);
    expect(
      selectSuiteWorkloads(manifest, "stateful-manual").map((item) => item.id),
    ).toEqual(["githits-onboarding"]);
    expect(
      selectSuiteWorkloads(manifest, "experimental").map((item) => item.id),
    ).toEqual([
      "experimental-code-diff",
      "experimental-resolution-follow-up",
      "experimental-site-resolution-follow-up",
    ]);
    expect(AGENT_EVAL_SUITE_NAMES).toEqual([
      "canary",
      "smoke",
      "stable-full",
      "stateful-manual",
      "experimental",
    ]);
    expect(AGENT_EVAL_SAFETY_CLASSES).toEqual([
      "stable",
      "stateful",
      "experimental",
    ]);
  });

  it("expands suites in deterministic ID and path order", () => {
    const entries = copyEntries();
    entries[0]!.id = "stable-z";
    entries[0]!.path = "eval/agentic/workloads/stable-z.md";
    entries.push({
      id: "stable-a",
      path: "eval/agentic/workloads/stable-a.md",
      safety: "stable",
      suites: ["stable-full"],
    });
    const fixture = createSuiteFixture(entries);
    try {
      const manifest = loadSuiteManifest({
        manifestPath: fixture.manifestPath,
        repoRoot: fixture.root,
        workloadsDir: fixture.workloadsDir,
      });
      expect(
        selectSuiteWorkloads(manifest, "stable-full").map((item) => item.id),
      ).toEqual(["stable-a", "stable-z"]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate IDs and paths", () => {
    const duplicateId = copyEntries();
    duplicateId[1]!.id = duplicateId[0]!.id;
    expectFixtureError(duplicateId, "duplicate workload id");

    const duplicatePath = copyEntries();
    duplicatePath[1]!.path = duplicatePath[0]!.path;
    expectFixtureError(duplicatePath, "duplicate workload path");
  });

  it("rejects unsafe paths, missing files, and unclassified Markdown", () => {
    for (const path of [
      "/tmp/outside.md",
      "../outside.md",
      "eval/agentic/workloads/../outside.md",
      "C:/outside.md",
      "eval\\agentic\\workloads\\outside.md",
    ]) {
      const entries = copyEntries();
      entries[0]!.path = path;
      expectFixtureError(entries, "unsafe workload path");
    }

    const missingManifest = createSuiteFixture();
    try {
      rmSync(missingManifest.manifestPath);
      expect(() =>
        loadSuiteManifest({
          manifestPath: missingManifest.manifestPath,
          repoRoot: missingManifest.root,
          workloadsDir: missingManifest.workloadsDir,
        }),
      ).toThrow("suite manifest not found");
    } finally {
      rmSync(missingManifest.root, { recursive: true, force: true });
    }

    const missing = createSuiteFixture();
    try {
      rmSync(join(missing.root, BASE_FIXTURE_ENTRIES[0]!.path));
      expect(() =>
        loadSuiteManifest({
          manifestPath: missing.manifestPath,
          repoRoot: missing.root,
          workloadsDir: missing.workloadsDir,
        }),
      ).toThrow("manifest workload path is not a discovered workload");
    } finally {
      rmSync(missing.root, { recursive: true, force: true });
    }

    const unclassified = createSuiteFixture();
    try {
      writeFileSync(
        join(unclassified.workloadsDir, "new-workload.md"),
        "# new\n",
      );
      expect(() =>
        loadSuiteManifest({
          manifestPath: unclassified.manifestPath,
          repoRoot: unclassified.root,
          workloadsDir: unclassified.workloadsDir,
        }),
      ).toThrow("discovered workload is unclassified");
      writeFileSync(
        join(unclassified.workloadsDir, "REPORTING.md"),
        "# report\n",
      );
      rmSync(join(unclassified.workloadsDir, "new-workload.md"));
      expect(() =>
        loadSuiteManifest({
          manifestPath: unclassified.manifestPath,
          repoRoot: unclassified.root,
          workloadsDir: unclassified.workloadsDir,
        }),
      ).not.toThrow();
    } finally {
      rmSync(unclassified.root, { recursive: true, force: true });
    }
  });

  it("rejects manifest paths that are not discovered workload Markdown", () => {
    const entries = copyEntries();
    entries[0]!.path = "eval/agentic/not-a-workload.md";
    expectFixtureError(
      entries,
      "manifest workload path is not a discovered workload",
      (fixture) => {
        writeFileSync(join(fixture.root, entries[0]!.path), "# outside\n");
      },
    );
  });

  it("rejects unknown suite names and safety classes", () => {
    const unknownSuite = copyEntries();
    const unknownSuiteEntry = unknownSuite[0] as unknown as Record<
      string,
      unknown
    >;
    unknownSuiteEntry.suites = ["nightly"];
    expectFixtureError(unknownSuite, "Invalid suite manifest");

    const unknownSafety = copyEntries();
    const unknownSafetyEntry = unknownSafety[0] as unknown as Record<
      string,
      unknown
    >;
    unknownSafetyEntry.safety = "unsafe";
    expectFixtureError(unknownSafety, "Invalid suite manifest");
  });

  it("rejects suite nesting and safety membership violations", () => {
    const canaryOutsideSmoke = copyEntries();
    canaryOutsideSmoke[0]!.suites = ["canary", "stable-full"];
    expectFixtureError(
      canaryOutsideSmoke,
      "suite canary must be a subset of smoke",
    );

    const smokeOutsideFull = copyEntries();
    smokeOutsideFull[0]!.suites = ["smoke"];
    expectFixtureError(
      smokeOutsideFull,
      "suite smoke must be a subset of stable-full",
    );

    const nonStableInStable = copyEntries();
    nonStableInStable[1]!.suites = ["stable-full"];
    expectFixtureError(
      nonStableInStable,
      "non-stable workload in stable suite",
    );

    const statefulOutsideManual = copyEntries();
    statefulOutsideManual[1]!.suites = ["stateful-manual", "experimental"];
    expectFixtureError(
      statefulOutsideManual,
      "stateful workload must be in only stateful-manual",
    );

    const experimentalOutsideExperimental = copyEntries();
    experimentalOutsideExperimental[2]!.suites = [
      "experimental",
      "stateful-manual",
    ];
    expectFixtureError(
      experimentalOutsideExperimental,
      "experimental workload must be in only experimental",
    );

    const stableMissingFull = copyEntries();
    stableMissingFull[0]!.suites = ["experimental"];
    expectFixtureError(
      stableMissingFull,
      "stable workload missing stable-full membership",
    );
  });

  it("validates parsed manifests against an explicit fixture root", () => {
    const fixture = createSuiteFixture();
    try {
      const value = {
        schemaVersion: 1,
        workloads: fixture.entries,
      } satisfies AgentEvalSuiteManifest;
      expect(
        validateSuiteManifest(value, {
          repoRoot: fixture.root,
          workloadsDir: fixture.workloadsDir,
        }),
      ).toEqual(value);
      expect(existsSync(fixture.manifestPath)).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
