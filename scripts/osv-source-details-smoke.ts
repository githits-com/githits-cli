/** Focused authenticated dev validation of full source evidence on both transports. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type {
  OsvSourceDetails,
  VulnerabilitySourceEntry,
} from "@githits/core-internal";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LeanVulnerabilityReport } from "../packages/mcp/src/shared/package-vulnerabilities-response.js";
import type { VulnsResponse } from "../src/commands/vulns-response.js";

if (process.env.GITHITS_ENV !== "dev")
  throw new Error("Run with GITHITS_ENV=dev.");
for (const name of [
  "GITHITS_MCP_URL",
  "GITHITS_API_URL",
  "GITHITS_CODE_NAV_URL",
  "GITHITS_ACCOUNTS_URL",
]) {
  if (process.env[name])
    throw new Error(`Unset ${name} for canonical dev verification.`);
}
const target = "npm:minimatch@10.2.1";
const cliEntry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

async function cli(args: string[]): Promise<string> {
  const child = Bun.spawn(["bun", cliEntry, ...args], {
    env: { ...process.env, GITHITS_DISABLE_SKILL_UPDATE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, `CLI command failed: ${stderr}`);
  return stdout;
}
interface SourceReport extends LeanVulnerabilityReport {
  sourceDetails: Array<VulnerabilitySourceEntry & { source: OsvSourceDetails }>;
}
function check(
  report: LeanVulnerabilityReport,
): asserts report is SourceReport {
  assert(
    report.sourceDetails && report.sourceDetails.length > 3,
    "Need multiple source pages",
  );
  for (const entry of report.sourceDetails) {
    assert(entry.source && !entry.error, "Source must be available");
    assert.equal(entry.advisoryId, entry.source.osvId);
    assert(entry.source.schemaVersion);
    assert(Array.isArray(entry.source.credits));
    assert(Array.isArray(entry.source.relatedIds));
    assert(Array.isArray(entry.source.upstreamIds));
    assert(entry.source.modifiedAt);
  }
}
const base: LeanVulnerabilityReport = JSON.parse(
  await cli(["pkg", "vulns", target, "--scope", "all", "--json"]),
);
assert.equal(base.sourceDetails, undefined);
const full: LeanVulnerabilityReport = JSON.parse(
  await cli(["pkg", "vulns", target, "--scope", "all", "--details", "--json"]),
);
check(full);
const { sourceDetails: _, ...assessment } = full;
assert.deepEqual(
  assessment,
  base,
  "Current source must not change imported assessment",
);
const text = await cli(["pkg", "vulns", target, "--scope", "all", "--details"]);
for (const entry of full.sourceDetails) {
  const source = entry.source;
  const direct: VulnsResponse = JSON.parse(
    await cli(["vulns", source.osvId, "--verbose", "--json"]),
  );
  const result = direct.results[0];
  assert(result?.advisory);
  assert.equal(result.status, "success");
  assert.equal(result.advisory.explanation, source.details);
  assert.equal(result.advisory.schemaVersion, source.schemaVersion);
  assert.equal(result.advisory.modifiedAt, source.modifiedAt);
  if (source.details) {
    const normalizedLines = source.details
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/\t/g, "    "));
    for (const line of normalizedLines)
      if (line)
        assert(text.includes(line), `Missing body line for ${source.osvId}`);
  }
}
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (pair): pair is [string, string] => pair[1] !== undefined,
  ),
);
env.GITHITS_DISABLE_SKILL_UPDATE = "1";
const transport = new StdioClientTransport({
  command: "bun",
  args: [cliEntry, "mcp", "start"],
  env,
  stderr: "pipe",
});
const client = new Client({
  name: "osv-source-details-smoke",
  version: "1.0.0",
});
try {
  await client.connect(transport);
  const response = await client.callTool({
    name: "pkg_vulns",
    arguments: {
      target,
      advisory_scope: "all",
      details: true,
      format: "json",
    },
  });
  assert(!response.isError);
  const content = response.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  assert(first?.type === "text" && typeof first.text === "string");
  const mcp: LeanVulnerabilityReport = JSON.parse(first.text);
  check(mcp);
  assert.deepEqual(mcp, full);
  const responseText = await client.callTool({
    name: "pkg_vulns",
    arguments: { target, advisory_scope: "all", details: true },
  });
  assert(!responseText.isError);
  const textBlock = (
    responseText.content as Array<{ type: string; text?: string }>
  )[0];
  assert(textBlock?.type === "text" && typeof textBlock.text === "string");
  const mcpText = textBlock.text;
  for (const entry of full.sourceDetails) {
    assert(mcpText.includes(entry.source.osvId));
    if (entry.source.details)
      for (const line of entry.source.details.split(/\r\n|\r|\n/))
        if (line) assert(mcpText.includes(line.replace(/\t/g, "    ")));
  }
  const compactResponse = await client.callTool({
    name: "pkg_vulns",
    arguments: { target, advisory_scope: "all" },
  });
  assert(!compactResponse.isError);
  const compactBlock = (
    compactResponse.content as Array<{ type: string; text?: string }>
  )[0];
  assert(
    compactBlock?.type === "text" && typeof compactBlock.text === "string",
  );
  const footer = compactBlock.text.split("Full advisory report:")[1];
  assert(footer);
  assert(footer.includes("details=true"));
  assert(!footer.includes("githits vulns"));
} finally {
  await client.close();
}
console.log(
  JSON.stringify({
    status: "passed",
    target,
    affected: full.summary.total,
    sources: full.sourceDetails.length,
    markdownLengths: full.sourceDetails.map(
      (entry) => entry.source.details?.length ?? 0,
    ),
    cliMcpParity: true,
    directBodiesMatch: true,
  }),
);
