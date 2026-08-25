export interface InitTraceProbeInput {
  agentId: string;
  phase: string;
  command?: string;
  args?: readonly string[];
  path?: string;
}

export interface InitTraceProbeEndInput extends InitTraceProbeInput {
  startedAt: number;
  exitCode?: number;
  status: "end" | "timeout" | "error";
  result?:
    | "configured"
    | "not_configured"
    | "non_canonical"
    | "disabled"
    | "probe_failed";
}

export function isInitTraceEnabled(): boolean {
  return process.env.GITHITS_INIT_TRACE === "1";
}

export function formatCommandForDiagnostics(
  command: string,
  args: readonly string[] = [],
): string {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

export function traceInit(message: string): void {
  if (!isInitTraceEnabled()) {
    return;
  }
  console.error(`[githits:init] ${message}`);
}

export function traceProbeStart(input: InitTraceProbeInput): void {
  const command = input.command
    ? ` command=${formatCommandForDiagnostics(input.command, input.args)}`
    : "";
  const path = input.path ? ` path=${JSON.stringify(input.path)}` : "";
  traceInit(
    `probe:start agent=${input.agentId} phase=${input.phase}${command}${path}`,
  );
}

export function traceProbeEnd(input: InitTraceProbeEndInput): void {
  const elapsedMs = Date.now() - input.startedAt;
  const exitCode =
    input.exitCode === undefined ? "" : ` exitCode=${input.exitCode}`;
  const result = input.result === undefined ? "" : ` result=${input.result}`;
  traceInit(
    `probe:${input.status} agent=${input.agentId} phase=${input.phase} elapsedMs=${elapsedMs}${exitCode}${result}`,
  );
}
