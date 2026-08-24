import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";

export interface CliFetchOptions {
  env?: Record<string, string | undefined>;
  execArgv?: string[];
  nodeOptions?: string | undefined;
  nodeVersion?: string;
  baseFetch?: typeof fetch;
  undiciFetch?: typeof undiciFetch;
  createProxyAgent?: (proxyUrl: string) => ProxyDispatcher;
}

export interface ProxyEnvSelection {
  name: string;
  value: string;
}

export interface ProxyConfig {
  httpProxy?: ProxyEnvSelection;
  httpsProxy?: ProxyEnvSelection;
  noProxy?: string;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type UndiciInput = Parameters<typeof undiciFetch>[0];
type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
type ProxyDispatcher = Dispatcher & NonNullable<UndiciInit["dispatcher"]>;

const NODE_USE_ENV_PROXY = "NODE_USE_ENV_PROXY";
const USE_ENV_PROXY_FLAG = "--use-env-proxy";

export function createCliFetch(options: CliFetchOptions = {}): typeof fetch {
  const env = options.env ?? process.env;
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  const proxyConfig = getProxyConfig(env);
  if (!proxyConfig.httpProxy && !proxyConfig.httpsProxy) {
    return baseFetch;
  }
  if (
    isNativeEnvProxyActive({
      env,
      execArgv: options.execArgv ?? process.execArgv,
      nodeOptions: options.nodeOptions ?? env.NODE_OPTIONS,
      nodeVersion: options.nodeVersion ?? process.versions.node,
    })
  ) {
    return baseFetch;
  }

  validateProxySelection(proxyConfig.httpProxy);
  validateProxySelection(proxyConfig.httpsProxy);

  const fetchWithDispatcher = options.undiciFetch ?? undiciFetch;
  const createProxyAgent =
    options.createProxyAgent ??
    ((proxyUrl: string) =>
      new ProxyAgent({ uri: proxyUrl, proxyTunnel: false }));
  const proxyAgents = new Map<string, ProxyDispatcher>();

  return (async (input: FetchInput, init?: FetchInit) => {
    const targetUrl = getRequestUrl(input);
    if (!targetUrl) {
      return baseFetch(input, init);
    }
    const proxy = resolveProxyForUrl(targetUrl, proxyConfig);
    if (!proxy) {
      return baseFetch(input, init);
    }

    let dispatcher = proxyAgents.get(proxy.value);
    if (!dispatcher) {
      dispatcher = createProxyAgent(proxy.value);
      proxyAgents.set(proxy.value, dispatcher);
    }

    try {
      const undiciInit = {
        ...(init as Record<string, unknown> | undefined),
        dispatcher,
      } as UndiciInit;
      return await fetchWithDispatcher(input as UndiciInput, undiciInit);
    } catch (error) {
      throw createSanitizedProxyRequestError(proxy, error);
    }
  }) as typeof fetch;
}

export function createLazyCliFetch(
  options: CliFetchOptions = {},
): typeof fetch {
  let fetchFn: typeof fetch | undefined;
  return (async (input: FetchInput, init?: FetchInit) => {
    fetchFn ??= createCliFetch(options);
    return await fetchFn(input, init);
  }) as typeof fetch;
}

export function getProxyConfig(
  env: Record<string, string | undefined>,
): ProxyConfig {
  return {
    httpProxy: getEnvSelection(env, "HTTP_PROXY"),
    httpsProxy: getEnvSelection(env, "HTTPS_PROXY"),
    noProxy: getEnvSelection(env, "NO_PROXY")?.value,
  };
}

export function isNativeEnvProxyActive(options: {
  env: Record<string, string | undefined>;
  execArgv: string[];
  nodeOptions?: string | undefined;
  nodeVersion: string;
}): boolean {
  const envOptIn = options.env[NODE_USE_ENV_PROXY] === "1";
  const flagOptIn =
    hasUseEnvProxyFlag(options.execArgv) ||
    hasUseEnvProxyFlag(splitNodeOptions(options.nodeOptions));
  if (envOptIn && supportsNativeEnvProxyEnv(options.nodeVersion)) {
    return true;
  }
  return flagOptIn && supportsNativeEnvProxyFlag(options.nodeVersion);
}

export function resolveProxyForUrl(
  targetUrl: URL,
  proxyConfig: ProxyConfig,
): ProxyEnvSelection | undefined {
  if (shouldBypassProxy(targetUrl, proxyConfig.noProxy)) {
    return undefined;
  }
  if (targetUrl.protocol === "http:") {
    return proxyConfig.httpProxy;
  }
  if (targetUrl.protocol === "https:") {
    return proxyConfig.httpsProxy ?? proxyConfig.httpProxy;
  }
  return undefined;
}

export function redactProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid proxy URL>";
  }
}

function getEnvSelection(
  env: Record<string, string | undefined>,
  upperName: string,
): ProxyEnvSelection | undefined {
  const lowerName = upperName.toLowerCase();
  if (hasEnvKey(env, lowerName)) {
    const lowerValue = env[lowerName];
    return lowerValue ? { name: lowerName, value: lowerValue } : undefined;
  }
  if (hasEnvKey(env, upperName)) {
    const upperValue = env[upperName];
    return upperValue ? { name: upperName, value: upperValue } : undefined;
  }
  return undefined;
}

function hasEnvKey(
  env: Record<string, string | undefined>,
  key: string,
): boolean {
  return Object.hasOwn(env, key);
}

function validateProxySelection(
  selection: ProxyEnvSelection | undefined,
): void {
  if (!selection) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(selection.value);
  } catch {
    throw new Error(
      `${selection.name} must be an http:// or https:// proxy URL.`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.host
  ) {
    throw new Error(
      `${selection.name} must be an http:// or https:// proxy URL.`,
    );
  }
}

function getRequestUrl(input: FetchInput): URL | undefined {
  try {
    if (typeof input === "string" || input instanceof URL) {
      return new URL(input);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      return new URL(input.url);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function shouldBypassProxy(
  targetUrl: URL,
  noProxy: string | undefined,
): boolean {
  if (!noProxy) {
    return false;
  }
  if (noProxy.trim() === "*") {
    return true;
  }
  const hostname = normalizeHostname(targetUrl.hostname);
  const port = Number.parseInt(targetUrl.port, 10) || defaultPort(targetUrl);
  for (const rawEntry of noProxy.split(/[,\s]/)) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) {
      continue;
    }
    if (entry === "*") {
      return true;
    }
    const { host: entryHost, port: entryPort } = parseNoProxyEntry(entry);
    if (entryPort && entryPort !== port) {
      continue;
    }
    if (matchesNoProxyHost(hostname, entryHost)) {
      return true;
    }
  }
  return false;
}

function matchesNoProxyHost(hostname: string, entryHost: string): boolean {
  const normalizedEntryHost = entryHost.replace(/^\*?\./, "");
  return (
    hostname === normalizedEntryHost ||
    hostname.endsWith(`.${normalizedEntryHost}`)
  );
}

function parseNoProxyEntry(entry: string): { host: string; port: number } {
  const bracketedIpv6 = entry.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketedIpv6?.[1]) {
    return {
      host: normalizeHostname(bracketedIpv6[1]),
      port: bracketedIpv6[2] ? Number.parseInt(bracketedIpv6[2], 10) : 0,
    };
  }
  if (entry.includes(":")) {
    const lastColon = entry.lastIndexOf(":");
    const maybePort = entry.slice(lastColon + 1);
    const hostPart = entry.slice(0, lastColon);
    if (!hostPart.includes(":") && /^\d+$/.test(maybePort)) {
      return {
        host: normalizeHostname(hostPart),
        port: Number.parseInt(maybePort, 10),
      };
    }
    return { host: normalizeHostname(entry), port: 0 };
  }
  return { host: normalizeHostname(entry), port: 0 };
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function defaultPort(url: URL): number {
  if (url.protocol === "http:") {
    return 80;
  }
  if (url.protocol === "https:") {
    return 443;
  }
  return 0;
}

function hasUseEnvProxyFlag(args: string[]): boolean {
  return args.some((arg) => arg === USE_ENV_PROXY_FLAG);
}

function splitNodeOptions(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

function supportsNativeEnvProxyEnv(nodeVersion: string): boolean {
  const parsed = parseNodeVersion(nodeVersion);
  if (!parsed) {
    return false;
  }
  const [major, minor] = parsed;
  if (major === 22) {
    return minor >= 21;
  }
  if (major === 23) {
    return false;
  }
  return major >= 24;
}

function supportsNativeEnvProxyFlag(nodeVersion: string): boolean {
  const parsed = parseNodeVersion(nodeVersion);
  if (!parsed) {
    return false;
  }
  const [major, minor] = parsed;
  if (major === 22) {
    return minor >= 21;
  }
  if (major === 24) {
    return minor >= 5;
  }
  return major >= 25;
}

function parseNodeVersion(value: string): [number, number] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\./);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

function createSanitizedProxyRequestError(
  proxy: ProxyEnvSelection,
  error: unknown,
): Error {
  const reason = sanitizeErrorMessage(error);
  return new Error(
    `Proxy request failed using ${proxy.name} (${redactProxyUrl(proxy.value)})${reason ? `: ${reason}` : "."}`,
  );
}

function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return "";
  }
  return error.message
    .replace(/https?:\/\/\S+/gi, (match) => redactProxyUrl(match))
    .replace(
      /\b(?!https?:)[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/gi,
      "<redacted URL>",
    );
}
