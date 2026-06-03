import { describe, expect, it } from "bun:test";
import { buildUnifiedSearchParams } from "./unified-search-request.js";

describe("buildUnifiedSearchParams", () => {
  it("applies numeric defaults and keeps raw query when no structured qualifiers", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "router middleware",
    });

    expect(built.rawQuery).toBe("router middleware");
    expect(built.compiledQuery).toBe("router middleware");
    expect(built.params.filters).toBeUndefined();
    expect(built.params.limit).toBe(10);
    expect(built.params.offset).toBe(0);
    expect(built.params.waitTimeoutMs).toBe(20_000);
  });

  it("does not override explicit fileIntent", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "router middleware",
      fileIntent: "TEST",
    });

    expect(built.params.filters).toEqual({ fileIntent: "TEST" });
  });

  it("leaves fileIntent unset for explicit docs-only searches", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "routing",
      sources: ["DOCS"],
    });

    expect(built.params.filters).toBeUndefined();
  });

  it("strips code and symbol filters from explicit docs-only searches", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "routing",
      sources: ["DOCS"],
      kind: "FUNCTION",
      category: "CALLABLE",
      fileIntent: "PRODUCTION",
      publicOnly: true,
      pathPrefix: "docs/",
    });

    expect(built.params.filters).toEqual({ pathPrefix: "docs/" });
  });

  it("does not invent fileIntent when selected sources include code search", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "routing",
      sources: ["DOCS", "CODE"],
    });

    expect(built.params.filters).toBeUndefined();
  });

  it("keeps code and symbol filters when selected sources include code search", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "routing",
      sources: ["DOCS", "CODE"],
      kind: "FUNCTION",
      category: "CALLABLE",
      fileIntent: "PRODUCTION",
      publicOnly: true,
    });

    expect(built.params.filters).toEqual({
      kind: "FUNCTION",
      category: "CALLABLE",
      fileIntent: "PRODUCTION",
      publicOnly: true,
    });
  });

  it("compiles structured name and language into AND-ed query qualifiers", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: '"body parser" OR multer',
      name: "createServer",
      language: "typescript",
    });

    expect(built.compiledQuery).toBe(
      '("body parser" OR multer) AND (name:createServer AND lang:typescript)',
    );
  });

  it("quotes qualifier values with spaces and reserved characters", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "router",
      name: 'foo "bar"',
      language: "c++ lang",
    });

    expect(built.compiledQuery).toContain('name:"foo \\"bar\\""');
    expect(built.compiledQuery).toContain('lang:"c++ lang"');
  });

  it("builds native filters from structured inputs", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "handler",
      kind: "FUNCTION",
      category: "CALLABLE",
      pathPrefix: "src/",
      fileIntent: "PRODUCTION",
      publicOnly: true,
    });

    expect(built.params.filters).toEqual({
      kind: "FUNCTION",
      category: "CALLABLE",
      pathPrefix: "src/",
      fileIntent: "PRODUCTION",
      publicOnly: true,
    });
  });

  it("treats publicOnly false as absent", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "handler",
      publicOnly: false,
    });

    expect(built.params.filters).toBeUndefined();
  });

  it("passes through allowPartialResults without changing the default", () => {
    const defaulted = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "router",
    });
    expect(defaulted.params.allowPartialResults).toBeUndefined();

    const explicit = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      query: "router",
      allowPartialResults: true,
    });
    expect(explicit.params.allowPartialResults).toBe(true);
  });

  it("dedupes exact duplicate targets while preserving order", () => {
    const built = buildUnifiedSearchParams({
      targets: [
        { registry: "NPM", packageName: "express" },
        { registry: "NPM", packageName: "express" },
        { registry: "NPM", packageName: "koa" },
      ],
      query: "router",
    });

    expect(built.params.targets).toEqual([
      { registry: "NPM", packageName: "express" },
      { registry: "NPM", packageName: "koa" },
    ]);
  });

  it("treats an empty targets array as absent when target is provided", () => {
    const built = buildUnifiedSearchParams({
      target: { registry: "NPM", packageName: "express" },
      targets: [],
      query: "router",
    });

    expect(built.params.targets).toEqual([
      { registry: "NPM", packageName: "express" },
    ]);
  });

  it("accepts mixed package and repo targets", () => {
    const built = buildUnifiedSearchParams({
      targets: [
        { registry: "NPM", packageName: "express" },
        { repoUrl: "https://github.com/expressjs/express", gitRef: "main" },
      ],
      query: "router",
    });

    expect(built.params.targets).toEqual([
      { registry: "NPM", packageName: "express" },
      { repoUrl: "https://github.com/expressjs/express", gitRef: "main" },
    ]);
  });
});
