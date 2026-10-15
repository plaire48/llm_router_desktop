# Mail and document previews

## Changes

- Empty sent-message bodies can be recovered from a single HTML MIME part. Inline parts and generic `body.html` / `message.html` / `mail.html` / `첨부파일` parts become the displayed body. Explicitly named HTML attachments remain available, and an existing body is never replaced. MIME attachment indices and original hashes stay unchanged.
- HTML and Markdown files open in a sanitized rendered view, with an icon to return to the existing source editor. The same Monaco model and unsaved changes survive toggling. HTML scripts, embedded frames, event handlers, forms and local resource URLs are not enabled.
- PDF files use a lazy PDF.js page canvas. Word uses a sanitized semantic preview; spreadsheets use a cell table; slide text retains slide headings. These Office previews are readable content, not exact Office page-layout reproduction.
- Mail originals are accepted up to 96 MiB and document extraction up to 64 MiB. Imported originals are never silently reduced to a header prefix. Expanded OOXML is bounded before parsing. The parser remains isolated in a bounded worker; concurrent readers and timeouts remain in place.
- Extracted text is bounded at 2,000,000 characters and PDF extraction at 2,000 pages. UI/model reads are 60,000-character windows with `offset`, `nextOffset`, `totalCharacters` and `partial`; page/slide/sheet source positions remain attached. `read_personal_mail` accepts `attachmentId` and `offset`. Unread ranges must not be claimed as verified.
- Fixed PDF teardown to use the installed PDF.js loading task API. The old document-proxy teardown failed after otherwise successful extraction.
- Office COM fallback retains Office 2016, read-only, macro/link restrictions, byte hashes, private temporary copies and cleanup. No new decryption bypass was introduced. Password-protected, unsupported, over-budget and image-only content remain explicit limitations. Image-only PDFs can be displayed without claiming OCR success.

## Wiki UI correction

Progress no longer replaces or hides the entire chat screen. A compact in-flow status retains real counts, elapsed time and stop. Reading past messages, selecting files and navigating other menus stay available. The earlier protection against conflicting execution in the same actively written project remains; progress alone does not make all controls inert.

Wiki list loading uses the result container's padding and normal layout flow. It has no absolute spinner positioning or content-box height that exceeds the bordered container.

## Verification

- 186 related mail, file and wiki admission regression checks passed before the final additional continuation case.
- New real-document checks cover HTML MIME recovery, explicit attachment preservation, a 201-page PDF, long Word content, complete 51 MiB EML ingestion, read-only external PDF previews and model continuation without HTML/payload leakage.
- `scripts/check-document-preview.mjs` checks sanitized HTML, source switching, Markdown, two-page PDF canvas navigation, other actions during Wiki work and loading containment at 1000px / 440px in Chrome.
- Screenshots and result: `verification/document-preview-2026-10-15/`.
- `scripts/check-document-electron.mjs` passed in an isolated Electron app: HTML opens rendered, source edits survive the preview toggle without silent disk writes, and PDF page navigation works through the app protocol. Existing app sessions were untouched.
- Final focused document, mail knowledge and image checks passed 15/15; agent capability checks passed 7/7. Common design tokens, icons, initialization-order checks and the Electron build passed.
- These are local source/document/browser and isolated Electron checks. Company mail samples, installed Windows Office/NASCA and a new Windows installer have not been validated or released in this change.
