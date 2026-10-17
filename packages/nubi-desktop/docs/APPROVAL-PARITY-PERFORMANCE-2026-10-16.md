# Approval identity parity and rendering

## Source evidence

Compared the user's previously attached Desktop Message Portal Panel source at attachment 1990ad1c-e4e0-49b7-af71-d1a43bda8848. It contains 393 logical lines, 26,704 bytes, SHA-256 ca8b5f18923857f90cf32c9406bf1850439c32eb430878dfd85981d0f7bf637c. The newly mentioned desktop-message-portal-panel-v2.user.js is described as 26,706 bytes; that exact filename/version was not found, so byte-identical provenance is not claimed.

The provided source autoDetect issues portal session GET, mail userinfo POST and policy POST together and selects identity in portal/mail/policy order. Nubi previously accepted the mail ID first and skipped the portal identity when any mail ID was present. Different mail login and portal EP identifiers could therefore be sent to the approval endpoint. This is a reproduced source-contract defect, not a confirmed explanation of the user's unavailable corporate response.

## Changes

- Probe the three authenticated identity endpoints concurrently. Prefer portal ID, then mail, then policy, retaining the mail address/set code and rejecting a different known email.
- Keep the existing own sent/inbox fallback and fixed profile-field projection. No cookie/storage/token scraping from the userscript is imported.
- Preserve list POST with epid/pageNum and X-EpUserID, and item POST [{ap,ln}]. Keep read-only access.
- Share an in-flight item read between title hydration and clicking the body. Failed calls can retry; stale page calls cannot refill the replacement page cache.
- Convert the raw result to bytes by scanning character codes instead of allocating a character array for the whole document. Latin-1/UTF-8 byte behavior is unchanged.
- Batch title updates at 80ms, retain unaffected row objects and memoize rows and MailBody. Unchanged mail status does not replace React state.
- Bound the approval list height with internal scrolling and a sticky table header so selected content remains visible below it. Existing identity tokens, loading, pagination and failure actions remain.

## Checks

- 44 portal, diagnostics and bundle tests passed, including distinct mail/portal IDs, concurrent identity probes, concurrent title/body read, retry, stale cache, identity isolation, error stage and raw MIME reconstruction.
- 3 mail body-image tests passed; real Chrome HTML/CID rendering check passed.
- Real Chrome UI at 1100/440/360px passed error/retry, pagination, document parsing errors and expired-session guidance.
- 60-row fixture with frequent parent renders: 4 title text mutation batches, one list request, one body request, selected document stays within the viewport. This counts title update batches, not total React commits or general app frame rate.
- Native Electron mock portal: actual login POST popup/opener, shared session, numeric portal ID, approval list/body, expiry alert/confirm and relogin passed.
- Local 8 MiB Latin-1 conversion microbenchmark, three runs: prior 90.77/66.91/66.77ms; candidate 14.26/15.63/14.52ms. Bytes equal. This is not an end-to-end company-PC latency measurement.

Evidence: verification/approval-list-2026-10-16/result.json and byte-conversion.json. No company server, real account or Windows device was available. No installer or release published by this task.

## Method

Reuse the supplied same-origin API contract and existing React memoization/batched update patterns, rather than adding another HTTP client or renderer framework. Maintain authentication and cancellation boundaries; measure local call counts and byte conversion independently from live service success.
