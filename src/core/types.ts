export type CheckStatus = "pass" | "partial" | "fail" | "not_applicable";

export type PillarId =
  | "styleValidation"
  | "buildTasks"
  | "testing"
  | "documentation"
  | "devEnvironment"
  | "codeQuality"
  | "observability"
  | "securityGovernance";

export type RepoKind = "library" | "application" | "cli" | "monorepo" | "unknown";
export type Ecosystem = "node" | "python" | "go" | "rust";
export type MaturityBand = "Fragile" | "Basic" | "Functional" | "Standardized" | "Agent-Ready";

export interface RepoClassification {
  kind: RepoKind;
  isMonorepo: boolean;
  hasRuntimeEntrypoint: boolean;
  reasons: string[];
}

export interface PackageJsonData {
  name?: string;
  private?: boolean;
  type?: string;
  workspaces?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  main?: string;
  module?: string;
  exports?: unknown;
  license?: string;
  [key: string]: unknown;
}

export interface RepoDiscovery {
  rootPath: string;
  filePaths: string[];
  sourceFiles: string[];
  testFiles: string[];
  workflowFiles: string[];
  envExampleFiles: string[];
  docsFiles: string[];
  lockfiles: string[];
  manifests: string[];
  warnings: string[];
  ecosystems: Ecosystem[];
  packageJson: PackageJsonData | null;
  textByPath: Map<string, string>;
}

export interface CheckDefinition {
  id: string;
  pillar: PillarId;
  name: string;
  weight: number;
  remediation: string;
}

export interface CheckResult extends CheckDefinition {
  status: CheckStatus;
  awardedWeight: number;
  evidence: string[];
  confidence: number;
}

export interface PillarResult {
  id: PillarId;
  name: string;
  score: number;
  awardedWeight: number;
  applicableWeight: number;
  checks: CheckResult[];
}

export interface Recommendation {
  pillar: string;
  checkId: string;
  title: string;
  remediation: string;
  weight: number;
  evidence: string[];
}

export interface AcceleratorCheckDefinition {
  id: string;
  name: string;
  maxPoints: number;
  remediation: string;
}

export interface AcceleratorCheckResult extends AcceleratorCheckDefinition {
  status: CheckStatus;
  awardedPoints: number;
  evidence: string[];
  confidence: number;
}

export interface AcceleratorOpportunity {
  checkId: string;
  title: string;
  remediation: string;
  maxPoints: number;
  evidence: string[];
}

export interface AcceleratorSummary {
  bonusPoints: number;
  maxBonusPoints: number;
  checks: AcceleratorCheckResult[];
  opportunities: AcceleratorOpportunity[];
}

export interface ScanReport {
  scannedPath: string;
  baseScore: number;
  acceleratorBonus: number;
  overallScore: number;
  maturity: MaturityBand;
  classification: RepoClassification;
  ecosystems: Ecosystem[];
  warnings: string[];
  pillars: PillarResult[];
  accelerators: AcceleratorSummary;
  recommendations: Recommendation[];
}

export interface ScanConfig {
  ignoredPaths?: string[];
  weights?: Record<string, number>;
}

export interface ScanOptions {
  rootPath: string;
  config?: ScanConfig;
}

export interface CheckContext {
  discovery: RepoDiscovery;
  classification: RepoClassification;
}
