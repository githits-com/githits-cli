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
  it("renders a compact best result and copyable supplied-query follow-up", () => {
    const output = formatResolveTargetTerminal(result(), {
      name: "express",
      query: "router's middleware",
      useColors: false,
    });

    expect(output).toContain(
      "Best: npm:express [exact] · package · 66k stars · 89M downloads/mo · docs · code",
    );
    expect(output).toContain("  Fast web framework");
    expect(output).toContain(
      `Next: githits search 'router'"'"'s middleware' --in 'npm:express'`,
    );
  });

  it("partitions protected matches from ranked alternatives", () => {
    const protectedExtra = candidate({
      canonicalKey: "pypi:express",
      registry: "PYPI",
    });
    const alternative = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      displayName: "expressjs/express",
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
      "Protected exact-name matches:\n  pypi:express [exact] · package",
    );
    expect(output).toContain(
      "Also consider:\n  github:expressjs/express [high] · repository",
    );
    expect(output).toContain("githits search '<query>'");
  });

  it("renders specific ambiguity guidance and Top wording", () => {
    const messages = {
      DUPLICATE_EXACT_NAME:
        "multiple exact package names match; narrow with --registry",
      CLOSE_CANDIDATES: "top candidates are equally plausible",
      LOW_CONFIDENCE: "only low-confidence matches were found",
      NEW_REASON: "resolver reported new_reason",
    };
    for (const [ambiguousReason, message] of Object.entries(messages)) {
      const output = formatResolveTargetTerminal(
        result({ ambiguous: true, ambiguousReason }),
        { name: "express", useColors: false },
      );
      expect(output).toContain(`Ambiguous: ${message}`);
      expect(output).toContain("Top: npm:express");
    }
  });

  it("uses Top for a non-ambiguous medium result", () => {
    const medium = candidate({ confidence: "MEDIUM" });
    expect(
      formatResolveTargetTerminal(
        result({ best: medium, candidates: [medium], protectedMatches: [] }),
        { name: "express", useColors: false },
      ),
    ).toContain("Top: npm:express");
  });

  it("normalizes and caps the best description at 120 characters", () => {
    const long = candidate({ description: `first\n${"x".repeat(150)}` });
    const output = formatResolveTargetTerminal(
      result({ best: long, candidates: [long] }),
      { name: "express", useColors: false },
    );
    const description = output.split("\n")[1]?.trim() ?? "";
    expect(description.length).toBe(120);
    expect(description).toEndWith("...");
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
