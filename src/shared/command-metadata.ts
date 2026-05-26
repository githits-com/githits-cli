export interface AuthenticatedCommandMetadata {
  path: string;
  autoLoginEligible: boolean;
  postLoginMessage?: string;
  jsonCapable?: boolean;
}

export const AUTHENTICATED_COMMANDS = [
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
    path: "feedback",
    autoLoginEligible: true,
    postLoginMessage: "Authentication complete. Submitting feedback...",
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
