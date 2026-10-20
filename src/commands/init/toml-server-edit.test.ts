import { describe, expect, it } from "bun:test";
import { parse } from "smol-toml";
import { mergeServerConfig, removeServerConfig } from "./setup-handlers.js";
import { editTomlServer } from "./toml-server-edit.js";

const fixtures: Record<string, string> = {
  absent: '# Model note\nmodel = "example"\n',
  standard:
    '# Model note\nmodel  =  "example" # model tail\n\n[mcp_servers.githits]\ncommand = "npx"\nargs = ["-y"]\n\n# Sibling note\n[mcp_servers.other]\nurl = "https://example.com" # sibling tail\n',
  descendant:
    '# Model note\nmodel="example"\n[mcp_servers.githits]\ncommand="npx"\n[mcp_servers.githits.env]\nEXAMPLE="fake"\n\n# Sibling note\n[mcp_servers.other]\nurl="https://example.com"\n',
  array_descendant:
    '# Model note\nmodel="example"\n[mcp_servers.GitHits]\ncommand="npx"\n[[mcp_servers.GitHits.example]]\nvalue=1\n[[mcp_servers.GitHits.example]]\nvalue=2\n',
  inline_parent:
    '# Model note\nmodel="example"\nmcp_servers = {githits={command="npx",args=[]}, other={url="https://example.com"}} # integrations\n',
  inline_server:
    '# Model note\nmodel="example"\n[mcp_servers]\ngithits={command="npx",args=[]}\nother={url="https://example.com"} # sibling tail\n',
  dotted:
    '# Model note\nmodel="example"\nmcp_servers.githits.command="npx"\nmcp_servers.githits.args=[]\nmcp_servers.other.url="https://example.com" # sibling tail\n',
  quoted:
    '# Model note\nmodel="example"\n["mcp_servers"."GitHits"]\n"command"="npx"\n["mcp_servers"."other"]\nurl="https://example.com" # sibling tail\n',
  strings_arrays_dates:
    '# Model note\nmodel="example"\ntext="""\n[mcp_servers.githits]\n# string content\n"""\narr=[1, # array note\n2]\nday=2026-10-20\n[mcp_servers.githits]\ncommand="npx"\n',
  variants:
    '# Model note\nmodel="example"\n[mcp_servers.GitHits]\ncommand="npx"\n[mcp_servers.GitHits.env]\nFAKE="value"\n[mcp_servers.githits]\ncommand="other"\n',
  inline_variants:
    '# Model note\nmodel="example"\nmcp_servers={GitHits={command="a"},other={command="b"},githits={command="c"},GITHITS={command="d"}}\n',
  inline_dotted:
    '# Model note\nmodel="example"\nmcp_servers={githits.command="a",githits.args=[],other.command="b"}\n',
  inline_multiline:
    '# Model note\nmcp_servers={\n githits={url="old"}\n, other={url="other"}\n}\n',
  inline_trailing_comma: '# Model note\nmcp_servers={githits={url="old"},}\n',
  inline_absent_trailing_comma:
    '# Model note\nmcp_servers={other={url="other"},}\n',
  inline_comments:
    '# Model note\nmcp_servers={\n githits={url="old"} # target note\n, other={url="other"} # Sibling note\n,}\n',
};
fixtures.crlf = fixtures.standard!.replaceAll("\n", "\r\n");
fixtures.bom = `\uFEFF${fixtures.standard}`;
const remote = { url: "https://mcp.githits.com" };

describe("TOML source preservation", () => {
  for (const [name, source] of Object.entries(fixtures)) {
    for (const operation of ["merge", "remove"] as const) {
      it(`${name}: ${operation} preserves unrelated source and settings`, () => {
        const expected = parse(source.replace(/^\uFEFF/, "")) as Record<
          string,
          unknown
        >;
        expected.mcp_servers ??= {};
        const servers = expected.mcp_servers as Record<string, unknown>;
        for (const key of Object.keys(servers))
          if (key.toLowerCase() === "githits") delete servers[key];
        if (operation === "merge") servers.githits = remote;
        const result =
          operation === "merge"
            ? mergeServerConfig(
                source,
                "mcp_servers",
                "githits",
                remote,
                "toml",
              )
            : removeServerConfig(source, "mcp_servers", "githits", "toml");
        if (
          operation === "remove" &&
          ["absent", "inline_absent_trailing_comma"].includes(name)
        ) {
          expect(result.status).toBe("not_configured");
          return;
        }
        expect("content" in result).toBe(true);
        if (!("content" in result)) throw new Error(result.status);
        const content = result.content;
        expect(parse(content.replace(/^\uFEFF/, "")) as unknown).toEqual(
          expected,
        );
        for (const comment of [
          "# Model note",
          "# Sibling note",
          "# sibling tail",
          "# array note",
          "# integrations",
        ])
          if (source.includes(comment)) expect(content).toContain(comment);
        // Untouched key lines retain spacing, inline comments, quotes and values exactly.
        for (const line of source.split(/\r?\n/))
          if (/^(model|url|other|text|arr|2\]|day)/.test(line))
            expect(content).toContain(line);
        if (name === "crlf")
          expect(content.replaceAll("\r\n", "")).not.toContain("\n");
        if (name === "bom") expect(content.startsWith("\uFEFF")).toBe(true);
        if (operation === "merge")
          expect(
            mergeServerConfig(content, "mcp_servers", "githits", remote, "toml")
              .status,
          ).toBe("already_configured");
      });
    }
  }
  it("leaves malformed documents unchanged", () => {
    expect(
      mergeServerConfig(
        "[mcp_servers\n",
        "mcp_servers",
        "githits",
        remote,
        "toml",
      ).status,
    ).toBe("parse_error");
    expect(
      removeServerConfig("[mcp_servers\n", "mcp_servers", "githits", "toml")
        .status,
    ).toBe("parse_error");
  });
  it("rejects edits whose parsed values differ from the expected document", () => {
    expect(() =>
      editTomlServer('model = "example"\n', "mcp_servers", "githits", remote, {
        model: "changed",
        mcp_servers: { githits: remote },
      }),
    ).toThrow("File left unchanged");
  });
});
