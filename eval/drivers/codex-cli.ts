/**
 * OpenAI Codex CLI driver. Verified against codex-cli 0.129.0:
 *
 *   codex exec --sandbox read-only --skip-git-repo-check --ephemeral \
 *     --cd /tmp --ignore-user-config -
 *
 * with the prompt fed via stdin (`-` sentinel).
 *
 * Codex doesn't have a true "no tools" mode (it's a coding agent at
 * heart). We minimize tool use by:
 *   - `--sandbox read-only`     — blocks file writes / shell mutations
 *   - `--cd /tmp`               — empty cwd so nothing meaningful to scan
 *   - `--skip-git-repo-check`   — works outside a git repo
 *   - `--ephemeral`             — no session file accumulation
 *   - `--ignore-user-config`    — don't pull in stray rules/MCP servers
 *
 * No `--ask-for-approval` flag in this version; `--sandbox read-only`
 * already prevents the agent from doing anything that would prompt.
 *
 * Model is left at the user's configured default. Passing `--model`
 * is optional and only meaningful if the caller wants to pin one;
 * doing so may fail on a profile that doesn't have that model
 * available, so the default is "unset". Override via
 * `CodexCliDriverOptions.model` when constructing the driver.
 *
 * Default stdout is the final assistant message in plain text;
 * progress chatter goes to stderr.
 *
 * Subscription auth via `codex login` (saved under `$CODEX_HOME`).
 * If `OPENAI_API_KEY` is set the driver refuses to run so the user
 * isn't accidentally billed per-token.
 *
 * Known quota caveat: ChatGPT Plus/Pro plans cap Codex usage by
 * message/compute, not tokens. A 90+ call eval pass may exceed the
 * weekly quota mid-run. The runner reports the failed cells and
 * continues so the partial signal is still usable.
 */

import { isCommandAvailable, runProcess } from "../run-process.js";
import type { AgentDriver, DriverResponse, SendOptions } from "./types.js";

const DEFAULT_CWD = "/tmp";
const PER_CALL_TIMEOUT_MS = 180_000;
/** Matches the Claude driver — same server key avoids cross-driver surprises. */
const MCP_SERVER_NAME = "githits-eval";

export interface CodexCliDriverOptions {
  /** Override the configured default model. Leave undefined to use codex's own default. */
  model?: string;
  /** Working directory codex runs in. Defaults to /tmp (empty enough). */
  cwd?: string;
}

export function createCodexCliDriver(
  opts: CodexCliDriverOptions = {},
): AgentDriver {
  const cwd = opts.cwd ?? DEFAULT_CWD;
  return {
    name: "codex",
    async available() {
      if (!(await isCommandAvailable("codex"))) {
        return { ok: false, reason: "`codex` binary not found on PATH" };
      }
      if (process.env.OPENAI_API_KEY) {
        return {
          ok: false,
          reason:
            "OPENAI_API_KEY is set; unset it so the harness uses subscription auth (zero cost)",
        };
      }
      return { ok: true };
    },
    async send(
      prompt: string,
      sendOpts?: SendOptions,
    ): Promise<DriverResponse> {
      const startedAt = Date.now();
      const cmd: string[] = ["codex", "exec"];
      if (opts.model) cmd.push("--model", opts.model);
      cmd.push(
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--cd",
        cwd,
      );
      if (sendOpts?.mcp) {
        // Codex configures MCP servers via inline TOML overrides on `-c`.
        // `--ignore-user-config` (above) keeps the user's MCP servers out,
        // and these `-c` overrides add only our test server.
        const tomlStr = (v: string) => JSON.stringify(v);
        cmd.push(
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.command=${tomlStr("bun")}`,
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.args=["run",${tomlStr(sendOpts.mcp.serverScriptPath)}]`,
        );
        const envEntries = [
          `EVAL_MCP_STATE_FILE=${tomlStr(sendOpts.mcp.stateFilePath)}`,
          ...Object.entries(sendOpts.mcp.extraEnv ?? {}).map(
            ([key, value]) => `${key}=${tomlStr(value)}`,
          ),
        ];
        cmd.push(
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.env={${envEntries.join(",")}}`,
        );
      }
      cmd.push("-");
      const result = await runProcess({
        cmd,
        stdin: prompt,
        timeoutMs: PER_CALL_TIMEOUT_MS,
      });
      const durationMs = Date.now() - startedAt;

      if (result.exitCode !== 0) {
        return {
          response: "",
          durationMs,
          stderr: result.stderr || `codex exited with code ${result.exitCode}`,
        };
      }

      return {
        response: result.stdout.trim(),
        durationMs,
        stderr: result.stderr || undefined,
      };
    },
  };
}
