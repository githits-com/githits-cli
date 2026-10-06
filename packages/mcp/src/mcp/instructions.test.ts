import { describe, expect, it } from "bun:test";
import {
  buildLocalMcpInstructions,
  buildLocalMcpQuickStart,
  buildMcpInstructions,
  buildMcpQuickStart,
  type LocalExperimentalToolName,
} from "./instructions.js";

const EXPERIMENTAL_TOOLS = ["research"] as const;

function buildLocal(
  enabledExperimentalTools: readonly LocalExperimentalToolName[],
): string {
  return buildLocalMcpQuickStart({
    enabledExperimentalTools,
  });
}

describe("buildLocalMcpQuickStart", () => {
  it("documents canonical target guidance for package and repository scope", () => {
    const quickStart = buildMcpQuickStart();

    expect(quickStart).toContain("swift:github.com/<owner>/<repo>");
    expect(quickStart).toContain("zig:gh/<owner>/<repo>");
    expect(quickStart).toContain("package subpath, including in monorepos");
    expect(quickStart).toContain("public repository");
    expect(quickStart).toContain("full repositories or sibling packages");
    expect(quickStart).toContain(
      "targets use `registry:name@version` and `github:owner/repo@ref`",
    );
    expect(quickStart).toContain(
      "Browse files or documentation pages in a known package, repository, or site | `list`",
    );
    expect(quickStart).toContain(
      "`list` is for a known target when you need its structure or an exact path",
    );
    expect(quickStart).toContain("use `search` for content by topic");
    expect(quickStart).toContain("both include source and\ndocumentation");
    expect(quickStart).toContain(
      "explicit `site:` inventory that\n`list` does not discover",
    );
    expect(quickStart).toContain(
      "pair a listed path with the shared read target in its header",
    );
    expect(quickStart).toContain("a full URL row is its own read target");
    expect(quickStart).toContain(
      "A site row without a\ntrailing `/` is a page path even if its source URL ended in `/`",
    );
    expect(quickStart).toContain(
      "Use JSON for exact entry kinds and per-entry\n`read` actions",
    );
    expect(quickStart).toContain(
      "the required target sets the site scope; selectors with\nor without one leading `/` stay within it",
    );
    expect(quickStart).not.toContain("`code_files`");
    expect(quickStart).not.toContain("`docs_list`");
    expect(quickStart).toContain(
      "suffix for the latest package version or repository default branch",
    );
    expect(quickStart).not.toContain("[@version]");
    expect(quickStart).not.toContain("[@ref]");
    expect(quickStart).toContain(
      "returned HTTP(S) page target unchanged to `read`",
    );
    expect(quickStart).toContain(
      "Hosted/crawled HTTP(S) docs locators address mutable current content",
    );
    expect(quickStart).toContain(
      "A `site:` read requires a\nseparate exact page `path`",
    );
    expect(quickStart).toContain(
      "its `followUp` unchanged, including supplied `selector` and bounds",
    );
    expect(quickStart).toContain(
      "A direct HTTP(S) docs fragment read without explicit bounds returns its heading",
    );
    expect(quickStart).toContain(
      "and full subtree through the next equal-or-higher heading",
    );
    expect(quickStart).toContain(
      "Repository docs are snapshot-addressed and keep returned ranges",
    );
    expect(quickStart).toContain(
      "a direct `read`, add bounds only to intentionally select a current page range",
    );
    expect(quickStart).toContain("read its schema for syntax and defaults");
    expect(quickStart).toContain("never probe");
    expect(quickStart).toContain("directories with `read`");
    expect(quickStart).toContain(
      "JSON is only for code consuming the raw response or required fields absent",
    );
    expect(quickStart).not.toContain("A fragment needs no bounds");
  });

  it("keeps resolver guidance and continuation gates on the default stable surface", () => {
    const guide = buildMcpQuickStart();
    for (const phrase of [
      "`resolve_target`",
      "vague or misspelled public OSS name",
      "skip known canonical targets",
      "EXACT/HIGH",
      "CLEAR or NOT_APPLICABLE",
      "CLEAR\nis not a vulnerability-free claim",
      "Other or missing statuses are non-actionable",
      "MEDIUM/LOW",
      "explicitly choose an actionable candidate; never auto-select",
      "A selected `site:` is docs-only",
      "`list` to browse",
      'or `search` with `source:"docs"`',
    ]) {
      expect(guide).toContain(phrase);
    }
    expect(guide).not.toContain("Local experimental tools");
    expect(
      buildLocal(["research"]).split("Local experimental tools")[1],
    ).not.toContain("`resolve_target`");
  });

  it("keeps deprecated instruction builders as exact compatibility aliases", () => {
    expect(buildMcpInstructions()).toBe(buildMcpQuickStart());
    expect(
      buildLocalMcpInstructions({
        enabledExperimentalTools: EXPERIMENTAL_TOOLS,
      }),
    ).toBe(
      buildLocalMcpQuickStart({
        enabledExperimentalTools: EXPERIMENTAL_TOOLS,
      }),
    );
  });

  it("keeps disabled tools byte-for-byte equal to the public guide", () => {
    const baseline = buildMcpQuickStart();
    expect(buildLocal([])).toBe(baseline);
  });

  it("routes enabled experimental tools without feedback guidance", () => {
    const instructions = buildLocal(EXPERIMENTAL_TOOLS);

    expect(instructions).toContain("Local experimental tools");
    expect(instructions).toContain("public OSS only");
    expect(instructions).toContain("`research`");
    expect(instructions).not.toContain("`ask`");
    expect(instructions).toContain(
      "research a public repository or package to answer a question with sources",
    );
    expect(instructions).toContain("Omit `target` and `thread_id`");
    expect(instructions).toContain(
      "ask the user to select a `target`, then retry",
    );
    expect(instructions).toContain(
      "Reuse a returned `thread_id` for follow-ups",
    );
    expect(instructions).toContain('`source_format:"url"`');
    expect(instructions).toContain("Do not invent or rewrite sources");
    expect(instructions).toContain("`resolve_target`");
    expect(instructions).toContain("`code_diff`");
    expect(instructions).toContain("skip known canonical targets");
    expect(instructions).toContain("vague or misspelled public OSS name");
    expect(instructions).toContain("A selected `site:` is docs-only");
    expect(instructions).toContain('or `search` with `source:"docs"`');
    expect(instructions).toContain("`list` to browse");
    expect(instructions).toContain(
      "JSON is only for code consuming the raw response or required fields absent",
    );
    expect(instructions).toContain(
      "replay its `followUp` unchanged, including supplied `selector` and bounds",
    );
    expect(instructions).toContain("EXACT/HIGH");
    expect(instructions).toContain("CLEAR or NOT_APPLICABLE");
    expect(instructions).toContain(
      "Other or missing statuses are non-actionable",
    );
    expect(instructions).toContain("CLEAR\nis not a vulnerability-free claim");
    expect(instructions).toContain("MEDIUM/LOW");
    expect(instructions).toContain("never auto-select");
    expect(instructions).toContain("`pkg_upgrade_review`");
    expect(instructions).toContain("comparisons, which are repository-wide");
    expect(instructions).toContain("name-status");
    expect(instructions).toContain(
      "Keep text unless required fields or the full\nreturned patch are needed",
    );
    expect(instructions).toContain("Raw diffs do not\nprove compatibility");
    expect(instructions).toContain("credentials");
    expect(instructions).toContain("private or proprietary content");
    expect(instructions).toContain("targets.\n\n- `research`");
    expect(instructions.split("Local experimental tools")[1]).not.toContain(
      "`resolve_target`",
    );
    expect(instructions.split("Local experimental tools")[1]).not.toContain(
      "`code_diff`",
    );
    expect(instructions.length - buildMcpQuickStart().length).toBeLessThan(
      2_000,
    );
    expect(instructions).not.toContain("Issue reporting");
    expect(instructions).not.toMatch(/report(?:ing)? (?:a )?defect/i);
    expect(instructions).not.toContain("accepted: false");
  });

  it("composes only the requested experimental subset without phantom guidance", () => {
    const cases = [
      { enabled: [] as const, absent: EXPERIMENTAL_TOOLS },
      { enabled: ["research"] as const, absent: [] as const },
    ];

    for (const { enabled, absent } of cases) {
      const instructions = buildLocal(enabled);
      expect(instructions).toContain("`code_diff`");
      expect(instructions).toContain("`resolve_target`");
      expect(instructions).not.toContain("feedback");
      expect(instructions).not.toContain("Issue reporting");
      for (const name of enabled) {
        expect(instructions).toContain(`\`${name}\``);
      }
      for (const name of absent) {
        expect(instructions).not.toContain(`\`${name}\``);
      }
    }
  });
});
