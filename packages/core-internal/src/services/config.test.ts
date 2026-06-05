import { afterEach, describe, expect, it } from "bun:test";
import { getCodeNavigationUrl } from "./config.js";

describe("code navigation config", () => {
  const originalCodeNavUrl = process.env.GITHITS_CODE_NAV_URL;
  const originalPkgseerUrl = process.env.PKGSEER_URL;
  const originalMcpUrl = process.env.GITHITS_MCP_URL;
  const originalApiUrl = process.env.GITHITS_API_URL;

  afterEach(() => {
    restoreEnv("GITHITS_CODE_NAV_URL", originalCodeNavUrl);
    restoreEnv("PKGSEER_URL", originalPkgseerUrl);
    restoreEnv("GITHITS_MCP_URL", originalMcpUrl);
    restoreEnv("GITHITS_API_URL", originalApiUrl);
  });

  it("prefers GITHITS_CODE_NAV_URL over PKGSEER_URL", () => {
    process.env.GITHITS_CODE_NAV_URL = "https://nav.githits.test";
    process.env.PKGSEER_URL = "https://pkgseer.test";

    expect(getCodeNavigationUrl()).toBe("https://nav.githits.test");
  });

  it("falls back to PKGSEER_URL when GitHits URL is unset", () => {
    delete process.env.GITHITS_CODE_NAV_URL;
    process.env.PKGSEER_URL = "https://pkgseer.test";

    expect(getCodeNavigationUrl()).toBe("https://pkgseer.test");
  });

  it("uses pkgseer.dev by default when no overrides are set", () => {
    delete process.env.GITHITS_CODE_NAV_URL;
    delete process.env.PKGSEER_URL;

    expect(getCodeNavigationUrl()).toBe("https://pkgseer.dev");
  });

  it("keeps the package/source default independent from custom GitHits environments", () => {
    delete process.env.GITHITS_CODE_NAV_URL;
    delete process.env.PKGSEER_URL;
    process.env.GITHITS_MCP_URL = "https://mcp.staging.githits.test";

    expect(getCodeNavigationUrl()).toBe("https://pkgseer.dev");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
