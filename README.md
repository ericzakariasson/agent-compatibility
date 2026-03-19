# Agent Compatibility CLI

Measure how compatible a codebase is with autonomous agents.

The CLI scans a local repository with deterministic file signals, estimates a `1-100` compatibility score, breaks it down by pillar, and lists **suggested** next steps (heuristic, not a quality verdict).

It now separates:

- a `base` compatibility score from the vendor-neutral repo rubric
- a separate `accelerator` layer for committed agent tooling such as `.cursor`, `.claude`, and curated MCP alignment

## What it scores

- Style & Validation
- Build & Tasks
- Testing
- Documentation
- Dev Environment
- Code Quality
- Observability
- Security & Governance

Each rule returns `pass`, `partial`, `fail`, or `not_applicable`. Partial rules get half credit. `not_applicable` rules are removed from the denominator.

Coverage reporting is weighted lightly and ranked lower in “top fixes” than security, supply-chain, and CI fundamentals. Tests and runnable suites still matter; line coverage is treated as an optional visibility signal, not a core gate.

**Dependency locking** treats any tracked file whose basename matches the curated list in `src/config/lockfileNames.ts` as a lock/pin signal (npm, pnpm, Yarn, Bun, Deno, Python stacks, Rust, Go, Ruby, PHP, .NET, Swift, Dart, Haskell, Nix, Terraform, Helm, Bazel, Conan, DVC, Spack, Homebrew bundle, and others — 50+ basenames, normalized case-insensitively).

## Agent accelerators

The accelerator layer is reported separately. It does not replace or inflate the main compatibility rubric.

Current bonus signals include:

- `AGENTS.md`
- `.cursor/rules`, `.cursor/skills`, `.cursor/agents`
- `.cursor/mcp.json`
- `.claude/agents`, `.claude/commands`
- a curated dependency-to-MCP match for a few obvious cases such as database or browser tooling

Missing accelerator signals are treated as missed opportunities, not as core compatibility failures.

The Claude-specific accelerator is skipped entirely (no score impact, not listed) unless the repo already has files under `.claude/`.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Usage

```bash
npx -y agent-compatibility@latest
```

By default, running the package with no arguments scans the current directory. The default output is an Ink-powered terminal dashboard built with React.

```bash
npx -y agent-compatibility@latest /path/to/repo
```

You can still use the explicit `scan` subcommand if you prefer:

```bash
npx -y agent-compatibility@latest scan /path/to/repo
```

Render the classic plain-text report:

```bash
npx -y agent-compatibility@latest /path/to/repo --text
```

Render an agent-optimized Markdown report:

```bash
npx -y agent-compatibility@latest /path/to/repo --md
```

Print JSON instead of the terminal report:

```bash
npx -y agent-compatibility@latest /path/to/repo --json
```

Show CLI help:

```bash
npx -y agent-compatibility@latest --help
```

## Config

You can override ignored paths or individual rule weights with a JSON config file:

```json
{
  "ignoredPaths": ["generated", "vendor/tmp"],
  "weights": {
    "readmePresent": 1,
    "ciWorkflowPresent": 5
  }
}
```

Run with:

```bash
npx -y agent-compatibility@latest /path/to/repo --config ./agent-compatibility.config.json
```

Weight overrides are keyed by check id, not by pillar name. The same mechanism also works for accelerator ids like `cursorMcpConfigured`.

## Development

Run the test suite:

```bash
npm test
```
