import { describe, expect, it } from "bun:test";
import { configureProxyAwareFetch, hasProxyEnv } from "./proxy-fetch.js";

describe("hasProxyEnv", () => {
  it("returns false when no proxy variables are set", () => {
    const env = {};
    expect(hasProxyEnv(env)).toBe(false);
  });

  it("returns true when HTTPS_PROXY is set", () => {
    const env = { HTTPS_PROXY: "http://proxy.example.com:8080" };
    expect(hasProxyEnv(env)).toBe(true);
  });

  it("returns true when https_proxy is set", () => {
    const env = { https_proxy: "http://proxy.example.com:8080" };
    expect(hasProxyEnv(env)).toBe(true);
  });

  it("returns true when HTTP_PROXY is set", () => {
    const env = { HTTP_PROXY: "http://proxy.example.com:8080" };
    expect(hasProxyEnv(env)).toBe(true);
  });

  it("returns true when http_proxy is set", () => {
    const env = { http_proxy: "http://proxy.example.com:8080" };
    expect(hasProxyEnv(env)).toBe(true);
  });
});

describe("configureProxyAwareFetch", () => {
  it("does not throw when proxy variables are set", () => {
    expect(() =>
      configureProxyAwareFetch({
        HTTPS_PROXY: "http://proxy.example.com:8080",
      }),
    ).not.toThrow();
  });

  it("does not throw when no proxy variables are set", () => {
    expect(() => configureProxyAwareFetch({})).not.toThrow();
  });
});
