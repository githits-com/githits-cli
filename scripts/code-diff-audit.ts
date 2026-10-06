import { deepStrictEqual, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { quoteGitPath } from "../packages/mcp/src/shared/code-diff-path.js";
import type { CodeDiffView } from "../packages/mcp/src/shared/code-diff-request.js";
import type { LeanCodeDiffEnvelope } from "../packages/mcp/src/shared/code-diff-response.js";

interface Comparison {
  id: string;
  target: string;
  from: string;
  to: string;
  pathGlob?: string;
  maxFiles?: number;
  maxPatchBytes?: number;
  error?: string;
}

interface AuditRow {
  id: string;
  passed: boolean;
  failure?: string;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exit: number;
}

const VIEWS: readonly CodeDiffView[] = [
  "name-status",
  "name-only",
  "stat",
  "patch",
];
const COMPARISONS: readonly Comparison[] = [
  { id: "npm", target: "npm:express", from: "5.2.0", to: "5.2.1" },
  {
    id: "repository-tags",
    target: "github:expressjs/express",
    from: "v5.2.0",
    to: "v5.2.1",
  },
  {
    id: "repository-shas",
    target: "github:expressjs/express",
    from: "4007ad103ba29f6426b2ec9eccfb1ceb792682a8",
    to: "dbac741a49a5a64336b70c06e85c2e2706e36336",
  },
  { id: "reverse", target: "npm:express", from: "5.2.1", to: "5.2.0" },
  { id: "identical", target: "npm:express", from: "5.2.1", to: "5.2.1" },
  {
    id: "glob",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    pathGlob: "lib/**/*.js",
  },
  {
    id: "glob-no-match",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    pathGlob: "githits-audit-no-such-directory/**",
  },
  {
    id: "file-bound",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    maxFiles: 1,
  },
  {
    id: "monorepo",
    target: "npm:react",
    from: "19.0.0",
    to: "19.1.0",
    maxFiles: 3,
  },
  {
    id: "monorepo-glob",
    target: "npm:react",
    from: "19.0.0",
    to: "19.1.0",
    pathGlob: "packages/react/**",
    maxFiles: 3,
  },
];
const INVENTORIES: readonly Comparison[] = [
  { id: "hex", target: "hex:plug", from: "1.15.0", to: "1.16.0", maxFiles: 3 },
  {
    id: "nuget",
    target: "nuget:Newtonsoft.Json",
    from: "13.0.2",
    to: "13.0.3",
    maxFiles: 3,
  },
  {
    id: "maven",
    target: "maven:com.google.guava:guava",
    from: "33.7.1-jre",
    to: "33.7.2-jre",
    maxFiles: 3,
  },
  {
    id: "packagist",
    target: "packagist:symfony/http-foundation",
    from: "8.1.7",
    to: "8.1.8",
    maxFiles: 3,
  },
  {
    id: "swift",
    target: "swift:github.com/apple/swift-argument-parser",
    from: "1.5.0",
    to: "1.5.1",
    maxFiles: 3,
  },
  {
    id: "zig-changed",
    target: "zig:gh/hejsil/zig-clap",
    from: "0.11.0",
    to: "0.12.0",
    maxFiles: 3,
  },
  {
    id: "zig-identical",
    target: "zig:gh/ziglibs/known-folders",
    from: "0.7.0",
    to: "0.7.0",
    maxFiles: 3,
  },
  {
    id: "vcpkg",
    target: "vcpkg:fmt",
    from: "10.2.1",
    to: "11.0.2",
    maxFiles: 3,
  },
  {
    id: "codeberg",
    target: "codeberg:forgejo/forgejo",
    from: "v10.0.0",
    to: "v10.0.1",
    maxFiles: 3,
  },
  {
    id: "gitlab",
    target: "gitlab:inkscape/inkscape",
    from: "INKSCAPE_1_3",
    to: "INKSCAPE_1_3_1",
    maxFiles: 3,
  },
  {
    id: "pypi",
    target: "pypi:requests",
    from: "2.31.0",
    to: "2.32.0",
    maxFiles: 3,
  },
  {
    id: "crates",
    target: "crates:serde",
    from: "1.0.219",
    to: "1.0.220",
    maxFiles: 3,
  },
  {
    id: "rubygems",
    target: "rubygems:rack",
    from: "3.1.0",
    to: "3.1.1",
    maxFiles: 3,
  },
  {
    id: "go",
    target: "go:github.com/gin-gonic/gin",
    from: "v1.9.0",
    to: "v1.9.1",
    maxFiles: 3,
  },
];
const FAILURES: readonly Comparison[] = [
  {
    id: "unsupported-package-repository",
    target: "maven:org.apache.commons:commons-lang3",
    from: "3.16.0",
    to: "3.17.0",
    error: "BACKEND_ERROR",
  },
  {
    id: "unavailable-old-packagist-version",
    target: "packagist:symfony/http-foundation",
    from: "6.4.0",
    to: "6.4.1",
    error: "VERSION_NOT_FOUND",
  },
  {
    id: "invalid-zig-compiler-target",
    target: "zig:gh/ziglang/zig",
    from: "0.13.0",
    to: "0.14.0",
    error: "NOT_FOUND",
  },
  {
    id: "missing-version",
    target: "npm:express",
    from: "5.2.0",
    to: "9999.0.0",
    error: "VERSION_NOT_FOUND",
  },
  {
    id: "missing-ref",
    target: "github:expressjs/express",
    from: "v5.2.0",
    to: "githits-audit-missing-ref",
    error: "REF_NOT_FOUND",
  },
  {
    id: "embedded-version",
    target: "npm:express@5.2.1",
    from: "5.2.0",
    to: "5.2.1",
    error: "INVALID_ARGUMENT",
  },
  {
    id: "embedded-ref",
    target: "github:expressjs/express@v5.2.1",
    from: "v5.2.0",
    to: "v5.2.1",
    error: "INVALID_ARGUMENT",
  },
  {
    id: "empty-from",
    target: "npm:express",
    from: "",
    to: "5.2.1",
    error: "INVALID_ARGUMENT",
  },
  {
    id: "files-too-small",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    maxFiles: 0,
    error: "INVALID_ARGUMENT",
  },
  {
    id: "files-too-large",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    maxFiles: 301,
    error: "INVALID_ARGUMENT",
  },
  {
    id: "traversal-glob",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    pathGlob: "../lib/**",
    error: "INVALID_ARGUMENT",
  },
  {
    id: "brace-glob",
    target: "npm:express",
    from: "5.2.0",
    to: "5.2.1",
    pathGlob: "{lib,test}/**",
    error: "INVALID_ARGUMENT",
  },
];

/** Run a bounded production CLI/MCP matrix; retain raw public evidence locally. */
async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? ".agent-eval/code-diff-ga/live");
  mkdirSync(out, { recursive: true });
  const config = mkdtempSync(join(tmpdir(), "githits-diff-audit-"));
  mkdirSync(join(config, "githits"));
  writeFileSync(
    join(config, "githits/config.toml"),
    "[experimental]\ntools = false\n",
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  env.GITHITS_ENV = "prod";
  env.GITHITS_DISABLE_SKILL_UPDATE = "1";
  env.GITHITS_DEBUG = "0";
  env.XDG_CONFIG_HOME = config;
  env.APPDATA = config;
  // This audit targets production presets, independent of caller endpoint overrides.
  for (const key of [
    "GITHITS_MCP_URL",
    "GITHITS_API_URL",
    "GITHITS_CODE_NAV_URL",
    "GITHITS_ACCOUNTS_URL",
  ])
    delete env[key];
  const client = new Client({ name: "code-diff-ga-audit", version: "1" });
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/cli.ts", "mcp", "start"],
    env,
    stderr: "pipe",
  });
  const rows: AuditRow[] = [];

  async function run(id: string, task: () => Promise<void>): Promise<void> {
    try {
      await task();
      rows.push({ id, passed: true });
    } catch (error) {
      rows.push({
        id,
        passed: false,
        failure: error instanceof Error ? error.message : String(error),
      });
    }
    console.log(`${rows.at(-1)?.passed ? "PASS" : "FAIL"} ${id}`);
    writeFileSync(join(out, "matrix.json"), JSON.stringify(rows, null, 2));
  }

  async function cli(args: string[], id: string): Promise<CliResult> {
    const child = Bun.spawn(
      ["bun", "run", "src/cli.ts", "code", "diff", ...args],
      {
        env: { ...env, XDG_CONFIG_HOME: config },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const result = { stdout, stderr, exit };
    writeFileSync(join(out, `${id}-cli.json`), JSON.stringify(result, null, 2));
    return result;
  }

  async function mcp(
    args: Record<string, unknown>,
    id: string,
  ): Promise<{ text: string; isError: boolean }> {
    const result = await client.callTool({
      name: "code_diff",
      arguments: args,
    });
    writeFileSync(join(out, `${id}-mcp.json`), JSON.stringify(result, null, 2));
    const blocks = result.content as { type: string; text?: string }[];
    return {
      text: blocks
        .filter((x) => x.type === "text")
        .map((x) => x.text)
        .join("\n"),
      isError: result.isError === true,
    };
  }

  function argumentsFor(
    c: Comparison,
    view: CodeDiffView,
  ): { cli: string[]; mcp: Record<string, unknown> } {
    const cli = [c.target, `${c.from}..${c.to}`, `--${view}`];
    const mcp: Record<string, unknown> = {
      target: c.target,
      from: c.from,
      to: c.to,
      view,
    };
    if (c.maxFiles !== undefined) {
      cli.push("--max-files", String(c.maxFiles));
      mcp.max_files = c.maxFiles;
    }
    if (c.maxPatchBytes !== undefined) {
      cli.push("--max-patch-bytes", String(c.maxPatchBytes));
      mcp.max_patch_bytes = c.maxPatchBytes;
    }
    return { cli, mcp };
  }

  function appendGlob(args: string[], c: Comparison): string[] {
    return c.pathGlob === undefined ? args : [...args, "--", c.pathGlob];
  }

  function checkPayload(
    p: LeanCodeDiffEnvelope,
    c: Comparison,
    view: CodeDiffView,
  ): void {
    ok(p.view === view && p.scope.status === "repository");
    ok(p.from.requested === c.from && p.to.requested === c.to);
    ok(
      /^[0-9a-f]{40}$/.test(p.from.commitSha) &&
        /^[0-9a-f]{40}$/.test(p.to.commitSha),
    );
    if (c.id === "repository-shas") {
      ok(p.from.commitSha === c.from && p.to.commitSha === c.to);
    }
    if (c.id === "zig-changed") {
      ok(p.from.commitSha === "5289e0753cd274d65344bef1c114284c633536ea");
      ok(p.to.commitSha === "8d97efa1ee1e575443c7888d5c38e1c3fc145cf5");
      ok(p.summary.filesChanged === 12 && p.hasMoreFiles);
    }
    const knownExpressCommits: Record<string, string> = {
      "5.2.0": "4007ad103ba29f6426b2ec9eccfb1ceb792682a8",
      "5.2.1": "dbac741a49a5a64336b70c06e85c2e2706e36336",
    };
    if (c.id === "repository-tags") {
      ok(p.from.commitSha === knownExpressCommits[c.from.slice(1)]);
      ok(p.to.commitSha === knownExpressCommits[c.to.slice(1)]);
    } else if (
      c.target === "npm:express" &&
      knownExpressCommits[c.from] &&
      knownExpressCommits[c.to]
    ) {
      ok(p.from.commitSha === knownExpressCommits[c.from]);
      ok(p.to.commitSha === knownExpressCommits[c.to]);
    }
    ok(p.summary.inventoryComplete && p.summary.unprojectableFiles === 0);
    ok(p.files.length <= (c.maxFiles ?? 300));
    if (view === "name-only" || view === "name-status") {
      ok(p.contentCoverage === "not_requested");
      for (const file of p.files)
        ok(!("patch" in file) && !("additions" in file));
    } else
      ok(
        p.contentCoverage === "complete" || p.contentCoverage === "partial",
        `content coverage: ${p.contentCoverage}`,
      );
    if (
      c.id === "identical" ||
      c.id === "glob-no-match" ||
      c.id === "zig-identical"
    )
      ok(p.files.length === 0 && p.summary.filesChanged === 0);
    if (c.id === "file-bound" || c.id === "monorepo") ok(p.hasMoreFiles);
    if (c.id === "monorepo-glob")
      ok(
        p.files.length > 0 &&
          p.files.every((f) => f.path.startsWith("packages/react/")),
      );
    if (c.id === "glob")
      ok(
        p.files.length > 0 &&
          p.files.every(
            (f) => f.path.startsWith("lib/") && f.path.endsWith(".js"),
          ),
      );
  }

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const descriptor = tools.tools.find((t) => t.name === "code_diff");
    ok(descriptor?.annotations?.readOnlyHint === true);
    writeFileSync(
      join(out, "descriptor.json"),
      JSON.stringify(descriptor, null, 2),
    );
    for (const c of [...COMPARISONS, ...INVENTORIES]) {
      for (const view of INVENTORIES.includes(c)
        ? ["name-status" as const]
        : VIEWS) {
        const id = `${c.id}-${view}`;
        const args = argumentsFor(c, view);
        if (c.pathGlob !== undefined) args.mcp.path_glob = c.pathGlob;
        let expected: LeanCodeDiffEnvelope | undefined;
        await run(`${id}-json-parity`, async () => {
          const a = await cli(appendGlob([...args.cli, "--json"], c), id);
          ok(a.exit === 0, `CLI exit ${a.exit}: ${a.stderr}`);
          const b = await mcp({ ...args.mcp, format: "json" }, id);
          ok(!b.isError, b.text);
          const p = JSON.parse(a.stdout) as LeanCodeDiffEnvelope;
          checkPayload(p, c, view);
          deepStrictEqual(p, JSON.parse(b.text));
          expected = p;
        });
        await run(`${id}-text`, async () => {
          ok(
            expected,
            "JSON evidence is required to validate the text projection",
          );
          const a = await cli(appendGlob(args.cli, c), `${id}-text`);
          // Bounded or binary/mode-only patches can be suppressed by design.
          if (view === "patch" && a.exit !== 0)
            ok(a.exit === 1 && a.stdout === "" && /suppressed/i.test(a.stderr));
          else ok(a.exit === 0, a.stderr);
          if (view === "name-only") {
            deepStrictEqual(
              a.stdout.trimEnd().split("\n").filter(Boolean),
              expected.files.map((f) => quoteGitPath(f.path)),
            );
          } else if (view === "name-status") {
            const lines = expected.files.map((f): string => {
              ok("status" in f);
              return `${f.status[0]?.toUpperCase()}\t${quoteGitPath(f.path)}`;
            });
            deepStrictEqual(
              a.stdout.trimEnd().split("\n").filter(Boolean),
              lines,
            );
          } else if (view === "stat") {
            for (const f of expected.files)
              ok(a.stdout.includes(quoteGitPath(f.path)));
          } else if (
            expected.files.every(
              (f) =>
                "patch" in f &&
                typeof f.patch === "string" &&
                "contentSafety" in f &&
                !f.contentSafety.filtered &&
                "modeChanged" in f &&
                !f.modeChanged &&
                "typeChanged" in f &&
                !f.typeChanged,
            )
          ) {
            ok(
              a.exit === 0,
              `Applicable patches must not be suppressed: ${a.stderr}`,
            );
            for (const f of expected.files) {
              ok("patch" in f && typeof f.patch === "string");
              ok(a.stdout.includes(f.patch));
            }
          }
          const b = await mcp(args.mcp, `${id}-text`);
          ok(
            !b.isError &&
              b.text.includes("Resolved endpoints:") &&
              b.text.includes("Scope: repository"),
            b.text,
          );
          ok(!a.stdout.includes("\u001b[") && !b.text.includes("\u001b["));
          if (c.id === "file-bound" || c.id === "monorepo")
            ok(/more matching files/i.test(b.text));
        });
      }
    }
    await run("cli-default-patch", async () => {
      const c = COMPARISONS[0];
      ok(c);
      const a = await cli(
        [c.target, `${c.from}..${c.to}`, "--json"],
        "cli-default-patch",
      );
      ok(a.exit === 0, a.stderr);
      const p = JSON.parse(a.stdout) as LeanCodeDiffEnvelope;
      checkPayload(p, c, "patch");
      const plain = await cli(
        [c.target, `${c.from}..${c.to}`],
        "cli-default-patch-text",
      );
      ok(
        plain.exit === 0 && plain.stdout.includes("--- a/lib/utils.js"),
        plain.stderr,
      );
    });
    await run("mcp-default-inventory", async () => {
      const c = COMPARISONS[0];
      ok(c);
      const args = { target: c.target, from: c.from, to: c.to };
      const a = await mcp({ ...args, format: "json" }, "mcp-default-inventory");
      ok(!a.isError, a.text);
      checkPayload(JSON.parse(a.text), c, "name-status");
      const text = await mcp(args, "mcp-default-inventory-text");
      ok(
        !text.isError &&
          text.text.includes("Content: not_requested") &&
          text.text.includes("lib/utils.js"),
      );
    });
    for (const c of FAILURES) {
      await run(`${c.id}-error`, async () => {
        const args = argumentsFor(c, "name-status");
        if (c.pathGlob !== undefined) args.mcp.path_glob = c.pathGlob;
        const a = await cli(appendGlob([...args.cli, "--json"], c), c.id);
        ok(a.exit === 1 && a.stdout === "");
        ok(JSON.parse(a.stderr).code === c.error, a.stderr);
        const b = await mcp({ ...args.mcp, format: "json" }, c.id);
        ok(b.isError);
        // Numeric schema bounds are rejected by the MCP SDK before the shared builder.
        if (c.id.startsWith("files-too-")) ok(/MCP error -32602/.test(b.text));
        else ok(JSON.parse(b.text).code === c.error, b.text);
      });
    }
    await run("explicit-repo-url", async () => {
      const result = await cli(
        [
          "--repo-url",
          "https://github.com/expressjs/express",
          "v5.2.0..v5.2.1",
          "--name-status",
          "--json",
        ],
        "explicit-repo-url",
      );
      ok(result.exit === 0, result.stderr);
      const comparison = COMPARISONS[1];
      ok(comparison);
      checkPayload(JSON.parse(result.stdout), comparison, "name-status");
    });
    await run("repository-head", async () => {
      const c: Comparison = {
        id: "repository-head",
        target: "github:expressjs/express",
        from: "HEAD",
        to: "HEAD",
      };
      const args = argumentsFor(c, "name-status");
      const a = await cli([...args.cli, "--json"], c.id);
      ok(a.exit === 0, a.stderr);
      const b = await mcp({ ...args.mcp, format: "json" }, c.id);
      ok(!b.isError, b.text);
      // Mutable refs can move between separate calls; validate each served identity.
      for (const p of [
        JSON.parse(a.stdout),
        JSON.parse(b.text),
      ] as LeanCodeDiffEnvelope[]) {
        checkPayload(p, c, "name-status");
        ok(p.from.refKind === "head" && p.to.refKind === "head");
        ok(p.from.commitSha === p.to.commitSha && p.files.length === 0);
      }
    });
    await run("budgeted-patch", async () => {
      const c: Comparison = {
        id: "budgeted-patch",
        target: "npm:express",
        from: "4.18.2",
        to: "5.1.0",
        pathGlob: "lib/**",
        maxPatchBytes: 1024,
      };
      const args = argumentsFor(c, "patch");
      args.mcp.path_glob = c.pathGlob;
      const a = await cli(appendGlob([...args.cli, "--json"], c), c.id);
      ok(a.exit === 0, a.stderr);
      const p = JSON.parse(a.stdout) as LeanCodeDiffEnvelope;
      checkPayload(p, c, "patch");
      const b = await mcp({ ...args.mcp, format: "json" }, c.id);
      ok(!b.isError, b.text);
      deepStrictEqual(p, JSON.parse(b.text));
      ok(
        p.contentCoverage === "partial" &&
          p.files.some(
            (f) => "contentStatus" in f && f.contentStatus === "omitted",
          ),
      );
      const text = await mcp(args.mcp, `${c.id}-text`);
      ok(!text.isError && /partial/i.test(text.text));
      const plain = await cli(appendGlob(args.cli, c), `${c.id}-text`);
      ok(plain.exit === 0, plain.stderr);
    });
  } finally {
    await client.close();
    rmSync(config, { recursive: true, force: true });
  }
  const summary = {
    passed: rows.filter((r) => r.passed).length,
    failed: rows.filter((r) => !r.passed).length,
    cells: rows.length,
  };
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
}

if (import.meta.main) await main();
