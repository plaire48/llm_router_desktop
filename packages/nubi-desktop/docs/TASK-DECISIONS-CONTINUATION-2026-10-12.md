# Request-directed work and compact decisions

## Problems and changes

The capability instruction previously started every new task with discovery. Setup proposals required at least one observed file even for a self-contained host/version command. These conditions encouraged unnecessary reading. The runtime already permitted tool-free answers; its guidance now explicitly chooses that route when the supplied context is sufficient. Tool-based plans still precede project operations, but pending steps can be revised or removed instead of pretending an unnecessary read was completed.

`references` is still required in a setup proposal, but may be empty for a command independent of project files. Commands derived from scripts/configuration must name the observed dependencies; existing hash, scope, stale-source and applied-proposal checks remain for every supplied reference. An empty reference list grants no execution authority. Exact command, workspace, effects and the user's approval remain mandatory.

`processFinished` previously resumed the agent after successful commands only when a setup/repair ID existed. A successful direct task command therefore had no result-analysis callback. Every completed task-bound command with `autoDiagnose` enabled now queues its actual receipt for the agent. Failure handling is preserved. Detached manual terminals, explicit opt-out, cancellation and uncertain operations do not auto-resume or replay. The setting now reads `실행 후 AI가 결과 확인` to describe both success and failure.

The agent evaluates actual output against the original request and proposes a next operation when needed. One approval is one command, not a maximum of one command per task. Exit zero is neither application readiness nor evidence that every requested outcome is complete. The existing independent final review remains.

## Decision presentation

- Waiting questions, setup execution approvals and command repairs use a compact in-app dialog. The existing QuestionForm, TerminalBlock, ApprovalBar and CX modal lifecycle are reused.
- A shared owner allows one auto-opened decision at a time. Other active dialogs and background documents retain focus. Only the active conversation renders its decisions.
- Closing postpones a decision; it never submits, approves or rejects it. The transcript keeps a one-line entry to reopen it. Existing question draft storage is reused. Submission disables closing until the response resolves.
- Command approvals show exact command, shell, workspace, purpose, expected effects and applicable privilege warning. Administrator execution still requires separate host consent and Windows UAC. File-change comparison/apply surfaces keep their existing behavior.
- `실행 후 확인 방법` is removed from the visible card. The verification field remains in the host record, delivered to the result-analysis model. Executed commands become compact status rows with output access and an optional command detail disclosure.
- Choice labels and descriptions align on one row. Meaningful questions, effects and commands remain readable rather than truncated to hide approval scope. Narrow dialogs scroll internally and preserve actions.

## Method and reuse

[Anthropic's agent design guidance](https://www.anthropic.com/engineering/building-effective-agents) supports choosing the simplest sufficient path and using actual tool results to decide the next action. This change adapts those design principles to the existing Pi loop, rather than introducing another agent framework. No automatic approval or arbitrary model-declared success is added.

The [WAI-ARIA modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) informs focus containment, Escape and return to the invoking control. Existing CX implements this lifecycle; an OS message box would not accommodate source/command inspection and retained question drafts. Desktop remains cross-platform.

## Verification boundaries

- `agent-task-continuation.test.mjs`: tool-free answer without discovery/plan; successful direct shell output delivered to the agent; two sequential approved commands with actual output review and no unrelated source/Wiki reads. Real temporary projects and local shell, controlled model responses.
- Setup, recovery, submission and planning regression: 38 passing checks, including stale source, duplicate approval, cancellation, planning recovery and local comparison. The first sandbox run could not bind the local comparison server; the same suite passed with local execution permission.
- `check-decision-flow.mjs`: question and command dialog at 1280/440/360 px, no implicit action, one visible decision, viewport bounds, Escape, reopening, focus return and retained draft. Screenshots use clearly synthetic fixture data.
- Shared UI and local Electron agent checks are recorded under `verification/task-flow-*.log`.
- These tests do not establish real AI Pro planning quality, a Windows installer update, native UAC success or live company-account behavior.

Final verification: the shared UI script completed successfully, including dependent file/command approval and separate administrator consent. The local Electron agent script passed all 10 flows, including a real file application, result verification, controlled provider failure/recovery and answering a question in the new dialog. Final Electron build, design identity and diff checks passed. Screenshot review confirmed compact terminal layout and one-line approval buttons at 360 px.
