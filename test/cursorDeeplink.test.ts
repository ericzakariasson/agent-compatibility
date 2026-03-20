import { describe, expect, it } from "vitest";

import { buildCursorFixPrompt, createCursorFixDeeplink, generatePromptDeeplink } from "../src/reporters/cursorDeeplink.js";

describe("cursor deeplink helpers", () => {
  it("uses the cursor deeplink scheme instead of the web link", () => {
    const deeplink = generatePromptDeeplink("Fix the report");

    expect(deeplink).toContain("cursor://anysphere.cursor-deeplink/prompt");
    expect(deeplink).not.toContain("https://cursor.com/link/prompt");
  });

  it("builds a prompt from the top issues and returns a deeplink", () => {
    const prompt = buildCursorFixPrompt([
      "Add a linter and wire it into local validation or CI.",
      "Add AGENTS.md or equivalent agent-facing workflow guidance.",
    ]);
    const deeplink = createCursorFixDeeplink([
      "Add a linter and wire it into local validation or CI.",
      "Add AGENTS.md or equivalent agent-facing workflow guidance.",
    ]);

    expect(prompt).toContain("Fix the highest-priority agent compatibility issues in this repo.");
    expect(prompt).toContain("- Add a linter and wire it into local validation or CI.");
    expect(prompt).toContain("- Add AGENTS.md or equivalent agent-facing workflow guidance.");
    expect(deeplink).toContain("cursor://anysphere.cursor-deeplink/prompt?text=");
  });

  it("preserves the exact multiline prompt in the deeplink text param", () => {
    const expectedPrompt = [
      "Fix the highest-priority agent compatibility issues in this repo.",
      "",
      "Start with:",
      "- Add a linter and wire it into local validation or CI.",
      "- Add AGENTS.md or equivalent agent-facing workflow guidance.",
      "",
      "Make the smallest set of changes that improves the report. Run relevant validation if you can, then summarize what changed and what is still left.",
    ].join("\n");

    const deeplink = createCursorFixDeeplink([
      "Add a linter and wire it into local validation or CI.",
      "Add AGENTS.md or equivalent agent-facing workflow guidance.",
    ]);

    if (!deeplink) {
      throw new Error("Expected a deeplink");
    }

    const decodedPrompt = new URL(deeplink).searchParams.get("text");
    expect(decodedPrompt).toBe(expectedPrompt);
  });

  it("normalizes CRLF to LF before encoding the prompt", () => {
    const deeplink = generatePromptDeeplink("line one\r\n\r\nline two\r\n- bullet");
    const decodedPrompt = new URL(deeplink).searchParams.get("text");

    expect(decodedPrompt).toBe("line one\n\nline two\n- bullet");
  });
});
