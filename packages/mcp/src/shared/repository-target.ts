import type { CodeNavigationTarget } from "@githits/core-internal";
import { InvalidArgumentError, KNOWN_REGISTRIES } from "./package-spec.js";

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const LAUNCHPAD_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/;

interface ProviderGrammar {
  readonly prefix?: string;
  readonly host: string;
  readonly prefixAliases?: readonly string[];
  readonly hostAliases?: readonly string[];
  readonly allowGit?: boolean;
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

function validGooglesourcePath(parts: string[]): boolean {
  return parts.every(validComponent) && !parts.at(-1)!.endsWith(".git");
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

/** Canonical Launchpad identities require complete owner-qualified Git paths. */
function validLaunchpadPath(parts: string[]): boolean {
  const owner = parts[0];
  if (!owner?.startsWith("~")) return false;
  let namespace: string[];
  if (parts.length === 3 && parts[1] === "+git") {
    namespace = [owner.slice(1)];
  } else if (parts.length === 4 && parts[2] === "+git") {
    namespace = [owner.slice(1), parts[1]!];
  } else if (
    parts.length === 6 &&
    parts[2] === "+source" &&
    parts[4] === "+git"
  ) {
    namespace = [owner.slice(1), parts[1]!, parts[3]!];
  } else return false;
  const repo = parts.at(-1)!;
  return (
    namespace.every((part) => LAUNCHPAD_NAMESPACE_PATTERN.test(part)) &&
    /^[A-Za-z0-9][A-Za-z0-9+._@-]*$/.test(repo) &&
    !repo.endsWith(".git")
  );
}

/** Mutable defaults are request addresses; the backend acquires their identity. */
function validLaunchpadDefaultPath(parts: string[]): boolean {
  const owner = parts[0]?.startsWith("~");
  const namespace = owner ? [parts[0]!.slice(1), ...parts.slice(1)] : parts;
  if (owner) {
    if (parts.length === 2)
      return namespace.every((part) => LAUNCHPAD_NAMESPACE_PATTERN.test(part));
    if (parts.length !== 4 || parts[2] !== "+source") return false;
    return [namespace[0]!, namespace[1]!, namespace[3]!].every((part) =>
      LAUNCHPAD_NAMESPACE_PATTERN.test(part),
    );
  }
  if (parts.length === 1) return LAUNCHPAD_NAMESPACE_PATTERN.test(parts[0]!);
  return (
    parts.length === 3 &&
    parts[1] === "+source" &&
    [parts[0]!, parts[2]!].every((part) =>
      LAUNCHPAD_NAMESPACE_PATTERN.test(part),
    )
  );
}

/** Normalize provider identity only after splitting the raw ref suffix. */
function repositoryPathParts(
  path: string,
  provider: ProviderGrammar,
): string[] {
  if (provider.name === "Googlesource")
    return path.replace(/\.git$/, "").split("/");
  const parts = path.split("/");
  if (provider.prefix !== "launchpad:") return parts;
  try {
    // Component validators reject decoded separators, controls and double encoding.
    return parts.map((part) => decodeURIComponent(part));
  } catch {
    throw new InvalidArgumentError(
      "Repository paths must use valid percent-encoded components.",
    );
  }
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
  Object.freeze({
    prefix: "launchpad:",
    prefixAliases: ["lp:"],
    host: "git.launchpad.net",
    hostAliases: ["code.launchpad.net"],
    name: "Launchpad",
    path: "~owner/[project/]+git/repo or ~owner/distro/+source/source/+git/repo",
    allowHttp: false,
    allowGit: true,
    hostShorthand: false,
    validatePath: validLaunchpadPath,
  }),
]);

/** Googlesource hosts are distinct DNS identities with no compact prefix. */
function repositoryProvider(host: string): ProviderGrammar | undefined {
  const provider = PROVIDERS.find(
    (entry) => entry.host === host || entry.hostAliases?.includes(host),
  );
  if (provider) return provider;
  if (
    host.length > 253 ||
    !host.endsWith(".googlesource.com") ||
    !host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return undefined;
  return {
    host,
    name: "Googlesource",
    path: "project[/subproject...]",
    allowHttp: false,
    hostShorthand: false,
    validatePath: validGooglesourcePath,
  };
}
const REPOSITORY_TARGET_ERROR =
  "Repository target must be github:owner/repo, codeberg:owner/repo, gitlab:group[/subgroup...]/project, lp:PROJECT, launchpad:~owner/+git/repo, or an approved full HTTPS URL, with optional @gitRef suffix.";

/** Marker for callers that migrate only the retired repository ref spelling. */
export class LegacyRepositoryRefError extends InvalidArgumentError {}

/** Recognize explicit repository forms without guessing a provider. */
export function normaliseRepositoryTargetSpec(
  spec: string,
): string | undefined {
  const trimmed = spec.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://"))
    return trimmed;
  for (const provider of PROVIDERS) {
    const prefix = [provider.prefix, ...(provider.prefixAliases ?? [])].find(
      (entry) => entry !== undefined && lower.startsWith(entry),
    );
    if (prefix)
      return `https://${provider.host}/${trimmed.slice(prefix.length)}`;
    // Preserve the other providers' existing transport classification.
    if (provider.allowGit && lower.startsWith(`git://${provider.host}`)) {
      const authority = /^git:\/\/([^/]+)\//i.exec(trimmed)?.[1];
      if (authority?.split(":")[0]?.toLowerCase() === provider.host)
        return trimmed;
    }
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
  return parseRepositoryTarget(spec, "target");
}

/** Structured output URLs contain identity only; their literal @ is not a ref. */
function parseRepositoryTarget(
  spec: string,
  mode: "target" | "url",
): CodeNavigationTarget {
  const normalised = normaliseRepositoryTargetSpec(spec);
  if (!normalised) throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  const match = /^(https?|git):\/\/([^/]+)\/(.*)$/i.exec(normalised);
  if (!match) throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  const scheme = match[1]!.toLowerCase();
  const authority = match[2]!;
  const rawPath = match[3]!;
  if (authority.includes("@"))
    throw new InvalidArgumentError(
      "Repository URL targets must not include credentials.",
    );
  if (/[\\?#\s]/.test(authority))
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  // Parse only the authority: URL handles default ports without rewriting paths.
  let url: URL;
  try {
    url = new URL(`${scheme}://${authority}`);
  } catch {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }
  const host = url.hostname.toLowerCase();
  const provider = repositoryProvider(host);
  if (
    !provider ||
    (url.port && !(scheme === "git" && url.port === "9418")) ||
    // Reject ports and encoded/Unicode authorities before URL can erase intent.
    (provider.name === "Googlesource" && authority.toLowerCase() !== host)
  )
    throw new InvalidArgumentError(
      "Repository URL targets must use github.com, codeberg.org, gitlab.com, git.launchpad.net (code.launchpad.net also accepted), or a public *.googlesource.com host; unsupported/self-hosted hosts and nondefault ports are not accepted. Googlesource URLs do not accept any explicit port.",
    );
  const guidance =
    provider.prefix === "launchpad:"
      ? "Use lp:PROJECT or lp:~owner/project/+git/repo, with optional @ref."
      : provider.prefix
        ? `Use ${provider.prefix}${provider.path} with optional @gitRef, or https://${provider.host}/${provider.path}.`
        : `Use https://${provider.host}/${provider.path} with optional @gitRef.`;
  const validPath = (parts: string[]): boolean =>
    provider.validatePath(parts) ||
    (provider.prefix === "launchpad:" &&
      mode === "target" &&
      scheme === "https" &&
      validLaunchpadDefaultPath(parts));
  if (provider.prefix === "launchpad:" && authority.endsWith(":"))
    throw new InvalidArgumentError(
      `Repository ports must be nonempty. ${guidance}`,
    );
  if (scheme === "http" && !provider.allowHttp)
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
  const at = mode === "target" ? rawPath.indexOf("@") : -1;
  if (hash !== -1) {
    const nextHash = rawPath.indexOf("#", hash + 1);
    const legacyPath = rawPath.slice(0, hash).replace(/\/$/, "");
    if (
      hash < rawPath.length - 1 &&
      nextHash === -1 &&
      (at === -1 || hash < at) &&
      mode === "target" &&
      validPath(repositoryPathParts(legacyPath, provider))
    ) {
      const legacy = spec.trim();
      const migrated = `${legacy.slice(0, legacy.indexOf("#"))}@${legacy.slice(
        legacy.indexOf("#") + 1,
      )}`;
      throw new LegacyRepositoryRefError(
        `Repository target ${JSON.stringify(legacy)} uses legacy #ref syntax. Use ${JSON.stringify(migrated)}; # is reserved for semantic fragments.`,
      );
    }
    throw new InvalidArgumentError(
      `Repository targets do not accept # fragments or legacy #ref suffixes. Use @gitRef for repository revisions; documentation locators with fragments must be passed unchanged to a documentation read. ${guidance}`,
    );
  }
  const delimiter = at;
  const path = (
    delimiter === -1 ? rawPath : rawPath.slice(0, delimiter)
  ).replace(/\/$/, "");
  const gitRef = delimiter === -1 ? undefined : rawPath.slice(delimiter + 1);
  if (gitRef === "")
    throw new InvalidArgumentError(
      `Repository refs must be nonempty. ${guidance}`,
    );
  const parts = repositoryPathParts(path, provider);
  if (!validPath(parts)) {
    if (provider.prefix === "launchpad:")
      throw new InvalidArgumentError(
        `Invalid Launchpad Git target. ${guidance}`,
      );
    if (provider.prefix === "github:" && parts.length === 2)
      throw new InvalidArgumentError(
        `Repository URL targets must use a valid GitHub repository name. ${guidance}`,
      );
    throw new InvalidArgumentError(
      `Repository URL targets must point to ${provider.host}/${provider.path}; pass refs with @gitRef. ${provider.name} web subpaths are not repository targets. ${guidance}`,
    );
  }
  const repoUrl = `https://${provider.host}/${parts.join("/")}`;
  return gitRef === undefined ? { repoUrl } : { repoUrl, gitRef };
}

/** A mutable request address is not a canonical repository identity. */
export function isCanonicalRepositoryUrl(repoUrl: string): boolean {
  try {
    parseRepositoryTarget(repoUrl, "url");
    return true;
  } catch {
    return false;
  }
}

/** Format only validated repository identities; unknown URLs remain unchanged. */
export function formatRepositoryTarget(
  repoUrl: string,
  gitRef?: string,
): string {
  let compact = repoUrl;
  try {
    const parsed = parseRepositoryTarget(repoUrl, "url");
    if (parsed.repoUrl && parsed.gitRef === undefined) {
      const url = new URL(parsed.repoUrl);
      const provider = repositoryProvider(url.host)!;
      compact = provider.prefix
        ? `${provider.prefix}${url.pathname.slice(1).replaceAll("@", "%40")}`
        : parsed.repoUrl;
    }
  } catch {
    /* Keep unsupported backend identities lossless. */
  }
  return gitRef ? `${compact}@${gitRef}` : compact;
}

/**
 * Parse typed backend repository labels during the hash-delimiter migration.
 * Caller-facing parsers remain strict; this compatibility is output-only.
 */
function parseRepositoryOutputLabel(
  label: string,
): CodeNavigationTarget | undefined {
  try {
    return parseRepositoryTargetSpec(label);
  } catch {
    const hash = label.indexOf("#");
    const at = label.indexOf("@");
    if (
      hash === -1 ||
      hash === label.length - 1 ||
      label.indexOf("#", hash + 1) !== -1 ||
      (at !== -1 && at < hash)
    ) {
      return undefined;
    }
    try {
      return parseRepositoryTargetSpec(
        `${label.slice(0, hash)}@${label.slice(hash + 1)}`,
      );
    } catch {
      return undefined;
    }
  }
}

/** Bare backend labels require an explicit repository identity, never a default host. */
export function formatRepositoryTargetLabel(
  label: string,
  repoUrl?: string,
): string | undefined {
  if (isRepositoryTargetSpec(label)) {
    const parsed = parseRepositoryOutputLabel(label);
    if (parsed?.repoUrl && isCanonicalRepositoryUrl(parsed.repoUrl)) {
      return formatRepositoryTarget(parsed.repoUrl, parsed.gitRef);
    }
    return undefined;
  }
  if (!repoUrl) return undefined;
  try {
    const parsed = parseRepositoryTarget(repoUrl, "url");
    if (!parsed.repoUrl) return undefined;
    const path = new URL(parsed.repoUrl).pathname.slice(1);
    if (label === path) return formatRepositoryTarget(parsed.repoUrl);
    if (label.startsWith(`${path}@`) && label.length > path.length + 1)
      return formatRepositoryTarget(
        parsed.repoUrl,
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
    )}) or repository target github:owner/repo, codeberg:owner/repo, gitlab:group[/subgroup...]/project, lp:PROJECT, or launchpad:~owner/+git/repo with optional @ref (approved full HTTPS URLs also accepted; GitHub additionally supports github.com/owner/repo and HTTP).`,
  );
}
