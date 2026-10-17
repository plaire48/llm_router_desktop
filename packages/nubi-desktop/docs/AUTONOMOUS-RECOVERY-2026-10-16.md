# Autonomous recovery — 2026-10-16

## Problem and change

Commands already resumed the agent after completion or failure. The screen nevertheless kept a manual “오류 분석” card even after that review. A recoverable read/tool refusal could also be followed by an error-only answer. Three identical failures triggered a generic user question before an alternative method was attempted.

The Desktop host now keeps a small run-local recovery ledger. Correctable refusals and read failures receive targeted feedback. The third identical failed call is refused before backend dispatch. Pi can grant one alternative-method turn for that call, at most twice per run. An answer that stops immediately at an unresolved recoverable failure receives up to two continuation prompts within the existing model/time budget. A successful alternate read or corrected proposal clears this nudge, but does not establish task completion; the existing independent review remains responsible for evaluating the answer and host receipts.

The shared Pi runner adds only an opt-in `recoverToolStall` callback. Existing browser hosts retain their previous behavior. The callback does not execute a tool, erase failures, or authorize an operation.

Automatic command recovery now shows the shared loading indicator instead of a disabled manual diagnosis button. Once the agent delivered its review or is waiting for a concrete approval/question, the obsolete failure card disappears. If recovery is actually paused, “이어서 해결” resumes from stored results; a missing connection offers “AI 연결”.

## Boundaries

- Permission/scope refusals, cancellation and uncertain execution are not automatically retried.
- An issued command is not replayed to recover output. The existing result-read, corrected-command proposal and exact approval contracts remain in force.
- Metadata-only calls do not resolve failures. Changing a method does not prove success.
- Recovery is bounded. Repeating an unchanged failure after the alternative opportunity still reaches the existing stop/question boundary.
- Budget exhaustion, pending user input, approvals, computer connection requests and review-only recovery take precedence.

## Methodology

Reused the existing Pi loop, host receipts, structured error guidance and independent review rather than introducing another agent runtime. Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) describes adjusting actions using observed tool/environment results with explicit stopping conditions. [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) supports actionable tool feedback and focused evaluations. Applied these patterns through concrete recovery control and failure-injection tests; no claim is made that another product's internal harness was copied.

## Evidence

- Desktop recovery/harness/review checks: 54 unique cases passed (53-case run plus the added bounded-stall case, with all 8 new cases rerun).
- Desktop compaction, review and workspace harness regressions: 48 passed.
- Shared runner, browser recovery, model stall and review recovery: 72 passed.
- UI: 12 cases at 1000px/360px, including pending, active, finished, human input, paused and disconnected states. Production components with fixture state.
- Electron build passed.
- The tool-loop fixtures prove missing-file failure → rejected error-only answer → alternate file read → answer, and repeated search failure → blocked duplicate → direct read → answer. Existing Bash tests cover actual local process failure, approved correction, result verification and no duplicate command execution.

These are deterministic model fixtures and local Mac/browser checks. They do not measure AI Pro/Claude/ChatGPT live-model recovery success or Windows/SSO behavior. No release was created.
