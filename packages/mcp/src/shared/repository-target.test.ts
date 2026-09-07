import { describe, expect, it } from "bun:test";
import {
  formatRepositoryTarget,
  formatRepositoryTargetLabel,
  parseRepositoryTargetSpec,
} from "./repository-target.js";

describe("formatRepositoryTarget", () => {
  it("formats GitHub repo targets with compact canonical # refs", () => {
    expect(
      formatRepositoryTarget("https://github.com/n8n-io/n8n", "n8n@2.26.5"),
    ).toBe("github:n8n-io/n8n#n8n@2.26.5");
  });

  it("falls back to URL form for non-compactable repo URLs", () => {
    expect(
      formatRepositoryTarget("https://example.com/owner/repo", "main"),
    ).toBe("https://example.com/owner/repo#main");
  });
});

describe("formatRepositoryTargetLabel", () => {
  it("canonicalizes backend owner/repo@ref labels without truncating @ inside refs", () => {
    expect(
      formatRepositoryTargetLabel(
        "n8n-io/n8n@n8n@2.26.5",
        "https://github.com/n8n-io/n8n",
      ),
    ).toBe("github:n8n-io/n8n#n8n@2.26.5");
  });

  it("does not rewrite package-style labels", () => {
    expect(formatRepositoryTargetLabel("npm:express@5.2.1")).toBeUndefined();
  });

  it("does not URL-encode human-readable default-branch labels", () => {
    expect(
      formatRepositoryTargetLabel("expressjs/express default branch"),
    ).toBeUndefined();
  });
});

const providers = [
  ["github", "github.com", "owner/repo"],
  ["codeberg", "codeberg.org", "zigil/decimal"],
  ["gitlab", "gitlab.com", "group/subgroup/project"],
] as const;

describe("direct repository grammar", () => {
  for (const [provider, host, path] of providers) {
    for (const form of [`${provider}:${path}`, `https://${host}/${path}`]) {
      it.each([undefined, "main", "release/v1@stable", "tag@v1@beta"])(
        `${form} round trips ref %s`,
        (ref) => {
          for (const delimiter of ["#", "@"]) {
            const target = parseRepositoryTargetSpec(
              form + (ref === undefined ? "" : delimiter + ref),
            );
            expect(target).toEqual({
              repoUrl: `https://${host}/${path}`,
              ...(ref === undefined ? {} : { gitRef: ref }),
            });
            expect(formatRepositoryTarget(target.repoUrl!, target.gitRef)).toBe(
              `${provider}:${path}` + (ref === undefined ? "" : `#${ref}`),
            );
          }
        },
      );
      it.each([
        "#",
        "@",
        "@main#dev",
        "#main#dev",
        "?",
        "?q=1",
        "/../other",
        "/%2e%2e/other",
        "//other",
        "/-/tree/main",
      ])(`${form} rejects suffix %s`, (suffix) => {
        expect(() => parseRepositoryTargetSpec(form + suffix)).toThrow();
      });
    }
    it(`${provider} preserves explicit backend identity in bare labels`, () => {
      expect(
        formatRepositoryTargetLabel(
          `${path}@release/v1@stable`,
          `https://${host}/${path}`,
        ),
      ).toBe(`${provider}:${path}#release/v1@stable`);
      expect(formatRepositoryTargetLabel(`${path}@main`)).toBeUndefined();
    });
  }
  it.each([
    "owner/repo",
    "codeberg.org/owner/repo",
    "gitlab.com/group/project",
    "http://codeberg.org/owner/repo",
    "http://gitlab.com/group/project",
    "https://example.com/owner/repo",
    "https://gitlab.example.com/group/project",
    "https://user:password@codeberg.org/owner/repo",
    "https://gitlab.com:8443/group/project",
    "codeberg:owner/repo/src/branch/main",
    "codeberg:owner/repo/issues",
    "github:owner/repo/tree/main",
    "gitlab:group/project/-/blob/main/file",
    "gitlab:group//project",
    "gitlab:group/%70roject",
    "gitlab:group/project\\other",
  ])("rejects %s without provider inference", (spec) => {
    expect(() => parseRepositoryTargetSpec(spec)).toThrow();
  });
  it.each([
    "github.com/owner/repo",
    "http://github.com/owner/repo",
    "HTTPS://GITHUB.COM/owner/repo/",
  ])("preserves GitHub compatibility %s", (spec) => {
    expect(parseRepositoryTargetSpec(spec)).toEqual({
      repoUrl: "https://github.com/owner/repo",
    });
  });
});
