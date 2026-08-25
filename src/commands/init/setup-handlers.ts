import {
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  type Document,
  isMap,
  isScalar,
  parseDocument,
  parse as parseYaml,
  stringify as stringifyYaml,
  type YAMLMap,
} from "yaml";
import type { ExecResult, ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import type {
  CliCommand,
  CliSetup,
  CliUninstall,
  CompositeSetup,
  CompositeUninstall,
  ConfigFileFormat,
  ConfigFileSetup,
  ManagedBlockSetup,
  SetupConfig,
  SkillSetup,
  UninstallStep,
} from "./agent-definitions.js";
import { traceProbeEnd, traceProbeStart } from "./init-trace.js";
import {
  describeConfigAsUnchanged,
  formatCliCommand,
  type SetupChange,
  type UninstallChange,
} from "./setup-format.js";

/** Shared fields for a read-only command setup check. */
interface CommandSetupCheckFields {
  /** Command to execute (e.g., "claude") */
  command: string;
  /** Command arguments (e.g., ["plugin", "list"]) */
  args: string[];
  /**
   * Pattern to search for in combined stdout+stderr. If found, agent is configured.
   * Optional when using a negative-only check via notConfiguredPattern.
   */
  configuredPattern?: RegExp;
  /**
   * Pattern indicating the agent is definitely not configured.
   * Checked before configuredPattern.
   */
  notConfiguredPattern?: RegExp;
  /** Require exitCode=0 for the check command to be considered valid. */
  requireExitCodeZero?: boolean;
  /** Per-command probe timeout. Defaults to five seconds. */
  timeoutMs?: number;
  /** Run the probe from a unique temporary directory to hide project config. */
  useIsolatedCwd?: boolean;
  /** Interpret structured or host-specific command output. */
  evaluateResult?: (result: ExecResult) => SetupCheckStatus;
}

/** A read-only command setup check. */
export type CommandSetupCheck = CommandSetupCheckFields & {
  kind: "command";
};

/** Compatibility shape for existing command-check callers. */
export type CliCheckCommand = CommandSetupCheckFields;

/** A read-only file setup check with a pure content evaluator. */
export interface FileSetupCheck {
  kind: "file";
  path: string;
  evaluateContent: (content: string) => SetupCheckStatus;
}

/** The two supported setup-check variants. */
export type SetupCheck = CommandSetupCheck | FileSetupCheck;

export type SetupCheckStatus =
  | "configured"
  | "not_configured"
  | "non_canonical"
  | "disabled"
  | "probe_failed";
export type CliCheckStatus = SetupCheckStatus;

/** Result of merging server config into an existing config file */
export type MergeResult =
  | { status: "added" | "updated"; content: string }
  | { status: "already_configured" }
  | { status: "parse_error"; error: string };

/** Result of removing server config from an existing config file */
export type RemoveResult =
  | { status: "removed"; content: string }
  | { status: "not_configured" }
  | { status: "parse_error"; error: string };

/** Result of inserting or replacing a managed text block. */
export type ManagedBlockMergeResult =
  | { status: "added" | "updated"; content: string }
  | { status: "already_configured" };

/** Result of removing a managed text block. */
export type ManagedBlockRemoveResult =
  | { status: "removed"; content: string }
  | { status: "not_configured" };

/** Result of checking whether a config file has a removable server entry. */
export type ConfigUninstallCheckResult =
  | { status: "configured" }
  | { status: "not_configured" }
  | { status: "failed"; message: string };

export type ConfigFormat = "json" | "jsonc" | "invalid";

type ParsedConfigResult =
  | {
      format: "json" | "jsonc";
      value: Record<string, unknown>;
    }
  | {
      format: "invalid";
      error: string;
    };

type ParsedConfigObjectResult =
  | {
      value: Record<string, unknown>;
    }
  | {
      error: string;
    };

type ParsedYamlDocumentResult =
  | {
      status: "ok";
      doc: Document.Parsed;
      root: YAMLMap<unknown, unknown>;
    }
  | {
      status: "error";
      error: string;
    };

type ParsedYamlServersMapResult =
  | {
      status: "ok";
      serversMap: YAMLMap<unknown, unknown>;
    }
  | {
      status: "not_configured";
    }
  | {
      status: "error";
      error: string;
    };

function normalizeConfigContent(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

function ensureTrailingNewline(content: string): string {
  return content.length === 0 || content.endsWith("\n")
    ? content
    : `${content}\n`;
}

function parseConfigObject(content: string): ParsedConfigResult {
  const normalizedContent = normalizeConfigContent(content);

  const trimmed = normalizedContent.trim();
  if (trimmed === "") {
    return {
      format: "json",
      value: {},
    };
  }

  try {
    const parsed = JSON.parse(normalizedContent);
    if (!isPlainObject(parsed)) {
      return {
        format: "invalid",
        error: "Config file root is not a JSON object",
      };
    }
    return {
      format: "json",
      value: parsed,
    };
  } catch (jsonError) {
    const parseErrors: ParseError[] = [];
    const parsed = parseJsonc(normalizedContent, parseErrors, {
      allowTrailingComma: true,
      disallowComments: false,
      allowEmptyContent: false,
    });

    if (parseErrors.length > 0) {
      const firstParseError = parseErrors[0];
      const strictErrorMessage =
        jsonError instanceof Error ? jsonError.message : String(jsonError);
      const jsoncDetail = firstParseError
        ? `${printParseErrorCode(firstParseError.error)} at offset ${firstParseError.offset}`
        : "Unknown parse error";
      return {
        format: "invalid",
        error: `Invalid JSON: ${strictErrorMessage}. JSONC parse error: ${jsoncDetail}`,
      };
    }

    if (!isPlainObject(parsed)) {
      return {
        format: "invalid",
        error: "Config file root is not a JSON object",
      };
    }

    return {
      format: "jsonc",
      value: parsed,
    };
  }
}

function parseYamlConfigObject(content: string): ParsedConfigObjectResult {
  const normalizedContent = normalizeConfigContent(content);
  if (normalizedContent.trim() === "") {
    return { value: {} };
  }

  try {
    const parsed = parseYaml(normalizedContent);
    if (parsed === null || parsed === undefined) {
      return { value: {} };
    }
    if (!isPlainObject(parsed)) {
      return { error: "Config file root is not a YAML object" };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return {
      error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function parseTomlConfigObject(content: string): ParsedConfigObjectResult {
  const normalizedContent = normalizeConfigContent(content);
  if (normalizedContent.trim() === "") {
    return { value: {} };
  }

  try {
    const parsed = parseToml(normalizedContent);
    if (!isPlainObject(parsed)) {
      return { error: "Config file root is not a TOML object" };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return {
      error: `Invalid TOML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatYamlError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseYamlConfigDocument(content: string): ParsedYamlDocumentResult {
  const normalizedContent = normalizeConfigContent(content);
  const source = normalizedContent.trim() === "" ? "{}\n" : normalizedContent;

  let doc: Document.Parsed;
  try {
    doc = parseDocument(source);
  } catch (err) {
    return {
      status: "error",
      error: `Invalid YAML: ${formatYamlError(err)}`,
    };
  }

  if (doc.errors.length > 0) {
    const firstError = doc.errors[0];
    return {
      status: "error",
      error: `Invalid YAML: ${formatYamlError(firstError)}`,
    };
  }

  const contents = doc.contents;
  if (!contents || !isMap(contents)) {
    return {
      status: "error",
      error: "Config file root is not a YAML object",
    };
  }

  return {
    status: "ok",
    doc,
    root: contents,
  };
}

function toYamlConfigShapeError(serversKey: string): string {
  return `"${serversKey}" is not a YAML object`;
}

function toYamlKeyString(key: unknown): string | null {
  if (typeof key === "string") {
    return key;
  }
  if (!isScalar(key) || typeof key.value !== "string") {
    return null;
  }
  return key.value;
}

function getYamlMatchingServerKeys(
  serversMap: YAMLMap<unknown, unknown>,
  serverName: string,
): string[] {
  const normalizedTarget = serverName.toLowerCase();
  return serversMap.items
    .map((pair) => toYamlKeyString(pair.key))
    .filter(
      (key): key is string =>
        typeof key === "string" && key.toLowerCase() === normalizedTarget,
    );
}

function yamlNodeToJsValue(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "toJSON" in value &&
    typeof value.toJSON === "function"
  ) {
    return value.toJSON();
  }
  return value;
}

function createEmptyYamlMapNode(): YAMLMap<unknown, unknown> {
  const map = parseDocument("{}\n").contents;
  if (!map || !isMap(map)) {
    throw new Error("Failed to initialize YAML object node");
  }
  return map;
}

function ensureYamlServersMapForSetup(
  root: YAMLMap<unknown, unknown>,
  serversKey: string,
): ParsedYamlServersMapResult {
  const existingServers = root.get(serversKey, true);
  if (
    existingServers === undefined ||
    existingServers === null ||
    (isScalar(existingServers) && existingServers.value === null)
  ) {
    root.set(serversKey, createEmptyYamlMapNode());
    const initializedServers = root.get(serversKey, true);
    if (!initializedServers || !isMap(initializedServers)) {
      return {
        status: "error",
        error: toYamlConfigShapeError(serversKey),
      };
    }
    return {
      status: "ok",
      serversMap: initializedServers,
    };
  }

  if (!isMap(existingServers)) {
    return {
      status: "error",
      error: toYamlConfigShapeError(serversKey),
    };
  }

  return {
    status: "ok",
    serversMap: existingServers,
  };
}

function getYamlServersMapForUninstall(
  root: YAMLMap<unknown, unknown>,
  serversKey: string,
): ParsedYamlServersMapResult {
  const existingServers = root.get(serversKey, true);
  if (
    existingServers === undefined ||
    existingServers === null ||
    (isScalar(existingServers) && existingServers.value === null)
  ) {
    return { status: "not_configured" };
  }
  if (!isMap(existingServers)) {
    return {
      status: "error",
      error: toYamlConfigShapeError(serversKey),
    };
  }
  return {
    status: "ok",
    serversMap: existingServers,
  };
}

function renderYamlDocument(doc: Document.Parsed): string {
  const rendered = doc.toString();
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

function mergeYamlServerConfig(
  existingContent: string,
  serversKey: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
): MergeResult {
  const parsed = parseYamlConfigDocument(existingContent);
  if (parsed.status === "error") {
    return { status: "parse_error", error: parsed.error };
  }

  const serversResult = ensureYamlServersMapForSetup(parsed.root, serversKey);
  if (serversResult.status !== "ok") {
    return {
      status: "parse_error",
      error:
        serversResult.status === "error"
          ? serversResult.error
          : toYamlConfigShapeError(serversKey),
    };
  }

  const { serversMap } = serversResult;
  const matchingKeys = getYamlMatchingServerKeys(serversMap, serverName);
  if (matchingKeys.length === 1 && matchingKeys[0] === serverName) {
    const existingValue = yamlNodeToJsValue(serversMap.get(serverName, true));
    if (isEquivalentConfiguredValue(existingValue, serverConfig)) {
      return { status: "already_configured" };
    }
  }

  for (const key of matchingKeys) {
    serversMap.delete(key);
  }
  const hadExisting = matchingKeys.length > 0;
  serversMap.set(serverName, serverConfig);

  return {
    status: hadExisting ? "updated" : "added",
    content: renderYamlDocument(parsed.doc),
  };
}

function removeYamlServerConfig(
  existingContent: string,
  serversKey: string,
  serverName: string,
): RemoveResult {
  const parsed = parseYamlConfigDocument(existingContent);
  if (parsed.status === "error") {
    return { status: "parse_error", error: parsed.error };
  }

  const serversResult = getYamlServersMapForUninstall(parsed.root, serversKey);
  if (serversResult.status === "not_configured") {
    return { status: "not_configured" };
  }
  if (serversResult.status === "error") {
    return {
      status: "parse_error",
      error: serversResult.error,
    };
  }

  const matchingKeys = getYamlMatchingServerKeys(
    serversResult.serversMap,
    serverName,
  );
  if (matchingKeys.length === 0) {
    return { status: "not_configured" };
  }

  for (const key of matchingKeys) {
    serversResult.serversMap.delete(key);
  }

  return {
    status: "removed",
    content: renderYamlDocument(parsed.doc),
  };
}

export function parseConfigObjectForFormat(
  content: string,
  format: ConfigFileFormat = "json",
): ParsedConfigObjectResult {
  if (format === "yaml") {
    return parseYamlConfigObject(content);
  }
  if (format === "toml") {
    return parseTomlConfigObject(content);
  }

  const parsed = parseConfigObject(content);
  if (parsed.format === "invalid") {
    return { error: parsed.error };
  }
  return { value: parsed.value };
}

function renderConfigObjectForFormat(
  config: Record<string, unknown>,
  format: ConfigFileFormat = "json",
): string {
  if (format === "yaml") {
    const rendered = stringifyYaml(config);
    return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
  }
  if (format === "toml") {
    const rendered = stringifyToml(config);
    return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

function getConfigObjectFormatName(format: ConfigFileFormat = "json"): string {
  if (format === "yaml") return "YAML";
  if (format === "toml") return "TOML";
  return "JSON";
}

/**
 * Detect whether config content is strict JSON, JSONC, or invalid.
 *
 * Used by tests and diagnostics to assert parser behavior independently from
 * merge/check flows.
 */
export function detectConfigFormat(content: string): ConfigFormat {
  const parsed = parseConfigObject(content);
  return parsed.format;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) {
        return false;
      }
    }
    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!deepEqual(leftKeys, rightKeys)) {
      return false;
    }
    for (const key of leftKeys) {
      if (!deepEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isGitHitsPackageToken(token: string): boolean {
  return token.toLowerCase() === "githits@latest";
}

function isLocalGitHitsInvocation(invocation: string[]): boolean {
  if (invocation.length === 5) {
    const [command, yesFlag, packageToken, subcommand, action] = invocation;
    return (
      command === "npx" &&
      yesFlag === "-y" &&
      typeof packageToken === "string" &&
      isGitHitsPackageToken(packageToken) &&
      subcommand === "mcp" &&
      action === "start"
    );
  }

  return false;
}

function extractInvocation(config: unknown): string[] | null {
  if (!isPlainObject(config)) {
    return null;
  }

  const command = config.command;
  if (typeof command === "string") {
    const args = config.args;
    if (!isStringArray(args)) {
      return null;
    }
    return [command, ...args];
  }

  if (isStringArray(command)) {
    return [...command];
  }

  return null;
}

function nonCommandFieldsEqual(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "command" || key === "args") {
      continue;
    }
    if (!deepEqual(existing[key], value)) {
      return false;
    }
  }
  return true;
}

function hasLegacyRemoteIndicators(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  if ("url" in existing || "serverUrl" in existing) {
    return true;
  }

  if (
    "type" in existing &&
    !("type" in expected) &&
    (existing.type === "http" || existing.type === "streamableHttp")
  ) {
    return true;
  }

  return false;
}

export function isEquivalentConfiguredValue(
  existing: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (deepEqual(existing, expected)) {
    return true;
  }

  if (!isPlainObject(existing)) {
    return false;
  }

  const expectedInvocation = extractInvocation(expected);
  const existingInvocation = extractInvocation(existing);
  if (!expectedInvocation || !existingInvocation) {
    return false;
  }

  if (
    !isLocalGitHitsInvocation(expectedInvocation) ||
    !isLocalGitHitsInvocation(existingInvocation)
  ) {
    return false;
  }

  if (hasLegacyRemoteIndicators(existing, expected)) {
    return false;
  }

  return nonCommandFieldsEqual(existing, expected);
}

export function getMatchingServerKeys(
  servers: Record<string, unknown>,
  serverName: string,
): string[] {
  const normalizedTarget = serverName.toLowerCase();
  return Object.keys(servers).filter(
    (key) => key.toLowerCase() === normalizedTarget,
  );
}

/** Result of executing a setup operation */
export interface SetupResult {
  status: "success" | "already_configured" | "failed";
  /** Human-readable message describing the outcome */
  message: string;
  /**
   * Per-target changes for display (paths written, commands run). Present on
   * success/already_configured; carried through verification failure so the
   * user can still see what was written.
   */
  changes?: SetupChange[];
}

/** Result of executing an uninstall operation */
export interface UninstallResult {
  status: "removed" | "not_configured" | "failed";
  /** Human-readable message describing the outcome */
  message: string;
  /** Non-fatal cleanup or verification warnings. */
  warnings?: string[];
  /** Per-target changes for display (paths/commands removed or already absent). */
  changes?: UninstallChange[];
}

/**
 * Merge a new MCP server entry into existing JSON config content.
 * Pure function — no IO, no side effects.
 *
 * Handles edge cases:
 * - Empty or missing content (starts from {})
 * - Existing config with other servers (preserves them)
 * - Server already configured (returns already_configured)
 * - Malformed JSON (returns parse_error, never destroys content)
 * - BOM prefix (strips before parsing)
 */
export function mergeServerConfig(
  existingContent: string,
  serversKey: string,
  serverName: string,
  serverConfig: Record<string, unknown>,
  format: ConfigFileFormat = "json",
): MergeResult {
  if (format === "yaml") {
    return mergeYamlServerConfig(
      existingContent,
      serversKey,
      serverName,
      serverConfig,
    );
  }

  const parsedConfig = parseConfigObjectForFormat(existingContent, format);
  if ("error" in parsedConfig) {
    return {
      status: "parse_error",
      error: parsedConfig.error,
    };
  }
  const config = parsedConfig.value;

  // Get or create the servers section
  if (!(serversKey in config)) {
    config[serversKey] = {};
  }

  const servers = config[serversKey];
  if (
    typeof servers !== "object" ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return {
      status: "parse_error",
      error: `"${serversKey}" is not a ${getConfigObjectFormatName(format)} object`,
    };
  }

  // Check if already configured
  const serversObj = servers as Record<string, unknown>;
  const matchingKeys = getMatchingServerKeys(serversObj, serverName);
  if (
    matchingKeys.length === 1 &&
    matchingKeys[0] === serverName &&
    isEquivalentConfiguredValue(serversObj[serverName], serverConfig)
  ) {
    return { status: "already_configured" };
  }

  // Add or migrate server entry; collapse case-variant duplicates.
  for (const key of matchingKeys) {
    delete serversObj[key];
  }

  const hadExisting = matchingKeys.length > 0;
  serversObj[serverName] = serverConfig;

  return {
    status: hadExisting ? "updated" : "added",
    content: renderConfigObjectForFormat(config, format),
  };
}

/**
 * Remove GitHits MCP server entries from existing JSON/JSONC config content.
 * Pure function — no IO, no side effects.
 */
export function removeServerConfig(
  existingContent: string,
  serversKey: string,
  serverName: string,
  format: ConfigFileFormat = "json",
): RemoveResult {
  if (format === "yaml") {
    return removeYamlServerConfig(existingContent, serversKey, serverName);
  }

  const parsedConfig = parseConfigObjectForFormat(existingContent, format);
  if ("error" in parsedConfig) {
    return {
      status: "parse_error",
      error: parsedConfig.error,
    };
  }

  const config = parsedConfig.value;
  const servers = config[serversKey];
  if (servers === undefined) {
    return { status: "not_configured" };
  }
  if (
    typeof servers !== "object" ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return {
      status: "parse_error",
      error: `"${serversKey}" is not a ${getConfigObjectFormatName(format)} object`,
    };
  }

  const serversObj = servers as Record<string, unknown>;
  const matchingKeys = getMatchingServerKeys(serversObj, serverName);
  if (matchingKeys.length === 0) {
    return { status: "not_configured" };
  }

  for (const key of matchingKeys) {
    delete serversObj[key];
  }

  return {
    status: "removed",
    content: renderConfigObjectForFormat(config, format),
  };
}

function buildManagedBlock(marker: string, blockContent: string): string {
  return `${marker}\n${blockContent.trim()}\n${marker}`;
}

function normalizeManagedFileHeader(fileHeader: string | undefined): string {
  return fileHeader?.trim().length ? fileHeader.trim() : "";
}

function getManagedBlockRegex(marker: string): RegExp {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|\\r?\\n)${escaped}\\r?\\n[\\s\\S]*?\\r?\\n${escaped}(?=\\r?\\n|$)`,
  );
}

/**
 * Insert or replace a small managed block in an instruction file.
 * Only content between identical marker lines is owned by GitHits.
 */
export function mergeManagedBlock(
  existingContent: string,
  marker: string,
  blockContent: string,
  fileHeader?: string,
): ManagedBlockMergeResult {
  const block = buildManagedBlock(marker, blockContent);
  const normalizedExisting = normalizeConfigContent(existingContent);
  const header = normalizeManagedFileHeader(fileHeader);
  const regex = getManagedBlockRegex(marker);
  const match = normalizedExisting.match(regex);

  if (match) {
    const matchedBlock = match[0].replace(/^\r?\n/, "");
    if (matchedBlock === block) {
      return { status: "already_configured" };
    }
    const prefix =
      match[0].startsWith("\n") || match[0].startsWith("\r\n") ? "\n" : "";
    return {
      status: "updated",
      content: normalizedExisting.replace(regex, `${prefix}${block}`),
    };
  }

  const base =
    normalizedExisting.trim().length === 0 && header
      ? ensureTrailingNewline(header)
      : ensureTrailingNewline(normalizedExisting);
  return {
    status: "added",
    content: `${base}${base.trim().length > 0 ? "\n" : ""}${block}\n`,
  };
}

/** Remove a GitHits-managed instruction block if present. */
export function removeManagedBlock(
  existingContent: string,
  marker: string,
  fileHeader?: string,
): ManagedBlockRemoveResult {
  const normalizedExisting = normalizeConfigContent(existingContent);
  const header = normalizeManagedFileHeader(fileHeader);
  const regex = getManagedBlockRegex(marker);
  if (!regex.test(normalizedExisting)) {
    return { status: "not_configured" };
  }
  const content = normalizedExisting
    .replace(regex, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  if (header && content.trim() === header) {
    return { status: "removed", content: "" };
  }
  return {
    status: "removed",
    content: content.length > 0 ? `${content}\n` : "",
  };
}

/**
 * Check whether config content contains any case-insensitive GitHits server key.
 * Used by uninstall so legacy or non-current GitHits entries can be removed.
 */
export function hasServerConfigEntry(
  existingContent: string,
  serversKey: string,
  serverName: string,
  format: ConfigFileFormat = "json",
): boolean {
  const parsedConfig = parseConfigObjectForFormat(existingContent, format);
  if ("error" in parsedConfig) {
    return false;
  }

  const servers = parsedConfig.value[serversKey];
  if (
    typeof servers !== "object" ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return false;
  }

  return (
    getMatchingServerKeys(servers as Record<string, unknown>, serverName)
      .length > 0
  );
}

/**
 * Check if GitHits is already configured in a config file.
 * Read-only — never writes. Returns false on any error (file missing, parse failure).
 */
export async function isAlreadyConfigured(
  config: ConfigFileSetup,
  fs: FileSystemService,
): Promise<boolean> {
  try {
    const content = await fs.readFile(config.configPath);
    const parsedConfig = parseConfigObjectForFormat(content, config.format);
    if ("error" in parsedConfig) {
      return false;
    }
    const parsed = parsedConfig.value;

    const servers = parsed[config.serversKey];
    if (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    ) {
      return false;
    }

    const serversObj = servers as Record<string, unknown>;
    const matchingKeys = getMatchingServerKeys(serversObj, config.serverName);
    if (matchingKeys.length !== 1 || matchingKeys[0] !== config.serverName) {
      return false;
    }

    return isEquivalentConfiguredValue(
      serversObj[config.serverName],
      config.serverConfig,
    );
  } catch {
    return false;
  }
}

/**
 * Check if GitHits has any removable config entry in a config file.
 * Read-only — never writes. Returns false on missing or malformed files.
 */
export async function isConfiguredForUninstall(
  config: ConfigFileSetup,
  fs: FileSystemService,
): Promise<boolean> {
  return (
    (await getConfigUninstallCheckStatus(config, fs)).status === "configured"
  );
}

/**
 * Inspect config file uninstallability without writing.
 * Preserves read/parse failures so callers can surface them to users.
 */
export async function getConfigUninstallCheckStatus(
  config: ConfigFileSetup,
  fs: FileSystemService,
): Promise<ConfigUninstallCheckResult> {
  try {
    const content = await fs.readFile(config.configPath);
    const parsedConfig = parseConfigObjectForFormat(content, config.format);
    if ("error" in parsedConfig) {
      return {
        status: "failed",
        message: `Cannot parse ${config.configPath}: ${parsedConfig.error}. File left unchanged.`,
      };
    }

    const servers = parsedConfig.value[config.serversKey];
    if (servers === undefined || servers === null) {
      return { status: "not_configured" };
    }
    if (
      typeof servers !== "object" ||
      servers === null ||
      Array.isArray(servers)
    ) {
      return {
        status: "failed",
        message: `Cannot parse ${config.configPath}: "${config.serversKey}" is not a ${getConfigObjectFormatName(config.format)} object. File left unchanged.`,
      };
    }

    const hasEntry =
      getMatchingServerKeys(
        servers as Record<string, unknown>,
        config.serverName,
      ).length > 0;
    return { status: hasEntry ? "configured" : "not_configured" };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return { status: "not_configured" };
    }
    return {
      status: "failed",
      message: `Cannot read ${config.configPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check whether a setup is fully configured without mutating user state.
 * Composite setups are configured only when every child step is configured.
 */
export async function isSetupAlreadyConfigured(
  config: SetupConfig,
  fs: FileSystemService,
  execService: ExecService,
  trace?: { agentId: string; phase: string },
): Promise<boolean> {
  return (
    (await getSetupCheckStatus(config, fs, execService, trace)) === "configured"
  );
}

/**
 * Inspect a complete setup without collapsing probe failures or disabled entries.
 * Composite precedence preserves the most actionable child state.
 */
export async function getSetupCheckStatus(
  config: SetupConfig,
  fs: FileSystemService,
  execService: ExecService,
  trace?: { agentId: string; phase: string },
): Promise<SetupCheckStatus> {
  if (config.method === "config-file") {
    return (await isAlreadyConfigured(config, fs))
      ? "configured"
      : "not_configured";
  }

  if (config.method === "skill") {
    return (await isSkillAlreadyConfigured(config, fs))
      ? "configured"
      : "not_configured";
  }

  if (config.method === "managed-block") {
    return (await isManagedBlockAlreadyConfigured(config, fs))
      ? "configured"
      : "not_configured";
  }

  if (config.method === "cli") {
    if (!config.checkCommand) {
      return "not_configured";
    }
    return getCliCheckStatus(config.checkCommand, execService, fs, trace);
  }

  const statuses: SetupCheckStatus[] = [];
  for (const step of config.steps) {
    statuses.push(await getSetupCheckStatus(step, fs, execService, trace));
  }
  if (statuses.some((status) => status === "probe_failed")) {
    return "probe_failed";
  }
  if (statuses.some((status) => status === "disabled")) {
    return "disabled";
  }
  if (statuses.some((status) => status === "non_canonical")) {
    return "non_canonical";
  }
  return statuses.every((status) => status === "configured")
    ? "configured"
    : "not_configured";
}

async function isSkillAlreadyConfigured(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<boolean> {
  try {
    const source = await readSkillSourceContent(setup, fs);
    const target = await fs.readFile(setup.targetPath);
    return source === target;
  } catch {
    return false;
  }
}

async function isManagedBlockAlreadyConfigured(
  setup: ManagedBlockSetup,
  fs: FileSystemService,
): Promise<boolean> {
  try {
    const content = await fs.readFile(setup.targetPath);
    return (
      mergeManagedBlock(
        content,
        setup.marker,
        setup.blockContent,
        setup.fileHeader,
      ).status === "already_configured"
    );
  } catch {
    return false;
  }
}

/**
 * Check if a CLI agent is already configured by running a read-only check command.
 * Checks pattern against combined stdout+stderr regardless of exit code.
 * Returns false on ENOENT or when pattern does not match.
 */
export async function isCliAlreadyConfigured(
  check: CliCheckCommand,
  execService: ExecService,
  trace?: { agentId: string; phase: string },
): Promise<boolean> {
  return (
    (await getCliCheckStatus(check, execService, undefined, trace)) ===
    "configured"
  );
}

/**
 * Check CLI configuration status without collapsing disabled entries or probe
 * failures into a definitive "not configured" result.
 */
export async function getCliCheckStatus(
  check: CliCheckCommand,
  execService: ExecService,
  fs?: FileSystemService,
  trace?: { agentId: string; phase: string },
): Promise<CliCheckStatus> {
  const startedAt = Date.now();
  if (trace) {
    traceProbeStart({
      agentId: trace.agentId,
      phase: trace.phase,
      command: check.command,
      args: check.args,
    });
  }
  let isolatedCwd: string | undefined;
  try {
    if (check.useIsolatedCwd) {
      if (!fs) {
        return "probe_failed";
      }
      isolatedCwd = await fs.createTempDir("githits-init-probe-");
    }
    const result = await execService.exec(check.command, check.args, {
      timeoutMs: check.timeoutMs ?? 5_000,
      ...(isolatedCwd !== undefined && { cwd: isolatedCwd }),
    });
    if (trace) {
      traceProbeEnd({
        agentId: trace.agentId,
        phase: trace.phase,
        startedAt,
        status: "end",
        exitCode: result.exitCode,
      });
    }
    if (check.evaluateResult) {
      return check.evaluateResult(result);
    }
    const combined = `${result.stdout} ${result.stderr}`;
    if (check.notConfiguredPattern?.test(combined)) {
      return "not_configured";
    }
    if (check.requireExitCodeZero && result.exitCode !== 0) {
      return "probe_failed";
    }
    if (check.configuredPattern) {
      return check.configuredPattern.test(combined)
        ? "configured"
        : "not_configured";
    }
    if (check.notConfiguredPattern) {
      return "configured";
    }
    return "not_configured";
  } catch (err) {
    if (trace) {
      traceProbeEnd({
        agentId: trace.agentId,
        phase: trace.phase,
        startedAt,
        status:
          err instanceof Error && err.name === "ExecTimeoutError"
            ? "timeout"
            : "error",
      });
    }
    return "probe_failed";
  } finally {
    if (isolatedCwd && fs) {
      try {
        await fs.deleteDirIfEmpty(isolatedCwd);
      } catch {
        // A timed-out Windows wrapper may leave a child holding the directory.
        // Cleanup is best-effort and must never change the probe outcome.
      }
    }
  }
}

/** Dispatch a discriminated setup check without exposing file details. */
export async function dispatchSetupCheck(
  check: SetupCheck,
  fileSystem: FileSystemService,
  execService: ExecService,
  trace?: { agentId: string; phase: string },
): Promise<SetupCheckStatus> {
  if (check.kind === "command") {
    return getCliCheckStatus(check, execService, fileSystem, trace);
  }

  let content: string;
  try {
    content = await fileSystem.readFile(check.path);
  } catch (error) {
    return getFileCheckReadStatus(error);
  }

  try {
    return check.evaluateContent(content);
  } catch {
    return "probe_failed";
  }
}

function getFileCheckReadStatus(error: unknown): SetupCheckStatus {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return "not_configured";
  }
  return "probe_failed";
}

/** Patterns in CLI output that indicate the server was already configured */
const ALREADY_EXISTS_PATTERNS = [
  /already exists/i,
  /already configured/i,
  /already added/i,
  /extension\s+"githits"\s+is\s+already\s+installed/i,
];

/** Patterns in CLI output that indicate GitHits was already absent */
const ALREADY_ABSENT_PATTERNS = [
  /^\s*No MCP server named ["']githits["'] in user scope\.?\s*$/im,
  /(?:plugin|extension|server|mcp server)\s+["']?githits["']?\s+(?:was\s+)?not\s+found/i,
  /["']?githits["']?\s+(?:plugin|extension|server)?\s*(?:does\s+not\s+exist|is\s+not\s+installed|not\s+installed)/i,
  /(?:package\s+)?["']?pi-mcp-adapter["']?\s+(?:(?:is\s+)?not\s+installed|not\s+found)/i,
  /unknown\s+(?:plugin|extension|server)\s+["']?githits["']?/i,
  /marketplace\s+["']?githits-plugins["']?\s+(?:was\s+)?not\s+found/i,
];

/** Check if CLI output indicates the server is already configured */
function isAlreadyConfiguredOutput(output: string): boolean {
  return ALREADY_EXISTS_PATTERNS.some((pattern) => pattern.test(output));
}

/** Check if CLI output indicates GitHits is already absent */
function isAlreadyAbsentOutput(output: string): boolean {
  return ALREADY_ABSENT_PATTERNS.some((pattern) => pattern.test(output));
}

/**
 * Execute a single CLI command step.
 * Returns a result object — does not throw on failure.
 */
async function executeCliCommand(
  cmd: CliCommand,
  execService: ExecService,
): Promise<SetupResult> {
  try {
    const result = await execService.exec(cmd.command, cmd.args);
    const combined = `${result.stdout} ${result.stderr}`;

    if (cmd.allowAlreadyAbsent && isAlreadyAbsentOutput(combined)) {
      return {
        status: "already_configured",
        message: `Previous GitHits configuration already absent via ${cmd.command}`,
      };
    }

    // Check for "already exists" in output regardless of exit code
    if (isAlreadyConfiguredOutput(combined)) {
      return {
        status: "already_configured",
        message: `GitHits already configured via ${cmd.command}`,
      };
    }

    if (result.exitCode === 0) {
      return { status: "success", message: "Configured successfully" };
    }
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      status: "failed",
      message: `Command exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    };
  } catch (err) {
    // ENOENT means the CLI binary is not installed/on PATH
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return {
        status: "failed",
        message: `"${cmd.command}" not found on PATH. Install it or configure manually.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to run command: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Execute a single CLI uninstall command step. */
async function executeCliUninstallCommand(
  cmd: CliCommand,
  execService: ExecService,
): Promise<UninstallResult> {
  try {
    const result = await execService.exec(cmd.command, cmd.args);
    const combined = `${result.stdout} ${result.stderr}`;

    if (isAlreadyAbsentOutput(combined)) {
      return {
        status: "not_configured",
        message: `GitHits not configured via ${cmd.command}`,
      };
    }

    if (result.exitCode === 0) {
      return { status: "removed", message: "Removed successfully" };
    }

    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      status: "failed",
      message: `Command exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return {
        status: "failed",
        message: `"${cmd.command}" not found on PATH. Install it or remove GitHits manually.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to run command: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute a CLI-based setup with one or more sequential commands.
 * Returns a result object — does not throw on failure.
 *
 * For multi-step setups (e.g., legacy cleanup followed by MCP add),
 * commands run sequentially and stop on first failure.
 * The overall result is "success" if any command actually ran (made a change),
 * and "already_configured" only when every command was already configured.
 */
export async function executeCliSetup(
  setup: CliSetup,
  execService: ExecService,
): Promise<SetupResult> {
  let anyRan = false;
  // One change per command so multi-step replacement setups report each
  // command's individual outcome.
  const changes: SetupChange[] = [];

  for (const cmd of setup.commands) {
    const result = await executeCliCommand(cmd, execService);

    if (result.status === "failed") {
      // Keep the commands that already ran visible on failure.
      return { ...result, changes };
    }
    const wasAlreadyConfigured = result.status === "already_configured";
    if (!wasAlreadyConfigured) {
      anyRan = true;
    }
    changes.push({
      kind: "command",
      command: formatCliCommand(cmd),
      change: wasAlreadyConfigured ? "unchanged" : "ran",
    });
  }

  if (!anyRan) {
    return {
      status: "already_configured",
      message: `GitHits already configured via ${setup.commands[0]?.command}`,
      changes,
    };
  }

  return { status: "success", message: "Configured successfully", changes };
}

/** Execute a CLI-based uninstall with one or more sequential commands. */
export async function executeCliUninstall(
  uninstall: CliUninstall,
  execService: ExecService,
): Promise<UninstallResult> {
  if (uninstall.commands.length === 0) {
    return {
      status: "failed",
      message: "No uninstall commands configured.",
    };
  }

  let anyRemoved = false;
  let anyNotConfigured = false;
  const warnings: string[] = [];
  const changes: UninstallChange[] = [];

  for (const cmd of uninstall.commands) {
    const result = await executeCliUninstallCommand(cmd, execService);

    if (result.status === "failed") {
      if (anyRemoved) {
        warnings.push(result.message);
        continue;
      }
      return { ...result, changes };
    }
    changes.push({
      kind: "command",
      command: formatCliCommand(cmd),
      change: result.status === "removed" ? "ran" : "unchanged",
    });
    if (result.status === "removed") {
      anyRemoved = true;
    }
    if (result.status === "not_configured") {
      if (anyRemoved) {
        warnings.push(result.message);
        continue;
      }
      anyNotConfigured = true;
    }
  }

  if (anyRemoved) {
    return {
      status: "removed",
      message: "Removed successfully",
      warnings: warnings.length > 0 ? warnings : undefined,
      changes,
    };
  }
  if (anyNotConfigured) {
    return {
      status: "not_configured",
      message: `GitHits not configured via ${uninstall.commands[0]?.command}`,
      changes,
    };
  }
  return { status: "removed", message: "Removed successfully", changes };
}

/** Execute an uninstall made from ordered CLI/config-file cleanup steps. */
export async function executeCompositeUninstall(
  uninstall: CompositeUninstall,
  fs: FileSystemService,
  execService: ExecService,
): Promise<UninstallResult> {
  let anyRemoved = false;
  let anyNotConfigured = false;
  const warnings: string[] = [];
  const changes: UninstallChange[] = [];

  for (const { step, failureMode } of uninstall.steps) {
    const result = await executeUninstallStep(step, fs, execService);

    if (result.changes) {
      changes.push(...result.changes);
    }

    if (result.status === "removed") {
      anyRemoved = true;
      warnings.push(...(result.warnings ?? []));
      continue;
    }

    if (result.status === "not_configured") {
      if (anyRemoved) {
        warnings.push(result.message);
      } else {
        anyNotConfigured = true;
      }
      continue;
    }

    if (failureMode === "best-effort" && anyRemoved) {
      warnings.push(result.message);
      continue;
    }
    return { ...result, changes };
  }

  if (anyRemoved) {
    return {
      status: "removed",
      message: "Removed successfully",
      warnings: warnings.length > 0 ? warnings : undefined,
      changes,
    };
  }

  if (anyNotConfigured) {
    return {
      status: "not_configured",
      message: "GitHits not configured",
      changes,
    };
  }

  return {
    status: "not_configured",
    message: "GitHits not configured",
    changes,
  };
}

async function executeUninstallStep(
  step: UninstallStep,
  fs: FileSystemService,
  execService: ExecService,
): Promise<UninstallResult> {
  if (step.method === "cli") {
    return executeCliUninstall(step, execService);
  }
  if (step.method === "config-file") {
    return executeConfigFileUninstall(step, fs);
  }
  if (step.method === "skill") {
    return executeSkillUninstall(step, fs);
  }
  return executeManagedBlockUninstall(step, fs);
}

/**
 * Execute a config-file-based setup (read/merge/atomic-write).
 * Returns a result object — does not throw on failure.
 */
export async function executeConfigFileSetup(
  setup: ConfigFileSetup,
  fs: FileSystemService,
): Promise<SetupResult> {
  try {
    // Ensure parent directory exists
    const parentDir = fs.getDirname(setup.configPath);
    await fs.ensureDir(parentDir);

    // Read existing content or start fresh
    let existingContent = "";
    let fileExisted = true;
    try {
      existingContent = await fs.readFile(setup.configPath);
    } catch (err) {
      // ENOENT is expected for new files
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        err.code !== "ENOENT"
      ) {
        return {
          status: "failed",
          message: `Cannot read ${setup.configPath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      fileExisted = false;
    }

    // Merge config
    const result = mergeServerConfig(
      existingContent,
      setup.serversKey,
      setup.serverName,
      setup.serverConfig,
      setup.format,
    );

    if (result.status === "already_configured") {
      return {
        status: "already_configured",
        message: `GitHits already configured in ${setup.configPath}`,
        changes: [
          { kind: "config-file", path: setup.configPath, change: "unchanged" },
        ],
      };
    }

    if (result.status === "parse_error") {
      return {
        status: "failed",
        message: `Cannot parse ${setup.configPath}: ${result.error}. File left unchanged.`,
      };
    }

    // Atomic write — result.status is "added" or "updated" here. A pre-existing
    // (even if empty) file counts as "updated"; only a missing file is "created".
    await fs.atomicWriteFile(setup.configPath, result.content);

    return {
      status: "success",
      message: "Configured successfully",
      changes: [
        {
          kind: "config-file",
          path: setup.configPath,
          change: fileExisted ? "updated" : "created",
        },
      ],
    };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EACCES") {
      return {
        status: "failed",
        message: `Permission denied writing to ${setup.configPath}. Check file permissions.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to configure: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Execute an Agent Skill install by copying a packaged SKILL.md. */
export async function executeSkillSetup(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<SetupResult> {
  try {
    const sourceContent = await readSkillSourceContent(setup, fs);
    await fs.ensureDir(fs.getDirname(setup.targetPath));

    let fileExisted = true;
    try {
      const existingContent = await fs.readFile(setup.targetPath);
      if (existingContent === sourceContent) {
        return {
          status: "already_configured",
          message: `${setup.skillName} skill already installed`,
          changes: [
            { kind: "skill", path: setup.targetPath, change: "unchanged" },
          ],
        };
      }
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        err.code !== "ENOENT"
      ) {
        return {
          status: "failed",
          message: `Cannot read ${setup.targetPath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      fileExisted = false;
    }

    await fs.atomicWriteFile(setup.targetPath, sourceContent);
    return {
      status: "success",
      message: "Skill installed successfully",
      changes: [
        {
          kind: "skill",
          path: setup.targetPath,
          change: fileExisted ? "updated" : "created",
        },
      ],
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Failed to install ${setup.skillName} skill: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function readSkillSourceContent(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<string> {
  const paths = Array.from(
    new Set([setup.sourcePath, ...(setup.sourcePathCandidates ?? [])]),
  );
  let lastError: unknown;
  for (const path of paths) {
    try {
      return await fs.readFile(path);
    } catch (err) {
      lastError = err;
    }
  }

  const suffix = paths.length > 1 ? ` from ${paths.join(", ")}` : "";
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Cannot read ${setup.skillName} skill source${suffix}: ${detail}`,
  );
}

/** Execute a managed instruction-block install. */
export async function executeManagedBlockSetup(
  setup: ManagedBlockSetup,
  fs: FileSystemService,
): Promise<SetupResult> {
  try {
    await fs.ensureDir(fs.getDirname(setup.targetPath));

    let existingContent = "";
    let fileExisted = true;
    try {
      existingContent = await fs.readFile(setup.targetPath);
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        err.code !== "ENOENT"
      ) {
        return {
          status: "failed",
          message: `Cannot read ${setup.targetPath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      fileExisted = false;
    }

    const result = mergeManagedBlock(
      existingContent,
      setup.marker,
      setup.blockContent,
      setup.fileHeader,
    );
    if (result.status === "already_configured") {
      return {
        status: "already_configured",
        message: `GitHits guidance already configured in ${setup.targetPath}`,
        changes: [
          {
            kind: "managed-block",
            path: setup.targetPath,
            change: "unchanged",
          },
        ],
      };
    }

    await fs.atomicWriteFile(setup.targetPath, result.content);
    return {
      status: "success",
      message: "Guidance configured successfully",
      changes: [
        {
          kind: "managed-block",
          path: setup.targetPath,
          change: fileExisted ? "updated" : "created",
        },
      ],
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Failed to configure guidance: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute a composite setup by skipping already configured child steps and
 * applying missing steps in order. Stops on the first failure.
 */
export async function executeCompositeSetup(
  setup: CompositeSetup,
  fs: FileSystemService,
  execService: ExecService,
): Promise<SetupResult> {
  let changedAny = false;
  const changes: SetupChange[] = [];

  for (const step of setup.steps) {
    if (await isSetupAlreadyConfigured(step, fs, execService)) {
      // Skipped steps still contribute an "unchanged" row so a partially
      // configured composite (e.g. Pi) shows all of its sub-steps.
      changes.push(...describeConfigAsUnchanged(step));
      continue;
    }

    const result =
      step.method === "cli"
        ? await executeCliSetup(step, execService)
        : step.method === "config-file"
          ? await executeConfigFileSetup(step, fs)
          : step.method === "skill"
            ? await executeSkillSetup(step, fs)
            : await executeManagedBlockSetup(step, fs);

    if (result.changes) {
      changes.push(...result.changes);
    }
    if (
      result.status === "success" &&
      (!result.changes ||
        result.changes.some((change) => change.change !== "unchanged"))
    ) {
      changedAny = true;
    }
    if (result.status === "failed") {
      // Keep prior steps (and any partial changes from the failing step)
      // visible on failure.
      return { ...result, changes };
    }
  }

  if (!changedAny) {
    return {
      status: "already_configured",
      message: "GitHits already configured",
      changes,
    };
  }

  return { status: "success", message: "Configured successfully", changes };
}

/** Execute a config-file-based uninstall (read/remove/atomic-write). */
export async function executeConfigFileUninstall(
  setup: ConfigFileSetup,
  fs: FileSystemService,
): Promise<UninstallResult> {
  try {
    let existingContent = "";
    try {
      existingContent = await fs.readFile(setup.configPath);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return {
          status: "not_configured",
          message: `GitHits not configured in ${setup.configPath}`,
          changes: [
            {
              kind: "config-file",
              path: setup.configPath,
              change: "unchanged",
            },
          ],
        };
      }
      return {
        status: "failed",
        message: `Cannot read ${setup.configPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const result = removeServerConfig(
      existingContent,
      setup.serversKey,
      setup.serverName,
      setup.format,
    );

    if (result.status === "not_configured") {
      return {
        status: "not_configured",
        message: `GitHits not configured in ${setup.configPath}`,
        changes: [
          { kind: "config-file", path: setup.configPath, change: "unchanged" },
        ],
      };
    }

    if (result.status === "parse_error") {
      return {
        status: "failed",
        message: `Cannot parse ${setup.configPath}: ${result.error}. File left unchanged.`,
      };
    }

    // The file is rewritten with the GitHits entry stripped — the file itself
    // is updated, not deleted.
    await fs.atomicWriteFile(setup.configPath, result.content);

    return {
      status: "removed",
      message: "Removed successfully",
      changes: [
        { kind: "config-file", path: setup.configPath, change: "updated" },
      ],
    };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EACCES") {
      return {
        status: "failed",
        message: `Permission denied writing to ${setup.configPath}. Check file permissions.`,
      };
    }
    return {
      status: "failed",
      message: `Failed to uninstall: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Remove a GitHits-owned Agent Skill file. */
export async function executeSkillUninstall(
  setup: SkillSetup,
  fs: FileSystemService,
): Promise<UninstallResult> {
  try {
    if (!(await fs.exists(setup.targetPath))) {
      return {
        status: "not_configured",
        message: `${setup.skillName} skill not installed`,
        changes: [
          { kind: "skill", path: setup.targetPath, change: "unchanged" },
        ],
      };
    }
    await fs.deleteFile(setup.targetPath);
    await fs.deleteDirIfEmpty(fs.getDirname(setup.targetPath));
    return {
      status: "removed",
      message: "Skill removed successfully",
      changes: [{ kind: "skill", path: setup.targetPath, change: "removed" }],
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Failed to remove ${setup.skillName} skill: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Remove a GitHits-managed instruction block. */
export async function executeManagedBlockUninstall(
  setup: ManagedBlockSetup,
  fs: FileSystemService,
): Promise<UninstallResult> {
  try {
    let existingContent = "";
    try {
      existingContent = await fs.readFile(setup.targetPath);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return {
          status: "not_configured",
          message: `GitHits guidance not configured in ${setup.targetPath}`,
          changes: [
            {
              kind: "managed-block",
              path: setup.targetPath,
              change: "unchanged",
            },
          ],
        };
      }
      return {
        status: "failed",
        message: `Cannot read ${setup.targetPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const result = removeManagedBlock(
      existingContent,
      setup.marker,
      setup.fileHeader,
    );
    if (result.status === "not_configured") {
      return {
        status: "not_configured",
        message: `GitHits guidance not configured in ${setup.targetPath}`,
        changes: [
          {
            kind: "managed-block",
            path: setup.targetPath,
            change: "unchanged",
          },
        ],
      };
    }

    await fs.atomicWriteFile(setup.targetPath, result.content);
    return {
      status: "removed",
      message: "Guidance removed successfully",
      changes: [
        {
          kind: "managed-block",
          path: setup.targetPath,
          change: "removed",
        },
      ],
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Failed to remove guidance: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
