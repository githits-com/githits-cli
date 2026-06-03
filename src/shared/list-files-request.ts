/**
 * Shared request builder for the `list_files` tool. CLI and MCP
 * normalise inputs here so the two surfaces cannot diverge on
 * selector/filter parsing, file-intent coercion, or limit validation.
 * Addressing XOR is delegated to the shipped `resolveCodeTarget`
 * helper; this module owns the tool-specific bounds and filter rules.
 */

import type {
  CodeNavigationTarget,
  FileIntent,
  GrepRepoPathSelector,
  ListFilesParams,
} from "../services/code-navigation-service.js";
import {
  isKnownFileIntent,
  knownFileIntentList,
  toFileIntent,
} from "./code-navigation.js";
import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { InvalidPackageSpecError } from "./package-spec.js";

/** Mirrors the backend input bounds; callers stay below these. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 1000;
const LIMIT_DEFAULT = 200;

const WAIT_MIN = 0;
const WAIT_MAX = 60_000;

export interface ListFilesRequestInput {
  target: CodeNavigationTarget;
  path?: string;
  pathPrefix?: string;
  globs?: string[];
  extensions?: string[];
  fileTypes?: string[];
  languages?: string[];
  fileIntent?: string;
  fileIntents?: string[];
  excludeFileIntents?: string[];
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  includeHidden?: boolean;
  limit?: number;
  waitTimeoutMs?: number;
}

export interface ListFilesRequestBuildResult {
  params: ListFilesParams;
  /**
   * Limit that was actually sent on the wire. Emitted in the
   * envelope's `filter.limit` when the caller supplied one
   * explicitly; when omitted, the builder substitutes the default
   * and the envelope omits `filter.limit`.
   */
  effectiveLimit: number;
  /**
   * True iff the caller explicitly supplied a `limit` (so the
   * envelope knows to echo it under `filter.limit`).
   */
  limitExplicit: boolean;
  explicit: {
    path: boolean;
    pathPrefix: boolean;
    globs: boolean;
    extensions: boolean;
    fileTypes: boolean;
    languages: boolean;
    fileIntent: boolean;
    fileIntents: boolean;
    excludeFileIntents: boolean;
    excludeDocFiles: boolean;
    excludeTestFiles: boolean;
    includeHidden: boolean;
    limit: boolean;
  };
  filterEcho: {
    path?: string;
    pathPrefix?: string;
    globs?: string[];
    extensions?: string[];
    fileTypes?: string[];
    languages?: string[];
    fileIntent?: string;
    fileIntents?: string[];
    excludeFileIntents?: string[];
    excludeDocFiles?: boolean;
    excludeTestFiles?: boolean;
    includeHidden?: boolean;
    limit?: number;
  };
}

export function buildListFilesParams(
  input: ListFilesRequestInput,
): ListFilesRequestBuildResult {
  const limitExplicit = input.limit !== undefined;
  const limit = normaliseLimit(input.limit);
  const waitTimeoutMs = normaliseWaitTimeoutMs(input.waitTimeoutMs);
  const path = normalizeOptionalNonEmpty(input.path, "path");
  const pathPrefix = normalisePathPrefix(input.pathPrefix);
  const globs = normalizeStringList(input.globs, "globs");
  const extensions = normalizeExtensions(input.extensions);
  const fileTypes = normalizeStringList(input.fileTypes, "file_types");
  const languages = normalizeStringList(input.languages, "languages");
  const { fileIntent, fileIntentEcho } = normalizeOptionalFileIntent(
    input.fileIntent,
    "file_intent",
  );
  const fileIntents = normalizeFileIntentList(
    input.fileIntents,
    "file_intents",
  );
  const excludeFileIntents = normalizeFileIntentList(
    input.excludeFileIntents,
    "exclude_file_intents",
  );

  if (fileIntent && fileIntents.length > 0) {
    throw new InvalidPackageSpecError(
      "`file_intent` cannot be combined with `file_intents`.",
    );
  }

  const pathSelectors = buildPathSelectors({ path, globs });
  const pathExplicit = path !== undefined;
  const pathPrefixExplicit = pathPrefix !== undefined;
  const globsExplicit = globs.length > 0;

  return {
    params: {
      target: input.target,
      pathSelectors,
      pathPrefix,
      extensions: extensions.length > 0 ? extensions : undefined,
      fileTypes: fileTypes.length > 0 ? fileTypes : undefined,
      languages: languages.length > 0 ? languages : undefined,
      fileIntent,
      fileIntents: fileIntents.length > 0 ? fileIntents : undefined,
      excludeFileIntents:
        excludeFileIntents.length > 0 ? excludeFileIntents : undefined,
      excludeDocFiles: input.excludeDocFiles,
      excludeTestFiles: input.excludeTestFiles,
      includeHidden: input.includeHidden,
      limit,
      waitTimeoutMs,
    },
    effectiveLimit: limit,
    limitExplicit,
    explicit: {
      path: pathExplicit,
      pathPrefix: pathPrefixExplicit,
      globs: globsExplicit,
      extensions: extensions.length > 0,
      fileTypes: fileTypes.length > 0,
      languages: languages.length > 0,
      fileIntent: fileIntent !== undefined,
      fileIntents: fileIntents.length > 0,
      excludeFileIntents: excludeFileIntents.length > 0,
      excludeDocFiles: input.excludeDocFiles !== undefined,
      excludeTestFiles: input.excludeTestFiles !== undefined,
      includeHidden: input.includeHidden !== undefined,
      limit: limitExplicit,
    },
    filterEcho: {
      path,
      pathPrefix,
      globs: globsExplicit ? globs : undefined,
      extensions: extensions.length > 0 ? extensions : undefined,
      fileTypes: fileTypes.length > 0 ? fileTypes : undefined,
      languages: languages.length > 0 ? languages : undefined,
      fileIntent: fileIntentEcho,
      fileIntents:
        fileIntents.length > 0
          ? fileIntents.map((intent) => intent.toLowerCase())
          : undefined,
      excludeFileIntents:
        excludeFileIntents.length > 0
          ? excludeFileIntents.map((intent) => intent.toLowerCase())
          : undefined,
      excludeDocFiles: input.excludeDocFiles,
      excludeTestFiles: input.excludeTestFiles,
      includeHidden: input.includeHidden,
      limit: limitExplicit ? limit : undefined,
    },
  };
}

function buildPathSelectors(input: {
  path?: string;
  globs: string[];
}): GrepRepoPathSelector[] | undefined {
  const selectors: GrepRepoPathSelector[] = [];
  if (input.path) selectors.push({ kind: "EXACT", value: input.path });
  for (const glob of input.globs) {
    selectors.push({ kind: "GLOB", value: glob });
  }
  return selectors.length > 0 ? selectors : undefined;
}

function normalizeOptionalNonEmpty(
  raw: string | undefined,
  _field: string,
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(
  raw: string[] | undefined,
  field: string,
): string[] {
  if (!raw) return [];
  const values: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new InvalidPackageSpecError(
        `\`${field}\` entries cannot be empty.`,
      );
    }
    values.push(trimmed);
  }
  return values;
}

function normalizeExtensions(raw: string[] | undefined): string[] {
  const values = normalizeStringList(raw, "extensions");
  for (const value of values) {
    if (value.startsWith(".")) {
      throw new InvalidPackageSpecError(
        "`extensions` values must not include a leading dot.",
      );
    }
  }
  return values;
}

function normalizeOptionalFileIntent(
  raw: string | undefined,
  field: string,
): { fileIntent?: FileIntent; fileIntentEcho?: string } {
  if (raw === undefined) return {};
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return {};
  if (!isKnownFileIntent(trimmed)) {
    throw new InvalidPackageSpecError(
      `\`${field}\` must be one of: ${knownFileIntentList().join(", ")}. Got ${raw}.`,
    );
  }
  return {
    fileIntent: toFileIntent(trimmed),
    fileIntentEcho: trimmed,
  };
}

function normalizeFileIntentList(
  raw: string[] | undefined,
  field: string,
): FileIntent[] {
  const values = normalizeStringList(raw, field);
  const intents: FileIntent[] = [];
  for (const value of values) {
    const lower = value.toLowerCase();
    if (!isKnownFileIntent(lower)) {
      throw new InvalidPackageSpecError(
        `\`${field}\` values must be one of: ${knownFileIntentList().join(", ")}. Got ${value}.`,
      );
    }
    intents.push(toFileIntent(lower) as FileIntent);
  }
  return intents;
}

function normaliseLimit(raw: number | undefined): number {
  if (raw === undefined) return LIMIT_DEFAULT;
  if (!Number.isInteger(raw) || raw < LIMIT_MIN || raw > LIMIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`limit\` must be an integer between ${LIMIT_MIN} and ${LIMIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}

function normaliseWaitTimeoutMs(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isInteger(raw) || raw < WAIT_MIN || raw > WAIT_MAX) {
    throw new InvalidPackageSpecError(
      `\`wait_timeout_ms\` must be an integer between ${WAIT_MIN} and ${WAIT_MAX}. Got ${raw}.`,
    );
  }
  return raw;
}

function normalisePathPrefix(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
