import { describe, expect, it } from "vitest";

import { formatRubricCheckSentence, isRedundantScannerEvidence } from "../src/reporters/sentences.js";
import type { CheckResult } from "../src/core/types.js";

function makeCheck(overrides: Partial<CheckResult> & Pick<CheckResult, "id" | "pillar" | "name" | "weight" | "status">): CheckResult {
  return {
    remediation: "Add operational signals such as metrics, tracing, or error reporting.",
    awardedWeight: 0,
    evidence: [],
    confidence: 1,
    ...overrides,
  };
}

describe("report sentence formatting", () => {
  it("treats generic no-…-found evidence as redundant", () => {
    expect(isRedundantScannerEvidence("no metrics, tracing, or error reporting signal found")).toBe(true);
    expect(isRedundantScannerEvidence("no CI workflow files found")).toBe(true);
    expect(isRedundantScannerEvidence("eslint.config.mjs")).toBe(false);
    expect(isRedundantScannerEvidence("formatter signal found")).toBe(false);
  });

  it("does not add redundant evidence to the status fragment", () => {
    const line = formatRubricCheckSentence(
      makeCheck({
        id: "metricsTracingOrErrorReporting",
        pillar: "observability",
        name: "Metrics, tracing, or error reporting",
        weight: 2,
        status: "fail",
        evidence: ["no metrics, tracing, or error reporting signal found"],
      }),
    );

    expect(line).toBe("Metrics, tracing, or error reporting, not seen.");
    expect(line).not.toContain("signal found");
  });
});
