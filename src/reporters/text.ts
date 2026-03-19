import type { ScanReport } from "../core/types.js";

import {
  ensureSentenceEnds,
  formatAcceleratorCheckSentence,
  formatOpportunitySentence,
  formatRecommendationSentence,
  formatRubricCheckSentence,
} from "./sentences.js";

export function renderTextReport(report: ScanReport, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const { verbose = false } = options;

  lines.push(`Compatibility (heuristic): ${report.overallScore}/100 · ${report.maturity}`);
  lines.push(
    `${report.classification.kind} repo · ecosystems ${report.ecosystems.length > 0 ? report.ecosystems.join(", ") : "unknown"}`,
  );
  lines.push("");
  lines.push("Pillars");

  for (const pillar of report.pillars) {
    const pillarSummary = pillar.applicableWeight === 0 ? "n/a" : `${pillar.score}/100`;
    lines.push(`  - ${pillar.name} · ${pillarSummary}`);

    const visibleChecks = verbose
      ? pillar.checks
      : pillar.checks.filter((check) => check.status === "fail" || check.status === "partial");

    for (const check of visibleChecks) {
      lines.push(`    * ${formatRubricCheckSentence(check)} ${ensureSentenceEnds(check.remediation)}`);
    }
  }

  if (report.accelerators.maxBonusPoints > 0 || verbose) {
    lines.push("");
    lines.push(`Accelerators (bonus): ${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}`);

    const visibleChecks = report.accelerators.checks.filter(
      (check) => check.status !== "not_applicable" && (verbose || check.status === "fail" || check.status === "partial" || check.status === "pass"),
    );

    for (const check of visibleChecks) {
      lines.push(`  - ${formatAcceleratorCheckSentence(check)} ${ensureSentenceEnds(check.remediation)}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("Suggested next steps (rubric)");
    for (const recommendation of report.recommendations) {
      lines.push(`  - ${formatRecommendationSentence(recommendation)}`);
    }
  }

  if (report.accelerators.opportunities.length > 0) {
    lines.push("");
    lines.push("Agent tooling opportunities");
    for (const opportunity of report.accelerators.opportunities) {
      lines.push(`  - ${formatOpportunitySentence(opportunity)}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return lines.join("\n");
}
