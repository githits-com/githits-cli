import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("plugin manifest wiring", () => {
  it("points Claude marketplace plugin source to plugins/claude payload", async () => {
    const marketplacePath = join(
      import.meta.dir,
      "..",
      ".claude-plugin",
      "marketplace.json",
    );
    const contents = await readFile(marketplacePath, "utf8");
    const parsed = JSON.parse(contents) as {
      plugins?: Array<{ name?: string; source?: string }>;
    };

    const githitsPlugin = parsed.plugins?.find(
      (plugin) => plugin.name === "githits",
    );
    expect(githitsPlugin).toBeDefined();
    expect(githitsPlugin?.source).toBe("./plugins/claude");
  });
});
