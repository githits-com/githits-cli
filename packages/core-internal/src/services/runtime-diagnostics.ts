/**
 * Host-supplied diagnostics for transport-neutral service clients.
 *
 * Implementations may record operation timings or debug events in whatever
 * way is appropriate for their host. Core does not provide a default and
 * remains silent when diagnostics are omitted. Core callers gate every debug
 * event through `isEnabled(area)`; when it returns `false`, the corresponding
 * debug call is suppressed entirely. Returning `true` is therefore both a log
 * filter and a content-disclosure decision for the host.
 *
 * In particular, the `code-nav-wire` area may carry the exact GraphQL document
 * and request variables, including caller query text, so it requires separate
 * explicit opt-in. The `code-nav` and `pkg-graphql` schema-mismatch paths may
 * carry raw backend error text, and an enabled area may select that raw error
 * content instead of the sanitized message. These areas are not PII-safe;
 * hosts own their privacy and retention policy for any enabled diagnostics.
 */
export interface ServiceDiagnostics {
  withOperation<T>(name: string, operation: () => Promise<T>): Promise<T>;
  isEnabled(area: string): boolean;
  debug(area: string, event: Record<string, unknown>): void;
}

/**
 * Run an operation with optional host diagnostics while preserving its value
 * and thrown errors.
 */
export function withServiceDiagnostics<T>(
  diagnostics: ServiceDiagnostics | undefined,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  return diagnostics ? diagnostics.withOperation(name, operation) : operation();
}
