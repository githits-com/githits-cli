import type { CodeNavigationTarget } from "@githits/core-internal";
import { InvalidArgumentError, KNOWN_REGISTRIES } from "./package-spec.js";

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

interface ProviderGrammar {
  readonly prefix: string;
  readonly host: string;
  readonly name: string;
  readonly path: string;
  readonly allowHttp: boolean;
  readonly hostShorthand: boolean;
  readonly validatePath: (segments: string[]) => boolean;
}

function validComponent(value: string): boolean {
  return value !== "." && value !== ".." && REPO_PATTERN.test(value);
}

function validGithubPath(parts: string[]): boolean {
  return (
    parts.length === 2 &&
    GITHUB_OWNER_PATTERN.test(parts[0]!) &&
    validComponent(parts[1]!)
  );
}

function validCodebergPath(parts: string[]): boolean {
  return (
    parts.length === 2 &&
    parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
  );
}

// GitLab reserves these routes rather than allowing them as repository identity.
// https://docs.gitlab.com/user/reserved_names/
const GITLAB_TOP_LEVEL_ROUTE =
  /^(?:-|\.well-known|404\.html|422\.html|500\.html|502\.html|503\.html|admin|api|apple-touch-icon\.png|assets|dashboard|deploy\.html|explore|favicon\.ico|favicon\.png|files|groups|health_check|help|import|jwt|login|oauth|profile|projects|public|robots\.txt|s|search|sitemap|sitemap\.xml|sitemap\.xml\.gz|slash-command-logo\.png|snippets|unsubscribes|uploads|users|v2)$/i;
const GITLAB_PROJECT_ROUTE =
  /^(?:-|badges|blame|blob|builds|commits|create|create_dir|edit|files|find_file|new|preview|raw|refs|tree|update|wikis)$/i;
const GITLAB_MULTI_SEGMENT_ROUTE =
  /(?:^|\/)(?:environments\/folders|gitlab-lfs\/objects|info\/lfs\/objects)(?:\/|$)/i;

function validGitlabPath(parts: string[]): boolean {
  return (
    parts.length >= 2 &&
    parts.every((part) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(part)) &&
    !GITLAB_TOP_LEVEL_ROUTE.test(parts[0]!) &&
    parts.slice(1).every((part) => !GITLAB_PROJECT_ROUTE.test(part)) &&
    !GITLAB_MULTI_SEGMENT_ROUTE.test(parts.slice(1).join("/"))
  );
}

/** Single authority for direct repository hosts, aliases, and path grammar. */
const PROVIDERS: readonly ProviderGrammar[] = Object.freeze([
  Object.freeze({
    prefix: "github:",
    host: "github.com",
    name: "GitHub",
    path: "owner/repo",
    allowHttp: true,
    hostShorthand: true,
    validatePath: validGithubPath,
  }),
  Object.freeze({
    prefix: "codeberg:",
    host: "codeberg.org",
    name: "Codeberg",
    path: "owner/repo",
    allowHttp: false,
    hostShorthand: false,
    validatePath: validCodebergPath,
  }),
  Object.freeze({
    prefix: "gitlab:",
    host: "gitlab.com",
    name: "GitLab",
    path: "group[/subgroup...]/project",
    allowHttp: false,
    hostShorthand: false,
    validatePath: validGitlabPath,
  }),
]);
const REPOSITORY_TARGET_ERROR =
  "Repository target must be github:owner/repo, codeberg:owner/repo, or gitlab:group[/subgroup...]/project, or an approved full HTTPS URL, with optional #gitRef or @gitRef suffix.";

/** Recognize explicit repository forms without guessing a provider. */
export function normaliseRepositoryTargetSpec(
  spec: string,
): string | undefined {
  const trimmed = spec.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://"))
    return trimmed;
  for (const provider of PROVIDERS) {
    if (lower.startsWith(provider.prefix))
      return `https://${provider.host}/${trimmed.slice(provider.prefix.length)}`;
    if (provider.hostShorthand && lower.startsWith(`${provider.host}/`))
      return `https://${trimmed}`;
  }
  return undefined;
}

export function isRepositoryTargetSpec(spec: string): boolean {
  return normaliseRepositoryTargetSpec(spec) !== undefined;
}

/** Split the suffix before URL parsing to preserve refs and reject path coercion. */
export function parseRepositoryTargetSpec(spec: string): CodeNavigationTarget {
  const normalised = normaliseRepositoryTargetSpec(spec);
  if (!normalised) throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  const match = /^(https?):\/\/([^/]+)\/(.*)$/i.exec(normalised);
  if (!match) throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  const scheme = match[1]!;
  const authority = match[2]!;
  const rawPath = match[3]!;
  if (authority.includes("@"))
    throw new InvalidArgumentError(
      "Repository URL targets must not include credentials.",
    );
  if (/[\\?#\s]/.test(authority))
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  // Parse only the authority: URL handles default ports without rewriting paths.
  let host: string;
  try {
    host = new URL(`${scheme}://${authority}`).host;
  } catch {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }
  const provider = PROVIDERS.find((entry) => entry.host === host);
  if (!provider)
    throw new InvalidArgumentError(
      "Repository URL targets must use github.com, codeberg.org, or gitlab.com; unsupported/self-hosted hosts and nondefault ports are not accepted.",
    );
  const guidance = `Use ${provider.prefix}${provider.path} with optional #gitRef or @gitRef, or https://${provider.host}/${provider.path}.`;
  if (scheme.toLowerCase() === "http" && !provider.allowHttp)
    throw new InvalidArgumentError(
      `${provider.name} repository URLs require HTTPS. ${guidance}`,
    );
  if (rawPath.includes("?"))
    throw new InvalidArgumentError(
      `Repository URL targets must not include query parameters. ${guidance}`,
    );
  if (
    provider.prefix === "github:" &&
    !GITHUB_OWNER_PATTERN.test(rawPath.split("/")[0]!)
  )
    throw new InvalidArgumentError(
      `Repository URL targets must use a valid GitHub owner name. ${guidance}`,
    );
  const hash = rawPath.indexOf("#");
  const at = rawPath.indexOf("@");
  if (at !== -1 && hash !== -1 && at < hash)
    throw new InvalidArgumentError(
      `Repository URL targets must use only one ref suffix: #gitRef or @gitRef. ${guidance}`,
    );
  const delimiter = hash !== -1 ? hash : at;
  const path = (
    delimiter === -1 ? rawPath : rawPath.slice(0, delimiter)
  ).replace(/\/$/, "");
  const gitRef = delimiter === -1 ? undefined : rawPath.slice(delimiter + 1);
  if (gitRef === "" || gitRef?.includes("#"))
    throw new InvalidArgumentError(
      `Repository refs must be nonempty and use only one ref suffix. ${guidance}`,
    );
  const parts = path.split("/");
  if (!provider.validatePath(parts)) {
    if (provider.prefix === "github:" && parts.length === 2)
      throw new InvalidArgumentError(
        `Repository URL targets must use a valid GitHub repository name. ${guidance}`,
      );
    throw new InvalidArgumentError(
      `Repository URL targets must point to ${provider.host}/${provider.path}; pass refs with #gitRef or @gitRef. ${provider.name} web subpaths are not repository targets. ${guidance}`,
    );
  }
  const repoUrl = `https://${provider.host}/${path}`;
  return gitRef === undefined ? { repoUrl } : { repoUrl, gitRef };
}

/** Format only validated repository identities; unknown URLs remain unchanged. */
export function formatRepositoryTarget(
  repoUrl: string,
  gitRef?: string,
): string {
  let compact = repoUrl;
  try {
    const parsed = parseRepositoryTargetSpec(repoUrl);
    if (parsed.repoUrl && parsed.gitRef === undefined) {
      const url = new URL(parsed.repoUrl);
      const provider = PROVIDERS.find((entry) => entry.host === url.host)!;
      compact = `${provider.prefix}${url.pathname.slice(1)}`;
    }
  } catch {
    /* Keep unsupported backend identities lossless. */
  }
  return gitRef ? `${compact}#${gitRef}` : compact;
}

/** Bare backend labels require an explicit repository identity, never a default host. */
export function formatRepositoryTargetLabel(
  label: string,
  repoUrl?: string,
): string | undefined {
  if (isRepositoryTargetSpec(label)) {
    try {
      const parsed = parseRepositoryTargetSpec(label);
      return formatRepositoryTarget(parsed.repoUrl!, parsed.gitRef);
    } catch {
      return undefined;
    }
  }
  if (!repoUrl) return undefined;
  try {
    const parsed = parseRepositoryTargetSpec(repoUrl);
    const path = new URL(parsed.repoUrl!).pathname.slice(1);
    if (label === path) return formatRepositoryTarget(parsed.repoUrl!);
    if (label.startsWith(`${path}@`) && label.length > path.length + 1)
      return formatRepositoryTarget(
        parsed.repoUrl!,
        label.slice(path.length + 1),
      );
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildInvalidTargetSpecError(
  spec: string,
  cause?: string,
): InvalidArgumentError {
  const prefix = cause
    ? `${cause} `
    : `Target spec "${spec}" is not recognized. `;
  return new InvalidArgumentError(
    `${prefix}Expected package target <registry>:<name>[@<version>] (supported registries: ${KNOWN_REGISTRIES.join(
      ", ",
    )}) or repository target github:owner/repo, codeberg:owner/repo, or gitlab:group[/subgroup...]/project with optional #ref or @ref (approved full HTTPS URLs also accepted; GitHub additionally supports github.com/owner/repo and HTTP).`,
  );
}
