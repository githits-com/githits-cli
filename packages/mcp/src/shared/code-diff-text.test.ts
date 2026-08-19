import { describe, expect, it } from "bun:test";
import type { LeanCodeDiffEnvelope } from "./code-diff-response.js";
import { formatCodeDiffTerminal } from "./code-diff-text.js";
import { colors } from "./colors.js";

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
    scope: { status: "repository" },
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

  it("aligns stat dividers by terminal-cell width for wide UTF-8 paths", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "stat",
        files: [
          {
            path: "한",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 0,
            contentStatus: "stats",
          },
          {
            path: "longer",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 0,
            deletions: 1,
            contentStatus: "stats",
          },
          {
            path: "👨‍👩‍👧‍👦",
            pathEncoding: "utf8",
            status: "modified",
            modeChanged: false,
            typeChanged: false,
            additions: 1,
            deletions: 1,
            contentStatus: "stats",
          },
        ],
      }),
      options,
    );

    expect(result.stdout).toStartWith(
      " 한     | 1 +\n longer | 1 -\n 👨‍👩‍👧‍👦     | 2 +-\n",
    );
  });

  it("colors stat directions without changing the plain projection", () => {
    const input = envelope({
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
      ],
    });
    const plain = formatCodeDiffTerminal(input, options).stdout;
    const colored = formatCodeDiffTerminal(input, {
      useColors: true,
    }).stdout;

    expect(colored).toContain(`${colors.green}++++${colors.reset}`);
    expect(colored).toContain(`${colors.red}--${colors.reset}`);
    expect(colored).toContain(`4 insertions(${colors.green}+${colors.reset})`);
    expect(colored).toContain(`2 deletions(${colors.red}-${colors.reset})`);
    expect(stripAnsi(colored)).toBe(plain);
  });

  it("does not emit empty color spans for one-direction stat rows", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        view: "stat",
        files: [
          {
            path: "added.ts",
            pathEncoding: "utf8",
            status: "added",
            modeChanged: false,
            typeChanged: false,
            additions: 2,
            deletions: 0,
            contentStatus: "stats",
          },
        ],
      }),
      { useColors: true },
    );

    expect(result.stdout).toContain(`${colors.green}++${colors.reset}`);
    expect(result.stdout).not.toContain(`${colors.red}${colors.reset}`);
  });

  it("colors unified patch syntax without changing patch content", () => {
    const input = envelope({
      files: [
        {
          path: "a.ts",
          pathEncoding: "utf8",
          status: "modified",
          modeChanged: false,
          typeChanged: false,
          additions: 1,
          deletions: 1,
          patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n context\n",
          contentStatus: "patch",
          contentSafety: { filtered: false, modifications: [] },
        },
      ],
    });
    const plain = formatCodeDiffTerminal(input, options).stdout;
    const colored = formatCodeDiffTerminal(input, {
      useColors: true,
    }).stdout;

    expect(colored).toContain(`${colors.red}--- a/a.ts${colors.reset}`);
    expect(colored).toContain(`${colors.green}+++ b/a.ts${colors.reset}`);
    expect(colored).toContain(`${colors.cyan}@@ -1 +1 @@${colors.reset}`);
    expect(colored).toContain(`${colors.red}-old${colors.reset}`);
    expect(colored).toContain(`${colors.green}+new${colors.reset}`);
    expect(stripAnsi(colored)).toBe(plain);
  });

  it("colors name-status letters by change kind", () => {
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
      { useColors: true },
    );

    expect(result.stdout).toBe(
      `${colors.green}A${colors.reset}\ta.ts\n${colors.red}D${colors.reset}\td.ts\n${colors.yellow}M${colors.reset}\tm.ts\n`,
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

  it("colors an explicitly budgeted patch omission", () => {
    const plain = formatCodeDiffTerminal(
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
            contentOmissionReason: "total_patch_bytes",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      { ...options, explicitMaxPatchBytes: true },
    ).stdout;
    const colored = formatCodeDiffTerminal(
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
            contentOmissionReason: "total_patch_bytes",
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      }),
      { useColors: true, explicitMaxPatchBytes: true },
    ).stdout;

    expect(colored).toContain(
      `${colors.yellow}Patch omitted: large.ts (total_patch_bytes)${colors.reset}`,
    );
    expect(stripAnsi(colored)).toBe(plain);
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

    expect(result.stderr).toContain("legacy unknown scope metadata");
    expect(result.stderr).toContain("Treat this diff as repository-wide");
    expect(result.stderr).toContain("unrelated paths may be included");
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

  it("explains that legacy unknown scope applies the glob repository-wide", () => {
    const result = formatCodeDiffTerminal(
      envelope({
        scope: { status: "unknown", pathGlob: "packages/**/*.ts" },
      }),
      options,
    );

    expect(result.stderr).toContain(
      "the path glob was applied repository-wide",
    );
    expect(result.stderr).toContain(
      "Matching paths from anywhere in the repository may be included",
    );
    expect(result.stderr).toContain("narrow the path glob if needed");
    expect(result.stderr).not.toContain("Add a path glob");
  });

  it("offers a path glob when legacy unknown scope is otherwise complete", () => {
    const result = formatCodeDiffTerminal(
      envelope({ scope: { status: "unknown" } }),
      options,
    );

    expect(result.stderr).toContain("Treat this diff as repository-wide");
    expect(result.stderr).toContain(
      "Add a path glob after `--` to narrow the diff",
    );
  });

  it("keeps normal repository scope quiet for package targets", () => {
    const result = formatCodeDiffTerminal(
      envelope({ scope: { status: "repository" } }),
      options,
    );

    expect(result.stderr).toBeUndefined();
  });

  it("reports repository scope in verbose package diagnostics", () => {
    const result = formatCodeDiffTerminal(envelope(), {
      useColors: false,
      verbose: true,
    });

    expect(result.stderr).toContain("target: npm:example");
    expect(result.stderr).toContain("scope: repository");
    expect(result.stderr).not.toContain("legacy unknown scope metadata");
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

function stripAnsi(value: string): string {
  return value.replace(ANSI_SGR_PATTERN, "");
}

const ESC = String.fromCharCode(0x1b);
const ANSI_SGR_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
