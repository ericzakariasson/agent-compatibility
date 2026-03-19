import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { LOCKFILE_BASENAMES } from "../config/lockfileNames.js";

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
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".cs",
  ".swift",
  ".php",
  ".rb",
  ".dart",
  ".zig",
  ".ex",
  ".exs",
  ".lua",
  ".hs",
  ".ml",
  ".mli",
]);
const HEADER_EXTENSIONS = new Set([".h", ".hh", ".hpp", ".hxx", ".ipp"]);

const DOC_NAMES = [
  "readme",
  "agents",
  "claude",
  "license",
  "contributing",
  "changelog",
  "security",
  "code_of_conduct",
  "governance",
];

/** Exact manifest basenames (lowercase). */
const MANIFEST_BASENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "gemfile",
  "composer.json",
  "package.swift",
  "pubspec.yaml",
  "mix.exs",
  "build.sbt",
  "deno.json",
  "deno.jsonc",
  "module.bazel",
  "workspace",
  "workspace.bazel",
  "goframe.mod",
]);

const CI_FILE_NAMES = new Set([
  ".gitlab-ci.yml",
  ".gitlab-ci.yaml",
  ".travis.yml",
  "jenkinsfile",
  "azure-pipelines.yml",
  "azure-pipelines.yaml",
  "bitbucket-pipelines.yml",
  "buildkite.yml",
  "buildkite.yaml",
  "drone.yml",
  ".drone.yml",
  "appveyor.yml",
  "appveyor.yaml",
  "codemagic.yaml",
  "codemagic.yml",
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "docker-compose.override.yml",
  "docker-compose.override.yaml",
]);
const CI_FILE_PATHS = new Set([".circleci/config.yml", ".circleci/config.yaml"]);
const TASK_FILE_NAMES = new Set([
  "makefile",
  "gnumakefile",
  "justfile",
  "taskfile.yml",
  "taskfile.yaml",
  "taskfile.dist.yml",
  "taskfile.dist.yaml",
  "earthfile",
]);
const BUILD_CONFIG_FILE_NAMES = new Set([
  "cmakelists.txt",
  "cmakepresets.json",
  "meson.build",
  "meson.options",
  "compile_commands.json",
]);
const EXTRA_TEXT_FILE_NAMES = new Set(["codeowners", ".pre-commit-config.yaml", ".clang-format", ".clang-tidy", ".editorconfig"]);
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
  ".xml",
  ".gradle",
  ".kts",
  ".props",
  ".targets",
  ".plist",
  ".cmake",
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
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".gradle",
  ".pytest_cache",
  ".mypy_cache",
  "pods",
  "bazel-bin",
  "bazel-out",
  "out",
  "tmp",
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
  const base = path.basename(filePath).toLowerCase();
  if (MANIFEST_BASENAMES.has(base)) {
    return true;
  }
  if (/\.(csproj|fsproj|vbproj|vcxproj|esproj)$/i.test(base)) {
    return true;
  }
  if (base === "directory.build.props" || base === "directory.build.targets") {
    return true;
  }
  return false;
}

function isEnvExample(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.includes(".env") && (base.includes("example") || base.includes("sample"));
}

function isCiConfigFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  if (normalized.startsWith(".github/workflows/")) {
    return true;
  }
  if (normalized.startsWith(".buildkite/")) {
    return true;
  }
  if (CI_FILE_PATHS.has(normalized)) {
    return true;
  }
  return CI_FILE_NAMES.has(path.basename(normalized));
}

function isWorkflowFile(filePath: string): boolean {
  return isCiConfigFile(filePath);
}

function isTaskFile(filePath: string): boolean {
  return TASK_FILE_NAMES.has(path.basename(filePath.toLowerCase()));
}

function isBuildConfigFile(filePath: string): boolean {
  return BUILD_CONFIG_FILE_NAMES.has(path.basename(filePath.toLowerCase()));
}

function isNativeHeaderFile(relativePath: string): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  return HEADER_EXTENSIONS.has(extension) && !isTestFile(relativePath);
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

  if (
    looksLikeDoc(relativePath) ||
    looksLikeManifest(relativePath) ||
    isCiConfigFile(relativePath) ||
    isTaskFile(relativePath) ||
    isBuildConfigFile(relativePath) ||
    isEnvExample(relativePath)
  ) {
    return true;
  }

  if (EXTRA_TEXT_FILE_NAMES.has(base)) {
    return true;
  }

  if (/^dockerfile/i.test(base) || /^containerfile/i.test(base)) {
    return true;
  }

  if (relativePath.startsWith(".husky/") || relativePath.startsWith(".devcontainer/")) {
    return true;
  }

  if (TEXT_CONFIG_EXTENSIONS.has(extension)) {
    return true;
  }

  if ((isSourceFile(relativePath) || isTestFile(relativePath) || isNativeHeaderFile(relativePath)) && sourceReads < MAX_SOURCE_CONTENT_FILES) {
    return true;
  }

  return false;
}

function hasBasenameIc(filePaths: string[], basenameLower: string): boolean {
  return filePaths.some((filePath) => path.basename(filePath).toLowerCase() === basenameLower);
}

function hasBasenameMatching(filePaths: string[], pattern: RegExp): boolean {
  return filePaths.some((filePath) => pattern.test(path.basename(filePath)));
}

function detectEcosystems(filePaths: string[], packageJson: PackageJsonData | null): Ecosystem[] {
  const ecosystems = new Set<Ecosystem>();

  if (packageJson || hasBasenameIc(filePaths, "package.json")) {
    ecosystems.add("node");
  }

  if (hasBasenameIc(filePaths, "deno.json") || hasBasenameIc(filePaths, "deno.jsonc")) {
    ecosystems.add("deno");
  }

  if (
    hasBasenameIc(filePaths, "pyproject.toml") ||
    hasBasenameIc(filePaths, "requirements.txt") ||
    hasBasenameIc(filePaths, "requirements-dev.txt") ||
    filePaths.some((file) => file.toLowerCase().endsWith(".py"))
  ) {
    ecosystems.add("python");
  }

  if (hasBasenameIc(filePaths, "go.mod") || filePaths.some((file) => file.toLowerCase().endsWith(".go"))) {
    ecosystems.add("go");
  }

  if (hasBasenameIc(filePaths, "cargo.toml") || filePaths.some((file) => file.toLowerCase().endsWith(".rs"))) {
    ecosystems.add("rust");
  }

  if (filePaths.some((file) => file.toLowerCase().endsWith(".c"))) {
    ecosystems.add("c");
  }

  if (
    filePaths.some((file) => {
      const f = file.toLowerCase();
      return f.endsWith(".cc") || f.endsWith(".cpp") || f.endsWith(".cxx") || f.endsWith(".hh") || f.endsWith(".hpp");
    })
  ) {
    ecosystems.add("cpp");
  }

  if (
    hasBasenameIc(filePaths, "pom.xml") ||
    hasBasenameMatching(filePaths, /^build\.gradle(\.kts)?$/i) ||
    hasBasenameMatching(filePaths, /^settings\.gradle(\.kts)?$/i)
  ) {
    ecosystems.add("jvm");
  }

  if (hasBasenameIc(filePaths, "gemfile") || filePaths.some((file) => file.toLowerCase().endsWith(".rb"))) {
    ecosystems.add("ruby");
  }

  if (hasBasenameIc(filePaths, "composer.json") || filePaths.some((file) => file.toLowerCase().endsWith(".php"))) {
    ecosystems.add("php");
  }

  if (hasBasenameMatching(filePaths, /\.(csproj|fsproj|vbproj|sln)$/i)) {
    ecosystems.add("dotnet");
  }

  if (hasBasenameIc(filePaths, "package.swift") || filePaths.some((file) => file.toLowerCase().endsWith(".swift"))) {
    ecosystems.add("swift");
  }

  if (
    hasBasenameIc(filePaths, "mix.exs") ||
    filePaths.some((file) => {
      const f = file.toLowerCase();
      return f.endsWith(".ex") || f.endsWith(".exs");
    })
  ) {
    ecosystems.add("elixir");
  }

  if (hasBasenameIc(filePaths, "pubspec.yaml") || filePaths.some((file) => file.toLowerCase().endsWith(".dart"))) {
    ecosystems.add("dart");
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
  const ciConfigFiles = filePaths.filter(isCiConfigFile);
  const workflowFiles = ciConfigFiles;
  const taskFiles = filePaths.filter(isTaskFile);
  const buildConfigFiles = filePaths.filter(isBuildConfigFile);
  const envExampleFiles = filePaths.filter(isEnvExample);
  const docsFiles = filePaths.filter((filePath) => looksLikeDoc(filePath));
  const lockfiles = filePaths.filter((filePath) => LOCKFILE_BASENAMES.has(path.basename(filePath).toLowerCase()));
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
    ciConfigFiles,
    workflowFiles,
    taskFiles,
    buildConfigFiles,
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
