import { PILLAR_NAMES, PILLAR_ORDER } from "../config/defaultRubric.js";
import type {
  AcceleratorCheckResult,
  CheckResult,
  MaturityBand,
  PillarResult,
  RepoClassification,
  RepoDiscovery,
  ScanReport,
} from "../core/types.js";

function clampScore(value: number): number {
  return Math.min(100, Math.max(1, value));
}

function getMaturityBand(score: number): MaturityBand {
  if (score <= 20) {
    return "Fragile";
  }

  if (score <= 40) {
    return "Basic";
  }

  if (score <= 60) {
    return "Functional";
  }

  if (score <= 80) {
    return "Standardized";
  }

  return "Agent-Ready";
}

export function scoreReport(args: {
  scannedPath: string;
  classification: RepoClassification;
  discovery: RepoDiscovery;
  checkResults: CheckResult[];
  acceleratorResults: AcceleratorCheckResult[];
}): ScanReport {
  const { scannedPath, classification, discovery, checkResults, acceleratorResults } = args;

  const pillars: PillarResult[] = PILLAR_ORDER.map((pillarId) => {
    const checks = checkResults.filter((result) => result.pillar === pillarId);
    const applicableChecks = checks.filter((result) => result.status !== "not_applicable");
    const applicableWeight = applicableChecks.reduce((sum, result) => sum + result.weight, 0);
    const awardedWeight = applicableChecks.reduce((sum, result) => sum + result.awardedWeight, 0);
    const score = applicableWeight === 0 ? 0 : Math.round((awardedWeight / applicableWeight) * 100);

    return {
      id: pillarId,
      name: PILLAR_NAMES[pillarId],
      score,
      awardedWeight,
      applicableWeight,
      checks,
    };
  });

  const applicableWeight = pillars.reduce((sum, pillar) => sum + pillar.applicableWeight, 0);
  const awardedWeight = pillars.reduce((sum, pillar) => sum + pillar.awardedWeight, 0);

  let baseScore = applicableWeight === 0 ? 1 : clampScore(Math.round((awardedWeight / applicableWeight) * 100));
  const applicableAccelerators = acceleratorResults.filter((result) => result.status !== "not_applicable");
  const maxBonusPoints = applicableAccelerators.reduce((sum, result) => sum + result.maxPoints, 0);
  const bonusPoints = applicableAccelerators.reduce((sum, result) => sum + result.awardedPoints, 0);
  let overallScore = baseScore;
  const warnings = [...discovery.warnings];

  const weakSignalRepo =
    classification.kind === "unknown" &&
    discovery.manifests.length === 0 &&
    discovery.sourceFiles.length === 0 &&
    discovery.testFiles.length === 0;

  if (weakSignalRepo) {
    baseScore = 1;
    overallScore = 1;
    warnings.push("The repository had too few recognizable source or config signals to score confidently.");
  }

  const acceleratorOpportunities = acceleratorResults
    .filter((result) => result.status === "fail" || result.status === "partial")
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
    })
    .map((result) => ({
      checkId: result.id,
      title: result.name,
      remediation: result.remediation,
      maxPoints: result.maxPoints,
      evidence: result.evidence,
    }));

  const recommendations = checkResults
    .filter((result) => result.status === "fail" || result.status === "partial")
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
    })
    .slice(0, 5)
    .map((result) => ({
      pillar: PILLAR_NAMES[result.pillar],
      checkId: result.id,
      title: result.name,
      remediation: result.remediation,
      weight: result.weight,
      evidence: result.evidence,
    }));

  return {
    scannedPath,
    baseScore,
    acceleratorBonus: bonusPoints,
    overallScore,
    maturity: getMaturityBand(overallScore),
    classification,
    ecosystems: discovery.ecosystems,
    warnings,
    pillars,
    accelerators: {
      bonusPoints,
      maxBonusPoints,
      checks: acceleratorResults,
      opportunities: acceleratorOpportunities,
    },
    recommendations,
  };
}
