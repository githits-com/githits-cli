import { describe, expect, it } from "bun:test";
import type {
  ResolveTargetCandidate,
  ResolveTargetResult,
} from "@githits/core-internal";
import {
  buildResolveTargetSuccessPayload,
  formatResolveTargetTerminal,
} from "./resolve-target-response.js";

function candidate(
  overrides: Partial<ResolveTargetCandidate> = {},
): ResolveTargetCandidate {
  return {
    kind: "PACKAGE",
    canonicalKey: "npm:express",
    displayName: "express",
    description: "Fast web framework",
    registry: "NPM",
    latestVersion: "5.1.0",
    stars: 66_000,
    downloadsLastMonth: 89_000_000,
    matchedAliases: ["express"],
    docsAvailable: true,
    codeAvailable: true,
    matchTier: 0,
    score: 100,
    confidence: "EXACT",
    reason: "Exact package identity match",
    ...overrides,
  };
}

function result(
  overrides: Partial<ResolveTargetResult> = {},
): ResolveTargetResult {
  const best = candidate();
  return {
    best,
    protectedMatches: [best],
    candidates: [best],
    ambiguous: false,
    ambiguousReason: "NOT_AMBIGUOUS",
    ...overrides,
  };
}

describe("buildResolveTargetSuccessPayload", () => {
  it("builds a lowercase, null-free diagnostic envelope", () => {
    expect(buildResolveTargetSuccessPayload(result())).toEqual({
      best: "npm:express",
      ambiguous: false,
      candidates: [
        {
          target: "npm:express",
          name: "express",
          kind: "package",
          confidence: "exact",
          description: "Fast web framework",
          registry: "npm",
          latestVersion: "5.1.0",
          stars: 66_000,
          downloadsLastMonth: 89_000_000,
          matchedAliases: ["express"],
          docsAvailable: true,
          codeAvailable: true,
          matchTier: 0,
          score: 100,
          reason: "Exact package identity match",
        },
      ],
      protectedMatches: ["npm:express"],
    });
  });

  it("appends unbounded protected extras once so every reference resolves", () => {
    const extra = candidate({
      canonicalKey: "pypi:express",
      registry: "PYPI",
    });
    const payload = buildResolveTargetSuccessPayload(
      result({ protectedMatches: [candidate(), extra, extra] }),
    );

    expect(payload.candidates.map((entry) => entry.target)).toEqual([
      "npm:express",
      "pypi:express",
    ]);
    expect(payload.protectedMatches).toEqual(["npm:express", "pypi:express"]);
  });

  it("uses safe lowercase strings for unknown enum values", () => {
    const unknown = candidate({ kind: "WORKSPACE", confidence: "VERY_HIGH" });
    const payload = buildResolveTargetSuccessPayload(
      result({ best: unknown, candidates: [unknown], protectedMatches: [] }),
    );
    expect(payload.candidates[0]?.kind).toBe("workspace");
    expect(payload.candidates[0]?.confidence).toBe("very_high");
  });

  it("emits the compact empty envelope", () => {
    expect(
      buildResolveTargetSuccessPayload(
        result({
          best: undefined,
          candidates: [],
          protectedMatches: [],
        }),
      ),
    ).toEqual({
      ambiguous: false,
      candidates: [],
      protectedMatches: [],
    });
  });
});

describe("formatResolveTargetTerminal", () => {
  it("renders a compact candidate list and copyable supplied-query follow-up", () => {
    const output = formatResolveTargetTerminal(result(), {
      name: "express",
      query: "router's middleware",
      useColors: false,
    });

    expect(output).toContain(
      "Candidates:\n  1. npm:express [exact] · package · 66k stars · 89M downloads/mo · docs · code · protected exact-name match",
    );
    expect(output).toContain("     Fast web framework");
    expect(output).toContain(
      `Next: githits search 'router'"'"'s middleware' --in 'npm:express'`,
    );
  });

  it("renders protected matches inline without changing candidate order", () => {
    const protectedExtra = candidate({
      canonicalKey: "pypi:express",
      registry: "PYPI",
    });
    const alternative = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      displayName: "expressjs/express",
      downloadsLastMonth: undefined,
      confidence: "HIGH",
    });
    const output = formatResolveTargetTerminal(
      result({
        protectedMatches: [candidate(), protectedExtra],
        candidates: [candidate(), protectedExtra, alternative],
      }),
      { name: "express", useColors: false },
    );

    expect(output).toContain(
      "1. npm:express [exact] · package · 66k stars · 89M downloads/mo · docs · code · protected exact-name match",
    );
    expect(output).toContain(
      "2. pypi:express [exact] · package · 66k stars · 89M downloads/mo · docs · code · protected exact-name match",
    );
    expect(output).toContain(
      "3. github:expressjs/express [high] · repository · 66k stars · docs · code",
    );
    expect(output).not.toContain("Also consider:");
    expect(output).not.toContain("Protected exact-name matches:");
    expect(output).toContain("githits search '<query>'");
  });

  it("appends missing protected and best candidates after ranked candidates", () => {
    const protectedExtra = candidate({
      canonicalKey: "pypi:express",
      registry: "PYPI",
    });
    const best = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      displayName: "expressjs/express",
      registry: undefined,
    });
    const output = formatResolveTargetTerminal(
      result({
        best,
        protectedMatches: [candidate(), protectedExtra],
        candidates: [candidate()],
      }),
      { name: "express", useColors: false },
    );

    expect(output.match(/^ {2}\d+\. \S+/gm)).toEqual([
      "  1. npm:express",
      "  2. pypi:express",
      "  3. github:expressjs/express",
    ]);
  });

  it("shows total downloads or a linked repository when monthly downloads are unavailable", () => {
    const crates = candidate({
      canonicalKey: "crates:serde",
      stars: undefined,
      downloadsLastMonth: undefined,
      downloadsTotal: 500_000_000,
      repositoryUrl: "https://github.com/serde-rs/serde/",
    });
    const maven = candidate({
      canonicalKey: "maven:com.google.guava:guava",
      stars: undefined,
      downloadsLastMonth: undefined,
      downloadsTotal: undefined,
      repositoryUrl: "https://github.com/google/guava",
      description: "Google core libraries for Java",
    });
    const output = formatResolveTargetTerminal(
      result({ candidates: [candidate(), crates, maven] }),
      { name: "libraries", useColors: false },
    );

    expect(output).toContain("crates:serde [exact] · package · 500M downloads");
    expect(output).toContain(
      "maven:com.google.guava:guava [exact] · package · repo github:google/guava",
    );
    expect(output).toContain("     Google core libraries for Java");
  });

  it("renders specific ambiguity guidance and a generic follow-up target", () => {
    const messages = {
      DUPLICATE_EXACT_NAME:
        "multiple exact package names match; narrow with --registry",
      CLOSE_CANDIDATES: "top candidates are equally plausible",
      LOW_CONFIDENCE: "only low-confidence matches were found",
      NEW_REASON: "review the candidates below before use",
    };
    for (const [ambiguousReason, message] of Object.entries(messages)) {
      const output = formatResolveTargetTerminal(
        result({ ambiguous: true, ambiguousReason }),
        { name: "express", useColors: false },
      );
      expect(output).toContain(`Ambiguous: ${message}`);
      expect(output).toContain("Candidates:\n  1. npm:express");
      expect(output).toContain(
        "Next after choosing: githits search '<query>' --in '<target>'",
      );
    }
  });

  it("does not add recommendation wording for a medium result", () => {
    const medium = candidate({ confidence: "MEDIUM" });
    expect(
      formatResolveTargetTerminal(
        result({ best: medium, candidates: [medium], protectedMatches: [] }),
        { name: "express", useColors: false },
      ),
    ).toContain("Candidates:\n  1. npm:express");
  });

  it("normalizes and caps candidate descriptions at 240 characters", () => {
    const long = candidate({ description: `first\n${"x".repeat(300)}` });
    const output = formatResolveTargetTerminal(
      result({ best: long, candidates: [long] }),
      { name: "express", useColors: false },
    );
    const description = output.split("\n")[2]?.trim() ?? "";
    expect(description.length).toBe(240);
    expect(description).toEndWith("...");
  });

  it("uses generic terminal wording for unknown confidence and kind values", () => {
    const drifted = candidate({ confidence: "VERY_HIGH", kind: "WORKSPACE" });
    const output = formatResolveTargetTerminal(
      result({ best: drifted, candidates: [drifted], protectedMatches: [] }),
      { name: "express", useColors: false },
    );
    expect(output).toContain("1. npm:express [unknown] · target");
    expect(output).not.toContain("very_high");
    expect(output).not.toContain("workspace");
  });

  it("strips terminal control sequences from backend-provided text", () => {
    const hostile = candidate({
      canonicalKey: "npm:x\u001b[31m",
      description:
        "safe\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007 \u009bred \u0007bell \rreturn",
    });
    const output = formatResolveTargetTerminal(
      result({ best: hostile, candidates: [hostile], protectedMatches: [] }),
      { name: "express", useColors: false },
    );
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\u0007");
    expect(output).not.toContain("\u009b");
    expect(output).not.toContain("\r");
    expect(output).toContain("1. npm:x [");
    expect(output).toContain("--in 'npm:x'");
    expect(output).toContain("safeclick red bell return");

    expect(
      formatResolveTargetTerminal(
        result({ best: undefined, candidates: [], protectedMatches: [] }),
        { name: "\u001b]0;owned\u0007missing", useColors: false },
      ),
    ).toBe("No targets found for 'missing'.\n");
  });

  it("renders no-result text and optional ANSI colors", () => {
    expect(
      formatResolveTargetTerminal(
        result({ best: undefined, candidates: [], protectedMatches: [] }),
        { name: "missing", useColors: false },
      ),
    ).toBe("No targets found for 'missing'.\n");
    expect(
      formatResolveTargetTerminal(result(), {
        name: "express",
        useColors: true,
      }),
    ).toContain("\x1b[");
  });
});
