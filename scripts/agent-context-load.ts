import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { buildMcpQuickStart } from "../packages/mcp/src/mcp/instructions.js";
import { getMcpToolDescriptors } from "../packages/mcp/src/mcp/server.js";

/** Public, attributable content only; this is not a provider request format. */
export const contextInventorySchema = z.object({
  schemaVersion: z.literal(1),
  serialization: z.literal("githits-content-inventory-v1"),
  blocks: z.record(z.string(), z.string()),
});

export const contextReplaySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().min(1),
  evidence: z.string().min(1),
  requests: z
    .array(
      z.object({
        label: z.string().min(1),
        repeat: z.number().int().min(1).max(1000).default(1),
        blocks: z.array(z.string()),
      }),
    )
    .min(1),
});

const nonnegativeInteger = z.number().int().nonnegative();
const requestUsageSchema = z.object({
  label: z.string().min(1),
  input: nonnegativeInteger,
  cacheRead: nonnegativeInteger,
  cacheWrite: nonnegativeInteger,
  output: nonnegativeInteger.nullable(),
});

export const contextObservationSchema = z.object({
  schemaVersion: z.literal(1),
  evidence: z.string().min(1),
  host: z.string().min(1),
  model: z.string().min(1),
  inputConvention: z.enum(["inclusive", "uncached-only"]),
  terminalOutputTokens: nonnegativeInteger.optional(),
  requests: z.array(requestUsageSchema).min(1),
});

/**
 * Extract only numeric request usage and model identity, never prompts, paths,
 * session IDs or tool arguments. Input must be a single, explicitly selected run.
 */
export function extractContextObservation(
  host: "codex" | "claude",
  records: unknown[],
): z.infer<typeof contextObservationSchema> {
  const object = z.record(z.string(), z.unknown());
  const requests: Array<z.infer<typeof requestUsageSchema>> = [];
  const models = new Set<string>();
  const claudeMessages = new Map<string, Record<string, unknown>>();
  let claudeTerminal: Record<string, unknown> | undefined;
  const add = (usage: Record<string, unknown>): void => {
    requests.push(
      requestUsageSchema.parse({
        label: `request ${requests.length + 1}`,
        input: usage.input_tokens,
        cacheRead:
          host === "codex"
            ? usage.cached_input_tokens
            : usage.cache_read_input_tokens,
        cacheWrite:
          host === "codex"
            ? usage.cache_write_input_tokens
            : usage.cache_creation_input_tokens,
        output: usage.output_tokens ?? null,
      }),
    );
  };
  for (const record of records) {
    const row = object.parse(record);
    if (host === "codex") {
      if (row.type !== "event_msg" && row.type !== "turn_context") continue;
      const payload = object.parse(row.payload);
      if (row.type === "turn_context" && typeof payload.model === "string")
        models.add(payload.model);
      if (payload.type !== "token_count" || payload.info === null) continue;
      const info = object.parse(payload.info);
      if (info.last_token_usage === null) continue;
      add(object.parse(info.last_token_usage));
    } else if (row.type === "result") {
      if (claudeTerminal)
        throw new Error("Expected one terminal result per Claude stdout");
      claudeTerminal = object.parse(row.usage);
    } else if (row.type === "assistant") {
      const message = object.parse(row.message);
      const id = z.string().min(1).parse(message.id);
      if (typeof message.model === "string") models.add(message.model);
      // A split message repeats usage on thinking, text and tool-use records.
      claudeMessages.set(id, object.parse(message.usage));
    }
  }
  if (host === "claude")
    for (const usage of claudeMessages.values()) add(usage);
  let terminalOutputTokens: number | undefined;
  if (host === "claude") {
    if (claudeTerminal) {
      for (const [field, key] of [
        ["input", "input_tokens"],
        ["cacheRead", "cache_read_input_tokens"],
        ["cacheWrite", "cache_creation_input_tokens"],
      ] as const) {
        const aggregate = nonnegativeInteger.parse(claudeTerminal[key]);
        if (requests.reduce((sum, r) => sum + r[field], 0) !== aggregate) {
          throw new Error(
            "Claude message inputs do not reconcile with terminal usage",
          );
        }
      }
      terminalOutputTokens = nonnegativeInteger.parse(
        claudeTerminal.output_tokens,
      );
    }
    if (
      terminalOutputTokens === undefined ||
      requests.some((r) => r.output === null) ||
      requests.reduce((sum, r) => sum + (r.output ?? 0), 0) !==
        terminalOutputTokens
    ) {
      // Native streaming can emit provisional output_tokens=1. Keep the final
      // aggregate without inventing its distribution across model requests.
      for (const request of requests) request.output = null;
    }
  }
  return contextObservationSchema.parse({
    schemaVersion: 1,
    host: host === "codex" ? "Codex native session" : "Claude Code stream-json",
    model: [...models].join(", ") || "unknown",
    evidence:
      host === "codex"
        ? "Selected native session token_count.last_token_usage events. Model is configured/requested, not provider-resolved. Input includes host context; growth is not isolated tool text."
        : "Selected stream-json assistant message usage, deduplicated by message ID. Cache read/write buckets are additive to input_tokens. No IDs or content exported.",
    inputConvention: host === "codex" ? "inclusive" : "uncached-only",
    ...(terminalOutputTokens === undefined ? {} : { terminalOutputTokens }),
    requests,
  });
}

export interface ObservedUsageReport {
  host: string;
  model: string;
  evidence: string;
  modelRequests: number;
  firstInput: number;
  lastInput: number;
  inputGrowth: number;
  cumulativeInput: number;
  cumulativeCacheRead: number;
  cumulativeCacheWrite: number;
  cumulativeUncachedInput: number;
  cumulativeOutput: number | null;
}

/** Input fixtures contain one observation per request, never split-message copies. */
export function summarizeObservedUsage(input: unknown): ObservedUsageReport {
  const observation = contextObservationSchema.parse(input);
  if (
    observation.terminalOutputTokens !== undefined &&
    observation.requests.every((r) => r.output !== null) &&
    observation.requests.reduce((sum, r) => sum + (r.output ?? 0), 0) !==
      observation.terminalOutputTokens
  ) {
    throw new Error(
      "Per-request output does not reconcile with terminal output",
    );
  }
  const requests = observation.requests.map((request) => {
    const inclusive =
      observation.inputConvention === "inclusive"
        ? request.input
        : request.input + request.cacheRead + request.cacheWrite;
    const uncached = inclusive - request.cacheRead - request.cacheWrite;
    if (uncached < 0) throw new Error("Cache buckets exceed inclusive input");
    return { ...request, inclusive, uncached };
  });
  const firstInput = requests[0]?.inclusive ?? 0;
  const lastInput = requests.at(-1)?.inclusive ?? 0;
  return {
    host: observation.host,
    model: observation.model,
    evidence: observation.evidence,
    modelRequests: requests.length,
    firstInput,
    lastInput,
    inputGrowth: lastInput - firstInput,
    cumulativeInput: requests.reduce((sum, r) => sum + r.inclusive, 0),
    cumulativeCacheRead: requests.reduce((sum, r) => sum + r.cacheRead, 0),
    cumulativeCacheWrite: requests.reduce((sum, r) => sum + r.cacheWrite, 0),
    cumulativeUncachedInput: requests.reduce((sum, r) => sum + r.uncached, 0),
    cumulativeOutput:
      observation.terminalOutputTokens ??
      (requests.some((r) => r.output === null)
        ? null
        : requests.reduce((sum, r) => sum + (r.output ?? 0), 0)),
  };
}

export interface ContentSize {
  unicodeCharacters: number;
  utf16CodeUnits: number;
  utf8Bytes: number;
}

/** Measure exact text without treating a characters-per-token heuristic as usage. */
export function measureContent(text: string): ContentSize {
  return {
    unicodeCharacters: Array.from(text).length,
    utf16CodeUnits: text.length,
    utf8Bytes: Buffer.byteLength(text, "utf8"),
  };
}

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Inventory uses MCP JSON schemas, not host-specific rendered declarations. */
export async function createContextInventory(): Promise<
  z.infer<typeof contextInventorySchema>
> {
  const skill = await readFile(
    new URL("../skills/githits-mcp/SKILL.md", import.meta.url),
    "utf8",
  );
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill);
  if (!frontmatter) throw new Error("Canonical MCP skill has no frontmatter");
  const blocks: Record<string, string> = {
    "skill.frontmatter": frontmatter[1] ?? "",
    "skill.body": skill.slice(frontmatter[0].length),
    "skill.file": skill,
    "bootstrap.stable": buildMcpQuickStart(),
  };
  const descriptors = getMcpToolDescriptors();
  for (const tool of descriptors) {
    blocks[`tool.${tool.name}.definition`] = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(z.object(tool.schema), {
        target: "draft-7",
        io: "input",
      }),
      annotations: tool.annotations,
    });
  }
  blocks["catalog.names"] = descriptors.map((tool) => tool.name).join("\n");
  blocks["catalog.prefix80"] = descriptors
    .map((tool) => `${tool.name}: ${tool.description.slice(0, 80)}`)
    .join("\n");
  blocks["catalog.full"] = JSON.stringify(
    descriptors.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(z.object(tool.schema), {
        target: "draft-7",
        io: "input",
      }),
      annotations: tool.annotations,
    })),
  );
  return {
    schemaVersion: 1,
    serialization: "githits-content-inventory-v1",
    blocks,
  };
}

export interface ContextReplayReport {
  schemaVersion: 1;
  description: string;
  evidence: string;
  limitation: string;
  inventorySha256: string;
  inputTokens: null;
  requests: Array<{
    label: string;
    repeat: number;
    blocks: string[];
    sizePerRequest: ContentSize;
  }>;
  modelRequests: number;
  cumulative: ContentSize;
}

/**
 * Each row explicitly lists content retained in that model request. Repeated
 * references count twice; omission models removal without an implicit lifecycle.
 */
export function replayContext(
  inventoryInput: unknown,
  replayInput: unknown,
): ContextReplayReport {
  const inventory = contextInventorySchema.parse(inventoryInput);
  const replay = contextReplaySchema.parse(replayInput);
  const cumulative: ContentSize = {
    unicodeCharacters: 0,
    utf16CodeUnits: 0,
    utf8Bytes: 0,
  };
  let modelRequests = 0;
  const requests = replay.requests.map((request) => {
    const sizePerRequest: ContentSize = {
      unicodeCharacters: 0,
      utf16CodeUnits: 0,
      utf8Bytes: 0,
    };
    for (const id of request.blocks) {
      if (!Object.hasOwn(inventory.blocks, id))
        throw new Error("Unknown content block");
      const block = inventory.blocks[id] ?? "";
      const size = measureContent(block);
      sizePerRequest.unicodeCharacters += size.unicodeCharacters;
      sizePerRequest.utf16CodeUnits += size.utf16CodeUnits;
      sizePerRequest.utf8Bytes += size.utf8Bytes;
    }
    modelRequests += request.repeat;
    cumulative.unicodeCharacters +=
      sizePerRequest.unicodeCharacters * request.repeat;
    cumulative.utf16CodeUnits += sizePerRequest.utf16CodeUnits * request.repeat;
    cumulative.utf8Bytes += sizePerRequest.utf8Bytes * request.repeat;
    return { ...request, sizePerRequest };
  });
  return {
    schemaVersion: 1,
    description: replay.description,
    evidence: replay.evidence,
    limitation:
      "Attributable content only: excludes host wrappers, hidden instructions, " +
      "conversation, results and cache behavior unless explicitly supplied as blocks. " +
      "JSON definitions are not host-rendered schemas. No token or price estimate.",
    inventorySha256: hashContent(
      JSON.stringify(
        Object.entries(inventory.blocks).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
    ),
    inputTokens: null,
    requests,
    modelRequests,
    cumulative,
  };
}

async function main(args: string[]): Promise<void> {
  const [command, replayPath, inventoryPath] = args;
  if (
    command === "observe" &&
    (replayPath === "codex" || replayPath === "claude") &&
    inventoryPath &&
    args.length === 3
  ) {
    const records: unknown[] = (await readFile(resolve(inventoryPath), "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    process.stdout.write(
      `${JSON.stringify(extractContextObservation(replayPath, records), null, 2)}\n`,
    );
    return;
  }
  if (command === "usage" && replayPath && args.length === 2) {
    process.stdout.write(
      `${JSON.stringify(summarizeObservedUsage(JSON.parse(await readFile(resolve(replayPath), "utf8"))), null, 2)}\n`,
    );
    return;
  }
  if (command === "inventory" && args.length === 1) {
    const inventory = await createContextInventory();
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return;
  }
  if (command === "sizes" && args.length === 1) {
    const inventory = await createContextInventory();
    process.stdout.write(
      `${JSON.stringify(
        Object.fromEntries(
          Object.entries(inventory.blocks).map(([id, value]) => [
            id,
            { ...measureContent(value), sha256: hashContent(value) },
          ]),
        ),
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (command !== "replay" || !replayPath || args.length > 3) {
    throw new Error(
      "Usage: bun scripts/agent-context-load.ts inventory|sizes|observe <codex|claude> <run.jsonl>|usage <observations.json>|replay <replay.json> [inventory.json]",
    );
  }
  const inventory: unknown = inventoryPath
    ? JSON.parse(await readFile(resolve(inventoryPath), "utf8"))
    : await createContextInventory();
  const replay: unknown = JSON.parse(
    await readFile(resolve(replayPath), "utf8"),
  );
  process.stdout.write(
    `${JSON.stringify(replayContext(inventory, replay), null, 2)}\n`,
  );
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch {
    // JSON parser exceptions can embed raw transcript text. Keep that local.
    process.stderr.write(
      "Context measurement failed: check the command, file availability and input schema. Raw input is not printed.\n",
    );
    process.exitCode = 1;
  }
}
