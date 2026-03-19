import { describe, expect, it } from "vitest";

import { scoreReport } from "../src/scoring/scoreReport.js";
import type { AcceleratorCheckResult, CheckResult, RepoClassification, RepoDiscovery } from "../src/core/types.js";

function makeDiscovery(): RepoDiscovery {
  return {
    rootPath: "/tmp/example",
    hasGitMetadata: false,
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
    ecosystems: [],
    packageJson: null,
    textByPath: new Map(),
  };
}

function makeClassification(kind: RepoClassification["kind"]): RepoClassification {
  return {
    kind,
    isMonorepo: false,
    hasRuntimeEntrypoint: kind === "application" || kind === "cli",
    reasons: [],
  };
}

function makeResult(overrides: Partial<CheckResult> & Pick<CheckResult, "id" | "pillar" | "name" | "weight" | "status">): CheckResult {
  return {
    remediation: "fix it",
    awardedWeight: overrides.status === "pass" ? overrides.weight : overrides.status === "partial" ? overrides.weight / 2 : 0,
    evidence: [],
    confidence: 1,
    ...overrides,
  };
}

function makeAccelerator(
  overrides: Partial<AcceleratorCheckResult> &
    Pick<AcceleratorCheckResult, "id" | "name" | "maxPoints" | "status">,
): AcceleratorCheckResult {
  return {
    remediation: "wire it up",
    awardedPoints: overrides.status === "pass" ? overrides.maxPoints : overrides.status === "partial" ? overrides.maxPoints / 2 : 0,
    evidence: [],
    confidence: 1,
    ...overrides,
  };
}

describe("scoreReport", () => {
  it("excludes not applicable checks from the denominator", () => {
    const report = scoreReport({
      scannedPath: "/tmp/example",
      classification: makeClassification("cli"),
      discovery: makeDiscovery(),
      checkResults: [
        makeResult({
          id: "formatterConfigured",
          pillar: "styleValidation",
          name: "Formatter configured",
          weight: 10,
          status: "pass",
        }),
        makeResult({
          id: "metricsTracingOrErrorReporting",
          pillar: "observability",
          name: "Metrics",
          weight: 10,
          status: "not_applicable",
        }),
      ],
      acceleratorResults: [
        makeAccelerator({
          id: "agentGuidanceDocs",
          name: "Agent guidance docs",
          maxPoints: 2,
          status: "pass",
        }),
      ],
    });

    expect(report.baseScore).toBe(100);
    expect(report.acceleratorBonus).toBe(2);
    expect(report.overallScore).toBe(100);
    expect(report.pillars.find((pillar) => pillar.id === "observability")?.applicableWeight).toBe(0);
  });

  it("does not let accelerator points inflate the headline compatibility score", () => {
    const report = scoreReport({
      scannedPath: "/tmp/example",
      classification: makeClassification("application"),
      discovery: makeDiscovery(),
      checkResults: [
        makeResult({
          id: "formatterConfigured",
          pillar: "styleValidation",
          name: "Formatter configured",
          weight: 8,
          status: "pass",
        }),
        makeResult({
          id: "ciWorkflowPresent",
          pillar: "buildTasks",
          name: "CI workflow present",
          weight: 2,
          status: "fail",
        }),
      ],
      acceleratorResults: [
        makeAccelerator({
          id: "cursorMcpConfigured",
          name: "Cursor MCP setup",
          maxPoints: 2,
          status: "pass",
        }),
        makeAccelerator({
          id: "claudeToolingConfigured",
          name: "Claude project tooling",
          maxPoints: 2,
          status: "pass",
        }),
      ],
    });

    expect(report.baseScore).toBe(80);
    expect(report.acceleratorBonus).toBe(4);
    expect(report.overallScore).toBe(80);
  });

  it("deprioritizes coverage in top recommendations when it would otherwise tie with other checks", () => {
    const report = scoreReport({
      scannedPath: "/tmp/example",
      classification: makeClassification("application"),
      discovery: makeDiscovery(),
      checkResults: [
        makeResult({
          id: "coverageSignalPresent",
          pillar: "testing",
          name: "Coverage signal present",
          weight: 3,
          status: "fail",
        }),
        makeResult({
          id: "securityScanConfigured",
          pillar: "securityGovernance",
          name: "Security scan configured",
          weight: 3,
          status: "fail",
        }),
      ],
      acceleratorResults: [],
    });

    expect(report.recommendations.map((item) => item.checkId)).toEqual([
      "securityScanConfigured",
      "coverageSignalPresent",
    ]);
  });
});
