# Portal mail, approvals and project Wiki admission

## User decisions

- Mail connection uses the authenticated `https://kor3.samsung.net` portal, replacing POP3/Gmail connection controls. Retained POP3 originals are preserved. This supersedes the earlier POP3-only UI decision.
- Use actual portal folders, including inbox, sent, drafts and spam. Source collection and automatic AI synthesis are separate controls. Drafts, spam and trash are collected but excluded from automatic AI synthesis.
- Remove the manual recipient identity form. Read the authenticated user profile, then use the sender of the user's sent folder or the receivedAddress of an inbox message when account/address fields are missing. Matching recipient records can supply the account user ID. Compare verified addresses with To/Cc/Bcc headers. For each mail, the user-confirmed keys `subject`, `localdate`, `toRecipients`, `ccRecipients`, `bccRecipients` and `receivedAddress` map to title, local date, recipients and the actual delivered address. Per-mail receivedAddress takes priority over the profile address so aliases classify correctly. Missing Bcc is not inferred.
- Approval documents are read-only. No approval, rejection or workflow mutation endpoint is admitted.
- Projects writing their Code Wiki show a central progress page with the existing Nubi bird/orbit and actual stage counts and elapsed time. Block that project's chat admissions until its writer finishes or is cancelled. Other projects stay usable. Preserve drafts, messages, pending questions, queues and receipts.

## Implemented contract

The reference is the user's supplied Desktop Message Portal Panel script. It establishes folder/list/summary/EML and approval list/detail read routes. These are reference contracts, not verified company-server responses from this Mac.

The Electron host owns a dedicated persistent, sandboxed portal browser session. It checks retained login without forcing a popup. An explicit login action opens the portal. The adapter uses same-origin browser fetch and never copies cookies or reads token stores. Only fixed read routes are permitted. Non-HTTPS navigation is rejected, and the login window has no Node access or app preload. Based on [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

The login response is restricted to identity/address fields before leaving the portal renderer. Collection is sequential and deduplicated by account, folder and server mail ID. JSON, EML, page count, parser memory and approval cache sizes are bounded. A cancelled or replaced session cannot publish late results. Background refresh is every five minutes with a retry after transient failures; session expiry requires login. Refresh calls share one in-flight operation.

EML bytes are parsed in an isolated worker. Existing original-byte hashes, immutable intake receipts, mailbox search, downloads, Personal Wiki and citation validation are reused. HTML keeps tables and formatting inside the existing sanitized, script-free frame. Images are omitted and its CSP denies image loading. Approval list hydration is bounded to four concurrent reads; only the selected document is parsed. Approval pages and detail views remain separate from mail/Personal Wiki intake.

The writer guard covers initialization and updates at runtime and UI admission, including rechecks after mail validation. New requests, regeneration, question answers and queue starts are blocked before destructive changes. Orphaned `running` records do not permanently lock chat. Already running agents are not forcibly cancelled. Queue drain waits for an idle writer and preserved queued input can be started afterwards.

## Claude quota finding

Status-only events were replacing known percentages with null. Five-minute-old samples were then hidden by the UI. Preserve a known measurement only in the same unexpired window, with its original timestamp; label older samples as the last observation. Expired or invalid samples never claim current capacity. Keep the official account usage page available.

The adapter receives structured CLI rate-limit events after actual replies. This is separate from token accounting and does not provide a zero-token account refresh. The official [status-line documentation](https://code.claude.com/docs/en/statusline#rate-limit-usage) describes 5-hour/7-day information after an API response. The supported CLI remains responsible for credentials; no undocumented account endpoint is used.

One actual Mac Claude Code 2.1.296 request received remaining percentages of 100% for five-hour and 78% for seven-day. This is that local account's observed snapshot, not a measurement of the user's installed Windows app.

## Validation and release boundary

- Runtime unit tests cover source intake/search/receipt preservation, account inference, portal session restore/expiry, read-only approvals, MIME body recovery and per-project chat guards.
- `test:wiki-portal-ui` checks actual Workbench/React/CX components with local API fixtures at 1100px and 440px. It covers the progress page, preserved draft, rejected-admission restoration, portal-only login, folder-filter routing, approval pagination and sanitized body. Screenshots are in `verification/wiki-portal`.
- `test:mail-background-ui` checks attention actions, pagination, source hash forwarding, stable loading overlays and non-error cancellation at 1000px and 360px.
- Company SSO, actual mail/approval response schemas, Windows session restore and installation are not verified here. The provided JS contracts need company-PC acceptance testing.
- These changes postdate published Windows 1.1.6 and have not replaced its installer or release tag.

Latest focused checks: 43 passed, zero failed. The broader source run passed 882 with 198 disabled-feature skips; the later receivedAddress identity fallback was validated by the focused suite. Design checks and the Electron bundle passed. The local UI flows passed at wide/narrow widths; these counts are not company-service or Windows-installed acceptance evidence.

## Project identity follow-up

Wiki preparation now identifies the catalog display name (folder name fallback) in the central progress screen and the preparation dialog. The project row shows a single-line spinner plus `위키 작성` or `위키 갱신`; the full project path remains available in its tooltip. Background services expose their actual live `wikiChatJob`, separate from agent activity. A cancelled/completed/orphan job is not displayed as active. Clicking the background project keeps the existing project-switch contract, and removal is disabled while its Wiki writer is active.

Validation: project service and Wiki admission suites 10/10; actual React/CX rendering verifies current and background labels plus the switch callback, with simulated jobs. Existing 1100/440px portal UI checks and local Electron build also pass. This does not verify the installed Windows build.
