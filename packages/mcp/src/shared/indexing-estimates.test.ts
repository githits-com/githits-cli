import { describe, expect, it } from "bun:test";
import type {
  DiscoveryIndexingEstimate,
  GrepResult,
} from "@githits/core-internal";
import { indexingEstimatesSchema } from "../../../core-internal/src/services/indexing-estimates.js";
import { projectGrepResult } from "./grep-response.js";
import { formatGrepText } from "./grep-text.js";
import { projectIndexingEstimates } from "./indexing-estimates.js";
import { renderIndexingEstimates } from "./indexing-estimates-text.js";
import { indexingWaitMs } from "./indexing-wait.js";

const repository: DiscoveryIndexingEstimate = {
  kind: "REPOSITORY",
  targets: ["github:sqlalchemy/sqlalchemy@rel_2_1_3"],
  repositoryUrl: "https://github.com/sqlalchemy/sqlalchemy",
  estimate: {
    lowerSeconds: 38,
    upperSeconds: 57,
    elapsedSeconds: 90,
    sampleCount: 9,
    source: "same_repository_refs",
  },
};
const documentation: DiscoveryIndexingEstimate = {
  kind: "DOCUMENTATION",
  targets: ["site:docs.test"],
  unavailableReason: "UNSUPPORTED_WORK",
};
function pending(overrides: Partial<GrepResult> = {}): GrepResult {
  return {
    hits: [],
    targets: [],
    totalMatches: 0,
    traversal: "NON_RESUMABLE_PARTIAL",
    nextCursor: null,
    unavailableTargets: [
      {
        inputIndex: 0,
        target: repository.targets[0]!,
        reason: "repository_indexing",
        retryable: true,
        progressRef: "opaque-id",
        suggestedSiteTargets: null,
      },
    ],
    indexingEstimates: [repository],
    ...overrides,
  };
}
describe("uniform indexing evidence presentation", () => {
  it("makes the reported pending grep actionable in both syntaxes", () => {
    for (const syntax of ["cli", "mcp"] as const) {
      const result = pending();
      const before = structuredClone(result);
      const output = formatGrepText(result, { syntax, width: 160 });
      expect(output).toContain("No matches yet.");
      expect(output).toContain("repository is being indexed");
      expect(output).toContain("Estimated total indexing time: 38-57s");
      expect(output).toContain("Active indexing elapsed: 90s");
      expect(output).toContain("without a cursor");
      expect(output).toContain(
        syntax === "cli" ? "--wait 70000" : "wait_timeout_ms=70000",
      );
      for (const hidden of [
        "repository_indexing",
        "opaque-id",
        "Unavailable input",
        "no continuation cursor",
        "remaining",
        "ETA",
      ])
        expect(output).not.toContain(hidden);
      expect(projectGrepResult(result).unavailableTargets[0]?.progressRef).toBe(
        "opaque-id",
      );
      expect(projectGrepResult(result).indexingEstimates).toEqual([repository]);
      expect(result).toEqual(before);
    }
  });
  it("retains cursor expiry and unknown failures without inventing indexing", () => {
    const result = pending({
      traversal: "CURSOR_EXPIRED",
      nextCursor: null,
      unavailableTargets: [
        {
          inputIndex: 0,
          target: "npm:x",
          reason: "unknown_reason",
          retryable: false,
          progressRef: null,
          suggestedSiteTargets: null,
        },
      ],
      indexingEstimates: [],
    });
    const output = formatGrepText(result);
    expect(output).toContain("coverage is incomplete");
    expect(output).toContain("Cursor expired");
    expect(output).toContain("unknown_reason");
    expect(output).not.toContain("Next: retry");
    expect(output).not.toContain("being indexed");
  });
  it("renders unknown history and unsupported docs without fabricated durations", () => {
    const entries: DiscoveryIndexingEstimate[] = [
      {
        ...repository,
        estimate: { elapsedSeconds: 12 },
        unavailableReason: "NO_HISTORY",
      },
      documentation,
      { ...repository, estimate: undefined, unavailableReason: "NO_HISTORY" },
    ];
    const text = renderIndexingEstimates(entries).join("\n");
    expect(text).toContain("Active indexing elapsed: 12s");
    expect(text).toContain("No indexing duration history");
    expect(text).toContain("documentation preparation");
    expect(text).not.toContain("Estimated total");
    expect(indexingWaitMs(entries)).toBe(30000);
    expect(renderIndexingEstimates([])).toEqual([]);
  });
  it("respects each surface cap without subtracting elapsed or summing labels", () => {
    expect(indexingWaitMs([repository])).toBe(70000);
    expect(indexingWaitMs([repository], 60000)).toBe(60000);
    expect(
      indexingWaitMs([{ ...repository, targets: ["a", "b"] }, repository]),
    ).toBe(70000);
    expect(
      indexingWaitMs([
        { ...repository, estimate: { upperSeconds: 1 } },
        documentation,
      ]),
    ).toBe(30000);
  });
  it("copies only public metadata and escapes target controls", () => {
    const entry = {
      ...repository,
      targets: ["a\n\u001b界"],
      extra: "drop",
      estimate: { ...repository.estimate, extra: "drop" },
    };
    const projected = projectIndexingEstimates([entry]);
    expect(projected[0]).not.toHaveProperty("extra");
    expect(projected[0]?.estimate).not.toHaveProperty("extra");
    projected[0]?.targets.push("other");
    expect(entry.targets).toHaveLength(1);
    expect(renderIndexingEstimates([entry])[0]).toContain("a\\n\\u001b界");
  });
});

describe("uniform indexing wire decoding", () => {
  it("normalizes coalesced work and keeps all entries and provenance", () => {
    const wire = [
      { ...repository, commitSha: null, unavailableReason: null },
      {
        ...documentation,
        repositoryUrl: null,
        commitSha: null,
        estimate: null,
      },
    ];
    expect(indexingEstimatesSchema.parse(wire)).toEqual([
      repository,
      documentation,
    ]);
    expect(indexingEstimatesSchema.parse([])).toEqual([]);
    expect(
      indexingEstimatesSchema.parse(indexingEstimatesSchema.parse(wire)),
    ).toEqual([repository, documentation]);
  });
  it.each([
    undefined,
    null,
    {},
    [{ ...repository, kind: "OTHER" }],
    [{ ...repository, estimate: { upperSeconds: "57" } }],
  ])("rejects malformed result metadata %j", (wire) => {
    expect(indexingEstimatesSchema.safeParse(wire).success).toBe(false);
  });
});
