import path from "node:path";

import type { RepoDiscovery } from "../core/types.js";

/** Project skill roots Cursor documents for Agent Skills (plus Claude compat paths). */
export const AGENT_SKILL_DIR_PREFIXES = [".agents/skills/", ".cursor/skills/", ".claude/skills/"] as const;

const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

function isUnderSkillRoot(relativePath: string): boolean {
  return AGENT_SKILL_DIR_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function skillFolderName(skillMdPath: string): string | null {
  const dir = path.posix.dirname(skillMdPath);
  const base = path.posix.basename(dir);
  return base && base !== "." ? base : null;
}

function scalarAfterKey(block: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const match = block.match(re);
  if (!match) {
    return null;
  }
  let value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function validateSkillMd(relativePath: string, content: string): string | null {
  const folder = skillFolderName(relativePath);
  if (!folder) {
    return `${relativePath}: SKILL.md must live one level under a skill folder (e.g. .agents/skills/my-skill/SKILL.md).`;
  }

  const fm = content.match(FRONTMATTER);
  if (!fm) {
    return `${relativePath}: missing YAML frontmatter (open with ---, include name and description per Agent Skills).`;
  }

  const block = fm[1];

  if (!/^name:\s/m.test(block)) {
    return `${relativePath}: frontmatter must include a name field (skill id, lowercase hyphens; must match folder "${folder}").`;
  }

  if (!/^description:\s/m.test(block)) {
    return `${relativePath}: frontmatter must include a description field (when the skill applies).`;
  }

  const name = scalarAfterKey(block, "name");
  if (!name) {
    return `${relativePath}: name must be a single-line value (multiline YAML not validated here).`;
  }

  if (name.length < 1 || name.length > 64) {
    return `${relativePath}: name must be 1-64 characters (Agent Skills spec).`;
  }

  if (!VALID_SKILL_NAME.test(name)) {
    return `${relativePath}: name must be lowercase letters, digits, and non-consecutive hyphens only.`;
  }

  if (name !== folder) {
    return `${relativePath}: name "${name}" must match parent folder "${folder}".`;
  }

  const desc = scalarAfterKey(block, "description");
  if (desc !== null) {
    if (desc.length < 1) {
      return `${relativePath}: description must be non-empty.`;
    }
    if (desc.length > 1024) {
      return `${relativePath}: description should be at most 1024 characters (Agent Skills spec).`;
    }
  }

  return null;
}

/**
 * Append human-readable warnings for SKILL.md files under standard skill roots when content is available.
 * Does not attempt full YAML parsing (multiline description, etc.).
 */
export function pushAgentSkillValidationWarnings(discovery: RepoDiscovery): void {
  for (const filePath of discovery.filePaths) {
    if (!filePath.endsWith("/SKILL.md")) {
      continue;
    }
    if (!isUnderSkillRoot(filePath)) {
      continue;
    }

    const content = discovery.textByPath.get(filePath);
    if (content === undefined) {
      continue;
    }

    const message = validateSkillMd(filePath, content);
    if (message) {
      discovery.warnings.push(message);
    }
  }
}
