export interface McpSmokeToolResult {
  content?: unknown;
  isError?: boolean;
}

export interface McpSmokeCaller {
  listTools(): Promise<{
    tools: Array<{
      name: string;
      annotations?: {
        readOnlyHint?: boolean;
        openWorldHint?: boolean;
        destructiveHint?: boolean;
      };
    }>;
  }>;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpSmokeToolResult>;
}

export interface McpSmokeOptions {
  mode?: "read-only" | "dev";
  includeLiveTools?: boolean;
  logger?: Pick<Console, "log" | "error">;
}

export interface ErrorEnvelope {
  error: string;
  code: string;
  retryable: boolean;
}

export interface HttpChallengeMetadata {
  status: number;
  headers?:
    | { get(name: string): string | null }
    | Record<string, string | undefined>;
}

interface TextContent {
  type: "text";
  text: string;
}

export const EXPECTED_MCP_TOOLS = [
  "quick_start",
  "get_example",
  "search",
  "search_status",
  "list",
  "read",
  "grep",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
  "pkg_upgrade_review",
] as const;

const DEFAULT_TEXT_LIMIT = 12_000;
const TARGET_DETAIL_STATE_PATTERN =
  /^ {2}(?:(?:indexing|searched|available|unavailable|using):|(?:ready|pending|provisional|older snapshot)$|(?:not found|unresolved|version unavailable|repository ref unresolved|(?:package|repository|site|target) (?:not found|unresolved)):)/;
const SMOKE_PACKAGE_VERSION = "5.2.1";
const SMOKE_PACKAGE_TARGET = `npm:express@${SMOKE_PACKAGE_VERSION}`;
const INLINE_SEARCH_QUERY =
  "application path:lib/ intent:production lang:javascript";
const SMOKE_TRANSITIVE_VULNERABILITY_TARGET = "npm:express@4.17.1";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`${context}: expected parseable JSON (${message})`);
  }
}

function assertNotJson(text: string, context: string): void {
  try {
    JSON.parse(text);
  } catch {
    return;
  }
  throw new Error(`${context}: default response unexpectedly parsed as JSON`);
}

function assertRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${context}: expected object`,
  );
}

function assertTransitiveVulnerabilityText(
  text: string,
  context: string,
): void {
  assert(
    text.includes("Resolved dependencies"),
    `${context}: missing resolved-dependencies section`,
  );
  assert(
    !text.includes("use -v"),
    `${context}: CLI-native transitive hint leaked into MCP output`,
  );
  if (text.includes("... (+")) {
    assert(
      text.includes("use verbose=true or format=json"),
      `${context}: capped transitive output missing MCP-native hint`,
    );
  }
}

function assertTransitiveVulnerabilityJson(
  value: unknown,
  context: string,
): void {
  assertRecord(value, context);
  assertRecord(value.transitive, `${context}.transitive`);
  assert(
    value.transitive.scope === "resolved_dependencies",
    `${context}: unexpected transitive scope`,
  );
  assert(
    ["affected", "non_affecting", "all"].includes(
      value.transitive.advisoryScope as string,
    ),
    `${context}: unexpected transitive advisory scope`,
  );
  assert(
    value.transitive.withdrawnAdvisoriesIncluded === false,
    `${context}: transitive withdrawn-advisory flag must be false`,
  );
  assertRecord(value.transitive.summary, `${context}.transitive.summary`);
  for (const key of [
    "totalPackagesAnalyzed",
    "packageCount",
    "occurrenceCount",
  ]) {
    assert(
      typeof value.transitive.summary[key] === "number",
      `${context}: transitive summary missing numeric ${key}`,
    );
  }
  assert(
    Array.isArray(value.transitive.packages),
    `${context}: transitive packages must be an array`,
  );
}

function headerValue(
  headers: HttpChallengeMetadata["headers"],
  name: string,
): string | null {
  if (!headers) return null;
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name);
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value ?? null;
  }
  return null;
}

export function resultText(
  result: McpSmokeToolResult,
  context: string,
): string {
  assert(Array.isArray(result.content), `${context}: expected content array`);
  const first = result.content[0] as Partial<TextContent> | undefined;
  assert(first?.type === "text", `${context}: expected text content`);
  assert(typeof first.text === "string", `${context}: expected text string`);
  return first.text;
}

export function assertCleanErrorEnvelope(
  result: McpSmokeToolResult,
  context: string,
): ErrorEnvelope {
  assert(result.isError === true, `${context}: expected MCP error result`);
  const payload = parseJson(resultText(result, context), context);
  assertRecord(payload, context);
  assert(
    typeof payload.error === "string" && payload.error.length > 0,
    `${context}: missing error`,
  );
  assert(
    typeof payload.code === "string" && payload.code.length > 0,
    `${context}: missing code`,
  );
  assert(
    typeof payload.retryable === "boolean",
    `${context}: missing retryable`,
  );
  return payload as unknown as ErrorEnvelope;
}

export function assertHttpUnauthorizedChallenge(
  metadata: HttpChallengeMetadata,
  context = "unauthenticated HTTP challenge",
): void {
  assert(metadata.status === 401, `${context}: expected HTTP 401`);
  const challenge = headerValue(metadata.headers, "www-authenticate");
  assert(
    typeof challenge === "string" && challenge.length > 0,
    `${context}: missing WWW-Authenticate header`,
  );
  assert(
    /^Bearer\b/i.test(challenge),
    `${context}: expected Bearer challenge, got ${challenge}`,
  );
}

export function assertDefaultText(
  result: McpSmokeToolResult,
  context: string,
): string {
  assert(result.isError !== true, `${context}: expected success`);
  const text = resultText(result, context);
  assert(text.length > 0, `${context}: expected non-empty text`);
  assert(
    text.length < DEFAULT_TEXT_LIMIT,
    `${context}: default text too large (${text.length} chars)`,
  );
  assertNotJson(text, context);
  assert(
    !text.includes("--lifecycle"),
    `${context}: leaked CLI lifecycle flag`,
  );
  assert(!text.includes("--verbose"), `${context}: leaked CLI verbose flag`);
  return text;
}

function listTextFirstPath(text: string, context: string): string {
  const [header, path] = text.split("\n");
  assert(header?.startsWith("# source "), `${context}: missing source header`);
  assert(path !== undefined && path.length > 0, `${context}: missing path`);
  return path;
}

function listTextContinuation(text: string, context: string): string {
  const line = text.split("\n").find((value) => value.startsWith("  after="));
  assert(line !== undefined, `${context}: missing after continuation`);
  const parsed = parseJson(line.slice("  after=".length), context);
  assert(
    typeof parsed === "string" && parsed.length > 0,
    `${context}: invalid after continuation`,
  );
  return parsed;
}

function assertGrepResult(
  value: unknown,
  context: string,
): Record<string, unknown> {
  assertRecord(value, context);
  assert(Array.isArray(value.hits), `${context}: hits must be an array`);
  assert(Array.isArray(value.targets), `${context}: targets must be an array`);
  assert(
    Array.isArray(value.unavailableTargets),
    `${context}: unavailableTargets must be an array`,
  );
  assert(
    [
      "COMPLETE",
      "RESUMABLE_LIMIT",
      "NON_RESUMABLE_PARTIAL",
      "FAILED",
      "CURSOR_EXPIRED",
    ].includes(value.traversal as string),
    `${context}: unknown traversal state`,
  );
  assert(
    value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length > 0),
    `${context}: invalid nextCursor`,
  );
  assert(
    Number.isSafeInteger(value.totalMatches) &&
      (value.totalMatches as number) >= 0,
    `${context}: invalid totalMatches`,
  );
  if (value.traversal === "RESUMABLE_LIMIT") {
    assert(
      typeof value.nextCursor === "string" && value.nextCursor.length > 0,
      `${context}: resumable page missing nextCursor`,
    );
  }

  const targetByIndex = new Map<number, Record<string, unknown>>();
  for (const [index, target] of value.targets.entries()) {
    assertRecord(target, `${context}.targets[${index}]`);
    assert(
      Number.isSafeInteger(target.targetIndex),
      `${context}.targets[${index}]: invalid targetIndex`,
    );
    assert(
      Array.isArray(target.requestedInputIndices) &&
        target.requestedInputIndices.every(Number.isSafeInteger),
      `${context}.targets[${index}]: invalid requestedInputIndices`,
    );
    assert(
      target.kind === "REPOSITORY" || target.kind === "SITE",
      `${context}.targets[${index}]: invalid kind`,
    );
    assert(
      [
        "UNSPECIFIED",
        "CURRENT",
        "STALE",
        "NOT_AVAILABLE",
        "MISSING_REF",
        "READER_OPEN_FAILED",
        "INCOMPLETE",
        "RESOURCE_LIMIT",
        "VERSION_UNSUPPORTED",
        "READ_FAILED",
      ].includes(target.readiness as string) &&
        [
          "COMPLETE",
          "RESUMABLE_LIMIT",
          "NON_RESUMABLE_PARTIAL",
          "FAILED",
          "CURSOR_EXPIRED",
        ].includes(target.traversal as string),
      `${context}.targets[${index}]: missing readiness or traversal`,
    );
    targetByIndex.set(target.targetIndex as number, target);
  }

  for (const [index, hit] of value.hits.entries()) {
    const hitContext = `${context}.hits[${index}]`;
    assertRecord(hit, hitContext);
    const scope = targetByIndex.get(hit.targetIndex as number);
    assert(scope, `${hitContext}: no matching target status`);
    assertRecord(hit.read, `${hitContext}.read`);
    assert(
      typeof hit.read.target === "string" &&
        Number.isSafeInteger(hit.read.startLine) &&
        Number.isSafeInteger(hit.read.endLine),
      `${hitContext}: incomplete read action`,
    );
    assertRecord(hit.lineSlice, `${hitContext}.lineSlice`);
    assert(
      typeof hit.lineSlice.content === "string" &&
        Number.isSafeInteger(hit.matchStartByte) &&
        Number.isSafeInteger(hit.matchEndByte),
      `${hitContext}: incomplete match evidence`,
    );
    if (hit.__typename === "GrepRepositoryHit") {
      assert(
        scope.kind === "REPOSITORY" &&
          typeof hit.read.path === "string" &&
          typeof hit.filePath === "string",
        `${hitContext}: invalid repository hit or read action`,
      );
    } else if (hit.__typename === "GrepSiteHit") {
      assert(
        scope.kind === "SITE" &&
          hit.read.path === null &&
          typeof hit.pageUrl === "string",
        `${hitContext}: invalid hosted documentation hit or read action`,
      );
    } else {
      throw new Error(`${hitContext}: unknown hit type`);
    }
  }
  return value;
}

function grepReadArgs(
  hit: Record<string, unknown>,
  format?: "json",
): Record<string, unknown> {
  const read = hit.read as Record<string, unknown>;
  return {
    target: read.target,
    ...(typeof read.path === "string" ? { path: read.path } : {}),
    start_line: read.startLine,
    end_line: read.endLine,
    ...(format ? { format } : {}),
  };
}

function assertSearchDefaultText(text: string, context: string): void {
  const lines = text.split("\n");
  let pathOnlyBlock = false;
  for (const line of lines) {
    if (/^\[\d+\] /.test(line)) {
      pathOnlyBlock = /\[repo (?:code|doc), path match\]$/.test(line);
    } else if (pathOnlyBlock) {
      assert(
        !/^\s*>?\s*\d+ \|/.test(line),
        `${context}: path-only hit contains an arbitrary source snippet`,
      );
    }
  }
  const formatterLines = searchFormatterLines(lines);
  const formatterText = formatterLines.join("\n");
  const firstLine = lines[0]?.trim() ?? "";
  assert(firstLine.length > 0, `${context}: missing outcome first line`);
  assert(
    /^(?:No result snapshot yet|No results yet|No result snapshot|No results)\b|^\d+ (?:partial |interim )?results?\b/.test(
      firstLine,
    ),
    `${context}: missing outcome headline`,
  );
  assert(
    !firstLine.startsWith("search |") &&
      !firstLine.startsWith("search_status |"),
    `${context}: legacy header precedes outcome`,
  );
  assert(
    !formatterLines.some((line) => /^status\s*:/i.test(line.trim())),
    `${context}: duplicated lifecycle status line`,
  );
  assert(
    !formatterLines.some((line) => /^Search\s+\S+\s+\|/.test(line)),
    `${context}: separate Search <ref> session summary`,
  );
  const lifecycleOutcomeLines = lines.filter((line) =>
    /\|\s+(?:preparing|indexing|searching)(?:\s*\||$)/.test(line),
  );
  assert(
    lifecycleOutcomeLines.length <= 1,
    `${context}: duplicate lifecycle outcome lines`,
  );
  assert(
    !formatterText.includes("searchRef="),
    `${context}: leaked searchRef=`,
  );
  assert(
    !formatterText.includes("indexingRef"),
    `${context}: leaked indexingRef`,
  );

  const forbiddenSections = [
    "Ready:",
    "Waiting:",
    "Available but not searched:",
    "Indexed alternatives:",
  ];
  for (const section of forbiddenSections) {
    assert(
      !lines.some((line) => line.startsWith(section)),
      `${context}: legacy flat section ${section}`,
    );
  }
  assert(
    !lines.some((line) => line === "Evidence may change."),
    `${context}: vague evidence policy prose`,
  );
  assert(
    !lines.some((line) => line.startsWith("Do not repeat")),
    `${context}: repeat policy prose`,
  );
  assert(
    !lines.some((line) => line.startsWith("Do not poll")),
    `${context}: poll policy prose`,
  );

  const hasReadinessText = formatterLines.some((line) =>
    TARGET_DETAIL_STATE_PATTERN.test(line),
  );
  if (hasReadinessText) {
    assert(
      formatterLines.some((line) => /^-\s+\S/.test(line)),
      `${context}: readiness details must be grouped under a target`,
    );
  }

  const nextLines = lines.filter((line) => line.startsWith("Next:"));
  assert(
    nextLines.length <= 1,
    `${context}: multiple Next actions are not allowed`,
  );

  const searchRefOccurrences = formatterText.match(/search_ref=/g)?.length ?? 0;
  assert(
    searchRefOccurrences <= 1,
    `${context}: search_ref= must appear at most once`,
  );
  if (searchRefOccurrences === 1) {
    const refLine = formatterLines.find((line) => line.includes("search_ref="));
    assert(
      refLine?.trimStart().startsWith("Next:"),
      `${context}: search_ref= must appear only on a Next line`,
    );
    assert(
      refLine?.startsWith("Next: search_status "),
      `${context}: search_ref= must use the MCP search_status action`,
    );
    assert(
      refLine !== undefined,
      `${context}: search_ref= must appear only on a Next line`,
    );
    const match = refLine.match(/search_ref=(?:"([^"]+)"|(\S+))/);
    const searchRef = match?.[1] ?? match?.[2];
    assert(searchRef !== undefined, `${context}: missing search_ref value`);
  }
  assert(
    !formatterText.includes("githits search-status ") &&
      !formatterText.includes("githits read ") &&
      !formatterText.includes("githits code read ") &&
      !formatterText.includes("githits docs read ") &&
      !formatterText.includes(" --wait ") &&
      !formatterText.includes(" --offset "),
    `${context}: CLI command syntax leaked into MCP output`,
  );
  assert(
    hasHumanSearchHitLocator(lines) ||
      hasTargetRecovery(formatterLines) ||
      lines.some((line) => line.startsWith("Next:")),
    `${context}: missing usable result locator or status follow-up`,
  );
}

function hasTargetRecovery(lines: string[]): boolean {
  return lines.some((line, index) => {
    if (!/^ {2}(?:Fix|Try):\s+\S/.test(line)) return false;
    for (
      let previousIndex = index - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      const previous = lines[previousIndex];
      if (!previous || previous.trim() === "") continue;
      if (/^-\s+\S/.test(previous)) return true;
      if (previous.startsWith("  ")) continue;
      return false;
    }
    return false;
  });
}

function hasHumanSearchHitLocator(lines: string[]): boolean {
  return lines.some((line, index) => {
    const docsMatch = /^\[\d+\]\s+(\S+)\s+\[docs page\]\s+(.+)$/.exec(line);
    if (docsMatch) {
      const pageId = docsMatch[1];
      const docsDetails = docsMatch[2];
      if (!pageId || pageId === "page ID unavailable" || !docsDetails) {
        return false;
      }
      const firstDivider = docsDetails.indexOf(" - ");
      if (firstDivider <= 0) return false;
      const sourceAndTitle = docsDetails.slice(firstDivider + 3);
      const secondDivider = sourceAndTitle.indexOf(" - ");
      if (secondDivider > 0) {
        const source = sourceAndTitle.slice(0, secondDivider).trim();
        const title = sourceAndTitle.slice(secondDivider + 3).trim();
        return (
          source.length > 0 &&
          (title.length > 0 || hasWrappedHitTitle(lines, index))
        );
      }
      if (!sourceAndTitle.endsWith(" -")) return false;
      const source = sourceAndTitle.slice(0, -2).trim();
      return source.length > 0 && hasWrappedHitTitle(lines, index);
    }
    const match =
      /^\[\d+\]\s+(.+?)\s+\[(repo doc|repo code|repo symbol)(?:, path match)?\](?: -(?: (.*))?)?$/.exec(
        line,
      );
    if (!match) return false;
    const locatorText = match[1];
    if (!locatorText) return false;
    const locator = locatorText.trim().split(/\s+/);
    if (
      locator.length >= 2 &&
      !locatorText.trim().endsWith("location unavailable") &&
      locator.every((part) => part.length > 0)
    ) {
      const title = match[3];
      return title === undefined
        ? !line.endsWith(" -") || hasWrappedHitTitle(lines, index)
        : title.trim().length > 0 || hasWrappedHitTitle(lines, index);
    }
    return false;
  });
}

function hasWrappedHitTitle(lines: string[], index: number): boolean {
  const titleLine = lines[index + 1];
  return titleLine?.startsWith("  ") === true && titleLine.trim().length > 0;
}

function searchFormatterLines(lines: string[]): string[] {
  let inHit = false;
  return lines.filter((line) => {
    if (/^\[\d+\]\s/.test(line)) {
      inHit = true;
      return true;
    }
    if (inHit && line.length > 0 && !line.startsWith("  ")) inHit = false;
    return !inHit;
  });
}

export function assertJsonResult(
  result: McpSmokeToolResult,
  context: string,
): unknown {
  assert(result.isError !== true, `${context}: expected success`);
  return parseJson(resultText(result, context), context);
}

function assertErrorCode(
  result: McpSmokeToolResult,
  context: string,
  code: string,
): void {
  const envelope = assertCleanErrorEnvelope(result, context);
  assert(
    envelope.code === code,
    `${context}: expected ${code}, got ${envelope.code}`,
  );
}

function assertInlineSearchSuccess(
  value: unknown,
  expectedQuery: string,
  context: string,
): void {
  assertRecord(value, context);
  assertRecord(value.query, `${context}: query`);
  assert(value.query.raw === expectedQuery, `${context}: raw query mismatch`);
  assert(
    Array.isArray(value.results) && value.results.length > 0,
    `${context}: missing ranked results`,
  );
  for (const [index, result] of value.results.entries()) {
    assertRecord(result, `${context}: results[${index}]`);
    assertRecord(result.locator, `${context}: results[${index}].locator`);
    const filePath = result.locator.filePath;
    assert(
      typeof filePath === "string" &&
        filePath.startsWith("lib/") &&
        filePath.endsWith(".js"),
      `${context}: result escaped JavaScript lib/ scope`,
    );
  }

  if ("warnings" in value) {
    assert(
      Array.isArray(value.warnings),
      `${context}: warnings must be an array`,
    );
  }
  if (!("sourceStatus" in value)) return;

  assert(
    Array.isArray(value.sourceStatus),
    `${context}: sourceStatus must be an array`,
  );
  const unsupportedFeatures: string[] = [];
  for (const [index, entry] of value.sourceStatus.entries()) {
    assertRecord(entry, `${context}: sourceStatus[${index}] must be an object`);
    for (const field of ["ignoredQueryFeatures", "incompatibleQueryFeatures"]) {
      const features = entry[field];
      if (features === undefined) continue;
      assert(
        Array.isArray(features),
        `${context}: sourceStatus[${index}].${field} must be an array`,
      );
      for (const feature of features) {
        assert(
          typeof feature === "string",
          `${context}: sourceStatus[${index}].${field} must contain strings`,
        );
        unsupportedFeatures.push(feature);
      }
    }
  }

  if (unsupportedFeatures.length === 0) return;
  assert(
    Array.isArray(value.warnings),
    `${context}: unsupported qualifiers must be surfaced in warnings`,
  );
  const warningText = value.warnings.join(" ").toLowerCase();
  for (const feature of unsupportedFeatures) {
    assert(
      warningText.includes(feature.toLowerCase()),
      `${context}: qualifier ${feature} was lost without a warning`,
    );
  }
}

function assertInlineSearchError(
  result: McpSmokeToolResult,
  context: string,
): void {
  const envelope = assertCleanErrorEnvelope(result, context);
  assert(
    envelope.code === "INVALID_ARGUMENT",
    `${context}: expected INVALID_ARGUMENT, got ${envelope.code}`,
  );
  assert(
    envelope.retryable === false,
    `${context}: error must not be retryable`,
  );
  for (const field of ["searchRef", "search_ref", "continuation"]) {
    assert(!(field in envelope), `${context}: error exposed ${field}`);
  }
}

async function callTool(
  caller: McpSmokeCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<McpSmokeToolResult> {
  return await caller.callTool(name, args);
}

export async function callToolText(
  caller: McpSmokeCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await caller.callTool(name, args);
  const text = resultText(result, name);
  if (result.isError === true) {
    throw new Error(text);
  }
  return text;
}

async function assertLiveOrAuthRequired(
  caller: McpSmokeCaller,
  logger: Pick<Console, "log" | "error">,
): Promise<boolean> {
  const result = await callTool(caller, "pkg_info", {
    target: "npm:express",
  });
  if (result.isError === true) {
    const envelope = assertCleanErrorEnvelope(result, "pkg_info auth probe");
    assert(
      envelope.code === "AUTH_REQUIRED",
      `auth probe returned unexpected code ${envelope.code}`,
    );
    logger.log("AUTH_REQUIRED: live smoke skipped");
    return false;
  }
  return true;
}

async function runLiveSmoke(caller: McpSmokeCaller): Promise<void> {
  const exampleText = assertDefaultText(
    await callTool(caller, "get_example", {
      query: "express hello world",
      language: "javascript",
    }),
    "get_example default",
  );
  assert(
    exampleText.includes("solution_id:"),
    "get_example default missing solution_id hint",
  );

  const exampleJson = assertJsonResult(
    await callTool(caller, "get_example", {
      query: "express hello world",
      language: "javascript",
      format: "json",
    }),
    "get_example json",
  );
  assertRecord(exampleJson, "get_example json");
  assert(
    typeof exampleJson.result === "string",
    "get_example json missing result",
  );

  const pkgInfoText = assertDefaultText(
    await callTool(caller, "pkg_info", {
      target: "npm:express",
    }),
    "pkg_info default",
  );
  assert(
    pkgInfoText.includes("express"),
    "pkg_info default missing package name",
  );
  assert(
    pkgInfoText.includes("Repository") && pkgInfoText.includes("stars"),
    "pkg_info default missing repository popularity",
  );
  assert(
    pkgInfoText.includes("Vulnerabilities"),
    "pkg_info default missing vulnerability status",
  );
  assert(
    pkgInfoText.includes("Latest:"),
    "pkg_info default missing latest vulnerability scope",
  );
  assert(
    pkgInfoText.includes("History:"),
    "pkg_info default missing package-wide vulnerability history scope",
  );
  assert(
    !pkgInfoText.includes("Install") && !pkgInfoText.includes("Usage"),
    "pkg_info default should not include quickstart fields",
  );

  const pkgInfoJson = assertJsonResult(
    await callTool(caller, "pkg_info", {
      target: "npm:express",
      format: "json",
    }),
    "pkg_info json",
  );
  assertRecord(pkgInfoJson, "pkg_info json");
  assert(pkgInfoJson.registry === "npm", "pkg_info json registry mismatch");
  assert(pkgInfoJson.name === "express", "pkg_info json name mismatch");
  assert(
    typeof pkgInfoJson.version === "string",
    "pkg_info json missing version",
  );
  assert(
    typeof pkgInfoJson.versionCount === "number",
    "pkg_info json missing version count",
  );
  assertRecord(pkgInfoJson.downloads, "pkg_info json downloads");
  assert(
    typeof pkgInfoJson.downloads.refreshedAt === "string",
    "pkg_info json missing download refresh date",
  );
  assertRecord(pkgInfoJson.advisoryHistory, "pkg_info json advisory history");
  assert(
    typeof pkgInfoJson.advisoryHistory.total === "number",
    "pkg_info json missing advisory history count",
  );
  assert(
    !("install" in pkgInfoJson) && !("usage" in pkgInfoJson),
    "pkg_info json should not include quickstart fields",
  );

  const depsText = assertDefaultText(
    await callTool(caller, "pkg_deps", {
      target: "npm:express",
    }),
    "pkg_deps default",
  );
  assert(
    depsText.includes("Runtime dependencies:"),
    "pkg_deps default missing runtime heading",
  );
  assert(
    depsText.includes('pass lifecycle="all"'),
    "pkg_deps default missing MCP-native lifecycle hint",
  );

  const depsAllText = assertDefaultText(
    await callTool(caller, "pkg_deps", {
      target: "npm:express",
      lifecycle: "all",
    }),
    "pkg_deps lifecycle all",
  );
  assert(
    depsAllText.includes("Dependency groups:"),
    "pkg_deps lifecycle all missing groups heading",
  );
  assert(
    !depsAllText.includes("Hidden groups:"),
    "pkg_deps lifecycle all still hides groups",
  );

  const depsJson = assertJsonResult(
    await callTool(caller, "pkg_deps", {
      target: "npm:express",
      format: "json",
    }),
    "pkg_deps json",
  );
  assertRecord(depsJson, "pkg_deps json");
  assertRecord(depsJson.runtime, "pkg_deps json runtime");

  const depsIssuesText = assertDefaultText(
    await callTool(caller, "pkg_deps", {
      target: "npm:express",
      include_issues: true,
    }),
    "pkg_deps issues default",
  );
  assert(
    depsIssuesText.includes("Dependency issues"),
    "pkg_deps issues default missing issue heading",
  );

  const depsIssuesJson = assertJsonResult(
    await callTool(caller, "pkg_deps", {
      target: "npm:express",
      include_issues: true,
      format: "json",
    }),
    "pkg_deps issues json",
  );
  assertRecord(depsIssuesJson, "pkg_deps issues json");
  assert(
    !("transitive" in depsIssuesJson),
    "pkg_deps issues json should not expose ordinary transitive output",
  );
  assertRecord(depsIssuesJson.issues, "pkg_deps issues json issues");
  assertRecord(depsIssuesJson.issues.scope, "pkg_deps issues json scope");
  assert(
    depsIssuesJson.issues.scope.mode === "full",
    "pkg_deps issues json should report full scope",
  );
  for (const category of [
    "deprecated",
    "outdated",
    "duplicates",
    "conflicts",
  ]) {
    assertRecord(
      depsIssuesJson.issues[category],
      `pkg_deps issues json ${category}`,
    );
    assert(
      typeof depsIssuesJson.issues[category].count === "number",
      `pkg_deps issues json ${category} missing count`,
    );
    assert(
      Array.isArray(depsIssuesJson.issues[category].items),
      `pkg_deps issues json ${category} missing items`,
    );
  }

  const vulnsText = assertDefaultText(
    await callTool(caller, "pkg_vulns", {
      target: "npm:express",
    }),
    "pkg_vulns default",
  );
  assert(
    vulnsText.includes("express") || vulnsText.includes("vulnerab"),
    "pkg_vulns default missing context",
  );
  assert(!vulnsText.includes("use -v"), "pkg_vulns leaked CLI -v hint");

  const transitiveVulnsText = assertDefaultText(
    await callTool(caller, "pkg_vulns", {
      target: SMOKE_TRANSITIVE_VULNERABILITY_TARGET,
      include_transitive: true,
    }),
    "pkg_vulns transitive default",
  );
  assertTransitiveVulnerabilityText(
    transitiveVulnsText,
    "pkg_vulns transitive default",
  );

  const transitiveVulnsJson = assertJsonResult(
    await callTool(caller, "pkg_vulns", {
      target: SMOKE_TRANSITIVE_VULNERABILITY_TARGET,
      include_transitive: true,
      advisory_scope: "all",
      format: "json",
    }),
    "pkg_vulns transitive json",
  );
  assertTransitiveVulnerabilityJson(
    transitiveVulnsJson,
    "pkg_vulns transitive json",
  );
  assertRecord(transitiveVulnsJson, "pkg_vulns transitive json");
  assert(
    (transitiveVulnsJson.transitive as Record<string, unknown>)
      .advisoryScope === "all",
    "pkg_vulns transitive json did not apply all advisory scope",
  );

  const filteredVulnsText = assertDefaultText(
    await callTool(caller, "pkg_vulns", {
      target: "npm:lodash@4.17.20",
      min_severity: "high",
    }),
    "pkg_vulns filtered default",
  );
  assert(
    filteredVulnsText.includes("Filter  severity >= high"),
    "pkg_vulns filtered default missing filter echo",
  );
  assert(
    !filteredVulnsText.includes("use -v"),
    "pkg_vulns filtered default leaked CLI -v hint",
  );

  const vulnsJson = assertJsonResult(
    await callTool(caller, "pkg_vulns", {
      target: "npm:express",
      format: "json",
    }),
    "pkg_vulns json",
  );
  assertRecord(vulnsJson, "pkg_vulns json");
  assert(
    "summary" in vulnsJson || "advisories" in vulnsJson,
    "pkg_vulns json missing vulnerability data",
  );

  const filteredVulnsJson = assertJsonResult(
    await callTool(caller, "pkg_vulns", {
      target: "npm:lodash@4.17.20",
      min_severity: "high",
      format: "json",
    }),
    "pkg_vulns filtered json",
  );
  assertRecord(filteredVulnsJson, "pkg_vulns filtered json");
  assertRecord(filteredVulnsJson.filter, "pkg_vulns filtered json filter");
  assert(
    filteredVulnsJson.filter.minSeverity === "high",
    "pkg_vulns filtered json missing severity filter echo",
  );

  const scopedVulnsText = assertDefaultText(
    await callTool(caller, "pkg_vulns", {
      target: "npm:express",
      advisory_scope: "non_affecting",
    }),
    "pkg_vulns scoped default",
  );
  assert(
    scopedVulnsText.includes("Scope   historical advisories only"),
    "pkg_vulns scoped default missing scope echo",
  );
  assert(
    scopedVulnsText.includes("No active vulnerabilities affect this version"),
    "pkg_vulns scoped default missing current-risk statement",
  );
  assert(
    !scopedVulnsText.includes("use -v"),
    "pkg_vulns scoped default leaked CLI -v hint",
  );

  const scopedVulnsJson = assertJsonResult(
    await callTool(caller, "pkg_vulns", {
      target: "npm:express",
      advisory_scope: "non_affecting",
      format: "json",
    }),
    "pkg_vulns scoped json",
  );
  assertRecord(scopedVulnsJson, "pkg_vulns scoped json");
  assertRecord(scopedVulnsJson.filter, "pkg_vulns scoped json filter");
  assert(
    scopedVulnsJson.filter.advisoryScope === "non_affecting",
    "pkg_vulns scoped json missing advisory scope echo",
  );

  const changelogText = assertDefaultText(
    await callTool(caller, "pkg_changelog", {
      target: "npm:express",
      limit: 1,
    }),
    "pkg_changelog default",
  );
  assert(
    !changelogText.includes("--verbose"),
    "pkg_changelog default leaked CLI verbose flag",
  );
  if (
    changelogText.includes("truncated") ||
    changelogText.includes("full bodies")
  ) {
    assert(
      changelogText.includes(
        'pass verbose=true, body_lines=<n>, or format="json"',
      ),
      "pkg_changelog truncation hint is not MCP-native",
    );
  }

  const changelogBodyLinesText = assertDefaultText(
    await callTool(caller, "pkg_changelog", {
      target: "npm:express",
      limit: 2,
      body_lines: 3,
    }),
    "pkg_changelog body_lines",
  );
  assert(
    changelogBodyLinesText.includes(
      'pass verbose=true, body_lines=<n>, or format="json"',
    ),
    "pkg_changelog body_lines missing MCP-native truncation hint",
  );
  assert(
    !changelogBodyLinesText.includes("--verbose"),
    "pkg_changelog body_lines leaked CLI verbose flag",
  );

  const changelogJson = assertJsonResult(
    await callTool(caller, "pkg_changelog", {
      target: "npm:express",
      limit: 1,
      format: "json",
    }),
    "pkg_changelog json",
  );
  assertRecord(changelogJson, "pkg_changelog json");
  assertRecord(changelogJson.entries, "pkg_changelog json entries");

  const changelogExact = assertJsonResult(
    await callTool(caller, "pkg_changelog", {
      target: "npm:express@5.2.1",
      format: "json",
    }),
    "pkg_changelog exact json",
  );
  assertRecord(changelogExact, "pkg_changelog exact json");
  assert(changelogExact.mode === "exact", "pkg_changelog exact json mode");
  const exactEntries = changelogExact.entries as
    | { items?: Array<{ hasChangelog?: unknown; version?: unknown }> }
    | undefined;
  assert(
    exactEntries?.items?.[0]?.version === "5.2.1",
    "pkg_changelog exact json resolved version",
  );
  assert(
    typeof exactEntries?.items?.[0]?.hasChangelog === "boolean",
    "pkg_changelog exact json missing hasChangelog",
  );

  const changelogRepo = await callTool(caller, "pkg_changelog", {
    target: "github:expressjs/express",
    format: "json",
  });
  const changelogRepoEnvelope = assertCleanErrorEnvelope(
    changelogRepo,
    "pkg_changelog repository target",
  );
  assert(
    changelogRepoEnvelope.code === "INVALID_ARGUMENT",
    `pkg_changelog repository target: expected INVALID_ARGUMENT, got ${changelogRepoEnvelope.code}`,
  );

  const changelogTimeline = assertDefaultText(
    await callTool(caller, "pkg_changelog", {
      target: "npm:express",
      limit: 2,
      omit_bodies: true,
    }),
    "pkg_changelog timeline",
  );
  assert(
    !changelogTimeline.includes("What's Changed"),
    "pkg_changelog omit_bodies=true still emitted bodies",
  );

  const upgradeReviewText = assertDefaultText(
    await callTool(caller, "pkg_upgrade_review", {
      registry: "npm",
      package_name: "express",
      current_version: "5.0.0",
      target_version: "5.2.1",
      skip_transitive_security: true,
    }),
    "pkg_upgrade_review default",
  );
  const upgradeReviewFirstLine = upgradeReviewText.split("\n")[0]?.trim();
  assert(
    upgradeReviewFirstLine === "Upgrade review - 1 package",
    "pkg_upgrade_review default missing outcome headline",
  );
  assert(
    upgradeReviewText.includes("npm:express 5.0.0 -> 5.2.1") &&
      upgradeReviewText.includes("\nSecurity\n") &&
      upgradeReviewText.includes("\nChanges\n"),
    "pkg_upgrade_review default missing grouped evidence",
  );
  assert(
    !upgradeReviewText.includes("pkg_upgrade_review") &&
      !/\b(?:recommendation|risk level|assessment)\b/i.test(upgradeReviewText),
    "pkg_upgrade_review default leaked assessment language",
  );

  const upgradeReviewJson = assertJsonResult(
    await callTool(caller, "pkg_upgrade_review", {
      registry: "npm",
      package_name: "express",
      current_version: "5.0.0",
      target_version: "5.2.1",
      skip_transitive_security: true,
      format: "json",
    }),
    "pkg_upgrade_review json",
  );
  assertRecord(upgradeReviewJson, "pkg_upgrade_review json");
  assertRecord(upgradeReviewJson.summary, "pkg_upgrade_review json summary");
  assert(
    Array.isArray(upgradeReviewJson.reviews),
    "pkg_upgrade_review json missing reviews array",
  );
  const firstUpgradeReview = upgradeReviewJson.reviews[0] as
    | Record<string, unknown>
    | undefined;
  assert(firstUpgradeReview, "pkg_upgrade_review json missing first review");
  for (const forbidden of [
    "risk",
    "riskLevel",
    "recommendation",
    "findings",
    "verification",
  ]) {
    assert(
      !(forbidden in firstUpgradeReview),
      `pkg_upgrade_review json leaked judgment field ${forbidden}`,
    );
  }

  const packageListArgs = {
    target: SMOKE_PACKAGE_TARGET,
    paths: ["package.json"],
    limit: 1,
  };
  const packageListText = assertDefaultText(
    await callTool(caller, "list", packageListArgs),
    "list package default",
  );
  assert(
    packageListText.includes("package.json"),
    "list package default missing package.json",
  );

  const packageListJson = assertJsonResult(
    await callTool(caller, "list", { ...packageListArgs, format: "json" }),
    "list package json",
  );
  assertRecord(packageListJson, "list package json");
  assert(
    packageListJson.inventoryKind === "SOURCE" &&
      packageListJson.requestedTarget === SMOKE_PACKAGE_TARGET &&
      Array.isArray(packageListJson.entries),
    "list package json missing source inventory identity or entries",
  );
  const packageEntries = packageListJson.entries as unknown[];
  const packageEntry = packageEntries.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).path === "package.json",
  ) as Record<string, unknown> | undefined;
  assert(packageEntry, "list package json missing package.json entry");
  const packageRead = packageEntry.read;
  assertRecord(packageRead, "list package json read action");
  const packageReadTarget = packageRead.target;
  const packageReadPath = packageRead.path;
  assert(
    typeof packageReadTarget === "string" &&
      typeof packageReadPath === "string",
    "list package json entry missing read target or path",
  );
  assert(
    typeof packageListJson.hasMore === "boolean" &&
      packageListJson.hasMore ===
        (typeof packageListJson.nextCursor === "string" &&
          packageListJson.nextCursor.length > 0) &&
      (packageListJson.hasMore || packageListJson.nextCursor === null),
    "list package json hasMore/nextCursor mismatch",
  );
  const rootListArgs = { target: SMOKE_PACKAGE_TARGET, limit: 1 };
  const firstRootPage = assertDefaultText(
    await callTool(caller, "list", rootListArgs),
    "list package root first page text",
  );
  const firstRootPath = listTextFirstPath(
    firstRootPage,
    "list package root first page text",
  );
  const nextCursor = listTextContinuation(
    firstRootPage,
    "list package root first page text",
  );
  assert(
    firstRootPage.includes("| more results available") &&
      firstRootPath.length > 0 &&
      nextCursor.length > 0,
    "list package root first page must expose one path and a text continuation",
  );

  const secondRootPage = assertDefaultText(
    await callTool(caller, "list", {
      ...rootListArgs,
      after: nextCursor,
    }),
    "list package root continuation text",
  );
  const secondRootPath = listTextFirstPath(
    secondRootPage,
    "list package root continuation text",
  );
  assert(
    secondRootPath.length > 0 && secondRootPath !== firstRootPath,
    "list package root continuation repeated its first entry",
  );

  const packageReadText = assertDefaultText(
    await callTool(caller, "read", {
      target: packageReadTarget,
      path: packageReadPath,
      start_line: 1,
      end_line: 5,
    }),
    "read package list action default",
  );
  assert(
    /^1\s+/m.test(packageReadText),
    "read package list action default missing line numbers",
  );
  const packageReadJson = assertJsonResult(
    await callTool(caller, "read", {
      target: packageReadTarget,
      path: packageReadPath,
      start_line: 1,
      end_line: 5,
      format: "json",
    }),
    "read package list action json",
  );
  assertRecord(packageReadJson, "read package list action json");
  assert(
    packageReadJson.path === packageReadPath,
    "read package list action json path mismatch",
  );

  const siteListArgs = {
    target: "site:expressjs.com",
    paths: ["/en/resources/"],
    limit: 20,
  };
  const siteListText = assertDefaultText(
    await callTool(caller, "list", siteListArgs),
    "list site default",
  );
  assert(
    siteListText.includes(
      '# source site:expressjs.com | follow up with "read site:expressjs.com $path"',
    ) && siteListText.includes("en/resources/"),
    "list site default missing follow-up header or resources path",
  );
  const siteListJson = assertJsonResult(
    await callTool(caller, "list", { ...siteListArgs, format: "json" }),
    "list site json",
  );
  assertRecord(siteListJson, "list site json");
  assert(
    siteListJson.inventoryKind === "SITE" &&
      siteListJson.requestedTarget === siteListArgs.target &&
      Array.isArray(siteListJson.entries),
    "list site json missing site inventory identity or entries",
  );
  const siteEntries = siteListJson.entries as unknown[];
  const sitePage = siteEntries.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).kind === "PAGE",
  ) as Record<string, unknown> | undefined;
  assert(sitePage, "list site json missing PAGE entry");
  const siteRead = sitePage.read;
  assertRecord(siteRead, "list site json PAGE read action");
  const siteReadTarget = siteRead.target;
  const siteReadPath = siteRead.path;
  assert(
    typeof siteReadTarget === "string" && typeof siteReadPath === "string",
    "list site json PAGE missing read target or path",
  );
  for (const [format, label] of [
    [undefined, "default"],
    ["json", "json"],
  ] as const) {
    const result = await callTool(caller, "read", {
      target: siteReadTarget,
      path: siteReadPath,
      start_line: 1,
      end_line: 5,
      ...(format ? { format } : {}),
    });
    if (format) {
      const value = assertJsonResult(result, `read site list action ${label}`);
      assertRecord(value, `read site list action ${label}`);
      assert(
        typeof value.content === "string" &&
          value.startLine === 1 &&
          typeof value.endLine === "number" &&
          value.endLine >= 1 &&
          value.endLine <= 5 &&
          typeof value.totalLines === "number" &&
          value.totalLines >= value.endLine,
        `read site list action ${label} missing content or backend range`,
      );
    } else {
      const text = assertDefaultText(result, `read site list action ${label}`);
      assert(text.length > 0, `read site list action ${label} missing content`);
    }
  }

  const directUrlReadText = assertDefaultText(
    await callTool(caller, "read", {
      target: "https://expressjs.com/en/resources/",
      start_line: 1,
      end_line: 5,
    }),
    "read exact site URL default",
  );
  assert(
    directUrlReadText.length > 0,
    "read exact site URL default missing content",
  );
  const directUrlReadJson = assertJsonResult(
    await callTool(caller, "read", {
      target: "https://expressjs.com/en/resources/",
      start_line: 1,
      end_line: 5,
      format: "json",
    }),
    "read exact site URL json",
  );
  assertRecord(directUrlReadJson, "read exact site URL json");
  assert(
    typeof directUrlReadJson.content === "string" &&
      directUrlReadJson.startLine === 1 &&
      typeof directUrlReadJson.endLine === "number" &&
      directUrlReadJson.endLine >= 1 &&
      directUrlReadJson.endLine <= 5 &&
      typeof directUrlReadJson.totalLines === "number" &&
      directUrlReadJson.totalLines >= directUrlReadJson.endLine,
    "read exact site URL json missing content or backend range",
  );

  assertErrorCode(
    await callTool(caller, "read", {
      target: "https://docs.example.invalid/githits-smoke-unknown",
      format: "json",
    }),
    "read unknown URL",
    "NOT_FOUND",
  );

  const grepArgs = {
    targets: [{ target: SMOKE_PACKAGE_TARGET }],
    pattern: "router",
    max_matches: 2,
    wait_timeout_ms: 60_000,
  };
  const grepText = assertDefaultText(
    await callTool(caller, "grep", grepArgs),
    "grep default",
  );
  const grepJson = assertGrepResult(
    assertJsonResult(
      await callTool(caller, "grep", { ...grepArgs, format: "json" }),
      "grep json",
    ),
    "grep json",
  );
  assert(
    grepJson.traversal === "RESUMABLE_LIMIT" &&
      typeof grepJson.nextCursor === "string",
    "grep first page must expose resumable coverage and a cursor",
  );
  const grepHits = grepJson.hits as Array<Record<string, unknown>>;
  const repositoryHit = grepHits.find(
    (hit) => hit.__typename === "GrepRepositoryHit",
  );
  const hostedDocsHit = grepHits.find(
    (hit) => hit.__typename === "GrepSiteHit",
  );
  assert(repositoryHit, "grep json missing repository source evidence");
  assert(hostedDocsHit, "grep json missing hosted documentation evidence");
  const grepScopes = grepJson.targets as Array<Record<string, unknown>>;
  for (const kind of ["REPOSITORY", "SITE"]) {
    const scope = grepScopes.find((target) => target.kind === kind);
    assert(scope, `grep json missing ${kind.toLowerCase()} scope status`);
    assert(
      (scope.requestedInputIndices as unknown[]).includes(0) &&
        typeof scope.readiness === "string" &&
        typeof scope.traversal === "string",
      `grep json ${kind.toLowerCase()} scope is missing input or readiness status`,
    );
  }
  assert(
    grepText.includes("Sources:") &&
      grepText.includes("# Read files: read target=$target path=$path") &&
      grepText.includes("# Read pages: read target=$url") &&
      grepText.includes("More matches") &&
      grepText.includes(`cursor=${JSON.stringify(grepJson.nextCursor)}`),
    "grep default missing mixed-source, exact-read, or continuation guidance",
  );

  const grepCursor = grepJson.nextCursor as string;
  const grepSecondPage = assertGrepResult(
    assertJsonResult(
      await callTool(caller, "grep", {
        ...grepArgs,
        cursor: grepCursor,
        format: "json",
      }),
      "grep continuation json",
    ),
    "grep continuation json",
  );
  assert(
    (grepSecondPage.hits as unknown[]).length > 0 &&
      (grepSecondPage.targets as unknown[]).length > 0,
    "grep continuation must return page evidence and target readiness",
  );
  assert(
    (grepSecondPage.targets as Array<Record<string, unknown>>).every(
      (target) =>
        (target.requestedInputIndices as number[]).includes(0) &&
        typeof target.readiness === "string",
    ),
    "grep continuation lost input attribution or target readiness",
  );

  const repositoryReadArgs = grepReadArgs(repositoryHit, "json");
  const repositoryReadJson = assertJsonResult(
    await callTool(caller, "read", repositoryReadArgs),
    "read grep repository action json",
  );
  assertRecord(repositoryReadJson, "read grep repository action json");
  const repositoryAction = repositoryHit.read as Record<string, unknown>;
  assert(
    repositoryReadJson.path === repositoryAction.path &&
      repositoryReadJson.startLine === repositoryAction.startLine &&
      repositoryReadJson.endLine === repositoryAction.endLine,
    "read grep repository action changed its path or line range",
  );
  const repositoryReadText = assertDefaultText(
    await callTool(caller, "read", grepReadArgs(repositoryHit)),
    "read grep repository action text",
  );
  assert(
    repositoryReadText.includes(`${repositoryAction.startLine} `),
    "read grep repository action text omitted the returned line",
  );

  const hostedReadArgs = grepReadArgs(hostedDocsHit, "json");
  const hostedReadJson = assertJsonResult(
    await callTool(caller, "read", hostedReadArgs),
    "read grep hosted documentation action json",
  );
  assertRecord(hostedReadJson, "read grep hosted documentation action json");
  const hostedAction = hostedDocsHit.read as Record<string, unknown>;
  assert(
    hostedReadJson.docsReadTarget === hostedAction.target &&
      hostedReadJson.startLine === hostedAction.startLine &&
      hostedReadJson.endLine === hostedAction.endLine,
    "read grep hosted documentation action changed its page or line range",
  );
  const hostedReadText = assertDefaultText(
    await callTool(caller, "read", grepReadArgs(hostedDocsHit)),
    "read grep hosted documentation action text",
  );
  assert(
    typeof hostedReadJson.content === "string" &&
      hostedReadJson.content.length > 0 &&
      hostedReadText.includes(hostedReadJson.content),
    "read grep hosted documentation action text omitted the returned content",
  );

  const inlineSearchJson = assertJsonResult(
    await callTool(caller, "search", {
      target: SMOKE_PACKAGE_TARGET,
      query: INLINE_SEARCH_QUERY,
      source: "code",
      limit: 1,
      format: "json",
    }),
    "search inline qualifiers",
  );
  assertInlineSearchSuccess(
    inlineSearchJson,
    INLINE_SEARCH_QUERY,
    "search inline qualifiers",
  );

  for (const [qualifier, source] of [
    ["kind:bogus", "symbol"],
    ["category:bogus", "symbol"],
    ["intent:bogus", "code"],
  ] as const) {
    assertInlineSearchError(
      await callTool(caller, "search", {
        target: SMOKE_PACKAGE_TARGET,
        query: `router ${qualifier}`,
        source,
        format: "json",
      }),
      `search invalid inline qualifier ${qualifier}`,
    );
  }

  const searchText = assertDefaultText(
    await callTool(caller, "search", {
      target: SMOKE_PACKAGE_TARGET,
      query: "router",
      limit: 1,
    }),
    "search default",
  );
  assertSearchDefaultText(searchText, "search default");

  const searchJson = assertJsonResult(
    await callTool(caller, "search", {
      target: SMOKE_PACKAGE_TARGET,
      query: "router",
      limit: 1,
      format: "json",
    }),
    "search json",
  );
  assertRecord(searchJson, "search json");

  let docsSearchJson = assertJsonResult(
    await callTool(caller, "search", {
      target: "site:expressjs.com",
      query: "routing",
      source: "docs",
      limit: 10,
      wait_timeout_ms: 60_000,
      format: "json",
    }),
    "documentation search json",
  );
  assertRecord(docsSearchJson, "documentation search json");
  if (
    docsSearchJson.completed !== true &&
    typeof docsSearchJson.searchRef === "string"
  ) {
    docsSearchJson = assertJsonResult(
      await callTool(caller, "search_status", {
        search_ref: docsSearchJson.searchRef,
        wait_timeout_ms: 60_000,
        format: "json",
      }),
      "documentation search status json",
    );
    assertRecord(docsSearchJson, "documentation search status json");
  }
  const docsSearchEvidence =
    typeof docsSearchJson.result === "object" && docsSearchJson.result !== null
      ? docsSearchJson.result
      : docsSearchJson;
  assertRecord(docsSearchEvidence, "documentation search evidence");
  assert(
    Array.isArray(docsSearchEvidence.results),
    "documentation search json missing results",
  );
  const hostedDocumentationHits = docsSearchEvidence.results.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const hit = entry as Record<string, unknown>;
    if (hit.type !== "documentation_page") return false;
    const locator = hit.locator;
    return (
      typeof locator === "object" &&
      locator !== null &&
      typeof (locator as Record<string, unknown>).docsReadTarget === "string" &&
      /^https?:\/\//i.test(
        (locator as Record<string, unknown>).docsReadTarget as string,
      )
    );
  }) as Array<Record<string, unknown>>;
  assert(
    hostedDocumentationHits.length > 0,
    "documentation search json missing hosted documentation_page evidence",
  );
  for (const hit of hostedDocumentationHits) {
    assert(
      typeof hit.followUp === "string" &&
        !/\b(?:start_line|end_line)=/.test(hit.followUp),
      "hosted documentation follow-up replayed search line bounds",
    );
  }

  const searchRef =
    typeof searchJson.searchRef === "string" ? searchJson.searchRef : undefined;
  if (searchRef) {
    const statusJson = assertJsonResult(
      await callTool(caller, "search_status", {
        search_ref: searchRef,
        wait_timeout_ms: 0,
        format: "json",
      }),
      "search_status json",
    );
    assertRecord(statusJson, "search_status json");
    assert(
      "completed" in statusJson || "progress" in statusJson,
      "search_status json missing status data",
    );
  } else {
    assertErrorCode(
      await callTool(caller, "search_status", {
        search_ref: "smoke-invalid-search-ref",
        wait_timeout_ms: 0,
      }),
      "search_status invalid ref",
      "NOT_FOUND",
    );
  }
}

export async function runMcpSmoke(
  caller: McpSmokeCaller,
  options: McpSmokeOptions = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const includeLiveTools = options.includeLiveTools ?? true;
  const toolsResponse = await caller.listTools();
  const toolNames = new Set(toolsResponse.tools.map((tool) => tool.name));
  assert(
    !toolNames.has("feedback"),
    "listTools advertises removed feedback tool",
  );
  assert(
    !toolNames.has("code_grep"),
    "listTools advertises retired code_grep instead of grep",
  );
  for (const expected of EXPECTED_MCP_TOOLS) {
    assert(toolNames.has(expected), `listTools missing ${expected}`);
  }
  for (const tool of toolsResponse.tools) {
    assert(
      tool.annotations?.readOnlyHint === true,
      `${tool.name} must advertise readOnlyHint: true`,
    );
    const expectedOpenWorldHint = tool.name !== "quick_start";
    assert(
      tool.annotations?.openWorldHint === expectedOpenWorldHint,
      `${tool.name} must advertise openWorldHint: ${expectedOpenWorldHint}, got ${String(tool.annotations?.openWorldHint)}`,
    );
    assert(
      tool.annotations?.destructiveHint === false,
      `${tool.name} must advertise destructiveHint: false`,
    );
  }

  const quickStart = assertDefaultText(
    await callTool(caller, "quick_start", {}),
    "quick_start default",
  );
  for (const expected of [
    "GitHits routing guide",
    "`search`",
    "`list`",
    "`grep`",
    "`read`",
  ]) {
    assert(
      quickStart.includes(expected),
      `quick_start default missing ${expected}`,
    );
  }
  assert(
    !quickStart.includes("code_grep"),
    "quick_start still routes matching to retired code_grep",
  );

  if (!includeLiveTools) return;
  if (await assertLiveOrAuthRequired(caller, logger)) {
    await runLiveSmoke(caller);
    logger.log("MCP smoke passed");
  }
}
