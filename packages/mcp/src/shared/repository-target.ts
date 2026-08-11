import type { CodeNavigationTarget } from "@githits/core-internal";
import { InvalidArgumentError, KNOWN_REGISTRIES } from "./package-spec.js";

const GITHUB_HOST_SHORTHAND_PREFIX = "github.com/";
const GITHUB_OWNER_REPO_SHORTHAND_PREFIX = "github:";
const GITHUB_HOST = "github.com";
const REPOSITORY_TARGET_ERROR =
  "Repository target must be https://github.com/owner/repo, github.com/owner/repo, or github:owner/repo with optional #gitRef or @gitRef suffix.";
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

export function normaliseRepositoryTargetSpec(
  spec: string,
): string | undefined {
  const trimmed = spec.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return trimmed;
  }
  if (lower.startsWith(GITHUB_HOST_SHORTHAND_PREFIX)) {
    return `https://${trimmed}`;
  }
  if (lower.startsWith(GITHUB_OWNER_REPO_SHORTHAND_PREFIX)) {
    return `https://github.com/${trimmed.slice(
      GITHUB_OWNER_REPO_SHORTHAND_PREFIX.length,
    )}`;
  }
  return undefined;
}

export function isRepositoryTargetSpec(spec: string): boolean {
  return normaliseRepositoryTargetSpec(spec) !== undefined;
}

export function parseRepositoryTargetSpec(spec: string): CodeNavigationTarget {
  const normalised = normaliseRepositoryTargetSpec(spec);
  if (!normalised) {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }
  if (normalised.endsWith("#")) {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalised);
  } catch {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }
  if (parsed.hostname.toLowerCase() !== GITHUB_HOST) {
    throw new InvalidArgumentError(
      "Repository URL targets must use github.com repositories.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new InvalidArgumentError(
      "Repository URL targets must not include credentials.",
    );
  }
  if (parsed.search) {
    throw new InvalidArgumentError(
      "Repository URL targets must not include query parameters.",
    );
  }

  const rawPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
  const segments = rawPath.split("/");
  const owner = segments[0];
  const repoAndAtRef = segments[1];
  if (!owner || !repoAndAtRef || segments.some((segment) => segment === "")) {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }

  const atRefDelimiter = repoAndAtRef.indexOf("@");
  const hasAtRef = atRefDelimiter !== -1;
  if (hasAtRef && parsed.hash) {
    throw new InvalidArgumentError(
      "Repository URL targets must use only one ref suffix: #gitRef or @gitRef.",
    );
  }
  const repoName = hasAtRef
    ? repoAndAtRef.slice(0, atRefDelimiter)
    : repoAndAtRef;
  const repoUrl = `https://${GITHUB_HOST}/${owner}/${repoName}`;
  const gitRef = parsed.hash
    ? parsed.hash.slice(1)
    : hasAtRef
      ? [repoAndAtRef.slice(atRefDelimiter + 1), ...segments.slice(2)].join("/")
      : undefined;

  if (!repoName || gitRef === "") {
    throw new InvalidArgumentError(REPOSITORY_TARGET_ERROR);
  }
  validateGithubRepositoryComponents(owner, repoName);
  if (!hasAtRef && segments.length > 2) {
    throw new InvalidArgumentError(
      "Repository URL targets must point to github.com/owner/repo; pass refs with #gitRef or @gitRef.",
    );
  }

  return gitRef ? { repoUrl, gitRef } : { repoUrl };
}

function validateGithubRepositoryComponents(
  owner: string,
  repoName: string,
): void {
  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    throw new InvalidArgumentError(
      "Repository URL targets must use a valid GitHub owner name.",
    );
  }
  if (
    repoName === "." ||
    repoName === ".." ||
    !GITHUB_REPO_PATTERN.test(repoName)
  ) {
    throw new InvalidArgumentError(
      "Repository URL targets must use a valid GitHub repository name.",
    );
  }
}

export function formatRepositoryTarget(
  repoUrl: string,
  gitRef?: string,
): string {
  const compact = compactGithubRepositoryUrl(repoUrl) ?? repoUrl;
  return gitRef ? `${compact}#${gitRef}` : compact;
}

export function formatRepositoryTargetLabel(label: string): string | undefined {
  const atRefDelimiter = label.indexOf("@");
  const repoLabel =
    atRefDelimiter === -1 ? label : label.slice(0, atRefDelimiter);
  const [owner, repoName, ...rest] = repoLabel.split("/");
  if (!owner || !repoName || rest.length > 0) return undefined;
  if (owner.includes(":") || repoName.includes(":")) return undefined;
  if (
    !GITHUB_OWNER_PATTERN.test(owner) ||
    !GITHUB_REPO_PATTERN.test(repoName)
  ) {
    return undefined;
  }
  const gitRef =
    atRefDelimiter === -1 ? undefined : label.slice(atRefDelimiter + 1);
  if (gitRef === "") return undefined;
  return formatRepositoryTarget(
    `https://${GITHUB_HOST}/${owner}/${repoName}`,
    gitRef,
  );
}

function compactGithubRepositoryUrl(repoUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase() !== GITHUB_HOST) return undefined;
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    return undefined;
  }
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) return undefined;
  return `github:${segments[0]}/${segments[1]}`;
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
    )}) or repository target github:owner/repo[#ref|@ref] / github.com/owner/repo[#ref|@ref] / https://github.com/owner/repo[#ref|@ref].`,
  );
}
