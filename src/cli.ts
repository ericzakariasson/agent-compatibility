import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { scanRepository } from "./core/scanRepo.js";
import type { ScanConfig } from "./core/types.js";
import { renderJsonReport } from "./reporters/json.js";
import { renderMarkdownReport } from "./reporters/markdown.js";
import { renderTextReport } from "./reporters/text.js";
import { runTuiSession } from "./reporters/tui.js";

function readCliVersion(): string {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) {
        return parsed.version;
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return "0.0.0";
}

async function loadConfig(configPath: string | undefined): Promise<ScanConfig | undefined> {
  if (!configPath) {
    return undefined;
  }

  const absolutePath = path.resolve(configPath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (extension === ".json") {
    const raw = await readFile(absolutePath, "utf8");
    return JSON.parse(raw) as ScanConfig;
  }

  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    const imported = (await import(pathToFileURL(absolutePath).href)) as { default?: ScanConfig };
    return imported.default ?? (imported as unknown as ScanConfig);
  }

  throw new Error(`Unsupported config format: ${extension || "unknown"}. Use .json, .js, .mjs, or .cjs.`);
}

type ScanCommandOptions = {
  json?: boolean;
  md?: boolean;
  tui?: boolean;
  text?: boolean;
  verbose?: boolean;
  config?: string;
};

type OutputMode = "json" | "md" | "text" | "tui";

function getSelectedOutputModes(options: ScanCommandOptions): OutputMode[] {
  const modes: OutputMode[] = [];

  if (options.json) {
    modes.push("json");
  }

  if (options.md) {
    modes.push("md");
  }

  if (options.text) {
    modes.push("text");
  }

  if (options.tui) {
    modes.push("tui");
  }

  return modes;
}

async function runScan(targetPath: string, options: ScanCommandOptions): Promise<void> {
  try {
    const selectedModes = getSelectedOutputModes(options);
    if (selectedModes.length > 1) {
      throw new Error("Choose only one output mode: --json, --md, --text, or --tui.");
    }

    const config = await loadConfig(options.config);
    const selectedMode = selectedModes[0];

    if (!selectedMode || selectedMode === "tui") {
      await runTuiSession({
        targetPath,
        verbose: options.verbose,
        loadReport: () =>
          scanRepository({
            rootPath: targetPath,
            config,
          }),
      });
      return;
    }

    const report = await scanRepository({
      rootPath: targetPath,
      config,
    });

    const output =
      selectedMode === "json"
        ? renderJsonReport(report)
        : selectedMode === "md"
          ? renderMarkdownReport(report)
          : renderTextReport(report, { verbose: options.verbose });
    process.stdout.write(`${output}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function configureScanCommand(command: Command): Command {
  return command
    .argument("[path]", "path to the repository to scan", ".")
    .option("--json", "print the full report as JSON")
    .option("--md", "print an agent-optimized Markdown report")
    .option("--tui", "render the compact terminal dashboard (default)")
    .option("--text", "render the classic plain-text report")
    .option("--verbose", "include passing checks in text output")
    .option("--config <path>", "optional config file with ignored paths or weight overrides")
    .helpOption("-h, --help", "show usage information")
    .showHelpAfterError("(add --help for usage)")
    .action(runScan);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("agent-compatibility")
    .description("Score how compatible a codebase is with autonomous agents.")
    .version(readCliVersion())
    .helpOption("-h, --help", "show usage information")
    .showHelpAfterError("(add --help for usage)");

  configureScanCommand(program);

  configureScanCommand(
    program
      .command("scan")
      .description("scan a repository and print the compatibility score"),
  );

  return program;
}
