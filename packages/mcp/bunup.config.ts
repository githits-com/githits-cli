import { defineConfig } from "bunup";

export default defineConfig({
  dts: {
    entry: "src/index.ts",
    resolve: ["@githits/core-internal"],
  },
  entry: ["src/index.ts"],
  exports: true,
  external: [/^@modelcontextprotocol\/sdk(?:\/.*)?$/, /^zod(?:\/.*)?$/],
  minifyWhitespace: true,
  packages: "bundle",
  target: "node",
});
