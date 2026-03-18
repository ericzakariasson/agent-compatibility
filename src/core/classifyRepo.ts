import type { RepoClassification, RepoDiscovery, RepoKind } from "./types.js";

function dependencyNames(discovery: RepoDiscovery): Set<string> {
  const packageJson = discovery.packageJson;
  const names = [
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
    ...Object.keys(packageJson?.peerDependencies ?? {}),
  ];

  return new Set(names.map((name) => name.toLowerCase()));
}

function textMatches(discovery: RepoDiscovery, pattern: RegExp): boolean {
  for (const content of discovery.textByPath.values()) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}

function hasFile(discovery: RepoDiscovery, filePath: string): boolean {
  return discovery.filePaths.includes(filePath);
}

function hasNestedManifest(discovery: RepoDiscovery, fileName: string): boolean {
  return discovery.filePaths.some((filePath) => filePath !== fileName && filePath.endsWith(`/${fileName}`));
}

function inferKind(discovery: RepoDiscovery): { kind: RepoKind; reasons: string[] } {
  const reasons: string[] = [];
  const packageJson = discovery.packageJson;
  const scripts = packageJson?.scripts ?? {};
  const scriptNames = Object.keys(scripts);
  const dependencies = dependencyNames(discovery);

  const hasWorkspaceSignals =
    Boolean(packageJson?.workspaces) ||
    hasFile(discovery, "pnpm-workspace.yaml") ||
    hasFile(discovery, "turbo.json") ||
    hasFile(discovery, "nx.json") ||
    hasFile(discovery, "lerna.json") ||
    hasNestedManifest(discovery, "package.json") ||
    hasNestedManifest(discovery, "pyproject.toml") ||
    hasNestedManifest(discovery, "Cargo.toml") ||
    hasNestedManifest(discovery, "go.mod");

  if (hasWorkspaceSignals) {
    reasons.push("workspace or nested manifest signals found");
    return { kind: "monorepo", reasons };
  }

  const hasCliSignals =
    Boolean(packageJson?.bin) ||
    discovery.filePaths.some((filePath) => filePath.startsWith("bin/") || filePath.startsWith("cmd/")) ||
    scriptNames.some((script) => script === "cli" || script === "start:cli") ||
    textMatches(discovery, /\bCommand\b|\bcommander\b|\byargs\b|\bclick\b|\bargparse\b/);

  const hasServerSignals =
    ["express", "fastify", "koa", "hono", "@nestjs/core", "next"].some((name) => dependencies.has(name)) ||
    hasFile(discovery, "Dockerfile") ||
    hasFile(discovery, "docker-compose.yml") ||
    hasFile(discovery, "docker-compose.yaml") ||
    discovery.filePaths.some((filePath) => /(^|\/)(server|app|main)\.(ts|tsx|js|jsx|py|go|rs)$/.test(filePath));

  const hasApplicationSignals =
    hasServerSignals ||
    scriptNames.some((script) => ["start", "serve", "preview"].includes(script)) ||
    (scriptNames.includes("dev") && !hasCliSignals);

  if (hasCliSignals && !hasServerSignals) {
    reasons.push("cli entrypoint or cli tooling signals found");
    return { kind: "cli", reasons };
  }

  if (hasApplicationSignals) {
    reasons.push("runtime or service entrypoint signals found");
    return { kind: "application", reasons };
  }

  const hasLibrarySignals =
    Boolean(packageJson?.exports) ||
    Boolean(packageJson?.main) ||
    Boolean(packageJson?.module) ||
    scriptNames.includes("build") ||
    hasFile(discovery, "Cargo.toml") ||
    hasFile(discovery, "pyproject.toml") ||
    hasFile(discovery, "go.mod");

  if (hasLibrarySignals) {
    reasons.push("package or library metadata found");
    return { kind: "library", reasons };
  }

  reasons.push("not enough strong signals to classify repository");
  return { kind: "unknown", reasons };
}

export function classifyRepository(discovery: RepoDiscovery): RepoClassification {
  const inferred = inferKind(discovery);
  const kind = inferred.kind;

  return {
    kind,
    isMonorepo: kind === "monorepo",
    hasRuntimeEntrypoint: kind === "application" || kind === "cli" || kind === "monorepo",
    reasons: inferred.reasons,
  };
}
