import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { scanRepository } from "../src/core/scanRepo.js";
import type { AcceleratorCheckResult, CheckResult, ScanReport } from "../src/core/types.js";

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

function fixturePath(name: string): string {
  return path.join(process.cwd(), "fixtures", name);
}

async function createTempRepo(files: Record<string, string>): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-compatibility-"));
  tempDirs.push(rootPath);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const absolutePath = path.join(rootPath, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }),
  );

  return rootPath;
}

function getCheck(report: ScanReport, checkId: string): CheckResult {
  const check = report.pillars.flatMap((pillar) => pillar.checks).find((entry) => entry.id === checkId);

  if (!check) {
    throw new Error(`Missing check ${checkId}`);
  }

  return check;
}

function getAcceleratorCheck(report: ScanReport, checkId: string): AcceleratorCheckResult {
  const check = report.accelerators.checks.find((entry) => entry.id === checkId);

  if (!check) {
    throw new Error(`Missing accelerator check ${checkId}`);
  }

  return check;
}

describe("scanRepository", () => {
  it("scores a barebones library as low compatibility", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("basic-js-lib"),
    });

    expect(report.classification.kind).toBe("library");
    expect(report.overallScore).toBeLessThan(40);
    expect(report.acceleratorBonus).toBe(0);
    expect(getCheck(report, "readmePresent").status).toBe("pass");
    expect(getCheck(report, "ciWorkflowPresent").status).toBe("fail");
  });

  it("scores a standardized service as high compatibility", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("standardized-node-service"),
    });

    expect(report.classification.kind).toBe("application");
    expect(report.overallScore).toBeGreaterThanOrEqual(75);
    expect(report.baseScore).toBe(100);
    expect(report.acceleratorBonus).toBeGreaterThan(0);
    expect(getCheck(report, "ciWorkflowPresent").status).toBe("pass");
    expect(getCheck(report, "strictModeEnabled").status).toBe("pass");
    expect(getCheck(report, "integrationCoverageWhenRelevant").status).toBe("pass");
    expect(getCheck(report, "metricsTracingOrErrorReporting").status).toBe("pass");
    expect(getAcceleratorCheck(report, "agentGuidanceDocs").status).toBe("pass");
    expect(getAcceleratorCheck(report, "cursorToolingConfigured").status).toBe("pass");
    expect(getAcceleratorCheck(report, "cursorMcpConfigured").status).toBe("pass");
    expect(getAcceleratorCheck(report, "claudeToolingConfigured").status).toBe("pass");
    expect(getAcceleratorCheck(report, "dependencyMcpAlignment").status).toBe("pass");
  });

  it("marks runtime-heavy checks as not applicable for simple CLIs", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("cli-lite"),
    });

    expect(report.classification.kind).toBe("cli");
    expect(getCheck(report, "loggingSignal").status).toBe("not_applicable");
    expect(getCheck(report, "healthOrDebugSignal").status).toBe("not_applicable");
    expect(getCheck(report, "integrationCoverageWhenRelevant").status).toBe("not_applicable");
    expect(getCheck(report, "metricsTracingOrErrorReporting").status).toBe("not_applicable");
    expect(report.acceleratorBonus).toBe(0);
  });

  it("treats repo-local language tooling config as a deterministic static-analysis signal", async () => {
    const rootPath = await createTempRepo({
      "package.json": JSON.stringify(
        {
          name: "editor-tooled-repo",
          version: "1.0.0",
        },
        null,
        2,
      ),
      "README.md": "# Editor tooled repo\n",
      "src/index.ts": "export const answer = 42;\n",
      ".vscode/settings.json": JSON.stringify(
        {
          "typescript.tsdk": "node_modules/typescript/lib",
        },
        null,
        2,
      ),
      ".vscode/extensions.json": JSON.stringify(
        {
          recommendations: ["ms-vscode.vscode-typescript-next"],
        },
        null,
        2,
      ),
    });

    const report = await scanRepository({ rootPath });
    const staticCheck = getCheck(report, "typeOrStaticCheckConfigured");

    expect(staticCheck.status).toBe("partial");
    expect(staticCheck.evidence.some((entry) => entry.startsWith(".vscode/"))).toBe(true);
  });

  it("counts CircleCI-based Go validation without auto-passing formatting", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("circleci-go-service"),
    });

    expect(report.ecosystems).toContain("go");
    expect(getCheck(report, "ciWorkflowPresent").status).toBe("pass");
    expect(getCheck(report, "typeOrStaticCheckConfigured").status).toBe("pass");
    expect(getCheck(report, "formatterConfigured").status).toBe("fail");
  });

  it("treats Makefile-based native repos as first-class build and validation surfaces", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("makefile-c-lib"),
    });

    expect(report.ecosystems).toContain("c");
    expect(report.classification.kind).toBe("library");
    expect(getCheck(report, "buildOrPackageCommand").status).toBe("pass");
    expect(getCheck(report, "testCommandDiscoverable").status).toBe("pass");
    expect(getCheck(report, "validateCommandDiscoverable").status).toBe("pass");
    expect(getCheck(report, "formatterConfigured").status).toBe("pass");
    expect(getCheck(report, "typeOrStaticCheckConfigured").status).toBe("pass");
  });

  it("treats CMake metadata as a discoverable native build signal", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("native-cpp-cmake"),
    });

    expect(report.ecosystems).toContain("cpp");
    expect(report.classification.kind).toBe("library");
    expect(getCheck(report, "buildOrPackageCommand").status).toBe("partial");
    expect(getCheck(report, "testCommandDiscoverable").status).toBe("partial");
  });

  it("gives minimal Rust repos partial typed-language credit without auto-pass", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("rust-crate-minimal"),
    });

    expect(report.ecosystems).toContain("rust");
    expect(getCheck(report, "typeOrStaticCheckConfigured").status).toBe("partial");
    expect(getCheck(report, "strictModeEnabled").status).toBe("not_applicable");
  });

  it("detects GitHub-native security scanning like CodeQL and dependency review", async () => {
    const report = await scanRepository({
      rootPath: fixturePath("github-codeql-repo"),
    });

    expect(getCheck(report, "ciWorkflowPresent").status).toBe("pass");
    expect(getCheck(report, "securityScanConfigured").status).toBe("pass");
    expect(getCheck(report, "ciSecurityStep").status).toBe("pass");
  });
});
