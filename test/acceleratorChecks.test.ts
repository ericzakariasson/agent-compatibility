import { describe, expect, it } from "vitest";

import { runAcceleratorChecks } from "../src/checks/runAcceleratorChecks.js";
import { DEFAULT_ACCELERATORS } from "../src/config/defaultAccelerators.js";
import type { AcceleratorCheckResult, RepoClassification, RepoDiscovery } from "../src/core/types.js";

function makeDiscovery(overrides: Partial<RepoDiscovery> = {}): RepoDiscovery {
  return {
    rootPath: "/tmp/example",
    filePaths: [],
    sourceFiles: [],
    testFiles: [],
    workflowFiles: [],
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

describe("runAcceleratorChecks", () => {
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

  it("fails when any root guidance doc is too long", () => {
    const result = getAgentGuidanceResult(
      makeDiscovery({
        filePaths: ["AGENTS.md", "CLAUDE.md"],
        textByPath: new Map([
          ["AGENTS.md", repeatWords(80)],
          ["CLAUDE.md", repeatWords(950)],
        ]),
      }),
    );

    expect(result.status).toBe("fail");
    expect(result.awardedPoints).toBe(0);
    expect(result.evidence).toEqual(["AGENTS.md (80 words)", "CLAUDE.md (950 words)"]);
  });
});
