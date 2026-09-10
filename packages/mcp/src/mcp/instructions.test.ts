import { describe, expect, it } from "bun:test";
import {
  buildLocalMcpInstructions,
  buildLocalMcpQuickStart,
  buildMcpInstructions,
  buildMcpQuickStart,
  type LocalExperimentalToolName,
} from "./instructions.js";

const EXPERIMENTAL_TOOLS = ["ask", "resolve_target", "code_diff"] as const;

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
    expect(quickStart).toContain("artifact/manifest root");
    expect(quickStart).toContain("public repository");
    expect(quickStart).toContain("full repositories or sibling packages");
    expect(quickStart).toContain(
      "omit bounds when\nit has an HTTP(S) fragment to read the exact indexed section",
    );
    expect(quickStart).toContain("Otherwise follow\nthe returned target/range");
    expect(quickStart).toContain("Either bound overrides a fragment");
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
    expect(instructions).toContain("`ask`");
    expect(instructions).toContain(
      "public repository or package question and receive a source-cited answer",
    );
    expect(instructions).toContain("Omit `target` and `thread_id`");
    expect(instructions).toContain(
      "ask the user to select a `target`, then retry",
    );
    expect(instructions).toContain("Reuse a returned `thread_id` only");
    expect(instructions).toContain('`source_format:"url"`');
    expect(instructions).toContain("Do not invent or rewrite sources");
    expect(instructions).toContain("`resolve_target`");
    expect(instructions).toContain("`code_diff`");
    expect(instructions).toContain("canonical `registry:name`");
    expect(instructions).toContain("fuzzy, misspelled, or noncanonical");
    expect(instructions).toContain("documentation-site names");
    expect(instructions).toContain("`site:<host[/path]>`");
    expect(instructions).toContain('`source:"docs"`');
    expect(instructions).toContain("request JSON only for missing fields");
    expect(instructions).toContain(
      "use a `[docs page]` target unchanged, otherwise its returned target/range",
    );
    expect(instructions).toContain("EXACT/HIGH");
    expect(instructions).toContain("CLEAR or NOT_APPLICABLE");
    expect(instructions).toContain(
      "Other or missing statuses are non-actionable",
    );
    expect(instructions).toContain("CLEAR is not a vulnerability-free claim");
    expect(instructions).toContain("MEDIUM/LOW");
    expect(instructions).toContain("never auto-select");
    expect(instructions).toContain("`pkg_upgrade_review`");
    expect(instructions).toContain("public repository refs repository-wide");
    expect(instructions).toContain("name-status");
    expect(instructions).toContain("full returned patch");
    expect(instructions).toContain("diffs do not prove compatibility");
    expect(instructions).toContain("credentials");
    expect(instructions).toContain("private or proprietary content");
    expect(instructions).toContain("targets.\n\n- `ask`");
    expect(instructions).toContain(
      "returned Ask run ID when reporting a defect.\n- `resolve_target`",
    );
    expect(instructions).toContain("target/range.\n- `code_diff`");
    expect(instructions.length - buildMcpQuickStart().length).toBeLessThan(
      2_000,
    );
    expect(instructions).not.toContain("Issue reporting");
    expect(instructions).not.toContain("accepted: false");
  });

  it("composes only the requested experimental subset without phantom guidance", () => {
    const cases = [
      { enabled: [] as const, absent: EXPERIMENTAL_TOOLS },
      {
        enabled: ["resolve_target"] as const,
        absent: ["ask", "code_diff"] as const,
      },
      {
        enabled: ["code_diff"] as const,
        absent: ["ask", "resolve_target"] as const,
      },
      {
        enabled: ["ask"] as const,
        absent: ["resolve_target", "code_diff"] as const,
      },
    ];

    for (const { enabled, absent } of cases) {
      const instructions = buildLocal(enabled);
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
