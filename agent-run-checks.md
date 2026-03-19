# agent-run checks to consider

This repo already has a solid deterministic layer. It answers questions like:

- Is there a test command?
- Is there a startup script?
- Is there a README?
- Is there CI?

That is useful, but it only tells us that a signal exists. It does not tell us whether an agent can actually use that signal to get work done.

I think the next layer should be "agent-run" checks. These are checks where the tool has to actually try something, make a choice, and interpret the result.

## what belongs in this bucket

A check probably belongs here if passing it requires at least one of these:

- running commands, not just finding them
- choosing between several plausible paths
- dealing with stale or incomplete docs
- recovering from a small failure
- deciding whether output is actionable or just noise

That is the real difference.

The deterministic layer asks, "Does the repo expose a path?"

The agent-run layer asks, "Can an agent actually follow that path?"

## the strongest first candidates

These are the ones I would start with. They map cleanly to checks we already have, and they get at the part that static rules miss.

| proposed id | question | why a static check is not enough | simple scoring idea |
| --- | --- | --- | --- |
| `startupPathActuallyWorks` | Can an agent get the main surface running from repo root? | A repo can have `README`, `dev`, or `start` scripts and still be hard to boot. | Pass if the agent reaches a working local run path inside a fixed budget. Partial if it works after one recovery step. Fail if it stays blocked or too ambiguous. |
| `selfValidationLoopWorks` | After a small change, can the agent find a useful way to validate it? | A repo can have `test` or `lint` scripts that are too broad, broken, or not tied to the change. | Pass if the agent finds a credible validation loop and gets actionable output. Partial if only a heavy full-suite path exists. Fail if there is no practical loop. |
| `docsMatchReality` | Do setup and run docs match what actually happens? | Static checks can see docs exist, but not whether they are right. | Pass if docs lead directly to success. Partial if the agent can recover from drift. Fail if docs mislead or omit key steps. |
| `bootstrapFriction` | How many hidden prerequisites show up before first success? | Hidden system deps, local services, or missing env assumptions are not obvious from file presence alone. | Pass if bootstrap is smooth. Partial if there are one or two recoverable blockers. Fail if the path depends on too much tacit knowledge. |
| `targetedVerificationPath` | Can the agent verify a narrow change without running the whole world? | A repo may technically be testable but still have no good inner loop. | Pass if the agent can choose a scoped test, lint, or typecheck path. Partial if only a repo-wide check exists. Fail if verification is unclear or impractical. |
| `errorRecoveryPath` | When a command fails, does the repo give the agent enough signal to recover? | The presence of logs or docs does not mean failures are understandable. | Pass if failures point to a clear next step. Partial if the agent can recover with some digging. Fail if errors are mostly dead ends. |

## the two you already called out

These should probably be first.

### 1. `startupPathActuallyWorks`

This is the behavioral version of:

- `installPathDeclared`
- `setupInstructions`
- `oneCommandStartupPath`

Those deterministic checks tell us that a startup path appears to exist.

This agent-run check would answer whether that path actually works for an agent starting fresh.

What the agent would do:

1. Start at repo root with no prior repo-specific knowledge.
2. Read the obvious surfaces first: `README`, manifest files, scripts, toolchain files.
3. Pick the most likely bootstrap and startup path.
4. Try to get the main surface running inside a fixed time budget.

What makes this an agent check:

- The agent has to choose between options.
- The docs may be incomplete.
- The right command might be implied, not stated.
- Success may require a small amount of recovery.

What we would score:

- `pass`: the agent gets the project running cleanly
- `partial`: the agent gets it running, but only after one or two non-obvious fixes
- `fail`: it cannot get to first success inside the budget
- `blocked`: the repo needs secrets, accounts, paid services, or infrastructure we do not have

`blocked` is worth keeping separate from `fail`. Otherwise we will punish repos for constraints that are real but outside the tool's reach.

### 2. `selfValidationLoopWorks`

This is the behavioral version of:

- `testCommandDiscoverable`
- `validateCommandDiscoverable`
- `testsRunnableFromRepo`
- `runAndValidateInstructions`

The interesting question is not "Does the repo have a test command?"

It is "If an agent changes something small, can it figure out how to check its own work without guessing?"

What the agent would do:

1. Identify a small, safe, disposable change in a temp copy of the repo.
2. Infer the smallest useful validation loop for that change.
3. Run that loop.
4. Judge whether the result is actually useful.

This matters because a repo can have:

- a `test` script that takes twenty minutes
- a `lint` script that does not cover the changed area
- a `check` command that fails for unrelated reasons
- output that is technically present but not actionable

What we would score:

- `pass`: the agent finds a sensible validation path and the output is specific enough to drive the next step
- `partial`: validation exists, but only through a blunt or noisy full-repo path
- `fail`: there is no credible self-check loop
- `blocked`: validation depends on missing secrets, external infra, or a locked-down environment

## other good candidates

These are also interesting, but I would put them after startup and self-validation.

### `docsMatchReality`

This is simple and valuable. A repo can have nice-looking docs that are wrong in small but important ways.

The agent check is not "Are there docs?"

It is "Do the docs survive contact with reality?"

### `bootstrapFriction`

This is slightly different from startup success.

A repo might be startable, but only after the agent discovers:

- the right Node or Python version
- a local database that has to be running first
- an `.env` file with hidden required keys
- OS-level tools that were never mentioned

That kind of friction is one of the main costs in agent work.

### `targetedVerificationPath`

This one matters for cost and iteration speed.

An agent is much more useful when it can validate a local change with:

- one test file
- one package
- one typecheck target
- one smoke path

If every change forces a full repo validation loop, the repo is technically compatible but practically expensive.

### `errorRecoveryPath`

Some repos fail in a way that still helps the next step.

Others fail in a way that just dumps a wall of output with no clear handle.

That difference is hard to capture statically and easy to notice in practice.

## a few harder checks for later

These are real, but I would treat them as a second wave.

### `changeSurfaceClarity`

Question: can an agent quickly find the files that probably need to change for a simple request?

This is not just layout. It is whether names, module boundaries, and entrypoints make the repo legible.

### `runtimeFeedbackQuality`

Question: when the app is running, does it give enough feedback to understand what is happening?

This overlaps with observability, but here the bar is more practical: can an agent tell whether it succeeded, failed, or hit the wrong surface?

### `agentGuidanceActuallyHelps`

Question: if the repo has `AGENTS.md` or `.cursor/rules`, do those assets actually improve task execution?

This is a good fit for the accelerator layer, but it requires real task runs to measure.

## how I would keep this bounded

If we ever implement these, I would keep the harness tight:

- fixed time budget per check
- fixed command budget per check
- no destructive commands
- no network side effects beyond normal install or startup unless explicitly allowed
- run in a temp copy when a check needs a disposable change
- support `blocked` as a first-class result
- record the commands tried, the final status, and a short reason

Without those guardrails, this turns into an open-ended benchmark instead of a product check.

## suggested first implementation order

If we only add two to start, I would pick:

1. `startupPathActuallyWorks`
2. `selfValidationLoopWorks`

If we add four:

1. `startupPathActuallyWorks`
2. `selfValidationLoopWorks`
3. `docsMatchReality`
4. `targetedVerificationPath`

That set would cover the most important real question:

Can an agent get to first success, make a small change, and tell whether it worked?

## one framing choice to decide before code changes

I think we should decide this before touching the implementation:

Should these agent-run checks affect the main compatibility score, or should they be reported as a separate behavioral layer?

My instinct is to keep them separate at first.

The deterministic score is cheap, stable, and easy to compare across repos.

The agent-run score will be slower, noisier, and more sensitive to environment constraints. That is not a reason to avoid it. It just means I would keep it separate until we trust it.
