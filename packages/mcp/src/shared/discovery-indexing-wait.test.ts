import { describe, expect, it } from "bun:test";
import type { DiscoveryIndexingEstimate } from "@githits/core-internal";
import { discoveryIndexingWaitMs } from "./discovery-indexing-wait.js";

function repository(upperSeconds: number): DiscoveryIndexingEstimate {
  return {
    kind: "REPOSITORY",
    targets: ["npm:express"],
    estimate: { lowerSeconds: 0, upperSeconds },
  };
}

const unsupported: DiscoveryIndexingEstimate = {
  kind: "DOCUMENTATION",
  targets: ["site:expressjs.com"],
  unavailableReason: "UNSUPPORTED_WORK",
};
const noHistory: DiscoveryIndexingEstimate = {
  kind: "REPOSITORY",
  targets: ["npm:new-package"],
  estimate: { elapsedSeconds: 70 },
  unavailableReason: "NO_HISTORY",
};

describe("discovery indexing follow-up wait", () => {
  it.each([
    [undefined, 30_000],
    [[], 30_000],
    [[unsupported], 30_000],
    [[noHistory], 30_000],
    [[unsupported, noHistory], 30_000],
    [[repository(0)], 10_000],
    [[repository(1)], 20_000],
    [[repository(10)], 20_000],
    [[repository(11)], 30_000],
    [[repository(40)], 50_000],
    [[repository(41)], 60_000],
    [[repository(44), repository(19)], 60_000],
    [[repository(20), repository(20)], 30_000],
    [[repository(10), unsupported], 30_000],
    [[repository(10), noHistory], 30_000],
    [[repository(40), unsupported], 50_000],
    [[repository(80)], 90_000],
    [[repository(101)], 120_000],
    [[repository(110)], 120_000],
    [[repository(111)], 120_000],
    [[repository(600)], 120_000],
  ] satisfies Array<[DiscoveryIndexingEstimate[] | undefined, number]>)(
    "selects a bounded wait for %j",
    (entries, expected) => {
      expect(discoveryIndexingWaitMs(entries)).toBe(expected);
    },
  );

  it("does not subtract active elapsed time or sum shared target labels", () => {
    const entry = repository(40);
    entry.targets.push("github:expressjs/express");
    entry.estimate = { ...entry.estimate, elapsedSeconds: 90 };
    expect(discoveryIndexingWaitMs([entry])).toBe(50_000);
  });
});
