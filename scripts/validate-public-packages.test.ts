import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNodeTargetProbe,
  findDirectProcessOutputAccess,
  findForbiddenBrowserBundleSpecifiers,
  findForbiddenBrowserOutputMarkers,
  findForbiddenFilesystemSpecifiersInMetafile,
  findForbiddenStaticFilesystemSpecifiers,
  findStaticModuleSpecifiers,
  isForbiddenFilesystemSpecifier,
} from "./validate-public-packages.js";

describe("public package boundary helpers", () => {
  it("recognises only the forbidden filesystem specifiers", () => {
    for (const specifier of [
      "fs",
      "node:fs",
      "fs/promises",
      "node:fs/promises",
    ]) {
      expect(isForbiddenFilesystemSpecifier(specifier)).toBe(true);
    }
    for (const specifier of [
      "filesystem",
      "fs-extra",
      "node:fs-extra",
      "fs/promises/readFile",
      "node:fs/promises/readFile",
    ]) {
      expect(isForbiddenFilesystemSpecifier(specifier)).toBe(false);
    }
  });

  it("finds only static module specifiers, not benign fs text", () => {
    const source = `
      import "fs";
      export { readFile } from "node:fs";
      void import("fs/promises");
      require("node:fs/promises");
      const filesystemName = "fs";
      const text = "import fs/promises dynamically";
    `;

    expect(findForbiddenStaticFilesystemSpecifiers(source)).toEqual([
      "fs",
      "node:fs",
      "fs/promises",
      "node:fs/promises",
    ]);
    expect(
      findForbiddenStaticFilesystemSpecifiers(
        'const filesystem = "fs"; const nodeFs = "node:fs";',
      ),
    ).toEqual([]);
    expect(findStaticModuleSpecifiers('const text = "fs/promises";')).toEqual(
      [],
    );
  });

  it("reports direct process output access separately", () => {
    expect(
      findDirectProcessOutputAccess(
        "process.stderr.write(x); process.stdout.write(y)",
      ),
    ).toEqual(["process.stderr", "process.stdout"]);
    expect(
      findDirectProcessOutputAccess("const processOutput = true;"),
    ).toEqual([]);
  });

  it("reports forbidden imports from a real Node-target bundle metafile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "githits-validator-test-"));
    try {
      const entrypoint = join(directory, "entry.ts");
      await writeFile(
        entrypoint,
        'import { readFileSync } from "node:fs"; export const probe = readFileSync;\n',
      );
      const metafile = await buildNodeTargetProbe(
        entrypoint,
        join(directory, "out"),
      );

      expect(findForbiddenFilesystemSpecifiersInMetafile(metafile)).toEqual([
        "node:fs",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("classifies browser bundle module and output markers", () => {
    expect(
      findForbiddenBrowserBundleSpecifiers({
        inputs: {
          entry: {
            imports: [
              { path: "node:fs" },
              { original: "@modelcontextprotocol/sdk/client" },
              { original: "@githits/core-internal" },
              { original: "workspace:*" },
              { original: "zod" },
            ],
          },
        },
      }),
    ).toEqual([
      "@githits/core-internal",
      "@modelcontextprotocol/sdk/client",
      "node:fs",
      "workspace:*",
    ]);
    expect(
      findForbiddenBrowserOutputMarkers(
        'const processOutput = process.env.NODE_ENV; const value = Buffer.from("x");',
      ),
    ).toEqual(["process global", "Buffer global"]);
    expect(
      findForbiddenBrowserOutputMarkers(
        'const text = "process and Buffer are ordinary words";',
      ),
    ).toEqual([]);
  });
});
