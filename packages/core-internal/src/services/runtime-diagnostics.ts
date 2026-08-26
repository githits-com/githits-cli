/**
 * Host-supplied diagnostics for transport-neutral service clients.
 *
 * Implementations may record operation timings or debug events in whatever
 * way is appropriate for their host. Core does not provide a default and
 * remains silent when diagnostics are omitted.
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
