import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

interface PackFile {
  path: string;
}

interface PackResult {
  filename?: string;
  files?: PackFile[];
}

interface MetafileInput {
  imports?: unknown;
}

interface MetafileOutput {
  imports?: unknown;
}

export interface BundleMetafile {
  inputs?: Record<string, MetafileInput>;
  outputs?: Record<string, MetafileOutput>;
}

interface PublicPackage {
  id: string;
  packageName: string;
  directory: string;
  distDirectory: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runMcpPublishDryRun = process.argv.includes("--mcp-publish-dry-run");

const publicPackages: PublicPackage[] = [
  {
    id: "root",
    packageName: "githits",
    directory: root,
    distDirectory: join(root, "dist"),
  },
  {
    id: "mcp",
    packageName: "@githits/mcp",
    directory: join(root, "packages", "mcp"),
    distDirectory: join(root, "packages", "mcp", "dist"),
  },
];

const forbiddenCodeMarkers = [
  "@githits/core-internal",
  "@githits/mcp/internal",
  "workspace:",
];

const strictScanExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsonc",
  ".mjs",
  ".map",
  ".ts",
]);

const textDecoder = new TextDecoder();

const forbiddenFilesystemSpecifiers = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
]);

const forbiddenBrowserNodeBuiltins = new Set(
  builtinModules.flatMap((specifier) =>
    specifier.startsWith("node:")
      ? [specifier, specifier.slice("node:".length)]
      : [specifier, `node:${specifier}`],
  ),
);

const forbiddenBrowserPolyfillMarkers = [
  "@esbuild-plugins/node-globals-polyfill",
  "@esbuild-plugins/node-modules-polyfill",
  "node-stdlib-browser",
  "rollup-plugin-node-polyfills",
];

/** Match only the Node filesystem module specifiers prohibited in MCP/core. */
export function isForbiddenFilesystemSpecifier(specifier: string): boolean {
  return forbiddenFilesystemSpecifiers.has(specifier);
}

/**
 * Extract string-literal module specifiers from static import/export-from,
 * dynamic import(), and require() expressions. This deliberately does not
 * inspect arbitrary text containing `fs`; computed module names are outside
 * this statically resolved boundary check.
 */
export function findStaticModuleSpecifiers(source: string): string[] {
  return new Bun.Transpiler({ loader: "tsx" })
    .scanImports(source)
    .map(({ path }) => path);
}

export function findForbiddenStaticFilesystemSpecifiers(
  source: string,
): string[] {
  return findStaticModuleSpecifiers(source).filter(
    isForbiddenFilesystemSpecifier,
  );
}

export function findDirectProcessOutputAccess(source: string): string[] {
  return Array.from(
    source.matchAll(/\bprocess\s*\.\s*(stderr|stdout)\b/g),
    (match) => `process.${match[1]}`,
  );
}

export function findForbiddenFilesystemSpecifiersInMetafile(
  metafile: BundleMetafile,
): string[] {
  const found = new Set<string>();
  for (const input of Object.values(metafile.inputs ?? {})) {
    if (!Array.isArray(input.imports)) continue;
    for (const item of input.imports) {
      if (!isRecord(item)) continue;
      for (const value of [item.original, item.path]) {
        if (
          typeof value === "string" &&
          isForbiddenFilesystemSpecifier(value)
        ) {
          found.add(value);
        }
      }
    }
  }
  return [...found];
}

function isForbiddenBrowserSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (forbiddenBrowserNodeBuiltins.has(specifier)) return true;
  if (
    specifier === "@modelcontextprotocol/sdk" ||
    specifier.startsWith("@modelcontextprotocol/sdk/")
  ) {
    return true;
  }
  if (
    specifier === "@githits/core-internal" ||
    specifier.startsWith("@githits/core-internal/") ||
    specifier === "@githits/mcp/internal" ||
    specifier.startsWith("@githits/mcp/internal/") ||
    specifier.startsWith("workspace:")
  ) {
    return true;
  }
  return forbiddenBrowserPolyfillMarkers.some((marker) =>
    specifier.includes(marker),
  );
}

function metafileImportSpecifiers(metafile: BundleMetafile): string[] {
  const specifiers: string[] = [];
  const collect = (imports: unknown): void => {
    if (!Array.isArray(imports)) return;
    for (const item of imports) {
      if (!isRecord(item)) continue;
      for (const value of [item.original, item.path]) {
        if (typeof value === "string") specifiers.push(value);
      }
    }
  };

  for (const input of Object.values(metafile.inputs ?? {})) {
    collect(input.imports);
  }
  for (const output of Object.values(metafile.outputs ?? {})) {
    collect(output.imports);
  }
  return specifiers;
}

/** Find module edges that cannot be present in a browser-target tools bundle. */
export function findForbiddenBrowserBundleSpecifiers(
  metafile: BundleMetafile,
): string[] {
  return [
    ...new Set(
      metafileImportSpecifiers(metafile).filter(isForbiddenBrowserSpecifier),
    ),
  ].sort();
}

const forbiddenBrowserOutputPatterns: ReadonlyArray<[string, RegExp]> = [
  ["node: import", /node:/],
  ["MCP SDK runtime", /@modelcontextprotocol\/sdk/],
  ["broad core entry", /@githits\/core-internal/],
  ["MCP internal entry", /@githits\/mcp\/internal/],
  ["workspace dependency", /workspace:/],
  ["process global", /\bprocess\s*(?:\.|\[)/],
  ["Buffer global", /\bBuffer\s*(?:\.|\[|\()/],
  ["AsyncLocalStorage", /\bAsyncLocalStorage\b/],
];

/** Find forbidden imports and Node globals in a browser bundle or declaration. */
export function findForbiddenBrowserOutputMarkers(source: string): string[] {
  return forbiddenBrowserOutputPatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([label]) => label);
}

export async function buildNodeTargetProbe(
  entrypoint: string,
  outdir: string,
): Promise<BundleMetafile> {
  const build = await Bun.build({
    entrypoints: [entrypoint],
    metafile: true,
    outdir,
    packages: "bundle",
    target: "node",
    format: "esm",
  });
  if (!build.success) {
    throw new Error(
      `Node-target probe failed for ${entrypoint}\n${build.logs
        .map((log) => String(log))
        .join("\n")}`,
    );
  }
  const metafile = build.metafile as BundleMetafile | undefined;
  if (!metafile) {
    throw new Error(
      `Node-target probe did not produce a metafile: ${entrypoint}`,
    );
  }
  return metafile;
}

export async function buildBrowserTargetProbe(
  entrypoint: string,
  outdir: string,
): Promise<BundleMetafile> {
  const build = await Bun.build({
    entrypoints: [entrypoint],
    metafile: true,
    outdir,
    packages: "bundle",
    target: "browser",
    format: "esm",
  });
  if (!build.success) {
    throw new Error(
      `Browser-target probe failed for ${entrypoint}\n${build.logs
        .map((log) => String(log))
        .join("\n")}`,
    );
  }
  const metafile = build.metafile as BundleMetafile | undefined;
  if (!metafile) {
    throw new Error(
      `Browser-target probe did not produce a metafile: ${entrypoint}`,
    );
  }
  return metafile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "githits-public-packages-"));
  try {
    await buildPublicPackageArtifacts();
    await assertCoreSourceBoundary();
    await assertPublicManifestBoundaries();

    for (const packageInfo of publicPackages) {
      await scanDirectory(
        packageInfo.distDirectory,
        `${packageInfo.id} dist`,
        packageInfo.id === "mcp",
      );
      const tarballPath = await packPackage(packageInfo, tempRoot);
      const extractedPackageDir = await extractPackage(tarballPath, tempRoot);
      await scanPackFileList(packageInfo, tarballPath, tempRoot);
      await scanDirectory(
        extractedPackageDir,
        `${packageInfo.id} tarball`,
        packageInfo.id === "mcp",
      );

      if (packageInfo.id === "root") {
        await verifyRootConsumer(tarballPath, tempRoot);
      } else if (packageInfo.id === "mcp") {
        await verifyMcpConsumer(tarballPath, tempRoot);
      }
    }

    if (runMcpPublishDryRun) {
      const mcpPackageJson = await readPackageJson(
        join(root, "packages", "mcp", "package.json"),
      );
      const mcpVersion = mcpPackageJson.version;
      if (typeof mcpVersion !== "string") {
        throw new Error("packages/mcp/package.json must have a string version");
      }

      if (await packageVersionExists("@githits/mcp", mcpVersion)) {
        console.log(
          `Skipping MCP npm publish dry-run because @githits/mcp@${mcpVersion} is already published`,
        );
      } else {
        await runCommand(
          "npm",
          ["publish", "--dry-run", "--access", "public"],
          join(root, "packages", "mcp"),
          "mcp npm publish dry-run",
        );
      }
    }

    console.log("Public package validation passed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function buildPublicPackageArtifacts(): Promise<void> {
  await runCommand("bun", ["run", "build"], root, "build root package");
  await runCommand(
    "bun",
    ["run", "build"],
    join(root, "packages", "mcp"),
    "build mcp package",
  );
}

async function assertCoreSourceBoundary(): Promise<void> {
  const sourceDirectory = join(root, "packages", "core-internal", "src");
  for (const filePath of await collectFiles(sourceDirectory)) {
    if (!filePath.endsWith(".ts") || filePath.endsWith(".test.ts")) continue;
    const source = await readFile(filePath, "utf8");
    const filesystemSpecifiers =
      findForbiddenStaticFilesystemSpecifiers(source);
    if (filesystemSpecifiers.length > 0) {
      throw new Error(
        `core source imports forbidden filesystem specifier(s) ${filesystemSpecifiers.join(", ")} in ${relative(root, filePath)}`,
      );
    }
    const outputAccess = findDirectProcessOutputAccess(source);
    if (outputAccess.length > 0) {
      throw new Error(
        `core source accesses process output ${outputAccess.join(", ")} in ${relative(root, filePath)}`,
      );
    }
  }
}

async function assertPublicManifestBoundaries(): Promise<void> {
  const rootPackageJson = await readPackageJson(join(root, "package.json"));
  const mcpPackageJson = await readPackageJson(
    join(root, "packages", "mcp", "package.json"),
  );

  assertNoDependency(rootPackageJson, "@githits/mcp", "root package.json");
  assertNoDependency(
    mcpPackageJson,
    "@githits/core-internal",
    "packages/mcp/package.json",
  );
  assertNoDependency(
    mcpPackageJson,
    "@githits/mcp/internal",
    "packages/mcp/package.json",
  );

  if (JSON.stringify(mcpPackageJson.exports).includes("./internal")) {
    throw new Error("packages/mcp/package.json must not export ./internal");
  }
}

async function readPackageJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function packageVersionExists(
  packageName: string,
  version: string,
): Promise<boolean> {
  const process = Bun.spawn(
    ["npm", "view", `${packageName}@${version}`, "version"],
    {
      cwd: root,
      stderr: "ignore",
      stdout: "ignore",
    },
  );
  return (await process.exited) === 0;
}

function assertNoDependency(
  manifest: Record<string, unknown>,
  dependencyName: string,
  label: string,
): void {
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const dependencies = manifest[field] as Record<string, string> | undefined;
    if (dependencies?.[dependencyName]) {
      throw new Error(`${label} must not depend on ${dependencyName}`);
    }
  }
}

async function packPackage(
  packageInfo: PublicPackage,
  tempRoot: string,
): Promise<string> {
  const packDirectory = join(tempRoot, `${packageInfo.id}-pack`);
  await mkdir(packDirectory, { recursive: true });
  const output = await runCommand(
    "npm",
    ["pack", "--json", "--pack-destination", packDirectory],
    packageInfo.directory,
    `${packageInfo.id} npm pack`,
  );
  const packResults = JSON.parse(output) as PackResult[];
  const filename = packResults[0]?.filename;
  if (filename) {
    return join(packDirectory, basename(filename));
  }

  const tarballs = (await readdir(packDirectory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error(
      `npm pack did not return a filename for ${packageInfo.id} and created ${tarballs.length} tarballs`,
    );
  }
  const tarball = tarballs[0];
  if (!tarball) {
    throw new Error(`npm pack did not create a tarball for ${packageInfo.id}`);
  }
  return join(packDirectory, tarball);
}

async function extractPackage(
  tarballPath: string,
  tempRoot: string,
): Promise<string> {
  const extractDirectory = join(
    tempRoot,
    `${basename(tarballPath, ".tgz")}-extract`,
  );
  await mkdir(extractDirectory, { recursive: true });
  await runCommand(
    "tar",
    ["-xzf", tarballPath, "-C", extractDirectory],
    root,
    `extract ${basename(tarballPath)}`,
  );
  return join(extractDirectory, "package");
}

async function scanPackFileList(
  packageInfo: PublicPackage,
  tarballPath: string,
  tempRoot: string,
): Promise<void> {
  const list = await runCommand(
    "tar",
    ["-tzf", tarballPath],
    tempRoot,
    `list ${packageInfo.id} tarball`,
  );
  for (const line of list.split("\n")) {
    if (!line.trim()) continue;
    if (
      line.includes("packages/core-internal") ||
      line.includes("workspace:")
    ) {
      throw new Error(
        `${packageInfo.id} tarball file list contains private marker: ${line}`,
      );
    }
  }
}

async function scanDirectory(
  directory: string,
  label: string,
  scanFilesystemSpecifiers = false,
): Promise<void> {
  const entries = await collectFiles(directory);
  for (const filePath of entries) {
    if (!shouldScanStrictly(filePath)) continue;
    const contents = await readFile(filePath, "utf8");
    for (const marker of forbiddenCodeMarkers) {
      if (contents.includes(marker)) {
        throw new Error(
          `${label} contains forbidden marker ${marker} in ${relative(root, filePath)}`,
        );
      }
    }
    if (scanFilesystemSpecifiers && shouldScanModuleSpecifiers(filePath)) {
      const filesystemSpecifiers =
        findForbiddenStaticFilesystemSpecifiers(contents);
      if (filesystemSpecifiers.length > 0) {
        throw new Error(
          `${label} contains forbidden filesystem specifier(s) ${filesystemSpecifiers.join(", ")} in ${relative(root, filePath)}`,
        );
      }
    }
  }
}

function shouldScanModuleSpecifiers(filePath: string): boolean {
  return [".cjs", ".d.ts", ".js", ".mjs", ".ts"].some((extension) =>
    filePath.endsWith(extension),
  );
}

function shouldScanStrictly(filePath: string): boolean {
  const extension = extname(filePath);
  if (extension === ".d.ts") return true;
  if (filePath.endsWith("package.json")) return true;
  return strictScanExtensions.has(extension);
}

async function collectFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory);
  for (const entry of entries) {
    const entryPath = join(directory, entry);
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entryStat.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function verifyRootConsumer(
  tarballPath: string,
  tempRoot: string,
): Promise<void> {
  const appDirectory = join(tempRoot, "root-consumer");
  await mkdir(appDirectory, { recursive: true });
  await writePackageJson(appDirectory);
  await runCommand(
    "npm",
    ["install", tarballPath, "--silent"],
    appDirectory,
    "install packed root package",
  );
  const version = await runCommand(
    "node",
    [
      join(appDirectory, "node_modules", "githits", "dist", "cli.js"),
      "--version",
    ],
    appDirectory,
    "run packed root cli",
  );
  if (!version.trim()) {
    throw new Error("packed root CLI did not print a version");
  }
}

async function verifyMcpToolsArtifacts(appDirectory: string): Promise<void> {
  const distDirectory = join(
    appDirectory,
    "node_modules",
    "@githits",
    "mcp",
    "dist",
  );
  for (const filename of ["tools.js", "tools.d.ts"]) {
    const filePath = join(distDirectory, filename);
    const source = await readFile(filePath, "utf8");
    const importSpecifiers = findStaticModuleSpecifiers(source).filter(
      isForbiddenBrowserSpecifier,
    );
    const outputMarkers = findForbiddenBrowserOutputMarkers(source);
    if (importSpecifiers.length > 0 || outputMarkers.length > 0) {
      throw new Error(
        `packed @githits/mcp/tools ${filename} contains forbidden browser dependencies: ${[
          ...importSpecifiers,
          ...outputMarkers,
        ].join(", ")}`,
      );
    }
  }
}

async function verifyMcpToolsRuntime(appDirectory: string): Promise<void> {
  const runtimeCheckPath = join(appDirectory, "tools-runtime-check.mjs");
  await writeFile(
    runtimeCheckPath,
    `import { createGetExampleTool, toCallableTool } from "@githits/mcp/tools";
const signal = new AbortController().signal;
const service = {
  search: async (params, options) => {
    if (params.query !== "packed callable") throw new Error("unexpected query");
    if (options?.signal !== signal) throw new Error("signal was not forwarded");
    return "packed result";
  },
};
const callable = toCallableTool(createGetExampleTool(service));
const result = await callable.execute({ query: "packed callable" }, { signal });
if (result.isError === true) throw new Error("packed callable returned an error");
if (result.content?.[0]?.text !== "packed result") throw new Error("packed callable result was incorrect");
const controller = new AbortController();
const reason = new Error("packed caller cancelled");
const cancellingService = {
  search: async (_params, options) => {
    if (options?.signal !== controller.signal) throw new Error("cancellation signal was not forwarded");
    controller.abort(reason);
    throw reason;
  },
};
const cancellingCallable = toCallableTool(createGetExampleTool(cancellingService));
try {
  await cancellingCallable.execute({ query: "packed cancellation" }, { signal: controller.signal });
  throw new Error("packed cancellation resolved");
} catch (error) {
  if (error !== reason) throw new Error("packed cancellation reason was not preserved");
}
`,
  );
  await runCommand(
    "node",
    [runtimeCheckPath],
    appDirectory,
    "runtime import packed mcp tools",
  );
}

async function verifyMcpToolsBrowserConsumer(
  appDirectory: string,
): Promise<void> {
  const probeDirectory = join(appDirectory, "tools-browser-probe");
  const outputDirectory = join(probeDirectory, "out");
  const entrypoint = join(probeDirectory, "browser-check.ts");
  await mkdir(probeDirectory, { recursive: true });
  await writeFile(
    entrypoint,
    `import { createGetExampleTool, toCallableTool, type GetExampleService } from "@githits/mcp/tools";
const service: GetExampleService = { search: async ({ query }) => query };
const callable = toCallableTool(createGetExampleTool(service));
export const browserProbe = { name: callable.name, schema: callable.inputSchema };
`,
  );

  const metafile = await buildBrowserTargetProbe(entrypoint, outputDirectory);
  const forbiddenSpecifiers = findForbiddenBrowserBundleSpecifiers(metafile);
  if (forbiddenSpecifiers.length > 0) {
    throw new Error(
      `packed @githits/mcp/tools browser bundle resolves forbidden dependencies: ${forbiddenSpecifiers.join(", ")}`,
    );
  }

  const outputFiles = (await collectFiles(outputDirectory)).filter((filePath) =>
    [".js", ".mjs"].some((extension) => filePath.endsWith(extension)),
  );
  if (outputFiles.length === 0) {
    throw new Error(
      "packed @githits/mcp/tools browser bundle emitted no JavaScript",
    );
  }
  for (const filePath of outputFiles) {
    const markers = findForbiddenBrowserOutputMarkers(
      await readFile(filePath, "utf8"),
    );
    if (markers.length > 0) {
      throw new Error(
        `packed @githits/mcp/tools browser output contains forbidden dependencies (${markers.join(", ")}): ${relative(root, filePath)}`,
      );
    }
  }
}

async function verifyMcpConsumer(
  tarballPath: string,
  tempRoot: string,
): Promise<void> {
  const appDirectory = join(tempRoot, "mcp-consumer");
  await mkdir(appDirectory, { recursive: true });
  await writePackageJson(appDirectory);
  await runCommand(
    "npm",
    ["install", tarballPath, "typescript", "--silent"],
    appDirectory,
    "install packed mcp package",
  );
  await verifyMcpToolsArtifacts(appDirectory);
  await verifyMcpToolsRuntime(appDirectory);

  await writeFile(
    join(appDirectory, "runtime-check.mjs"),
    `import { createMcpServer, getMcpToolDescriptors } from "@githits/mcp";\nimport * as clientEntry from "@githits/mcp/client";\nimport { CodeNavigationServiceImpl, PackageIntelligenceServiceImpl, GitHitsServiceImpl, createClientHeaderBuilder, createStaticTokenProvider, getApiUrl } from "@githits/mcp/client";\nimport { EXPECTED_MCP_TOOLS, runMcpSmoke } from "@githits/mcp/smoke-test";\nimport { Client } from "@modelcontextprotocol/sdk/client/index.js";\nimport { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";\nfor (const removed of ["startTelemetrySpan", "endTelemetrySpan", "flushTelemetry", "withTelemetrySpan"]) {\n  if (removed in clientEntry) throw new Error(\`removed client export was present: \${removed}\`);\n}\nif (typeof createMcpServer !== "function") throw new Error("missing createMcpServer");\nif (typeof CodeNavigationServiceImpl !== "function") throw new Error("missing CodeNavigationServiceImpl");\nif (typeof PackageIntelligenceServiceImpl !== "function") throw new Error("missing PackageIntelligenceServiceImpl");\nif (typeof GitHitsServiceImpl !== "function") throw new Error("missing GitHitsServiceImpl");\nif (typeof createStaticTokenProvider !== "function") throw new Error("missing createStaticTokenProvider");\nif (typeof createClientHeaderBuilder !== "function") throw new Error("missing createClientHeaderBuilder");\nif (typeof getApiUrl !== "function") throw new Error("missing getApiUrl");\nif (typeof runMcpSmoke !== "function") throw new Error("missing runMcpSmoke");\nif (EXPECTED_MCP_TOOLS.length === 0) throw new Error("missing expected smoke tools");\nif (getMcpToolDescriptors().length === 0) throw new Error("missing descriptors");\nconst rateLimitedFetch = async () => new Response(null, { status: 429, headers: { "Retry-After": "17" } });\nconst rateLimitedService = new GitHitsServiceImpl("https://example.invalid", "test-token", rateLimitedFetch);\nconst rateLimitedServer = createMcpServer({\n  metadata: { name: "packed-consumer", version: "0.0.0" },\n  services: {\n    githitsService: rateLimitedService,\n    codeNavigationService: {},\n    packageIntelligenceService: {},\n  },\n});\nconst rateLimitedClient = new Client({ name: "packed-consumer", version: "0.0.0" });\nconst [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();\nawait rateLimitedServer.connect(serverTransport);\nawait rateLimitedClient.connect(clientTransport);\nconst rateLimitedResult = await rateLimitedClient.callTool({ name: "get_example", arguments: { query: "package boundary check" } });\nconst rateLimitedText = rateLimitedResult.content?.[0]?.text;\nif (typeof rateLimitedText !== "string") throw new Error("missing packed rate-limit payload");\nconst rateLimitedPayload = JSON.parse(rateLimitedText);\nif (rateLimitedResult.isError !== true) throw new Error("packed rate-limit result was not an error");\nif (rateLimitedPayload.code !== "RATE_LIMITED") throw new Error(\`packed rate-limit code was \${String(rateLimitedPayload.code)}\`);\nif (rateLimitedPayload.retryable !== true) throw new Error("packed rate-limit result was not retryable");\nif (rateLimitedPayload.details?.status !== 429) throw new Error("packed rate-limit status metadata was missing");\nif (rateLimitedPayload.details?.retryAfterSeconds !== 17) throw new Error("packed retry timing metadata was missing");\nawait rateLimitedClient.close();\nawait rateLimitedServer.close();\ntry {\n  await import("@githits/mcp/internal");\n  throw new Error("internal export resolved");\n} catch (error) {\n  if (error instanceof Error && error.message === "internal export resolved") throw error;\n}\n`,
  );
  await runCommand(
    "node",
    [join(appDirectory, "runtime-check.mjs")],
    appDirectory,
    "runtime import packed mcp package",
  );
  await verifyMcpToolsBrowserConsumer(appDirectory);
  await verifyMcpBundleProbes(appDirectory);

  await writeFile(
    join(appDirectory, "check.ts"),
    `import { buildMcpQuickStart, createMcpServer, getMcpToolDescriptors, type CreateMcpServerOptions, type McpToolServicesProvider } from "@githits/mcp";\nimport { CodeNavigationServiceImpl, GitHitsServiceImpl, PackageIntelligenceServiceImpl, createClientHeaderBuilder, createStaticTokenProvider, getApiUrl, getCodeNavigationUrl, type GitHitsService, type ServiceDiagnostics, type TokenProvider } from "@githits/mcp/client";\nimport { EXPECTED_MCP_TOOLS, runMcpSmoke, type McpSmokeCaller } from "@githits/mcp/smoke-test";\n// These negative imports guard the packed declaration surface if old globals reappear.\n// @ts-expect-error telemetry lifecycle was removed from the client entry\nimport { startTelemetrySpan } from "@githits/mcp/client";\n// @ts-expect-error telemetry lifecycle was removed from the client entry\nimport { endTelemetrySpan } from "@githits/mcp/client";\n// @ts-expect-error telemetry lifecycle was removed from the client entry\nimport { flushTelemetry } from "@githits/mcp/client";\n// @ts-expect-error telemetry lifecycle was removed from the client entry\nimport { withTelemetrySpan } from "@githits/mcp/client";\nconst provider: McpToolServicesProvider = () => { throw new Error("unused"); };\nconst options: CreateMcpServerOptions = { authAction: "Authenticate with the hosted GitHits MCP server.", metadata: { name: "consumer", version: "0.0.0" }, services: provider };\nconst tokenProvider: TokenProvider = createStaticTokenProvider("token");\nconst headers = createClientHeaderBuilder({ clientName: "remote-mcp", clientVersion: "0.0.0" });\nconst diagnostics: ServiceDiagnostics = { withOperation: async (_name, operation) => operation(), isEnabled: () => false, debug: () => {} };\nconst gitHitsService: GitHitsService = new GitHitsServiceImpl(getApiUrl(), "token", undefined, undefined, { clientHeaders: headers, userAgent: "remote-mcp/0.0.0", diagnostics });\nconst caller: McpSmokeCaller = { listTools: async () => ({ tools: EXPECTED_MCP_TOOLS.map((name) => ({ name })) }), callTool: async (name) => ({ content: [{ type: "text", text: name === "quick_start" ? buildMcpQuickStart() : "ok" }] }) };\nvoid new CodeNavigationServiceImpl(getCodeNavigationUrl(), tokenProvider, globalThis.fetch, { clientHeaders: headers, userAgent: "remote-mcp/0.0.0", diagnostics });\nvoid new PackageIntelligenceServiceImpl(getCodeNavigationUrl(), tokenProvider, globalThis.fetch, { clientHeaders: headers, userAgent: "remote-mcp/0.0.0", diagnostics });\nvoid gitHitsService;\nvoid createMcpServer(options);\nvoid buildMcpQuickStart();\nvoid runMcpSmoke(caller, { includeLiveTools: false });\nif (getMcpToolDescriptors().length === 0) throw new Error("expected descriptors");\n`,
  );
  await writeFile(
    join(appDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["check.ts", "code-diff-check.ts", "tools-check.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(appDirectory, "tools-check.ts"),
    `import { createGetExampleTool, toCallableTool, type CallableTool, type CallableToolExecutionOptions, type GetExampleInput, type GetExampleRequestOptions, type GetExampleSearchParams, type GetExampleService } from "@githits/mcp/tools";
const searchOnlyService: GetExampleService = {
  search: async (_params: GetExampleSearchParams, _options?: GetExampleRequestOptions) => "ok",
};
const callableTool: CallableTool = toCallableTool(createGetExampleTool(searchOnlyService));
const callableInput: GetExampleInput = { query: "packed tools" };
const callableOptions: CallableToolExecutionOptions = { signal: new AbortController().signal };
void callableTool.execute(callableInput, callableOptions);
`,
  );
  await writeFile(
    join(appDirectory, "code-diff-check.ts"),
    `import { CodeDiffError, CodeNavigationServiceImpl, createStaticTokenProvider, getCodeNavigationUrl, type CodeDiffMode, type CodeDiffPackageTarget, type CodeDiffParams, type CodeDiffRepositoryTarget, type CodeDiffResult, type CodeDiffService, type CodeNavigationService } from "@githits/mcp/client";
const packageTarget: CodeDiffPackageTarget = { registry: "NPM", packageName: "express" };
const repositoryTarget: CodeDiffRepositoryTarget = { repoUrl: "https://github.com/expressjs/express" };
const mode: CodeDiffMode = "inventory";
const params: CodeDiffParams = { target: packageTarget, from: "4.18.1", to: "4.18.2", mode };
const result: CodeDiffResult | undefined = undefined;
const service: CodeNavigationService = new CodeNavigationServiceImpl(getCodeNavigationUrl(), createStaticTokenProvider("token"));
const diffService: CodeDiffService = new CodeNavigationServiceImpl(getCodeNavigationUrl(), createStaticTokenProvider("token"));
const codeNavigationRemainsCompatible: "codeDiff" extends keyof CodeNavigationService ? never : true = true;
void repositoryTarget;
void params;
void result;
void service;
void diffService;
void codeNavigationRemainsCompatible;
void CodeDiffError;
`,
  );
  await runCommand(
    "npx",
    ["tsc", "--noEmit"],
    appDirectory,
    "typecheck packed mcp consumer",
  );
}

async function verifyMcpBundleProbes(appDirectory: string): Promise<void> {
  const probeDirectory = join(appDirectory, "bundle-probes");
  const outputDirectory = join(probeDirectory, "out");
  await mkdir(probeDirectory, { recursive: true });

  for (const [index, specifier] of [
    "@githits/mcp",
    "@githits/mcp/client",
    "@githits/mcp/smoke-test",
  ].entries()) {
    const entrypoint = join(probeDirectory, `probe-${index}.mjs`);
    await writeFile(
      entrypoint,
      `import * as entry from ${JSON.stringify(specifier)};\nif (Object.keys(entry).length === 0) throw new Error("empty ${specifier} probe");\n`,
    );
    const metafile = await buildNodeTargetProbe(entrypoint, outputDirectory);
    const forbidden = findForbiddenFilesystemSpecifiersInMetafile(metafile);
    if (forbidden.length > 0) {
      throw new Error(
        `${specifier} Node-target bundle resolves forbidden filesystem specifier(s): ${forbidden.join(", ")}`,
      );
    }
  }
}

async function writePackageJson(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  label: string,
): Promise<string> {
  const process = Bun.spawn([command, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).arrayBuffer(),
    process.exited,
  ]);
  const stdoutText = textDecoder.decode(stdout);
  const stderrText = textDecoder.decode(stderr);
  if (exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${exitCode}\n${stdoutText}\n${stderrText}`,
    );
  }
  return stdoutText;
}

if (import.meta.main) {
  await main();
}
