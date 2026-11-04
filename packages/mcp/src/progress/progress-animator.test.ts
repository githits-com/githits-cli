import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { beginAnimatedProgress } from "./progress-animator.js";
import type { McpProgressHook, McpProgressUpdate } from "./relay-receiver.js";

function recorder() {
  const sent: { progress: number; message: string }[] = [];
  return {
    sent,
    emit: (progress: number, message: string) =>
      sent.push({ progress, message }),
  };
}

function liveHook(): McpProgressHook & {
  push?: (update: McpProgressUpdate) => void;
  ended: number;
} {
  const hook = {
    ended: 0,
    push: undefined as ((update: McpProgressUpdate) => void) | undefined,
    begin: async (notify: (update: McpProgressUpdate) => void) => {
      hook.push = notify;
      return {
        headers: {
          "X-GitHits-Progress-Id": "op",
          "X-GitHits-Relay-Id": "relay",
        },
        rejected: () => {},
        end: () => {
          hook.ended += 1;
        },
      };
    },
  };
  return hook;
}

const strictlyIncreasing = (values: number[]) =>
  values.every((value, i) => i === 0 || value > (values[i - 1] ?? -1));

describe("beginAnimatedProgress", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("animates the initial message locally before any live update", async () => {
    const { sent, emit } = recorder();
    const operation = await beginAnimatedProgress(
      undefined,
      emit,
      "Researching…",
      {
        intervalMs: 5,
      },
    );
    jest.advanceTimersByTime(30);
    operation?.end();
    expect(operation?.headers).toEqual({});
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.every((s) => s.message.endsWith(" Researching…"))).toBe(true);
    expect(
      new Set(sent.map((s) => s.message.split(" ")[0])).size,
    ).toBeGreaterThan(1);
    expect(strictlyIncreasing(sent.map((s) => s.progress))).toBe(true);
  });

  it("switches to live messages and keeps progress strictly increasing", async () => {
    const hook = liveHook();
    const { sent, emit } = recorder();
    const operation = await beginAnimatedProgress(
      hook,
      emit,
      "Finding examples…",
      {
        intervalMs: 5,
      },
    );
    jest.advanceTimersByTime(15);
    hook.push?.({
      progress: 1,
      message: "Searching for sources.",
      stage: "searching",
    });
    jest.advanceTimersByTime(15);
    hook.push?.({
      progress: 3,
      message: "Writing the example.",
      stage: "generating",
    });
    jest.advanceTimersByTime(15);
    operation?.end();
    expect(operation?.headers["X-GitHits-Progress-Id"]).toBe("op");
    expect(strictlyIncreasing(sent.map((s) => s.progress))).toBe(true);
    expect(
      sent.some(
        (s) => s.progress === 1 && s.message.endsWith("Searching for sources."),
      ),
    ).toBe(true);
    expect(sent.at(-1)?.message.endsWith("Writing the example.")).toBe(true);
    expect(sent.every((s) => s.progress < 4)).toBe(true);
    expect(hook.ended).toBe(1);
  });

  it("stops all notifications when the call ends", async () => {
    const hook = liveHook();
    const { sent, emit } = recorder();
    const operation = await beginAnimatedProgress(hook, emit, "Researching…", {
      intervalMs: 5,
    });
    operation?.end();
    const count = sent.length;
    hook.push?.({ progress: 2, message: "Late" });
    jest.advanceTimersByTime(25);
    expect(sent).toHaveLength(count);
  });

  it("sends plain live messages when animation is disabled", async () => {
    const hook = liveHook();
    const { sent, emit } = recorder();
    const operation = await beginAnimatedProgress(
      hook,
      emit,
      "Researching…",
      false,
    );
    hook.push?.({ progress: 1, message: "Reading sources." });
    operation?.end();
    expect(sent).toEqual([{ progress: 1, message: "Reading sources." }]);
  });

  it("returns nothing without live progress or animation", async () => {
    const { emit } = recorder();
    expect(
      await beginAnimatedProgress(undefined, emit, "x", false),
    ).toBeUndefined();
  });

  it("keeps the opening message when the backend reports its generic start", async () => {
    const hook = liveHook();
    const { sent, emit } = recorder();
    const operation = await beginAnimatedProgress(
      hook,
      emit,
      "Searching source code and docs…",
      false,
    );
    hook.push?.({ progress: 1, message: "Starting…", stage: "started" });
    hook.push?.({
      progress: 2,
      message: "Searching source code and docs…",
      stage: "searching",
    });
    operation?.end();
    expect(sent).toEqual([
      { progress: 2, message: "Searching source code and docs…" },
    ]);
  });
});
