import type { ListFileIntent, ListParams } from "@githits/core-internal";
import { InvalidArgumentError } from "./package-spec.js";

const MAX_PATHS = 1000;
const MAX_PATH_BYTES = 2048;
const MAX_SOURCE_FILTER_VALUES = 64;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const MIN_WAIT_TIMEOUT_MS = 0;
const MAX_WAIT_TIMEOUT_MS = 300_000;

const LIST_FILE_INTENTS = [
  "PRODUCTION",
  "TEST",
  "BENCHMARK",
  "EXAMPLE",
  "GENERATED",
  "FIXTURE",
  "BUILD",
  "VENDOR",
] as const satisfies readonly ListFileIntent[];

export type ListRequestField =
  | "target"
  | "paths"
  | "fileTypes"
  | "languages"
  | "intents"
  | "limit"
  | "waitTimeoutMs"
  | "after"
  | "recursive"
  | "includeDetailedFields";

/** A caller-input error raised while normalizing a unified list request. */
export class InvalidListRequestError extends InvalidArgumentError {
  constructor(
    public readonly field: ListRequestField,
    message: string,
  ) {
    super(message);
    this.name = "InvalidListRequestError";
  }
}

export interface ListRequestInput {
  target: string;
  paths?: readonly string[];
  recursive?: boolean;
  fileTypes?: readonly string[];
  languages?: readonly string[];
  intents?: readonly string[];
  limit?: number;
  after?: string;
  waitTimeoutMs?: number;
  includeDetailedFields: boolean;
}

/**
 * Validate raw CLI or MCP list fields and normalize them into core parameters.
 * Targets, path selectors, and nonblank cursors retain their exact input text;
 * this builder never supplies backend defaults for page size or wait time.
 */
export function buildListParams(input: ListRequestInput): ListParams {
  if (typeof input.target !== "string" || input.target.trim().length === 0) {
    throw invalid("target", "`target` is required.");
  }
  if (typeof input.includeDetailedFields !== "boolean") {
    throw invalid(
      "includeDetailedFields",
      "`includeDetailedFields` must be a boolean.",
    );
  }

  const paths = normalizePaths(input.paths);
  const fileTypes = normalizeStringList(input.fileTypes, "fileTypes");
  const languages = normalizeStringList(input.languages, "languages");
  const intents = normalizeIntents(input.intents);
  const limit = normalizeInteger(input.limit, "limit", MIN_LIMIT, MAX_LIMIT);
  const waitTimeoutMs = normalizeInteger(
    input.waitTimeoutMs,
    "waitTimeoutMs",
    MIN_WAIT_TIMEOUT_MS,
    MAX_WAIT_TIMEOUT_MS,
  );
  const after =
    input.after === undefined || input.after.trim().length === 0
      ? undefined
      : input.after;

  if (
    input.target.trim().startsWith("site:") &&
    (fileTypes.length > 0 || languages.length > 0 || intents.length > 0)
  ) {
    const field =
      fileTypes.length > 0
        ? "fileTypes"
        : languages.length > 0
          ? "languages"
          : "intents";
    throw invalid(field, `${field} cannot be used with a site target.`);
  }

  return {
    target: input.target,
    ...(paths.length > 0 ? { paths } : {}),
    ...(input.recursive !== undefined ? { recursive: input.recursive } : {}),
    ...(fileTypes.length > 0 ? { fileTypes } : {}),
    ...(languages.length > 0 ? { languages } : {}),
    ...(intents.length > 0 ? { intents } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(waitTimeoutMs !== undefined ? { waitTimeoutMs } : {}),
    includeDetailedFields: input.includeDetailedFields,
  };
}

function normalizePaths(paths: readonly string[] | undefined): string[] {
  if (paths === undefined || paths.length === 0) return [];
  if (paths.length > MAX_PATHS) {
    throw invalid("paths", `paths may contain at most ${MAX_PATHS} entries.`);
  }

  for (const path of paths) {
    if (path.trim().length === 0) {
      throw invalid("paths", "`paths` entries cannot be blank.");
    }
    if (hasLoneSurrogate(path)) {
      throw invalid("paths", "`paths` entries must contain valid Unicode.");
    }
    if (Buffer.byteLength(path, "utf8") > MAX_PATH_BYTES) {
      throw invalid(
        "paths",
        `paths entries must be at most ${MAX_PATH_BYTES} UTF-8 bytes.`,
      );
    }
  }
  return [...paths];
}

function normalizeStringList(
  values: readonly string[] | undefined,
  field: "fileTypes" | "languages",
): string[] {
  if (values === undefined || values.length === 0) return [];
  if (values.length > MAX_SOURCE_FILTER_VALUES) {
    throw invalid(
      field,
      `${field} may contain at most ${MAX_SOURCE_FILTER_VALUES} entries.`,
    );
  }

  return values.map((value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw invalid(field, `${field} entries cannot be blank.`);
    }
    return trimmed;
  });
}

function normalizeIntents(
  values: readonly string[] | undefined,
): ListFileIntent[] {
  if (values === undefined || values.length === 0) return [];
  if (values.length > MAX_SOURCE_FILTER_VALUES) {
    throw invalid(
      "intents",
      `intents may contain at most ${MAX_SOURCE_FILTER_VALUES} entries.`,
    );
  }

  return values.map((value) => {
    const trimmed = value.trim();
    const intent = uppercaseAscii(trimmed);
    if (!LIST_FILE_INTENTS.some((known) => known === intent)) {
      throw invalid(
        "intents",
        "`intents` entries must be PRODUCTION, TEST, BENCHMARK, EXAMPLE, GENERATED, FIXTURE, BUILD, or VENDOR.",
      );
    }
    return intent as ListFileIntent;
  });
}

function normalizeInteger(
  value: number | undefined,
  field: "limit" | "waitTimeoutMs",
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalid(
      field,
      `${field} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function uppercaseAscii(value: string): string {
  return value.replace(/[a-z]/g, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) - 32),
  );
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function invalid(
  field: ListRequestField,
  message: string,
): InvalidListRequestError {
  return new InvalidListRequestError(field, message);
}
