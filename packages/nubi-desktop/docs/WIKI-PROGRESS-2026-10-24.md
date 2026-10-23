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
