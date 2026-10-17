# Portal approval list follow-up

The reported symptom was an empty approval list with a generic retry sentence and a Login button. That button was displayed for every error; it did not prove an expired login. Actual company server status/body was unavailable in this session.

Compared the adapter against the user-provided Desktop Message Portal userscript. Its approval list POST has an empty body, `epid/pageNum` query and `X-EpUserID`, with no JSON Content-Type. Desktop incorrectly added the JSON header. The request now matches the reference; 400/415 and approval-specific 403 have fixed distinct codes without displaying server bodies or user IDs.

Identity recovery now also checks the own inbox recipient when a mail address is already known but its EP user ID is absent. A different received mailbox cannot supply that identity. No cookies, tokens or browser storage are extracted.

Approval list/item failures caused by request format, server availability, permissions or timeout no longer erase a working mail session. Explicit login expiry still follows existing disconnect and user-login recovery. The UI offers retry for ordinary failures and Login only for authentication/identity problems. Empty error states omit misleading pagination/selection hints. Read-only endpoints remain unchanged.

Validation: 23 portal/serialized-bundle checks passed; production React fixtures verify request-error retry, document read, pagination, preserved list on server failure and login navigation on expiry at 1100/440 px. Local build and identity checks passed. These are controlled fixtures; real company approval access remains unverified. No installer or release was produced.

Visual follow-up: shared Pretendard, 18px/600 section heading with clipboard icon, 15px body, quiet timestamp/caption ink and 40px controls. Retry uses the existing neutral inset surface without an extra border. Browser assertions include font family, measured title/body size, weight, button size and horizontal overflow.

## List and document diagnostics follow-up

The supplied JS uses an empty list POST with `epid`, `pageNum` and `X-EpUserID`, then an item POST with JSON `[{ap,ln}]`. The item's `result` is converted from a byte string (or UTF-8 when characters exceed 255) and parsed as MIME. Both HTML and Korean body text are covered by the existing mail parser. The product retains fixed read-only endpoints, its persistent portal session and sanitized HTML rendering instead of copying the userscript's local storage scanning or raw server-error display.

Found an additional actual code defect: the main IPC dispatch returned the three approval promises without awaiting them inside its try/catch. Async failures therefore escaped the safe error packet and could become generic Electron errors. All three now await completion; renderer reconstruction retains a whitelisted diagnostic with stage, fixed reason code and HTTP status only. Serialized portal-page execution also preserves those fields without relying on Error properties surviving Electron.

Stages: identity, list, document retrieval, MIME parsing. A 401/login HTML response, 403 permission denial, 404 missing API, 400/415 request rejection, 429 throttling, 5xx server failure, invalid JSON, unexpected HTML, empty body and parsing failure are distinct. Arbitrary server text, URLs, account IDs and authentication values are excluded. Ordinary approval failures do not erase a working mail session, and none triggers an automatic retry loop.

The UI shows a bold stage and short reason with an optional HTTP caption, shared clipboard/warning/retry icons and common typography/surfaces. Failed document retries retain the list/page and retry that document only. A malformed/empty document is not retained as a successful cache entry. Background title failures stay on the affected row rather than overwriting the active document error.

Validation: 39 focused tests passed, including actual main-dispatch and renderer error reconstruction, both transport paths, request contract, Korean UTF-8/byte-string MIME, recovery, and packaged function serialization. Rendered production components passed at 1100, 440 and 360 px, including same-document retry, list preservation, all displayed error stages, font/weight/control measurements and overflow checks. Electron local build and design checks passed. Screenshots and result: `verification/approval-list-2026-10-16/`. Real company portal and Windows installed-app validation remain pending; no release was created.
