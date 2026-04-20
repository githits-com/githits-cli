/**
 * Diagnostic logging gated by `GITHITS_DEBUG`.
 *
 * Emits a single line of JSON to stderr when the caller's `area`
 * matches the env-var scope. Intended for error-path instrumentation
 * so real-world failures of the new typed-error mapping are
 * diagnosable without asking users to run with a flag we added after
 * the fact.
 *
 * **PII policy.** Debug payloads carry error codes, parsed spec
 * shape, and request parameter *names* — never the user's query
 * text, bearer tokens, response bodies, or any other caller-owned
 * content. Callers are responsible for filtering before passing
 * payloads here; this module does not inspect payload contents.
 *
 * **Scope syntax.**
 * - `GITHITS_DEBUG=*` enables every area.
 * - `GITHITS_DEBUG=code-nav` scopes to the `code-nav` area.
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

function isAreaEnabled(area: string): boolean {
  const raw = process.env.GITHITS_DEBUG;
  if (!raw || raw === "") return false;
  if (raw === "*") return true;

  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes.includes(area) || scopes.includes("*");
}
