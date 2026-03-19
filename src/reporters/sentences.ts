import type { AcceleratorCheckResult, AcceleratorOpportunity, CheckResult, Recommendation } from "../core/types.js";

/** Scanner phrasing that repeats the check name without adding a path or concrete cue. */
export function isRedundantScannerEvidence(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) {
    return true;
  }
  if (/^no\s+.+\s+found\.?$/i.test(t)) {
    return true;
  }
  if (/^no\s+.+\s+signal\s+found\.?$/i.test(t)) {
    return true;
  }
  if (/^no\s+.+\s+detected\.?$/i.test(t)) {
    return true;
  }
  return false;
}

function firstUsefulEvidence(evidence: string[]): string | undefined {
  return evidence.find((item) => !isRedundantScannerEvidence(item));
}

function statusWordForRubric(status: CheckResult["status"]): string {
  switch (status) {
    case "pass":
      return "ok";
    case "partial":
      return "partial";
    case "fail":
      return "not seen";
    case "not_applicable":
      return "n/a";
  }
}

function statusWordForAccelerator(status: AcceleratorCheckResult["status"]): string {
  return statusWordForRubric(status);
}

/**
 * Status fragment only: name, status, and an optional evidence parenthetical.
 * Omits generic scanner lines like "no X signal found" that repeat the check name.
 * Callers append remediation separately when building a full bullet.
 */
export function formatRubricCheckSentence(check: CheckResult): string {
  const w = statusWordForRubric(check.status);
  const useful = firstUsefulEvidence(check.evidence);
  const cue = useful ? ` (${useful})` : "";
  return `${check.name}, ${w}${cue}.`;
}

export function formatAcceleratorCheckSentence(check: AcceleratorCheckResult): string {
  const w = statusWordForAccelerator(check.status);
  const useful = firstUsefulEvidence(check.evidence);
  const cue = useful ? ` (${useful})` : "";
  return `${check.name}, ${w}${cue}.`;
}

export function ensureSentenceEnds(text: string): string {
  const t = text.trim();
  if (!t) {
    return text;
  }
  return /[.!?]"?$/.test(t) ? t : `${t}.`;
}

export function formatRecommendationSentence(rec: Recommendation): string {
  const useful = rec.evidence.filter((item) => !isRedundantScannerEvidence(item));
  const cue =
    useful.length > 0
      ? ` Cues: ${useful.map((item) => `\`${item}\``).join(", ")}.`
      : "";
  return `${rec.title} (${rec.pillar}). ${ensureSentenceEnds(rec.remediation)}${cue}`;
}

export function formatOpportunitySentence(opp: AcceleratorOpportunity): string {
  const useful = opp.evidence.filter((item) => !isRedundantScannerEvidence(item));
  const cue =
    useful.length > 0
      ? ` Cues: ${useful.map((item) => `\`${item}\``).join(", ")}.`
      : "";
  return `${opp.title}. ${ensureSentenceEnds(opp.remediation)}${cue}`;
}
