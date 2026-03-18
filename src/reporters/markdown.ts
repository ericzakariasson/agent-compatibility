import type { AcceleratorCheckResult, CheckResult, PillarResult, ScanReport } from "../core/types.js";

function formatStatus(status: CheckResult["status"] | AcceleratorCheckResult["status"]): string {
  switch (status) {
    case "pass":
      return "pass";
    case "partial":
      return "partial";
    case "fail":
      return "fail";
    case "not_applicable":
      return "n/a";
  }
}

function formatEvidence(evidence: string[]): string {
  return evidence.length > 0 ? evidence.map((item) => `\`${item}\``).join(", ") : "none";
}

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
  lines.push("## Priority Fixes");

  if (report.recommendations.length === 0) {
    lines.push("- None.");
    lines.push("");
    return;
  }

  for (const recommendation of report.recommendations) {
    lines.push(
      `- \`${recommendation.checkId}\` | pillar: \`${recommendation.pillar}\` | weight: ${recommendation.weight}`,
    );
    lines.push(`  - title: ${recommendation.title}`);
    lines.push(`  - remediation: ${recommendation.remediation}`);
    lines.push(`  - evidence: ${formatEvidence(recommendation.evidence)}`);
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
      lines.push(`- \`${check.id}\` | status: \`${formatStatus(check.status)}\` | weight: ${check.weight}`);
      lines.push(`  - title: ${check.name}`);
      lines.push(`  - remediation: ${check.remediation}`);
      lines.push(`  - evidence: ${formatEvidence(check.evidence)}`);
    }

    lines.push("");
  }

  if (acceleratorChecks.length > 0) {
    lines.push("### Agent accelerators");

    for (const check of acceleratorChecks) {
      lines.push(`- \`${check.id}\` | status: \`${formatStatus(check.status)}\` | points: ${check.awardedPoints}/${check.maxPoints}`);
      lines.push(`  - title: ${check.name}`);
      lines.push(`  - remediation: ${check.remediation}`);
      lines.push(`  - evidence: ${formatEvidence(check.evidence)}`);
    }

    lines.push("");
  }
}

function renderPillarScores(lines: string[], report: ScanReport): void {
  lines.push("## Pillar Scores");

  for (const pillar of report.pillars) {
    const score = pillar.applicableWeight === 0 ? "n/a" : formatScore(pillar.score);
    lines.push(
      `- ${pillar.name}: ${score} (awarded ${pillar.awardedWeight} of ${pillar.applicableWeight} applicable points)`,
    );
  }

  lines.push("");
}

function renderAccelerators(lines: string[], report: ScanReport): void {
  lines.push("## Agent Accelerators");
  lines.push(`- bonus: ${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}`);

  if (report.accelerators.checks.length === 0) {
    lines.push("- checks: none");
  } else {
    for (const check of report.accelerators.checks) {
      lines.push(
        `- \`${check.id}\` | status: \`${formatStatus(check.status)}\` | points: ${check.awardedPoints}/${check.maxPoints}`,
      );
      lines.push(`  - title: ${check.name}`);
      lines.push(`  - remediation: ${check.remediation}`);
      lines.push(`  - evidence: ${formatEvidence(check.evidence)}`);
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
    lines.push(`- \`${opportunity.checkId}\` | max_points: ${opportunity.maxPoints}`);
    lines.push(`  - title: ${opportunity.title}`);
    lines.push(`  - remediation: ${opportunity.remediation}`);
    lines.push(`  - evidence: ${formatEvidence(opportunity.evidence)}`);
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
  lines.push("## Summary");
  lines.push(`- score: ${formatScore(report.overallScore)}`);
  lines.push(`- maturity: ${report.maturity}`);
  lines.push(`- repo_type: ${report.classification.kind}`);
  lines.push(`- ecosystems: ${report.ecosystems.length > 0 ? report.ecosystems.join(", ") : "unknown"}`);
  lines.push(`- scanned_path: \`${report.scannedPath}\``);
  lines.push(`- open_checks: ${openChecks.length + openAcceleratorChecks.length}`);
  lines.push(`- rubric_open_checks: ${openChecks.length}`);
  lines.push(`- accelerator_issues: ${openAcceleratorChecks.length}`);
  lines.push(`- affected_pillars: ${affectedPillars}`);
  lines.push(`- accelerator_bonus: ${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}`);
  lines.push("");

  renderPriorityFixes(lines, report);
  renderOpenChecks(lines, report.pillars, openAcceleratorChecks);
  renderPillarScores(lines, report);
  renderAccelerators(lines, report);
  renderOpportunities(lines, report);
  renderWarnings(lines, report);

  return lines.join("\n").trimEnd();
}
