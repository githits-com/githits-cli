import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMcpQuickStart } from "@githits/mcp";
import { parse as parseYaml } from "yaml";

const root = join(import.meta.dir, "..");
const onboardingSkillPath = join(
  root,
  "skills",
  "githits-onboarding",
  "SKILL.md",
);
const troubleshootingPath = join(
  root,
  "skills",
  "githits-onboarding",
  "references",
  "troubleshooting.md",
);
const githitsMcpSkillPath = join(root, "skills", "githits-mcp", "SKILL.md");
const githitsCodeSkillPath = join(root, "skills", "githits-code", "SKILL.md");
const githitsCodeReferencePath = join(
  root,
  "skills",
  "githits-code",
  "references",
  "code-and-docs.md",
);
const githitsPackageReferencePath = join(
  root,
  "skills",
  "githits-package",
  "references",
  "package.md",
);
const pluginMaintenanceSkillPath = join(
  root,
  ".agents",
  "skills",
  "githits-plugin-maintenance",
  "SKILL.md",
);
const braintrustAgentEvalsSkillPath = join(
  root,
  ".agents",
  "skills",
  "braintrust-agent-evals",
  "SKILL.md",
);
async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function expectContainsAll(content: string, expected: string[]): void {
  for (const text of expected) {
    expect(content).toContain(text);
  }
}

function expectContainsAllIgnoringWhitespace(
  content: string,
  expected: string[],
): void {
  const normalizedContent = content.replace(/\s+/g, " ");
  for (const text of expected) {
    expect(normalizedContent).toContain(text.replace(/\s+/g, " "));
  }
}

function expectNotContainsAllIgnoringWhitespace(
  content: string,
  forbidden: string[],
): void {
  const normalizedContent = content.replace(/\s+/g, " ");
  for (const text of forbidden) {
    expect(normalizedContent).not.toContain(text.replace(/\s+/g, " "));
  }
}

describe("agent skills packaging", () => {
  it("documents canonical target guidance for package and repository scope", async () => {
    const [mcpContent, codeReference, packageReference] = await Promise.all([
      read(githitsMcpSkillPath),
      read(githitsCodeReferencePath),
      read(githitsPackageReferencePath),
    ]);

    for (const content of [mcpContent, codeReference]) {
      expectContainsAll(content, [
        "swift:github.com/<owner>/<repo>",
        "zig:gh/<owner>/<repo>",
        "artifact/manifest root",
        "public GitHub repository",
        "full repositories or sibling packages",
      ]);
    }

    expectContainsAll(packageReference, [
      "swift:github.com/<owner>/<repo>",
      "zig:gh/<owner>/<repo>",
    ]);
  });

  it("packages a public githits-onboarding skill with setup-focused frontmatter", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "name: githits-onboarding",
      "Use when the user asks to",
      "install",
      "connect",
      "configure",
      "sign in",
      "sign up",
      "start using GitHits",
      "setup recovery",
      "compatibility:",
    ]);
  });

  it("documents current onboarding commands without inventing auth JSON", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "Use `npx -y githits@latest ...` for every normal onboarding command.",
      "guarantees the latest published GitHits CLI behavior",
      "Do not use a globally installed `githits` binary",
      "local, dev, or pinned CLI build",
      "npx -y githits@latest auth status",
      "npx -y githits@latest init --detect-agents --json",
      "npx -y githits@latest init --project --detect-agents --json",
      "npx -y githits@latest init --install-agents",
      "npx -y githits@latest init --project --install-agents",
      "npx -y githits@latest login",
      "npx -y githits@latest login --no-browser",
      "also prints a fallback sign-in URL",
    ]);
    expect(content).not.toContain("command -v githits");
    expect(content).not.toContain("{GITHITS}");
    expect(content).not.toContain("auth status --json");
  });

  it("keeps onboarding auth and setup safety guardrails", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "browser OAuth",
      "browser tab",
      "passwords",
      "OAuth codes",
      "cookies",
      "access tokens",
      "refresh tokens",
      "API keys",
      "Ask before writing configuration",
      "Ask before launching browser OAuth",
      "surface the printed sign-in URL clearly",
      "relay the URL verbatim",
      "Do not run `init -y` or `init --yes` unless the user explicitly asks",
    ]);
  });

  it("frames onboarding as new-user signup with configure-all as the default", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "new-user onboarding skill",
      "Configure all actionable tools (Recommended)",
      "recommended default option",
      "selective setup option",
      'Do not present "configure none" as a normal onboarding choice',
      "Start GitHits sign-in/signup during onboarding",
      "Do not ask whether the user wants to log in",
      "Login creates or connects the GitHits account",
    ]);
    expect(content).not.toContain(
      "If auth is required, ask before launching browser login",
    );
  });

  it("uses project-vs-user setup scope and structured choices instead of freeform IDs", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "structured choice",
      "Do not ask the user to type",
      "My user account (Recommended)",
      "This project only",
      "project-local MCP",
      "may be committed",
      "unsupported_project_config",
      "Do not ask the user to type comma-separated tool IDs unless the current agent interface has no structured choice mechanism.",
    ]);
  });

  it("keeps Codex-style onboarding commands inline and avoids inferred install IDs", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "Run onboarding commands inline",
      "Do not delegate",
      "do not use subagents",
      "subagents",
      "background",
      "background terminals",
      "Do not start `npx -y githits@latest init --detect-agents --json` as a background task",
      "Do not run `pkill`",
      "Run detection inline",
      "Wait for JSON",
      "official detection fails",
      "do not inspect package internals",
      "manually probe tools to infer install IDs",
      "stop and report that GitHits CLI is unavailable",
    ]);
  });

  it("includes onboarding troubleshooting for known recovery paths", async () => {
    const content = await read(troubleshootingPath);

    expectContainsAll(content, [
      "Authentication Timeout",
      "keychain",
      "login --no-browser",
      "GITHITS_API_TOKEN",
      "GITHITS_AUTH_STORAGE=file",
      "plaintext",
    ]);
  });

  it("keeps install review and guidance repair behavior in the canonical onboarding skill", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "actionableIds",
      "use `installableIds` for MCP setup",
      "do not infer guidance-only repair",
      "guidance repair",
      "GitHits queries and public package, repository, and documentation targets are sent to GitHits services",
      "Feedback submission is an outbound write",
      "does not itself upload the local workspace",
      "new coding-agent session",
      "terminal and machine do not need to be restarted",
      "every agent is `not_detected`",
      "stop before review, installation, or authentication",
      "offer user-level detection",
      "continue only with supported agents",
      "at least one supported agent is `already_configured`",
      "execute `suggestedCommand` exactly",
      "preserve `--no-guidance`",
      "Follow the CLI-emitted verification instruction",
      "acknowledges the install review",
      "stop onboarding without installing or starting authentication",
      "https://mcp.githits.com",
      "Cursor-managed OAuth",
      "cursor-agent mcp list-tools GitHits",
      "new Cursor Agent chat",
    ]);
    const reviewIndex = content.indexOf("show the install review before");
    const classificationIndex = content.indexOf(
      "Before showing the review, classify",
    );
    const approvalIndex = content.indexOf("Ask before writing configuration");
    const authIndex = content.indexOf("Start GitHits sign-in/signup");
    expect(classificationIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThan(classificationIndex);
    expect(approvalIndex).toBeGreaterThan(reviewIndex);
    expect(authIndex).toBeGreaterThan(approvalIndex);
  });

  it("packages the canonical GitHits MCP skill with OSS context triggers", async () => {
    const publicContent = (await read(githitsMcpSkillPath)).replace(
      /\r\n/g,
      "\n",
    );
    const quickStartHeading = "## Quick-start guide\n\n";
    const quickStartIndex = publicContent.indexOf(quickStartHeading);
    expect(quickStartIndex).toBeGreaterThanOrEqual(0);
    expect(publicContent.indexOf(quickStartHeading, quickStartIndex + 1)).toBe(
      -1,
    );
    const embeddedGuide = publicContent
      .slice(quickStartIndex + quickStartHeading.length)
      .replace(/\n$/, "");

    expectContainsAllIgnoringWhitespace(publicContent, [
      "name: githits-mcp",
      "Use GitHits MCP as the preferred source of public OSS/package evidence",
      "Load before any GitHits MCP tool call",
      "packages, frameworks, SDKs, dependencies, releases, security, documentation",
      "repository source/code search",
      "canonical examples",
      "public OSS/package evidence",
      "discovery, planning, research, implementation, debugging, or maintenance",
      "repository source",
      "vulnerabilities",
      "upgrade review",
      "this skill already includes the stable\nquick-start guide below",
      "Do not call `quick_start` when this skill is loaded",
      "this rule applies to every GitHits tool",
      "for routing, scope, target syntax,\noutput, safety, citations, and recovery",
    ]);
    expect(embeddedGuide).toBe(buildMcpQuickStart());
    expect(publicContent).toContain("External-content posture");
    expectNotContainsAllIgnoringWhitespace(publicContent, [
      "call `quick_start` once per session",
      "Experimental",
      "githits-code",
      "githits-package",
      "**Local experimental tools",
      "**Issue reporting",
    ]);
  });

  it("keeps CLI skill triggers transport-specific and domain-separated", async () => {
    const [codeContent, packageContent] = await Promise.all([
      read(githitsCodeSkillPath),
      read(join(root, "skills", "githits-package", "SKILL.md")),
    ]);

    expectContainsAllIgnoringWhitespace(codeContent, [
      "Use whenever invoking the GitHits CLI",
      "source, documentation, or example evidence",
      "For GitHits CLI package, dependency, security, release, or upgrade evidence, use githits-package",
    ]);
    expectContainsAllIgnoringWhitespace(packageContent, [
      "Use whenever invoking the GitHits CLI",
      "package or dependency evidence",
      "vulnerabilities",
      "upgrade reviews",
    ]);
  });

  it("keeps code skill pagination guidance aligned with CLI output", async () => {
    const content = await read(githitsCodeSkillPath);

    expectContainsAll(content, [
      "Documentation text reads honor the requested range",
      "Use explicit `--lines` windows to keep only needed context",
      "pass `--json` when you need `startLine`, `endLine`, or `totalLines` metadata",
    ]);
  });

  it("requires generated plugin asset validation before package creation", async () => {
    const packageJson = JSON.parse(await read(join(root, "package.json"))) as {
      scripts?: Record<string, string>;
      files?: string[];
    };

    expect(packageJson.scripts?.["plugins:generate"]).toContain(
      "scripts/generate-plugin-assets.ts",
    );
    expect(packageJson.scripts?.["plugins:check"]).toContain("--check");
    expect(packageJson.scripts?.prepack).toBe("bun run plugins:check");
    expect(packageJson.scripts?.postpack).toBeUndefined();
    expect(packageJson.files).toContain("skills");
    expect(packageJson.files).toContain(".codex-plugin");
    expect(packageJson.files).toContain("plugin.json");
    expect(packageJson.files).toContain("mcp.json");
    expect(packageJson.files).toContain("mcp_config.json");
    expect(packageJson.files).not.toContain(".agents");
    expect(packageJson.files).not.toContain("plugins");
    expect(packageJson.files).not.toContain("commands");
  });

  it("keeps the plugin maintenance skill repository-internal", async () => {
    const content = await read(pluginMaintenanceSkillPath);

    expectContainsAll(content, [
      "Internal repository-maintenance skill",
      "internal, repository-only skill",
      "Do not publish or package it",
    ]);
  });

  it("keeps the Braintrust eval skill repository-internal", async () => {
    const content = await read(braintrustAgentEvalsSkillPath);
    const match = content.match(/^---\r?\n(.*?)\r?\n---/s);

    expect(match).not.toBe(null);

    const parsed = parseYaml(match?.[1] ?? "") as {
      metadata?: { internal?: boolean };
    };

    expect(parsed.metadata?.internal).toBe(true);
  });

  it("has valid YAML frontmatter in every public skill SKILL.md", async () => {
    const skillsDir = join(root, "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    expect(skillDirs.length).toBeGreaterThanOrEqual(4);

    for (const dir of skillDirs) {
      const skillPath = join(skillsDir, dir, "SKILL.md");
      const content = await read(skillPath);

      const match = content.match(/^---\r?\n(.*?)\r?\n---/s);
      expect(
        match,
        `${dir}/SKILL.md must start with YAML frontmatter`,
      ).not.toBe(null);

      const frontmatter = match?.[1] ?? "";
      let parsed: unknown;
      try {
        parsed = parseYaml(frontmatter);
      } catch (e) {
        throw new Error(
          `${dir}/SKILL.md has invalid YAML frontmatter: ${(e as Error).message}`,
        );
      }

      expect(
        typeof parsed,
        `${dir}/SKILL.md frontmatter must parse to an object`,
      ).toBe("object");
      const record = parsed as Record<string, unknown>;
      expect(record.name, `${dir}/SKILL.md must have a name`).toBeDefined();
      expect(
        record.description,
        `${dir}/SKILL.md must have a description`,
      ).toBeDefined();
      const metadata = record.metadata as Record<string, unknown> | undefined;
      expect(
        metadata?.internal,
        `${dir}/SKILL.md must remain publicly discoverable`,
      ).not.toBe(true);
    }
  });
});
