import type { ScanReport } from "../core/types.js";

export function renderJsonReport(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}
