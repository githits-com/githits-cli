import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import history from "./fixtures/mcp-skill-history.json";
import {
  decideSkillUpdate,
  hashSkillContent,
  inspectSkillContent,
  isManagedSkillCurrent,
  renderManagedSkillContent,
} from "./mcp-skill-content.js";
import { LEGACY_MCP_SKILL_HASHES } from "./mcp-skill-history.js";

const original =
  "---\nname: githits-mcp\ndescription: Guide\n---\n\n# Guide\nUse old tools.\n";
const bundled = original.replace("old", "current");

describe("managed MCP skill content", () => {
  it.each(history)("upgrades verified published skill $versions", (fixture) => {
    expect(hashSkillContent(fixture.content)).toBe(fixture.sha256);
    expect(LEGACY_MCP_SKILL_HASHES).toContain(fixture.sha256);
    expect(
      decideSkillUpdate(
        fixture.content,
        bundled,
        "0.26.0",
        LEGACY_MCP_SKILL_HASHES,
      ),
    ).toBe("update");
    expect(
      decideSkillUpdate(
        `${fixture.content} `,
        bundled,
        "0.26.0",
        LEGACY_MCP_SKILL_HASHES,
      ),
    ).toBe("preserve");
  });

  it("keeps the fixed legacy array complete and free of duplicate hashes", () => {
    expect(LEGACY_MCP_SKILL_HASHES).toHaveLength(25);
    expect(new Set(LEGACY_MCP_SKILL_HASHES)).toHaveLength(25);
    expect(history.map((fixture) => fixture.sha256)).toEqual([
      ...LEGACY_MCP_SKILL_HASHES,
    ]);
  });

  it.each(["\n", "\r\n"])(
    "round-trips all payload bytes with %j endings",
    (ending) => {
      const payload = original.replaceAll("\n", ending);
      const installed = renderManagedSkillContent(payload, "0.26.0");
      expect(inspectSkillContent(installed)).toEqual({
        kind: "managed",
        content: payload,
        version: "0.26.0",
      });
      expect(installed).toContain(`sha256=${hashSkillContent(payload)}`);
      expect(
        parseYaml(installed.split(/\r?\n---\r?\n/)[0]?.slice(4) ?? ""),
      ).toMatchObject({
        name: "githits-mcp",
        description: "Guide",
      });
    },
  );

  it("requires checksum integrity across frontmatter, body, and final newline", () => {
    const installed = renderManagedSkillContent(original, "0.26.0");
    for (const modified of [
      installed.replace("Guide", "Edited"),
      installed.replace("old", "new"),
      installed.slice(0, -1),
      `${installed} `,
      installed.replaceAll("\n", "\r\n"),
    ])
      expect(inspectSkillContent(modified)).toEqual({ kind: "modified" });
  });

  it("preserves malformed, duplicate, misplaced, and unsupported reserved markers", () => {
    const installed = renderManagedSkillContent(original, "0.26.0");
    const marker = installed.split("\n")[4] ?? "";
    for (const invalid of [
      installed.replace("v1 version", "v2 version"),
      installed.replace("version=0.26.0", "version=banana"),
      installed.replace("sha256=", "hash="),
      installed.replace(marker, `${marker}\n${marker}`),
      `${original + marker}\n`,
      `${marker}\n${original}`,
    ])
      expect(inspectSkillContent(invalid)).toEqual({ kind: "modified" });
  });

  it("rejects an invalid packaged skill instead of inventing frontmatter", () => {
    expect(() => renderManagedSkillContent("# Guide\n", "0.26.0")).toThrow();
    expect(() =>
      renderManagedSkillContent(
        renderManagedSkillContent(original, "0.25.0"),
        "0.26.0",
      ),
    ).toThrow();
  });

  it("recognizes identical managed payload regardless of its writing version", () => {
    for (const version of ["0.25.0", "0.26.0", "0.27.0"]) {
      const installed = renderManagedSkillContent(bundled, version);
      expect(isManagedSkillCurrent(installed, bundled)).toBe(true);
      expect(decideSkillUpdate(installed, bundled, "0.26.0", [])).toBe(
        "preserve",
      );
    }
    expect(isManagedSkillCurrent(bundled, bundled)).toBe(false);
    expect(
      isManagedSkillCurrent(
        renderManagedSkillContent(original, "0.25.0"),
        bundled,
      ),
    ).toBe(false);
  });

  it("upgrades only exact recognized legacy bytes, preserving current and edited files", () => {
    const history = [hashSkillContent(original), hashSkillContent(bundled)];
    expect(decideSkillUpdate(original, bundled, "0.26.0", history)).toBe(
      "update",
    );
    for (const content of [
      bundled,
      `${original} `,
      original.replaceAll("\n", "\r\n"),
      "unknown",
    ]) {
      expect(decideSkillUpdate(content, bundled, "0.26.0", history)).toBe(
        "preserve",
      );
    }
  });

  it("upgrades future marked versions without adding their hashes to history", () => {
    const future = renderManagedSkillContent(original, "9.1.0");
    expect(decideSkillUpdate(future, bundled, "9.2.0", [])).toBe("update");
  });

  it("preserves equal-version payload differences and warns on newer mismatched guides", () => {
    expect(
      decideSkillUpdate(
        renderManagedSkillContent(original, "0.26.0"),
        bundled,
        "0.26.0",
        [],
      ),
    ).toBe("preserve");
    expect(
      decideSkillUpdate(
        renderManagedSkillContent(original, "0.27.0"),
        bundled,
        "0.26.0",
        [],
      ),
    ).toBe("warn-newer");
  });

  it("never falls back to legacy recognition after marked content is edited", () => {
    const edited = `${renderManagedSkillContent(original, "0.25.0")}edited`;
    expect(
      decideSkillUpdate(edited, bundled, "0.26.0", [hashSkillContent(edited)]),
    ).toBe("preserve");
  });
});
