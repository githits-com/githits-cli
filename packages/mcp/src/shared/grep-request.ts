import type {
  GrepCorpus,
  GrepParams,
  GrepPathSelector,
} from "@githits/core-internal";
import { InvalidArgumentError } from "./package-spec.js";

const MAX_TARGETS = 20;
const MAX_PATTERN_BYTES = 200;
const MAX_PATH_SELECTORS = 1000;

type GrepPatternTypeInput = "literal" | "regex";
type GrepPathSelectorKindInput = "exact" | "prefix" | "glob";

export interface GrepRequestTargetInput {
  target: string;
  /**
   * Raw CLI or MCP corpus value; this builder validates and maps it to the
   * backend enum.
   */
  corpus?: string;
  pathSelectors?: readonly {
    kind: GrepPathSelectorKindInput;
    value: string;
  }[];
}

export interface GrepRequestInput {
  targets: readonly GrepRequestTargetInput[];
  pattern: string;
  includeDetailedFields: boolean;
  patternType?: GrepPatternTypeInput;
  ignoreCase?: boolean;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
  maxMatches?: number;
  waitTimeoutMs?: number;
  cursor?: string;
}

/** A caller-input error raised while normalizing a unified grep request. */
export class InvalidGrepRequestError extends InvalidArgumentError {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidGrepRequestError";
  }
}

/** Normalize caller controls into the exact backend parameters for one grep page. */
export function buildGrepParams(input: GrepRequestInput): GrepParams {
  if (!isRecord(input)) {
    throw invalid("request", "A grep request is required.");
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw invalid("targets", "`targets` must contain at least one target.");
  }
  if (input.targets.length > MAX_TARGETS) {
    throw invalid(
      "targets",
      `Targets may contain at most ${MAX_TARGETS} entries.`,
    );
  }
  if (typeof input.pattern !== "string") {
    throw invalid("pattern", "`pattern` must be a string.");
  }
  validateUnicode(
    input.pattern,
    "pattern",
    "`pattern` must contain valid Unicode.",
  );
  if (input.pattern.includes("\0")) {
    throw invalid("pattern", "`pattern` cannot contain NUL.");
  }
  const patternBytes = Buffer.byteLength(input.pattern, "utf8");
  if (patternBytes < 1 || patternBytes > MAX_PATTERN_BYTES) {
    throw invalid(
      "pattern",
      `Pattern must be 1 to ${MAX_PATTERN_BYTES} UTF-8 bytes.`,
    );
  }
  if (typeof input.includeDetailedFields !== "boolean") {
    throw invalid(
      "includeDetailedFields",
      "`includeDetailedFields` must be a boolean.",
    );
  }

  const patternType = normalizePatternType(input.patternType);
  const ignoreCase = normalizeBoolean(input.ignoreCase, "ignoreCase");
  const contextLinesBefore = normalizeGrepContextLines(
    input.contextLinesBefore,
    "contextLinesBefore",
  );
  const contextLinesAfter = normalizeGrepContextLines(
    input.contextLinesAfter,
    "contextLinesAfter",
  );
  const maxMatches = normalizeInteger(input.maxMatches, "maxMatches", 1, 1000);
  const waitTimeoutMs = normalizeInteger(
    input.waitTimeoutMs,
    "waitTimeoutMs",
    0,
    300_000,
  );
  const cursor = normalizeCursor(input.cursor);

  const targets = input.targets.map((targetInput, index) => {
    const field = `targets[${index}]`;
    if (!isRecord(targetInput) || typeof targetInput.target !== "string") {
      throw invalid(
        `${field}.target`,
        "Each target must include a string `target`.",
      );
    }
    const target = targetInput.target;
    validateUnicode(
      target,
      `${field}.target`,
      "Target must contain valid Unicode.",
    );
    if (target.trim().length === 0) {
      throw invalid(`${field}.target`, "Target cannot be blank.");
    }

    const corpus = normalizeCorpus(targetInput.corpus, `${field}.corpus`);
    const pathSelectors = normalizePathSelectors(
      targetInput.pathSelectors,
      `${field}.pathSelectors`,
    );

    if (isGrepSiteTarget(target)) {
      if (targetInput.corpus !== undefined) {
        throw invalid(
          `${field}.corpus`,
          "Corpus cannot be used with a site target.",
        );
      }
      if (pathSelectors.length > 0) {
        throw invalid(
          `${field}.pathSelectors`,
          "Path selectors cannot be used with a site target.",
        );
      }
      return { target };
    }

    return {
      target,
      corpus: corpus ?? "ALL",
      allowUnscoped: true,
      ...(pathSelectors.length > 0 ? { pathSelectors } : {}),
    };
  });

  return {
    targets,
    pattern: input.pattern,
    patternType,
    caseSensitive: !(ignoreCase ?? false),
    contextLinesBefore: contextLinesBefore ?? 0,
    contextLinesAfter: contextLinesAfter ?? 0,
    ...(maxMatches !== undefined ? { maxMatches } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(waitTimeoutMs !== undefined ? { waitTimeoutMs } : {}),
    includeDetailedFields: input.includeDetailedFields,
  };
}

function normalizePatternType(
  value: GrepPatternTypeInput | undefined,
): GrepParams["patternType"] {
  if (value === undefined || value === "regex") return "REGEX";
  if (value === "literal") return "LITERAL";
  throw invalid("patternType", "`patternType` must be `literal` or `regex`.");
}

function normalizeCorpus(
  value: unknown,
  field: string,
): GrepCorpus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw invalid(field, "Corpus must be `source`, `documentation`, or `all`.");
  }
  const normalized = value.toUpperCase();
  if (
    normalized === "SOURCE" ||
    normalized === "DOCUMENTATION" ||
    normalized === "ALL"
  ) {
    return normalized;
  }
  throw invalid(field, "Corpus must be `source`, `documentation`, or `all`.");
}

function normalizePathSelectors(
  value: unknown,
  field: string,
): GrepPathSelector[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalid(field, "Path selectors must be an array.");
  }
  if (value.length === 0) return [];
  if (value.length > MAX_PATH_SELECTORS) {
    throw invalid(
      field,
      `A target may contain at most ${MAX_PATH_SELECTORS} path selectors.`,
    );
  }
  return value.map((selector, index) => {
    const itemField = `${field}[${index}]`;
    if (!isRecord(selector)) {
      throw invalid(itemField, "A path selector must be an object.");
    }
    const kind = normalizeSelectorKind(selector.kind, `${itemField}.kind`);
    if (typeof selector.value !== "string") {
      throw invalid(`${itemField}.value`, "Selector value must be a string.");
    }
    const selectorValue = selector.value;
    validateUnicode(
      selectorValue,
      `${itemField}.value`,
      "Selector values must contain valid Unicode.",
    );
    if (selectorValue.trim().length === 0) {
      throw invalid(`${itemField}.value`, "Selector values cannot be blank.");
    }
    if (selectorValue.includes("\0")) {
      throw invalid(
        `${itemField}.value`,
        "Selector values cannot contain NUL.",
      );
    }
    return { kind, value: selectorValue };
  });
}

function normalizeSelectorKind(
  value: unknown,
  field: string,
): GrepPathSelector["kind"] {
  if (typeof value !== "string") {
    throw invalid(field, "Selector kind must be `exact`, `prefix`, or `glob`.");
  }
  const normalized = value.toUpperCase();
  if (
    normalized === "EXACT" ||
    normalized === "PREFIX" ||
    normalized === "GLOB"
  ) {
    return normalized;
  }
  throw invalid(field, "Selector kind must be `exact`, `prefix`, or `glob`.");
}

function normalizeBoolean(
  value: boolean | undefined,
  field: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw invalid(field, `${field} must be a boolean.`);
  }
  return value;
}

function normalizeInteger(
  value: number | undefined,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalid(
      field,
      `${field} must be a safe integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

/** Validate one context side using the shared grep request bounds. */
export function normalizeGrepContextLines(
  value: number | undefined,
  field: string,
): number | undefined {
  return normalizeInteger(value, field, 0, 10);
}

function normalizeCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw invalid("cursor", "`cursor` must be a string.");
  }
  return value.trim().length === 0 ? undefined : value;
}

/** Classify targets by a trimmed, case-insensitive `site:` prefix. */
export function isGrepSiteTarget(target: string): boolean {
  return target.trim().toLowerCase().startsWith("site:");
}

function validateUnicode(value: string, field: string, message: string): void {
  if (hasLoneSurrogate(value)) throw invalid(field, message);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(field: string, message: string): InvalidGrepRequestError {
  return new InvalidGrepRequestError(field, message);
}
