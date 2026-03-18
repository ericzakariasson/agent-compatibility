import { describe, expect, it } from "vitest";

import type { ScanReport } from "../src/core/types.js";
import { renderTuiReport } from "../src/reporters/tui.js";

function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    scannedPath: ".",
    baseScore: 42,
    acceleratorBonus: 1,
    overallScore: 42,
    maturity: "Basic",
    classification: {
      kind: "application",
      isMonorepo: false,
      hasRuntimeEntrypoint: true,
      reasons: [],
    },
    ecosystems: ["node"],
    warnings: [],
    pillars: [
      {
        id: "styleValidation",
        name: "Style & Validation",
        score: 25,
        awardedWeight: 2,
        applicableWeight: 8,
        checks: [
          {
            id: "linterConfigured",
            pillar: "styleValidation",
            name: "Linter configured",
            weight: 4,
            remediation: "Add a linter and wire it into local validation or CI.",
            status: "fail",
            awardedWeight: 0,
            evidence: [],
            confidence: 1,
          },
          {
            id: "formatterConfigured",
            pillar: "styleValidation",
            name: "Formatter configured",
            weight: 4,
            remediation: "Add a formatter and expose it through a script or task.",
            status: "partial",
            awardedWeight: 2,
            evidence: [],
            confidence: 1,
          },
        ],
      },
      {
        id: "buildTasks",
        name: "Build & Tasks",
        score: 50,
        awardedWeight: 2,
        applicableWeight: 4,
        checks: [
          {
            id: "ciWorkflowPresent",
            pillar: "buildTasks",
            name: "CI workflow present",
            weight: 4,
            remediation: "Add CI that runs validation and tests from the repository itself.",
            status: "fail",
            awardedWeight: 0,
            evidence: [],
            confidence: 1,
          },
        ],
      },
    ],
    accelerators: {
      bonusPoints: 1,
      maxBonusPoints: 8,
      checks: [],
      opportunities: [
        {
          checkId: "cursorToolingConfigured",
          title: "Cursor tooling configured",
          remediation: "Add project-specific .cursor rules, skills, or agents so Cursor has reusable repo context.",
          maxPoints: 2,
          evidence: [],
        },
      ],
    },
    recommendations: [],
    ...overrides,
  };
}

describe("renderTuiReport", () => {
  it("renders a compact score dashboard", () => {
    const output = renderTuiReport(makeReport(), {
      color: false,
      width: 90,
    });

    expect(output).toContain("┏");
    expect(output).toContain("42");
    expect(output).toContain("Agent Compatibility Score");
    expect(output).toContain("Workable today, but still missing a few important signals.");
    expect(output).toContain("node application repo / 3 open checks across 2 pillars");
    expect(output).toContain("Problems");
    expect(output).toContain("Linter configured: Add a linter and wire it into local validation or CI (4)");
  });

  it("includes accelerator issues in the problem list", () => {
    const output = renderTuiReport(
      makeReport({
        pillars: [
          {
            id: "styleValidation",
            name: "Style & Validation",
            score: 100,
            awardedWeight: 8,
            applicableWeight: 8,
            checks: [
              {
                id: "linterConfigured",
                pillar: "styleValidation",
                name: "Linter configured",
                weight: 4,
                remediation: "Add a linter and wire it into local validation or CI.",
                status: "pass",
                awardedWeight: 4,
                evidence: [],
                confidence: 1,
              },
            ],
          },
        ],
        accelerators: {
          bonusPoints: 1,
          maxBonusPoints: 8,
          checks: [
            {
              id: "agentGuidanceDocs",
              name: "Agent guidance docs",
              maxPoints: 2,
              remediation: "Add AGENTS.md or CLAUDE.md with concise, repo-specific guidance for autonomous work.",
              status: "partial",
              awardedPoints: 1,
              evidence: ["AGENTS.md (450 words)"],
              confidence: 1,
            },
          ],
          opportunities: [],
        },
      }),
      {
        color: false,
        width: 90,
      },
    );

    expect(output).toContain("node application repo / no open rubric checks / 1 accelerator issue");
    expect(output).toContain("Agent guidance docs: Add AGENTS.md or CLAUDE.md with concise, repo-specific guidance");
    expect(output).toContain("[AGENTS.md (450 words)] (1)");
  });

  it("shows a healthy footer when no issues remain", () => {
    const output = renderTuiReport(
      makeReport({
        baseScore: 88,
        overallScore: 88,
        maturity: "Agent-Ready",
        pillars: [
          {
            id: "styleValidation",
            name: "Style & Validation",
            score: 100,
            awardedWeight: 8,
            applicableWeight: 8,
            checks: [
              {
                id: "linterConfigured",
                pillar: "styleValidation",
                name: "Linter configured",
                weight: 4,
                remediation: "Add a linter and wire it into local validation or CI.",
                status: "pass",
                awardedWeight: 4,
                evidence: [],
                confidence: 1,
              },
            ],
          },
        ],
        accelerators: {
          bonusPoints: 2,
          maxBonusPoints: 8,
          checks: [],
          opportunities: [],
        },
      }),
      {
        color: false,
        width: 90,
      },
    );

    expect(output).toContain("┏");
    expect(output).toContain("88");
    expect(output).toContain("Agent Compatibility Score");
    expect(output).toContain("Ready for agent-driven work with only minor cleanup left.");
    expect(output).toContain("node application repo / no open checks");
    expect(output).toContain("No high-priority fixes surfaced in the scored rubric.");
  });
});
