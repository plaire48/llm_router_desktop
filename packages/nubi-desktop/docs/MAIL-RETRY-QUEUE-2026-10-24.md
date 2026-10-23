# Mail retry queue

The mail status dialog disabled “다시 정리” and “다시 읽기” during any active summary or attachment read. The backend rejected the same requests with `mail_busy`, even though mail rows already persist queued work. A retry also awaited prepared-Wiki reconciliation before returning, and the dialog awaited its list refresh before unlocking the action.

Retries now persist `state: queued` / `attachmentState: queued` using the existing store and return a queue receipt immediately. Prepared-Wiki reconciliation continues through the existing background path. The existing singleton attachment reader and summary drain retain execution ownership and wake the next queued work when their current item finishes. Independent lanes can still process different messages; this is not a new global serial worker or distributed scheduler.

The dialog keeps retries available during background processing, removes the accepted issue row and displays “처리 대기열에 넣었어요.” without awaiting the follow-up list read. Another mail can be queued while that refresh is pending. The brief acceptance-request lock still prevents simultaneous duplicate submissions. Source/settings actions, pagination, shared CX tokens and the current processing details remain intact.

Per-message requests carry the displayed source hash. Existing account checks, changed-source rejection and prepared-save receipts remain authoritative. Repeated requests acknowledge an already queued/running item without resetting it; a saved item with no pending attachment read is acknowledged as completed. A summary queued behind failed attachments still queues its failed attachment phase. Completed attachment caches and saved Wiki paths are retained. Automatic organization off, missing models and disconnected collection do not prevent storing eligible retries, and accepting work does not enable automation or switch accounts/models. Reset and intake/storage reconfiguration protections remain in force.

The implementation reuses the persistent producer/worker queue and idempotent acknowledgements already available in this repository. A second queue package would duplicate row state, storage ownership and recovery logic without adding value to this change. No dependency was introduced.

## Verification

- `tests/mail-attention.test.mjs` adds six regressions: registration during active work, persisted queue after reopening, mixed summary/attachment phases, actual reader handoff with retained caches/Wiki, acknowledgement before held reconciliation, and actual prepared-save handoff without a new model call. Hash mismatch and completed/duplicate acknowledgements are included. The first runs exposed the old `mail_busy` and delayed acknowledgement; a prepared-save test startup race was corrected by waiting for the constructor's initial reconciliation before starting its held worker.
- The final focused mail/attention/Office-diagnostic/processing/encryption run passed 51 tests with no failures or skips.
- A further 33 attachment-routing/recovery, intake-settings, authentication-lifecycle and reset tests passed. Reset still waits for active reconciliation/writers before deleting local data.
- `scripts/check-mail-processing-ui.mjs` passed 10 scenarios in Chrome and 10 in the built macOS Electron host. Both use synthetic mail responses, including a deliberately held list refresh, active summary/attachment work, disabled automation and missing models. Retry IDs/hashes and request counts are asserted. Success captures use the shared design audit; the retry surface also passes the shared accessibility/focus audit. Existing wide/narrow, enlarged-text, reduced-motion, stale-state and reopening checks remain.
- `scripts/check-mail-background-ui.mjs --attachments-only` passed at 1000/360 px, preserving source opening, retry behavior, typography and Office diagnostics. This focused command does not claim the broader settings/login scenario.
- The Electron build passed. Its existing CJS `import.meta` warnings in `windows-bash-process.mjs` remain separate from this change.

Local worker handoffs use synthetic source/extraction/save ports. Live company POP3, real model output, Windows Office/NASCA and installer/update acceptance were not exercised by this change.
