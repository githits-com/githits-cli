import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

interface PackFile {
  path: string;
}

interface PackResult {
  filename: string;
  files?: PackFile[];
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

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "githits-public-packages-"));
  try {
    await buildPublicPackageArtifacts();
    await assertPublicManifestBoundaries();

    for (const packageInfo of publicPackages) {
      await scanDirectory(packageInfo.distDirectory, `${packageInfo.id} dist`);
      const tarballPath = await packPackage(packageInfo, tempRoot);
      const extractedPackageDir = await extractPackage(tarballPath, tempRoot);
      await scanPackFileList(packageInfo, tarballPath, tempRoot);
      await scanDirectory(extractedPackageDir, `${packageInfo.id} tarball`);

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
  if (!filename) {
    throw new Error(`npm pack did not return a filename for ${packageInfo.id}`);
  }
  return join(packDirectory, basename(filename));
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

async function scanDirectory(directory: string, label: string): Promise<void> {
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
  }
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

  await writeFile(
    join(appDirectory, "runtime-check.mjs"),
    `import { createMcpServer, getMcpToolDescriptors } from "@githits/mcp";\nimport { CodeNavigationServiceImpl, PackageIntelligenceServiceImpl, GitHitsServiceImpl, createClientHeaderBuilder, createStaticTokenProvider, getApiUrl } from "@githits/mcp/client";\nif (typeof createMcpServer !== "function") throw new Error("missing createMcpServer");\nif (typeof CodeNavigationServiceImpl !== "function") throw new Error("missing CodeNavigationServiceImpl");\nif (typeof PackageIntelligenceServiceImpl !== "function") throw new Error("missing PackageIntelligenceServiceImpl");\nif (typeof GitHitsServiceImpl !== "function") throw new Error("missing GitHitsServiceImpl");\nif (typeof createStaticTokenProvider !== "function") throw new Error("missing createStaticTokenProvider");\nif (typeof createClientHeaderBuilder !== "function") throw new Error("missing createClientHeaderBuilder");\nif (typeof getApiUrl !== "function") throw new Error("missing getApiUrl");\nif (getMcpToolDescriptors().length === 0) throw new Error("missing descriptors");\ntry {\n  await import("@githits/mcp/internal");\n  throw new Error("internal export resolved");\n} catch (error) {\n  if (error instanceof Error && error.message === "internal export resolved") throw error;\n}\n`,
  );
  await runCommand(
    "node",
    [join(appDirectory, "runtime-check.mjs")],
    appDirectory,
    "runtime import packed mcp package",
  );

  await writeFile(
    join(appDirectory, "check.ts"),
    `import { buildMcpInstructions, createMcpServer, getMcpToolDescriptors, type CreateMcpServerOptions, type McpToolServicesProvider } from "@githits/mcp";\nimport { CodeNavigationServiceImpl, GitHitsServiceImpl, PackageIntelligenceServiceImpl, createClientHeaderBuilder, createStaticTokenProvider, getApiUrl, getCodeNavigationUrl, type GitHitsService, type TokenProvider } from "@githits/mcp/client";\nconst provider: McpToolServicesProvider = () => { throw new Error("unused"); };\nconst options: CreateMcpServerOptions = { authAction: "Authenticate with the hosted GitHits MCP server.", metadata: { name: "consumer", version: "0.0.0" }, services: provider };\nconst tokenProvider: TokenProvider = createStaticTokenProvider("token");\nconst headers = createClientHeaderBuilder({ clientName: "remote-mcp", clientVersion: "0.0.0" });\nconst gitHitsService: GitHitsService = new GitHitsServiceImpl(getApiUrl(), "token", undefined, undefined, { clientHeaders: headers, userAgent: "remote-mcp/0.0.0" });\nvoid new CodeNavigationServiceImpl(getCodeNavigationUrl(), tokenProvider, globalThis.fetch, { clientHeaders: headers, userAgent: "remote-mcp/0.0.0" });\nvoid new PackageIntelligenceServiceImpl(getCodeNavigationUrl(), tokenProvider, globalThis.fetch, { clientHeaders: headers, userAgent: "remote-mcp/0.0.0" });\nvoid gitHitsService;\nvoid createMcpServer(options);\nvoid buildMcpInstructions();\nif (getMcpToolDescriptors().length === 0) throw new Error("expected descriptors");\n`,
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
        include: ["check.ts"],
      },
      null,
      2,
    ),
  );
  await runCommand(
    "npx",
    ["tsc", "--noEmit"],
    appDirectory,
    "typecheck packed mcp consumer",
  );
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

await main();
