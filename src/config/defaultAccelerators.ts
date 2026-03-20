import type { AcceleratorCheckDefinition } from "../core/types.js";

export const DEFAULT_ACCELERATORS: AcceleratorCheckDefinition[] = [
  {
    id: "agentGuidanceDocs",
    name: "Agent guidance docs",
    maxPoints: 2,
    remediation: "Add AGENTS.md with concise, repo-specific guidance for autonomous work.",
  },
  {
    id: "cursorToolingConfigured",
    name: "Cursor project tooling",
    maxPoints: 2,
    remediation:
      "Add project-specific .agents/skills, .cursor rules/skills/agents, or both so Cursor has reusable repo context.",
  },
  {
    id: "cursorMcpConfigured",
    name: "Cursor MCP setup",
    maxPoints: 2,
    remediation: "Add .cursor/mcp.json with at least one working MCP server for repo-specific workflows.",
  },
  {
    id: "claudeToolingConfigured",
    name: "Claude project tooling",
    maxPoints: 2,
    remediation: "Add .claude agents or commands so Claude-based workflows have project context.",
  },
  {
    id: "dependencyMcpAlignment",
    name: "Dependency-to-MCP alignment",
    maxPoints: 2,
    remediation: "Add MCP servers that match the repo's major external surfaces, such as database or browser tooling.",
  },
];

export const MAX_ACCELERATOR_BONUS = DEFAULT_ACCELERATORS.reduce((sum, definition) => sum + definition.maxPoints, 0);
