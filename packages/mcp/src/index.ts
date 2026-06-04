import {
  createWorkspaceScaffoldCorePayload,
  type WorkspaceScaffoldCorePayload,
} from "@githits/core-internal";

export interface WorkspaceScaffoldMcpEnvelope<TValue> {
  source: "@githits/mcp";
  core: WorkspaceScaffoldCorePayload<TValue>;
}

export function createWorkspaceScaffoldMcpEnvelope<TValue>(
  value: TValue,
): WorkspaceScaffoldMcpEnvelope<TValue> {
  return {
    source: "@githits/mcp",
    core: createWorkspaceScaffoldCorePayload(value),
  };
}
