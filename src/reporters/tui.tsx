import { useEffect, useState, type JSX } from "react";

import { Box, Text, render, renderToString } from "ink";

import type { AcceleratorCheckResult, CheckResult, ScanReport } from "../core/types.js";

import { ensureSentenceEnds } from "./sentences.js";

export interface TuiRenderOptions {
  color?: boolean;
  verbose?: boolean;
  width?: number;
}

export interface TuiSessionOptions extends TuiRenderOptions {
  targetPath: string;
  loadReport: () => Promise<ScanReport>;
}

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type ScorePalette = {
  accent: string;
  muted: string;
};

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const SCORE_LOW: Rgb = { r: 214, g: 92, b: 92 };
const SCORE_HIGH: Rgb = { r: 124, g: 182, b: 114 };
const SOFT_NEUTRAL: Rgb = { r: 233, g: 228, b: 216 };

function supportsColor(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) {
    return explicit;
  }

  return Boolean(process.stdout.isTTY && process.env.NO_COLOR !== "1" && process.env.TERM !== "dumb");
}

function clampWidth(width: number | undefined): number {
  const fallback = process.stdout.columns ?? 100;
  return Math.max(68, Math.min(width ?? fallback, 120));
}

function clampRatio(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}

function mixChannel(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio);
}

function mixRgb(start: Rgb, end: Rgb, ratio: number): Rgb {
  return {
    r: mixChannel(start.r, end.r, ratio),
    g: mixChannel(start.g, end.g, ratio),
    b: mixChannel(start.b, end.b, ratio),
  };
}

function rgbToHex(color: Rgb): string {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b
    .toString(16)
    .padStart(2, "0")}`;
}

function getScorePalette(score: number): ScorePalette {
  const accentRgb = mixRgb(SCORE_LOW, SCORE_HIGH, clampRatio(score));
  const mutedRgb = mixRgb(accentRgb, SOFT_NEUTRAL, 0.6);
  return {
    accent: rgbToHex(accentRgb),
    muted: rgbToHex(mutedRgb),
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function trimSentence(text: string): string {
  return text.replace(/\.\s*$/, "");
}

function getOpenChecks(report: ScanReport): CheckResult[] {
  return report.pillars
    .flatMap((pillar) => pillar.checks.filter((check) => check.status === "fail" || check.status === "partial"))
    .sort((left, right) => {
      if (left.awardedWeight !== right.awardedWeight) {
        return left.awardedWeight - right.awardedWeight;
      }

      if (left.weight !== right.weight) {
        return right.weight - left.weight;
      }

      if (left.status !== right.status) {
        return left.status === "fail" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function getOpenAcceleratorChecks(report: ScanReport): AcceleratorCheckResult[] {
  return report.accelerators.checks
    .filter((check) => check.status === "fail" || check.status === "partial")
    .sort((left, right) => {
      if (left.awardedPoints !== right.awardedPoints) {
        return left.awardedPoints - right.awardedPoints;
      }

      if (left.maxPoints !== right.maxPoints) {
        return right.maxPoints - left.maxPoints;
      }

      if (left.status !== right.status) {
        return left.status === "fail" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function getIssueText(check: CheckResult): string {
  const missedPoints = Math.max(1, Math.round(check.weight - check.awardedWeight));
  return `${check.name}. ${ensureSentenceEnds(trimSentence(check.remediation))} (${missedPoints}pt)`;
}

function getAcceleratorIssueText(check: AcceleratorCheckResult): string {
  const missedPoints = Math.max(1, Math.round(check.maxPoints - check.awardedPoints));
  const evidence = check.evidence[0] ? ` (${check.evidence[0]})` : "";
  return `${check.name}. ${ensureSentenceEnds(trimSentence(check.remediation))}${evidence} (${missedPoints}pt)`;
}

function getTitle(): string {
  return "Agent compatibility (heuristic)";
}

function getScoreDescription(score: number): string {
  if (score <= 40) {
    return "File signals look thin; agents may struggle without more repo scaffolding.";
  }

  if (score <= 60) {
    return "Mixed signals from files alone; some basics look present.";
  }

  if (score <= 80) {
    return "Mostly plausible for agents, with several file-signal gaps.";
  }

  return "Looks fairly agent-friendly from what the scan could see.";
}

function buildSummaryLine(
  report: ScanReport,
  openChecks: number,
  affectedPillars: number,
  acceleratorIssues: number,
): string {
  const repoLabel = `${report.ecosystems.length > 0 ? `${report.ecosystems.join("/")} ` : ""}${report.classification.kind} repo`;
  const parts = [repoLabel];

  if (openChecks === 0 && acceleratorIssues === 0) {
    parts.push("no open checks");
  } else {
    if (openChecks > 0) {
      parts.push(`${pluralize(openChecks, "open check")} across ${pluralize(affectedPillars, "pillar")}`);
    } else {
      parts.push("no open rubric checks");
    }

    if (acceleratorIssues > 0) {
      parts.push(`${pluralize(acceleratorIssues, "accelerator issue")}`);
    }
  }

  return parts.join(" / ");
}

function ScoreBox(props: { score: number; width: number; useColor: boolean }): JSX.Element {
  const { score, width, useColor } = props;
  const palette = getScorePalette(score);

  return (
    <Box
      width={width}
      minHeight={5}
      borderStyle="bold"
      borderColor={useColor ? palette.accent : undefined}
      justifyContent="center"
      alignItems="center"
      marginRight={2}
    >
      <Text color={useColor ? palette.accent : undefined} bold>
        {score}
      </Text>
    </Box>
  );
}

function IssueRow(props: { text: string; accentColor: string; useColor: boolean }): JSX.Element {
  const { text, accentColor, useColor } = props;

  return (
    <Box flexDirection="row">
      <Box width={2}>
        <Text color={useColor ? accentColor : undefined} bold>
          -
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text>{text}</Text>
      </Box>
    </Box>
  );
}

function LoadingView(props: { targetPath: string; frame: number; width: number; useColor: boolean }): JSX.Element {
  const { targetPath, frame, width, useColor } = props;
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "-";
  const palette = getScorePalette(55);

  return (
    <Box width={width} flexDirection="column">
      <Text color={useColor ? palette.accent : undefined} bold>
        {spinner} Scanning repository
      </Text>
      <Text dimColor={useColor}>{targetPath}</Text>
    </Box>
  );
}

function ErrorView(props: { message: string; width: number; useColor: boolean }): JSX.Element {
  const { message, width, useColor } = props;
  const palette = getScorePalette(10);

  return (
    <Box width={width} flexDirection="column">
      <Text color={useColor ? palette.accent : undefined} bold>
        Scan failed
      </Text>
      <Text>{message}</Text>
    </Box>
  );
}

function DashboardView(props: { report: ScanReport; options: Required<TuiRenderOptions> }): JSX.Element {
  const { report, options } = props;
  const palette = getScorePalette(report.overallScore);
  const openChecks = getOpenChecks(report);
  const openAcceleratorChecks = getOpenAcceleratorChecks(report);
  const affectedPillars = report.pillars.filter((pillar) =>
    pillar.checks.some((check) => check.status === "fail" || check.status === "partial"),
  ).length;
  const scoreBoxWidth = Math.min(12, Math.max(10, Math.floor(options.width * 0.14)));

  return (
    <Box width={options.width} flexDirection="column">
      <Box flexDirection="row">
        <ScoreBox score={report.overallScore} width={scoreBoxWidth} useColor={options.color} />

        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text color={options.color ? palette.accent : undefined} bold>
            {getTitle()}
          </Text>
          <Text>{getScoreDescription(report.overallScore)}</Text>
          <Text color={options.color ? palette.muted : undefined} dimColor={options.color}>
            {buildSummaryLine(report, openChecks.length, affectedPillars, openAcceleratorChecks.length)}
          </Text>
        </Box>
      </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Open rubric / accelerator cues</Text>
          {openChecks.length === 0 && openAcceleratorChecks.length === 0 ? (
            <Text>No open checks in this pass.</Text>
          ) : (
          <>
            {openChecks.map((check) => (
              <IssueRow key={check.id} text={getIssueText(check)} accentColor={palette.accent} useColor={options.color} />
            ))}
            {openAcceleratorChecks.map((check) => (
              <IssueRow
                key={`accelerator:${check.id}`}
                text={getAcceleratorIssueText(check)}
                accentColor={palette.accent}
                useColor={options.color}
              />
            ))}
          </>
        )}
      </Box>

      {options.verbose ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Pillars</Text>
          {report.pillars.map((pillar) => (
            <Text key={pillar.id}>
              - {pillar.name} · {pillar.applicableWeight === 0 ? "n/a" : `${pillar.score}/100`}
            </Text>
          ))}

          <Text>{`Agent bonus: ${report.accelerators.bonusPoints}/${report.accelerators.maxBonusPoints}`}</Text>

          {report.warnings.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Warnings</Text>
              {report.warnings.map((warning) => (
                <Text key={warning}>- {warning}</Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function LoadingSpinnerApp(props: { targetPath: string; width: number; useColor: boolean }): JSX.Element {
  const { targetPath, width, useColor } = props;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const spinnerTimer = setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(spinnerTimer);
  }, []);

  return <LoadingView targetPath={targetPath} frame={frame} width={width} useColor={useColor} />;
}

export function renderTuiReport(report: ScanReport, options: TuiRenderOptions = {}): string {
  const normalizedOptions: Required<TuiRenderOptions> = {
    color: supportsColor(options.color),
    verbose: Boolean(options.verbose),
    width: clampWidth(options.width),
  };

  return renderToString(<DashboardView report={report} options={normalizedOptions} />, {
    columns: normalizedOptions.width,
  });
}

export async function runTuiSession(options: TuiSessionOptions): Promise<void> {
  const normalizedOptions: Required<TuiRenderOptions> = {
    color: supportsColor(options.color),
    verbose: Boolean(options.verbose),
    width: clampWidth(options.width),
  };

  const app = render(
    <LoadingSpinnerApp targetPath={options.targetPath} width={normalizedOptions.width} useColor={normalizedOptions.color} />,
    {
      patchConsole: false,
      exitOnCtrlC: true,
    },
  );

  try {
    const report = await options.loadReport();
    app.clear();
    app.unmount();
    await app.waitUntilExit();
    process.stdout.write(`${renderTuiReport(report, normalizedOptions)}\n`);
  } catch (error) {
    app.clear();
    app.unmount();
    await app.waitUntilExit();
    throw error;
  }
}
