import path from "node:path";

import type { CheckContext, CheckDefinition, CheckResult, CheckStatus, PackageJsonData, RepoDiscovery } from "../core/types.js";

function dependencyNames(packageJson: PackageJsonData | null): string[] {
  if (!packageJson) {
    return [];
  }

  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ];
}

function hasDependency(packageJson: PackageJsonData | null, names: string[]): boolean {
  const deps = new Set(dependencyNames(packageJson).map((name) => name.toLowerCase()));
  return names.some((name) => deps.has(name.toLowerCase()));
}

function getScripts(discovery: RepoDiscovery): Record<string, string> {
  return discovery.packageJson?.scripts ?? {};
}

function hasScriptNamed(discovery: RepoDiscovery, names: string[]): boolean {
  const scripts = getScripts(discovery);
  return names.some((name) => typeof scripts[name] === "string");
}

function scriptMatches(discovery: RepoDiscovery, pattern: RegExp): boolean {
  return Object.values(getScripts(discovery)).some((script) => pattern.test(script));
}

function findFiles(discovery: RepoDiscovery, predicate: (filePath: string) => boolean): string[] {
  return discovery.filePaths.filter(predicate);
}

function hasFile(discovery: RepoDiscovery, predicate: (filePath: string) => boolean): boolean {
  return discovery.filePaths.some(predicate);
}

function hasText(discovery: RepoDiscovery, pattern: RegExp, fileFilter?: (filePath: string) => boolean): boolean {
  for (const [filePath, content] of discovery.textByPath.entries()) {
    if (fileFilter && !fileFilter(filePath)) {
      continue;
    }

    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}

function hasSourceText(discovery: RepoDiscovery, pattern: RegExp): boolean {
  const sourceSet = new Set(discovery.sourceFiles);
  return hasText(discovery, pattern, (filePath) => sourceSet.has(filePath));
}

function collectEvidence(discovery: RepoDiscovery, predicate: (filePath: string) => boolean, limit = 3): string[] {
  return discovery.filePaths.filter(predicate).slice(0, limit);
}

function uniqueEvidence(values: string[]): string[] {
  return [...new Set(values)];
}

function docsPaths(discovery: RepoDiscovery): string[] {
  return discovery.filePaths.filter(
    (filePath) =>
      /^README/i.test(path.basename(filePath)) ||
      /^CONTRIBUTING/i.test(path.basename(filePath)) ||
      /^AGENTS\.md$/i.test(path.basename(filePath)) ||
      filePath.startsWith("docs/"),
  );
}

function docsText(discovery: RepoDiscovery): string {
  return docsPaths(discovery)
    .map((filePath) => discovery.textByPath.get(filePath) ?? "")
    .join("\n");
}

function ciConfigText(discovery: RepoDiscovery): string {
  return discovery.ciConfigFiles.map((filePath) => discovery.textByPath.get(filePath) ?? "").join("\n");
}

function taskSurfaceFiles(discovery: RepoDiscovery): string[] {
  return uniqueEvidence([...discovery.taskFiles, ...discovery.buildConfigFiles]);
}

function taskFileText(discovery: RepoDiscovery): string {
  return taskSurfaceFiles(discovery)
    .map((filePath) => discovery.textByPath.get(filePath) ?? "")
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesInFiles(discovery: RepoDiscovery, files: string[], pattern: RegExp): boolean {
  if (files.length === 0) {
    return false;
  }

  const allowed = new Set(files);
  return hasText(discovery, pattern, (filePath) => allowed.has(filePath));
}

function firstMatchingFile(discovery: RepoDiscovery, files: string[], pattern: RegExp): string | undefined {
  return files.find((filePath) => pattern.test(discovery.textByPath.get(filePath) ?? ""));
}

function ciConfigMatches(discovery: RepoDiscovery, pattern: RegExp): boolean {
  return matchesInFiles(discovery, discovery.ciConfigFiles, pattern);
}

function taskFileMatches(discovery: RepoDiscovery, pattern: RegExp): boolean {
  return matchesInFiles(discovery, discovery.taskFiles, pattern);
}

function buildConfigMatches(discovery: RepoDiscovery, pattern: RegExp): boolean {
  return matchesInFiles(discovery, discovery.buildConfigFiles, pattern);
}

function taskTargetPattern(names: string[]): RegExp {
  return new RegExp(`^\\s*(?:${names.map(escapeRegExp).join("|")})\\s*:`, "mi");
}

function taskFileHasTarget(discovery: RepoDiscovery, names: string[]): boolean {
  return matchesInFiles(discovery, discovery.taskFiles, taskTargetPattern(names));
}

function collectSurfaceEvidence(
  discovery: RepoDiscovery,
  options: {
    baseEvidence?: string[];
    includeScripts?: boolean;
    taskPattern?: RegExp;
    taskTargets?: string[];
    buildPattern?: RegExp;
    ciPattern?: RegExp;
  },
): string[] {
  const evidence = [...(options.baseEvidence ?? [])];

  if (options.includeScripts) {
    evidence.push("package.json scripts");
  }

  const taskPattern = options.taskPattern;
  const taskTargetPatternValue = options.taskTargets ? taskTargetPattern(options.taskTargets) : undefined;
  const taskMatch =
    (taskPattern ? firstMatchingFile(discovery, discovery.taskFiles, taskPattern) : undefined) ??
    (taskTargetPatternValue ? firstMatchingFile(discovery, discovery.taskFiles, taskTargetPatternValue) : undefined);
  if (taskMatch) {
    evidence.push(taskMatch);
  }

  const buildMatch = options.buildPattern ? firstMatchingFile(discovery, discovery.buildConfigFiles, options.buildPattern) : undefined;
  if (buildMatch) {
    evidence.push(buildMatch);
  }

  const ciMatch = options.ciPattern ? firstMatchingFile(discovery, discovery.ciConfigFiles, options.ciPattern) : undefined;
  if (ciMatch) {
    evidence.push(ciMatch);
  }

  return uniqueEvidence(evidence).slice(0, 3);
}

const FORMATTER_PATTERN = /\b(prettier|biome|black|rustfmt|cargo fmt|gofmt|go fmt|clang-format|checkpatch\.pl)\b/i;
const LINTER_PATTERN = /\b(eslint|biome|ruff|flake8|pylint|golangci-lint|clippy|pyright|mypy|clang-tidy|cppcheck)\b/i;
const STATIC_ANALYSIS_PATTERN = /\b(tsc|pyright|mypy|go vet|golangci-lint|cargo check|cargo clippy|clang-tidy|cppcheck)\b/i;
const TEST_PATTERN = /\b(vitest|jest|mocha|ava|tap|pytest|unittest|go test|cargo test|ctest)\b/i;
const COVERAGE_PATTERN = /\b(--coverage|coverage|coverageThreshold|nyc|c8|codecov|pytest-cov|lcov)\b/i;
const SECURITY_PATTERN =
  /\b(npm audit|pnpm audit|yarn npm audit|cargo audit|pip-audit|bandit|safety|snyk|trivy|semgrep|gitleaks|gosec|codeql|github\/codeql-action|dependency-review-action|osv-scanner|trufflehog|grype|anchore|git-secrets)\b/i;
const BUILD_COMMAND_PATTERN =
  /\b(cmake --build|meson compile|cargo build|cargo install|go build|ninja|make(?:\s+(?:all|build|compile|package))?|build|compile|package)\b/i;
const CI_VALIDATION_PATTERN =
  /\b(test|pytest|vitest|jest|lint|eslint|ruff|mypy|pyright|build|check|validate|coverage|audit|ctest|go test|go vet|cargo test|cargo check|cargo clippy|clang-tidy|cppcheck|clang-format|checkpatch\.pl)\b/i;

function makeResult(
  definition: CheckDefinition,
  status: CheckStatus,
  evidence: string[],
  confidence: number,
): CheckResult {
  const multiplier = status === "pass" ? 1 : status === "partial" ? 0.5 : 0;
  return {
    ...definition,
    status,
    awardedWeight: status === "not_applicable" ? 0 : definition.weight * multiplier,
    evidence,
    confidence,
  };
}

function envUsageDetected(discovery: RepoDiscovery): boolean {
  return (
    discovery.envExampleFiles.length > 0 ||
    hasText(discovery, /\bprocess\.env\b|\bimport\.meta\.env\b|\bos\.getenv\b|\bgetenv\(|std::env::var|\bENV\[/)
  );
}

function formatterSignals(discovery: RepoDiscovery): { configured: boolean; wired: boolean; evidence: string[] } {
  const configFiles = collectEvidence(
    discovery,
    (filePath) =>
      /^\.prettierrc/i.test(path.basename(filePath)) ||
      /^prettier\.config\./i.test(path.basename(filePath)) ||
      /^biome\.json/i.test(path.basename(filePath)) ||
      /^\.clang-format$/i.test(path.basename(filePath)) ||
      /^rustfmt\.toml$/i.test(path.basename(filePath)) ||
      /^ruff\.toml$/i.test(path.basename(filePath)) ||
      /^\.ruff\.toml$/i.test(path.basename(filePath)),
  );

  const scriptConfigured = scriptMatches(discovery, FORMATTER_PATTERN);
  const taskConfigured = taskFileMatches(discovery, FORMATTER_PATTERN);
  const ciConfigured = ciConfigMatches(discovery, FORMATTER_PATTERN);
  const taskTargetConfigured = taskFileHasTarget(discovery, ["fmt", "format"]);
  const configured =
    configFiles.length > 0 ||
    hasDependency(discovery.packageJson, ["prettier", "@biomejs/biome"]) ||
    hasText(discovery, /\[tool\.black\]|\bblack\b/, (filePath) => filePath === "pyproject.toml") ||
    scriptConfigured ||
    taskConfigured ||
    ciConfigured ||
    taskTargetConfigured;

  const wired = scriptConfigured || taskConfigured || taskTargetConfigured || ciConfigured;

  const evidence = [...configFiles];
  if (hasDependency(discovery.packageJson, ["prettier", "@biomejs/biome"])) {
    evidence.push("package.json");
  }
  return {
    configured,
    wired,
    evidence: collectSurfaceEvidence(discovery, {
      baseEvidence: evidence,
      includeScripts: scriptConfigured,
      taskPattern: FORMATTER_PATTERN,
      taskTargets: ["fmt", "format"],
      buildPattern: FORMATTER_PATTERN,
      ciPattern: FORMATTER_PATTERN,
    }),
  };
}

function lintSignals(discovery: RepoDiscovery): { configured: boolean; wired: boolean; deepConfig: boolean; evidence: string[] } {
  const configFiles = collectEvidence(
    discovery,
    (filePath) =>
      /^\.eslintrc/i.test(path.basename(filePath)) ||
      /^eslint\.config\./i.test(path.basename(filePath)) ||
      /^biome\.json/i.test(path.basename(filePath)) ||
      /^\.clang-tidy$/i.test(path.basename(filePath)) ||
      /^\.golangci\./i.test(path.basename(filePath)) ||
      /^clippy\.toml$/i.test(path.basename(filePath)) ||
      /^ruff\.toml$/i.test(path.basename(filePath)) ||
      /^\.ruff\.toml$/i.test(path.basename(filePath)) ||
      /^mypy\.ini$/i.test(path.basename(filePath)) ||
      /^pyrightconfig\.json$/i.test(path.basename(filePath)),
  );

  const configured =
    configFiles.length > 0 ||
    hasDependency(discovery.packageJson, [
      "eslint",
      "@biomejs/biome",
      "ruff",
      "flake8",
      "pylint",
      "golangci-lint",
      "clippy",
      "pyright",
      "mypy",
    ]) ||
    hasText(discovery, /\[tool\.ruff\]|\[tool\.mypy\]|\[tool\.pyright\]/, (filePath) => filePath === "pyproject.toml");

  const scriptConfigured = scriptMatches(discovery, LINTER_PATTERN);
  const taskConfigured = taskFileMatches(discovery, LINTER_PATTERN);
  const ciConfigured = ciConfigMatches(discovery, LINTER_PATTERN);
  const lintTargetConfigured = taskFileHasTarget(discovery, ["lint"]);
  const wired = scriptConfigured || taskConfigured || ciConfigured || lintTargetConfigured;

  const deepConfig =
    configFiles.length > 0 ||
    hasText(discovery, /\brules\b|\boverrides\b|\bextends\b|\bselect\b|\bignore\b|\bstrict\b/, (filePath) =>
      /eslint|biome|ruff|mypy|pyright|golangci|clippy|clang-tidy|pyproject/i.test(filePath),
    );

  return {
    configured,
    wired,
    deepConfig,
    evidence: collectSurfaceEvidence(discovery, {
      baseEvidence: configFiles,
      includeScripts: scriptConfigured,
      taskPattern: LINTER_PATTERN,
      taskTargets: ["lint"],
      buildPattern: LINTER_PATTERN,
      ciPattern: LINTER_PATTERN,
    }),
  };
}

function languageToolingSignals(discovery: RepoDiscovery): { configured: boolean; evidence: string[] } {
  const editorConfigPatterns: Array<{ filePath: string; pattern: RegExp }> = [
    {
      filePath: ".vscode/settings.json",
      pattern:
        /\b(typescript\.tsdk|python\.analysis|rust-analyzer|gopls|clangd|ccls|jdtls|volar|svelteserver|yaml-language-server|lua-language-server|bash-language-server|marksman|taplo)\b/i,
    },
    {
      filePath: ".vscode/extensions.json",
      pattern:
        /\b(ms-vscode\.vscode-typescript-next|ms-python\.vscode-pylance|rust-lang\.rust-analyzer|golang\.go|llvm-vs-code-extensions\.vscode-clangd|redhat\.java|vue\.volar|svelte\.svelte-vscode|redhat\.vscode-yaml|tamasfe\.even-better-toml)\b/i,
    },
    {
      filePath: ".helix/languages.toml",
      pattern: /\b(language-server|typescript-language-server|pyright|rust-analyzer|gopls|clangd|ccls|jdtls|volar|svelteserver|yaml-language-server|marksman|taplo)\b/i,
    },
    {
      filePath: ".zed/settings.json",
      pattern: /\b(language_servers|typescript-language-server|pyright|rust-analyzer|gopls|clangd|ccls|jdtls|volar|svelteserver|yaml-language-server|marksman|taplo)\b/i,
    },
  ];

  const matchedEditorConfigs = editorConfigPatterns
    .filter(({ filePath, pattern }) => hasText(discovery, pattern, (candidatePath) => candidatePath === filePath))
    .map(({ filePath }) => filePath);

  const configFiles = [
    ...collectEvidence(discovery, (filePath) => filePath === "rust-project.json"),
    ...matchedEditorConfigs,
  ];

  const configured =
    configFiles.length > 0 ||
    hasDependency(discovery.packageJson, [
      "typescript-language-server",
      "rust-analyzer",
      "pyright",
      "yaml-language-server",
      "bash-language-server",
      "vscode-langservers-extracted",
      "@vue/language-server",
      "svelte-language-server",
      "graphql-language-service-cli",
      "lua-language-server",
      "marksman",
      "taplo",
      "@tailwindcss/language-server",
    ]);

  const evidence = uniqueEvidence([
    ...configFiles,
    ...(hasDependency(discovery.packageJson, [
      "typescript-language-server",
      "rust-analyzer",
      "pyright",
      "yaml-language-server",
      "bash-language-server",
      "vscode-langservers-extracted",
      "@vue/language-server",
      "svelte-language-server",
      "graphql-language-service-cli",
      "lua-language-server",
      "marksman",
      "taplo",
      "@tailwindcss/language-server",
    ])
      ? ["package.json"]
      : []),
  ]);

  return {
    configured,
    evidence: evidence.slice(0, 3),
  };
}

function staticCheckSignals(discovery: RepoDiscovery): { configured: boolean; wired: boolean; strict: "pass" | "partial" | "na"; evidence: string[] } {
  const tsconfig = discovery.textByPath.get("tsconfig.json") ?? "";
  const pyproject = discovery.textByPath.get("pyproject.toml") ?? "";
  const languageTooling = languageToolingSignals(discovery);
  const typedOrNativeEcosystem = discovery.ecosystems.some((ecosystem) => ["go", "rust", "c", "cpp"].includes(ecosystem));
  const configFiles = uniqueEvidence([
    ...collectEvidence(
      discovery,
      (filePath) =>
        /^tsconfig\.json$/i.test(path.basename(filePath)) ||
        /^pyrightconfig\.json$/i.test(path.basename(filePath)) ||
        /^mypy\.ini$/i.test(path.basename(filePath)) ||
        /^go\.mod$/i.test(path.basename(filePath)) ||
        /^Cargo\.toml$/i.test(path.basename(filePath)) ||
        /^CMakeLists\.txt$/i.test(path.basename(filePath)) ||
        /^CMakePresets\.json$/i.test(path.basename(filePath)) ||
        /^meson\.build$/i.test(path.basename(filePath)) ||
        /^compile_commands\.json$/i.test(path.basename(filePath)),
    ),
    ...(hasText(discovery, /\[tool\.pyright\]|\[tool\.mypy\]/, (filePath) => filePath === "pyproject.toml")
      ? ["pyproject.toml"]
      : []),
    ...(hasDependency(discovery.packageJson, ["typescript", "pyright", "mypy"]) ? ["package.json"] : []),
  ]);

  const explicitValidationSurface =
    scriptMatches(discovery, STATIC_ANALYSIS_PATTERN) ||
    taskFileMatches(discovery, STATIC_ANALYSIS_PATTERN) ||
    ciConfigMatches(discovery, STATIC_ANALYSIS_PATTERN) ||
    taskFileHasTarget(discovery, ["check", "validate", "verify", "lint", "typecheck"]);

  const configured =
    Boolean(tsconfig) ||
    hasDependency(discovery.packageJson, ["typescript", "pyright", "mypy"]) ||
    hasText(discovery, /\[tool\.pyright\]|\[tool\.mypy\]/, (filePath) => filePath === "pyproject.toml") ||
    hasFile(discovery, (filePath) => /^go\.mod$/i.test(path.basename(filePath)) || /^Cargo\.toml$/i.test(path.basename(filePath))) ||
    (typedOrNativeEcosystem && (discovery.taskFiles.length > 0 || discovery.buildConfigFiles.length > 0)) ||
    languageTooling.configured;

  const wired = explicitValidationSurface;

  let strict: "pass" | "partial" | "na" = "na";
  if (tsconfig) {
    strict = /"strict"\s*:\s*true/.test(tsconfig) ? "pass" : "partial";
  } else if (pyproject || hasFile(discovery, (filePath) => filePath === "pyrightconfig.json" || filePath === "mypy.ini")) {
    strict = /\bstrict\s*=\s*true\b|typeCheckingMode\s*=\s*"strict"/.test(pyproject + (discovery.textByPath.get("pyrightconfig.json") ?? "") + (discovery.textByPath.get("mypy.ini") ?? ""))
      ? "pass"
      : "partial";
  }

  return {
    configured,
    wired,
    strict,
    evidence: collectSurfaceEvidence(discovery, {
      baseEvidence: uniqueEvidence([...configFiles, ...languageTooling.evidence]),
      includeScripts: scriptMatches(discovery, STATIC_ANALYSIS_PATTERN),
      taskPattern: STATIC_ANALYSIS_PATTERN,
      taskTargets: ["check", "validate", "verify", "lint", "typecheck"],
      buildPattern: STATIC_ANALYSIS_PATTERN,
      ciPattern: STATIC_ANALYSIS_PATTERN,
    }),
  };
}

function testSignals(discovery: RepoDiscovery): { configured: boolean; evidence: string[] } {
  const repoRootTestTarget = taskFileHasTarget(discovery, ["test", "check"]);
  const scriptConfigured = scriptMatches(discovery, TEST_PATTERN);
  const taskConfigured = taskFileMatches(discovery, TEST_PATTERN);
  const buildConfigured = buildConfigMatches(discovery, TEST_PATTERN);
  const ciConfigured = ciConfigMatches(discovery, TEST_PATTERN);
  const configured =
    hasDependency(discovery.packageJson, ["vitest", "jest", "mocha", "ava", "tap"]) ||
    scriptConfigured ||
    taskConfigured ||
    buildConfigured ||
    ciConfigured ||
    repoRootTestTarget ||
    hasText(discovery, /\[tool\.pytest\.ini_options\]|\[pytest\]/, (filePath) => filePath === "pyproject.toml") ||
    hasText(discovery, /\bdescribe\(|\bit\(|\btest\(/, (filePath) => filePath.endsWith(".test.ts") || filePath.endsWith(".spec.ts"));

  const evidence: string[] = [];
  if (hasDependency(discovery.packageJson, ["vitest", "jest", "mocha", "ava", "tap"])) {
    evidence.push("package.json");
  }
  if (discovery.testFiles.length > 0) {
    evidence.push(discovery.testFiles[0] ?? "tests");
  }

  return {
    configured,
    evidence: collectSurfaceEvidence(discovery, {
      baseEvidence: evidence,
      includeScripts: scriptConfigured,
      taskPattern: TEST_PATTERN,
      taskTargets: ["test", "check"],
      buildPattern: TEST_PATTERN,
      ciPattern: TEST_PATTERN,
    }),
  };
}

function coverageSignals(discovery: RepoDiscovery): { pass: boolean; partial: boolean; evidence: string[] } {
  const pass =
    scriptMatches(discovery, COVERAGE_PATTERN) ||
    ciConfigMatches(discovery, COVERAGE_PATTERN) ||
    taskFileMatches(discovery, COVERAGE_PATTERN) ||
    hasFile(discovery, (filePath) => /^codecov\.(yml|yaml)$/i.test(path.basename(filePath))) ||
    hasDependency(discovery.packageJson, ["nyc", "c8"]);

  const partial = pass || hasText(discovery, /\bcoverage\b/i, (filePath) => /^README/i.test(path.basename(filePath)));
  const evidence = collectEvidence(discovery, (filePath) => /^codecov\.(yml|yaml)$/i.test(path.basename(filePath)));
  return {
    pass,
    partial,
    evidence: collectSurfaceEvidence(discovery, {
      baseEvidence: evidence,
      includeScripts: scriptMatches(discovery, COVERAGE_PATTERN),
      taskPattern: COVERAGE_PATTERN,
      buildPattern: COVERAGE_PATTERN,
      ciPattern: COVERAGE_PATTERN,
    }),
  };
}

function securitySignals(discovery: RepoDiscovery): { configured: boolean; inCi: boolean; evidence: string[] } {
  const configured =
    ciConfigMatches(discovery, SECURITY_PATTERN) ||
    scriptMatches(discovery, SECURITY_PATTERN) ||
    taskFileMatches(discovery, SECURITY_PATTERN) ||
    hasFile(
      discovery,
      (filePath) =>
        /^\.snyk$/i.test(path.basename(filePath)) ||
        /^\.gitleaks\.toml$/i.test(path.basename(filePath)) ||
        /^dependabot\.(yml|yaml)$/i.test(path.basename(filePath)) ||
        /^\.semgrep/i.test(path.basename(filePath)),
    ) ||
    hasText(discovery, SECURITY_PATTERN);

  const inCi = ciConfigMatches(discovery, SECURITY_PATTERN);
  return {
    configured,
    inCi,
    evidence: collectSurfaceEvidence(discovery, {
      baseEvidence: collectEvidence(
        discovery,
        (filePath) =>
          /^\.snyk$/i.test(path.basename(filePath)) ||
          /^\.gitleaks\.toml$/i.test(path.basename(filePath)) ||
          /^dependabot\.(yml|yaml)$/i.test(path.basename(filePath)),
      ),
      includeScripts: scriptMatches(discovery, SECURITY_PATTERN),
      taskPattern: SECURITY_PATTERN,
      ciPattern: SECURITY_PATTERN,
    }),
  };
}

function evaluateCheck(definition: CheckDefinition, context: CheckContext): CheckResult {
  const { discovery, classification } = context;
  const scripts = getScripts(discovery);
  const docText = docsText(discovery);
  const hasReadme = hasFile(discovery, (filePath) => /^README/i.test(path.basename(filePath)));
  const hasDocsFolder = hasFile(discovery, (filePath) => filePath.startsWith("docs/"));
  const hasContributing = hasFile(discovery, (filePath) => /^CONTRIBUTING/i.test(path.basename(filePath)));
  const hasAgentsGuide = hasFile(discovery, (filePath) => /^AGENTS\.md$/i.test(path.basename(filePath)));
  const hasCodeowners = hasFile(discovery, (filePath) => /(^|\/)CODEOWNERS$/i.test(filePath));
  const envDetected = envUsageDetected(discovery);
  const formatter = formatterSignals(discovery);
  const lint = lintSignals(discovery);
  const staticChecks = staticCheckSignals(discovery);
  const tests = testSignals(discovery);
  const coverage = coverageSignals(discovery);
  const security = securitySignals(discovery);

  switch (definition.id) {
    case "formatterConfigured":
      if (formatter.configured && formatter.wired) {
        return makeResult(definition, "pass", formatter.evidence, 0.95);
      }
      if (formatter.configured || formatter.wired) {
        return makeResult(definition, "partial", formatter.evidence.length > 0 ? formatter.evidence : ["formatter signal found"], 0.7);
      }
      return makeResult(definition, "fail", ["no formatter tooling found"], 0.9);

    case "linterConfigured":
      if (lint.configured && lint.wired) {
        return makeResult(definition, "pass", lint.evidence, 0.95);
      }
      if (lint.configured || lint.wired) {
        return makeResult(definition, "partial", lint.evidence.length > 0 ? lint.evidence : ["linter signal found"], 0.7);
      }
      return makeResult(definition, "fail", ["no linter configuration found"], 0.9);

    case "typeOrStaticCheckConfigured":
      if (staticChecks.configured && staticChecks.wired) {
        return makeResult(definition, "pass", staticChecks.evidence, 0.9);
      }
      if (staticChecks.configured || staticChecks.wired) {
        return makeResult(
          definition,
          "partial",
          staticChecks.evidence.length > 0 ? staticChecks.evidence : ["static analysis signal found"],
          0.65,
        );
      }
      return makeResult(definition, "fail", ["no type or static analysis signal found"], 0.85);

    case "strictModeEnabled":
      if (staticChecks.strict === "pass") {
        return makeResult(definition, "pass", staticChecks.evidence, 0.95);
      }
      if (staticChecks.strict === "partial") {
        return makeResult(definition, "partial", staticChecks.evidence, 0.7);
      }
      return makeResult(definition, "not_applicable", ["no comparable strict mode detected"], 0.6);

    case "fastFeedbackHooks":
      if (
        hasFile(discovery, (filePath) => filePath.startsWith(".husky/")) ||
        hasFile(discovery, (filePath) => filePath === ".pre-commit-config.yaml") ||
        hasText(discovery, /\bsimple-git-hooks\b|\blefthook\b/, (filePath) => filePath === "package.json")
      ) {
        return makeResult(
          definition,
          "pass",
          collectEvidence(discovery, (filePath) => filePath.startsWith(".husky/") || filePath === ".pre-commit-config.yaml"),
          0.9,
        );
      }
      if (/pre-commit|husky|lefthook/i.test(docText)) {
        return makeResult(definition, "partial", ["hook tooling mentioned in docs"], 0.55);
      }
      return makeResult(definition, "fail", ["no local validation hooks found"], 0.85);

    case "installPathDeclared":
      if (/\b(install|setup|bootstrap|get started|get started|getting started|prerequisite|requirements)\b/i.test(docText)) {
        return makeResult(definition, "pass", hasReadme ? ["README"] : docsPaths(discovery).slice(0, 2), 0.8);
      }
      if (discovery.manifests.length > 0) {
        return makeResult(definition, "partial", discovery.manifests.slice(0, 3), 0.55);
      }
      return makeResult(definition, "fail", ["no setup path documented or inferred"], 0.8);

    case "buildOrPackageCommand": {
      const repoRootBuildTarget = taskFileHasTarget(discovery, ["build", "package", "compile", "all"]);
      const repoRootBuildCommand = hasScriptNamed(discovery, ["build", "package", "compile"]) || repoRootBuildTarget || taskFileMatches(discovery, BUILD_COMMAND_PATTERN);
      const ciBuildCommand = ciConfigMatches(discovery, BUILD_COMMAND_PATTERN);
      const buildMetadataPresent = discovery.buildConfigFiles.length > 0;
      const buildRelevant =
        classification.kind === "application" ||
        classification.kind === "monorepo" ||
        discovery.sourceFiles.some((filePath) => /\.(ts|tsx|rs|go|c|cc|cpp|cxx)$/.test(filePath)) ||
        discovery.ecosystems.some((ecosystem) => ecosystem === "c" || ecosystem === "cpp") ||
        discovery.taskFiles.length > 0 ||
        buildMetadataPresent ||
        Boolean(scripts.build) ||
        Boolean(scripts.package) ||
        Boolean(scripts.compile);

      if (!buildRelevant) {
        return makeResult(definition, "not_applicable", ["no build or packaging step appears necessary"], 0.7);
      }

      if (repoRootBuildCommand) {
        return makeResult(
          definition,
          "pass",
          collectSurfaceEvidence(discovery, {
            includeScripts: hasScriptNamed(discovery, ["build", "package", "compile"]) || scriptMatches(discovery, BUILD_COMMAND_PATTERN),
            taskPattern: BUILD_COMMAND_PATTERN,
            taskTargets: ["build", "package", "compile", "all"],
          }),
          0.85,
        );
      }

      if (ciBuildCommand || buildMetadataPresent) {
        return makeResult(
          definition,
          "partial",
          collectSurfaceEvidence(discovery, {
            buildPattern: /.+/s,
            ciPattern: BUILD_COMMAND_PATTERN,
          }),
          0.6,
        );
      }

      return makeResult(definition, "fail", ["no build or packaging command found"], 0.8);
    }

    case "testCommandDiscoverable": {
      const repoRootTestCommand = hasScriptNamed(discovery, ["test", "test:unit", "check"]) || taskFileHasTarget(discovery, ["test", "check"]) || taskFileMatches(discovery, TEST_PATTERN);
      if (repoRootTestCommand) {
        return makeResult(
          definition,
          "pass",
          collectSurfaceEvidence(discovery, {
            includeScripts: hasScriptNamed(discovery, ["test", "test:unit", "check"]) || scriptMatches(discovery, TEST_PATTERN),
            taskPattern: TEST_PATTERN,
            taskTargets: ["test", "check"],
          }),
          0.95,
        );
      }

      if (tests.configured || discovery.testFiles.length > 0) {
        return makeResult(definition, "partial", tests.evidence, 0.6);
      }
      return makeResult(definition, "fail", ["no repo-root test command found"], 0.85);
    }

    case "validateCommandDiscoverable": {
      const validationPattern = /\b(eslint|biome|ruff|mypy|pyright|prettier|tsc|go vet|golangci-lint|cargo check|cargo clippy|clang-tidy|cppcheck|clang-format|checkpatch\.pl)\b/i;
      const repoRootValidationTarget = taskFileHasTarget(discovery, ["lint", "check", "validate", "verify", "typecheck", "fmt", "format"]);
      const repoRootValidationCommand =
        hasScriptNamed(discovery, ["lint", "check", "validate", "typecheck"]) ||
        repoRootValidationTarget ||
        taskFileMatches(discovery, validationPattern);

      if (repoRootValidationCommand) {
        return makeResult(
          definition,
          "pass",
          collectSurfaceEvidence(discovery, {
            includeScripts: hasScriptNamed(discovery, ["lint", "check", "validate", "typecheck"]) || scriptMatches(discovery, validationPattern),
            taskPattern: validationPattern,
            taskTargets: ["lint", "check", "validate", "verify", "typecheck", "fmt", "format"],
          }),
          0.95,
        );
      }

      if (scriptMatches(discovery, validationPattern) || ciConfigMatches(discovery, validationPattern) || buildConfigMatches(discovery, validationPattern)) {
        return makeResult(
          definition,
          "partial",
          collectSurfaceEvidence(discovery, {
            includeScripts: scriptMatches(discovery, validationPattern),
            buildPattern: validationPattern,
            ciPattern: validationPattern,
          }),
          0.7,
        );
      }
      return makeResult(definition, "fail", ["no clear validation command found"], 0.9);
    }

    case "ciWorkflowPresent": {
      if (discovery.ciConfigFiles.length === 0) {
        return makeResult(definition, "fail", ["no CI config files found"], 0.9);
      }

      const ciRunsValidation = CI_VALIDATION_PATTERN.test(ciConfigText(discovery));
      if (ciRunsValidation) {
        return makeResult(definition, "pass", discovery.ciConfigFiles.slice(0, 2), 0.95);
      }
      return makeResult(definition, "partial", discovery.ciConfigFiles.slice(0, 2), 0.65);
    }

    case "testFrameworkConfigured":
      if (tests.configured) {
        return makeResult(definition, "pass", tests.evidence, 0.85);
      }
      if (discovery.testFiles.length > 0) {
        return makeResult(definition, "partial", [discovery.testFiles[0] ?? "tests"], 0.6);
      }
      return makeResult(definition, "fail", ["no test framework signal found"], 0.85);

    case "testFilesPresent": {
      if (discovery.sourceFiles.length === 0) {
        return makeResult(definition, "not_applicable", ["no source files detected"], 0.7);
      }
      const ratio = discovery.testFiles.length / Math.max(discovery.sourceFiles.length, 1);
      if (discovery.testFiles.length >= 3 || ratio >= 0.25) {
        return makeResult(definition, "pass", discovery.testFiles.slice(0, 3), 0.85);
      }
      if (discovery.testFiles.length > 0 || ratio >= 0.05) {
        return makeResult(definition, "partial", discovery.testFiles.slice(0, 3), 0.7);
      }
      return makeResult(definition, "fail", ["no test files found"], 0.9);
    }

    case "testsRunnableFromRepo": {
      const repoRootTestCommand = hasScriptNamed(discovery, ["test"]) || taskFileHasTarget(discovery, ["test", "check"]) || taskFileMatches(discovery, TEST_PATTERN);
      if (repoRootTestCommand) {
        return makeResult(
          definition,
          "pass",
          collectSurfaceEvidence(discovery, {
            includeScripts: hasScriptNamed(discovery, ["test"]) || scriptMatches(discovery, TEST_PATTERN),
            taskPattern: TEST_PATTERN,
            taskTargets: ["test", "check"],
          }),
          0.95,
        );
      }
      if (!classification.isMonorepo && tests.configured) {
        return makeResult(definition, "partial", tests.evidence, 0.6);
      }
      if (classification.isMonorepo && discovery.testFiles.length > 0) {
        return makeResult(definition, "partial", ["tests exist but repo-root command is unclear"], 0.6);
      }
      return makeResult(definition, "fail", ["no repo-root test execution path found"], 0.9);
    }

    case "coverageSignalPresent":
      if (coverage.pass) {
        return makeResult(definition, "pass", coverage.evidence, 0.85);
      }
      if (coverage.partial) {
        return makeResult(definition, "partial", coverage.evidence.length > 0 ? coverage.evidence : ["coverage mentioned"], 0.55);
      }
      return makeResult(definition, "fail", ["no coverage signal found"], 0.85);

    case "integrationCoverageWhenRelevant": {
      if (classification.kind === "library") {
        return makeResult(definition, "not_applicable", ["integration coverage is optional for libraries"], 0.9);
      }

      if (classification.kind === "cli" && !classification.isMonorepo) {
        return makeResult(definition, "not_applicable", ["simple CLI repositories are exempt"], 0.75);
      }

      const integrationFiles = discovery.testFiles.filter((filePath) =>
        /(integration|e2e|smoke|acceptance)/i.test(filePath),
      );
      if (integrationFiles.length > 0) {
        return makeResult(definition, "pass", integrationFiles.slice(0, 3), 0.85);
      }
      if (discovery.testFiles.length > 0) {
        return makeResult(definition, "partial", discovery.testFiles.slice(0, 2), 0.65);
      }
      return makeResult(definition, "fail", ["no integration-style tests found"], 0.8);
    }

    case "readmePresent":
      if (hasReadme) {
        return makeResult(definition, "pass", ["README"], 1);
      }
      if (hasDocsFolder) {
        return makeResult(definition, "partial", ["docs/"], 0.65);
      }
      return makeResult(definition, "fail", ["no README found"], 1);

    case "setupInstructions":
      if (/\b(install|setup|getting started|prerequisite|requirements)\b/i.test(docText)) {
        return makeResult(definition, "pass", hasReadme ? ["README"] : docsPaths(discovery).slice(0, 2), 0.8);
      }
      if (hasReadme || discovery.manifests.length > 0) {
        return makeResult(definition, "partial", hasReadme ? ["README"] : discovery.manifests.slice(0, 2), 0.55);
      }
      return makeResult(definition, "fail", ["no setup instructions detected"], 0.85);

    case "runAndValidateInstructions": {
      const hasRunDocs = /\b(run|start|serve|dev)\b/i.test(docText);
      const hasValidateDocs = /\b(test|lint|validate|check|typecheck)\b/i.test(docText);
      if (hasRunDocs && hasValidateDocs) {
        return makeResult(definition, "pass", hasReadme ? ["README"] : docsPaths(discovery).slice(0, 2), 0.8);
      }
      if (hasRunDocs || hasValidateDocs || Object.keys(scripts).length > 0 || discovery.taskFiles.length > 0) {
        return makeResult(definition, "partial", hasReadme ? ["README"] : ["commands can be inferred from tooling"], 0.6);
      }
      return makeResult(definition, "fail", ["no run or validation guidance detected"], 0.85);
    }

    case "envVariablesDocumented":
      if (!envDetected) {
        return makeResult(definition, "not_applicable", ["no environment variable usage detected"], 0.75);
      }
      if (discovery.envExampleFiles.length > 0 && /\b(env|environment variable|api[_ -]?key|secret)\b/i.test(docText)) {
        return makeResult(definition, "pass", [...discovery.envExampleFiles.slice(0, 1), "README"], 0.8);
      }
      if (discovery.envExampleFiles.length > 0 || /\b(env|environment variable)\b/i.test(docText)) {
        return makeResult(
          definition,
          "partial",
          discovery.envExampleFiles.length > 0 ? discovery.envExampleFiles.slice(0, 1) : ["README"],
          0.6,
        );
      }
      return makeResult(definition, "fail", ["environment usage detected but not documented"], 0.85);

    case "contributionOrAgentGuidance":
      if (hasContributing || hasAgentsGuide) {
        return makeResult(definition, "pass", hasAgentsGuide ? ["AGENTS.md"] : ["CONTRIBUTING.md"], 0.95);
      }
      if (/\bcontribut/i.test(docText)) {
        return makeResult(definition, "partial", ["README"], 0.6);
      }
      return makeResult(definition, "fail", ["no contribution or agent guidance found"], 0.9);

    case "sampleEnvProvided":
      if (!envDetected) {
        return makeResult(definition, "not_applicable", ["no environment variable usage detected"], 0.75);
      }
      if (discovery.envExampleFiles.length > 0) {
        return makeResult(definition, "pass", discovery.envExampleFiles.slice(0, 2), 0.95);
      }
      if (/\b(env|environment variable)\b/i.test(docText)) {
        return makeResult(definition, "partial", ["README"], 0.6);
      }
      return makeResult(definition, "fail", ["no sample environment file found"], 0.9);

    case "toolchainDeclared": {
      const hasPinnedToolchain =
        hasFile(discovery, (filePath) =>
          [
            ".nvmrc",
            ".node-version",
            ".python-version",
            ".tool-versions",
            "mise.toml",
            "rust-toolchain.toml",
            ".go-version",
          ].includes(filePath),
        ) ||
        Boolean(discovery.packageJson?.engines) ||
        hasText(discovery, /\brequires-python\s*=\s*["'][^"']+["']/, (filePath) => filePath === "pyproject.toml") ||
        hasText(discovery, /^go\s+\d+\.\d+/m, (filePath) => filePath === "go.mod");

      if (hasPinnedToolchain) {
        return makeResult(
          definition,
          "pass",
          collectEvidence(discovery, (filePath) =>
            [".nvmrc", ".node-version", ".python-version", ".tool-versions", "mise.toml", "rust-toolchain.toml", ".go-version"].includes(filePath),
          ),
          0.85,
        );
      }
      if (discovery.manifests.length > 0) {
        return makeResult(definition, "partial", discovery.manifests.slice(0, 2), 0.55);
      }
      return makeResult(definition, "fail", ["no runtime or language version declaration found"], 0.85);
    }

    case "oneCommandStartupPath":
      if (classification.kind === "library") {
        return makeResult(definition, "not_applicable", ["libraries do not need a startup path"], 0.9);
      }
      if (hasScriptNamed(discovery, ["dev", "start", "serve", "preview"])) {
        return makeResult(definition, "pass", ["package.json scripts"], 0.95);
      }
      if (/\b(run|start|serve|dev)\b/i.test(docText)) {
        return makeResult(definition, "partial", ["README"], 0.65);
      }
      return makeResult(definition, "fail", ["no clear startup command found"], 0.85);

    case "clearProjectLayout": {
      const hasSrc = hasFile(discovery, (filePath) => filePath.startsWith("src/"));
      const hasTestsDir = hasFile(discovery, (filePath) => filePath.startsWith("tests/") || filePath.includes("/tests/"));
      const hasPackages = hasFile(discovery, (filePath) => filePath.startsWith("packages/") || filePath.startsWith("apps/"));
      if ((hasSrc && hasTestsDir) || hasPackages) {
        return makeResult(definition, "pass", hasPackages ? ["apps/", "packages/"] : ["src/", "tests/"], 0.85);
      }
      if (discovery.sourceFiles.length > 0) {
        return makeResult(definition, "partial", [discovery.sourceFiles[0] ?? "source files present"], 0.55);
      }
      return makeResult(definition, "fail", ["no clear source layout detected"], 0.8);
    }

    case "generatedAndVendorSeparated": {
      const generatedOrVendor = findFiles(discovery, (filePath) =>
        /(generated|vendor|dist|build|coverage|target)/i.test(filePath),
      );
      if (generatedOrVendor.length === 0) {
        return makeResult(definition, "not_applicable", ["no generated or vendored code detected"], 0.75);
      }
      const mixedIntoSrc = generatedOrVendor.some((filePath) => filePath.startsWith("src/"));
      if (!mixedIntoSrc) {
        return makeResult(definition, "pass", generatedOrVendor.slice(0, 3), 0.8);
      }
      return makeResult(definition, "partial", generatedOrVendor.slice(0, 3), 0.6);
    }

    case "dependencyLockingPresent": {
      if (discovery.lockfiles.length > 0) {
        return makeResult(definition, "pass", discovery.lockfiles.slice(0, 3), 0.9);
      }
      if (discovery.manifests.length > 0) {
        return makeResult(definition, "fail", discovery.manifests.slice(0, 3), 0.85);
      }
      return makeResult(definition, "not_applicable", ["no dependency manifest detected"], 0.7);
    }

    case "staticAnalysisDepth":
      if (lint.deepConfig) {
        return makeResult(definition, "pass", lint.evidence, 0.8);
      }
      if (lint.configured || staticChecks.configured) {
        return makeResult(definition, "partial", [...lint.evidence, ...staticChecks.evidence].slice(0, 3), 0.55);
      }
      return makeResult(definition, "fail", ["no non-trivial static analysis configuration found"], 0.85);

    case "loggingSignal":
      if (classification.kind === "library" || classification.kind === "cli") {
        return makeResult(definition, "not_applicable", ["libraries and simple CLIs are exempt from runtime logging checks"], 0.9);
      }
      if (
        hasDependency(discovery.packageJson, ["pino", "winston", "bunyan", "structlog", "logrus", "zap", "tracing"]) ||
        hasFile(discovery, (filePath) => /(^|\/)logger\.(ts|tsx|js|jsx|py|go|rs)$/.test(filePath))
      ) {
        return makeResult(definition, "pass", ["structured logging signal found"], 0.75);
      }
      if (hasSourceText(discovery, /\bconsole\.log\b|\bprint\(/)) {
        return makeResult(definition, "partial", ["ad hoc logging found"], 0.55);
      }
      return makeResult(definition, "fail", ["no logging signal found"], 0.75);

    case "healthOrDebugSignal":
      if (classification.kind === "library" || classification.kind === "cli") {
        return makeResult(definition, "not_applicable", ["libraries and simple CLIs are exempt from health and debug checks"], 0.9);
      }
      {
        const hasServerEntrypointFile = hasFile(discovery, (filePath) =>
          /(^|\/)(server|app|main)\.(ts|tsx|js|jsx|py|go|rs)$/.test(filePath),
        );
        if (hasServerEntrypointFile && hasSourceText(discovery, /["'`]\/health["'`]|["'`]\/ready["'`]|healthcheck|pprof/)) {
          return makeResult(definition, "pass", ["health or debug signal found"], 0.7);
        }
      }
      if (/\bdebug\b|\btroubleshoot\b/i.test(docText)) {
        return makeResult(definition, "partial", ["debugging guidance found in docs"], 0.5);
      }
      return makeResult(definition, "fail", ["no health or debug signal found"], 0.75);

    case "metricsTracingOrErrorReporting":
      if (classification.kind === "library" || classification.kind === "cli") {
        return makeResult(definition, "not_applicable", ["metrics and tracing are optional for libraries and simple CLIs"], 0.85);
      }
      if (hasDependency(discovery.packageJson, ["@sentry/node", "@opentelemetry/api", "prom-client", "dd-trace", "rollbar"])) {
        return makeResult(definition, "pass", ["metrics or error reporting signal found"], 0.75);
      }
      return makeResult(definition, "fail", ["no metrics, tracing, or error reporting signal found"], 0.75);

    case "ownershipSignal":
      if (hasCodeowners) {
        return makeResult(definition, "pass", ["CODEOWNERS"], 0.95);
      }
      if (/\bmaintainer\b|\bowners?\b/i.test(docText) || Boolean(discovery.packageJson?.author)) {
        return makeResult(definition, "partial", hasReadme ? ["README"] : ["package.json"], 0.55);
      }
      return makeResult(definition, "fail", ["no ownership signal found"], 0.85);

    case "licensePresent":
      if (hasFile(discovery, (filePath) => /^LICENSE/i.test(path.basename(filePath))) || Boolean(discovery.packageJson?.license)) {
        return makeResult(definition, "pass", hasFile(discovery, (filePath) => /^LICENSE/i.test(path.basename(filePath))) ? ["LICENSE"] : ["package.json"], 0.95);
      }
      return makeResult(definition, "fail", ["no license file or package license metadata found"], 0.95);

    case "securityScanConfigured":
      if (security.configured && security.inCi) {
        return makeResult(definition, "pass", security.evidence, 0.85);
      }
      if (security.configured) {
        return makeResult(definition, "partial", security.evidence.length > 0 ? security.evidence : ["security tooling signal found"], 0.6);
      }
      return makeResult(definition, "fail", ["no security scanning signal found"], 0.85);

    case "secretHygiene":
      if (
        discovery.envExampleFiles.length > 0 &&
        (hasText(discovery, /\b(gitleaks|trufflehog|git-secrets)\b/) || security.configured)
      ) {
        return makeResult(definition, "pass", [...discovery.envExampleFiles.slice(0, 1), ...security.evidence].slice(0, 3), 0.75);
      }
      if (discovery.envExampleFiles.length > 0) {
        return makeResult(definition, "partial", discovery.envExampleFiles.slice(0, 2), 0.55);
      }
      return makeResult(definition, "fail", ["no secret hygiene signal found"], 0.8);

    case "ciSecurityStep":
      if (security.inCi) {
        return makeResult(definition, "pass", security.evidence, 0.9);
      }
      if (security.configured) {
        return makeResult(definition, "partial", security.evidence.length > 0 ? security.evidence : ["security tooling signal found"], 0.6);
      }
      return makeResult(definition, "fail", ["no security step found in CI"], 0.85);

    default:
      return makeResult(definition, "fail", ["unimplemented rule"], 0.1);
  }
}

export function runDeterministicChecks(definitions: CheckDefinition[], context: CheckContext): CheckResult[] {
  return definitions.map((definition) => evaluateCheck(definition, context));
}
