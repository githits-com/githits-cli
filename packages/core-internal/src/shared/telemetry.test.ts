import { describe, expect, it } from "bun:test";
import {
  flushTelemetry,
  isTelemetryEnabled,
  resetTelemetryCollectorForTests,
  startTelemetrySpan,
  withTelemetrySpan,
} from "./telemetry.js";

describe("telemetry", () => {
  it("recognises the opt-in env flag", () => {
    expect(isTelemetryEnabled({ GITHITS_TELEMETRY: "1" })).toBe(true);
    expect(isTelemetryEnabled({ GITHITS_TELEMETRY: "true" })).toBe(true);
    expect(isTelemetryEnabled({ GITHITS_TELEMETRY: "0" })).toBe(false);
    expect(isTelemetryEnabled({})).toBe(false);
  });

  it("flushes spans as a summary at exit", () => {
    const writes: string[] = [];
    let nowMs = 0;

    resetTelemetryCollectorForTests({
      env: { GITHITS_TELEMETRY: "1" },
      now: () => nowMs,
      write: (text) => writes.push(text),
    });

    const span = startTelemetrySpan("container.create", { area: "startup" });
    nowMs = 37;
    expect(span).toBeDefined();
    flushTelemetry(0);

    const report = writes.join("");
    expect(report).toContain("[githits telemetry]");
    expect(report).toContain("exit: 0");
    expect(report).toContain("total: 37.0ms");
    expect(report).toContain(
      "container.create: 37.0ms (start +0.0ms, ended-at-exit, area=startup)",
    );
  });

  it("marks failed spans without suppressing the error", async () => {
    const writes: string[] = [];
    let nowMs = 0;

    resetTelemetryCollectorForTests({
      env: { GITHITS_TELEMETRY: "1" },
      now: () => nowMs,
      write: (text) => writes.push(text),
    });

    await expect(
      withTelemetrySpan("pkg-intel.dependencies.request", async () => {
        nowMs = 12;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    nowMs = 20;
    flushTelemetry(1);

    const report = writes.join("");
    expect(report).toContain("exit: 1");
    expect(report).toContain(
      "pkg-intel.dependencies.request: 12.0ms (start +0.0ms, error=true)",
    );
  });
});
