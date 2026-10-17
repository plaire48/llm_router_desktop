# Mail attachment classification and text decoding

## Applied

- ICS calendars are read as evidence with unfolded lines, decoded escaped values and preserved timezone/recurrence parameters. No calendar registration, invitation or URL request occurs.
- TXT/MD and MIME-only text attachments support strict UTF-8, BOM UTF-16, declared charset and legacy Korean CP949. Binary/control data is rejected instead of silently becoming text. No new dependency is added.
- The shared MIME parser recognizes named inline body HTML and known body-name exports with an empty, HTML fallback or identical plain body. Generic binary MIME with a known body name additionally requires an HTML prefix. Unrelated explicit HTML files remain attachments. The original bytes, hash and attachment numbering stay unchanged.
- Old manifests are rehydrated from verified originals. A one-time reader-version migration requeues old format/read/policy failures, while successful hash-matched reads remain cached. A failure in the new reader does not trigger endless restart retries.
- An empty or malformed PowerShell result is classified as an Office read failure, not evidence of company policy. ReadOnly failure keeps its fixed code and describes the actual failure. Word/Excel/PowerPoint automatic fallback retains STA, hash/ACL protections, disabled macros/links, no-save and owned-document cleanup. No Office or PowerShell policy is relaxed.
- Existing mail components and tokens are reused: primary 15px, secondary 14px, weight 600, shared file/calendar icons, compact retry actions and tooltip/accessibility names. Attachment-only retries no longer require an AI model. Narrow screens hide retry text while retaining the icon and accessible name.

## Evidence and boundaries

- Mail source regression: 188 passing tests, including encrypted original migration, parser/worker extraction, HTML versus genuine attachment, original receipts, one-time recovery, text encodings and Office response classification.
- Focused final parser regression rerun after generic body-name and charset alias additions.
- Actual shared UI components in Chrome at 1000px and 360px: containment, fonts, emphasis, calendar icon, single-row actions, retry without a model. Screenshots: `verification/mail-background/attachment-issues-*.png`.
- Electron build and design identity check.

UI uses synthetic mail status; corporate originals were not downloaded or deleted. Windows Office 2016/NASCA execution is not verified on this Mac. A separate legacy login section in the background UI script expects the older direct-login contract; use `node scripts/check-mail-background-ui.mjs --attachments-only` for this scope. No installer or release generated.
