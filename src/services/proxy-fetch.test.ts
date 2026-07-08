import { afterEach, describe, expect, it, mock } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type CliFetchOptions,
  createCliFetch,
  createLazyCliFetch,
  getProxyConfig,
  isNativeEnvProxyActive,
  redactProxyUrl,
  resolveProxyForUrl,
} from "./proxy-fetch.js";

describe("createCliFetch", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  it("returns the base fetch when proxy env vars are absent", async () => {
    const baseFetch = mock(() => Promise.resolve(new Response("base")));

    const fetchFn = createCliFetch({
      env: {},
      baseFetch: baseFetch as unknown as typeof fetch,
    });
    const response = await fetchFn("https://api.githits.com/test");

    expect(fetchFn).toBe(asBaseFetch(baseFetch));
    expect(await response.text()).toBe("base");
  });

  it("uses native fetch only when opt-in is supported by the runtime", async () => {
    const baseFetch = mock(() => Promise.resolve(new Response("native")));
    const undiciFetch = mock(() => Promise.resolve(new Response("fallback")));

    const supported = createCliFetch({
      env: {
        HTTP_PROXY: "http://proxy.local:8080",
        NODE_USE_ENV_PROXY: "1",
      },
      nodeVersion: "24.0.0",
      baseFetch: asBaseFetch(baseFetch),
      undiciFetch: asUndiciFetch(undiciFetch),
      createProxyAgent: mock(() => fakeDispatcher()),
    });

    const unsupported = createCliFetch({
      env: {
        HTTP_PROXY: "http://proxy.local:8080",
        NODE_USE_ENV_PROXY: "1",
      },
      nodeVersion: "20.18.1",
      baseFetch: asBaseFetch(baseFetch),
      undiciFetch: asUndiciFetch(undiciFetch),
      createProxyAgent: mock(() => fakeDispatcher()),
    });

    expect(await (await supported("https://api.githits.com/test")).text()).toBe(
      "native",
    );
    expect(
      await (await unsupported("https://api.githits.com/test")).text(),
    ).toBe("fallback");
  });

  it("does not treat unsupported --use-env-proxy opt-in as native support", async () => {
    expect(
      isNativeEnvProxyActive({
        env: {},
        execArgv: ["--use-env-proxy"],
        nodeVersion: "20.18.1",
      }),
    ).toBe(false);
    expect(
      isNativeEnvProxyActive({
        env: {},
        execArgv: ["--use-env-proxy"],
        nodeVersion: "24.4.0",
      }),
    ).toBe(false);
    expect(
      isNativeEnvProxyActive({
        env: {},
        execArgv: ["--use-env-proxy"],
        nodeVersion: "24.5.0",
      }),
    ).toBe(true);
  });

  it("detects --use-env-proxy from NODE_OPTIONS on supported runtimes", () => {
    expect(
      isNativeEnvProxyActive({
        env: {},
        execArgv: [],
        nodeOptions: "--trace-warnings --use-env-proxy",
        nodeVersion: "22.21.0",
      }),
    ).toBe(true);
  });

  it("uses lowercase proxy env values before uppercase values", () => {
    expect(
      getProxyConfig({
        HTTP_PROXY: "http://upper.example:8080",
        http_proxy: "http://lower.example:8080",
      }).httpProxy,
    ).toEqual({ name: "http_proxy", value: "http://lower.example:8080" });
  });

  it("does not fall back to uppercase when lowercase proxy env is empty", () => {
    expect(
      getProxyConfig({
        HTTP_PROXY: "http://upper.example:8080",
        http_proxy: "",
      }).httpProxy,
    ).toBeUndefined();
  });

  it("uses HTTP_PROXY for HTTPS targets when HTTPS_PROXY is absent", () => {
    const proxy = resolveProxyForUrl(new URL("https://api.githits.com"), {
      httpProxy: { name: "HTTP_PROXY", value: "http://proxy.example:8080" },
    });

    expect(proxy).toEqual({
      name: "HTTP_PROXY",
      value: "http://proxy.example:8080",
    });
  });

  it("bypasses matching NO_PROXY hosts", async () => {
    const baseFetch = mock(() => Promise.resolve(new Response("direct")));
    const undiciFetch = mock(() => Promise.resolve(new Response("proxied")));
    const fetchFn = createCliFetch({
      env: {
        HTTP_PROXY: "http://proxy.local:8080",
        NO_PROXY: "api.githits.com,.internal.example",
      },
      baseFetch: asBaseFetch(baseFetch),
      undiciFetch: asUndiciFetch(undiciFetch),
      createProxyAgent: mock(() => fakeDispatcher()),
    });

    const directResponse = await fetchFn("https://api.githits.com/test");
    const proxiedResponse = await fetchFn("https://other.githits.com/test");

    expect(await directResponse.text()).toBe("direct");
    expect(await proxiedResponse.text()).toBe("proxied");
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it("bypasses IPv6 NO_PROXY entries", () => {
    const proxyConfig = {
      httpProxy: { name: "HTTP_PROXY", value: "http://proxy.example:8080" },
      noProxy: "::1,[2001:db8::1]:8080",
    };

    expect(
      resolveProxyForUrl(new URL("http://[::1]:3000"), proxyConfig),
    ).toBeUndefined();
    expect(
      resolveProxyForUrl(new URL("http://[2001:db8::1]:8080"), proxyConfig),
    ).toBeUndefined();
    expect(
      resolveProxyForUrl(new URL("http://[2001:db8::1]:9090"), proxyConfig),
    ).toEqual({ name: "HTTP_PROXY", value: "http://proxy.example:8080" });
  });

  it("bypasses exact hosts and subdomains for NO_PROXY domain entries", () => {
    const proxyConfig = {
      httpProxy: { name: "HTTP_PROXY", value: "http://proxy.example:8080" },
      noProxy: "example.com,.internal.example,*.private.example",
    };

    expect(
      resolveProxyForUrl(new URL("http://example.com"), proxyConfig),
    ).toBeUndefined();
    expect(
      resolveProxyForUrl(new URL("http://api.example.com"), proxyConfig),
    ).toBeUndefined();
    expect(
      resolveProxyForUrl(new URL("http://svc.internal.example"), proxyConfig),
    ).toBeUndefined();
    expect(
      resolveProxyForUrl(new URL("http://api.private.example"), proxyConfig),
    ).toBeUndefined();
    expect(
      resolveProxyForUrl(new URL("http://notexample.com"), proxyConfig),
    ).toEqual({ name: "HTTP_PROXY", value: "http://proxy.example:8080" });
  });

  it("bypasses all targets when NO_PROXY contains a wildcard entry", () => {
    expect(
      resolveProxyForUrl(new URL("http://api.githits.com"), {
        httpProxy: { name: "HTTP_PROXY", value: "http://proxy.example:8080" },
        noProxy: "localhost,*",
      }),
    ).toBeUndefined();
  });

  it("fails malformed proxy env values without exposing their value", () => {
    expect(() =>
      createCliFetch({ env: { HTTP_PROXY: "not a proxy secret" } }),
    ).toThrow("HTTP_PROXY must be an http:// or https:// proxy URL.");
    expect(() =>
      createCliFetch({ env: { HTTP_PROXY: "not a proxy secret" } }),
    ).not.toThrow("secret");
  });

  it("defers malformed proxy env failures for lazy fetch callers", async () => {
    const fetchFn = createLazyCliFetch({
      env: { HTTP_PROXY: "secret://user:pass@proxy.example/path" },
    });

    await expect(fetchFn("http://target.example/test")).rejects.toThrow(
      "HTTP_PROXY must be an http:// or https:// proxy URL.",
    );
    await expect(fetchFn("http://target.example/test")).rejects.not.toThrow(
      "user:pass",
    );
  });

  it("redacts credentials, path, query, and fragment from proxy URLs", () => {
    expect(
      redactProxyUrl("http://user:pass@proxy.example:8080/path?q=secret#frag"),
    ).toBe("http://proxy.example:8080/");
  });

  it("sanitizes fallback transport errors", async () => {
    const undiciFetch = mock(() =>
      Promise.reject(
        new Error(
          "connect failed http://user:pass@proxy.example:8080/private?q=1",
        ),
      ),
    );
    const fetchFn = createCliFetch({
      env: { HTTP_PROXY: "http://user:pass@proxy.example:8080/private?q=1" },
      undiciFetch: asUndiciFetch(undiciFetch),
      createProxyAgent: mock(() => fakeDispatcher()),
    });

    await expect(fetchFn("http://target.example/test")).rejects.toThrow(
      "Proxy request failed using HTTP_PROXY (http://proxy.example:8080/): connect failed http://proxy.example:8080/",
    );
    await expect(fetchFn("http://target.example/test")).rejects.not.toThrow(
      "user:pass",
    );
    await expect(fetchFn("http://target.example/test")).rejects.not.toThrow(
      "private",
    );
  });

  it("bypasses the local proxy for matching NO_PROXY targets", async () => {
    let proxyHit = false;
    const proxy = await listen(
      createServer((_req, res) => {
        proxyHit = true;
        res.writeHead(502);
        res.end("proxy should not be used");
      }),
    );
    const target = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("direct");
      }),
    );
    servers.push(proxy.server, target.server);

    const fetchFn = createCliFetch({
      env: {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
        NO_PROXY: `127.0.0.1:${target.port}`,
      },
    });
    const response = await fetchFn(`http://127.0.0.1:${target.port}/direct`);

    expect(await response.text()).toBe("direct");
    expect(proxyHit).toBe(false);
  });
});

function fakeDispatcher(): never {
  return {} as never;
}

function asBaseFetch(value: unknown): typeof fetch {
  return value as typeof fetch;
}

function asUndiciFetch(
  value: unknown,
): NonNullable<CliFetchOptions["undiciFetch"]> {
  return value as NonNullable<CliFetchOptions["undiciFetch"]>;
}

async function listen(
  server: Server,
): Promise<{ server: Server; port: number }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
