import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli.js";

describe("createProgram", () => {
  it("includes the markdown mode in root help", () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain("Usage: agent-compatibility");
    expect(help).toContain("--md");
    expect(help).toContain("show usage information");
    expect(help).toContain("scan [options] [path]");
  });

  it("includes the markdown mode in scan subcommand help", () => {
    const program = createProgram();
    const scanCommand = program.commands.find((command) => command.name() === "scan");

    if (!scanCommand) {
      throw new Error("Missing scan command");
    }

    const help = scanCommand.helpInformation();
    expect(help).toContain("Usage: agent-compatibility scan");
    expect(help).toContain("--md");
    expect(help).toContain("show usage information");
  });
});
