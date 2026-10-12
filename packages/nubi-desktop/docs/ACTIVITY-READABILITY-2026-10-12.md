# Conversation activity readability — 2026-10-12

## Intent

Use comfortable information density and progressive disclosure with the existing Nubi/CX tokens. Codex/Claude are interaction references, not copied interfaces. No new density setting or package is required. Keep the task, real progress and action-needed state readable before opening supporting records.

## Changes

- Activity summary names the real current operation and places elapsed time on the same row. A shared 18 px icon column, 8 px gap and body typography align progress, plan and analysis rows. Full labels remain available through the summary tooltip and records.
- The plan is one summary row. Opening it retains all steps, expected outcomes, changes and the next plan. The repeated current-tool subtitle is omitted from the step list but retained in step details.
- Normal operation records start collapsed. Completed response transitions collapse them; a newly occurring error/waiting state opens the record. All retained reads and public progress notes remain available, with scroll and keyboard controls. Repeated running/done suffixes are screen-reader-only; failures, recovery and approvals retain their visible status.
- Subagent work retains its assigned task and delivery status on the main screen. Repeated group headings and counts are removed. Result, sources and call/read counts share one disclosure. Incomplete, interrupted, failed and cancelled groups retain visible state, uncertainties and next steps.
- Execution output uses the shared light surface, text tokens and one border. Decorative window dots, large shadow and dark normal-status pill are removed in conversation execution/approval blocks. Exact command, output, destination, exit status, stop and approval controls remain intact.
- Shared browser components take opt-in Desktop display props; extension defaults remain unchanged. No runner, provider, tool permissions or verification outcome is changed by the presentation.

## Validation boundary

Local Workbench fixtures use real React components and synthetic host events. They verify 1280/440/360 px alignment, one-row summary/time, retained steps and expected outcomes, worker result disclosure, visible failures and terminal output. Runtime regression and shared workflow results are recorded under verification/activity-readability-*.log. These are not real AI-quality measurements or Windows installation validation.

## Results

- 33 targeted plan/analysis-state regressions passed.
- Desktop identity and Electron source build passed.
- Shared Workbench UI workflow suite passed with no page errors. The old single-active-conversation assertions were updated to the already approved independent conversation execution contract. Computer-use-disabled cases retain their explicit skip labels.
- Real Electron app with an isolated project and scripted model passed 10 workflow checks: source read and proposal, explicit apply and Git readback, automatic progress collapse, model-failure recovery and question/answer continuation. This is local Electron evidence, not real provider or Windows evidence.
- The narrow-screen activity check verifies 1280/440/360 px. No Windows installer, upload or deployment was performed.

## Progress icon alignment follow-up

- Root cause: Desktop's unitless `--deck-line-body: 1.6` was used as a CSS height, invalidating the icon slot height. Inline progress labels also inherited the larger answer typography, so checking only element top positions missed the visible mismatch.
- Use a length computed from the shared line-height ratio for icon slots, and inherit UI row typography for progress Markdown. Align note icons to the first text line without translating or disrupting spinner animations.
- Verified rendered SVG/spinner centers against the first text line and equal inline/row font sizes at 1280, 440 and 360px. Existing disclosure, full trace records and automatic error expansion checks passed. Screenshots: `verification/activity-readability/aligned-rows-*.png` and `attention-*.png`.
- This is an Electron Workbench renderer check using synthetic events, not a Windows installed-build or live-provider verification.
