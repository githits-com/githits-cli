import { TermsAcceptanceRequiredError } from "@githits/core-internal/browser";
import type { MappedError } from "./mapped-error.js";

/** Map the transport-neutral terms gate into the shared error envelope. */
export function mapTermsAcceptanceError(
  error: unknown,
): MappedError | undefined {
  if (!(error instanceof TermsAcceptanceRequiredError)) return undefined;
  return {
    code: "TERMS_ACCEPTANCE_REQUIRED",
    message: error.message,
    retryable: false,
    details: {
      termsUrl: error.termsUrl,
      acceptanceUrl: error.acceptanceUrl,
    },
  };
}
