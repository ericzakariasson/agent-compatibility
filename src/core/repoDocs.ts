import path from "node:path";

import type { RepoDiscovery } from "./types.js";

/** Root-level and `docs/` markdown-style paths aggregated for checks. */
const ROOT_DOC_BASENAME =
  /^(README|CONTRIBUTING|CHANGELOG|SECURITY|GOVERNANCE|AGENTS\.md|CODE_OF_CONDUCT)/i;

export function docsPaths(discovery: RepoDiscovery): string[] {
  return discovery.filePaths.filter(
    (filePath) => ROOT_DOC_BASENAME.test(path.basename(filePath)) || filePath.startsWith("docs/"),
  );
}

export function docsText(discovery: RepoDiscovery): string {
  return docsPaths(discovery)
    .map((filePath) => discovery.textByPath.get(filePath) ?? "")
    .join("\n");
}
