export interface WorkspaceScaffoldCoreIdentity {
  packageName: "githits-core";
  boundary: "core";
}

export interface WorkspaceScaffoldCorePayload<TValue> {
  identity: WorkspaceScaffoldCoreIdentity;
  value: TValue;
}

export function createWorkspaceScaffoldCorePayload<TValue>(
  value: TValue,
): WorkspaceScaffoldCorePayload<TValue> {
  return {
    identity: {
      packageName: "githits-core",
      boundary: "core",
    },
    value,
  };
}
