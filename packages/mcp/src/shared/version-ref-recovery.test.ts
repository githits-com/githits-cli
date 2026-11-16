import { describe, expect, it } from "bun:test";
import { parseVersionRefRecovery } from "@githits/core-internal";
import { buildCliMappedErrorPayload } from "../../../../src/commands/format-mapped-error.js";
import { mcpMappedErrorResult } from "../tools/shared.js";
import type { MappedError } from "./mapped-error.js";
import { formatMappedErrorText } from "./mapped-error-text.js";
import {
  mapVersionRefRecovery,
  withVersionRefRecovery,
} from "./version-ref-recovery.js";

const version: MappedError = {
  code: "VERSION_NOT_FOUND",
  message: "Neutral backend prose. Did you mean v20.10.0+incompatible?",
  retryable: false,
  details: {
    package: "go:github.com/docker/docker",
    requestedVersion: "v20.10.0",
    availablePackageVersions: ["v20.10.0+incompatible"],
  },
};
const ref: MappedError = {
  code: "REF_NOT_FOUND",
  message: "Neutral prose. Did you mean v5.3.0? Verify the tag or branch.",
  retryable: false,
  details: {
    repoUrl: "https://github.com/expressjs/express",
    requestedRef: "bad",
    suggestedRefs: [{ ref: "v5.3.0" }, { ref: "v5.2.1" }],
    availableRefs: [{ ref: "HEAD" }],
  },
};

describe("native version/ref recovery", () => {
  it("preserves snapshot tag suggestions instead of selecting an older indexed version", () => {
    const mapped: MappedError = {
      code: "VERSION_NOT_FOUND",
      message: "No source snapshot for npm:x@1.2.3. Try tag release-1.2.3.",
      details: {
        package: "npm:x",
        requestedVersion: "1.2.3",
        repoUrl: "https://github.com/owner/x",
        suggestedRefs: [{ ref: "release-1.2.3" }],
        availableVersions: [{ ref: "v1.0.0", version: "1.0.0" }],
      },
    };
    const context = {
      syntax: "mcp" as const,
      tool: "read",
      args: { target: "npm:x@1.2.3", path: "README.md" },
    };
    expect(
      withVersionRefRecovery(mapped, context).details?.action,
    ).toBeUndefined();
    expect(formatMappedErrorText(mapped, { recovery: context })).toBe(
      mapped.message,
    );
    const emptyRegistry = {
      ...mapped,
      details: { ...mapped.details, availablePackageVersions: [] },
    };
    expect(
      withVersionRefRecovery(emptyRegistry, context).details?.action,
    ).toBeUndefined();
    expect(formatMappedErrorText(emptyRegistry, { recovery: context })).toBe(
      mapped.message,
    );
    // Registry alternatives remain authoritative even when repository facts coexist.
    expect(
      withVersionRefRecovery(
        {
          ...mapped,
          details: { ...mapped.details, availablePackageVersions: ["1.2.4"] },
        },
        context,
      ).details?.action,
    ).toBe('Retry read with target="npm:x@1.2.4".');
    const indexedOnly = {
      ...mapped,
      details: { ...mapped.details, suggestedRefs: [] },
    };
    expect(formatMappedErrorText(indexedOnly, { recovery: context })).toContain(
      'Retry read with target="npm:x@1.0.0".',
    );
  });
  it("does not append a second inventory to context-free backend prose", () => {
    const message =
      "No indexed version matches. Indexed versions: 1.0.0, 0.9.0.";
    expect(
      formatMappedErrorText({
        code: "VERSION_NOT_FOUND",
        message,
        details: {
          availableVersions: [
            { ref: "v1.0.0", version: "1.0.0" },
            { ref: "v0.9.0", version: "0.9.0" },
          ],
        },
      }),
    ).toBe(message);
  });
  it("preserves canonical missing-ref facts without guessing a short operand identity", () => {
    const failure: MappedError = {
      code: "REF_NOT_FOUND",
      message: "Verify the tag or branch.",
      retryable: false,
      details: {
        repoUrl:
          "https://git.launchpad.net/~leonardr/beautifulsoup/+git/beautifulsoup",
        requestedRef: "4.15.O",
        availableRefs: [{ ref: "HEAD" }],
        suggestedRefs: [],
      },
    };
    for (const context of [
      {
        syntax: "cli" as const,
        argv: ["list", "lp:beautifulsoup@4.15.O", "--json"],
      },
      {
        syntax: "mcp" as const,
        tool: "list",
        args: { target: "lp:beautifulsoup@4.15.O" },
      },
    ]) {
      const result = withVersionRefRecovery(failure, context);
      expect(result.details).toEqual(failure.details);
      expect(result.details?.action).toBeUndefined();
      expect(result.message).toBe(failure.message);
    }
  });
  it.each(["-s", "-iFsv"])(
    "recognizes grep %s without consuming the pattern",
    (flag) => {
      expect(
        withVersionRefRecovery(ref, {
          syntax: "cli",
          argv: ["grep", flag, "router", "github:expressjs/express@bad"],
        }).details?.action,
      ).toBe(
        `Try: githits grep ${flag} router github:expressjs/express@v5.3.0`,
      );
    },
  );
  it.each([
    {
      argv: ["--no-color", "read", "github:expressjs/express@bad", "README.md"],
    },
    {
      argv: ["read", "--no-color", "github:expressjs/express@bad", "README.md"],
    },
  ])("preserves root color switches in $argv", ({ argv }) => {
    expect(
      withVersionRefRecovery(ref, { syntax: "cli", argv }).details?.action,
    ).toBe(`Try: githits ${argv.join(" ").replace("@bad", "@v5.3.0")}`);
  });
  it.each([
    { flags: ["--from", "99", "--to", "5"] },
    { flags: ["--from=99", "--to=5"] },
  ])(
    "recovers upgrade flags with an unversioned package and preserves severity values: %j",
    ({ flags }) => {
      const mapped: MappedError = {
        code: "VERSION_NOT_FOUND",
        message: "Missing version.",
        details: {
          package: "pypi:django",
          requestedVersion: "99",
          availablePackageVersions: ["5.2"],
        },
      };
      const argv = [
        "pkg",
        "upgrade-review",
        "-s",
        "high",
        "pypi:Django",
        ...flags,
      ];
      expect(
        withVersionRefRecovery(mapped, { syntax: "cli", argv }).details?.action,
      ).toBe(`Try: githits ${argv.join(" ").replace("99", "5.2")}`);
    },
  );
  it("matches canonical package casing in CLI targets and MCP upgrade rows", () => {
    const mapped: MappedError = {
      code: "VERSION_NOT_FOUND",
      message: "Missing version.",
      details: {
        package: "pypi:django",
        requestedVersion: "99",
        availablePackageVersions: ["5.2"],
      },
    };
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "cli",
        argv: ["pkg", "deps", "pypi:Django@99"],
      }).details?.action,
    ).toBe("Try: githits pkg deps pypi:django@5.2");
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "mcp",
        tool: "pkg_upgrade_review",
        args: {
          registry: "pypi",
          package_name: "Django",
          current_version: "99",
          target_version: "5",
        },
      }).details?.action,
    ).toBe('Retry pkg_upgrade_review with current_version="5.2".');
  });
  it("includes native actions and complete backend facts in JSON on both surfaces", () => {
    const cli = buildCliMappedErrorPayload(version, [
      "pkg",
      "deps",
      "go:github.com/docker/docker@v20.10.0",
      "--json",
    ]);
    const mcp = JSON.parse(
      mcpMappedErrorResult(version, undefined, "json", {
        recovery: {
          syntax: "mcp",
          tool: "pkg_deps",
          args: { target: "go:github.com/docker/docker@v20.10.0" },
        },
      }).content[0]!.text,
    );
    expect(cli.details?.action).toBe(
      "Try: githits pkg deps go:github.com/docker/docker@v20.10.0+incompatible --json",
    );
    expect(mcp.details.action).toBe(
      'Retry pkg_deps with target="go:github.com/docker/docker@v20.10.0+incompatible".',
    );
    for (const envelope of [cli, mcp]) {
      expect(envelope.error).toBe(version.message);
      expect(envelope.details).toMatchObject(version.details!);
    }
  });
  it.each(["vulns", "deps", "changelog"])(
    "builds a runnable pkg %s command preserving controls",
    (command) => {
      const output = formatMappedErrorText(version, {
        recovery: {
          syntax: "cli",
          argv: [
            "pkg",
            command,
            "go:github.com/docker/docker@v20.10.0",
            "--verbose",
          ],
        },
      });
      expect(output).toContain(
        "Version not found: go:github.com/docker/docker@v20.10.0.",
      );
      expect(output).toContain(
        `Try: githits pkg ${command} go:github.com/docker/docker@v20.10.0+incompatible --verbose`,
      );
      expect(output).not.toContain("Neutral");
      expect(output.match(/v20\.10\.0\+incompatible/g)).toHaveLength(1);
    },
  );
  it.each(["read", "list", "grep", "search"])(
    "builds native %s target recovery",
    (tool) => {
      const target = "github:expressjs/express@bad";
      const args =
        tool === "grep"
          ? { pattern: "bad", targets: [{ target, corpus: "code" }] }
          : tool === "search"
            ? { query: "bad", target }
            : { target, path: "README.md" };
      const output = mcpMappedErrorResult(ref, undefined, "text", {
        recovery: { syntax: "mcp", tool, args },
      }).content[0]!.text;
      expect(output).toContain(
        `Retry ${tool} with ${tool === "grep" ? "targets[0].target" : "target"}="github:expressjs/express@v5.3.0".`,
      );
      expect(output).toContain(
        "Repository https://github.com/expressjs/express has no ref bad.",
      );
      expect(output).not.toContain("Verify the tag");
      expect(output).not.toContain("HEAD");
    },
  );
  it("uses --git-ref for repository addressing and preserves path and bounds", () => {
    const result = withVersionRefRecovery(ref, {
      syntax: "cli",
      argv: [
        "read",
        "README.md",
        "--repo-url",
        "https://github.com/expressjs/express",
        "--git-ref",
        "bad",
        "--lines",
        "1-8",
      ],
    });
    expect(result.details?.action).toBe(
      "Try: githits read README.md --repo-url https://github.com/expressjs/express --git-ref v5.3.0 --lines 1-8",
    );
  });
  it.each([
    {
      argv: [
        "read",
        "--literal-path",
        "github:expressjs/express@bad",
        "src/example:12",
      ],
    },
    {
      argv: [
        "code",
        "read",
        "--literal-path",
        "github:expressjs/express@bad",
        "src/example:12",
      ],
    },
    {
      argv: [
        "read",
        "--literal-path",
        "--",
        "github:expressjs/express@bad",
        "src/example:12",
      ],
    },
    {
      argv: [
        "read",
        "--literal-path",
        "--lines",
        "5-10",
        "--",
        "github:expressjs/express@bad",
        "src/example:12",
      ],
    },
  ])("preserves literal-path mode in $argv target recovery", ({ argv }) => {
    const result = withVersionRefRecovery(ref, {
      syntax: "cli",
      argv,
    });
    expect(result.details?.action).toBe(
      `Try: githits ${argv.join(" ").replace("github:expressjs/express@bad", "github:expressjs/express@v5.3.0")}`,
    );
  });
  it("keeps grep patterns and other repository targets unchanged", () => {
    const result = withVersionRefRecovery(ref, {
      syntax: "cli",
      argv: [
        "grep",
        "github:expressjs/express@bad",
        "github:expressjs/express@bad",
        "github:other/repo@bad",
      ],
    });
    expect(result.details?.action).toBe(
      "Try: githits grep github:expressjs/express@bad github:expressjs/express@v5.3.0 github:other/repo@bad",
    );
  });
  it("preserves leading flags, grep patterns and target-like option values", () => {
    const target = "github:expressjs/express@bad";
    expect(
      withVersionRefRecovery(ref, {
        syntax: "cli",
        argv: ["read", "--verbose", target, "README.md"],
      }).details?.action,
    ).toBe(
      "Try: githits read --verbose github:expressjs/express@v5.3.0 README.md",
    );
    expect(
      withVersionRefRecovery(ref, {
        syntax: "cli",
        argv: ["grep", "-iF", "router", "--path-prefix", target, target],
      }).details?.action,
    ).toBe(
      "Try: githits grep -iF router --path-prefix github:expressjs/express@bad github:expressjs/express@v5.3.0",
    );
  });
  it("handles list short switches and keeps repository-mode file operands unchanged", () => {
    const target = "github:expressjs/express@bad";
    expect(
      withVersionRefRecovery(ref, {
        syntax: "cli",
        argv: ["list", "-Rs", target, "lib/"],
      }).details?.action,
    ).toBe("Try: githits list -Rs github:expressjs/express@v5.3.0 lib/");
    expect(
      withVersionRefRecovery(ref, {
        syntax: "cli",
        argv: [
          "read",
          "--repo-url",
          ref.details!.repoUrl!,
          "--git-ref",
          "bad",
          target,
        ],
      }).details?.action,
    ).toBe(
      "Try: githits read --repo-url https://github.com/expressjs/express --git-ref v5.3.0 github:expressjs/express@bad",
    );
  });
  it("uses the same accepted target whitespace normalization as request builders", () => {
    expect(
      withVersionRefRecovery(ref, {
        syntax: "mcp",
        tool: "list",
        args: { target: "  github:expressjs/express@bad  " },
      }).details?.action,
    ).toBe('Retry list with target="github:expressjs/express@v5.3.0".');
    expect(
      withVersionRefRecovery(version, {
        syntax: "mcp",
        tool: "pkg_deps",
        args: { target: "  go:github.com/docker/docker@v20.10.0  " },
      }).details?.action,
    ).toBe(
      'Retry pkg_deps with target="go:github.com/docker/docker@v20.10.0+incompatible".',
    );
  });
  it("handles canonical Go normalization and preserves symbol suffixes", () => {
    const result = withVersionRefRecovery(version, {
      syntax: "mcp",
      tool: "read",
      args: { target: "go:github.com/docker/docker@20.10.0#Client" },
    });
    expect(result.details?.action).toContain(
      'target="go:github.com/docker/docker@v20.10.0+incompatible#Client"',
    );
  });
  it("uses real upgrade-review parameter names in single and batch mode", () => {
    const row = {
      registry: "go",
      package_name: "github.com/docker/docker",
      current_version: "v1.0.0",
      target_version: "v20.10.0",
    };
    expect(
      withVersionRefRecovery(version, {
        syntax: "mcp",
        tool: "pkg_upgrade_review",
        args: row,
      }).details?.action,
    ).toContain('target_version="v20.10.0+incompatible"');
    expect(
      withVersionRefRecovery(version, {
        syntax: "mcp",
        tool: "pkg_upgrade_review",
        args: { packages: [row] },
      }).details?.action,
    ).toContain('packages[0].target_version="v20.10.0+incompatible"');
  });
  it("retains code-diff side and uses from/to rather than target revision suffixes", () => {
    const mapped: MappedError = {
      code: "REF_NOT_FOUND",
      message: "Missing ref bad in repository.",
      details: { side: "to", suggestedRefs: [{ ref: "v5.3.0" }] },
    };
    const result = withVersionRefRecovery(mapped, {
      syntax: "mcp",
      tool: "code_diff",
      args: { target: "github:expressjs/express", from: "v4", to: "bad" },
    });
    expect(result.details?.action).toContain('to="v5.3.0"');
    expect(formatMappedErrorText(result)).toContain("Comparison side: to");
  });
  it("quotes shell operands and leaves unknown codes and missing identities verbatim", () => {
    const tricky = {
      ...ref,
      details: { ...ref.details, suggestedRefs: [{ ref: "fix/it's;$HOME" }] },
    };
    const result = withVersionRefRecovery(tricky, {
      syntax: "cli",
      argv: ["read", "github:expressjs/express@bad", "README.md"],
    });
    expect(result.details?.action).toContain(
      "'github:expressjs/express@fix/it'\"'\"'s;$HOME'",
    );
    expect(
      formatMappedErrorText({
        code: "BACKEND_ERROR",
        message: "Future backend code.",
      }),
    ).toBe("Future backend code.");
    expect(
      formatMappedErrorText({
        code: "VERSION_NOT_FOUND",
        message: "Missing fields.",
      }),
    ).toBe("Missing fields.");
    expect(
      withVersionRefRecovery(ref, {
        syntax: "mcp",
        tool: "read",
        args: { target: "github:other/repo@bad" },
      }).details?.action,
    ).toBeUndefined();
  });
  it("keeps all structured suggestions and backend prose in both JSON envelopes", () => {
    const releases = Array.from({ length: 10 }, (_, i) => `5.${10 - i}.0`);
    const mapped = mapVersionRefRecovery(
      "Backend verbatim.",
      parseVersionRefRecovery({
        code: "VERSION_NOT_FOUND",
        package: "npm:express",
        requested_version: "99",
        latest_version: releases[0],
        available_package_versions: releases,
        available_versions: [{ ref: "v4", version: "4" }],
      })!,
    );
    const cli = buildCliMappedErrorPayload(mapped);
    const mcp = JSON.parse(
      mcpMappedErrorResult(mapped, undefined, "json").content[0]!.text,
    );
    expect(cli).toEqual(mcp);
    expect(cli.error).toBe("Backend verbatim.");
    expect(cli.details?.availablePackageVersions).toEqual(releases);
    expect(cli.details?.availableVersions).toEqual([
      { ref: "v4", version: "4" },
    ]);
    expect(formatMappedErrorText(mapped)).toContain("(+5 more)");
  });
});

it("replays Launchpad ref recovery without changing prefix spelling or path escapes", () => {
  const mapped: MappedError = {
    code: "REF_NOT_FOUND",
    message: "Ref missing",
    retryable: false,
    details: {
      repoUrl: "https://git.launchpad.net/~Owner/Project/+git/Repo@2",
      requestedRef: "bad@ref",
      suggestedRefs: [{ ref: "Feature/KeepCase@next" }],
    },
  };
  const target = "lP:~Owner/Project/+git/Repo%402@bad@ref#Symbol";
  expect(
    withVersionRefRecovery(mapped, {
      syntax: "mcp",
      tool: "read",
      args: { target, path: "src/File.py" },
    }).details?.action,
  ).toBe(
    'Retry read with target="lP:~Owner/Project/+git/Repo%402@Feature/KeepCase@next#Symbol".',
  );
});

describe("cargo alias version recovery", () => {
  const mapped: MappedError = {
    code: "VERSION_NOT_FOUND",
    message: "Missing version.",
    details: {
      package: "crates:serde",
      requestedVersion: "99",
      availablePackageVersions: ["1.0.228"],
    },
  };
  const argvCases: string[][] = [
    ["pkg", "deps", "cargo:serde@99"],
    ["pkg", "vulns", "CARGO:serde@99"],
    ["pkg", "changelog", "cargo:serde@99..100"],
    ["read", "cargo:serde@99#Serialize", "src/lib.rs"],
    ["list", "cargo:serde@99"],
    ["grep", "serde", "cargo:serde@99"],
    ["search", "Serialize", "--in=cargo:serde@99"],
    ["pkg", "upgrade-review", "--package", "cargo:serde@99..100"],
  ];
  it.each(argvCases.map((argv) => ({ argv })))(
    "matches canonical recovery for CLI argv $argv",
    ({ argv }) => {
      const canonical = argv.map((arg) => arg.replace(/cargo:/gi, "crates:"));
      expect(
        withVersionRefRecovery(mapped, { syntax: "cli", argv }).details?.action,
      ).toBe(
        withVersionRefRecovery(mapped, { syntax: "cli", argv: canonical })
          .details?.action,
      );
      expect(
        withVersionRefRecovery(mapped, { syntax: "cli", argv }).details?.action,
      ).toContain("crates:serde@1.0.228");
    },
  );
  it.each(["--from", "--to", "--from=99", "--to=99"])(
    "matches alias package for %s version flags",
    (flag) => {
      const argv = [
        "pkg",
        "changelog",
        "cargo:serde",
        flag,
        ...(flag.includes("=") ? [] : ["99"]),
      ];
      expect(
        withVersionRefRecovery(mapped, { syntax: "cli", argv }).details?.action,
      ).toContain(
        `${flag.split("=")[0]}${flag.includes("=") ? "=" : " "}1.0.228`,
      );
    },
  );
  it("normalizes compact MCP targets and structured single/batch upgrade registry", () => {
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "mcp",
        tool: "pkg_deps",
        args: { target: "cargo:serde@99" },
      }).details?.action,
    ).toBe('Retry pkg_deps with target="crates:serde@1.0.228".');
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "mcp",
        tool: "search",
        args: { targets: ["cargo:serde@99"] },
      }).details?.action,
    ).toBe('Retry search with targets[0]="crates:serde@1.0.228".');
    const row = {
      registry: " CARGO ",
      package_name: "serde",
      current_version: "99",
      target_version: "100",
    };
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "mcp",
        tool: "pkg_upgrade_review",
        args: row,
      }).details?.action,
    ).toBe('Retry pkg_upgrade_review with current_version="1.0.228".');
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "mcp",
        tool: "pkg_upgrade_review",
        args: { packages: [row] },
      }).details?.action,
    ).toBe(
      'Retry pkg_upgrade_review with packages[0].current_version="1.0.228".',
    );
  });
  it("does not make alias spelling alone a retry for another version", () => {
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "cli",
        argv: ["pkg", "deps", "cargo:serde@100"],
      }).details?.action,
    ).toBeUndefined();
    expect(
      withVersionRefRecovery(mapped, {
        syntax: "mcp",
        tool: "pkg_deps",
        args: { target: "cargo:serde@100" },
      }).details?.action,
    ).toBeUndefined();
  });
});
