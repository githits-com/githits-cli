import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { debugLog } from "./debug-log.js";

describe("debugLog", () => {
  const originalEnv = process.env.GITHITS_DEBUG;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true as never,
    );
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalEnv === undefined) delete process.env.GITHITS_DEBUG;
    else process.env.GITHITS_DEBUG = originalEnv;
  });

  it("emits nothing when GITHITS_DEBUG is unset", () => {
    delete process.env.GITHITS_DEBUG;
    debugLog("code-nav", { foo: "bar" });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits nothing when GITHITS_DEBUG is empty", () => {
    process.env.GITHITS_DEBUG = "";
    debugLog("code-nav", { foo: "bar" });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits for the requested area when GITHITS_DEBUG names it exactly", () => {
    process.env.GITHITS_DEBUG = "code-nav";
    debugLog("code-nav", { foo: "bar" });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const call = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(call.trimEnd());
    expect(parsed.area).toBe("code-nav");
    expect(parsed.foo).toBe("bar");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits when area is in a comma-separated GITHITS_DEBUG scope list", () => {
    process.env.GITHITS_DEBUG = "auth,code-nav,telemetry";
    debugLog("code-nav", {});
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("skips when area is not in the scope list", () => {
    process.env.GITHITS_DEBUG = "auth,telemetry";
    debugLog("code-nav", {});
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("emits for non-sensitive areas when GITHITS_DEBUG=*", () => {
    process.env.GITHITS_DEBUG = "*";
    debugLog("code-nav", {});
    debugLog("auth", {});
    debugLog("anything", {});
    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it("does not enable explicit-only wire areas when GITHITS_DEBUG=*", () => {
    process.env.GITHITS_DEBUG = "*";
    debugLog("code-nav-wire", { foo: "bar" });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("still emits for explicit-only wire areas when named directly", () => {
    process.env.GITHITS_DEBUG = "code-nav-wire";
    debugLog("code-nav-wire", { foo: "bar" });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("serialises payload contents as JSON on a single line", () => {
    process.env.GITHITS_DEBUG = "code-nav";
    debugLog("code-nav", {
      code: "NOT_FOUND",
      detailKeys: ["availableVersions"],
      count: 3,
    });
    const call = stderrSpy.mock.calls[0]?.[0] as string;
    expect(call.endsWith("\n")).toBe(true);
    // One newline total — single-line emission.
    expect(call.split("\n").filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(call);
    expect(parsed.code).toBe("NOT_FOUND");
    expect(parsed.detailKeys).toEqual(["availableVersions"]);
    expect(parsed.count).toBe(3);
  });

  it("falls back to a marker line when the payload is not serialisable", () => {
    process.env.GITHITS_DEBUG = "code-nav";
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    debugLog("code-nav", circular);
    const call = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(call);
    expect(parsed.area).toBe("code-nav");
    expect(parsed.error).toContain("not serialisable");
  });
});
