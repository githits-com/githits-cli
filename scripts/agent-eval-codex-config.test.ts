import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  buildEvalEnv,
  collectSecretValues,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  parseArgs,
  runAgentEval,
} from "./agent-eval.ts";
import { loadCodexEvalConfig } from "./agent-eval-codex-config.ts";

const PROFILE = `model = "deepseek-endpoint.example"
model_provider = "modal"
model_reasoning_effort = "high"
model_catalog_json = "catalog.json"
[model_providers.modal]
name = "Modal"
base_url = "https://inference.us-west.modal.direct/v1"
env_key = "MODEL_ACCESS"
wire_api = "responses"
`;

function writeProfile(root: string, contents = PROFILE): string {
  const path = join(root, "model.config.toml");
  writeFileSync(path, contents);
  writeFileSync(join(root, "catalog.json"), '{"models":[]}\n');
  return path;
}

function readArtifactTexts(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory()
      ? readArtifactTexts(path)
      : [readFileSync(path, "utf8")];
  });
}

describe("Codex eval main model config", () => {
  it("loads model defaults, selected provider arguments, and auditable hashes", () => {
    const root = mkdtempSync(join(tmpdir(), "eval-profile-"));
    try {
      const path = writeProfile(root);
      const profile = loadCodexEvalConfig(path);
      const config = parseToml(
        profile.configArgs.filter((arg) => arg !== "-c").join("\n"),
      );
      expect(profile).toMatchObject({
        model: "deepseek-endpoint.example",
        reasoningEffort: "high",
        envKey: "MODEL_ACCESS",
        metadata: {
          path,
          provider: "modal",
          sha256: createHash("sha256").update(PROFILE).digest("hex"),
        },
      });
      expect(config).toEqual({
        model_provider: "modal",
        model_catalog_json: join(root, "catalog.json"),
        model_providers: {
          modal: {
            name: "Modal",
            base_url: "https://inference.us-west.modal.direct/v1",
            env_key: "MODEL_ACCESS",
            wire_api: "responses",
          },
        },
      });
      writeFileSync(join(root, "catalog.json"), '{"models":[{}]}');
      expect(loadCodexEvalConfig(path).metadata.catalogSha256).not.toBe(
        profile.metadata.catalogSha256,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not include source text or credentials in parse/validation errors", () => {
    const root = mkdtempSync(join(tmpdir(), "eval-profile-errors-"));
    const secret = "dummy-inline-credential";
    try {
      for (const contents of [
        `model = "${secret}`,
        `${PROFILE}experimental_bearer_token = "${secret}"\n`,
        `${PROFILE}auth = { command = "credential-reader" }\n`,
        PROFILE.replace("https://inference", `https://${secret}@inference`),
        PROFILE.replace("/v1", `/v1?key=${secret}`),
      ]) {
        const path = writeProfile(root, contents);
        expect(() => loadCodexEvalConfig(path)).toThrow();
        try {
          loadCodexEvalConfig(path);
        } catch (error) {
          expect(String(error)).not.toContain(secret);
          expect(String(error)).not.toContain(contents);
        }
      }
      expect(() =>
        loadCodexEvalConfig(
          writeProfile(
            root,
            PROFILE.replace(
              'model_provider = "modal"',
              'model_provider = "missing"',
            ),
          ),
        ),
      ).toThrow("must define its selected env-key Responses provider");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts omitted catalog/effort and reports unreadable files safely", () => {
    const root = mkdtempSync(join(tmpdir(), "eval-profile-optional-"));
    try {
      const path = writeProfile(
        root,
        PROFILE.replace('model_catalog_json = "catalog.json"\n', "").replace(
          'model_reasoning_effort = "high"\n',
          "",
        ),
      );
      expect(loadCodexEvalConfig(path)).toMatchObject({
        reasoningEffort: undefined,
        metadata: { catalogSha256: null },
      });
      expect(() => loadCodexEvalConfig(join(root, "missing.toml"))).toThrow(
        "Could not read Codex eval config",
      );
      writeProfile(root);
      rmSync(join(root, "catalog.json"));
      expect(() => loadCodexEvalConfig(path)).toThrow("model catalog");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses main model config selection without replacing it with Luna defaults", () => {
    const repoRoot = join(tmpdir(), "codex-eval-parse-root");
    const options = parseArgs(
      ["--agent", "codex", "--codex-config", "model.config.toml"],
      repoRoot,
    );
    expect(options.codexConfigPath).toBe(join(repoRoot, "model.config.toml"));
    expect(options.model).toBeUndefined();
    expect(options.reasoningEffort).toBeUndefined();
    expect(parseArgs(["--agent", "codex"], repoRoot)).toMatchObject({
      model: DEFAULT_CODEX_MODEL,
      reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    });
    expect(() => parseArgs(["--codex-config"], repoRoot)).toThrow(
      "requires a Codex config file",
    );
    expect(() => parseArgs(["--codex-config", "--dry-run"], repoRoot)).toThrow(
      "requires a Codex config file",
    );
    expect(() =>
      parseArgs(["--codex-config", "model.config.toml"], repoRoot),
    ).toThrow("require --agent codex");
  });

  it("adds only the selected custom variable and redacts arbitrary credential names", () => {
    const baseEnv = {
      PATH: "/bin",
      OPENAI_API_KEY: "dummy-existing-openai-credential",
      MODEL_ACCESS: "dummy-selected-provider-credential",
      OTHER_PROVIDER_TOKEN: "dummy-unselected-provider-credential",
    };
    expect(buildEvalEnv(baseEnv).MODEL_ACCESS).toBeUndefined();
    const env = buildEvalEnv(baseEnv, ["MODEL_ACCESS"]);
    expect(env.MODEL_ACCESS).toBe(baseEnv.MODEL_ACCESS);
    expect(env.OPENAI_API_KEY).toBe(baseEnv.OPENAI_API_KEY);
    expect(env.OTHER_PROVIDER_TOKEN).toBeUndefined();
    expect(collectSecretValues(env, ["MODEL_ACCESS"])).toContain(
      baseEnv.MODEL_ACCESS,
    );
  });

  for (const surface of ["mcp", "skills"] as const) {
    for (const override of [false, true]) {
      it(`runs ${surface} with ${override ? "explicit overrides" : "profile defaults"} and redacts every artifact`, async () => {
        const root = mkdtempSync(join(tmpdir(), "eval-profile-run-"));
        const codexHome = mkdtempSync(join(tmpdir(), "eval-profile-codex-"));
        const outDir = join(root, "out");
        const credential = 'dummy-provider-"credential"\\suffix';
        const model = override
          ? "overridden-endpoint.example"
          : "deepseek-endpoint.example";
        const effort = override ? "low" : "high";
        const format = override ? "prompt-json" : "json-schema";
        try {
          const profilePath = writeProfile(root);
          const options = parseArgs(
            [
              "--agent",
              "codex",
              "--surface",
              surface,
              "--codex-config",
              profilePath,
              "--codex-report-format",
              format,
              "--out",
              outDir,
              "--workload",
              resolve("eval/agentic/workloads/express-router.md"),
              ...(override
                ? ["--model", model, "--reasoning-effort", effort]
                : []),
            ],
            process.cwd(),
          );
          await runAgentEval(options, {
            baseEnv: {
              PATH: "/bin",
              CODEX_HOME: codexHome,
              MODEL_ACCESS: credential,
            },
            assertAgentAvailable: async () => {},
            collectAgentVersions: async () => [
              undefined,
              "codex-test",
              undefined,
            ],
            runCommand: async (command, _cwd, env) => {
              expect(command.includes("--output-schema")).toBe(
                format === "json-schema",
              );
              expect(command).toContain("--ignore-user-config");
              expect(command).not.toContain("--profile");
              expect(command).toContain('model_provider="modal"');
              expect(command).toContain(`model_reasoning_effort="${effort}"`);
              expect(command[command.indexOf("-m") + 1]).toBe(model);
              expect(command.join(" ")).not.toContain(credential);
              expect(env.MODEL_ACCESS).toBe(credential);
              expect(env.HOME).not.toBe(process.env.HOME);
              const final = {
                status: "success",
                answer: `Echo ${credential}`,
                confidence: "high",
              };
              writeFileSync(
                command[command.indexOf("--output-last-message") + 1]!,
                JSON.stringify(final),
              );
              return {
                stdout: [
                  JSON.stringify(final),
                  JSON.stringify({
                    type: "turn.completed",
                    usage: {
                      input_tokens: 100,
                      cached_input_tokens: 40,
                      cache_write_input_tokens: 0,
                      output_tokens: 10,
                      reasoning_output_tokens: 4,
                    },
                  }),
                ].join("\n"),
                stderr: `Echo ${credential}`,
                exitCode: 0,
                timedOut: false,
              };
            },
          });
          const run = JSON.parse(
            readFileSync(join(outDir, "run.json"), "utf8"),
          );
          expect(run).toMatchObject({
            model,
            reasoningEffort: effort,
            codexReportFormat: format,
            codexConfig: { provider: "modal" },
          });
          expect(run.env.MODEL_ACCESS).toBeUndefined();
          expect(run.codexConfig.sha256).toMatch(/^[a-f0-9]{64}$/);
          expect(run.workloads[0]).toMatchObject({
            model,
            reasoningEffort: effort,
            status: "success",
            codexConfig: run.codexConfig,
          });
          const metrics = JSON.parse(
            readFileSync(join(outDir, "metrics.json"), "utf8"),
          );
          expect(metrics.records[0]).toMatchObject({
            requestedModel: model,
            reasoningEffort: effort,
            processStatus: "success",
            usage: {
              model,
              cost: { kind: "unknown" },
              warnings: ["rate_card_not_configured"],
            },
          });
          for (const text of readArtifactTexts(outDir)) {
            expect(text).not.toContain(credential);
            expect(text).not.toContain(JSON.stringify(credential).slice(1, -1));
          }
          expect(
            readFileSync(
              join(outDir, "workloads/express-router/final.json"),
              "utf8",
            ),
          ).toContain("Echo <redacted>");
        } finally {
          rmSync(root, { recursive: true, force: true });
          rmSync(codexHome, { recursive: true, force: true });
        }
      });
    }
  }
  it("projects model settings while excluding ambient tools and instructions", () => {
    const root = mkdtempSync(join(tmpdir(), "eval-config-projection-"));
    try {
      const path = writeProfile(
        root,
        `model_instructions_file = "ambient.md"\n${PROFILE}\n[mcp_servers.other]\ncommand = "ambient-server"\n[features]\napps = true\n[model_providers.unselected]\nauth = {command = "credential-reader"}\n`,
      );
      const config = loadCodexEvalConfig(path);
      expect(config.configArgs.join(" ")).not.toMatch(
        /ambient|unselected|credential-reader|features/,
      );
      expect(config.model).toBe("deepseek-endpoint.example");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid final JSON in prompt-json mode without repairing it", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-prompt-json-"));
    const home = mkdtempSync(join(tmpdir(), "eval-prompt-json-home-"));
    try {
      const options = parseArgs(
        [
          "--agent",
          "codex",
          "--codex-config",
          writeProfile(root),
          "--codex-report-format",
          "prompt-json",
          "--out",
          join(root, "out"),
          "--workload",
          resolve("eval/agentic/workloads/express-router.md"),
        ],
        process.cwd(),
      );
      await runAgentEval(options, {
        baseEnv: {
          PATH: "/bin",
          CODEX_HOME: home,
          MODEL_ACCESS: "dummy-prompt-json-key",
        },
        assertAgentAvailable: async () => {},
        collectAgentVersions: async () => [undefined, "codex-test", undefined],
        runCommand: async (command) => {
          expect(command).not.toContain("--output-schema");
          writeFileSync(
            command[command.indexOf("--output-last-message") + 1]!,
            "not JSON",
          );
          return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
        },
      });
      const summary = JSON.parse(
        readFileSync(join(root, "out", "summary.json"), "utf8"),
      );
      expect(summary.status).toBe("failed");
      expect(summary.workloads[0].status).toBe("failed");
      expect(
        readFileSync(
          join(root, "out", "workloads", "express-router", "codex-final.txt"),
          "utf8",
        ),
      ).toBe("not JSON");
      expect(() =>
        parseArgs(["--agent", "codex", "--codex-report-format", "bad"], root),
      ).toThrow("must be");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
