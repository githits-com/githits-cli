import { describe, expect, it } from "bun:test";
import { RESEARCH_VERIFIED_ANSWER_GUIDANCE } from "../shared/research-guidance.js";
import {
  buildLocalMcpInstructions,
  buildLocalMcpQuickStart,
  buildMcpInstructions,
  buildMcpQuickStart,
  type LocalExperimentalToolGuidance,
} from "./instructions.js";

const PROBE_TOOL: LocalExperimentalToolGuidance = {
  name: "probe",
  guidance: "- `probe` — probe one experimental contract.",
};
const EXPERIMENTAL_TOOLS = [PROBE_TOOL] as const;

function buildLocal(
  enabledExperimentalTools: readonly LocalExperimentalToolGuidance[],
): string {
  return buildLocalMcpQuickStart({
    enabledExperimentalTools,
  });
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("buildMcpQuickStart", () => {
  it("keeps the task guide compact and routes before navigation", () => {
    const guide = buildMcpQuickStart();
    expect(guide.split(/\s+/).length).toBeLessThan(950);
    expect(guide.indexOf("## Choose a tool")).toBeLessThan(
      guide.indexOf("## Depth and symbol following"),
    );
    for (const phrase of [
      "open-source code",
      "cannot access private repositories, your local workspace, or uncommitted changes",
      "Never send private targets, private code, local paths, credentials, personal data, or proprietary content",
      "do not load both",
    ])
      expect(guide).toContain(phrase);
  });
  it("uses direct symbols, sufficient evidence and task-based stopping", () => {
    const guide = normalized(buildMcpQuickStart());
    for (const phrase of [
      "Use canonical targets without resolution",
      "follow resolver ambiguity rules",
      "Stop when enough is known; state material gaps",
      "Read known symbols with `read` selector before searching",
      "reuse definitions already read",
      "a call site alone does not establish",
      "Read omitted deciding conditions or bodies",
      "avoid repeated small windows",
      "Batch independent calls",
    ])
      expect(guide).toContain(phrase);
  });
  it("preserves target, version, output and recovery boundaries", () => {
    const guide = normalized(buildMcpQuickStart());
    for (const phrase of [
      "package-relative paths",
      "repository-relative paths",
      "returned site/page locators",
      "never literal `registry:`",
      "Never infer a provider",
      "not a revision",
      "Do not guess tags",
      "Filter/limit output; paginate only for needed information",
      "rate limit applies across questions/targets",
      "omit unused optional arguments",
      "exact heading IDs, not titles",
      "do not retry daily limits before reset",
      "Preserve unknown assessments and coverage limits",
      "Reviews do not authorize modifications",
      "compare the same affected behavior before and after",
    ])
      expect(guide).toContain(phrase);
  });
  it("shares research answer handling without mandatory rereads", () => {
    const guide = normalized(buildMcpQuickStart());
    expect(guide).toContain(RESEARCH_VERIFIED_ANSWER_GUIDANCE);
    for (const phrase of ["Reuse `thread_id` and state scope changes"])
      expect(guide).toContain(phrase);
    expect(guide).not.toContain("Local experimental tools");
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

  it("appends enabled experimental guidance after the public guide", () => {
    const instructions = buildLocal(EXPERIMENTAL_TOOLS);

    expect(instructions.startsWith(buildMcpQuickStart())).toBe(true);
    expect(instructions).toContain("## Local experimental tools");
    expect(instructions).toContain("credentials");
    expect(instructions).toContain("private or proprietary content");
    expect(instructions).toContain(`targets.\n\n${PROBE_TOOL.guidance}`);
    expect(instructions).not.toContain("Issue reporting");
    expect(instructions).not.toContain("accepted: false");
  });

  it("adds no local section while no experimental tool is enabled", () => {
    expect(buildLocal([])).not.toContain("Local experimental tools");
    expect(buildLocal([])).not.toContain("`probe`");
  });
});
