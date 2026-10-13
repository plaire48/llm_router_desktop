# Personal Wiki archive folder import

The native **메일 설정 > 파일에서 가져오기 > 폴더 선택** action reads EML, MHTML/MHT and MYSINGLE recursively, including nested folders. It never logs into POP3 and does not change the portal account. Folder imports use the existing body/metadata-only Personal OpenWiki synthesis, durable mail queue, source hash, search and selected-source question flow. The configured model is used when automatic organization is enabled; without a model, original sources remain searchable and the queue waits.

## Archive classification

The nearest matching ancestor directory (including the chosen root, case-insensitive) sets the category. AUTO_INBOX is received mail, AUTO_OUTBOX sent mail, AUTO_NOTICE approval documents, AUTO_PROCESSED processed/approved documents, AUTO_SUBMITTED submitted documents. Other folders become other documents. Nested matching directories override the ancestor. Classification is explicitly marked as folder-derived, not evidence that Nubi executed an approval or that the current remote workflow has that status. Mail and approval views stay separate; AI query supports the same local category filters.

MYSINGLE is parsed as MIME with X-DESTTOP-MSG-UNIQUEID and X-MsgFlags preserved. Raw CP949 display headers are decoded for presentation only. Original bytes and SHA-256 remain intact. MHTML HTML bodies become searchable text; display uses the existing sanitized no-image reader. Images, attachment content analysis and DRM decoding remain out of Beta scope. Protected, empty, malformed, unreadable and oversized files are named in the import report.

## Persistence and limits

Original bytes, attachment metadata and queue receipts are durable before a file is counted as imported. SHA-256 plus folder category prevents duplicate import in the same category, even when copied/renamed. Different categories retain separate source contexts. Re-import resumes missing files without rewriting stored sources. App restart preserves completed intake and a marker for interrupted intake. Stop cancels collection; previously collected files remain. Automatic organization is controlled separately.

At most 20,000 supported files, 4 GiB per selection, 50 MiB per file, 200,000 scanned entries and 20 nested levels (raised 2026-10-14: folder imports are usually bulk exports; files are still read one at a time). Unsupported extensions are ignored; directory links are not followed. Only native folder-picker paths enter the private import action. Parsing runs in the existing resource-limited MIME worker. Original file changes are checked and rejected. Remote/public upload is a separate Wiki sharing action with the existing approval.

## Verification

`tests/mail-file-import.test.mjs`: nested classification, CP949, EML/MHTML/MYSINGLE, original byte roundtrip, duplicate/restart behavior, Personal Wiki synthesis without portal login, separate portal account receipts, source limits, directory links and cancellation. Synthetic source/model transport checks do not certify company archive/DRM files or live model quality.
