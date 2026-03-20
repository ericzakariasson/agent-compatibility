import { describe, expect, it } from "vitest";

import type { ScanReport } from "../src/core/types.js";
import { getProblemMenuOptions, renderTuiReport } from "../src/reporters/tui.js";

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
          title: "Cursor project tooling",
          remediation:
            "Add project-specific .agents/skills, .cursor rules/skills/agents, or both so Cursor has reusable repo context.",
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
  it("only shows the Cursor option when Cursor is available", () => {
    expect(
      getProblemMenuOptions({
        totalProblems: 20,
        problemLimit: 5,
        cursorFixAvailable: true,
        copyPromptAvailable: true,
      }).map((option) => option.label),
    ).toEqual(["Fix with Cursor", "Copy prompt to fix", "Show all 20 problems"]);

    expect(
      getProblemMenuOptions({
        totalProblems: 20,
        problemLimit: 5,
        cursorFixAvailable: false,
        copyPromptAvailable: true,
      }).map((option) => option.label),
    ).toEqual(["Copy prompt to fix", "Show all 20 problems"]);

    expect(
      getProblemMenuOptions({
        totalProblems: 20,
        problemLimit: 5,
        cursorFixAvailable: true,
        copyPromptAvailable: false,
      }).map((option) => option.label),
    ).toEqual(["Fix with Cursor", "Show all 20 problems"]);

    expect(
      getProblemMenuOptions({
        totalProblems: 3,
        problemLimit: 5,
        cursorFixAvailable: false,
        copyPromptAvailable: false,
      }),
    ).toEqual([]);
  });

  it("renders a compact score dashboard", () => {
    const output = renderTuiReport(makeReport(), {
      color: false,
      width: 90,
    });

    expect(output).toContain("┏━━━━━━━━━━┓");
    expect(output).toContain("┃    42    ┃");
    expect(output).toContain("┃          ┃  Agent Compatibility Score");
    expect(output).toContain("Agent Compatibility Score");
    expect(output).toContain("node application repo / 3 open checks across 2 pillars");
    expect(output).toContain("Open rubric / accelerator cues");
    expect(output).toContain("- Add a linter and wire it into local validation or CI.");
    expect(output).not.toContain("Fix with Cursor");
    expect(output).not.toContain("cursor://anysphere.cursor-deeplink/prompt?text=");
    expect(output).not.toContain("https://cursor.com/link/prompt");
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
              remediation: "Add AGENTS.md with concise, repo-specific guidance for autonomous work.",
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
    expect(output).toContain("- Add AGENTS.md with concise,");
    expect(output).toContain("repo-specific guidance for autonomous work.");
    expect(output).toContain("AGENTS.md (450");
    expect(output).toContain("words))");
    expect(output).not.toContain("(1pt)");
  });

  it("dedupes overlapping AGENTS guidance suggestions", () => {
    const output = renderTuiReport(
      makeReport({
        pillars: [
          {
            id: "documentation",
            name: "Documentation",
            score: 0,
            awardedWeight: 0,
            applicableWeight: 4,
            checks: [
              {
                id: "contributionOrAgentGuidance",
                pillar: "documentation",
                name: "Agent workflow guidance",
                weight: 2,
                remediation: "Add AGENTS.md or equivalent agent-facing workflow guidance.",
                status: "fail",
                awardedWeight: 0,
                evidence: [],
                confidence: 1,
              },
            ],
          },
        ],
        accelerators: {
          bonusPoints: 0,
          maxBonusPoints: 8,
          checks: [
            {
              id: "agentGuidanceDocs",
              name: "Agent guidance docs",
              maxPoints: 2,
              remediation: "Add AGENTS.md with concise, repo-specific guidance for autonomous work.",
              status: "partial",
              awardedPoints: 1,
              evidence: ["README"],
              confidence: 1,
            },
          ],
          opportunities: [],
        },
      }),
      {
        color: false,
        showAllProblems: true,
        width: 120,
      },
    );

    expect(output).toContain("- Add AGENTS.md or equivalent agent-facing workflow guidance.");
    expect(output).not.toContain("Add AGENTS.md with concise, repo-specific guidance for autonomous work.");
  });

  it("uses the actionable sentence when remediation has multiple sentences", () => {
    const output = renderTuiReport(
      makeReport({
        pillars: [
          {
            id: "testing",
            name: "Testing",
            score: 0,
            awardedWeight: 0,
            applicableWeight: 1,
            checks: [
              {
                id: "coverageSignalPresent",
                pillar: "testing",
                name: "Coverage signal present",
                weight: 1,
                remediation:
                  "Optional signal for agents and reviewers. Add coverage tooling, thresholds, or published reports if you want visible test-gap reporting.",
                status: "fail",
                awardedWeight: 0,
                evidence: [],
                confidence: 1,
              },
            ],
          },
        ],
        accelerators: {
          bonusPoints: 0,
          maxBonusPoints: 8,
          checks: [],
          opportunities: [],
        },
      }),
      {
        color: false,
        width: 120,
      },
    );

    expect(output).toContain("Add coverage tooling, thresholds, or published reports if you want visible test-gap reporting.");
    expect(output).not.toContain("Optional signal for agents and reviewers");
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
    expect(output).toContain("node application repo / no open checks");
    expect(output).toContain("No open checks in this pass.");
  });

  it("limits the default problem list to five items and supports rendering all problems", () => {
    const crowdedReport = makeReport({
      pillars: [
        {
          id: "styleValidation",
          name: "Style & Validation",
          score: 0,
          awardedWeight: 0,
          applicableWeight: 24,
          checks: Array.from({ length: 6 }, (_, index) => ({
            id: `issue-${index + 1}`,
            pillar: "styleValidation" as const,
            name: `Issue ${index + 1}`,
            weight: 4,
            remediation: `Fix issue ${index + 1}.`,
            status: "fail" as const,
            awardedWeight: 0,
            evidence: [],
            confidence: 1,
          })),
        },
      ],
      accelerators: {
        bonusPoints: 0,
        maxBonusPoints: 8,
        checks: [],
        opportunities: [],
      },
    });

    const limitedOutput = renderTuiReport(crowdedReport, {
      color: false,
      width: 120,
    });

    expect(limitedOutput).toContain("Showing 5 of 6 problems.");
    expect(limitedOutput).toContain("Fix issue 5.");
    expect(limitedOutput).not.toContain("Fix issue 6.");

    const expandedOutput = renderTuiReport(crowdedReport, {
      color: false,
      showAllProblems: true,
      width: 120,
    });

    expect(expandedOutput).toContain("Fix issue 6.");
    expect(expandedOutput).not.toContain("Showing 5 of 6 problems.");
  });
});
