import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface PackageFixture {
  registry: Registry;
  name: string;
}

interface CommandResult {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface AuditResult {
  registry: Registry;
  packageName: string;
  tool: ToolName;
  expectedUnsupported: boolean;
  ok: boolean;
  code?: string;
  error?: string;
  durationMs: number;
}

interface RegistrySummary {
  ok: number;
  failures: number;
  expectedUnsupported: number;
}

interface AuditSummary {
  packages: number;
  checks: number;
  ok: number;
  expectedUnsupported: number;
  failures: number;
  byRegistry: Record<string, RegistrySummary>;
  failedChecks: Array<{
    package: string;
    tool: ToolName;
    code?: string;
    error?: string;
  }>;
}

type Registry =
  | "npm"
  | "pypi"
  | "hex"
  | "crates"
  | "nuget"
  | "maven"
  | "zig"
  | "vcpkg"
  | "packagist"
  | "rubygems"
  | "go";

type ToolName = "pkg_info" | "pkg_changelog" | "pkg_vulns";

const VULN_SUPPORTED_REGISTRIES = new Set<Registry>([
  "npm",
  "pypi",
  "hex",
  "crates",
  "nuget",
  "maven",
  "packagist",
  "rubygems",
  "go",
]);

const DEFAULT_FIXTURES: PackageFixture[] = [
  { registry: "npm", name: "express" },
  { registry: "npm", name: "lodash" },
  { registry: "npm", name: "react" },
  { registry: "pypi", name: "requests" },
  { registry: "pypi", name: "django" },
  { registry: "pypi", name: "numpy" },
  { registry: "hex", name: "ecto" },
  { registry: "hex", name: "jason" },
  { registry: "hex", name: "phoenix" },
  { registry: "crates", name: "serde" },
  { registry: "crates", name: "tokio" },
  { registry: "crates", name: "reqwest" },
  { registry: "nuget", name: "Newtonsoft.Json" },
  { registry: "nuget", name: "Serilog" },
  { registry: "nuget", name: "Dapper" },
  { registry: "maven", name: "org.apache.commons:commons-lang3" },
  { registry: "maven", name: "com.google.guava:guava" },
  { registry: "maven", name: "junit:junit" },
  { registry: "zig", name: "hexops/mach" },
  { registry: "zig", name: "hejsil/zig-clap" },
  { registry: "zig", name: "zigzap/zap" },
  { registry: "vcpkg", name: "fmt" },
  { registry: "vcpkg", name: "zlib" },
  { registry: "vcpkg", name: "openssl" },
  { registry: "packagist", name: "monolog/monolog" },
  { registry: "packagist", name: "laravel/framework" },
  { registry: "packagist", name: "symfony/console" },
  { registry: "rubygems", name: "rails" },
  { registry: "rubygems", name: "rack" },
  { registry: "rubygems", name: "rspec" },
  { registry: "go", name: "github.com/gin-gonic/gin" },
  { registry: "go", name: "github.com/spf13/cobra" },
  { registry: "go", name: "golang.org/x/text" },
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const fixtures = applyLimitPerRegistry(
  DEFAULT_FIXTURES.filter((fixture) =>
    args.registries.size > 0 ? args.registries.has(fixture.registry) : true,
  ),
  args.limitPackagesPerRegistry,
).slice(0, args.limitPackages ?? undefined);

if (fixtures.length === 0) {
  throw new Error("No package fixtures selected.");
}

const results: AuditResult[] = [];

for (const fixture of fixtures) {
  for (const tool of args.tools) {
    const result = await runAudit(fixture, tool);
    results.push(result);
    const status = result.ok
      ? result.expectedUnsupported
        ? "expected-unsupported"
        : "ok"
      : "fail";
    console.log(
      `${status}\t${result.registry}:${result.packageName}\t${result.tool}\t${result.code ?? ""}`,
    );
  }
}

const summary = summarize(results);
console.log(JSON.stringify(summary, null, 2));

if (args.out) {
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${results.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

if (summary.failures > 0) {
  process.exitCode = 1;
}

async function runAudit(
  fixture: PackageFixture,
  tool: ToolName,
): Promise<AuditResult> {
  const expectedUnsupported =
    tool === "pkg_vulns" && !VULN_SUPPORTED_REGISTRIES.has(fixture.registry);
  const command = buildCommand(fixture, tool);
  const result = await run(command);
  const payload = parsePayload(result.stdout || result.stderr);
  const code = typeof payload?.code === "string" ? payload.code : undefined;
  const error = typeof payload?.error === "string" ? payload.error : undefined;
  const ok = expectedUnsupported
    ? result.exitCode !== 0 && code === "INVALID_ARGUMENT"
    : result.exitCode === 0 && payload !== undefined && error === undefined;

  return {
    registry: fixture.registry,
    packageName: fixture.name,
    tool,
    expectedUnsupported,
    ok,
    code,
    error,
    durationMs: result.durationMs,
  };
}

function buildCommand(fixture: PackageFixture, tool: ToolName): string[] {
  const spec = `${fixture.registry}:${fixture.name}`;
  switch (tool) {
    case "pkg_info":
      return ["bun", "run", "dev", "pkg", "info", spec, "--json"];
    case "pkg_changelog":
      return [
        "bun",
        "run",
        "dev",
        "pkg",
        "changelog",
        spec,
        "--limit",
        "1",
        "--json",
      ];
    case "pkg_vulns":
      return ["bun", "run", "dev", "pkg", "vulns", spec, "--json"];
  }
}

function run(command: string[]): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise((resolveCommand) => {
    const child = spawn(command[0] ?? "", command.slice(1), {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      resolveCommand({
        command,
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function parsePayload(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    const line = trimmed
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("{") && entry.endsWith("}"));
    if (!line) return undefined;
    try {
      const parsed = JSON.parse(line);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarize(results: AuditResult[]): AuditSummary {
  const byRegistry: Record<string, RegistrySummary> = {};
  for (const result of results) {
    const registrySummary = byRegistry[result.registry] ?? {
      ok: 0,
      failures: 0,
      expectedUnsupported: 0,
    };
    byRegistry[result.registry] = registrySummary;
    if (result.ok && result.expectedUnsupported) {
      registrySummary.expectedUnsupported += 1;
    } else if (result.ok) {
      registrySummary.ok += 1;
    } else {
      registrySummary.failures += 1;
    }
  }
  return {
    packages: new Set(results.map((r) => `${r.registry}:${r.packageName}`))
      .size,
    checks: results.length,
    ok: results.filter((r) => r.ok && !r.expectedUnsupported).length,
    expectedUnsupported: results.filter((r) => r.ok && r.expectedUnsupported)
      .length,
    failures: results.filter((r) => !r.ok).length,
    byRegistry,
    failedChecks: results
      .filter((r) => !r.ok)
      .map((r) => ({
        package: `${r.registry}:${r.packageName}`,
        tool: r.tool,
        code: r.code,
        error: r.error,
      })),
  };
}

function parseArgs(rawArgs: string[]): {
  help: boolean;
  registries: Set<Registry>;
  tools: ToolName[];
  limitPackages?: number;
  limitPackagesPerRegistry?: number;
  out?: string;
} {
  const parsed = {
    help: false,
    registries: new Set<Registry>(),
    tools: ["pkg_info", "pkg_changelog", "pkg_vulns"] as ToolName[],
    limitPackages: undefined as number | undefined,
    limitPackagesPerRegistry: undefined as number | undefined,
    out: undefined as string | undefined,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    if (arg === "--registry") {
      const registry = rawArgs[index + 1];
      index += 1;
      if (!isRegistry(registry))
        throw new Error(`Unknown registry: ${registry}`);
      parsed.registries.add(registry);
    }
    if (arg === "--tool") {
      const tool = rawArgs[index + 1];
      index += 1;
      if (!isTool(tool)) throw new Error(`Unknown tool: ${tool}`);
      parsed.tools = [tool];
    }
    if (arg === "--limit-packages") {
      const limit = Number(rawArgs[index + 1]);
      index += 1;
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("--limit-packages must be a positive integer.");
      }
      parsed.limitPackages = limit;
    }
    if (arg === "--limit-packages-per-registry") {
      const limit = Number(rawArgs[index + 1]);
      index += 1;
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(
          "--limit-packages-per-registry must be a positive integer.",
        );
      }
      parsed.limitPackagesPerRegistry = limit;
    }
    if (arg === "--out") {
      parsed.out = rawArgs[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function applyLimitPerRegistry(
  fixtures: PackageFixture[],
  limit: number | undefined,
): PackageFixture[] {
  if (limit === undefined) return fixtures;
  const counts = new Map<Registry, number>();
  return fixtures.filter((fixture) => {
    const count = counts.get(fixture.registry) ?? 0;
    if (count >= limit) return false;
    counts.set(fixture.registry, count + 1);
    return true;
  });
}

function isRegistry(value: string | undefined): value is Registry {
  return [
    "npm",
    "pypi",
    "hex",
    "crates",
    "nuget",
    "maven",
    "zig",
    "vcpkg",
    "packagist",
    "rubygems",
    "go",
  ].includes(value ?? "");
}

function isTool(value: string | undefined): value is ToolName {
  return ["pkg_info", "pkg_changelog", "pkg_vulns"].includes(value ?? "");
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/pkg-ecosystem-audit.ts [options]

Runs live pkg_info/pkg_changelog/pkg_vulns checks across representative ecosystems.

Options:
  --registry <registry>       Limit to one registry. Repeatable.
  --tool <tool>               Limit to pkg_info, pkg_changelog, or pkg_vulns.
  --limit-packages <count>    Limit selected fixtures after registry filtering.
  --limit-packages-per-registry <count>
                              Limit selected fixtures within each registry.
  --out <path>                Write per-check JSONL results.
  -h, --help                  Show this help.
`);
}
