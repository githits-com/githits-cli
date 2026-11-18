import { describe, expect, it } from "bun:test";
import type { MappedError } from "@githits/mcp/internal";
import { Command } from "commander";
import { registerListCommand } from "../list.js";
import {
  withCliGrepFileRecovery,
  withCliReadFileRecovery,
} from "./code-nav-cli-helpers.js";
import { buildCliReadFileParams } from "./read.js";

describe("CLI path recovery quoting", () => {
  it
    .skipIf(process.platform === "win32")
    .each([
      "src/$(printf PATH_AUDIT_EXPANDED)/",
      "-$(printf PATH_AUDIT_EXPANDED)/",
      " src /",
    ])(
    "preserves the literal suggested list path %s through the shell and CLI parser",
    async (prefix) => {
      const path = `${prefix}missing.ts`;
      const actions: string[] = [];
      for (const code of [
        "FILE_NOT_FOUND",
        "FILE_PATH_EXCLUDED",
        "SOURCE_FILE_INVENTORY_UNKNOWN",
      ] as const) {
        const error: MappedError = {
          code,
          message: "Unavailable path",
          retryable: false,
          details: { filePath: path },
        };
        actions.push(withCliReadFileRecovery(error, path).details!.action!);
        actions.push(withCliGrepFileRecovery(error).details!.action!);
      }
      try {
        buildCliReadFileParams({
          target: { repoUrl: "https://github.com/owner/repo" },
          filePath: prefix,
        });
        throw new Error("Expected directory validation to fail");
      } catch (error) {
        actions.push((error as Error).message);
      }
      for (const action of actions) {
        const start = action.indexOf("githits list <target>");
        expect(start).toBeGreaterThanOrEqual(0);
        const command = action
          .slice(start, action.indexOf("`", start))
          .replace("<target>", "github:owner/repo");
        const child = Bun.spawn(
          ["/bin/sh", "-c", `githits() { printf '%s\\n' "$@"; }; ${command}`],
          {
            env: {},
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const stdout = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        const argv = stdout.trimEnd().split("\n");
        const program = new Command("githits");
        let parsed: { target: string; paths: string[] } | undefined;
        registerListCommand(program).action(
          (target: string, paths: string[]) => {
            parsed = { target, paths };
          },
        );
        await program.parseAsync(argv, { from: "user" });
        expect(parsed).toEqual({
          target: "github:owner/repo",
          paths: [prefix],
        });
      }
    },
  );
});
