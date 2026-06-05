export {
  DEFAULT_FETCH_TIMEOUT_MS,
  debugLog,
  endTelemetrySpan,
  FetchTimeoutError,
  fetchWithTimeout,
  flushTelemetry,
  isFetchTimeoutError,
  isKnownPkgseerRegistryArg,
  isTelemetryEnabled,
  knownPkgseerRegistryArgs,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  resetTelemetryCollectorForTests,
  startTelemetrySpan,
  type TelemetryAttributes,
  TelemetryCollector,
  type TelemetrySpanHandle,
  toPkgseerRegistry,
  toPkgseerRegistryLowercase,
  withTelemetrySpan,
  withTelemetrySpanSync,
} from "@githits/core-internal";
export { parseIntCliOption } from "./cli-options.js";
export {
  type CodeNavigationRegistryArg,
  type FileIntentArg,
  isKnownFileIntent,
  isKnownSymbolKind,
  knownFileIntentList,
  knownSymbolCategoryList,
  knownSymbolKindList,
  type SymbolCategoryArg,
  toCodeNavigationRegistry,
  toFileIntent,
  toSymbolCategory,
  toSymbolKind,
} from "./code-navigation.js";
export {
  DEFAULT_WAIT_TIMEOUT_MS,
  FILE_INTENT_ALL,
  type FileIntentInput,
  MAX_WAIT_TIMEOUT_MS,
} from "./code-navigation-defaults.js";
export {
  type MappedError,
  type MappedErrorCode,
  mapCodeNavigationError,
} from "./code-navigation-error-map.js";
export { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";
export {
  colorize,
  colors,
  dim,
  error,
  highlight,
  highlightMatch,
  highlightRanges,
  shouldUseColors,
  success,
  warning,
} from "./colors.js";
export { lowerDocSourceKind } from "./docs-follow-up.js";
export { extractSolutionId } from "./extract-solution-id.js";
export {
  buildCodeReadCommand,
  buildDocsReadCommand,
  buildSearchHitFollowUpCommand,
} from "./follow-up-command-text.js";
export {
  buildGrepRepoParams,
  GREP_REPO_PATTERN_NOTE,
  GREP_REPO_SYMBOL_FIELDS,
  GREP_REPO_SYMBOL_FIELDS_NOTE,
  type GrepRepoRequestBuildResult,
  type GrepRepoRequestInput,
  type GrepRepoSymbolField,
} from "./grep-repo-request.js";
export {
  type BuildGrepRepoPayloadOptions,
  buildGrepRepoSuccessPayload,
  type FormatGrepRepoTerminalOptions,
  type FormattedGrepRepoTerminal,
  formatGrepRepoTerminal,
  type LeanGrepRepoEnvelope,
  type LeanGrepRepoFilter,
  type LeanGrepRepoMatch,
} from "./grep-repo-response.js";
export { renderGrepRepoText } from "./grep-repo-text.js";
export {
  filterLanguages,
  type LanguageMatch,
} from "./language-filter.js";
export { renderListFilesText } from "./list-files-text.js";
export {
  buildListPackageDocsParams,
  type ListPackageDocsRequestBuildResult,
  type ListPackageDocsRequestInput,
} from "./list-package-docs-request.js";
export {
  buildListPackageDocsSuccessPayload,
  formatListPackageDocsTerminal,
  type LeanPackageDocListEntry,
  type LeanPackageDocsEnvelope,
} from "./list-package-docs-response.js";
export { renderListPackageDocsText } from "./list-package-docs-text.js";
export {
  InvalidKeywordsError,
  normaliseKeywords,
} from "./normalise-keywords.js";
export {
  buildPackageDependenciesParams,
  type DependencyLifecycle,
  isLifecycle,
  type PackageDependenciesRequestBuildResult,
  type PackageDependenciesRequestInput,
  supportsDependenciesRegistry,
  UnsupportedDependenciesRegistryError,
} from "./package-dependencies-request.js";
export {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
  type LeanDependencyReport,
  type LeanDirectDependency,
  type LeanFilterBlock,
  type LeanGroup,
  type LeanGroupDependency,
  type LeanGroupsBlock,
  type LeanRuntimeBlock,
  type LeanTransitiveBlock,
} from "./package-dependencies-response.js";
export { mapPackageIntelligenceError } from "./package-intelligence-error-map.js";
export {
  InvalidArgumentError,
  InvalidPackageSpecError,
  isKnownRegistry,
  KNOWN_REGISTRIES,
  type KnownRegistry,
  type ParsedPackageSpec,
  parsePackageSpec,
  UnsupportedRegistryError,
} from "./package-spec.js";
export {
  buildPackageSummaryParams,
  type PackageSummaryRequestBuildResult,
  type PackageSummaryRequestInput,
} from "./package-summary-request.js";
export {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
  type LeanPackageSummary,
  type SeverityLabel,
  severityLabel,
} from "./package-summary-response.js";
export {
  buildPackageUpgradeReviewRequest,
  buildUpgradeDependencyProbeParams,
  type PackageUpgradeReviewOptions,
  type PackageUpgradeReviewRequestBuildResult,
  type PackageUpgradeReviewRequestInput,
  type UpgradeReviewPackageInput,
  type UpgradeReviewPackageRequest,
} from "./package-upgrade-review-request.js";
export {
  buildPackageUpgradeReview,
  formatPackageUpgradeReviewTerminal,
  type UpgradeAdvisorySummary,
  type UpgradeChangelog,
  type UpgradeChangelogEntry,
  type UpgradeCompatibility,
  type UpgradeDependencyChangeGroup,
  type UpgradeDependencyChangeItem,
  type UpgradeDependencyChanges,
  type UpgradeDependencyIssues,
  type UpgradeReview,
  type UpgradeReviewResponse,
  type UpgradeSecurity,
  type UpgradeTransitiveSecurity,
  type UpgradeTransitiveVulnerablePackage,
  type VersionDelta,
  type VersionVulnerabilitySummary,
} from "./package-upgrade-review-response.js";
export {
  buildPackageVulnerabilitiesParams,
  type PackageVulnerabilitiesRequestBuildResult,
  type PackageVulnerabilitiesRequestInput,
  SEVERITY_LABEL_TO_CVSS,
  supportsVulnerabilitiesRegistry,
  UnsupportedVulnerabilitiesRegistryError,
} from "./package-vulnerabilities-request.js";
export {
  buildPackageVulnerabilitiesSuccessPayload,
  computeBySeverity,
  dedupAdvisoriesByAlias,
  formatPackageVulnerabilitiesTerminal,
  type LeanAdvisory,
  type LeanVulnerabilityReport,
  type LeanVulnerabilitySummary,
  type VulnSeverityLabel,
  vulnSeverityLabel,
} from "./package-vulnerabilities-response.js";
export { type LineRange, parseLinesOption } from "./parse-lines-option.js";
export { renderReadFileText } from "./read-file-text.js";
export {
  buildReadPackageDocParams,
  type ReadPackageDocRequestBuildResult,
  type ReadPackageDocRequestInput,
} from "./read-package-doc-request.js";
export {
  buildReadPackageDocSuccessPayload,
  formatReadPackageDocTerminal,
  type LeanPackageDocEnvelope,
} from "./read-package-doc-response.js";
export { renderReadPackageDocText } from "./read-package-doc-text.js";
export {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  formatAuthRequiredForTerminal,
  requireAuth,
} from "./require-auth.js";
export {
  createRootCliPreAction,
  type RootCliPreActionDependencies,
} from "./root-cli-pre-action.js";
export { type Spinner, startSpinner } from "./spinner.js";
export { SPINNER_MESSAGES } from "./spinner-messages.js";
export {
  buildRetryCandidateLine,
  buildTargetResolutionNotes,
  type LeanAvailableArtifact,
  type LeanTargetResolution,
  type LeanTargetResolutionIdentity,
  projectTargetResolution,
} from "./target-resolution.js";
export {
  buildUnifiedSearchParams,
  type UnifiedSearchRequestBuildResult,
  type UnifiedSearchRequestInput,
} from "./unified-search-request.js";
export {
  buildUnifiedSearchErrorPayload,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
  type UnifiedSearchCompletedPayload,
  type UnifiedSearchErrorPayload,
  type UnifiedSearchHitPayload,
  type UnifiedSearchIncompletePayload,
  type UnifiedSearchQueryEcho,
  type UnifiedSearchStatusCompletedPayload,
  type UnifiedSearchStatusIncompletePayload,
  type UnifiedSearchStatusResultPayload,
} from "./unified-search-response.js";
export { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";
export { parseUnifiedSearchTargetSpec } from "./unified-search-target.js";
export {
  renderUnifiedSearchError,
  renderUnifiedSearchSuccess,
} from "./unified-search-text.js";
