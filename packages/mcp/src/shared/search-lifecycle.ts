/**
 * Fully healthy lifecycle states. STALE remains searchable but is not healthy:
 * render it as provenance, while warnings stay conditional on target divergence.
 */
export function isHealthySearchLifecycleState(state: string): boolean {
  return state === "INDEXED" || state === "CURRENT";
}
