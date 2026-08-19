import { describe, expect, it } from "bun:test";
import {
  buildLocalMcpInstructions,
  buildMcpInstructions,
  type LocalExperimentalToolName,
} from "./instructions.js";

const EXPERIMENTAL_TOOLS = ["resolve_target", "code_diff"] as const;

function buildLocal(
  enabledExperimentalTools: readonly LocalExperimentalToolName[],
  reportToolIssues?: "experimental" | "all",
): string {
  return buildLocalMcpInstructions({
    enabledExperimentalTools,
    reportToolIssues,
  });
}

describe("buildLocalMcpInstructions", () => {
  it("keeps disabled and dormant policies byte-for-byte equal to public instructions", () => {
    const baseline = buildMcpInstructions();
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
    expect(instructions).toContain("`resolve_target`");
    expect(instructions).toContain("`code_diff`");
    expect(instructions).toContain("canonical `registry:name`");
    expect(instructions).toContain("never guess");
    expect(instructions).toContain("`pkg_upgrade_review`");
    expect(instructions).toContain("name-status");
    expect(instructions).toContain("full returned patch");
    expect(instructions).toContain("diffs do not prove compatibility");
    expect(instructions).toContain("credentials");
    expect(instructions).toContain("private or proprietary content");
    expect(instructions).toContain("targets.\n\n- `resolve_target`");
    expect(instructions).toContain("directly.\n- `code_diff`");
    expect(instructions.length - buildMcpInstructions().length).toBeLessThan(
      900,
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
        absent: ["code_diff"] as const,
      },
      {
        enabled: ["code_diff"] as const,
        absent: ["resolve_target"] as const,
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
