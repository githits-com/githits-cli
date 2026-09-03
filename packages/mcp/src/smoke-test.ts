export interface McpSmokeToolResult {
  content?: unknown;
  isError?: boolean;
}

export interface McpSmokeCaller {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
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
  "search_language",
  "pkg_info",
  "pkg_deps",
  "pkg_vulns",
  "pkg_changelog",
  "pkg_upgrade_review",
  "docs_list",
  "docs_read",
  "code_files",
  "code_read",
  "code_grep",
  "search",
  "search_status",
  "feedback",
] as const;

const DEFAULT_TEXT_LIMIT = 12_000;
const TARGET_DETAIL_STATE_PATTERN =
  /^ {2}(?:(?:indexing|searched|available|unavailable|using):|(?:ready|pending|provisional|older snapshot)$|(?:not found|unresolved|version unavailable|repository ref unresolved|(?:package|repository|site|target) (?:not found|unresolved)):)/;
const SMOKE_PACKAGE_VERSION = "5.2.1";
const SMOKE_PACKAGE_TARGET = {
  registry: "npm",
  package_name: "express",
  version: SMOKE_PACKAGE_VERSION,
} as const;

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

function assertSearchDefaultText(text: string, context: string): void {
  const lines = text.split("\n");
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
      /^\[\d+\]\s+(.+?)\s+\[(repo doc|repo code|repo symbol)\](?: -(?: (.*))?)?$/.exec(
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
  const result = await callTool(caller, "search_language", { query: "python" });
  if (result.isError === true) {
    const envelope = assertCleanErrorEnvelope(
      result,
      "search_language auth probe",
    );
    assert(
      envelope.code === "AUTH_REQUIRED",
      `auth probe returned unexpected code ${envelope.code}`,
    );
    logger.log("AUTH_REQUIRED: live smoke skipped");
    return false;
  }

  const text = assertDefaultText(result, "search_language default");
  assert(
    text.includes("python (Python)"),
    "search_language default missing Python display name",
  );
  assert(text.includes("aliases:"), "search_language default missing aliases");
  const packageResult = await callTool(caller, "pkg_info", {
    registry: "npm",
    package_name: "express",
  });
  if (packageResult.isError === true) {
    const envelope = assertCleanErrorEnvelope(
      packageResult,
      "pkg_info auth probe",
    );
    assert(
      envelope.code === "AUTH_REQUIRED",
      `pkg_info auth probe returned unexpected code ${envelope.code}`,
    );
    logger.log("AUTH_REQUIRED: live smoke skipped");
    return false;
  }
  return true;
}

async function runLiveSmoke(caller: McpSmokeCaller): Promise<void> {
  const languageJson = assertJsonResult(
    await callTool(caller, "search_language", {
      query: "python",
      format: "json",
    }),
    "search_language json",
  );
  assert(Array.isArray(languageJson), "search_language json: expected array");

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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
      format: "json",
    }),
    "pkg_deps json",
  );
  assertRecord(depsJson, "pkg_deps json");
  assertRecord(depsJson.runtime, "pkg_deps json runtime");

  const depsIssuesText = assertDefaultText(
    await callTool(caller, "pkg_deps", {
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
    }),
    "pkg_vulns default",
  );
  assert(
    vulnsText.includes("express") || vulnsText.includes("vulnerab"),
    "pkg_vulns default missing context",
  );
  assert(!vulnsText.includes("use -v"), "pkg_vulns leaked CLI -v hint");

  const filteredVulnsText = assertDefaultText(
    await callTool(caller, "pkg_vulns", {
      registry: "npm",
      package_name: "lodash",
      version: "4.17.20",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "lodash",
      version: "4.17.20",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
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
      registry: "npm",
      package_name: "express",
      limit: 1,
      format: "json",
    }),
    "pkg_changelog json",
  );
  assertRecord(changelogJson, "pkg_changelog json");
  assertRecord(changelogJson.entries, "pkg_changelog json entries");

  const changelogTimeline = assertDefaultText(
    await callTool(caller, "pkg_changelog", {
      registry: "npm",
      package_name: "express",
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

  const docsText = assertDefaultText(
    await callTool(caller, "docs_list", {
      ...SMOKE_PACKAGE_TARGET,
      limit: 2,
    }),
    "docs_list default",
  );
  assert(
    docsText.includes("docs_read page_id="),
    "docs_list default missing docs_read follow-up",
  );

  const docsJson = assertJsonResult(
    await callTool(caller, "docs_list", {
      ...SMOKE_PACKAGE_TARGET,
      limit: 2,
      format: "json",
    }),
    "docs_list json",
  );
  assertRecord(docsJson, "docs_list json");
  assert(Array.isArray(docsJson.pages), "docs_list json missing pages array");
  const firstPage = docsJson.pages[0] as Record<string, unknown> | undefined;
  assert(
    firstPage && typeof firstPage.pageId === "string",
    "docs_list json missing readable page id",
  );

  const docReadText = assertDefaultText(
    await callTool(caller, "docs_read", {
      page_id: firstPage.pageId,
      start_line: 1,
      end_line: 5,
    }),
    "docs_read default",
  );
  assert(docReadText.length > 0, "docs_read default missing content");

  const docReadJson = assertJsonResult(
    await callTool(caller, "docs_read", {
      page_id: firstPage.pageId,
      start_line: 1,
      end_line: 5,
      format: "json",
    }),
    "docs_read json",
  );
  assertRecord(docReadJson, "docs_read json");
  assert(
    typeof docReadJson.content === "string",
    "docs_read json missing content",
  );

  const codeFilesText = assertDefaultText(
    await callTool(caller, "code_files", {
      target: SMOKE_PACKAGE_TARGET,
      path_prefix: "package.json",
      limit: 1,
    }),
    "code_files default",
  );
  assert(
    codeFilesText.includes("package.json"),
    "code_files default missing package.json",
  );

  const codeFilesJson = assertJsonResult(
    await callTool(caller, "code_files", {
      target: SMOKE_PACKAGE_TARGET,
      path_prefix: "package.json",
      limit: 1,
      format: "json",
    }),
    "code_files json",
  );
  assertRecord(codeFilesJson, "code_files json");
  assert(
    Array.isArray(codeFilesJson.files),
    "code_files json missing files array",
  );

  const codeReadText = assertDefaultText(
    await callTool(caller, "code_read", {
      target: SMOKE_PACKAGE_TARGET,
      path: "package.json",
      start_line: 1,
      end_line: 5,
    }),
    "code_read default",
  );
  assert(/^1\s+/m.test(codeReadText), "code_read default missing line numbers");

  const codeReadJson = assertJsonResult(
    await callTool(caller, "code_read", {
      target: SMOKE_PACKAGE_TARGET,
      path: "package.json",
      start_line: 1,
      end_line: 5,
      format: "json",
    }),
    "code_read json",
  );
  assertRecord(codeReadJson, "code_read json");
  assert(codeReadJson.path === "package.json", "code_read json path mismatch");

  const codeGrepText = assertDefaultText(
    await callTool(caller, "code_grep", {
      target: SMOKE_PACKAGE_TARGET,
      pattern: "express",
      path: "package.json",
      max_matches: 1,
    }),
    "code_grep default",
  );
  assert(
    codeGrepText.includes("package.json"),
    "code_grep default missing package.json",
  );

  const codeGrepJson = assertJsonResult(
    await callTool(caller, "code_grep", {
      target: SMOKE_PACKAGE_TARGET,
      pattern: "express",
      path: "package.json",
      max_matches: 1,
      format: "json",
    }),
    "code_grep json",
  );
  assertRecord(codeGrepJson, "code_grep json");
  assert(
    "matches" in codeGrepJson || "totalMatches" in codeGrepJson,
    "code_grep json missing matches",
  );

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

  const feedbackValidation = await callTool(caller, "feedback", {
    solution_id: "",
    accepted: true,
  });
  assert(
    feedbackValidation.isError === true,
    "feedback validation should fail before submitting",
  );
  assert(
    resultText(feedbackValidation, "feedback validation").includes("MCP error"),
    "feedback validation missing protocol error text",
  );
}

export async function runMcpSmoke(
  caller: McpSmokeCaller,
  options: McpSmokeOptions = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const includeLiveTools = options.includeLiveTools ?? true;
  const toolsResponse = await caller.listTools();
  const toolNames = new Set(toolsResponse.tools.map((tool) => tool.name));
  for (const expected of EXPECTED_MCP_TOOLS) {
    assert(toolNames.has(expected), `listTools missing ${expected}`);
  }

  const quickStart = assertDefaultText(
    await callTool(caller, "quick_start", {}),
    "quick_start default",
  );
  for (const expected of ["GitHits provides", "`search`", "`code_grep`"]) {
    assert(
      quickStart.includes(expected),
      `quick_start default missing ${expected}`,
    );
  }

  if (!includeLiveTools) return;
  if (await assertLiveOrAuthRequired(caller, logger)) {
    await runLiveSmoke(caller);
    logger.log("MCP smoke passed");
  }
}
