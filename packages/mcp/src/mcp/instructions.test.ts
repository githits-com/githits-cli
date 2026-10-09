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

function normalized(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("buildMcpQuickStart", () => {
  it("orders guide sections from routing to shared conventions", () => {
    const guide = buildMcpQuickStart();
    const headings = guide.match(/^#{1,2} .+$/gm);

    expect(headings).toEqual([
      "# GitHits",
      "## Choose a tool",
      "## Workflow",
      "## Targets",
      "## Results",
      "## Dependency upgrades",
      "## External-content posture",
    ]);
    expect(guide).not.toMatch(/public OSS/i);
    expect(guide).not.toMatch(/^\*\*.+\*\*$/m);
  });

  it("documents canonical target conventions shared by every tool", () => {
    const guide = normalized(buildMcpQuickStart());

    for (const phrase of [
      "`registry:name@version`",
      "`github:owner/repo@ref`",
      "`site:host[/path]`",
      "swift:github.com/<owner>/<repo>",
      "zig:gh/<owner>/<repo>",
      "covers its package subpath, including in monorepos",
      "whole repositories or sibling packages",
      "Never infer a provider",
      "Omit the suffix for the latest package version or default branch",
      "`#` selects a symbol or heading, never a revision",
    ]) {
      expect(guide).toContain(phrase);
    }
    expect(guide).not.toContain("[@version]");
    expect(guide).not.toContain("[@ref]");
  });

  it("describes the cross-tool workflow without repeating tool mechanics", () => {
    const guide = normalized(buildMcpQuickStart());

    for (const phrase of [
      "use a known canonical target directly",
      "call `resolve_target` and follow its continuation rules; never auto-select an ambiguous candidate",
      "`search` by topic, `grep` for exact text, `list` for structure or an exact path",
      'search the package with `source:"docs"`',
      "`site:` target or page URL from a `[docs page]` hit",
      "`read` never lists directories",
      "support behavioral claims with source, tests, or call sites",
      "Neither they nor passing existing tests prove the application still works",
    ]) {
      expect(guide).toContain(phrase);
    }
    // Per-tool mechanics belong to the selected tool's description.
    for (const phrase of [
      "EXACT/HIGH",
      "name-status",
      "followUp",
      "selector",
    ]) {
      expect(guide).not.toContain(phrase);
    }
  });

  it("keeps result conventions common to every tool", () => {
    const guide = normalized(buildMcpQuickStart());

    for (const phrase of [
      "Omit `format`",
      "Use JSON only when code consumes the raw response or a required field is missing from text",
      "Reuse returned targets, paths, locators, references, and ranges unchanged; never invent them",
      "Follow rendered continuation and recovery actions instead of repeating or polling calls",
      "Omit `wait_timeout_ms` for the default; `0` returns without waiting",
      "Cite tool-owned provenance, including example source repositories",
      "report coverage, truncation, and other evidence limits",
    ]) {
      expect(guide).toContain(phrase);
    }
  });

  it("states the private-input boundary and skill/quick_start equivalence", () => {
    const guide = normalized(buildMcpQuickStart());

    expect(guide).toContain(
      "never send private code, local paths, credentials, or personal data",
    );
    expect(guide).toContain(
      "This guide is both the `githits-mcp` skill and the `quick_start` result; once either is loaded, do not call `quick_start`",
    );
  });
});

describe("buildLocalMcpQuickStart", () => {
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

    expect(instructions).toContain("## Local experimental tools");
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
    expect(instructions.startsWith(buildMcpQuickStart())).toBe(true);
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
