# Mail folder import and storage policy

## User decision

Remove the cumulative 20,000-file / 4 GiB folder limit. Let the person choose the mail storage folder and whether to store attachments. A cancelled or interrupted import must retain completed messages and resume explicitly, without rereading unchanged completed MIME payloads.

## Implementation

- Folder discovery uses an iterative directory queue, including nested folders. Symlinks are excluded. Cumulative counts/bytes no longer abort the folder scan. Existing individual-file/parser resource limits remain; this is not unlimited single-message support.
- SQLite receipts key each canonical root and relative path. Size, modification/change time and filesystem identity determine whether an unchanged successfully stored message can be skipped. Changed and unsuccessful files are retried. Metadata is rescanned on resume to discover new/changed files; completed MIME payloads are not reread.
- Receipt order: stage payloads and manifest, sync files, atomically rename the private staging directory, persist the mail queue row, persist the import receipt. Leftover staging files are replaced on retry. Complete originals without a queue receipt can be recovered. This covers process interruption; it is not a guarantee against physical disk failure.
- Periodic and shutdown checkpoints retain progress and source directory. `resumeImport` explicitly resumes; cancellation does not automatically restart imports. Parser cancellation terminates the worker. Disk-full errors stop the run with a resume action instead of rejecting every remaining file.
- Imported messages retain their existing Personal Wiki queue. Local import no longer rewrites the growing account UID array or scans all messages after every single file.
- The shared storage form includes `첨부파일도 저장`, enabled by default for compatibility. Preference and relocation are committed together after copy/hash verification. Cancellation or failure preserves the prior setting. The current import retains its chosen policy when resumed.
- Excluding attachments removes their payload from both `.bin` files and the saved EML. The saved EML is labelled as a body-only copy, retaining text/HTML and inline body images. Original input SHA-256 and copy SHA-256 remain distinct. Attachment names stay visible as `not_stored`; download and agent extraction do not try to open absent bytes. Existing originals are never rewritten by a preference change.

## Method choice

Use the existing SQLite store and per-file receipts rather than restarting entire batches. Reuse the installed MIME parser and pinned Nodemailer MailComposer (10.0.10) rather than implementing ad hoc MIME boundary stripping. MIME reconstruction uses deterministic boundaries and disables filesystem/URL resolution. This only creates a local copy; no mail is sent. See [official MailComposer API](https://nodemailer.com/extras/mailcomposer).

## Evidence

- `tests/mail-import-resume.test.mjs`: restart after two completed messages, unchanged-payload skip, changed source, cancellation, disk full, partial staging recovery, complete disk write before queue receipt, and inventory of 20,185 files with over 4 GiB of sparse logical content.
- `tests/mail-storage-policy.test.mjs`: deterministic body-only MIME, inline preservation, persisted preference, raw download naming, excluded attachment read rejection, failed relocation and preservation of existing copies.
- Existing folder import/storage tests pass. Existing mail/portal/body image/incremental/Beta scope regression: 38 pass.
- `verification/mail-storage-resume/check.mjs`: actual Electron renderer, synthetic portal and folder-picker responses; 1100x800 and 700x560 bounds, checkbox payload, cancellation/error/success, existing-session reuse.
- `scripts/check-mail-resume-ui.mjs`: interrupted/importing/cancelled UI states, resume/cancel dispatch and narrow-layout screenshot.
- Live company portal, Windows installation, Office/NASCA and forced power-loss testing remain separate evidence. No release was published in this change.
