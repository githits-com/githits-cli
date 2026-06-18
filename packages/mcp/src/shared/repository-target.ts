import type { CodeNavigationTarget } from "@githits/core-internal";
import { InvalidArgumentError, KNOWN_REGISTRIES } from "./package-spec.js";

const GITHUB_HOST_SHORTHAND_PREFIX = "github.com/";
const GITHUB_OWNER_REPO_SHORTHAND_PREFIX = "github:";

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
    throw new InvalidArgumentError(
      "Repository target must be a URL, github.com/owner/repo, or github:owner/repo with optional #gitRef suffix.",
    );
  }

  const hashIndex = normalised.lastIndexOf("#");
  if (hashIndex === -1) {
    return { repoUrl: normalised };
  }

  const repoUrl = normalised.slice(0, hashIndex);
  const gitRef = normalised.slice(hashIndex + 1);
  if (!repoUrl || !gitRef) {
    throw new InvalidArgumentError(
      "Repository target must be a URL, github.com/owner/repo, or github:owner/repo with optional #gitRef suffix.",
    );
  }

  return { repoUrl, gitRef };
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
    )}) or repository target github:owner/repo[#ref] / github.com/owner/repo[#ref] / https://github.com/owner/repo[#ref].`,
  );
}
