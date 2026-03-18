import path from "node:path";

import type {
  AcceleratorCheckDefinition,
  AcceleratorCheckResult,
  CheckContext,
  CheckStatus,
  PackageJsonData,
  RepoDiscovery,
} from "../core/types.js";

interface ParsedMcpConfig {
  filePath: string;
  valid: boolean;
  serverEntries: Array<{ name: string; haystack: string }>;
  error?: string;
}

interface DependencyCategory {
  id: string;
  label: string;
  dependencyPatterns: RegExp[];
  serverPatterns: RegExp[];
}

interface AcceleratorSignals {
  hasAgentsGuide: boolean;
  hasClaudeGuide: boolean;
  rootGuidanceDocs: RootGuidanceDoc[];
  docsText: string;
  cursorAssets: string[];
  claudeAssets: string[];
  validCursorMcpConfigs: ParsedMcpConfig[];
  invalidCursorMcpConfigs: ParsedMcpConfig[];
  matchedDependencyCategories: DependencyCategory[];
}

interface RootGuidanceDoc {
  filePath: "AGENTS.md" | "CLAUDE.md";
  wordCount: number | null;
  status: "concise" | "verbose" | "too_long" | "unreadable";
  evidence: string;
}

const ROOT_GUIDANCE_DOCS = ["AGENTS.md", "CLAUDE.md"] as const;
const ROOT_GUIDANCE_DOC_PASS_WORD_LIMIT = 400;
const ROOT_GUIDANCE_DOC_FAIL_WORD_LIMIT = 900;

const MCP_DEPENDENCY_CATEGORIES: DependencyCategory[] = [
  {
    id: "database",
    label: "database",
    dependencyPatterns: [
      /\bprisma\b/i,
      /\bdrizzle-orm\b/i,
      /\bpg\b/i,
      /\bpostgres(?:ql)?\b/i,
      /\bmysql2?\b/i,
      /\bsqlite3?\b/i,
      /\bbetter-sqlite3\b/i,
      /\bmongodb\b/i,
      /\bmongoose\b/i,
      /\bredis\b/i,
      /\bsqlalchemy\b/i,
      /\bpsycopg\b/i,
    ],
    serverPatterns: [/\bpostgres\b/i, /\bmysql\b/i, /\bsqlite\b/i, /\bmongo\b/i, /\bredis\b/i, /\bdb\b/i, /\bdatabase\b/i, /\bprisma\b/i],
  },
  {
    id: "browser",
    label: "browser",
    dependencyPatterns: [/\bplaywright\b/i, /\bpuppeteer\b/i, /\bselenium\b/i, /\bcypress\b/i],
    serverPatterns: [/\bbrowser\b/i, /\bplaywright\b/i, /\bchrome\b/i, /\bpuppeteer\b/i],
  },
  {
    id: "github",
    label: "github",
    dependencyPatterns: [/\boctokit\b/i, /@actions\/github/i],
    serverPatterns: [/\bgithub\b/i, /\bgh\b/i],
  },
  {
    id: "slack",
    label: "slack",
    dependencyPatterns: [/@slack\/web-api/i, /\bslack-bolt\b/i, /\bbolt-js\b/i],
    serverPatterns: [/\bslack\b/i],
  },
  {
    id: "notion",
    label: "notion",
    dependencyPatterns: [/@notionhq\/client/i],
    serverPatterns: [/\bnotion\b/i],
  },
  {
    id: "linear",
    label: "linear",
    dependencyPatterns: [/@linear\/sdk/i, /\blinear-sdk\b/i],
    serverPatterns: [/\blinear\b/i],
  },
];

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

function hasFile(discovery: RepoDiscovery, predicate: (filePath: string) => boolean): boolean {
  return discovery.filePaths.some(predicate);
}

function collectEvidence(discovery: RepoDiscovery, predicate: (filePath: string) => boolean, limit = 3): string[] {
  return discovery.filePaths.filter(predicate).slice(0, limit);
}

function docsText(discovery: RepoDiscovery): string {
  return discovery.filePaths
    .filter((filePath) => /^README/i.test(path.basename(filePath)) || filePath === "AGENTS.md" || filePath === "CLAUDE.md" || filePath.startsWith("docs/"))
    .map((filePath) => discovery.textByPath.get(filePath) ?? "")
    .join("\n");
}

function countWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

function getRootGuidanceDocs(discovery: RepoDiscovery): RootGuidanceDoc[] {
  return ROOT_GUIDANCE_DOCS.filter((filePath) => discovery.filePaths.includes(filePath)).map((filePath) => {
    const content = discovery.textByPath.get(filePath);

    if (content === undefined) {
      return {
        filePath,
        wordCount: null,
        status: "unreadable",
        evidence: `${filePath} (content unavailable)`,
      };
    }

    const wordCount = countWords(content);
    const status =
      wordCount <= ROOT_GUIDANCE_DOC_PASS_WORD_LIMIT
        ? "concise"
        : wordCount <= ROOT_GUIDANCE_DOC_FAIL_WORD_LIMIT
          ? "verbose"
          : "too_long";

    return {
      filePath,
      wordCount,
      status,
      evidence: `${filePath} (${wordCount} words)`,
    };
  });
}

function assetPrefixes(discovery: RepoDiscovery, prefixes: string[]): string[] {
  return prefixes.filter((prefix) => discovery.filePaths.some((filePath) => filePath.startsWith(prefix)));
}

function makeResult(
  definition: AcceleratorCheckDefinition,
  status: CheckStatus,
  evidence: string[],
  confidence: number,
): AcceleratorCheckResult {
  const multiplier = status === "pass" ? 1 : status === "partial" ? 0.5 : 0;
  return {
    ...definition,
    status,
    awardedPoints: status === "not_applicable" ? 0 : definition.maxPoints * multiplier,
    evidence,
    confidence,
  };
}

function parseJsonFile(discovery: RepoDiscovery, filePath: string): ParsedMcpConfig {
  const content = discovery.textByPath.get(filePath);
  if (!content) {
    return {
      filePath,
      valid: false,
      serverEntries: [],
      error: "file could not be read",
    };
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers;
    const serverEntries =
      mcpServers && typeof mcpServers === "object"
        ? Object.entries(mcpServers as Record<string, unknown>).map(([name, config]) => ({
            name,
            haystack: `${name} ${JSON.stringify(config)}`,
          }))
        : [];

    return {
      filePath,
      valid: true,
      serverEntries,
    };
  } catch (error) {
    return {
      filePath,
      valid: false,
      serverEntries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getCursorMcpConfigs(discovery: RepoDiscovery): ParsedMcpConfig[] {
  return [".cursor/mcp.json", ".cursor/mcp.jsonc"]
    .filter((filePath) => discovery.filePaths.includes(filePath))
    .map((filePath) => parseJsonFile(discovery, filePath));
}

function manifestText(discovery: RepoDiscovery): string {
  const packageText = discovery.textByPath.get("package.json") ?? "";
  const otherManifests = discovery.manifests
    .filter((filePath) => filePath !== "package.json")
    .map((filePath) => discovery.textByPath.get(filePath) ?? "");

  return [packageText, ...otherManifests].join("\n");
}

function matchedDependencyCategories(discovery: RepoDiscovery): DependencyCategory[] {
  const deps = dependencyNames(discovery.packageJson).join("\n");
  const manifests = manifestText(discovery);
  const haystack = `${deps}\n${manifests}`;

  return MCP_DEPENDENCY_CATEGORIES.filter((category) => category.dependencyPatterns.some((pattern) => pattern.test(haystack)));
}

function buildSignals(discovery: RepoDiscovery): AcceleratorSignals {
  const cursorMcpConfigs = getCursorMcpConfigs(discovery);

  return {
    hasAgentsGuide: discovery.filePaths.includes("AGENTS.md"),
    hasClaudeGuide: discovery.filePaths.includes("CLAUDE.md"),
    rootGuidanceDocs: getRootGuidanceDocs(discovery),
    docsText: docsText(discovery),
    cursorAssets: assetPrefixes(discovery, [".cursor/skills/", ".cursor/agents/", ".cursor/rules/"]),
    claudeAssets: assetPrefixes(discovery, [".claude/agents/", ".claude/commands/"]),
    validCursorMcpConfigs: cursorMcpConfigs.filter((config) => config.valid),
    invalidCursorMcpConfigs: cursorMcpConfigs.filter((config) => !config.valid),
    matchedDependencyCategories: matchedDependencyCategories(discovery),
  };
}

function evaluateAccelerator(
  definition: AcceleratorCheckDefinition,
  context: CheckContext,
  signals: AcceleratorSignals,
): AcceleratorCheckResult {
  const { discovery } = context;
  switch (definition.id) {
    case "agentGuidanceDocs":
      if (signals.rootGuidanceDocs.length > 0) {
        const evidence = signals.rootGuidanceDocs.map((guide) => guide.evidence).slice(0, 3);
        if (signals.rootGuidanceDocs.some((guide) => guide.status === "too_long" || guide.status === "unreadable")) {
          return makeResult(definition, "fail", evidence, 0.95);
        }
        if (signals.rootGuidanceDocs.some((guide) => guide.status === "verbose")) {
          return makeResult(definition, "partial", evidence, 0.8);
        }
        return makeResult(definition, "pass", evidence, 0.95);
      }
      if (/\bagent\b|\bcursor\b|\bclaude\b/i.test(signals.docsText)) {
        return makeResult(definition, "partial", ["README"], 0.55);
      }
      return makeResult(definition, "fail", ["no AGENTS.md or CLAUDE.md found"], 0.9);

    case "cursorToolingConfigured":
      if (signals.cursorAssets.length >= 2) {
        return makeResult(definition, "pass", signals.cursorAssets.slice(0, 3), 0.9);
      }
      if (signals.cursorAssets.length === 1 || hasFile(discovery, (filePath) => filePath === ".cursorignore")) {
        return makeResult(definition, "partial", signals.cursorAssets.length > 0 ? signals.cursorAssets : [".cursorignore"], 0.65);
      }
      return makeResult(definition, "fail", ["no project-specific .cursor assets found"], 0.9);

    case "cursorMcpConfigured":
      if (signals.validCursorMcpConfigs.some((config) => config.serverEntries.length > 0)) {
        return makeResult(
          definition,
          "pass",
          signals.validCursorMcpConfigs.map((config) => config.filePath).slice(0, 2),
          0.95,
        );
      }
      if (signals.validCursorMcpConfigs.length > 0) {
        return makeResult(
          definition,
          "partial",
          signals.validCursorMcpConfigs.map((config) => config.filePath).slice(0, 2),
          0.6,
        );
      }
      if (signals.invalidCursorMcpConfigs.length > 0) {
        return makeResult(
          definition,
          "fail",
          signals.invalidCursorMcpConfigs.map((config) => config.filePath).slice(0, 2),
          0.95,
        );
      }
      return makeResult(definition, "fail", ["no .cursor/mcp.json found"], 0.9);

    case "claudeToolingConfigured": {
      const claudeEvidence = [...(signals.hasClaudeGuide ? ["CLAUDE.md"] : []), ...signals.claudeAssets].slice(0, 3);
      const claudeCount = signals.claudeAssets.length + (signals.hasClaudeGuide ? 1 : 0);

      if (claudeCount >= 2) {
        return makeResult(definition, "pass", claudeEvidence, 0.9);
      }
      if (claudeCount === 1) {
        return makeResult(definition, "partial", claudeEvidence, 0.65);
      }
      return makeResult(definition, "fail", ["no project-specific .claude assets found"], 0.9);
    }

    case "dependencyMcpAlignment": {
      const categories = signals.matchedDependencyCategories;
      if (categories.length === 0) {
        return makeResult(definition, "not_applicable", ["no dependency category with a curated MCP mapping was found"], 0.7);
      }

      const servers = signals.validCursorMcpConfigs.flatMap((config) => config.serverEntries);
      const matched = categories.filter((category) =>
        servers.some((server) => category.serverPatterns.some((pattern) => pattern.test(server.haystack))),
      );

      if (matched.length === categories.length && matched.length > 0) {
        return makeResult(
          definition,
          "pass",
          matched.map((category) => `${category.label} dependency matches MCP`).slice(0, 3),
          0.8,
        );
      }

      if (matched.length > 0 || servers.length > 0) {
        return makeResult(
          definition,
          "partial",
          [
            ...matched.map((category) => `${category.label} dependency matches MCP`),
            ...categories
              .filter((category) => !matched.some((entry) => entry.id === category.id))
              .map((category) => `${category.label} dependency has no obvious MCP match`),
          ].slice(0, 3),
          0.65,
        );
      }

      return makeResult(
        definition,
        "fail",
        categories.map((category) => `${category.label} dependency has no MCP config`).slice(0, 3),
        0.75,
      );
    }

    default:
      return makeResult(definition, "fail", ["unimplemented accelerator"], 0.1);
  }
}

export function runAcceleratorChecks(
  definitions: AcceleratorCheckDefinition[],
  context: CheckContext,
): AcceleratorCheckResult[] {
  const signals = buildSignals(context.discovery);

  for (const invalidConfig of signals.invalidCursorMcpConfigs) {
    context.discovery.warnings.push(`Could not parse ${invalidConfig.filePath}: ${invalidConfig.error ?? "unknown error"}.`);
  }

  return definitions.map((definition) => evaluateAccelerator(definition, context, signals));
}
