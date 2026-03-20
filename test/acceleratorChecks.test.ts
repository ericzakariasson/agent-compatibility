import { describe, expect, it } from "vitest";

import { runAcceleratorChecks } from "../src/checks/runAcceleratorChecks.js";
import { DEFAULT_ACCELERATORS } from "../src/config/defaultAccelerators.js";
import type { AcceleratorCheckResult, RepoClassification, RepoDiscovery } from "../src/core/types.js";

function makeDiscovery(overrides: Partial<RepoDiscovery> = {}): RepoDiscovery {
  return {
    rootPath: "/tmp/example",
    hasGitMetadata: true,
    filePaths: [],
    sourceFiles: [],
    testFiles: [],
    ciConfigFiles: [],
    workflowFiles: [],
    taskFiles: [],
    buildConfigFiles: [],
    envExampleFiles: [],
    docsFiles: [],
    lockfiles: [],
    manifests: [],
    warnings: [],
    ecosystems: ["node"],
    packageJson: null,
    textByPath: new Map(),
    ...overrides,
  };
}

function makeClassification(): RepoClassification {
  return {
    kind: "application",
    isMonorepo: false,
    hasRuntimeEntrypoint: true,
    reasons: [],
  };
}

function repeatWords(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");
}

function getClaudeToolingResult(discovery: RepoDiscovery): AcceleratorCheckResult {
  const result = runAcceleratorChecks(DEFAULT_ACCELERATORS, {
    discovery,
    classification: makeClassification(),
  }).find((entry) => entry.id === "claudeToolingConfigured");

  if (!result) {
    throw new Error("Missing claudeToolingConfigured result");
  }

  return result;
}

function getAgentGuidanceResult(discovery: RepoDiscovery): AcceleratorCheckResult {
  const result = runAcceleratorChecks(DEFAULT_ACCELERATORS, {
    discovery,
    classification: makeClassification(),
  }).find((entry) => entry.id === "agentGuidanceDocs");

  if (!result) {
    throw new Error("Missing agentGuidanceDocs result");
  }

  return result;
}

function getAcceleratorResult(discovery: RepoDiscovery, id: string): AcceleratorCheckResult {
  const result = runAcceleratorChecks(DEFAULT_ACCELERATORS, {
    discovery,
    classification: makeClassification(),
  }).find((entry) => entry.id === id);

  if (!result) {
    throw new Error(`Missing accelerator result ${id}`);
  }

  return result;
}

describe("runAcceleratorChecks", () => {
  it("skips Claude accelerator when the repo has no Claude-specific paths", () => {
    const result = getClaudeToolingResult(makeDiscovery());

    expect(result.status).toBe("not_applicable");
    expect(result.awardedPoints).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it("evaluates Claude accelerator when .claude assets exist", () => {
    const result = getClaudeToolingResult(
      makeDiscovery({
        filePaths: [".claude/agents/reviewer.md"],
        textByPath: new Map([[".claude/agents/reviewer.md", repeatWords(50)]]),
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.evidence).toContain(".claude/agents/");
  });

  it("passes concise root guidance docs", () => {
    const result = getAgentGuidanceResult(
      makeDiscovery({
        filePaths: ["AGENTS.md"],
        textByPath: new Map([["AGENTS.md", repeatWords(120)]]),
      }),
    );

    expect(result.status).toBe("pass");
    expect(result.awardedPoints).toBe(2);
    expect(result.evidence).toEqual(["AGENTS.md (120 words)"]);
  });

  it("downgrades verbose root guidance docs to partial", () => {
    const result = getAgentGuidanceResult(
      makeDiscovery({
        filePaths: ["AGENTS.md"],
        textByPath: new Map([["AGENTS.md", repeatWords(450)]]),
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.awardedPoints).toBe(1);
    expect(result.evidence).toEqual(["AGENTS.md (450 words)"]);
  });

  it("fails when AGENTS.md is too long", () => {
    const result = getAgentGuidanceResult(
      makeDiscovery({
        filePaths: ["AGENTS.md"],
        textByPath: new Map([["AGENTS.md", repeatWords(950)]]),
      }),
    );

    expect(result.status).toBe("fail");
    expect(result.awardedPoints).toBe(0);
    expect(result.evidence).toEqual(["AGENTS.md (950 words)"]);
  });

  it("counts .agents/skills toward Cursor tooling accelerator", () => {
    const discovery = makeDiscovery({
      filePaths: [".agents/skills/deploy/SKILL.md", ".cursor/rules/standards.mdc"],
      textByPath: new Map([
        [
          ".agents/skills/deploy/SKILL.md",
          "---\nname: deploy\ndescription: Deploys the app. Use when releasing.\n---\n\n# Deploy\n",
        ],
        [".cursor/rules/standards.mdc", "---\nalwaysApply: true\n---\n"],
      ]),
    });

    const result = getAcceleratorResult(discovery, "cursorToolingConfigured");
    expect(result.status).toBe("pass");
    expect(result.evidence.some((line) => line.includes(".agents/skills/"))).toBe(true);
  });

  it("adds warnings for Agent Skills files that break SKILL.md conventions", () => {
    const discovery = makeDiscovery({
      filePaths: [".agents/skills/deploy/SKILL.md"],
      textByPath: new Map([
        [".agents/skills/deploy/SKILL.md", "# Deploy\n\nNo frontmatter.\n"],
      ]),
    });

    runAcceleratorChecks(DEFAULT_ACCELERATORS, {
      discovery,
      classification: makeClassification(),
    });

    expect(discovery.warnings.some((w) => w.includes("missing YAML frontmatter"))).toBe(true);
  });

  it("passes dependencyMcpAlignment when LLM deps match an MCP server id", () => {
    const pkg = { name: "x", version: "1.0.0", dependencies: { openai: "4.0.0" } };
    const discovery = makeDiscovery({
      filePaths: [".cursor/mcp.json", "package.json"],
      packageJson: pkg,
      textByPath: new Map([
        ["package.json", JSON.stringify(pkg, null, 2)],
        [
          ".cursor/mcp.json",
          JSON.stringify({
            mcpServers: {
              openai: { command: "npx", args: ["-y", "@modelcontextprotocol/server-openai"] },
            },
          }),
        ],
      ]),
    });

    const result = getAcceleratorResult(discovery, "dependencyMcpAlignment");
    expect(result.status).toBe("pass");
    expect(result.evidence.some((line) => line.includes("llm"))).toBe(true);
  });
});
