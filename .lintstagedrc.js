/**
 * lint-staged configuration
 * Runs linters/formatters on staged files and typecheck on the whole project.
 */

export default {
  // Format and lint code files
  "*.{js,ts,cjs,mjs,jsx,tsx,json,jsonc}": [
    "biome check --write --no-errors-on-unmatched",
  ],
  // Format non-code files (css, html, md, yaml, etc.)
  "!(*.{js,ts,cjs,mjs,jsx,tsx,json,jsonc})": [
    "biome format --write --no-errors-on-unmatched",
  ],
  // Run typecheck on the whole project when any TypeScript files are staged
  "*.{ts,tsx}": () => ["bun run typecheck"],
};
