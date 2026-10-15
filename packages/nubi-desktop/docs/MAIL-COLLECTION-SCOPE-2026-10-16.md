# Mail collection scope and attachment evidence

User decision: the storage choice belongs directly in collection scope. Body and readable attachment contents must still feed Personal Wiki when original attachment retention is off.

## Applied

- Collection scope is always visible in mail settings, using existing section icons, typography and controls. It shows evidence scope, the original-retention checkbox and the editable storage location. Data reset and the secondary Wiki path remain under data management.
- Shared `MailAttachmentStorageOption` is used both here and in the storage picker. Main labels use body/600, secondary copy caption/400, existing icons and compact copy tokens. No separate visual system or checkbox implementation.
- Retention on preserves the original EML and attachments. Retention off keeps the body, body images and extracted attachment evidence, but strips attachment bytes from the EML and does not save attachment `.bin` files.
- Extracted evidence is stored in the encrypted immutable manifest with the original attachment hash, reader version and coverage. Raw attachment download is disabled; the readable evidence remains available for preview, search, citations, agent windows and Personal Wiki synthesis.
- Extraction uses the existing bounded worker, image-capable model and Windows Office fallback contracts. Cancellation/failure before extraction finishes does not commit a mail receipt or UID checkpoint. Retrying reuses completed messages. Original source files and server mail are not deleted.
- This is per-message atomic collection, not per-attachment resume. Choosing not to retain originals can take longer during collection because extraction must finish before bytes are discarded. For local imports the running/resumed import retains its captured policy; changing policy requires selecting the folder again. Existing completed imports are not rewritten.
- Old `not_stored` records have no attachment evidence and cannot be reconstructed from metadata. The original must be provided again; no claim of automatic recovery.

## Verification

- 217 targeted mail/proposal/runtime tests passed, including encrypted evidence after reopen, source hash rejection, failed extraction and retry, attachment search, document preview and real Personal Wiki input construction with a stub model.
- Actual production UI components rendered in Chrome at 1000/440/360 widths with normal/large text. Collection-scope control changes and storage-dialog entry are exercised. Evidence: `verification/mail-cx-final-2026-10-15/`.
- Local Electron build, icon check, TDZ check and design check pass. These checks do not prove real company login, Windows Office/NASCA or live model answer quality.

## Design and method

Reuse existing source receipts and worker extraction rather than keeping hidden original bytes or adding another parser. Keep the retention setting separate from evidence availability; unavailable originals remain visibly unavailable. Actual computed typography, bounds and keyboard focus were checked, following the existing design QA checklist and common Nubi modal contract.
