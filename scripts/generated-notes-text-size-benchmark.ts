import { basename } from "node:path";
import {
  formatPackageChangelogTerminal,
  type LeanChangelogEnvelope,
} from "../packages/mcp/src/shared/package-changelog-response.js";
import {
  formatPackageUpgradeReviewTerminal,
  type UpgradeReviewResponse,
} from "../packages/mcp/src/shared/package-upgrade-review-response.js";

// Fixed JSON evidence makes output-size comparisons independent of API changes.
const inputs = process.argv.slice(2);
if (!inputs.length) {
  throw new Error("Pass changelog or upgrade-review JSON files to compare.");
}
for (const input of inputs) {
  const payload = await Bun.file(input).json();
  const output =
    "reviews" in payload
      ? formatPackageUpgradeReviewTerminal(payload as UpgradeReviewResponse, {
          useColors: false,
          terminalWidth: 80,
        })
      : formatPackageChangelogTerminal(payload as LeanChangelogEnvelope, {
          useColors: false,
          terminalWidth: 80,
        });
  console.log(
    JSON.stringify({
      input: basename(input),
      bytes: Buffer.byteLength(output),
      lines: output.trimEnd().split("\n").length,
    }),
  );
}
