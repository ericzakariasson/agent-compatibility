import path from "node:path";

import { runAcceleratorChecks } from "../checks/runAcceleratorChecks.js";
import { DEFAULT_ACCELERATORS } from "../config/defaultAccelerators.js";
import { runDeterministicChecks } from "../checks/runDeterministicChecks.js";
import { DEFAULT_RUBRIC } from "../config/defaultRubric.js";
import { scoreReport } from "../scoring/scoreReport.js";
import { classifyRepository } from "./classifyRepo.js";
import { discoverRepository } from "./discovery.js";
import type { AcceleratorCheckDefinition, CheckDefinition, ScanOptions, ScanReport } from "./types.js";

function resolveRubric(weights: Record<string, number> | undefined): CheckDefinition[] {
  return DEFAULT_RUBRIC.map((definition) => ({
    ...definition,
    weight: weights?.[definition.id] ?? definition.weight,
  }));
}

function resolveAccelerators(weights: Record<string, number> | undefined): AcceleratorCheckDefinition[] {
  return DEFAULT_ACCELERATORS.map((definition) => ({
    ...definition,
    maxPoints: weights?.[definition.id] ?? definition.maxPoints,
  }));
}

export async function scanRepository(options: ScanOptions): Promise<ScanReport> {
  const rootPath = path.resolve(options.rootPath);
  const discovery = await discoverRepository(rootPath, options.config?.ignoredPaths ?? []);
  const classification = classifyRepository(discovery);

  if (classification.kind === "unknown") {
    discovery.warnings.push("Repository type could not be classified confidently.");
  }
  if (discovery.ecosystems.length === 0) {
    discovery.warnings.push("No primary ecosystem was detected.");
  }

  const rubric = resolveRubric(options.config?.weights);
  const accelerators = resolveAccelerators(options.config?.weights);
  const checkResults = runDeterministicChecks(rubric, {
    discovery,
    classification,
  });
  const acceleratorResults = runAcceleratorChecks(accelerators, {
    discovery,
    classification,
  });

  return scoreReport({
    scannedPath: rootPath,
    classification,
    discovery,
    checkResults,
    acceleratorResults,
  });
}
