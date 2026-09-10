import { expect, it } from "bun:test";
import { assessRoutingOrder } from "./routing-order.js";

it("does not count a skill read batched with discovery as prior guidance", () => {
  expect(
    assessRoutingOrder(
      [
        { request: 1, action: "skill_loaded" },
        { request: 1, action: "evidence_discovery" },
        { request: 2, action: "evidence_call" },
      ],
      "skill",
    ),
  ).toEqual({
    skillBeforeAnyDiscovery: false,
    guideBeforeEvidenceDiscovery: false,
    guideBeforeEvidenceCall: true,
  });
});

it("allows discovering bootstrap itself but requires its response before evidence discovery", () => {
  const events = [
    { request: 1, action: "skill_loaded" },
    { request: 2, action: "bootstrap_discovery" },
    { request: 3, action: "quick_start_loaded" },
    { request: 4, action: "evidence_discovery" },
    { request: 5, action: "evidence_call" },
  ];
  expect(assessRoutingOrder(events, "bootstrap")).toEqual({
    skillBeforeAnyDiscovery: true,
    guideBeforeEvidenceDiscovery: true,
    guideBeforeEvidenceCall: true,
  });
  expect(
    assessRoutingOrder(
      [...events, { request: 2, action: "evidence_discovery" }],
      "bootstrap",
    ).guideBeforeEvidenceDiscovery,
  ).toBe(false);
});

it("distinguishes a missing guide from unobserved discovery", () => {
  expect(
    assessRoutingOrder([{ request: 1, action: "evidence_call" }], "bootstrap"),
  ).toEqual({
    skillBeforeAnyDiscovery: null,
    guideBeforeEvidenceDiscovery: null,
    guideBeforeEvidenceCall: false,
  });
});
