import { describe, expect, it } from "vitest";

import type { ScanReport } from "../src/core/types.js";
import { renderMarkdownReport } from "../src/reporters/markdown.js";

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
    warnings: ["Repository root could not be fully classified."],
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
            evidence: ["formatter signal found"],
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
            evidence: ["no CI workflow files found"],
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
          remediation: "Add AGENTS.md so agents have project context.",
          status: "partial",
          awardedPoints: 1,
          evidence: ["README"],
          confidence: 1,
        },
      ],
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
    recommendations: [
      {
        pillar: "Style & Validation",
        checkId: "linterConfigured",
        title: "Linter configured",
        remediation: "Add a linter and wire it into local validation or CI.",
        weight: 4,
        evidence: [],
      },
    ],
    ...overrides,
  };
}

describe("renderMarkdownReport", () => {
  it("renders a structured Markdown report for agents", () => {
    const output = renderMarkdownReport(makeReport());

    expect(output).toContain("# Agent Compatibility Report");
    expect(output).toContain("_Heuristic pass over repo files");
    expect(output).toContain("## Summary");
    expect(output).toContain("- **42/100** (Basic) · application · node");
    expect(output).toContain("`.` · **4** open (3 rubric · 1 accelerator) · **2** pillars with gaps · accelerator **1/8**");
    expect(output).toContain("## Suggested next steps");
    expect(output).toContain(
      "- Linter configured (Style & Validation). Add a linter and wire it into local validation or CI.",
    );
    expect(output).toContain("## Open Checks");
    expect(output).toContain("### Style & Validation");
    expect(output).toContain(
      "- Formatter configured, partial (formatter signal found). Add a formatter and expose it through a script or task.",
    );
    expect(output).toContain("### Agent accelerators");
    expect(output).toContain(
      "- Agent guidance docs, partial (README). Add AGENTS.md so agents have project context.",
    );
    expect(output).toContain("## Agent Accelerators");
    expect(output).toContain("## Agent Tooling Opportunities");
    expect(output).toContain(
      "- Cursor project tooling. Add project-specific .agents/skills, .cursor rules/skills/agents, or both so Cursor has reusable repo context.",
    );
    expect(output).toContain("## Warnings");
    expect(output).toContain("- Repository root could not be fully classified.");
  });

  it("handles healthy reports without open checks", () => {
    const output = renderMarkdownReport(
      makeReport({
        baseScore: 88,
        overallScore: 88,
        maturity: "Agent-Ready",
        warnings: [],
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
                evidence: ["eslint.config.js"],
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
        recommendations: [],
      }),
    );

    expect(output).toContain("**0** open (0 rubric · 0 accelerator)");
    expect(output).toContain("## Suggested next steps");
    expect(output).toContain("- None.");
    expect(output).toContain("## Open Checks");
    expect(output).toContain("## Warnings");
  });
});
