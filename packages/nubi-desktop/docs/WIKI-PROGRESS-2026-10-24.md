# Wiki generation progress

The project Wiki now shows four checkpoints: read sources, organize the plan,
write and review pages, and verify saved output. The project card, initialization
details, update card and compact footer queue reuse one interpretation of the
existing host observations. No additional runner, model request or polling loop
was introduced.

Progress uses completed/total observations, never the current page index or a
stale percentage. Reading and publication count files; generation and review
count documents. The label shows the current stage, completed quantity and
remaining quantity/percentage. A full writing counter still waits for review
and verified publication. Unknown plans have no numeric percentage. The runner
can extend a plan or enter another scope round, so these values and throughput
estimates describe the current stage, not a fabricated overall time estimate.

The existing observed-throughput estimator is reused and resets on stage,
snapshot step, scope round or total changes. The queue remains one line per job,
three rows by default, maximum 360 px, without an icon count badge or scrollbar.
Completed current-project Wikis have a direct footer action. Queue history opens
the same Wiki screen; changing projects clears the former project's live action.
Completion does not navigate automatically or replay generation. Existing
notification, draft, approval, cancellation and resume contracts are preserved.
Initialization details also expose an open action for verified partial output.

Partial initialization publication previously retained the generation counters
while its stage changed to publication. It now resets to the actual output-file
denominator and increments only after each publisher readback. Partial output
remains `partial`, preserving the checkpoint and protecting human edits.

The existing OpenWiki progress events and durable publisher were reused. No new
dependency or approximate stage weights were needed. Common CX typography,
semantic colors, the shared six-pixel bar and reduced-motion policies remain in
use. Retired three-step journey styling was removed.

Validation for this change:

- Focused Node tests cover quantities, unknown work, false completion, ETA phase
  reset, initialization, partial publication, protected human edits, notification,
  admission and update resume.
- `check-project-preparation-ui.mjs` uses the production Workbench, Wiki screen,
  footer and queue with synthetic services. It covers four stages, stage-specific
  percentages, no premature completion, scope selection, preserved input/focus,
  direct Wiki entry, queue history and narrow/enlarged-text/reduced-motion scenes.
- `check-background-tasks-electron.mjs` additionally checks the built macOS
  renderer with scripted progress IPC and a temporary Wiki file. The production
  footer action enters the actual Wiki library and reads its file inventory.
- Shared progress and background-task UI regressions, renderer build, source
  input and upload safety checks remain required. The new browser flow is added
  to the existing sequential Electron gate without removing earlier gates.

These checks do not measure real-model accuracy or completion time and do not
verify a Windows device, company account, installer or deployed binary.

## Mascot chat guidance follow-up

While the current project's Wiki blocks chat, the working bird says
“위키 작성이 끝나면 이 프로젝트에서 대화할 수 있어요.” in a shared-token speech
bubble. Both new-conversation and follow-up composer forms are hidden with their
tools, rather than displaying the notice inside a disabled textbox. The forms
remain mounted so the draft, selected command and parent-held evidence survive.
Host admission guards, real progress, scope selection, stop and saved history
are unchanged. Only the existing host lock release restores the composer; a
writing-stage 100 percent does not unlock it or submit a draft.

Validation: 24 related unit checks and 14 actual Workbench/Chrome flow checks
passed. The latter cover hidden entry and follow-up forms, the bird's notice,
preserved drafts/history, actual completed-state re-entry, no automatic submit,
wide/narrow windows, enlarged text and reduced motion. The provider and Wiki
states are fixtures. Windows, a real model and installer acceptance remain
separate. Screenshots/readback are in
`verification/project-preparation-2026-10-23/` from the updated harness.
