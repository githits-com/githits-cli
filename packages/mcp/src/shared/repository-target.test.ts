import { describe, expect, it } from "bun:test";
import {
  formatRepositoryTarget,
  formatRepositoryTargetLabel,
  isCanonicalRepositoryUrl,
  isRepositoryTargetSpec,
  parseRepositoryTargetSpec,
} from "./repository-target.js";

describe("formatRepositoryTarget", () => {
  it("formats GitHub repo targets with compact canonical @ refs", () => {
    expect(
      formatRepositoryTarget("https://github.com/n8n-io/n8n", "n8n@2.26.5"),
    ).toBe("github:n8n-io/n8n@n8n@2.26.5");
  });

  it("falls back to URL form for non-compactable repo URLs", () => {
    expect(
      formatRepositoryTarget("https://example.com/owner/repo", "main"),
    ).toBe("https://example.com/owner/repo@main");
  });
});

describe("Googlesource HTTPS repository grammar", () => {
  it.each([
    ["https://go.googlesource.com/time", "https://go.googlesource.com/time"],
    [
      "https://go.googlesource.com/sync.git/",
      "https://go.googlesource.com/sync",
    ],
    [
      "HTTPS://CHROMIUM.GOOGLESOURCE.COM/Chromium/Src/",
      "https://chromium.googlesource.com/Chromium/Src",
    ],
    [
      "https://a.b-c.googlesource.com/_Project/.hidden/repo-name_1.2",
      "https://a.b-c.googlesource.com/_Project/.hidden/repo-name_1.2",
    ],
    [
      "https://go-review.googlesource.com/time",
      "https://go-review.googlesource.com/time",
    ],
  ])("canonicalizes %s without a compact prefix", (input, repoUrl) => {
    for (const gitRef of [
      undefined,
      "v0.16.0",
      "release/v1@stable",
      "fb013b3d",
      "fb013b3d305a26f5ef5350a6eaffc7c87a200383",
    ]) {
      const spec = `${input}${gitRef === undefined ? "" : `@${gitRef}`}`;
      expect(isRepositoryTargetSpec(spec)).toBe(true);
      expect(parseRepositoryTargetSpec(spec)).toEqual({
        repoUrl,
        ...(gitRef === undefined ? {} : { gitRef }),
      });
      const formatted = formatRepositoryTarget(repoUrl, gitRef);
      expect(formatted).toBe(
        `${repoUrl}${gitRef === undefined ? "" : `@${gitRef}`}`,
      );
      expect(parseRepositoryTargetSpec(formatted)).toEqual(
        parseRepositoryTargetSpec(spec),
      );
    }
    expect(isCanonicalRepositoryUrl(repoUrl)).toBe(true);
    expect(formatRepositoryTarget(input, "main")).toBe(`${repoUrl}@main`);
    expect(formatRepositoryTargetLabel(`${repoUrl}@v0.16.0`)).toBe(
      `${repoUrl}@v0.16.0`,
    );
  });

  it.each([
    "http://go.googlesource.com/time",
    "git://go.googlesource.com/time",
    "ssh://go.googlesource.com/time",
    "git+https://go.googlesource.com/time",
    "googlesource:go/time",
    "go.googlesource.com/time",
    "https://googlesource.com/time",
    "https://go.googlesource.com.evil.test/time",
    "https://evilgooglesource.com/time",
    "https://-go.googlesource.com/time",
    "https://go-.googlesource.com/time",
    "https://go..googlesource.com/time",
    `https://${"a".repeat(64)}.googlesource.com/time`,
    `https://${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(47)}.googlesource.com/time`,
    "https://go.googlesource.com./time",
    "https://%67o.googlesource.com/time",
    "https://go%2egooglesource.com/time",
    "https://gö.googlesource.com/time",
    "https://user@go.googlesource.com/time",
    "https://user:password@go.googlesource.com/time",
    "https://go.googlesource.com:/time",
    "https://go.googlesource.com:443/time",
    "https://go.googlesource.com:8443/time",
    "https://go.googlesource.com/",
    "https://go.googlesource.com/.git",
    "https://go.googlesource.com/time.git.git",
    "https://go.googlesource.com/time//",
    "https://go.googlesource.com/time/./other",
    "https://go.googlesource.com/time/../other",
    "https://go.googlesource.com/time/%2e%2e/other",
    "https://go.googlesource.com/time%2Fother",
    "https://go.googlesource.com/time%5cother",
    "https://go.googlesource.com/%74ime",
    "https://go.googlesource.com/time%252Fother",
    "https://go.googlesource.com/time\\other",
    "https://go.googlesource.com/timé",
    "https://go.googlesource.com/time?",
    "https://go.googlesource.com/time?format=TEXT",
    "https://go.googlesource.com/time#readme",
    "https://go.googlesource.com/time@main#readme",
    "https://go.googlesource.com/time@",
    "https://go.googlesource.com/time/+/refs/heads/master/rate/rate.go",
    "https://go.googlesource.com/time/+log",
    "https://go.googlesource.com/time/+refs",
    "https://go.googlesource.com/time/+archive/main.tar.gz",
  ])("rejects %s", (spec) => {
    expect(() => parseRepositoryTargetSpec(spec)).toThrow();
    expect(isCanonicalRepositoryUrl(spec)).toBe(false);
  });
});

describe("formatRepositoryTargetLabel", () => {
  it("canonicalizes backend owner/repo@ref labels without truncating @ inside refs", () => {
    expect(
      formatRepositoryTargetLabel(
        "n8n-io/n8n@n8n@2.26.5",
        "https://github.com/n8n-io/n8n",
      ),
    ).toBe("github:n8n-io/n8n@n8n@2.26.5");
  });

  it("migrates typed legacy backend labels without accepting them as input", () => {
    expect(
      formatRepositoryTargetLabel(
        "github:n8n-io/n8n#n8n@2.26.5",
        "https://github.com/n8n-io/n8n",
      ),
    ).toBe("github:n8n-io/n8n@n8n@2.26.5");
    expect(() =>
      parseRepositoryTargetSpec("github:n8n-io/n8n#n8n@2.26.5"),
    ).toThrow(
      'Repository target "github:n8n-io/n8n#n8n@2.26.5" uses legacy #ref syntax. Use "github:n8n-io/n8n@n8n@2.26.5"; # is reserved for semantic fragments.',
    );
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
  ["launchpad", "git.launchpad.net", "~Owner/+git/Repo"],
  ["launchpad", "git.launchpad.net", "~Owner/Project/+git/Repo"],
  ["launchpad", "git.launchpad.net", "~Owner/Distro/+source/Source/+git/Repo"],
] as const;

describe("direct repository grammar", () => {
  for (const [provider, host, path] of providers) {
    for (const form of [`${provider}:${path}`, `https://${host}/${path}`]) {
      it.each([undefined, "main", "release/v1@stable", "tag@v1@beta"])(
        `${form} round trips ref %s`,
        (ref) => {
          const target = parseRepositoryTargetSpec(
            form + (ref === undefined ? "" : `@${ref}`),
          );
          expect(target).toEqual({
            repoUrl: `https://${host}/${path}`,
            ...(ref === undefined ? {} : { gitRef: ref }),
          });
          expect(formatRepositoryTarget(target.repoUrl!, target.gitRef)).toBe(
            `${provider}:${path}${ref === undefined ? "" : `@${ref}`}`,
          );
        },
      );
      it(`${form} rejects legacy #ref with an exact migration`, () => {
        expect(() => parseRepositoryTargetSpec(`${form}#main`)).toThrow(
          `Use "${form}@main"; # is reserved for semantic fragments.`,
        );
      });
      it.each([
        "@",
        "@main#dev",
        "#",
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
      ).toBe(`${provider}:${path}@release/v1@stable`);
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

it.each([
  ["https://github.com:443/owner/repo", "https://github.com/owner/repo"],
  ["http://github.com:80/owner/repo", "https://github.com/owner/repo"],
  ["https://codeberg.org:443/owner/repo", "https://codeberg.org/owner/repo"],
  [
    "https://gitlab.com:443/group/subgroup/project",
    "https://gitlab.com/group/subgroup/project",
  ],
])("normalizes the protocol default port in %s", (spec, repoUrl) => {
  expect(parseRepositoryTargetSpec(spec!)).toEqual({ repoUrl });
});

it.each([
  "https://github.com\\other/owner/repo",
  "https://codeberg.org?other/owner/repo",
  "https://gitlab.com#other/group/project",
])(
  "rejects authority strings that URL would reinterpret as paths: %s",
  (spec) => {
    expect(() => parseRepositoryTargetSpec(spec)).toThrow();
  },
);

describe("GitLab reserved web routes", () => {
  it.each([
    "tree/main",
    "blob/main/README.md",
    "raw/main",
    "commits/main",
    "blame/main/file",
    "-/issues",
    "environments/folders/staging",
    "gitlab-lfs/objects/oid",
    "info/lfs/objects/oid",
  ])("rejects a reserved web route %s", (route) => {
    for (const root of [
      "gitlab:group/project",
      "https://gitlab.com/group/subgroup/project",
    ]) {
      expect(() => parseRepositoryTargetSpec(`${root}/${route}`)).toThrow(
        "GitLab web subpaths",
      );
    }
  });
  it.each([
    "api/v4/projects",
    "explore/projects",
    "groups/group/project",
    "users/name",
  ])("rejects top-level web route %s", (path) => {
    expect(() =>
      parseRepositoryTargetSpec(`https://gitlab.com/${path}`),
    ).toThrow();
  });
  it.each([
    "group/issues",
    "group/subgroup/merge_requests",
    "tree/group/project",
    "group/tree-tools/project",
  ])("preserves unreserved repository identity %s", (path) => {
    expect(parseRepositoryTargetSpec(`gitlab:${path}`)).toEqual({
      repoUrl: `https://gitlab.com/${path}`,
    });
  });
});

describe("Launchpad repository grammar", () => {
  it.each(["lp:", "lp:~owner", "lp:~owner/+git"])(
    "gives concise correction guidance for an incomplete identity %s",
    (target) => {
      expect(() => parseRepositoryTargetSpec(target)).toThrow(
        "Invalid Launchpad Git target. Use lp:PROJECT or lp:~owner/project/+git/repo, with optional @ref.",
      );
    },
  );
  for (const path of [
    "Project",
    "Distro/+source/Source",
    "~Owner/Project",
    "~Owner/Distro/+source/Source",
  ]) {
    it.each([
      "launchpad:",
      "LAUNCHPAD:",
      "lp:",
      "LP:",
      "lP:",
      "Lp:",
      "https://git.launchpad.net/",
      "HTTPS://CODE.LAUNCHPAD.NET:443/",
    ])(`admits ${path} default via %s without acquiring identity`, (prefix) => {
      expect(
        parseRepositoryTargetSpec(`${prefix}${path}/@Feature/KeepCase@Nested`),
      ).toEqual({
        repoUrl: `https://git.launchpad.net/${path}`,
        gitRef: "Feature/KeepCase@Nested",
      });
      expect(() => parseRepositoryTargetSpec(`${prefix}${path}#main`)).toThrow(
        `Use "${prefix}${path}@main"`,
      );
      expect(formatRepositoryTarget(`https://git.launchpad.net/${path}`)).toBe(
        `https://git.launchpad.net/${path}`,
      );
    });
  }
  it("decodes default namespace components only once", () => {
    expect(
      parseRepositoryTargetSpec(
        "LP:%7EOwner/%44istro/%2Bsource/Source.git@HEAD",
      ),
    ).toEqual({
      repoUrl: "https://git.launchpad.net/~Owner/Distro/+source/Source.git",
      gitRef: "HEAD",
    });
  });
  it.each([
    "lp:Project@main",
    "https://code.launchpad.net/Project@main",
    "lp:Project#main",
  ])("keeps short correlation label %s unformatted", (label) => {
    const url = "https://git.launchpad.net/~Owner/Project/+git/Repo";
    expect(formatRepositoryTargetLabel(label, url)).toBeUndefined();
    expect(formatRepositoryTargetLabel(label)).toBeUndefined();
    expect(
      formatRepositoryTargetLabel(label, "https://git.launchpad.net/Project"),
    ).toBeUndefined();
  });
  it.each(["launchpad:", "LAUNCHPAD:", "lp:", "LP:", "lP:", "Lp:"])(
    "normalizes %s preserving escaped identity and ref bytes",
    (prefix) => {
      expect(
        parseRepositoryTargetSpec(
          `${prefix}~Owner/Project/+git/UpperRepo%402@Feature/KeepCase@Nested`,
        ),
      ).toEqual({
        repoUrl: "https://git.launchpad.net/~Owner/Project/+git/UpperRepo@2",
        gitRef: "Feature/KeepCase@Nested",
      });
    },
  );
  it.each([
    "https://git.launchpad.net:443/",
    "HTTPS://CODE.LAUNCHPAD.NET/",
    "git://git.launchpad.net/",
    "GIT://GIT.LAUNCHPAD.NET:9418/",
  ])("canonicalizes supported transport %s", (base) => {
    expect(
      parseRepositoryTargetSpec(
        `${base}%7EOwner/%50roject/%2Bgit/Repo%402/@feature/a@b`,
      ),
    ).toEqual({
      repoUrl: "https://git.launchpad.net/~Owner/Project/+git/Repo@2",
      gitRef: "feature/a@b",
    });
  });
  it.each([
    "lp:",
    "lp:~Owner",
    "lp:project/+git/repo",
    "lp:~Owner/+git/",
    "lp:~Owner/+git/Repo.git",
    "lp:~Owner/+git/Repo.git/",
    "lp:~Owner/+git/Repo//",
    "lp:~Owner/+git/Repo/../Other",
    "lp:~Owner/+git/Repo%2fOther",
    "lp:~Owner/+git/Repo%5cOther",
    "lp:~Owner/+git/Repo%252fOther",
    "lp:~Owner/+git/Repo%23Other",
    "lp:~Owner/+git/Repo%3fOther",
    "lp:~Owner/+git/Repo%",
    "lp:~Owner/+git/Repo%GG",
    "lp:~Owner/+git/Repo%00",
    "lp:~Owner/+git/Repo%09",
    "lp:~Owner/+git/Repo%7F",
    "lp:~Owner/+git/Repo%EF%BF%BD",
    "lp:~Owner/+git/Repo%EF%BB%BF",
    "git://git@git.launchpad.net/~Owner/+git/Repo",
    "git://git.launchpad.net:/~Owner/+git/Repo",
    "lp:~Owner/+git/Repo%20Other",
    "lp:~Owner/+git/Repo\\Other",
    "lp:~Owner/+git/Repo?download=1",
    "lp:~Owner/+git/Repo@",
    "lp:~Owner/+git/Repo/+log",
    "lp:~Owner/+Git/Repo",
    "lp:~Owner/+git/.Repo",
    "lp:~Owner%40Other/+git/Repo",
    "lp:~Owner/+git/Repo%FF",
    "http://git.launchpad.net/~Owner/+git/Repo",
    "git://code.launchpad.net/~Owner/+git/Repo",
    "https://git.launchpad.net:9418/~Owner/+git/Repo",
    "git://git.launchpad.net:443/~Owner/+git/Repo",
    "https://user@git.launchpad.net/~Owner/+git/Repo",
    "https://git.launchpad.net:/~Owner/+git/Repo",
    "ssh://git@git.launchpad.net/~Owner/+git/Repo",
    "git+https://git.launchpad.net/~Owner/+git/Repo",
    "https://git.launchpad.net.evil.test/~Owner/+git/Repo",
    "git://git.launchpad.net/Project",
    "git://git.launchpad.net/~Owner/Project",
    "git://git.launchpad.net:9418/Distro/+source/Source",
    "lp:Project/extra",
    "lp:~Owner/Project/extra",
    "lp:Distro/+Source/Source",
    "lp:~Owner/Distro/+source",
    "lp:Project%2FOther",
    "lp:Project%252FOther",
    "lp:%2E%2E",
    "lp:~Owner%40Other/Project",
    "lp:.Project",
    "lp:Project@",
  ])("rejects unsupported or unsafe target %s", (target) => {
    expect(() => parseRepositoryTargetSpec(target)).toThrow();
  });
  it("escapes literal repository @ in canonical URL output and backend labels", () => {
    const repoUrl = "https://git.launchpad.net/~Owner/+git/Repo@2";
    const target = "launchpad:~Owner/+git/Repo%402@release/a@b";
    expect(formatRepositoryTarget(repoUrl, "release/a@b")).toBe(target);
    expect(parseRepositoryTargetSpec(target)).toEqual({
      repoUrl,
      gitRef: "release/a@b",
    });
    expect(
      formatRepositoryTargetLabel("~Owner/+git/Repo@2@release/a@b", repoUrl),
    ).toBe(target);
    expect(
      formatRepositoryTargetLabel("lp:~Owner/+git/Repo%402@release/a@b"),
    ).toBe(target);
    expect(formatRepositoryTargetLabel("~Owner/+git/Repo@2", repoUrl)).toBe(
      "launchpad:~Owner/+git/Repo%402",
    );
    expect(formatRepositoryTarget(repoUrl)).toBe(
      "launchpad:~Owner/+git/Repo%402",
    );
    expect(parseRepositoryTargetSpec("launchpad:~Owner/+git/Repo%402")).toEqual(
      { repoUrl },
    );
  });
});

it.each([
  "git://github.com/owner/repo",
  "git://codeberg.org/owner/repo",
  "git://gitlab.com/group/project",
])("keeps non-Launchpad git transport unrecognized: %s", (spec) => {
  expect(isRepositoryTargetSpec(spec)).toBe(false);
  expect(() => parseRepositoryTargetSpec(spec)).toThrow();
});
