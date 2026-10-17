# Local mail and project Wiki reset

## Behavior

- Mail settings > 저장 및 초기화 > 메일 데이터 초기화 explicitly confirms deletion of local mail originals, attachments, edited mail Wiki, facts, collection IDs and annotations. Portal server messages and imported source folders are untouched. Storage location, attachment preference, models and other settings survive. Reconnect to the portal or choose the original folder to collect again.
- Project Wiki settings > 위키 다시 만들기 explicitly confirms deletion of the current openwiki folder, including human edits, and runtime-owned retained update/init copies. Source code, conversations and Git history remain. Existing editor before-image backups outside openwiki are retained for recovery and are not read into the regenerated Wiki. Generation starts with the connected model, or waits for a model.
- Reset is a user action, not an automatic remedy for login failure. It is never run against the user's data by these tests.

## Reliability

Mail disconnects the collector, increments its generation, aborts import, attachment and summary work, waits for admitted calls and writers, and drains encryption before deleting managed raw IDs and plain/encrypted mail pages. A durable reset-pending marker pauses processing after interrupted/partial cleanup. Metadata is cleared transactionally only after filesystem cleanup. Repeating reset finishes cleanup. An unresponsive writer stops reset after 30 seconds, preserving the pending marker; deletion does not race that writer.

Project reset reserves its operation before awaiting filesystem calls. Active initialization/update/refresh and agent work are rejected. Retained update paths must match the store-owned UUID location. Reset clears retained update records and init checkpoint before regenerating, so old ready/failed results cannot be resumed or applied. A failed cleanup keeps a durable pending marker and reports attention. Symlink targets are refused; unrelated files in the mail raw root are retained.

The Electron host excludes Wiki editor writes during reset. Mail source readers, selection, search and open attachment views are invalidated after successful reset. Wiki editor drafts for the reset scope are cleared only after success.

## UI

Shared DeckConfirmation, common icons, typography and TaskProgressBar; explicit scope and cancellation. Mail cleanup reports elapsed time and completed file targets. Connected portal lock and logout are a right-aligned group with the common spacing token instead of three independently spread header children.

## Verification

- Mail/Wiki regression run: 240 passed, 0 failed, including collecting, encryption, search, folder import, update resume and initialization.
- Subsequent reset/failure focused run: 29 passed, 0 failed, adding metadata-transaction failure/restart/retry and outside-owned-directory rejection.
- Actual Chrome mail form: reset cancel/confirm/reconnect, lock/logout alignment, 440px layout.
- Actual Chrome Wiki form: 1280/440/360px, visible confirm button, no horizontal clipping, cancel/confirm/progress.
- Build and design token checks passed. Screenshots: verification/mail/reset-440.png and verification/data-reset-2026-10-15/wiki-reset-440.png.
- Tests use temporary local files, fake model/API responses and test TLS server. Real Samsung SSO, Windows installation and real-model regeneration are not claimed.

## Method

Reuse the existing confirmed-deletion form, generation guards, exclusive Store owner, SQLite transaction and encrypted vault; no new dependency. Filesystem and SQLite are not one atomic transaction, so an interrupted operation is represented by a persistent marker and idempotent retry instead of being reported as success. This preserves explicit deletion scope and prevents background collectors from silently repopulating data during cleanup.

Final checks also cover a Git project with old Wiki committed at HEAD: reset/regeneration leaves those old pages absent while preserving HEAD. Shared modal verification passed 40 checks. The identity chain's mail check printed success but waited on an HTTP keep-alive connection; its server cleanup now closes those connections explicitly. Mail and modal checks then both exited successfully. The preceding Electron, skills, shared UI and form stages passed in the same chain.
