import type { AcceleratorCheckResult, CheckResult, PillarResult, ScanReport } from "../core/types.js";

import {
  ensureSentenceEnds,
  formatAcceleratorCheckSentence,
  formatOpportunitySentence,
  formatRecommendationSentence,
  formatRubricCheckSentence,
} from "./sentences.js";

function formatScore(score: number): string {
  return `${score}/100`;
}

function getOpenChecks(report: ScanReport): CheckResult[] {
  return report.pillars
    .flatMap((pillar) => pillar.checks.filter((check) => check.status === "fail" || check.status === "partial"))
    .sort((left, right) => {
      if (left.awardedWeight !== right.awardedWeight) {
        return left.awardedWeight - right.awardedWeight;
      }

      if (left.weight !== right.weight) {
        return right.weight - left.weight;
      }

      if (left.status !== right.status) {
        return left.status === "fail" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function getOpenAcceleratorChecks(report: ScanReport): AcceleratorCheckResult[] {
  return report.accelerators.checks
    .filter((check) => check.status === "fail" || check.status === "partial")
    .sort((left, right) => {
      if (left.awardedPoints !== right.awardedPoints) {
        return left.awardedPoints - right.awardedPoints;
      }

      if (left.maxPoints !== right.maxPoints) {
        return right.maxPoints - left.maxPoints;
      }

      if (left.status !== right.status) {
        return left.status === "fail" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function renderPriorityFixes(lines: string[], report: ScanReport): void {
  lines.push("## Suggested next steps");

  if (report.recommendations.length === 0) {
    lines.push("- None.");
    lines.push("");
    return;
  }

  for (const recommendation of report.recommendations) {
    lines.push(`- ${formatRecommendationSentence(recommendation)}`);
  }

  lines.push("");
}

function renderOpenChecks(lines: string[], pillars: PillarResult[], acceleratorChecks: AcceleratorCheckResult[]): void {
  lines.push("## Open Checks");

  const openPillars = pillars.filter((pillar) =>
    pillar.checks.some((check) => check.status === "fail" || check.status === "partial"),
  );

  if (openPillars.length === 0 && acceleratorChecks.length === 0) {
    lines.push("- None.");
    lines.push("");
    return;
  }

  for (const pillar of openPillars) {
    lines.push(`### ${pillar.name}`);

    const checks = pillar.checks
      .filter((check) => check.status === "fail" || check.status === "partial")
      .sort((left, right) => {
        if (left.awardedWeight !== right.awardedWeight) {
          return left.awardedWeight - right.awardedWeight;
        }

        if (left.weight !== right.weight) {
          return right.weight - left.weight;
        }

        if (left.status !== right.status) {
          return left.status === "fail" ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });

    for (const check of checks) {
      lines.push(`- ${formatRubricCheckSentence(check)} ${ensureSentenceEnds(check.remediation)}`);
    }

    lines.push("");
  }

  if (acceleratorChecks.length > 0) {
    lines.push("### Agent accelerators");

    for (const check of acceleratorChecks) {
      lines.push(`- ${formatAcceleratorCheckSentence(check)} ${ensureSentenceEnds(check.remediation)}`);
    }

    lines.push("");
  }
}

function renderPillarScores(lines: string[], report: ScanReport): void {
  lines.push("## Pillar Scores");

  for (const pillar of report.pillars) {
    const score = pillar.applicableWeight === 0 ? "n/a" : formatScore(pillar.score);
    lines.push(`- ${pillar.name} **${score}** (${pillar.awardedWeight}/${pillar.applicableWeight} pts).`);
  }

  lines.push("");
}

function renderAccelerators(lines: string[], report: ScanReport): void {
  lines.push("## Agent Accelerators");
  lines.push(`- Bonus **${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}**.`);

  if (report.accelerators.checks.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const check of report.accelerators.checks.filter((entry) => entry.status !== "not_applicable")) {
      lines.push(`- ${formatAcceleratorCheckSentence(check)} ${ensureSentenceEnds(check.remediation)}`);
    }
  }

  lines.push("");
}

function renderOpportunities(lines: string[], report: ScanReport): void {
  lines.push("## Agent Tooling Opportunities");

  if (report.accelerators.opportunities.length === 0) {
    lines.push("- None.");
    lines.push("");
    return;
  }

  for (const opportunity of report.accelerators.opportunities) {
    lines.push(`- ${formatOpportunitySentence(opportunity)}`);
  }

  lines.push("");
}

function renderWarnings(lines: string[], report: ScanReport): void {
  lines.push("## Warnings");

  if (report.warnings.length === 0) {
    lines.push("- None.");
    lines.push("");
    return;
  }

  for (const warning of report.warnings) {
    lines.push(`- ${warning}`);
  }

  lines.push("");
}

export function renderMarkdownReport(report: ScanReport): string {
  const lines: string[] = [];
  const openChecks = getOpenChecks(report);
  const openAcceleratorChecks = getOpenAcceleratorChecks(report);
  const affectedPillars = report.pillars.filter((pillar) =>
    pillar.checks.some((check) => check.status === "fail" || check.status === "partial"),
  ).length;

  lines.push("# Agent Compatibility Report");
  lines.push("");
  lines.push("_Heuristic pass over repo files._");
  lines.push("");
  lines.push("## Summary");
  const ecosystems = report.ecosystems.length > 0 ? report.ecosystems.join(", ") : "unknown";
  lines.push(
    `- **${formatScore(report.overallScore)}** (${report.maturity}) · ${report.classification.kind} · ${ecosystems}`,
  );
  lines.push(`- \`${report.scannedPath}\` · **${openChecks.length + openAcceleratorChecks.length}** open (${openChecks.length} rubric · ${openAcceleratorChecks.length} accelerator) · **${affectedPillars}** pillars with gaps · accelerator **${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}**`,
  );
  lines.push("");

  renderPriorityFixes(lines, report);
  renderOpenChecks(lines, report.pillars, openAcceleratorChecks);
  renderPillarScores(lines, report);
  renderAccelerators(lines, report);
  renderOpportunities(lines, report);
  renderWarnings(lines, report);

  return lines.join("\n").trimEnd();
}
