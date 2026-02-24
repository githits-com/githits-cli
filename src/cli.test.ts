import { afterEach, describe, expect, it } from "bun:test";
import { Command } from "commander";

describe("--no-color flag", () => {
  const origNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  it("sets NO_COLOR env var when --no-color is passed", async () => {
    delete process.env.NO_COLOR;

    const program = new Command();
    program
      .option("--no-color", "Disable colored output")
      .hook("preAction", (thisCommand) => {
        if (thisCommand.opts().color === false) {
          process.env.NO_COLOR = "1";
        }
      });

    let captured: string | undefined;
    program.command("test-cmd").action(() => {
      captured = process.env.NO_COLOR;
    });

    await program.parseAsync(["node", "githits", "--no-color", "test-cmd"]);

    expect(captured).toBe("1");
  });

  it("does not set NO_COLOR when flag is omitted", async () => {
    delete process.env.NO_COLOR;

    const program = new Command();
    program
      .option("--no-color", "Disable colored output")
      .hook("preAction", (thisCommand) => {
        if (thisCommand.opts().color === false) {
          process.env.NO_COLOR = "1";
        }
      });

    let captured: string | undefined;
    program.command("test-cmd").action(() => {
      captured = process.env.NO_COLOR;
    });

    await program.parseAsync(["node", "githits", "test-cmd"]);

    expect(captured).toBeUndefined();
  });
});
