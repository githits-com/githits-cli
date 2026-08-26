import { TermsAcceptanceRequiredError } from "@githits/core-internal";
import type { MappedError } from "./mapped-error.js";

export function mapTermsAcceptanceError(
  error: unknown,
): MappedError | undefined {
  if (!(error instanceof TermsAcceptanceRequiredError)) return undefined;
  return {
    code: "TERMS_ACCEPTANCE_REQUIRED",
    message: error.message,
    retryable: false,
    details: {
      action: "githits settings terms accept",
      termsUrl: error.termsUrl,
      acceptanceUrl: error.acceptanceUrl,
    },
  };
}
