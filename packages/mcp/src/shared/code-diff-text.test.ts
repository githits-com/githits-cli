import { describe, expect, it } from "bun:test";
import type { LeanCodeDiffEnvelope } from "./code-diff-response.js";
import { formatCodeDiffTerminal } from "./code-diff-text.js";

function envelope(
  overrides: Partial<LeanCodeDiffEnvelope> = {},
): LeanCodeDiffEnvelope {
  return {
    target: { kind: "package", registry: "npm", name: "example" },
    view: "patch",
    from: {
      requested: "1.0.0",
      resolvedVersion: "1.0.0",
      ref: "v1.0.0",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      refKind: "tag",
      versionSource: "registry",
    },
    to: {
      requested: "2.0.0",
      resolvedVersion: "2.0.0",
      ref: "v2.0.0",
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      refKind: "tag",
      versionSource: "registry",
    },
    summary: {
      filesChanged: 2,
      added: 1,
      deleted: 0,
      modified: 1,
      modeChanged: 0,
      typeChanged: 0,
      inventoryComplete: true,
      unprojectableFiles: 0,
    },
    scope: { status: "package", fromSubpath: "", toSubpath: "" },
    contentCoverage: "complete",
    files: [],
    hasMoreFiles: false,
    ...overrides,
  };
}

const options = { useColors: false } as const;

describe("formatCodeDiffTerminal", () => {
  it("renders name-only with reversible Git quoting", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "name-only",
        contentCoverage: "not_requested",
        files: [
          { path: "src/a.ts", pathEncoding: "utf8" },
          { path: "bad\u001b[31m.ts", pathEncoding: "utf8" },
          { path: "line\u2028separator.ts", pathEncoding: "utf8" },
        ],
      }),
      options,
    );

    expect(result).toEqual({
      stdout:
        'src/a.ts\n"bad\\033[31m.ts"\n"line\\342\\200\\250separator.ts"\n',
      stderr: undefined,
    });
  });

  it("renders name-status with Git status letters", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "name-status",
        contentCoverage: "not_requested",
        files: [
          { path: "a.ts", pathEncoding: "utf8", status: "added" },
          { path: "d.ts", pathEncoding: "utf8", status: "deleted" },
          { path: "m.ts", pathEncoding: "utf8", status: "modified" },
        ],
      }),
      options,
    );

    expect(result.stdout).toBe("A\ta.ts\nD\td.ts\nM\tm.ts\n");
  });

  it("renders returned stat rows without claiming full-inventory line totals", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "stat",
        files: [
          {
            path: "text.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 4,
            deletions: 2,
            contentStatus: "stats",
          },
          {
            path: "image.png",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            contentStatus: "binary",
          },
        ],
      }),
      options,
    );

    expect(result.stdout).toBe(
      " text.ts   | 6 ++++--\n image.png | binary content differs\n 2 files changed, 4 insertions(+), 2 deletions(-)\n",
    );
  });

  it("marks stat totals as returned-only when file projection is truncated", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "stat",
        hasMoreFiles: true,
        files: [
          {
            path: "one.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 0,
            contentStatus: "stats",
          },
        ],
      }),
      options,
    );

    expect(result.stdout).toContain("1 returned file changed, 1 insertion(+)");
  });

  it("keeps a visible sign for every non-zero stat direction", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "stat",
        summary: {
          filesChanged: 1,
          added: 0,
          deleted: 0,
          modified: 1,
          modeChanged: 0,
          typeChanged: 0,
          inventoryComplete: true,
          unprojectableFiles: 0,
        },
        files: [
          {
            path: "skewed.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 100,
            contentStatus: "stats",
          },
        ],
      }),
      options,
    );

    expect(result.stdout.split("\n")[0]).toContain("+");
    expect(result.stdout.split("\n")[0]).toContain("-");
  });

  it("renders normalized patches and an explicitly budgeted omission", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        files: [
          {
            path: "a.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 1,
            patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
            contentStatus: "patch",
            contentSafety: { filtered: false, modifications: [] },
          },
          {
            path: "added file.ts",
            pathEncoding: "utf8",
            status: "added",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 0,
            patch: "--- /dev/null\n+++ b/added file.ts\n@@ -0,0 +1 @@\n+new\n",
            contentStatus: "patch",
            contentSafety: { filtered: false, modifications: [] },
          },
          {
            path: "deleted.ts",
            pathEncoding: "utf8",
            status: "deleted",
            modeChanged: false,
            typeChanged: false,
            additions: 0,
            deletions: 1,
            patch: "--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
            contentStatus: "patch",
            contentSafety: { filtered: false, modifications: [] },
          },
          {
            path: "large.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            contentStatus: "omitted",
            contentOmissionReason: "total_patch_bytes",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      { ...options, explicitMaxPatchBytes: true },
    );

    expect(result.stdout).toBe(
      "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n--- /dev/null\n+++ b/added file.ts\n@@ -0,0 +1 @@\n+new\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\nPatch omitted: large.ts (total_patch_bytes)\n",
    );
  });

  it("accepts both backend names for an explicit patch-budget omission", () => {
    for (const reason of ["content_budget", "total_patch_bytes"]) {
      const result = formatCodeDiffTerminal(
        envelope({
          contentCoverage: "partial",
          files: [
            {
              path: "large.ts",
              pathEncoding: "utf8",
              status: "modified",
              modeChanged: false,
              typeChanged: false,
              contentStatus: "omitted",
              contentOmissionReason: reason,
              contentSafety: { filtered: false, modifications: [] },
            },
          ],
        }),
        { ...options, explicitMaxPatchBytes: true },
      );

      expect(result.stdout).toContain(`Patch omitted: large.ts (${reason})`);
      expect(result.exitCode).toBeUndefined();
    }
  });

  it("suppresses patch streams that cannot represent binary changes", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        files: [
          {
            path: "image.png",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            contentStatus: "binary",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      options,
    );

    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "1 binary change cannot be represented as an applicable text patch",
    );
    expect(result.stderr).toContain("Use --stat or --name-status");
  });

  it("preserves patches without backend placeholder headers", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        files: [
          {
            path: "a.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 1,
            patch: "@@ -1 +1 @@\n-old\n+new\n",
            contentStatus: "patch",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      options,
    );

    expect(result.stdout).toBe("@@ -1 +1 @@\n-old\n+new\n");
  });

  it("suppresses unexpectedly incomplete patch streams", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        hasMoreFiles: true,
        files: [
          {
            path: "one.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 1,
            patch: "--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-old\n+new\n",
            contentStatus: "patch",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      options,
    );

    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Patch output was suppressed");
  });

  it("keeps explicitly file-limited patch streams successful", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        hasMoreFiles: true,
        files: [
          {
            path: "one.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 1,
            patch: "--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-old\n+new\n",
            contentStatus: "patch",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      { ...options, explicitMaxFiles: true },
    );

    expect(result.stdout).toContain("--- a/one.ts");
    expect(result.exitCode).toBeUndefined();
  });

  it("does not let explicit limits authorize unrelated patch failures", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        contentCoverage: "failed",
        files: [
          {
            path: "one.ts",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            contentStatus: "unavailable",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      {
        ...options,
        explicitMaxFiles: true,
        explicitMaxPatchBytes: true,
      },
    );

    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("keeps an empty authoritative diff silent in plain mode", () => {
    expect(formatCodeDiffTerminal(envelope({ files: [] }), options)).toEqual({
      stdout: "",
      stderr: undefined,
    });
  });

  it("does not treat an all-unprojectable result as an empty diff", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        summary: {
          filesChanged: 1,
          added: 0,
          deleted: 0,
          modified: 1,
          modeChanged: 0,
          typeChanged: 0,
          inventoryComplete: true,
          unprojectableFiles: 1,
        },
        files: [],
      }),
      options,
    );

    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("1 matching path(s)");
    expect(result.stderr).toContain("Patch output was suppressed");
  });

  it("renders completeness, scope, encoding, safety, and content warnings", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        summary: {
          filesChanged: 8,
          added: 2,
          deleted: 2,
          modified: 4,
          modeChanged: 1,
          typeChanged: 1,
          inventoryComplete: false,
          unprojectableFiles: 2,
        },
        scope: { status: "unknown" },
        contentCoverage: "failed",
        contentFailure: {
          code: "RAW_DIFF_LIMIT_EXCEEDED",
          retryable: false,
          stage: "content",
          limitKind: "max_content_entries",
        },
        files: [
          {
            path: "bad\\x80.ts",
            pathEncoding: "byte_escaped",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            contentStatus: "unavailable",
            contentSafety: {
              filtered: true,
              modifications: ["invisible_controls_stripped"],
            },
          },
        ],
        hasMoreFiles: true,
      }),
      options,
    );

    expect(result.stderr).toContain(
      "Showing changes for the entire repository",
    );
    expect(result.stderr).toContain("Unrelated files may be included");
    expect(result.stderr).toContain("inventory is incomplete");
    expect(result.stderr).toContain("More matching files");
    expect(result.stderr).toContain("Add a path glob after `--`");
    expect(result.stderr).toContain("2 matching path(s)");
    expect(result.stderr).toContain("Requested content failed");
    expect(result.stderr).toContain("Use --stat or --name-status");
    expect(result.stderr).toContain("--json");
    expect(result.stderr).toContain("display-only byte escapes");
    expect(result.stderr).toContain("modified for content safety");
  });

  it("explains that an unknown package scope applies the glob repository-wide", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        scope: { status: "unknown", pathGlob: "packages/**/*.ts" },
      }),
      options,
    );

    expect(result.stderr).toContain(
      "the path glob was applied across the entire repository",
    );
    expect(result.stderr).toContain(
      "Matching files from other packages may be included",
    );
    expect(result.stderr).toContain("narrow the path glob if needed");
    expect(result.stderr).not.toContain("add a path glob");
  });

  it("offers a path glob when unknown package scope is otherwise complete", () => {
    const result = formatCodeDiffTerminal(
      envelope({ scope: { status: "unknown" } }),
      options,
    );

    expect(result.stderr).toContain(
      "Showing changes for the entire repository",
    );
    expect(result.stderr).toContain(
      "Add a path glob after `--` to narrow the diff",
    );
  });

  it("adds full exact identity and scope facts only in verbose diagnostics", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        scope: {
          status: "package",
          fromSubpath: "packages/old",
          toSubpath: "packages/new",
          pathGlob: "packages/**/*.ts",
        },
      }),
      { useColors: false, verbose: true },
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("target: npm:example");
    expect(result.stderr).toContain("0123456789abcdef0123456789abcdef01234567");
    expect(result.stderr).toContain("fedcba9876543210fedcba9876543210fedcba98");
    expect(result.stderr).toContain('roots "packages/old" -> "packages/new"');
    expect(result.stderr).toContain('glob "packages/**/*.ts"');
  });
});
