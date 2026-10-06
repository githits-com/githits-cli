export {
  CLIENT_UPDATE_REQUIRED_REASON,
  ClientUpdateRequiredError,
} from "./services/client-update-required-error.js";
export {
  type AvailableRef,
  CodeDiffError,
  CodeNavigationAccessError,
  CodeNavigationBackendError,
  type CodeNavigationErrorMetadata,
  CodeNavigationFeatureFlagRequiredError,
  CodeNavigationFileNotFoundError,
  CodeNavigationGraphQLError,
  CodeNavigationIndexingError,
  CodeNavigationNetworkError,
  CodeNavigationRefNotFoundError,
  CodeNavigationTargetNotFoundError,
  CodeNavigationUnresolvableError,
  CodeNavigationValidationError,
  CodeNavigationVersionNotFoundError,
  MalformedCodeNavigationResponseError,
} from "./services/code-navigation-service.js";
export type { AuthenticationErrorSource } from "./services/githits-service-errors.js";
export {
  ApiRateLimitError,
  AUTHENTICATION_REQUIRED_MESSAGE,
  AuthenticationError,
  LOCAL_AUTHENTICATION_MISSING_MESSAGE,
  SERVER_AUTHENTICATION_REJECTED_MESSAGE,
} from "./services/githits-service-errors.js";
export {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceAccessError,
  PackageIntelligenceBackendError,
  PackageIntelligenceDocumentationSectionUnresolvedError,
  PackageIntelligenceFeatureFlagRequiredError,
  PackageIntelligenceGraphQLError,
  PackageIntelligenceNetworkError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceValidationError,
  PackageIntelligenceVersionNotFoundError,
} from "./services/package-intelligence-service.js";
export type {
  ResolveTargetKind,
  ResolveTargetParams,
} from "./services/resolve-target-service.js";
export { FetchTimeoutError } from "./shared/fetch-timeout.js";
export {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_ARGS,
  PKGSEER_REGISTRY_LIST,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "./shared/pkgseer-registry.js";
export type { TermsAcceptanceRemediation } from "./shared/terms-acceptance.js";
export {
  TERMS_ACCEPTANCE_REQUIRED_CODE,
  TERMS_ACCEPTANCE_URL,
  TERMS_URL,
  TermsAcceptanceRequiredError,
} from "./shared/terms-acceptance.js";
