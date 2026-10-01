import { createHash } from "node:crypto";
import semver from "semver";

const MARKER_PREFIX = "<!-- githits-managed-skill";
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const MARKER =
  /^<!-- githits-managed-skill v1 version=(\S+) sha256=([a-f0-9]{64}) -->\r?\n/;

export type SkillContentInspection =
  | { kind: "unmarked"; content: string }
  | { kind: "managed"; content: string; version: string }
  | { kind: "modified" };

export type SkillUpdateDecision = "preserve" | "update" | "warn-newer";

/** Fingerprint exact UTF-8 content, without normalizing user edits. */
export function hashSkillContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Install metadata outside the authored guide without rewriting its bytes. */
export function renderManagedSkillContent(
  content: string,
  version: string,
): string {
  const frontmatter = FRONTMATTER.exec(content)?.[0];
  if (!frontmatter || content.includes(MARKER_PREFIX)) {
    throw new Error("Invalid packaged MCP skill content");
  }
  const newline = frontmatter.endsWith("\r\n") ? "\r\n" : "\n";
  return (
    frontmatter +
    `${MARKER_PREFIX} v1 version=${version} sha256=${hashSkillContent(content)} -->${newline}` +
    content.slice(frontmatter.length)
  );
}

/** Accept only one correctly placed marker whose checksum covers all payload bytes. */
export function inspectSkillContent(content: string): SkillContentInspection {
  const occurrences = content.split(MARKER_PREFIX).length - 1;
  if (occurrences === 0) return { kind: "unmarked", content };
  if (occurrences !== 1) return { kind: "modified" };
  const frontmatter = FRONTMATTER.exec(content)?.[0];
  if (!frontmatter) return { kind: "modified" };
  const remainder = content.slice(frontmatter.length);
  const marker = MARKER.exec(remainder);
  const version = marker?.[1];
  const checksum = marker?.[2];
  if (!marker || !version || !checksum || semver.valid(version) !== version) {
    return { kind: "modified" };
  }
  const payload = frontmatter + remainder.slice(marker[0].length);
  if (hashSkillContent(payload) !== checksum) return { kind: "modified" };
  return { kind: "managed", content: payload, version };
}

/** Installed guide equality ignores writing version but requires a valid checksum. */
export function isManagedSkillCurrent(
  installed: string,
  bundled: string,
): boolean {
  const inspection = inspectSkillContent(installed);
  return inspection.kind === "managed" && inspection.content === bundled;
}

/** Decide maintenance without IO; unknown and edited files never become owned. */
export function decideSkillUpdate(
  installed: string,
  bundled: string,
  currentVersion: string,
  historicalHashes: readonly string[],
): SkillUpdateDecision {
  const inspection = inspectSkillContent(installed);
  if (inspection.kind === "modified" || inspection.content === bundled) {
    return "preserve";
  }
  if (inspection.kind === "unmarked") {
    return historicalHashes.includes(hashSkillContent(installed))
      ? "update"
      : "preserve";
  }
  if (semver.lt(inspection.version, currentVersion)) return "update";
  if (semver.gt(inspection.version, currentVersion)) return "warn-newer";
  return "preserve";
}
