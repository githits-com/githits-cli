import type {
  AuthenticationErrorSource,
  AvailableRef,
  AvailableVersion,
  CodeDiffPackageInfo,
  CodeDiffRefResolution,
  IndexingDurationEstimate,
  SuggestedRef,
  TargetResolution,
} from "@githits/core-internal";

export type MappedErrorCode =
  | "NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "FILE_PATH_EXCLUDED"
  | "SOURCE_FILE_INVENTORY_UNKNOWN"
  | "REF_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "INDEXING"
  | "UNRESOLVABLE"
  | "ACCESS_DENIED"
  | "AUTH_REQUIRED"
  | "TERMS_ACCEPTANCE_REQUIRED"
  | "NETWORK"
  | "INVALID_ARGUMENT"
  | "BACKEND_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROTOCOL_ERROR"
  | "UPDATE_REQUIRED"
  | "UNKNOWN";

export interface MappedErrorDetails {
  action?: string;
  hint?: string;
  availableVersions?: AvailableVersion[];
  availableRefs?: AvailableRef[];
  suggestedRefs?: SuggestedRef[];
  targetResolution?: TargetResolution;
  indexingRef?: string;
  indexingEstimate?: IndexingDurationEstimate;
  status?: number;
  retryAfterSeconds?: number;
  timeoutMs?: number;
  graphqlCode?: string;
  /**
   * Populated on `VERSION_NOT_FOUND` from the backend's
   * `extensions.latest_indexed` — the newest version that is
   * actually indexed, suitable as the first recovery suggestion.
   */
  latestIndexed?: string;
  /** The version the caller asked for (for `VERSION_NOT_FOUND`). */
  requestedVersion?: string;
  /** Fully-qualified package identifier (for `VERSION_NOT_FOUND`). */
  package?: string;
  /** Repository URL for `REF_NOT_FOUND`. */
  repoUrl?: string;
  /** Git ref the caller asked for (for `REF_NOT_FOUND`). */
  requestedRef?: string;
  /** The exact file path involved in a path-authority error. */
  filePath?: string;
  /** Why an exact path was omitted from the indexed source inventory. */
  exclusionReason?: string;
  /** Installed CLI version when an update is required. */
  currentVersion?: string;
  /** Suggested package-manager command when an update is required. */
  updateCommand?: string;
  /** Human-readable update reason. */
  reason?: string;
  /** Whether auth failed before making a request or after backend rejection. */
  authSource?: AuthenticationErrorSource;
  /** Canonical legal document URL for terms-acceptance remediation. */
  termsUrl?: string;
  /** Authenticated web UI where the user can accept the current terms. */
  acceptanceUrl?: string;
  /** CodeDiff comparison side involved in a bounded resolver failure. */
  side?: string;
  /** Published package versions supplied for CodeDiff recovery. */
  publishedVersions?: string[];
  publishedVersionsTruncated?: boolean;
  /** Canonical registry supplied by a CodeDiff resolver failure. */
  registry?: string;
  /** Retry delay retained at millisecond precision for CodeDiff. */
  retryAfterMs?: number;
  /** Bounded raw-diff failure stage and limit identifier. */
  stage?: string;
  limitKind?: string;
  /** Git ref supplied by a CodeDiff resolver failure. */
  gitRef?: string;
  /** Ref classifications retained for ambiguous-ref recovery. */
  refKinds?: string[];
  /** Immutable root identity retained when only the raw field failed. */
  codeDiffResolution?: {
    package?: CodeDiffPackageInfo;
    from: CodeDiffRefResolution;
    to: CodeDiffRefResolution;
  };
}

export interface MappedError {
  code: MappedErrorCode;
  message: string;
  /**
   * Whether the caller can retry the same request successfully.
   * Sourced from the backend's `extensions.retryable` when present
   * (April 2026 contract); otherwise a per-code default. Agents and
   * automation use this directly without maintaining their own
   * retryability tables.
   */
  retryable?: boolean;
  details?: MappedErrorDetails;
}
