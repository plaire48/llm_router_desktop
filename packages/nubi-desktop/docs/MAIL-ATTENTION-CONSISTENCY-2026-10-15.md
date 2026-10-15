# Mail attention consistency

## Cause and change

The footer counted attachment failures, but the attention endpoint only listed failed summaries. Cancelled downloads and account scope also differed between counts and the list.

`runtime/mail-attention.mjs` now projects current-account and local mail once per message. Summary and attachment failures share that projection; cancellations are excluded. The attention endpoint supplies the list and status from one synchronous snapshot. While the panel is open it owns footer refresh, avoiding an independent status poll overwriting its result. Electron retains the portal connection state when decorating this snapshot.

Attachment-only rows show the filename, a file-type icon and the specific failure. Retry queues attachment reading without discarding a saved wiki summary. Changed originals remain protected. Unsupported or protected documents direct the user to the original rather than offering a misleading automatic retry.

No dependency added. Reused the current file icon, modal tokens and polling lifecycle. The snapshot approach avoids adding a separate event stream or additional periodic requests.

## Verification

- 32 focused mail, attachment, incremental import and portal tests passed.
- Eight attention tests rerun after limiting snapshot fields: passed.
- Actual shared React components in Chrome at 1000px and 360px: attachment-only row, pagination, retry, matching footer count, reopen persistence and contained actions passed.
- Electron build passed; no installer or release created.
- UI evidence uses synthetic mail. Company mail and installed Windows were not exercised.

Artifacts: `verification/mail-attention-consistency-2026-10-15/`.
