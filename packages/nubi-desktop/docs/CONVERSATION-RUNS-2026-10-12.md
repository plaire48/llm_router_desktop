# Conversation execution and feedback — 2026-10-12

## User decisions

- Keep message time and copy adjacent in a single row, including narrow layouts.
- Redo replaces the last visible answer and runs the latest request again with tools, planning and review. It must not append an alternative paraphrase or copy text to the composer.
- Show elapsed time while dispatching a run. The former Start/Continue control incorrectly inherited the shared `undo` label (“복원”). Explicit labels now preserve the intended action.
- Allow concurrent conversations in the current project.

## Implementation and boundaries

`task-agent-scope.mjs` supplies each conversation with its own agent state through a task-bound service view. The store, processes, provider and host mutation locks remain shared. Global callers see any running agent, so switching the project or provider remains guarded. Each task gets its own run ID, abort controller, streaming/steering state and timer. Disposal aborts all controllers.

`regenerateAnswer` archives the superseded answer separately, removes it from the visible transcript and starts the ordinary agent without duplicating the user's request. Prior operation receipts remain in the prompt; redo explicitly requires current observations and preserves approval and fingerprint checks. Failure before execution restores the prior answer. Once execution begins, ordinary pause/cancel/recovery contracts apply. No new runtime library was introduced: reuse the existing Pi execution, local records and approval boundary.

Git empty results use the existing AgentMark asset, concise text and common tokens. They appear only after a successful empty read. Loading, failures and retry remain distinct. Zero-file/zero-line counters are omitted for empty commits.

## Validation

- Real local host regression: overlapping inference in two tasks, per-task clocks, targeted cancellation, queue/run binding, provider guard, disposal of both runs, fresh source read during redo, single replacement answer, archived original and preserved command receipt, preflight rollback.
- Real browser rendering with synthetic provider responses: timestamp/copy alignment, redo, launch progress and unlocked input while another conversation runs. Separate from live provider quality.
- The existing transport-retry fixture used a 32K window. Both scoped and unscoped runs entered the independently tested context-compaction path after an upstream failure, but this fixture supplied plain replies to structured-summary requests and paused. This transport-only fixture now uses a 128K window and asserts two transient failures, one source read, completed receipt and preserved criteria. Small-window compaction remains covered by its separate tests.
- No Windows installer or live corporate account validation is claimed. Concurrent conversations currently share one project and the selected provider/model. Project switching and provider changes remain gated during execution.
