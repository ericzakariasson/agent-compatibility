import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const CURSOR_PROMPT_BASE_URL = "cursor://anysphere.cursor-deeplink/prompt";
const MAX_CURSOR_PROMPT_ISSUES = 8;

type CommandInvocation = {
  command: string;
  args: string[];
};

function uniqueIssueTexts(issueTexts: string[]): string[] {
  return [...new Set(issueTexts.map((text) => text.trim()).filter((text) => text.length > 0))];
}

function normalizePromptText(promptText: string): string {
  return promptText.replace(/\r\n?/g, "\n");
}

export function generatePromptDeeplink(promptText: string): string {
  const url = new URL(CURSOR_PROMPT_BASE_URL);
  url.searchParams.set("text", normalizePromptText(promptText));
  return url.toString();
}

export function buildCursorFixPrompt(issueTexts: string[]): string | null {
  const issues = uniqueIssueTexts(issueTexts).slice(0, MAX_CURSOR_PROMPT_ISSUES);

  if (issues.length === 0) {
    return null;
  }

  return [
    "Fix the highest-priority agent compatibility issues in this repo.",
    "",
    "Start with:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Make the smallest set of changes that improves the report. Run relevant validation if you can, then summarize what changed and what is still left.",
  ].join("\n");
}

export function createCursorFixDeeplink(issueTexts: string[]): string | null {
  const prompt = buildCursorFixPrompt(issueTexts);
  return prompt ? generatePromptDeeplink(prompt) : null;
}

function openCommandForUrl(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      return { command: "explorer", args: [url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

function commandSucceeds(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, {
    shell: false,
    stdio: "ignore",
  });

  return result.status === 0;
}

function clipboardCommand(): CommandInvocation | null {
  if (process.platform === "darwin") {
    return commandSucceeds("which", ["pbcopy"]) ? { command: "pbcopy", args: [] } : null;
  }

  if (process.platform === "win32") {
    return commandSucceeds("where", ["clip"]) ? { command: "clip", args: [] } : null;
  }

  if (commandSucceeds("which", ["wl-copy"])) {
    return { command: "wl-copy", args: [] };
  }

  if (commandSucceeds("which", ["xclip"])) {
    return { command: "xclip", args: ["-selection", "clipboard"] };
  }

  if (commandSucceeds("which", ["xsel"])) {
    return { command: "xsel", args: ["--clipboard", "--input"] };
  }

  return null;
}

export function isCursorInstalled(): boolean {
  if (process.platform === "darwin") {
    return commandSucceeds("open", ["-Ra", "Cursor"]) || commandSucceeds("which", ["cursor"]);
  }

  if (process.platform === "win32") {
    if (commandSucceeds("where", ["cursor"])) {
      return true;
    }

    const candidatePaths = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Cursor", "Cursor.exe") : "",
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Cursor", "Cursor.exe") : "",
      process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Cursor", "Cursor.exe") : "",
    ];

    return candidatePaths.some((candidatePath) => candidatePath.length > 0 && existsSync(candidatePath));
  }

  return (
    commandSucceeds("which", ["cursor"]) ||
    ["/usr/bin/cursor", "/usr/local/bin/cursor", "/opt/cursor/cursor", "/opt/Cursor/cursor"].some((candidatePath) =>
      existsSync(candidatePath),
    )
  );
}

export function canCopyPromptToClipboard(): boolean {
  return clipboardCommand() !== null;
}

function openUrl(url: string): Promise<void> {
  const { command, args } = openCommandForUrl(url);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function copyTextToClipboard(text: string): Promise<void> {
  const invocation = clipboardCommand();

  if (!invocation) {
    return Promise.reject(new Error("No clipboard command available."));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: ["pipe", "ignore", "ignore"],
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Clipboard command exited with code ${code ?? "unknown"}.`));
    });

    child.stdin.on("error", reject);
    child.stdin.end(normalizePromptText(text));
  });
}

export async function launchCursorFixPrompt(issueTexts: string[]): Promise<boolean> {
  if (!isCursorInstalled()) {
    return false;
  }

  const deeplink = createCursorFixDeeplink(issueTexts);
  if (!deeplink) {
    return false;
  }

  await openUrl(deeplink);
  return true;
}

export async function copyCursorFixPromptToClipboard(issueTexts: string[]): Promise<boolean> {
  if (!canCopyPromptToClipboard()) {
    return false;
  }

  const prompt = buildCursorFixPrompt(issueTexts);
  if (!prompt) {
    return false;
  }

  await copyTextToClipboard(prompt);
  return true;
}
