import { describe, expect, it, mock, spyOn } from "bun:test";
import { win32 } from "node:path";
import { createMockFileSystemService } from "../services/test-helpers.js";
import {
  buildDoctorReport,
  type DoctorDependencies,
  doctorAction,
} from "./doctor.js";

function createDeps(
  overrides: Partial<DoctorDependencies> = {},
): DoctorDependencies {
  return {
    fs: createMockFileSystemService(),
    env: { HOME: "/home/test", PATH: "/usr/local/bin:/usr/bin" },
    argv: ["node", "/repo/node_modules/githits/dist/cli.js"],
    execPath: "/usr/local/bin/node",
    cwd: "/work/project",
    platform: "linux",
    arch: "arm64",
    nodeVersion: "v22.13.0",
    version: "0.0.0-test",
    now: () => new Date("2026-05-27T12:00:00.000Z"),
    realpath: mock((path: string) => Promise.resolve(`${path}.real`)),
    ...overrides,
  };
}

describe("doctor", () => {
  it("hides default service URLs in text output", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await doctorAction({}, createDeps());

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("MCP URL: default production");
    expect(output).toContain("API URL: default production");
    expect(output).toContain("Code navigation URL: default production");
    expect(output).not.toContain("https://mcp.githits.com");
    expect(output).not.toContain("https://api.githits.com");
    expect(output).not.toContain("https://pkgseer.dev");

    consoleSpy.mockRestore();
  });

  it("hides empty legacy auth dirs in text output", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await doctorAction({}, createDeps());

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain(
      "Active file storage dir: /home/test/.config/githits/auth",
    );
    expect(output).toContain(
      "Active auth dir: /home/test/.config/githits/auth",
    );
    expect(output).not.toContain("Legacy auth dir: /home/test/.githits");

    consoleSpy.mockRestore();
  });

  it("shows legacy auth dirs in text output when they contain auth files", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const fs = createMockFileSystemService({
      exists: mock((path: string) =>
        Promise.resolve(path === "/home/test/.githits/auth.json"),
      ),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            version: 1,
            tokens: {
              "https://mcp.githits.com": {
                accessToken: "secret-access-token",
                refreshToken: "secret-refresh-token",
                createdAt: "2026-05-27T10:00:00.000Z",
                expiresAt: "2026-05-27T14:00:00.000Z",
              },
            },
          }),
        ),
      ),
    });

    await doctorAction({}, createDeps({ fs }));

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    expect(output).toContain("Legacy auth dir: /home/test/.githits");
    expect(output).toContain("token: present");
    expect(output).not.toContain("secret-access-token");
    expect(output).not.toContain("secret-refresh-token");

    consoleSpy.mockRestore();
  });

  it("reports overridden service URLs", async () => {
    const report = await buildDoctorReport(
      createDeps({
        env: {
          HOME: "/home/test",
          GITHITS_MCP_URL: "https://mcp.example.test",
          GITHITS_API_URL: "https://api.example.test",
          GITHITS_CODE_NAV_URL: "https://code.example.test",
        },
      }),
    );

    expect(report.services.mcpUrl).toEqual({
      source: "env",
      value: "https://mcp.example.test",
    });
    expect(report.services.apiUrl).toEqual({
      source: "env",
      value: "https://api.example.test",
    });
    expect(report.services.codeNavigationUrl).toEqual({
      source: "env",
      value: "https://code.example.test",
    });
  });

  it("reports blank service URL overrides as overrides", async () => {
    const report = await buildDoctorReport(
      createDeps({
        env: {
          HOME: "/home/test",
          GITHITS_MCP_URL: "",
          GITHITS_API_URL: "   ",
        },
      }),
    );

    expect(report.services.mcpUrl).toEqual({ source: "env", value: "" });
    expect(report.services.apiUrl).toEqual({ source: "env", value: "   " });
  });

  it("uses the provided XDG_CONFIG_HOME for diagnostic paths", async () => {
    const report = await buildDoctorReport(
      createDeps({
        env: { HOME: "/home/test", XDG_CONFIG_HOME: "/tmp/xdg" },
      }),
    );

    expect(report.config.appConfigDir).toBe("/tmp/xdg/githits");
    expect(report.config.configPath).toBe("/tmp/xdg/githits/config.toml");
    expect(report.auth.activeFileStorageDir).toBe("/tmp/xdg/githits/auth");
    expect(report.environment.xdgConfigHome).toEqual({
      status: "present",
      value: "/tmp/xdg",
      source: "env",
    });
  });

  it("uses the provided HOME fallback for diagnostic paths", async () => {
    const report = await buildDoctorReport(
      createDeps({
        env: { HOME: "/custom/home" },
      }),
    );

    expect(report.config.appConfigDir).toBe("/custom/home/.config/githits");
    expect(report.config.configPath).toBe(
      "/custom/home/.config/githits/config.toml",
    );
    expect(report.auth.activeFileStorageDir).toBe(
      "/custom/home/.config/githits/auth",
    );
    expect(report.auth.files.at(-1)?.dir).toBe("/custom/home/.githits");
  });

  it("uses the provided HOME for legacy macOS diagnostic paths", async () => {
    const fs = createMockFileSystemService({
      exists: mock((path: string) =>
        Promise.resolve(
          path ===
            "/custom/home/Library/Application Support/githits/config.toml",
        ),
      ),
      readFile: mock(() => Promise.resolve('[auth]\nstorage = "file"\n')),
    });

    const report = await buildDoctorReport(
      createDeps({
        fs,
        platform: "darwin",
        env: { HOME: "/custom/home" },
      }),
    );

    expect(report.config.configPath).toBe(
      "/custom/home/Library/Application Support/githits/config.toml",
    );
    expect(report.auth.files[1]?.dir).toBe(
      "/custom/home/Library/Application Support/githits/auth",
    );
  });

  it("uses Windows PATH delimiters when resolving githits", async () => {
    const githitsCmd = win32.join("C:\\b", "githits.cmd");
    const fs = createMockFileSystemService({
      joinPath: mock((...segments: string[]) => win32.join(...segments)),
      exists: mock((path: string) => Promise.resolve(path === githitsCmd)),
    });

    const report = await buildDoctorReport(
      createDeps({
        fs,
        platform: "win32",
        env: {
          USERPROFILE: "C:\\Users\\test",
          PATH: "C:\\a;C:\\b",
          PATHEXT: ".CMD;.EXE",
        },
      }),
    );

    expect(report.runtime.pathGithits).toEqual({
      status: "present",
      value: githitsCmd,
      source: "env",
    });
  });

  it("reads file auth timestamps without writing auth state", async () => {
    const writes = {
      writeFile: mock(() => Promise.resolve()),
      deleteFile: mock(() => Promise.resolve()),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.resolve()),
    };
    const fs = createMockFileSystemService({
      ...writes,
      exists: mock((path: string) =>
        Promise.resolve(
          path.endsWith("config.toml") ||
            path.endsWith("auth.json") ||
            path.endsWith("client.json") ||
            path.endsWith("metadata.json"),
        ),
      ),
      readFile: mock((path: string) => {
        if (path.endsWith("config.toml")) {
          return Promise.resolve('[auth]\nstorage = "file"\n');
        }
        if (path.endsWith("auth.json")) {
          return Promise.resolve(
            JSON.stringify({
              version: 1,
              tokens: {
                "https://mcp.githits.com": {
                  accessToken: "secret-access-token",
                  refreshToken: "secret-refresh-token",
                  createdAt: "2026-05-27T10:00:00.000Z",
                  expiresAt: "2026-05-27T14:00:00.000Z",
                },
              },
            }),
          );
        }
        if (path.endsWith("client.json")) {
          return Promise.resolve(
            JSON.stringify({
              version: 1,
              clients: {
                "https://mcp.githits.com": {
                  clientId: "secret-client-id",
                  clientSecret: "secret-client-secret",
                  redirectUri: "http://127.0.0.1:8080/callback",
                  registeredAt: "2026-05-20T09:00:00.000Z",
                },
              },
            }),
          );
        }
        return Promise.resolve(
          JSON.stringify({
            version: 1,
            sessions: {
              "https://mcp.githits.com": {
                createdAt: "2026-05-27T10:00:00.000Z",
                expiresAt: "2026-05-27T14:00:00.000Z",
                updatedAt: "2026-05-27T10:05:00.000Z",
              },
            },
          }),
        );
      }),
    });

    const report = await buildDoctorReport(createDeps({ fs }));
    const active = report.auth.files[0];

    expect(report.auth.storageMode).toMatchObject({
      status: "present",
      value: "file",
      source: "config",
    });
    expect(active?.token).toEqual({
      status: "present",
      source: "file",
      value: {
        createdAt: "2026-05-27T10:00:00.000Z",
        expiresAt: "2026-05-27T14:00:00.000Z",
      },
    });
    expect(active?.client).toEqual({
      status: "present",
      source: "file",
      value: { registeredAt: "2026-05-20T09:00:00.000Z" },
    });
    expect(active?.metadata).toEqual({
      status: "present",
      source: "file",
      value: {
        createdAt: "2026-05-27T10:00:00.000Z",
        expiresAt: "2026-05-27T14:00:00.000Z",
        updatedAt: "2026-05-27T10:05:00.000Z",
      },
    });
    expect(JSON.stringify(report)).not.toContain("secret-access-token");
    expect(JSON.stringify(report)).not.toContain("secret-refresh-token");
    expect(JSON.stringify(report)).not.toContain("secret-client-secret");
    expect(writes.writeFile).not.toHaveBeenCalled();
    expect(writes.deleteFile).not.toHaveBeenCalled();
    expect(writes.ensureDir).not.toHaveBeenCalled();
    expect(writes.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("reports invalid auth config instead of throwing", async () => {
    const fs = createMockFileSystemService({
      exists: mock((path: string) =>
        Promise.resolve(path.endsWith("config.toml")),
      ),
      readFile: mock(() => Promise.resolve('[auth]\nstorage = "plaintext"\n')),
    });

    const report = await buildDoctorReport(createDeps({ fs }));

    expect(report.config.authStorageMode.status).toBe("invalid");
    expect(report.config.authStorageMode.error?.message).toContain(
      "Invalid auth storage mode",
    );
    expect(report.recommendations).toContain(
      "Fix the auth storage configuration before logging in again.",
    );
  });

  it("emits JSON diagnostics", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await doctorAction({ json: true }, createDeps());

    const output = String(consoleSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.currentTime).toBe("2026-05-27T12:00:00.000Z");
    expect(parsed.environment.envApiToken.status).toBe("missing");

    consoleSpy.mockRestore();
  });
});
