import { defineConfig } from "bunup";

export default defineConfig({
  dts: {
    entry: [
      "src/index.ts",
      "src/client.ts",
      "src/smoke-test.ts",
      "src/tools.ts",
    ],
    resolve: ["@githits/core-internal"],
  },
  entry: ["src/index.ts", "src/client.ts", "src/smoke-test.ts", "src/tools.ts"],
  exports: true,
  external: [/^@modelcontextprotocol\/sdk(?:\/.*)?$/, /^zod(?:\/.*)?$/],
  minifyWhitespace: true,
  packages: "bundle",
  preferredTsconfig: "../../tsconfig.json",
  target: "node",
});
