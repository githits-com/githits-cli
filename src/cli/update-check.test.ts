import { describe, expect, it, mock } from "bun:test";
import { createMockUpdateCheckService } from "../services/test-helpers.js";
import {
  enforceCachedRequiredUpdateForInvocation,
  flushRequiredUpdateRefresh,
  flushUpdateCheckNotice,
  runWithUpdateCheckFlush,
  startRequiredUpdateRefreshTask,
  startRequiredUpdateRefreshTaskForInvocation,
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

  it("starts required update refresh task for MCP stdio invocations", () => {
    const createService = mock(() => createMockUpdateCheckService());

    const task = startRequiredUpdateRefreshTaskForInvocation({
      args: ["mcp", "start"],
      env: {},
      createService,
    });

    expect(task).toBeDefined();
    expect(createService).toHaveBeenCalled();
    task?.abort();
  });

  it("flushes required update refresh task without writing notices", async () => {
    const service = createMockUpdateCheckService({
      refreshRequiredUpdateStatus: mock(() => Promise.resolve()),
    });
    const task = startRequiredUpdateRefreshTask(service);

    await flushRequiredUpdateRefresh(task, { timeoutMs: 50 });

    expect(service.refreshRequiredUpdateStatus).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
  });

  it("enforces cached required update with terminal output", async () => {
    const service = createMockUpdateCheckService({
      getRequiredUpdateNotice: mock(() =>
        Promise.resolve({
          currentVersion: "0.2.0",
          latestKnownVersion: "0.3.0",
          reason: "Backend protocol changed",
          updateCommand: "npm i -g githits@latest",
        }),
      ),
    });
    const stderr = { write: mock(() => undefined) };
    const exit = mock((code: number) => {
      throw new Error(`exit ${code}`);
    }) as (code: number) => never;

    await expect(
      enforceCachedRequiredUpdateForInvocation({
        args: ["example", "query"],
        env: {},
        createService: () => service,
        stderr,
        exit,
      }),
    ).rejects.toThrow("exit 1");

    expect(stderr.write).toHaveBeenCalledWith(
      "Update required: Backend protocol changed\n\nInstalled githits 0.2.0 is no longer supported.\nLatest known version: 0.3.0\nUpdate with:\n  npm i -g githits@latest\n",
    );
  });

  it("enforces cached required update with JSON output", async () => {
    const service = createMockUpdateCheckService({
      getRequiredUpdateNotice: mock(() =>
        Promise.resolve({
          currentVersion: "0.2.0",
          latestKnownVersion: "0.3.0",
          reason: "Backend protocol changed",
          updateCommand: "npm i -g githits@latest",
        }),
      ),
    });
    const stderr = { write: mock(() => undefined) };
    const exit = mock((code: number) => {
      throw new Error(`exit ${code}`);
    }) as (code: number) => never;

    await expect(
      enforceCachedRequiredUpdateForInvocation({
        args: ["pkg", "info", "npm:express", "--json"],
        env: {},
        createService: () => service,
        stderr,
        exit,
      }),
    ).rejects.toThrow("exit 1");

    const payload = JSON.parse(
      (stderr.write as ReturnType<typeof mock>).mock.calls[0]?.[0] as string,
    );
    expect(payload).toEqual({
      error: "Update required: Backend protocol changed",
      code: "UPDATE_REQUIRED",
      retryable: false,
      details: {
        currentVersion: "0.2.0",
        latestKnownVersion: "0.3.0",
        updateCommand: "npm i -g githits@latest",
        reason: "Backend protocol changed",
      },
    });
  });

  it("does not enforce cached required update for help", async () => {
    const createService = mock(() => createMockUpdateCheckService());
    const stderr = { write: mock(() => undefined) };
    const exit = mock(() => {
      throw new Error("exit");
    }) as (code: number) => never;

    await enforceCachedRequiredUpdateForInvocation({
      args: ["--help"],
      env: {},
      createService,
      stderr,
      exit,
    });

    expect(createService).not.toHaveBeenCalled();
    expect(stderr.write).not.toHaveBeenCalled();
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
