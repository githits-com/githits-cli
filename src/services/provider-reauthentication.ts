import { ProviderReauthenticationRequiredError } from "@githits/core-internal";
import type { BrowserService } from "./browser-service.js";

/** One browser attempt per local container; the caller retries after sign-in. */
export function createProviderRecoveryHandler(
  browser: BrowserService,
  enabled: boolean,
): (error: unknown) => Promise<never> {
  let attempted = false;
  return async (error: unknown): Promise<never> => {
    if (
      enabled &&
      !attempted &&
      error instanceof ProviderReauthenticationRequiredError &&
      error.reauthUrl
    ) {
      attempted = true;
      try {
        await browser.open(error.reauthUrl);
      } catch {
        // The original failure still carries the URL for manual sign-in.
      }
    }
    throw error;
  };
}
