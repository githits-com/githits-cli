import { expect, it } from "bun:test";

it("validates upgrade scoring with isolated synthetic projects", async () => {
  const command = process.platform === "win32" ? "python" : "python3";
  const child = Bun.spawn([command, "score_test.py"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({
    exitCode,
    output: exitCode === 0 ? "passed" : stdout + stderr,
  }).toEqual({
    exitCode: 0,
    output: "passed",
  });
}, 20_000);
