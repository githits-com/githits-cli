/**
 * Diagnostic logging gated by `GITHITS_DEBUG`.
 *
 * Emits a single line of JSON to stderr when the caller's `area`
 * matches the env-var scope. This is the shared diagnostics path for
 * service integrations that need low-friction field debugging without
 * inventing per-feature flags.
 *
 * **PII policy.** Most debug payloads carry error codes, parsed spec
 * shape, and request parameter *names* — never the user's query
 * text, bearer tokens, response bodies, or any other caller-owned
 * content. The one explicit exception is the opt-in `code-nav-wire`
 * scope, which logs the exact GraphQL document and serialised
 * variables for code-navigation requests. Callers are responsible for
 * filtering before passing payloads here; this module does not inspect
 * payload contents.
 *
 * **Scope syntax.**
 * - `GITHITS_DEBUG=*` enables every non-sensitive area.
 * - `GITHITS_DEBUG=code-nav` scopes to the safe code-navigation area.
 * - `GITHITS_DEBUG=code-nav-wire` logs exact GraphQL + variables for
 *   code-navigation requests. It is explicit-only and is not enabled
 *   by `*`.
 * - `GITHITS_DEBUG=code-nav,auth` comma-separated list.
 * - Unset or empty: no output.
 */
export function debugLog(area: string, payload: Record<string, unknown>): void {
  if (!isAreaEnabled(area)) return;

  const line = {
    ts: new Date().toISOString(),
    area,
    ...payload,
  };

  // Serialisation is best-effort: if the payload contains something
  // non-serialisable (e.g. a BigInt, a circular ref), fall back to a
  // stringified marker rather than throwing from the instrumentation
  // itself.
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({
      ts: line.ts,
      area,
      error: "debug-log payload not serialisable",
    });
  }

  process.stderr.write(`${text}\n`);
}

export function isDebugAreaEnabled(area: string): boolean {
  return isAreaEnabled(area);
}

function isAreaEnabled(area: string): boolean {
  const raw = process.env.GITHITS_DEBUG;
  if (!raw || raw === "") return false;

  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (scopes.includes(area)) return true;
  if (isExplicitOnlyArea(area)) return false;
  return scopes.includes("*");
}

function isExplicitOnlyArea(area: string): boolean {
  return area === "code-nav-wire";
}
