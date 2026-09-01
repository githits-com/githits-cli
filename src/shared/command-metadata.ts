export interface AuthenticatedCommandMetadata {
  path: string;
  autoLoginEligible: boolean;
  postLoginMessage?: string;
  jsonCapable?: boolean;
}

export const AUTHENTICATED_COMMANDS = [
  {
    path: "ask",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Running Agentic Ask...",
    jsonCapable: true,
  },
  {
    path: "example",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Running example search...",
    jsonCapable: true,
  },
  {
    path: "languages",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Loading supported languages...",
    jsonCapable: true,
  },
  {
    path: "resolve",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Resolving target...",
    jsonCapable: true,
  },
  {
    path: "feedback",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Submitting feedback...",
    jsonCapable: true,
  },
  {
    path: "settings",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Loading account settings...",
    jsonCapable: true,
  },
  {
    path: "settings show",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Loading account settings...",
    jsonCapable: true,
  },
  {
    path: "settings get",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Loading account setting...",
    jsonCapable: true,
  },
  {
    path: "settings set",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Updating account settings...",
    jsonCapable: true,
  },
  {
    path: "settings clear",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Clearing account setting...",
    jsonCapable: true,
  },
  {
    path: "settings terms",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Loading terms status...",
    jsonCapable: true,
  },
  {
    path: "settings terms accept",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Accepting terms...",
    jsonCapable: true,
  },
  "search",
  "search-status",
  "code files",
  "code read",
  "code grep",
  "docs list",
  "docs read",
  "pkg info",
  "pkg vulns",
  "pkg deps",
  "pkg changelog",
  "pkg upgrade-review",
].map((entry): AuthenticatedCommandMetadata => {
  if (typeof entry !== "string") return entry;
  return {
    path: entry,
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Running command...",
    jsonCapable: true,
  };
});

export function getAuthenticatedCommandMetadata(
  path: string,
): AuthenticatedCommandMetadata | undefined {
  return AUTHENTICATED_COMMANDS.find((entry) => entry.path === path);
}
