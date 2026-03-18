import type { AcceleratorCheckResult, CheckResult, ScanReport } from "../core/types.js";

function formatStatus(check: CheckResult): string {
  switch (check.status) {
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

function formatAcceleratorStatus(check: AcceleratorCheckResult): string {
  switch (check.status) {
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

export function renderTextReport(report: ScanReport, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const { verbose = false } = options;

  lines.push(`Agent compatibility score: ${report.overallScore}/100 (${report.maturity})`);
  lines.push(`Repo type: ${report.classification.kind}`);
  lines.push(`Ecosystems: ${report.ecosystems.length > 0 ? report.ecosystems.join(", ") : "unknown"}`);
  lines.push("");
  lines.push("Pillars:");

  for (const pillar of report.pillars) {
    const pillarSummary = pillar.applicableWeight === 0 ? "n/a" : `${pillar.score}/100`;
    lines.push(`  - ${pillar.name}: ${pillarSummary}`);

    const visibleChecks = verbose
      ? pillar.checks
      : pillar.checks.filter((check) => check.status === "fail" || check.status === "partial");

    for (const check of visibleChecks) {
      const evidence = check.evidence[0] ? ` (${check.evidence[0]})` : "";
      lines.push(`    * ${check.name}: ${formatStatus(check)}${evidence}`);
    }
  }

  if (report.accelerators.maxBonusPoints > 0 || verbose) {
    lines.push("");
    lines.push(`Agent accelerators: ${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}`);

    const visibleChecks = verbose
      ? report.accelerators.checks
      : report.accelerators.checks.filter((check) => check.status === "fail" || check.status === "partial" || check.status === "pass");

    for (const check of visibleChecks) {
      const evidence = check.evidence[0] ? ` (${check.evidence[0]})` : "";
      lines.push(`  - ${check.name}: ${formatAcceleratorStatus(check)}${evidence}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("Top fixes:");
    for (const recommendation of report.recommendations) {
      lines.push(`  - [${recommendation.pillar}] ${recommendation.title}: ${recommendation.remediation}`);
    }
  }

  if (report.accelerators.opportunities.length > 0) {
    lines.push("");
    lines.push("Agent tooling opportunities:");
    for (const opportunity of report.accelerators.opportunities) {
      lines.push(`  - ${opportunity.title}: ${opportunity.remediation}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return lines.join("\n");
}
