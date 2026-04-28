import { describe, expect, it, mock } from "bun:test";
import { createMockUpdateCheckService } from "../services/test-helpers.js";
import {
  flushUpdateCheckNotice,
  runWithUpdateCheckFlush,
  startUpdateCheckTask,
  startUpdateCheckTaskForInvocation,
} from "./update-check.js";

describe("update-check CLI orchestration", () => {
  it("starts a cancellable update check task", async () => {
    let aborted = false;
    const service = createMockUpdateCheckService({
      checkForUpdate: mock((signal?: AbortSignal) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return Promise.resolve(undefined);
      }),
    });

    const task = startUpdateCheckTask(service);
    task.abort();
    await task.promise;

    expect(service.checkForUpdate).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
    expect(aborted).toBe(true);
  });

  it("prints completed notices to stderr", async () => {
    const service = createMockUpdateCheckService({
      checkForUpdate: mock(() =>
        Promise.resolve({
          currentVersion: "0.2.0",
          latestVersion: "0.3.0",
          updateCommand: "npm i -g githits@latest",
        }),
      ),
    });
    const stderr = { write: mock(() => undefined) };
    const task = startUpdateCheckTask(service);

    await flushUpdateCheckNotice(task, { stderr, timeoutMs: 50 });

    expect(stderr.write).toHaveBeenCalledWith(
      "Update available: githits 0.2.0 -> 0.3.0\nRun: npm i -g githits@latest\n",
    );
  });

  it("does not write when no notice is returned", async () => {
    const service = createMockUpdateCheckService();
    const stderr = { write: mock(() => undefined) };
    const task = startUpdateCheckTask(service);

    await flushUpdateCheckNotice(task, { stderr, timeoutMs: 50 });

    expect(stderr.write).not.toHaveBeenCalled();
  });

  it("aborts pending checks after the post-command budget", async () => {
    let aborted = false;
    const service = createMockUpdateCheckService({
      checkForUpdate: mock(
        (signal?: AbortSignal) =>
          new Promise<undefined>((resolve) => {
            signal?.addEventListener("abort", () => {
              aborted = true;
              resolve(undefined);
            });
          }),
      ),
    });
    const stderr = { write: mock(() => undefined) };
    const task = startUpdateCheckTask(service);

    await flushUpdateCheckNotice(task, { stderr, timeoutMs: 0 });

    expect(aborted).toBe(true);
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it("does not start an update check task for MCP stdio invocations", () => {
    const createService = mock(() => createMockUpdateCheckService());

    const task = startUpdateCheckTaskForInvocation({
      args: ["mcp", "start"],
      env: {},
      stderrIsTTY: true,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      createService,
    });

    expect(task).toBeUndefined();
    expect(createService).not.toHaveBeenCalled();
  });

  it("flushes update notices when the wrapped action throws", async () => {
    const service = createMockUpdateCheckService({
      checkForUpdate: mock(() =>
        Promise.resolve({
          currentVersion: "0.2.0",
          latestVersion: "0.3.0",
          updateCommand: "npm i -g githits@latest",
        }),
      ),
    });
    const stderr = { write: mock(() => undefined) };
    const task = startUpdateCheckTask(service);
    const error = new Error("command failed");

    await expect(
      runWithUpdateCheckFlush(
        async () => {
          throw error;
        },
        task,
        { stderr, timeoutMs: 50 },
      ),
    ).rejects.toBe(error);

    expect(stderr.write).toHaveBeenCalledWith(
      "Update available: githits 0.2.0 -> 0.3.0\nRun: npm i -g githits@latest\n",
    );
  });
});
