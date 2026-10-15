# HTML body classification follow-up

Reproduced: a MIME message with a fallback text part, an exported `body.html` and a genuine `report.html` produced no HTML body. The old classifier counted all HTML attachments before deciding whether one was the body. More than one HTML part prevented recovery entirely.

The shared OpenWiki/Desktop parser now filters candidates by body evidence first. A unique inline body or known exported body filename with empty/fallback/equivalent plain text can be recovered alongside genuine attachments. Explicit unrelated HTML attachments remain files, including messages with an empty body. Ambiguous candidates are not guessed. CP949 aliases are decoded before HTML display and text extraction.

Content version 5 causes existing encrypted originals to be reparsed on read. Original bytes, attachment IDs and receipt hashes stay unchanged; no mail fetch is required. Legacy attachment errors tied to exported body filenames are requeued once per classifier version. An original that was already discarded cannot be reconstructed from this change.

The existing MailBody sanitizer and script-free iframe remain in use. The fix supplies recovered HTML to the existing renderer rather than adding a new preview UI. Search/AI evidence remains extracted text. No new dependency was added; existing MailParser, html-to-text and DOMPurify are reused.

Validation: 46 focused tests passed across HTML classification, Korean decoding, legacy encrypted storage/read, real attachment preservation, document reading, storage policy and portal regression. A production MailReader fixture uses synthetic EML through actual intake/read, then verifies rendered table/Korean text, only the genuine attachment remaining, script removal and page overflow at 1000/420 px. Evidence is in `verification/mail-html-recovery-2026-10-16`. Local Electron build/design checks passed. This does not establish success for the user's exact company message or Windows installed app; no installer/release was produced.
