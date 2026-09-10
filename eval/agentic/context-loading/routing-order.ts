import { z } from "zod";

export const routingEventSchema = z.object({
  request: z.number().int().positive(),
  action: z.enum([
    "skill_loaded",
    "bootstrap_discovery",
    "evidence_discovery",
    "quick_start_loaded",
    "evidence_call",
  ]),
});

/**
 * Events are trace-audited observations, not inferred from task completion.
 * Strictly earlier model requests prove the guide could influence discovery;
 * ordering statements inside one generated execution do not.
 */
export function assessRoutingOrder(
  input: unknown,
  delivery: "skill" | "bootstrap",
): {
  skillBeforeAnyDiscovery: boolean | null;
  guideBeforeEvidenceDiscovery: boolean | null;
  guideBeforeEvidenceCall: boolean | null;
} {
  const events = z.array(routingEventSchema).parse(input);
  const first = (
    ...actions: Array<z.infer<typeof routingEventSchema>["action"]>
  ): number | undefined => {
    const requests = events
      .filter((event) => actions.includes(event.action))
      .map((event) => event.request);
    return requests.length ? Math.min(...requests) : undefined;
  };
  const before = (
    loaded: number | undefined,
    selected: number | undefined,
  ): boolean | null =>
    selected === undefined ? null : loaded !== undefined && loaded < selected;
  const skill = first("skill_loaded");
  const guide = delivery === "skill" ? skill : first("quick_start_loaded");
  return {
    skillBeforeAnyDiscovery: before(
      skill,
      first("bootstrap_discovery", "evidence_discovery"),
    ),
    guideBeforeEvidenceDiscovery: before(guide, first("evidence_discovery")),
    guideBeforeEvidenceCall: before(guide, first("evidence_call")),
  };
}
