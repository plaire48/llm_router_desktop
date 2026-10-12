# Immediate chat delivery feedback

The composer used to wait for task creation and agent admission before clearing the draft or leaving the welcome screen. Slow storage, source preparation or provider admission therefore looked like a frozen interface.

## Applied behavior

- First Send creates a local outgoing bubble and clears the submitted draft in the same React update. The composer moves into the conversation with a 180 ms transform transition. Reduced-motion preference disables that transition.
- Sending, starting and confirmed runtime activity are distinct. Only actual runtime state supplies the plan, tool activity and completion; no synthetic processing steps or percentages are generated.
- New text and mail references typed during task creation move to the newly admitted task. Existing conversation and queued steering requests also show feedback before the host returns.
- Outgoing text and source references remain in window session storage when delivery is uncertain. Unknown outcomes are not automatically replayed. A newer draft is kept separately. Actual echoed messages and inbox receipts reconcile temporary feedback.
- Late responses do not select a conversation the user has left. Project changes prevent a newly created task from being started against the new project. Status refreshes share the existing polling cycle.
- The account entry uses the common GitHub icon and `로그인` while disconnected. Connected GHES accounts retain their avatar and display name. The existing internal SSO authentication flow is unchanged.

- Pinned sidebar conversations replace the leading message icon with the existing pin icon, in the same 16 px slot. Pin persistence and ordering use the existing store.

## Method choice

Use immediate local delivery feedback plus authoritative host reconciliation, and the browser's existing Web Animations API. No new state/animation dependency is needed. Retain existing input IDs for queued requests and the definite `agent_busy` fallback. Network uncertainty does not authorize resending a command.

## Evidence

- `scripts/check-chat-send.mjs`: actual Workbench rendered with held create/start/queue promises, at 1280, 440 and 360 px, including reduced motion. Checks message visibility before receipt, next-draft handoff, stable composer placement after task admission, uncertain error and renderer reload recovery. Provider responses are controlled fixtures.
- `tests/submit-task-message.test.mjs` and `tests/agent-input.test.mjs`: 11 passing tests for admission, queue idempotency and execution-result review.
- `scripts/check-electron-agent.mjs`: 10 local Electron flows passed with a fixture model, including proposal, approval, result verification, server failure/recovery and questions.
- Local Electron build and design checks passed. This does not verify a Windows installer or a real AI Pro/GHES account.

## Composer shortcuts and consistent controls

- `/` opens the command list above the composer at the same width, clamped to the viewport. Each row aligns its icon, name, short description and shortcut on one line. Existing keyboard selection and IME handling remain. Real registered `.nubi/skill` entries are included; verification-only skills are not product defaults. The built-in command screenshot explicitly uses an empty fixture skill catalog.
- `/mail` limits retrieval to collected personal mail and its Personal OpenWiki notes. `/code` limits retrieval to current project Code Wiki and source files. The host filters advertised tools, capability discovery and tool selection, and rejects cross-scope execution at dispatch. A plain follow-up retains the active search scope. This is retrieval scope, not deletion or isolation of prior conversation history.
- Shared CX selects retain keyboard/portal behavior while the menu width follows the field instead of the old 420 px cap. Narrow viewports clamp the menu to visible bounds.
- Clicking the original visible modal opener again uses the existing close action, preserving busy guards and focus return. Other backdrop clicks remain blocked. Portal registration observes direct body children rather than streaming message mutations.
- Open conversation action menus retain pointer events when the pointer leaves the row for the floating menu. Pinning uses the existing persistent state.

### Additional verification

- `tests/search-command-scope.test.mjs` uses an actual ProjectService and controlled model calls to verify cross-scope dispatch rejection and allowed source reads. Together with send and queue tests: 14 passing checks. No real mail server or provider response is represented by these fixtures.
- `scripts/check-interaction-controls.mjs` checks 1280/440/360 px field/menu edges, same-opener toggles and focus return, one-line command rows and keyboard choice, and persistent pin display.
- Reuse existing React, CX portals/selects and native popovers. No new UI or retrieval dependency is required.

- Final verification: `check-modals.mjs` reported 40 passing UI checks and no page errors, including nested dialog return, focus, normal/large text, model loading and command analysis. The interaction check passed all three widths and pin activation. Electron build, identity check and 14 scoped runtime/send tests passed. UI inputs were controlled fixtures, not live mail/GHES/provider sessions.
