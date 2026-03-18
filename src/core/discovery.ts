import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Ecosystem, PackageJsonData, RepoDiscovery } from "./types.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".go",
  ".rs",
]);

const DOC_NAMES = ["readme", "contributing", "agents", "license"];
const MANIFEST_NAMES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "go.mod",
  "cargo.toml",
];
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "poetry.lock",
  "uv.lock",
  "pipfile.lock",
  "cargo.lock",
  "go.sum",
]);
const CI_FILE_NAMES = new Set([".gitlab-ci.yml", ".gitlab-ci.yaml"]);
const TEXT_CONFIG_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".properties",
]);
const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "__fixtures__",
  "fixtures",
  "testdata",
  "vendor",
  "target",
  ".idea",
]);
const DEFAULT_IGNORED_SEGMENTS = ["fixtures/node_modules"];
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_SOURCE_CONTENT_FILES = 400;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function looksLikeDoc(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return DOC_NAMES.some((name) => base.startsWith(name));
}

function looksLikeManifest(filePath: string): boolean {
  return MANIFEST_NAMES.includes(path.basename(filePath).toLowerCase());
}

function isEnvExample(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.includes(".env") && (base.includes("example") || base.includes("sample"));
}

function isWorkflowFile(filePath: string): boolean {
  return filePath.startsWith(".github/workflows/") || CI_FILE_NAMES.has(path.basename(filePath).toLowerCase());
}

function isIgnoredPath(relativePath: string, extraIgnored: string[]): boolean {
  const segments = relativePath.split("/");
  if (segments.some((segment) => DEFAULT_IGNORED_DIRS.has(segment))) {
    return true;
  }

  if (DEFAULT_IGNORED_SEGMENTS.some((segment) => relativePath.includes(segment))) {
    return true;
  }

  return extraIgnored.some((ignored) => relativePath === ignored || relativePath.startsWith(`${ignored}/`));
}

function isTestFile(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  const base = path.basename(normalized);
  return (
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    normalized.startsWith("test/") ||
    normalized.startsWith("tests/") ||
    /\.test\.[a-z0-9]+$/.test(base) ||
    /\.spec\.[a-z0-9]+$/.test(base) ||
    /^test_[^.]+\.(py)$/.test(base) ||
    /_test\.go$/.test(base)
  );
}

function isSourceFile(relativePath: string): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension) && !isTestFile(relativePath);
}

function shouldReadTextFile(relativePath: string, sourceReads: number): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  const base = path.basename(relativePath).toLowerCase();

  if (looksLikeDoc(relativePath) || looksLikeManifest(relativePath) || isWorkflowFile(relativePath) || isEnvExample(relativePath)) {
    return true;
  }

  if (base === "codeowners" || base === ".pre-commit-config.yaml" || base === "dockerfile") {
    return true;
  }

  if (relativePath.startsWith(".husky/") || relativePath.startsWith(".devcontainer/")) {
    return true;
  }

  if (TEXT_CONFIG_EXTENSIONS.has(extension)) {
    return true;
  }

  if ((isSourceFile(relativePath) || isTestFile(relativePath)) && sourceReads < MAX_SOURCE_CONTENT_FILES) {
    return true;
  }

  return false;
}

function detectEcosystems(filePaths: string[], packageJson: PackageJsonData | null): Ecosystem[] {
  const ecosystems = new Set<Ecosystem>();

  if (packageJson || filePaths.includes("package.json")) {
    ecosystems.add("node");
  }

  if (filePaths.includes("pyproject.toml") || filePaths.includes("requirements.txt") || filePaths.some((file) => file.endsWith(".py"))) {
    ecosystems.add("python");
  }

  if (filePaths.includes("go.mod") || filePaths.some((file) => file.endsWith(".go"))) {
    ecosystems.add("go");
  }

  if (filePaths.includes("Cargo.toml") || filePaths.some((file) => file.endsWith(".rs"))) {
    ecosystems.add("rust");
  }

  return [...ecosystems];
}

async function walkDirectory(
  rootPath: string,
  currentPath: string,
  extraIgnored: string[],
  filePaths: string[],
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

    if (!relativePath) {
      continue;
    }

    if (isIgnoredPath(relativePath, extraIgnored)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(rootPath, absolutePath, extraIgnored, filePaths);
      continue;
    }

    filePaths.push(relativePath);
  }
}

export async function discoverRepository(rootPath: string, extraIgnored: string[] = []): Promise<RepoDiscovery> {
  const filePaths: string[] = [];
  const warnings: string[] = [];
  await walkDirectory(rootPath, rootPath, extraIgnored.map((value) => value.replace(/^\.?\//, "")), filePaths);

  filePaths.sort();

  const sourceFiles = filePaths.filter(isSourceFile);
  const testFiles = filePaths.filter(isTestFile);
  const workflowFiles = filePaths.filter(isWorkflowFile);
  const envExampleFiles = filePaths.filter(isEnvExample);
  const docsFiles = filePaths.filter((filePath) => looksLikeDoc(filePath));
  const lockfiles = filePaths.filter((filePath) => LOCKFILE_NAMES.has(path.basename(filePath).toLowerCase()));
  const manifests = filePaths.filter((filePath) => looksLikeManifest(filePath));

  const textByPath = new Map<string, string>();
  let sourceReads = 0;

  for (const relativePath of filePaths) {
    if (!shouldReadTextFile(relativePath, sourceReads)) {
      continue;
    }

    const absolutePath = path.join(rootPath, relativePath);
    let fileStats;
    try {
      fileStats = await stat(absolutePath);
    } catch {
      warnings.push(`Skipped unreadable path ${relativePath}.`);
      continue;
    }

    if (fileStats.isDirectory()) {
      warnings.push(`Skipped directory-like path ${relativePath}.`);
      continue;
    }

    if (fileStats.size > MAX_TEXT_BYTES) {
      warnings.push(`Skipped large file content for ${relativePath}.`);
      continue;
    }

    if (isSourceFile(relativePath) || isTestFile(relativePath)) {
      sourceReads += 1;
    }

    try {
      const content = await readFile(absolutePath, "utf8");
      textByPath.set(relativePath, content);
    } catch {
      warnings.push(`Could not read ${relativePath} as text.`);
    }
  }

  if (sourceFiles.length > MAX_SOURCE_CONTENT_FILES) {
    warnings.push(`Read a bounded subset of source files (${MAX_SOURCE_CONTENT_FILES}) to keep scans predictable.`);
  }

  let packageJson: PackageJsonData | null = null;
  const packageJsonText = textByPath.get("package.json");
  if (packageJsonText) {
    try {
      packageJson = JSON.parse(packageJsonText) as PackageJsonData;
    } catch {
      warnings.push("Could not parse package.json.");
    }
  }

  return {
    rootPath,
    filePaths,
    sourceFiles,
    testFiles,
    workflowFiles,
    envExampleFiles,
    docsFiles,
    lockfiles,
    manifests,
    warnings,
    ecosystems: detectEcosystems(filePaths, packageJson),
    packageJson,
    textByPath,
  };
}
