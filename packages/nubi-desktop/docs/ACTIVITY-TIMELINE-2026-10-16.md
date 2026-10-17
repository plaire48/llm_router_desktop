# Activity timeline and progress motion

- Provider work notes are inserted between host trace events using recorded timestamps. Tool receipt order remains unchanged. Untimed legacy notes remain at the end.
- On completion, notes and consulted sources are retained inside one collapsed activity record. Pending approvals remain actionable outside it; failure/cancellation is never inferred as success.
- Sources remain accessible during paused/failed runs and in legacy tasks without a run ID. Task-level source lists are not assigned to historical runs without provenance.
- Activity, memo, sources and executed-command summaries share icon width, gap and start line. Plain progress text uses the same text inset.
- Indeterminate wiki/task, preparation and project/Git progress bars travel left to right only, restart at the left, and never reverse. Determinate percentages remain host-reported. Reduced motion keeps a stationary segment.

## Validation

- 10 activity/conversation ordering unit tests passed.
- check-activity-layout: chronological notes, completed consolidation, paused evidence access, aligned icon/text coordinates, 1280/440/360px, browser-sampled one-way animation passed.
- check-progress-display: setting persistence, preserved answer, visible questions/approvals/errors/applied diffs with progress hidden passed.
- Visual evidence: verification/activity-layout-2026-10-16/review.html and result.json.
- Synthetic browser checks and local Electron bundle only. Windows runtime and company authentication not exercised.
