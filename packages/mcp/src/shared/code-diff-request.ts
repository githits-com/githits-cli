import type {
  CodeDiffParams,
  CodeNavigationTarget,
} from "@githits/core-internal";
import { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";
import { InvalidPackageSpecError, KNOWN_REGISTRIES } from "./package-spec.js";

export type CodeDiffView = "patch" | "stat" | "name-only" | "name-status";

export interface CodeDiffRequestInput {
  target?: string;
  repoUrl?: string;
  range: string;
  view?: CodeDiffView;
  pathGlob?: string;
  maxFiles?: number;
  maxPatchBytes?: number;
}

export interface CodeDiffMcpPackageTarget {
  registry: string;
  package_name: string;
}

export interface CodeDiffMcpRepositoryTarget {
  repo_url: string;
}

export type CodeDiffMcpTarget =
  | string
  | CodeDiffMcpPackageTarget
  | CodeDiffMcpRepositoryTarget;

export interface CodeDiffMcpRequestInput {
  target: CodeDiffMcpTarget;
  from: string;
  to: string;
  view?: CodeDiffView;
  pathGlob?: string;
  maxFiles?: number;
  maxPatchBytes?: number;
}

export interface CodeDiffRequestBuildResult {
  params: CodeDiffParams;
  view: CodeDiffView;
}

const VIEW_TO_MODE: Record<CodeDiffView, CodeDiffParams["mode"]> = {
  patch: "patches",
  stat: "stats",
  "name-only": "inventory",
  "name-status": "inventory",
};

const MAX_PATH_GLOB_BYTES = 1024;
export const CODE_DIFF_MAX_FILES_MIN = 1;
export const CODE_DIFF_MAX_FILES_MAX = 300;
export const CODE_DIFF_MAX_PATCH_BYTES_MIN = 1024;
export const CODE_DIFF_MAX_PATCH_BYTES_MAX = 2_097_152;

export function buildCodeDiffParams(
  input: CodeDiffRequestInput,
): CodeDiffRequestBuildResult {
  const target = buildTarget(input);
  const { from, to } = parseRange(input.range);
  return buildCodeDiffParamsFromParts(target, from, to, input);
}

/** Build CodeDiff params from MCP's separate endpoints and target union. */
export function buildCodeDiffMcpParams(
  input: CodeDiffMcpRequestInput,
): CodeDiffRequestBuildResult {
  const target = buildMcpTarget(input.target);
  const from = normaliseMcpEndpoint(input.from, "from");
  const to = normaliseMcpEndpoint(input.to, "to");
  return buildCodeDiffParamsFromParts(target, from, to, input);
}

function buildCodeDiffParamsFromParts(
  target: CodeDiffParams["target"],
  from: string,
  to: string,
  input: Pick<
    CodeDiffRequestInput,
    "view" | "pathGlob" | "maxFiles" | "maxPatchBytes"
  >,
): CodeDiffRequestBuildResult {
  const view = normaliseView(input.view);
  const pathGlob = normalisePathGlob(input.pathGlob);
  const maxFiles = normaliseIntegerOption(
    input.maxFiles,
    "maxFiles",
    CODE_DIFF_MAX_FILES_MIN,
    CODE_DIFF_MAX_FILES_MAX,
  );
  const maxPatchBytes = normaliseIntegerOption(
    input.maxPatchBytes,
    "maxPatchBytes",
    CODE_DIFF_MAX_PATCH_BYTES_MIN,
    CODE_DIFF_MAX_PATCH_BYTES_MAX,
  );

  if (maxPatchBytes !== undefined && view !== "patch") {
    throw invalid(
      "`maxPatchBytes` is valid only when the CodeDiff view is `patch`.",
    );
  }

  const options = buildOptions({ maxFiles, maxPatchBytes, pathGlob });
  const params: CodeDiffParams = {
    target,
    from,
    to,
    mode: VIEW_TO_MODE[view],
  };
  if (options !== undefined) params.options = options;

  return { params, view };
}

function buildTarget(input: CodeDiffRequestInput): CodeDiffParams["target"] {
  const hasTarget = input.target !== undefined;
  const hasRepoUrl = input.repoUrl !== undefined;

  if (hasTarget && hasRepoUrl) {
    throw invalid("Provide either `target` or `repoUrl`, not both.");
  }
  if (!hasTarget && !hasRepoUrl) {
    throw invalid("Provide exactly one of `target` or `repoUrl`.");
  }

  const raw = hasTarget ? input.target : input.repoUrl;
  if (typeof raw !== "string") {
    throw invalid("CodeDiff target must be a string.");
  }

  return buildTargetFromRaw(raw, hasTarget ? "target" : "repoUrl");
}

function buildMcpTarget(raw: CodeDiffMcpTarget): CodeDiffParams["target"] {
  if (typeof raw === "string") {
    return buildTargetFromRaw(raw, "target");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(
      "CodeDiff target must be a compact target string or a package/repository object.",
    );
  }
  const object = raw as unknown as Record<string, unknown>;

  const hasRegistry = Object.hasOwn(object, "registry");
  const hasPackageName = Object.hasOwn(object, "package_name");
  const hasRepoUrl = Object.hasOwn(object, "repo_url");
  if (hasRepoUrl && (hasRegistry || hasPackageName)) {
    throw invalid(
      "CodeDiff target cannot combine package and repository fields.",
    );
  }
  if (hasRegistry || hasPackageName) {
    if (!hasRegistry || !hasPackageName) {
      throw invalid(
        "CodeDiff package target must include `registry` and `package_name`.",
      );
    }
    if (
      Object.keys(object).some(
        (key) => key !== "registry" && key !== "package_name",
      )
    ) {
      throw invalid(
        "CodeDiff package target may contain only `registry` and `package_name`.",
      );
    }
    if (
      typeof object.registry !== "string" ||
      typeof object.package_name !== "string" ||
      !object.registry.trim() ||
      !object.package_name.trim()
    ) {
      throw invalid(
        "CodeDiff package target `registry` and `package_name` must not be empty.",
      );
    }
    return buildTargetFromRaw(
      `${object.registry}:${object.package_name}`,
      "mcpPackage",
    );
  }
  if (hasRepoUrl) {
    if (Object.keys(object).some((key) => key !== "repo_url")) {
      throw invalid("CodeDiff repository target may contain only `repo_url`.");
    }
    if (typeof object.repo_url !== "string" || !object.repo_url.trim()) {
      throw invalid("CodeDiff repository target `repo_url` must not be empty.");
    }
    return buildTargetFromRaw(object.repo_url, "mcpRepository");
  }
  throw invalid(
    "CodeDiff target must be a compact string or include package `registry` + `package_name` or repository `repo_url`.",
  );
}

type CodeDiffTargetSource =
  | "target"
  | "repoUrl"
  | "mcpPackage"
  | "mcpRepository";

function buildTargetFromRaw(
  raw: string,
  source: CodeDiffTargetSource,
): CodeDiffParams["target"] {
  const parsed = parseTarget(raw);
  if ((source === "target" || source === "mcpPackage") && parsed.version) {
    throw invalid(
      source === "target"
        ? "Package targets must not include a version; put both versions in `range`."
        : "Package targets must not include a version; put both versions in the comparison endpoints.",
    );
  }
  if (parsed.gitRef !== undefined) {
    throw invalid(
      source === "repoUrl"
        ? "Repository targets must not include a ref; put both refs in `range`."
        : "Repository targets must not include a ref; put both refs in the comparison endpoints.",
    );
  }

  const hasPackageKeys =
    Object.hasOwn(parsed, "registry") || Object.hasOwn(parsed, "packageName");
  const hasRepoKey = Object.hasOwn(parsed, "repoUrl");
  if ((source === "repoUrl" || source === "mcpRepository") && hasPackageKeys) {
    throw invalid("`repoUrl` must identify a repository target.");
  }
  if (hasPackageKeys && hasRepoKey) {
    throw invalid(
      "CodeDiff target cannot combine package and repository keys.",
    );
  }
  if (hasPackageKeys) {
    if (
      !Object.hasOwn(parsed, "registry") ||
      !Object.hasOwn(parsed, "packageName") ||
      parsed.registry === undefined ||
      parsed.packageName === undefined
    ) {
      throw invalid(
        "CodeDiff package target must include a registry and name.",
      );
    }
    return {
      registry: parsed.registry,
      packageName: parsed.packageName,
    };
  }
  if (hasRepoKey && parsed.repoUrl !== undefined) {
    if (source === "mcpPackage") {
      throw invalid("CodeDiff package target must identify a package.");
    }
    return { repoUrl: parsed.repoUrl };
  }
  if (source === "mcpRepository") {
    throw invalid("CodeDiff repository target must identify a repository.");
  }
  throw invalid("CodeDiff target must be a package or repository target.");
}

function parseTarget(raw: string): CodeNavigationTarget {
  try {
    return parseCodeNavigationTargetSpec(raw);
  } catch {
    throw invalid(
      `Invalid CodeDiff target. Expected an unversioned package target \`<registry>:<name>\` (for example \`npm:express\`; supported registries: ${KNOWN_REGISTRIES.join(", ")}) or an unversioned repository target (for example \`github:expressjs/express\`).`,
    );
  }
}

function parseRange(raw: string): { from: string; to: string } {
  if (typeof raw !== "string") {
    throw invalid("CodeDiff range must be a string in the form `from..to`.");
  }
  const range = raw.trim();
  if (range.includes("...")) {
    throw invalid(
      "CodeDiff range must use one `from..to` separator, not `...`.",
    );
  }

  const separator = range.indexOf("..");
  if (separator === -1 || range.indexOf("..", separator + 2) !== -1) {
    throw invalid(
      "CodeDiff range must contain exactly one `from..to` separator.",
    );
  }

  const from = range.slice(0, separator).trim();
  const to = range.slice(separator + 2).trim();
  if (!from || !to) {
    throw invalid("CodeDiff range endpoints must not be empty.");
  }
  return { from, to };
}

function normaliseMcpEndpoint(raw: string, name: "from" | "to"): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalid(`CodeDiff ${name} endpoint must not be empty.`);
  }
  return raw.trim();
}

function normaliseView(raw: CodeDiffView | undefined): CodeDiffView {
  if (raw === undefined) return "patch";
  if (typeof raw === "string" && Object.hasOwn(VIEW_TO_MODE, raw)) {
    return raw;
  }
  throw invalid(
    "CodeDiff view must be patch, stat, name-only, or name-status.",
  );
}

function normalisePathGlob(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw invalid("`pathGlob` must be a string when supplied.");
  }

  const pathGlob = raw;
  if (pathGlob.length === 0) {
    throw invalid("`pathGlob` must not be empty when supplied.");
  }
  if (hasInvalidUtf16(pathGlob)) {
    throw invalid("`pathGlob` must be valid UTF-8.");
  }
  if (new TextEncoder().encode(pathGlob).byteLength > MAX_PATH_GLOB_BYTES) {
    throw invalid(
      `\`pathGlob\` must be at most ${MAX_PATH_GLOB_BYTES} UTF-8 bytes.`,
    );
  }

  validatePathGlobGrammar(pathGlob);
  return pathGlob;
}

interface GlobToken {
  char: string;
  escaped: boolean;
}

function validatePathGlobGrammar(pathGlob: string): void {
  if (
    pathGlob === ":" ||
    pathGlob.startsWith(":(") ||
    pathGlob.startsWith(":/") ||
    pathGlob.startsWith(":!") ||
    pathGlob.startsWith(":^")
  ) {
    throw invalid(
      "`pathGlob` does not support Git pathspec magic; pass one bounded glob.",
    );
  }

  const components: GlobToken[][] = [];
  let component: GlobToken[] = [];
  const characters = Array.from(pathGlob);

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === undefined) break;
    if (character === "/") {
      addGlobComponent(components, component);
      component = [];
      continue;
    }
    if (character === "\\") {
      const escaped = characters[index + 1];
      if (escaped === undefined || escaped === "/") {
        throw invalid(
          "`pathGlob` backslashes must escape one following non-slash character.",
        );
      }
      component.push({ char: escaped, escaped: true });
      index += 1;
      continue;
    }
    if (
      character === "[" ||
      character === "]" ||
      character === "{" ||
      character === "}" ||
      character === "!"
    ) {
      throw invalid(
        "`pathGlob` does not support unescaped brackets, braces, or `!`.",
      );
    }
    component.push({ char: character, escaped: false });
  }
  addGlobComponent(components, component);

  for (const tokens of components) {
    const isGlobstar =
      tokens.length === 2 &&
      tokens.every(({ char, escaped }) => char === "*" && !escaped);
    if (isGlobstar) continue;

    let previous: GlobToken | undefined;
    for (const token of tokens) {
      if (
        previous?.char === "*" &&
        !previous.escaped &&
        token.char === "*" &&
        !token.escaped
      ) {
        throw invalid(
          "`pathGlob` allows adjacent stars only as an exact `**` component.",
        );
      }
      previous = token;
    }
  }
}

function addGlobComponent(
  components: GlobToken[][],
  component: GlobToken[],
): void {
  if (component.length === 0) {
    throw invalid(
      "`pathGlob` must use non-empty repository-relative components.",
    );
  }
  const literal = component.map(({ char }) => char).join("");
  if (literal === "." || literal === "..") {
    throw invalid("`pathGlob` must not contain `.` or `..` components.");
  }
  components.push(component);
}

function hasInvalidUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function normaliseIntegerOption(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalid(
      `\`${name}\` must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function buildOptions(input: {
  maxFiles: number | undefined;
  maxPatchBytes: number | undefined;
  pathGlob: string | undefined;
}): CodeDiffParams["options"] {
  if (
    input.maxFiles === undefined &&
    input.maxPatchBytes === undefined &&
    input.pathGlob === undefined
  ) {
    return undefined;
  }
  const options: NonNullable<CodeDiffParams["options"]> = {};
  if (input.maxFiles !== undefined) options.maxFiles = input.maxFiles;
  if (input.maxPatchBytes !== undefined) {
    options.maxPatchBytes = input.maxPatchBytes;
  }
  if (input.pathGlob !== undefined) options.pathGlob = input.pathGlob;
  return options;
}

function invalid(message: string): InvalidPackageSpecError {
  return new InvalidPackageSpecError(message);
}
