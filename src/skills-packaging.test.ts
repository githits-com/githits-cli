import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
const claudeOnboardingSkillPath = join(
  root,
  "plugins",
  "claude",
  "skills",
  "onboarding",
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

describe("agent skills packaging", () => {
  it("packages a public githits-onboarding skill with setup-focused frontmatter", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "name: githits-onboarding",
      "Set up GitHits from an agent session",
      "install",
      "connect",
      "set up",
      "sign up",
      "start using GitHits",
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
      "Do not run `init -y` or `init --yes` unless the user explicitly asks",
    ]);
  });

  it("frames onboarding as new-user signup with configure-all as the default", async () => {
    const content = await read(onboardingSkillPath);

    expectContainsAll(content, [
      "new-user onboarding skill",
      "Configure all detected tools (Recommended)",
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

  it("packages Claude marketplace onboarding guidance with matching safety posture", async () => {
    const content = await read(claudeOnboardingSkillPath);

    expectContainsAll(content, [
      "name: onboarding",
      "Use `npx -y githits@latest ...` for every normal onboarding command.",
      "guarantees the latest published GitHits CLI behavior",
      "Do not use a globally installed `githits` binary",
      "local, dev, or pinned CLI build",
      "npx -y githits@latest init --detect-agents --json",
      "npx -y githits@latest init --project --detect-agents --json",
      "npx -y githits@latest init --install-agents",
      "npx -y githits@latest init --project --install-agents",
      "npx -y githits@latest auth status",
      "npx -y githits@latest login",
      "npx -y githits@latest login --no-browser",
      "Configure all detected tools",
      "structured choice",
      "My user account (Recommended)",
      "This project only",
      "sign-in/signup",
      "Run onboarding commands inline",
      "Do not delegate",
      "Do not use subagents",
      "subagents",
      "background",
      "pkill",
      "official detection fails",
      "manually probe tools to infer install IDs",
      "passwords",
      "OAuth codes",
      "cookies",
      "access tokens",
      "refresh tokens",
      "API keys",
    ]);
    expect(content).not.toContain("command -v githits");
    expect(content).not.toContain("{GITHITS}");
  });
});
