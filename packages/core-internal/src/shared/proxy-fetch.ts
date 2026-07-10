/**
 * Proxy-aware fetch setup.
 *
 * Node.js native `fetch` ignores `HTTP_PROXY`/`HTTPS_PROXY` by default. This
 * module detects the standard proxy environment variables and, when present,
 * installs an `undici` dispatcher so that all subsequent native fetch calls
 * route through the proxy.
 *
 * Supports `NO_PROXY` for selective opt-out, matching common corporate proxy
 * conventions.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let proxyFetchConfigured = false;

/**
 * Returns true when at least one of the standard proxy environment variables
 * is set. Checks lower- and upper-case variants, matching curl/git convention.
 */
export function hasProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy,
  );
}

/**
 * Configures Node.js native fetch to honor `HTTP_PROXY`/`HTTPS_PROXY` via
 * undici's `EnvHttpProxyAgent`. Safe to call multiple times; subsequent calls
 * are no-ops.
 *
 * This should run as early as possible in the process lifetime, before any
 * network request is issued.
 */
export function configureProxyAwareFetch(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (proxyFetchConfigured) {
    return;
  }
  if (!hasProxyEnv(env)) {
    return;
  }

  const agent = new EnvHttpProxyAgent();
  setGlobalDispatcher(agent);
  proxyFetchConfigured = true;
}
