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

  it("detects ci configs, task files, build configs, and native ecosystems", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-compatibility-"));
    tempDirs.push(rootPath);

    await mkdir(path.join(rootPath, ".circleci"), { recursive: true });
    await mkdir(path.join(rootPath, "src"), { recursive: true });
    await mkdir(path.join(rootPath, "include"), { recursive: true });
    await writeFile(path.join(rootPath, "README.md"), "# Native Repo\n");
    await writeFile(path.join(rootPath, ".circleci", "config.yml"), "version: 2.1\n");
    await writeFile(path.join(rootPath, "Jenkinsfile"), "pipeline { agent any }\n");
    await writeFile(path.join(rootPath, "Makefile"), "build:\n\tcc src/main.c -o app\n");
    await writeFile(path.join(rootPath, "CMakeLists.txt"), "project(native LANGUAGES C CXX)\n");
    await writeFile(path.join(rootPath, ".clang-format"), "BasedOnStyle: LLVM\n");
    await writeFile(path.join(rootPath, "src", "main.c"), "int main(void) { return 0; }\n");
    await writeFile(path.join(rootPath, "src", "lib.cpp"), "int value() { return 1; }\n");
    await writeFile(path.join(rootPath, "include", "lib.hpp"), "int value();\n");

    const discovery = await discoverRepository(rootPath);

    expect(discovery.ciConfigFiles).toEqual(expect.arrayContaining([".circleci/config.yml", "Jenkinsfile"]));
    expect(discovery.taskFiles).toContain("Makefile");
    expect(discovery.buildConfigFiles).toContain("CMakeLists.txt");
    expect(discovery.textByPath.get(".clang-format")).toContain("BasedOnStyle");
    expect(discovery.sourceFiles).toEqual(expect.arrayContaining(["src/main.c", "src/lib.cpp"]));
    expect(discovery.sourceFiles).not.toContain("include/lib.hpp");
    expect(discovery.ecosystems).toEqual(expect.arrayContaining(["c", "cpp"]));
  });
});
