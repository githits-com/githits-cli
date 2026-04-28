import { getCodeNavigationUrl } from "../services/index.js";

export interface GatedCommandGroupOptions {
  codeNavigationUrl?: string;
}

export interface GatedCommandGroupRegistrationState {
  codeNavigationUrl: string | undefined;
  shouldRegister: boolean;
}

export async function resolveGatedCommandGroupRegistrationState(
  options: GatedCommandGroupOptions = {},
): Promise<GatedCommandGroupRegistrationState> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();

  return {
    codeNavigationUrl,
    shouldRegister: codeNavigationUrl.length > 0,
  };
}
