export interface WorkspaceScaffoldMcpEnvelope<TValue> {
  source: "@githits/mcp";
  value: TValue;
}

export function createWorkspaceScaffoldMcpEnvelope<TValue>(
  value: TValue,
): WorkspaceScaffoldMcpEnvelope<TValue> {
  return {
    source: "@githits/mcp",
    value,
  };
}
