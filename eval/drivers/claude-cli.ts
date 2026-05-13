/**
 * Claude Code CLI driver. Shells out to:
 *
 *   claude -p --tools "" --model <id> --output-format json "<prompt>"
 *
 * - `--tools ""` disables all tool use (no Bash, Read, Edit, etc.) so
 *   the response is pure chat completion.
 * - `--output-format json` returns `{ result, session_id, usage, total_cost_usd }`
 *   from which we pull `result`.
 * - Subscription auth works automatically when the user has run
 *   `claude login`. We refuse to run if `ANTHROPIC_API_KEY` is set,
 *   since that would route through the API at per-token cost.
 * - `total_cost_usd` in the response reports what the call *would* cost
 *   on the API. Under subscription auth the user pays $0 marginal cost
 *   regardless of that number.
 *
 * Note: an earlier draft used `--bare`, but bare mode skips OAuth and
 * requires `ANTHROPIC_API_KEY` — incompatible with subscription auth.
 * The slight startup overhead of loading the full Claude Code config
 * (plugins, hooks, MCP entries) is acceptable for an eval that runs
 * occasionally and locally.
 *
 * Temperature is not exposed via the CLI; the harness accepts that
 * nondeterminism. See `docs/implementation/EVAL_HARNESS.md`.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCommandAvailable, runProcess } from "../run-process.js";
import type { AgentDriver, DriverResponse, SendOptions } from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const PER_CALL_TIMEOUT_MS = 120_000;
/**
 * Server key under `mcpServers` in the generated MCP config. Using a
 * unique key (`githits-eval` rather than `githits`) prevents accidental
 * collision with the user's installed real `githits` MCP server.
 * Claude's `--strict-mcp-config` already isolates from user config,
 * but Codex has no equivalent — keeping the name unique is belt and
 * suspenders.
 */
const MCP_SERVER_NAME = "githits-eval";
const MCP_TOOL_FQN = `mcp__${MCP_SERVER_NAME}__pkg_vulns`;

export interface ClaudeCliDriverOptions {
  model?: string;
}

export function createClaudeCliDriver(
  opts: ClaudeCliDriverOptions = {},
): AgentDriver {
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    name: "claude",
    async available() {
      if (!(await isCommandAvailable("claude"))) {
        return { ok: false, reason: "`claude` binary not found on PATH" };
      }
      if (process.env.ANTHROPIC_API_KEY) {
        return {
          ok: false,
          reason:
            "ANTHROPIC_API_KEY is set; unset it so the harness uses subscription auth (zero cost)",
        };
      }
      return { ok: true };
    },
    async send(
      prompt: string,
      sendOpts?: SendOptions,
    ): Promise<DriverResponse> {
      const startedAt = Date.now();
      const cmd: string[] = [
        "claude",
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
      ];
      let envOverrides: Record<string, string | undefined> | undefined;
      let cwd: string | undefined;

      if (sendOpts?.mcp) {
        const mcpConfigPath = writeMcpConfig(sendOpts.mcp.serverScriptPath, {
          EVAL_MCP_STATE_FILE: sendOpts.mcp.stateFilePath,
          ...(sendOpts.mcp.extraEnv ?? {}),
        });
        cmd.push(
          "--mcp-config",
          mcpConfigPath,
          "--strict-mcp-config",
          "--allowedTools",
          MCP_TOOL_FQN,
          "--permission-mode",
          "bypassPermissions",
        );
        envOverrides = { EVAL_MCP_STATE_FILE: sendOpts.mcp.stateFilePath };
      } else if (sendOpts?.skills) {
        const mcpConfigPath = writeEmptyMcpConfig();
        cmd.push(
          "--mcp-config",
          mcpConfigPath,
          "--strict-mcp-config",
          "--permission-mode",
          "bypassPermissions",
          "--setting-sources",
          "project",
        );
        envOverrides = {
          EVAL_MCP_STATE_FILE: sendOpts.skills.stateFilePath,
          PATH: `${sendOpts.skills.binDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
          ...(sendOpts.skills.extraEnv ?? {}),
        };
        cwd = sendOpts.skills.workspaceDir;
      } else {
        cmd.push("--tools", "");
      }
      cmd.push(prompt);

      const result = await runProcess({
        cmd,
        cwd,
        timeoutMs: PER_CALL_TIMEOUT_MS,
        env: envOverrides,
      });
      const durationMs = Date.now() - startedAt;

      if (result.exitCode !== 0) {
        return {
          response: "",
          durationMs,
          stderr: result.stderr || `claude exited with code ${result.exitCode}`,
        };
      }

      try {
        const parsed = JSON.parse(result.stdout) as {
          result?: string;
          is_error?: boolean;
        };
        if (parsed.is_error === true) {
          return {
            response: "",
            durationMs,
            stderr: `claude reported is_error: ${parsed.result ?? "(no message)"}`,
          };
        }
        return {
          response: typeof parsed.result === "string" ? parsed.result : "",
          durationMs,
          stderr: result.stderr || undefined,
        };
      } catch (err) {
        return {
          response: "",
          durationMs,
          stderr: `failed to parse claude JSON output: ${
            err instanceof Error ? err.message : String(err)
          }\n${result.stdout.slice(0, 500)}`,
        };
      }
    },
  };
}

function writeEmptyMcpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-empty-mcp-"));
  const path = join(dir, "mcp.json");
  writeFileSync(path, JSON.stringify({ mcpServers: {} }), "utf8");
  return path;
}

/**
 * Write a temporary MCP config JSON pointing Claude at our mock server.
 * Returns the absolute path so the caller can pass it to `--mcp-config`.
 *
 * The config is regenerated per call so each spawn gets a fresh
 * tempfile — avoids any potential racing on shared paths and keeps the
 * `EVAL_MCP_STATE_FILE` env var threaded through to the child.
 */
function writeMcpConfig(
  serverScriptPath: string,
  env: Record<string, string>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-mcp-"));
  const path = join(dir, "mcp.json");
  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: "bun",
        args: ["run", serverScriptPath],
        env,
      },
    },
  };
  writeFileSync(path, JSON.stringify(config), "utf8");
  return path;
}
