import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_SKILL_NAMES = [
  "githits-code",
  "githits-mcp",
  "githits-onboarding",
  "githits-package",
] as const;

export const AGENT_PLUGINS_VERSION = "1.0.0";
export const AGENT_PLUGINS_SCHEMA_URL = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`;
export const AGENT_PLUGINS_MCP_SCHEMA_URL = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/mcp.schema.json`;

export const GENERATED_PLUGIN_ASSET_PATHS = [
  ".plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".mcp.json",
  "mcp.json",
  "gemini-extension.json",
  "plugin.json",
  "mcp_config.json",
] as const;

interface PackageRepository {
  type?: string;
  url?: string;
}

interface PackageAuthor {
  name?: string;
}

export interface PluginPackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | PackageAuthor;
  homepage?: string;
  repository?: string | PackageRepository;
  license?: string;
  keywords?: string[];
}

interface RegistryRemote {
  type?: string;
  url?: string;
}

interface RegistryPackage {
  identifier?: string;
  version?: string;
}

interface RegistryPublisherMetadata {
  keywords?: string[];
}

interface RegistryMeta {
  "io.modelcontextprotocol.registry/publisher-provided"?: RegistryPublisherMetadata;
}

export interface PluginServerJson {
  version?: string;
  remotes?: RegistryRemote[];
  packages?: RegistryPackage[];
  _meta?: RegistryMeta;
}

export interface PluginAssetInputs {
  name: string;
  version: string;
  description: string;
  authorName: string;
  homepage: string;
  repository: string;
  license: string;
  keywords: string[];
  remoteMcpUrl: string;
  skillNames: string[];
}

export interface GeneratedPluginAsset {
  path: (typeof GENERATED_PLUGIN_ASSET_PATHS)[number];
  content: string;
}

export interface GeneratePluginAssetsOptions {
  root?: string;
  check?: boolean;
}

function requireString(value: string | undefined, field: string): string {
  if (!value?.trim()) {
    throw new Error(`Missing required plugin metadata: ${field}`);
  }
  return value;
}

function normalizeRepository(
  repository: string | PackageRepository | undefined,
): string {
  const raw = typeof repository === "string" ? repository : repository?.url;
  return requireString(raw, "package.json#repository")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
}

function resolveAuthorName(author: string | PackageAuthor | undefined): string {
  return requireString(
    typeof author === "string" ? author : author?.name,
    "package.json#author",
  );
}

function assertCanonicalSkills(skillNames: string[]): void {
  const actual = [...skillNames].sort();
  const expected = [...CANONICAL_SKILL_NAMES];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Canonical skill set mismatch. Expected ${expected.join(", ")}; received ${actual.join(", ") || "none"}`,
    );
  }
}

export function createPluginAssetInputs(
  packageJson: PluginPackageJson,
  serverJson: PluginServerJson,
  skillNames: string[],
): PluginAssetInputs {
  const name = requireString(packageJson.name, "package.json#name");
  const version = requireString(packageJson.version, "package.json#version");
  const serverVersion = requireString(
    serverJson.version,
    "server.json#version",
  );

  if (serverVersion !== version) {
    throw new Error(
      `Root version mismatch: package.json=${version}, server.json=${serverVersion}`,
    );
  }

  const registryPackage = serverJson.packages?.find(
    (entry) => entry.identifier === name,
  );
  if (!registryPackage) {
    throw new Error(`server.json does not contain the ${name} npm package`);
  }
  if (registryPackage.version !== version) {
    throw new Error(
      `Registry package version mismatch: package.json=${version}, server.json=${registryPackage.version ?? "missing"}`,
    );
  }

  const remoteMcpUrl = serverJson.remotes?.find(
    (remote) => remote.type === "streamable-http",
  )?.url;
  const registryKeywords =
    serverJson._meta?.["io.modelcontextprotocol.registry/publisher-provided"]
      ?.keywords;
  if (!registryKeywords?.length) {
    throw new Error(
      "Missing required plugin metadata: server.json registry keywords",
    );
  }
  const keywords = registryKeywords.map((keyword, index) =>
    requireString(keyword, `server.json registry keyword ${index}`),
  );
  if (new Set(keywords).size !== keywords.length) {
    throw new Error("server.json registry keywords must be unique");
  }
  if (JSON.stringify(packageJson.keywords ?? []) !== JSON.stringify(keywords)) {
    throw new Error(
      "Plugin keyword mismatch between package.json and server.json registry metadata",
    );
  }
  assertCanonicalSkills(skillNames);

  return {
    name,
    version,
    description: requireString(
      packageJson.description,
      "package.json#description",
    ),
    authorName: resolveAuthorName(packageJson.author),
    homepage: requireString(packageJson.homepage, "package.json#homepage"),
    repository: normalizeRepository(packageJson.repository),
    license: requireString(packageJson.license, "package.json#license"),
    keywords,
    remoteMcpUrl: requireString(
      remoteMcpUrl,
      "server.json#remotes[streamable-http].url",
    ),
    skillNames: [...skillNames].sort(),
  };
}

function json(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2);
  const compactShortStringArrays = pretty.replace(
    /\[\n((?:\s+"(?:[^"\\]|\\.)*",?\n)+)\s*\]/g,
    (match: string, body: string): string => {
      const compact = `[${body
        .trim()
        .split("\n")
        .map((line: string): string => line.trim())
        .join(" ")}]`;
      return compact.length <= 80 ? compact : match;
    },
  );
  return `${compactShortStringArrays}\n`;
}

export function renderPluginAssets(
  inputs: PluginAssetInputs,
): GeneratedPluginAsset[] {
  assertCanonicalSkills(inputs.skillNames);

  const sharedManifest = {
    name: inputs.name,
    version: inputs.version,
    description: inputs.description,
    author: { name: inputs.authorName },
    homepage: inputs.homepage,
    repository: inputs.repository,
    license: inputs.license,
    keywords: inputs.keywords,
  };

  return [
    {
      path: ".plugin/plugin.json",
      content: json(sharedManifest),
    },
    {
      path: ".claude-plugin/plugin.json",
      content: json(sharedManifest),
    },
    {
      path: ".claude-plugin/marketplace.json",
      content: json({
        name: "githits-plugins",
        owner: {
          name: inputs.authorName,
          email: "support@githits.com",
        },
        metadata: {
          description: inputs.description,
          version: inputs.version,
        },
        plugins: [
          {
            ...sharedManifest,
            source: {
              source: "url",
              url: "https://github.com/githits-com/githits-cli.git",
            },
            category: "developer-tools",
          },
        ],
      }),
    },
    {
      path: ".codex-plugin/plugin.json",
      content: json({
        ...sharedManifest,
        skills: "./skills/",
        mcpServers: "./.mcp.json",
        interface: {
          displayName: "GitHits",
          shortDescription: inputs.description,
          longDescription:
            "Search public open-source code, documentation, package metadata, vulnerabilities, changelogs, dependencies, and implementation examples.",
          developerName: inputs.authorName,
          category: "Developer Tools",
          capabilities: [
            "Code Search",
            "Documentation Search",
            "Package Research",
          ],
          websiteURL: inputs.homepage,
          defaultPrompt: [
            "Use GitHits to inspect this project's open-source dependencies.",
            "Find source-backed examples for this implementation.",
            "Research package documentation and upgrade risks.",
          ],
        },
      }),
    },
    {
      path: ".cursor-plugin/plugin.json",
      content: json({
        ...sharedManifest,
        skills: "skills",
        mcpServers: ".mcp.json",
        logo: "github-githits.png",
      }),
    },
    {
      path: ".mcp.json",
      content: json({
        mcpServers: {
          githits: {
            type: "http",
            url: inputs.remoteMcpUrl,
          },
        },
      }),
    },
    {
      path: "mcp.json",
      content: json({
        $schema: AGENT_PLUGINS_MCP_SCHEMA_URL,
        mcpServers: {
          githits: {
            type: "streamable-http",
            url: inputs.remoteMcpUrl,
          },
        },
      }),
    },
    {
      path: "gemini-extension.json",
      content: json({
        name: inputs.name,
        version: inputs.version,
        description: inputs.description,
        mcpServers: {
          githits: {
            httpUrl: inputs.remoteMcpUrl,
          },
        },
        contextFileName: "GEMINI.md",
      }),
    },
    {
      path: "plugin.json",
      content: json({
        $schema: AGENT_PLUGINS_SCHEMA_URL,
        ...sharedManifest,
      }),
    },
    {
      path: "mcp_config.json",
      content: json({
        mcpServers: {
          githits: {
            serverUrl: inputs.remoteMcpUrl,
          },
        },
      }),
    },
  ];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function discoverSkillNames(root: string): Promise<string[]> {
  const skillsRoot = join(root, "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skillNames: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      await readFile(join(skillsRoot, entry.name, "SKILL.md"), "utf8");
      skillNames.push(entry.name);
    } catch {
      // Non-skill directories do not belong to the public skill surface.
    }
  }

  return skillNames.sort();
}

export async function generatePluginAssets(
  options: GeneratePluginAssetsOptions = {},
): Promise<GeneratedPluginAsset[]> {
  const root = resolve(
    options.root ?? fileURLToPath(new URL("..", import.meta.url)),
  );
  const packageJson = await readJson<PluginPackageJson>(
    join(root, "package.json"),
  );
  const serverJson = await readJson<PluginServerJson>(
    join(root, "server.json"),
  );
  const skillNames = await discoverSkillNames(root);
  const assets = renderPluginAssets(
    createPluginAssetInputs(packageJson, serverJson, skillNames),
  );

  const stalePaths: string[] = [];
  for (const asset of assets) {
    const outputPath = join(root, asset.path);
    if (options.check) {
      try {
        if ((await readFile(outputPath, "utf8")) !== asset.content) {
          stalePaths.push(asset.path);
        }
      } catch {
        stalePaths.push(asset.path);
      }
      continue;
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, asset.content);
  }

  if (stalePaths.length > 0) {
    throw new Error(
      `Generated plugin assets are stale:\n${stalePaths.map((path) => `- ${path}`).join("\n")}`,
    );
  }

  return assets;
}

function parseArgs(args: string[]): GeneratePluginAssetsOptions {
  const options: GeneratePluginAssetsOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const assets = await generatePluginAssets(options);
  const action = options.check ? "Validated" : "Generated";
  console.error(`${action} ${assets.length} plugin assets.`);
}
