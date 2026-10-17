# Bounded Wiki review and readable progress

## Root cause and change

The independent semantic reviewer previously loaded every cited source before calling the model. A page citing more than 48 files, a source over 80,000 characters, or a combined source payload over 160,000 characters failed with a scope limit. Retrying the same page repeated the same failure.

The reviewer now checks every claim and high-risk page assertion in batches of 12. Long pages use overlapping 48,000-character windows. Source reads return bounded excerpts with offsets; line anchors guide initial reads. Every resource remains discoverable. A quote is valid only if it appeared in an excerpt actually delivered to the reviewer. Full-file hashes still detect concurrent changes. Missing or uncertain coverage does not become a successful review.

This reuses the existing model tools, exact quote validation and durable page queue. It adds no dependency or automatic execution. Completed pages retain the existing resume behavior; individual review batches are not persisted checkpoints.

## UI behavior

Rebuild, update and resume reserve the project composer before asynchronous source preparation. The existing inline progress replaces the settings popup, preserves the draft, and releases the composer after completion. Navigating to another project remains possible. Late snapshots cannot replace another project's state.

Progress separates the stage and percentage from counts and elapsed time. Shared body/caption tokens, tabular numbers and aligned icons match surrounding controls. Terminal execution records start collapsed and mount their saved output only when expanded; pending command approvals stay visible.

## Evidence

- Desktop full regression: 1,390 passed, zero failed, 196 skipped (1,586 total). Skipped checks remain disabled feature boundaries, not passes.
- OpenWiki semantic review, repository runner and generation run: 124 tests passed. Includes 60 cited files, a large source read by offset, full-page window coverage, missing coverage and source changes. TypeScript check passed.
- Same two fixed live Claude probes passed: whole-page review 43.0 seconds, function-scoped review 8.0 seconds. These synthetic probes check semantic regression, not general code accuracy or large-project end-to-end latency.
- Chat activity fixture passed at 1280, 440 and 360 pixels: folded terminal records, copy/readback, chronological activity and shared polling. Capture fixture passed at 1280 and 440 pixels.
- Workbench rebuild/update/resume fixture passed with delayed admission. Portal and approval rendering passed at 1100 and 440 pixels using synthetic API responses.
- Actual macOS Electron/native PTY passed: Korean input, persistent shell variables, command approval, collapsed receipt, output readback, reopen without replay and Ctrl+C followed by another command. This does not verify Windows PowerShell or CMD.
- Embedded App, Talk and inquiry flow passed at 1100 and 440 pixels, including registration, readback and relogin with synthetic GHES responses.
- Company SSO and Windows 11 end-user behavior remain separate verification gates.
