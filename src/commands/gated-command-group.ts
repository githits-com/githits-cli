import { resolveStartupCodeNavigationRegistrationState } from "../container.js";
import {
  type CodeNavigationCapability,
  getCodeNavigationUrl,
  getEnvApiToken,
  isCodeNavigationCliOverrideEnabled,
} from "../services/index.js";

export interface GatedCommandGroupOptions {
  codeNavigationUrl?: string;
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
  envTokenPresent?: boolean;
  expiredStoredAuth?: boolean;
}

export interface GatedCommandGroupRegistrationState {
  codeNavigationUrl: string | undefined;
  shouldRegister: boolean;
}

export async function resolveGatedCommandGroupRegistrationState(
  options: GatedCommandGroupOptions = {},
): Promise<GatedCommandGroupRegistrationState> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();
  if (!codeNavigationUrl) {
    return { codeNavigationUrl: undefined, shouldRegister: false };
  }

  const overrideEnabled =
    options.overrideEnabled ?? isCodeNavigationCliOverrideEnabled();
  const registrationState =
    options.capability !== undefined || options.expiredStoredAuth !== undefined
      ? {
          capability: options.capability ?? "unknown",
          expiredStoredAuth: options.expiredStoredAuth ?? false,
        }
      : await resolveStartupCodeNavigationRegistrationState();
  const envTokenPresent = options.envTokenPresent ?? Boolean(getEnvApiToken());

  return {
    codeNavigationUrl,
    shouldRegister:
      overrideEnabled ||
      registrationState.capability === "enabled" ||
      envTokenPresent ||
      registrationState.expiredStoredAuth,
  };
}
