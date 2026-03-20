import { useEffect, useState, type JSX } from "react";

import { Box, Text, render, renderToString, useApp, useInput } from "ink";

import type { AcceleratorCheckResult, CheckResult, ScanReport } from "../core/types.js";

import { canCopyPromptToClipboard, isCursorInstalled, copyCursorFixPromptToClipboard, launchCursorFixPrompt } from "./cursorDeeplink.js";
import { ensureSentenceEnds } from "./sentences.js";

export interface TuiRenderOptions {
  color?: boolean;
  verbose?: boolean;
  problemLimit?: number;
  showAllProblems?: boolean;
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

type ProblemEntry = {
  id: string;
  text: string;
};

type ProblemMenuAction = "showAll" | "fixWithCursor" | "copyPrompt" | "done";

type ProblemMenuOption = {
  id: ProblemMenuAction;
  label: string;
};

type ProblemMenu = {
  prompt: string;
  options: ProblemMenuOption[];
  selectedIndex: number;
};

type NormalizedTuiOptions = {
  color: boolean;
  verbose: boolean;
  problemLimit: number;
  showAllProblems: boolean;
  width: number;
};

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const DEFAULT_PROBLEM_LIMIT = 5;
const HEADER_GAP = 2;
const ISSUE_PREFIX = "- ";
const ISSUE_CONTINUATION_PREFIX = "  ";
const SCORE_BOX_INNER_WIDTH = 10;
const CURSOR_CTA_COLOR = "#6ee7b7";
const PROBLEM_DEDUPE_KEYS = new Map<string, string>([
  ["contributionOrAgentGuidance", "agents-guidance"],
  ["accelerator:agentGuidanceDocs", "agents-guidance"],
]);
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

function clampProblemLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PROBLEM_LIMIT;
  }

  return Math.max(1, Math.floor(limit));
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

function toSingleSentence(text: string): string {
  const segments = text
    .trim()
    .split(/\.\s+/)
    .map((segment) => trimSentence(segment.trim()))
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return "";
  }

  return ensureSentenceEnds(segments[segments.length - 1] ?? "");
}

function splitLongWord(word: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const segments: string[] = [];

  for (let index = 0; index < word.length; index += safeWidth) {
    segments.push(word.slice(index, index + safeWidth));
  }

  return segments;
}

function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const wordSegments = word.length > safeWidth ? splitLongWord(word, safeWidth) : [word];

    for (const segment of wordSegments) {
      if (currentLine.length === 0) {
        currentLine = segment;
        continue;
      }

      const nextLine = `${currentLine} ${segment}`;
      if (nextLine.length <= safeWidth) {
        currentLine = nextLine;
        continue;
      }

      lines.push(currentLine);
      currentLine = segment;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapWithPrefix(text: string, width: number, firstPrefix: string, continuationPrefix: string): string[] {
  const wrappedLines = wrapText(text, Math.max(1, width - firstPrefix.length));
  return wrappedLines.map((line, index) => `${index === 0 ? firstPrefix : continuationPrefix}${line}`);
}

function centerText(text: string, width: number): string {
  if (text.length >= width) {
    return text.slice(0, width);
  }

  const leftPadding = Math.floor((width - text.length) / 2);
  const rightPadding = width - text.length - leftPadding;
  return `${" ".repeat(leftPadding)}${text}${" ".repeat(rightPadding)}`;
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
  return toSingleSentence(check.remediation);
}

function getAcceleratorIssueText(check: AcceleratorCheckResult): string {
  const evidence = check.evidence[0] ? ` (${check.evidence[0]})` : "";
  return `${toSingleSentence(check.remediation)}${evidence}`;
}

function canonicalProblemText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function getProblemDedupKey(entry: ProblemEntry): string {
  return PROBLEM_DEDUPE_KEYS.get(entry.id) ?? canonicalProblemText(entry.text);
}

export function getProblemMenuOptions(params: {
  totalProblems: number;
  problemLimit: number;
  cursorFixAvailable: boolean;
  copyPromptAvailable: boolean;
}): ProblemMenuOption[] {
  const { totalProblems, problemLimit, cursorFixAvailable, copyPromptAvailable } = params;
  const hasHiddenProblems = totalProblems > problemLimit;
  const options: ProblemMenuOption[] = [];

  if (cursorFixAvailable) {
    options.push({
      id: "fixWithCursor",
      label: "Fix with Cursor",
    });
  }

  if (copyPromptAvailable) {
    options.push({
      id: "copyPrompt",
      label: "Copy prompt to fix",
    });
  }

  if (hasHiddenProblems) {
    options.push({
      id: "showAll",
      label: `Show all ${pluralize(totalProblems, "problem")}`,
    });
  }

  return options;
}

function getProblemEntries(
  openChecks: CheckResult[],
  openAcceleratorChecks: AcceleratorCheckResult[],
): ProblemEntry[] {
  const entries = [
    ...openChecks.map((check) => ({
      id: check.id,
      text: getIssueText(check),
    })),
    ...openAcceleratorChecks.map((check) => ({
      id: `accelerator:${check.id}`,
      text: getAcceleratorIssueText(check),
    })),
  ];

  const dedupedEntries: ProblemEntry[] = [];
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const dedupeKey = getProblemDedupKey(entry);
    if (seenKeys.has(dedupeKey)) {
      continue;
    }

    seenKeys.add(dedupeKey);
    dedupedEntries.push(entry);
  }

  return dedupedEntries;
}

function getTitle(): string {
  return "Agent Compatibility Score";
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

function HeaderView(props: {
  score: number;
  summary: string;
  totalWidth: number;
  accentColor: string;
  mutedColor: string;
  useColor: boolean;
}): JSX.Element {
  const { score, summary, totalWidth, accentColor, mutedColor, useColor } = props;
  const scoreBoxOuterWidth = SCORE_BOX_INNER_WIDTH + 2;
  const rightColumnWidth = Math.max(1, totalWidth - scoreBoxOuterWidth - HEADER_GAP);
  const summaryLines = wrapText(summary, rightColumnWidth);
  const bodyLines = [getTitle(), ...summaryLines];

  while (bodyLines.length < 3) {
    bodyLines.push("");
  }

  const topBorder = `┏${"━".repeat(SCORE_BOX_INNER_WIDTH)}┓`;
  const emptyLine = `┃${" ".repeat(SCORE_BOX_INNER_WIDTH)}┃`;
  const scoreLine = `┃${centerText(String(score), SCORE_BOX_INNER_WIDTH)}┃`;
  const bottomBorder = `┗${"━".repeat(SCORE_BOX_INNER_WIDTH)}┛`;

  return (
    <Box flexDirection="column" width={totalWidth}>
      <Text color={useColor ? accentColor : undefined}>{topBorder}</Text>
      {bodyLines.map((line, index) => (
        <Box key={`${index}:${line}`} flexDirection="row">
          <Text color={useColor ? accentColor : undefined}>{index === 1 ? scoreLine : emptyLine}</Text>
          {line.length > 0 ? (
            <>
              <Text>  </Text>
              <Text
                bold={index === 0}
                color={useColor ? (index === 0 ? accentColor : mutedColor) : undefined}
                dimColor={useColor && index > 0}
              >
                {line}
              </Text>
            </>
          ) : null}
        </Box>
      ))}
      <Text color={useColor ? accentColor : undefined}>{bottomBorder}</Text>
    </Box>
  );
}

function IssueRow(props: { text: string; width: number }): JSX.Element {
  const { text, width } = props;
  const lines = wrapWithPrefix(text, width, ISSUE_PREFIX, ISSUE_CONTINUATION_PREFIX);

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`}>{line}</Text>
      ))}
    </Box>
  );
}

function ProblemMenuView(props: {
  menu: ProblemMenu;
  useColor: boolean;
}): JSX.Element {
  const { menu, useColor } = props;

  return (
    <Box flexDirection="column" marginTop={1}>
      {menu.options.map((option, index) => {
        const isSelected = index === menu.selectedIndex;
        const isCursorCta = option.id === "fixWithCursor";
        return (
          <Text
            key={option.id}
            bold={isSelected || isCursorCta}
            color={useColor && isCursorCta ? CURSOR_CTA_COLOR : undefined}
          >
            {`${isSelected ? ">" : " "} ${option.label}`}
          </Text>
        );
      })}
      <Text dimColor={useColor}>Use Up/Down and Enter. Press q to keep the current report.</Text>
    </Box>
  );
}

function ProblemCountNotice(props: { totalProblems: number; visibleProblems: number; width: number; useColor: boolean }): JSX.Element {
  const { totalProblems, visibleProblems, width, useColor } = props;
  const lines = wrapText(`Showing ${visibleProblems} of ${totalProblems} problems.`, width);

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} dimColor={useColor}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function ProblemListSection(props: {
  problems: ProblemEntry[];
  totalProblems: number;
  width: number;
  useColor: boolean;
  menu?: ProblemMenu;
}): JSX.Element {
  const { problems, totalProblems, width, useColor, menu } = props;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Open rubric / accelerator cues</Text>
      {problems.length === 0 ? (
        <Text>No open checks in this pass.</Text>
      ) : (
        <>
          {problems.map((problem) => (
            <IssueRow key={problem.id} text={problem.text} width={width} />
          ))}
          {totalProblems > problems.length ? (
            <ProblemCountNotice
              totalProblems={totalProblems}
              visibleProblems={problems.length}
              width={width}
              useColor={useColor}
            />
          ) : null}
          {menu ? (
            <ProblemMenuView
              menu={menu}
              useColor={useColor}
            />
          ) : null}
        </>
      )}
    </Box>
  );
}

function VerboseSection(props: { report: ScanReport }): JSX.Element {
  const { report } = props;

  return (
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
  );
}

function DashboardContent(props: {
  report: ScanReport;
  options: NormalizedTuiOptions;
  visibleProblems: ProblemEntry[];
  totalProblems: number;
  summaryLine: string;
  menu?: ProblemMenu;
}): JSX.Element {
  const { report, options, visibleProblems, totalProblems, summaryLine, menu } = props;
  const palette = getScorePalette(report.overallScore);

  return (
    <Box width={options.width} flexDirection="column">
      <HeaderView
        score={report.overallScore}
        summary={summaryLine}
        totalWidth={options.width}
        accentColor={palette.accent}
        mutedColor={palette.muted}
        useColor={options.color}
      />
      <ProblemListSection
        problems={visibleProblems}
        totalProblems={totalProblems}
        width={options.width}
        useColor={options.color}
        menu={menu}
      />
      {options.verbose ? <VerboseSection report={report} /> : null}
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

function DashboardView(props: {
  report: ScanReport;
  options: NormalizedTuiOptions;
  menu?: ProblemMenu;
  showAllProblems?: boolean;
}): JSX.Element {
  const { report, options, menu, showAllProblems = options.showAllProblems } = props;
  const openChecks = getOpenChecks(report);
  const openAcceleratorChecks = getOpenAcceleratorChecks(report);
  const problemEntries = getProblemEntries(openChecks, openAcceleratorChecks);
  const visibleProblems = showAllProblems ? problemEntries : problemEntries.slice(0, options.problemLimit);
  const affectedPillars = report.pillars.filter((pillar) =>
    pillar.checks.some((check) => check.status === "fail" || check.status === "partial"),
  ).length;
  const summaryLine = buildSummaryLine(report, openChecks.length, affectedPillars, openAcceleratorChecks.length);

  return (
    <DashboardContent
      report={report}
      options={options}
      visibleProblems={visibleProblems}
      totalProblems={problemEntries.length}
      summaryLine={summaryLine}
      menu={menu}
    />
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

function ProblemChoiceApp(props: {
  report: ScanReport;
  options: NormalizedTuiOptions;
  cursorFixAvailable: boolean;
  copyPromptAvailable: boolean;
  onComplete: (action: ProblemMenuAction) => void;
}): JSX.Element {
  const { report, options, cursorFixAvailable, copyPromptAvailable, onComplete } = props;
  const { exit } = useApp();
  const totalProblems = getProblemEntries(getOpenChecks(report), getOpenAcceleratorChecks(report)).length;
  const menuOptions = getProblemMenuOptions({
    totalProblems,
    problemLimit: options.problemLimit,
    cursorFixAvailable,
    copyPromptAvailable,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onComplete("done");
      exit();
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((current) => (current - 1 + menuOptions.length) % menuOptions.length);
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex((current) => (current + 1) % menuOptions.length);
      return;
    }

    if (key.return || input === "\r" || input === "\n") {
      const selectedOption = menuOptions[selectedIndex];

      onComplete(selectedOption?.id ?? "done");
      exit();
    }
  });

  return (
    <DashboardView
      report={report}
      options={options}
      menu={{
        prompt: "",
        options: menuOptions,
        selectedIndex,
      }}
    />
  );
}

function normalizeTuiOptions(options: TuiRenderOptions): NormalizedTuiOptions {
  return {
    color: supportsColor(options.color),
    verbose: Boolean(options.verbose),
    problemLimit: clampProblemLimit(options.problemLimit),
    showAllProblems: Boolean(options.showAllProblems),
    width: clampWidth(options.width),
  };
}

export function renderTuiReport(report: ScanReport, options: TuiRenderOptions = {}): string {
  const normalizedOptions = normalizeTuiOptions(options);

  return renderToString(<DashboardView report={report} options={normalizedOptions} />, {
    columns: normalizedOptions.width,
  });
}

export async function runTuiSession(options: TuiSessionOptions): Promise<void> {
  const normalizedOptions = normalizeTuiOptions(options);

  const app = render(
    <LoadingSpinnerApp targetPath={options.targetPath} width={normalizedOptions.width} useColor={normalizedOptions.color} />,
    {
      patchConsole: false,
      exitOnCtrlC: true,
    },
  );

  try {
    const report = await options.loadReport();
    let showAllProblems = normalizedOptions.showAllProblems;
    const selection = { action: "done" as ProblemMenuAction };
    const problemEntries = getProblemEntries(getOpenChecks(report), getOpenAcceleratorChecks(report));
    const cursorFixAvailable = isCursorInstalled();
    const copyPromptAvailable = canCopyPromptToClipboard();
    const menuOptions = getProblemMenuOptions({
      totalProblems: problemEntries.length,
      problemLimit: normalizedOptions.problemLimit,
      cursorFixAvailable,
      copyPromptAvailable,
    });
    const shouldPromptForAction = Boolean(process.stdin.isTTY && !showAllProblems && menuOptions.length > 0);

    app.clear();
    app.unmount();
    await app.waitUntilExit();

    if (shouldPromptForAction) {
      const interactiveApp = render(
        <ProblemChoiceApp
          report={report}
          options={normalizedOptions}
          cursorFixAvailable={cursorFixAvailable}
          copyPromptAvailable={copyPromptAvailable}
          onComplete={(selectedAction) => {
            selection.action = selectedAction;
          }}
        />,
        {
          patchConsole: false,
          exitOnCtrlC: true,
        },
      );
      await interactiveApp.waitUntilExit();
      interactiveApp.clear();
      interactiveApp.unmount();
    }

    showAllProblems = selection.action === "showAll";

    if (selection.action === "fixWithCursor") {
      await launchCursorFixPrompt(problemEntries.map((problem) => problem.text));
    }

    if (selection.action === "copyPrompt") {
      await copyCursorFixPromptToClipboard(problemEntries.map((problem) => problem.text));
    }

    process.stdout.write(`${renderTuiReport(report, { ...normalizedOptions, showAllProblems })}\n`);
  } catch (error) {
    app.clear();
    app.unmount();
    await app.waitUntilExit();
    throw error;
  }
}
