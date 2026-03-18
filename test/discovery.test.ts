import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { discoverRepository } from "../src/core/discovery.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dirPath) =>
      rm(dirPath, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("discoverRepository", () => {
  it("skips broken symlinks instead of failing the scan", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-compatibility-"));
    tempDirs.push(rootPath);

    await mkdir(path.join(rootPath, "src"));
    await writeFile(path.join(rootPath, "README.md"), "# Temp Repo\n");
    await symlink("missing-target", path.join(rootPath, "README-link.md"));

    const discovery = await discoverRepository(rootPath);

    expect(discovery.filePaths).toContain("README-link.md");
    expect(discovery.warnings).toContain("Skipped unreadable path README-link.md.");
  });

  it("keeps repo-local vscode config available for deterministic checks", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-compatibility-"));
    tempDirs.push(rootPath);

    await mkdir(path.join(rootPath, ".vscode"), { recursive: true });
    await writeFile(
      path.join(rootPath, ".vscode", "settings.json"),
      JSON.stringify(
        {
          "typescript.tsdk": "node_modules/typescript/lib",
        },
        null,
        2,
      ),
    );

    const discovery = await discoverRepository(rootPath);

    expect(discovery.filePaths).toContain(".vscode/settings.json");
    expect(discovery.textByPath.get(".vscode/settings.json")).toContain("typescript.tsdk");
  });
});
