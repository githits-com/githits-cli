export type { AuthenticationErrorSource } from "./services/githits-service-errors.js";
export {
  ApiRateLimitError,
  AUTHENTICATION_REQUIRED_MESSAGE,
  AuthenticationError,
  LOCAL_AUTHENTICATION_MISSING_MESSAGE,
  SERVER_AUTHENTICATION_REJECTED_MESSAGE,
} from "./services/githits-service-errors.js";

export { FetchTimeoutError } from "./shared/fetch-timeout.js";
export type { TermsAcceptanceRemediation } from "./shared/terms-acceptance.js";
export {
  TERMS_ACCEPTANCE_REQUIRED_CODE,
  TERMS_ACCEPTANCE_URL,
  TERMS_URL,
  TermsAcceptanceRequiredError,
} from "./shared/terms-acceptance.js";
