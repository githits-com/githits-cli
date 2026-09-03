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
  reportToolIssues?: "experimental" | "all",
): string {
  return buildLocalMcpQuickStart({
    enabledExperimentalTools,
    reportToolIssues,
  });
}

describe("buildLocalMcpQuickStart", () => {
  it("documents canonical target guidance for package and repository scope", () => {
    const quickStart = buildMcpQuickStart();

    expect(quickStart).toContain("swift:github.com/<owner>/<repo>");
    expect(quickStart).toContain("zig:gh/<owner>/<repo>");
    expect(quickStart).toContain("artifact/manifest root");
    expect(quickStart).toContain("public GitHub repository");
    expect(quickStart).toContain("full repositories or sibling packages");
  });

  it("keeps deprecated instruction builders as exact compatibility aliases", () => {
    expect(buildMcpInstructions()).toBe(buildMcpQuickStart());
    expect(
      buildLocalMcpInstructions({
        enabledExperimentalTools: EXPERIMENTAL_TOOLS,
        reportToolIssues: "experimental",
      }),
    ).toBe(
      buildLocalMcpQuickStart({
        enabledExperimentalTools: EXPERIMENTAL_TOOLS,
        reportToolIssues: "experimental",
      }),
    );
  });

  it("keeps disabled and dormant policies byte-for-byte equal to the public guide", () => {
    const baseline = buildMcpQuickStart();
    for (const reportToolIssues of [
      undefined,
      "experimental",
      "all",
    ] as const) {
      expect(buildLocal([], reportToolIssues)).toBe(baseline);
    }
  });

  it("routes enabled experimental tools without opt-in issue reporting", () => {
    const instructions = buildLocal(EXPERIMENTAL_TOOLS);

    expect(instructions).toContain("Local experimental tools");
    expect(instructions).toContain("public OSS only");
    expect(instructions).toContain("`ask`");
    expect(instructions).toContain(
      "public repository or package question and receive a source-cited answer",
    );
    expect(instructions).toContain("Call `resolve_target` first");
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
    expect(instructions).toContain('`format:"json"`');
    expect(instructions).toContain("relevant `pageId` and returned line range");
    expect(instructions).toContain("to `docs_read`");
    expect(instructions).toContain("EXACT/HIGH");
    expect(instructions).toContain("CLEAR or NOT_APPLICABLE");
    expect(instructions).toContain(
      "Other or missing statuses are non-actionable",
    );
    expect(instructions).toContain("CLEAR is not a vulnerability-free claim");
    expect(instructions).toContain("MEDIUM/LOW");
    expect(instructions).toContain("never auto-select");
    expect(instructions).toContain("`pkg_upgrade_review`");
    expect(instructions).toContain("public GitHub refs repository-wide");
    expect(instructions).toContain("name-status");
    expect(instructions).toContain("full returned patch");
    expect(instructions).toContain("diffs do not prove compatibility");
    expect(instructions).toContain("credentials");
    expect(instructions).toContain("private or proprietary content");
    expect(instructions).toContain("targets.\n\n- `ask`");
    expect(instructions).toContain(
      "response fields are needed.\n- `resolve_target`",
    );
    expect(instructions).toContain("to `docs_read`.\n- `code_diff`");
    expect(instructions.length - buildMcpQuickStart().length).toBeLessThan(
      1_900,
    );
    expect(instructions).not.toContain("Issue reporting");
    expect(instructions).not.toContain("accepted: false");
  });

  it("scopes experimental issue reporting to enabled tools", () => {
    const experimental = buildLocal(["resolve_target"], "experimental");
    expect(experimental).toContain("Issue reporting (experimental)");
    expect(experimental).toContain("`resolve_target`");
    expect(experimental).not.toContain("`code_diff`");
    expect(experimental).toContain("`accepted: false`");
    expect(experimental).toContain("make one `feedback` call");
    expect(experimental).toContain("exact `tool_name`");
    expect(experimental).toContain("redacted expected-vs-observed context");
    expect(experimental).toContain("Do not report valid empty results");
    expect(experimental).toContain("Never include credentials");
    expect(experimental).toContain("private/proprietary content");
    expect(experimental).toContain("Do not retry or report");
    expect(
      experimental.length - buildLocal(["resolve_target"]).length,
    ).toBeLessThan(500);

    const all = buildLocal(["code_diff"], "all");
    expect(all).toContain("Issue reporting (all)");
    expect(all).toContain("any GitHits tool in this session");
    expect(all).toContain("`code_diff`");
    expect(all).not.toContain("`resolve_target`");
    expect(all.length - buildLocal(["code_diff"]).length).toBeLessThan(500);
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
      for (const name of enabled) {
        expect(instructions).toContain(`\`${name}\``);
      }
      for (const name of absent) {
        expect(instructions).not.toContain(`\`${name}\``);
      }
    }
  });
});
