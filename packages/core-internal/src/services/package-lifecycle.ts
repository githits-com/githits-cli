import { z } from "zod";

/** Backend-owned categories remain forward compatible with additive enum values. */
export type PackageLifecycleCategory =
  | "DEPRECATION"
  | "WITHDRAWAL"
  | (string & {});
export type PackageLifecycleKind =
  | "DEPRECATED"
  | "RETIRED"
  | "ABANDONED"
  | "DISCONTINUED"
  | "YANKED"
  | "PARTIALLY_YANKED"
  | "RETRACTED"
  | "UNLISTED"
  | (string & {});
export type PackageLifecycleScope =
  | "PACKAGE"
  | "RELEASE"
  | "FILES"
  | (string & {});
export type PackageLifecycleCheckStatus =
  | "CHECKED"
  | "UNKNOWN"
  | "NOT_COLLECTED"
  | "NOT_APPLICABLE"
  | (string & {});
export type PackageLifecycleCheckReason =
  | "NATIVE_EVIDENCE_UNAVAILABLE"
  | "UNVERSIONED_BRANCH"
  | "METADATA_UNAVAILABLE"
  | "LOOKUP_FAILED"
  | "COMPARISON_UNKNOWN"
  | (string & {});

/** A native fact, not a vulnerability or a client-selected upgrade policy. */
export interface PackageLifecycleFinding {
  registry: string;
  name: string;
  /** Affected release; null/absent for package-wide evidence. */
  version?: string | null;
  category: PackageLifecycleCategory;
  kind: PackageLifecycleKind;
  scope: PackageLifecycleScope;
  source: string;
  /** Authority release, which may differ from the affected/selected release. */
  sourceVersion?: string | null;
  /** Acquisition time, not a status-change time or freshness guarantee. */
  observedAt?: string | null;
  reason?: string | null;
  reasonCodes: string[];
  /** Publisher advice, not a resolved upgrade recommendation. */
  replacement?: string | null;
}

export interface PackageLifecycleCheck {
  status: PackageLifecycleCheckStatus;
  reason?: PackageLifecycleCheckReason | null;
}

export interface PackageLifecycleRetainedWarning {
  registry: string;
  name: string;
  version: string;
  classification: "LEGACY_UNCLASSIFIED" | (string & {});
  reason: string;
}

/** Native evidence and independent observation outcomes for the selected release. */
export interface PackageLifecycle {
  findings: PackageLifecycleFinding[];
  checks: {
    deprecation: PackageLifecycleCheck;
    withdrawal: PackageLifecycleCheck;
    registryArchival: PackageLifecycleCheck;
    repositoryArchival: PackageLifecycleCheck;
  };
  retainedWarnings: PackageLifecycleRetainedWarning[];
  contentSafety: { filtered: boolean };
}

const lifecycleCheckSchema = z.object({
  status: z.string(),
  reason: z.string().nullish(),
});

/** Validate structure without rejecting future backend categorical values. */
export const packageLifecycleSchema: z.ZodType<PackageLifecycle> = z.object({
  findings: z.array(
    z.object({
      registry: z.string(),
      name: z.string(),
      version: z.string().nullish(),
      category: z.string(),
      kind: z.string(),
      scope: z.string(),
      source: z.string(),
      sourceVersion: z.string().nullish(),
      observedAt: z.string().nullish(),
      reason: z.string().nullish(),
      reasonCodes: z.array(z.string()),
      replacement: z.string().nullish(),
    }),
  ),
  checks: z.object({
    deprecation: lifecycleCheckSchema,
    withdrawal: lifecycleCheckSchema,
    registryArchival: lifecycleCheckSchema,
    repositoryArchival: lifecycleCheckSchema,
  }),
  retainedWarnings: z.array(
    z.object({
      registry: z.string(),
      name: z.string(),
      version: z.string(),
      classification: z.string(),
      reason: z.string(),
    }),
  ),
  contentSafety: z.object({ filtered: z.boolean() }),
});
