import { ProviderReauthenticationRequiredError } from "@githits/core-internal/browser";
import type { MappedError } from "./mapped-error.js";

export function mapProviderReauthenticationError(
  error: unknown,
): MappedError | undefined {
  if (!(error instanceof ProviderReauthenticationRequiredError))
    return undefined;
  return {
    code: error.code,
    message: error.message,
    retryable: false,
    details: {
      ...(error.reauthUrl ? { reauthUrl: error.reauthUrl } : {}),
      action: error.reauthUrl
        ? `Open ${error.reauthUrl}, finish signing in, then retry your request.`
        : "Sign in again in the GitHits app, then retry your request.",
    },
  };
}
