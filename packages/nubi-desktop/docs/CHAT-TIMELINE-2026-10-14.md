# Conversation timeline readability

User reference: Codex conversation screenshot, 2026-10-14.

The conversation now presents public progress notes and tool records in their actual event order. Adjacent ordinary tool events are grouped behind a single-line disclosure. Notes remain readable paragraphs with the existing Nubi fonts, colors and emphasis. No simulated progress or inferred success is added.

- One elapsed heading per active run; duplicate toolbar elapsed badge removed when the run has a conversation record.
- Plan details remain available through a collapsed row. Expected outcomes and original step states are retained.
- Errors, unanswered questions, cancellations and deferred operations are not merged into ordinary tool groups. Attention details open automatically.
- The whole journal folds when an answer is delivered and can be reopened. Original event data is unchanged.
- Provider-supplied model notes remain available separately on demand. Public updates use existing progress_note events, not generated reasoning.
- Existing in-chat approval/question forms, command receipts, source links and answer review contracts are unchanged.
- Current activity is shown once; an idle indicator appears only between tool calls.
- Existing scene motion remains. Reduced-motion handling also applies to the new disclosure chevron.

## Validation

- `node --test tests/activity-timeline.test.mjs tests/conversation-activity.test.mjs`: 5 passed.
- `node scripts/check-activity-readability.mjs`: 1280, 440 and 360 px. Checks chronology, timer count, disclosure alignment, retained plan criteria, terminal copy, automatic error expansion, completed journal folding, absence of horizontal overflow, final command output and shared polling. Synthetic host data.
- `node scripts/check-chat-send.mjs`: all three widths. Delayed create/start/queue, immediate message display, stable composer, draft handoff, uncertain failure and reload recovery. No live model call.
- `node scripts/check-identity.mjs`: passed.
- `npm run build:electron`: passed.
- Screenshots: `verification/activity-readability/running-{1280,440,360}.png`, `attention-*`, `completed-*`.

The earlier performance changes and their measured scope are recorded in `PERFORMANCE-2026-10-14.md`. Full unit tests passed before this presentation change (1249 total, 1053 passed, 196 skipped). The focused tests above cover this subsequent change. Neither fixture rendering nor a local Electron build measures real model answer accuracy, company SSO or Windows installation quality. No release was published.
