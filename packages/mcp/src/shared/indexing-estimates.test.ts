import { describe, expect, it } from "bun:test";
import type {
  DiscoveryIndexingEstimate,
  GrepResult,
} from "@githits/core-internal";
import { indexingEstimatesSchema } from "../../../core-internal/src/services/indexing-estimates.js";
import { projectGrepResult } from "./grep-response.js";
import { formatGrepText } from "./grep-text.js";
import { projectIndexingEstimates } from "./indexing-estimates.js";
import {
  renderIndexingEstimates,
  renderPreparationSection,
} from "./indexing-estimates-text.js";
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
      expect(output).toContain("No matches available yet.");
      expect(output).toContain("(indexing, estimated total: 38-57s");
      expect(output).toContain("time spent indexing: 90s");
      expect(output).toContain("To retry omitted targets");
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
    expect(output).toContain("Cursor expired");
    expect(output).toContain("Cursor expired");
    expect(output).toContain("unknown_reason");
    expect(output).not.toContain("To retry omitted targets");
    expect(output).not.toContain("being indexed");
  });
  it("retains unmatched estimate kinds once without assigning them to an omitted repository", () => {
    const entry: DiscoveryIndexingEstimate = {
      ...documentation,
      targets: repository.targets,
    };
    const text = formatGrepText(pending({ indexingEstimates: [entry] }), {
      width: 160,
    });
    expect(text).toContain(`  - ${repository.targets[0]} (indexing)`);
    expect(
      text.match(/preparing documentation, no estimate available/g),
    ).toHaveLength(1);
  });
  it("keeps documentation preparation and its unavailable estimate with the omitted site", () => {
    const text = formatGrepText(
      pending({
        unavailableTargets: [
          {
            inputIndex: 0,
            target: "site:docs.test",
            reason: "documentation_publishing",
            retryable: true,
            progressRef: null,
            suggestedSiteTargets: null,
          },
        ],
        indexingEstimates: [documentation],
      }),
      { syntax: "mcp", width: 160 },
    );
    expect(text.split("\n").filter((line) => line.startsWith("  - "))).toEqual([
      "  - site:docs.test (preparing documentation, no estimate available)",
    ]);
  });
  it("groups multiple omitted targets under one heading with each explanation on its own line", () => {
    const first = pending().unavailableTargets[0]!;
    const result = pending({
      unavailableTargets: [
        { ...first, target: "npm:one", inputIndex: 0 },
        {
          ...first,
          target: "site:docs.test",
          inputIndex: 1,
          reason: "documentation_publishing",
        },
      ],
      indexingEstimates: [
        {
          ...repository,
          targets: ["npm:one"],
          estimate: { lowerSeconds: 33, upperSeconds: 85 },
        },
        documentation,
      ],
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const output = formatGrepText(result, { syntax, width: 160 });
      expect(output).toContain(
        "Preparing:\n  - npm:one (indexing, estimated total: 33-85s)\n  - site:docs.test (preparing documentation, no estimate available)",
      );
      expect(output.match(/^Preparing:$/gm)).toHaveLength(1);
      expect(output).not.toContain("Sources:");
    }
  });
  it("does not repeat traversal jargon for terminal omissions, while retaining independent failure warnings", () => {
    const result = pending({
      unavailableTargets: [
        {
          inputIndex: 0,
          target: "npm:x",
          reason: "no_grep_scopes",
          retryable: false,
          progressRef: null,
          suggestedSiteTargets: null,
        },
      ],
      indexingEstimates: [],
    });
    const text = formatGrepText(result);
    expect(text).toContain("No matches found.");
    expect(text).toContain("Omitted:\n  - npm:x");
    expect(text).not.toContain("Traversal is incomplete");
    expect(text).not.toContain("No matches yet");
    expect(text).not.toContain("To retry omitted targets");
    expect(formatGrepText({ ...result, traversal: "FAILED" })).toContain(
      "Traversal is incomplete",
    );
    expect(formatGrepText({ ...result, unavailableTargets: [] })).toContain(
      "Traversal is incomplete",
    );
    expect(projectGrepResult(result).traversal).toBe("NON_RESUMABLE_PARTIAL");
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
    expect(text).toContain("Time spent indexing: 12s");
    expect(text).toContain("Not enough history");
    expect(text).toContain("preparing documentation");
    expect(text).not.toContain("Estimated indexing time");
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

describe("shared preparation section", () => {
  it("separates annotations and hangs wrapped continuation lines", () => {
    const lines = renderPreparationSection([repository, documentation], {
      width: 60,
    });
    expect(lines.slice(0, 2)).toEqual(["", "Preparing:"]);
    expect(lines.filter((line) => line.startsWith("  - "))).toHaveLength(2);
    expect(lines.some((line) => line.startsWith("    "))).toBe(true);
    expect(lines.every((line) => line.length <= 60)).toBe(true);
    expect(lines.join("\n")).toContain("preparing documentation");
    expect(renderPreparationSection([])).toEqual([]);
  });
});

it("keeps multiple requests' indexed alternatives attributed within preparation", () => {
  const text = renderPreparationSection(
    [
      {
        ...repository,
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        targets: ["npm:one@1", "npm:two@2"],
      },
    ],
    {
      indexedAlternatives: [
        { target: "npm:one@1", summary: "versions 0.9" },
        { target: "npm:two@2", summary: "versions 1.9" },
        { target: "npm:other@3", summary: "versions 2.9" },
      ],
    },
  ).join("\n");
  expect(text).toContain("Indexed alternatives for npm:one@1: versions 0.9");
  expect(text).toContain("Indexed alternatives for npm:two@2: versions 1.9");
  expect(text).not.toContain("2.9");
});
