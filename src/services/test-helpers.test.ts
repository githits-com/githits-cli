import { expect, it } from "bun:test";
import { createMockFileSystemService } from "./test-helpers.js";

it("models exclusive file creation in the shared filesystem mock", async () => {
  const fs = createMockFileSystemService();
  const path = "/mock/auth.lock/owner.json";

  await fs.writeFileExclusive(path, "first");
  await expect(fs.writeFileExclusive(path, "second")).rejects.toMatchObject({
    code: "EEXIST",
  });

  await fs.deleteFile(path);
  await expect(fs.writeFileExclusive(path, "replacement")).resolves.toBe(
    undefined,
  );
});
