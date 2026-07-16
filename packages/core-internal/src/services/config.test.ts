import { afterEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_MCP_URL,
  getApiUrl,
  getCodeNavigationUrl,
  getMcpStorageKeyUrl,
  getMcpUrl,
  ServiceUrlConfigError,
} from "./config.js";

const URL_ENV_NAMES = [
  "GITHITS_MCP_URL",
  "GITHITS_API_URL",
  "GITHITS_CODE_NAV_URL",
  "PKGSEER_URL",
] as const;

describe("service URL config", () => {
  const originals = new Map<string, string | undefined>(
    URL_ENV_NAMES.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const [name, value] of originals) restoreEnv(name, value);
  });

  it("uses secure production defaults", () => {
    clearUrlEnv();

    expect(getMcpUrl()).toBe("https://mcp.githits.com");
    expect(getApiUrl()).toBe("https://api.githits.com");
    expect(getCodeNavigationUrl()).toBe("https://pkgseer.dev");
  });

  for (const { envName, getter } of URL_GETTERS) {
    it(`${envName} accepts HTTPS and exact HTTP loopback hosts`, () => {
      clearUrlEnv();
      for (const value of [
        "https://custom.githits.test/path",
        "http://localhost:4000",
        "http://127.0.0.1:4000",
        "http://[::1]:4000",
      ]) {
        process.env[envName] = value;
        expect(getter()).toBe(value);
      }
    });

    it(`${envName} rejects insecure, malformed, and blank overrides`, () => {
      clearUrlEnv();
      for (const value of [
        "http://attacker.test",
        "http://localhost.attacker.test",
        "ftp://localhost/resource",
        "not-a-url",
        "",
        "   ",
      ]) {
        process.env[envName] = value;
        expect(() => getter()).toThrow(ServiceUrlConfigError);
        expect(() => getter()).toThrow(envName);
      }
    });
  }

  it("prefers GITHITS_CODE_NAV_URL over PKGSEER_URL", () => {
    clearUrlEnv();
    process.env.GITHITS_CODE_NAV_URL = "https://nav.githits.test";
    process.env.PKGSEER_URL = "http://attacker.test";

    expect(getCodeNavigationUrl()).toBe("https://nav.githits.test");
  });

  it("keeps the package/source default independent from custom GitHits environments", () => {
    clearUrlEnv();
    process.env.GITHITS_MCP_URL = "https://mcp.staging.githits.test";

    expect(getCodeNavigationUrl()).toBe("https://pkgseer.dev");
  });

  it("resolves malformed MCP overrides for storage cleanup without network validation", () => {
    process.env.GITHITS_MCP_URL = "http://attacker.test";

    expect(getMcpStorageKeyUrl()).toBe("http://attacker.test");
    expect(() => getMcpUrl()).toThrow("GITHITS_MCP_URL");
  });

  it("uses the production MCP URL as the default storage namespace", () => {
    delete process.env.GITHITS_MCP_URL;

    expect(getMcpStorageKeyUrl()).toBe(DEFAULT_MCP_URL);
  });
});

const URL_GETTERS: Array<{
  envName: (typeof URL_ENV_NAMES)[number];
  getter: () => string;
}> = [
  { envName: "GITHITS_MCP_URL", getter: getMcpUrl },
  { envName: "GITHITS_API_URL", getter: getApiUrl },
  { envName: "GITHITS_CODE_NAV_URL", getter: getCodeNavigationUrl },
  { envName: "PKGSEER_URL", getter: getCodeNavigationUrl },
];

function clearUrlEnv(): void {
  for (const name of URL_ENV_NAMES) delete process.env[name];
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
