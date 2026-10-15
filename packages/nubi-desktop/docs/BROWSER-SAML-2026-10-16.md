# In-app SAML navigation and diagnostics

User report: a link/menu opens a **new tab**, which displays EpSSO SAML Single Sign On Service and `httpGet is null` / `HttpGet.getURI()`. The Java exception is an observed server error, not proof that cookies or the POST were lost in Nubi.

## Changes

- `createWindow` adopts Electron's existing guest WebContents without navigating it again. If Electron supplies no guest, Nubi starts the requested navigation with the supplied POST and referrer. The decision now follows guest existence, not foreground/background disposition. Chromium still owns opener, named targets, redirects and cookies. `noopener` is not removed.
- A per-session observer records main-frame request stage, whitelisted method, HTTP status and elapsed milliseconds only. At most 16 entries per tab are retained in memory. The session observer is shared across this host's tabs and removed when the final observed tab closes. This is the sole owner of these webRequest listeners; future network instrumentation must use this dispatcher rather than replace Electron's single listener.
- SAML binding query/fragment values are removed from display addresses. Full actual URLs and POST bodies are unchanged for navigation. SAML browsing is excluded from ordinary history. Diagnostics never collect URL values, upload data, cookies, headers, assertions, inputs or server response text.
- A bounded isolated-world check classifies the exact EpSSO `httpGet` null/getURI page as a fixed code. It returns a boolean only and discards results from a previous document. It runs only for SAML/EpSSO routes or titles. HTTP failures and load errors remain distinct. HTTP 200 means a page response, not successful authentication.
- The common browser panel shows a compact failure notice with an icon, short reason, expandable navigation sequence and diagnostic copy. Original server content remains visible. The return button selects the actual parent tab without reloading/replaying SAML or automatically accepting any prompt.
- Native portal session expiry confirmation remains the person's action. No password, cookie copying, TLS bypass, automatic login or POST retry was added.

## Basis

Electron's [guest-window manager](https://github.com/electron/electron/blob/main/lib/browser/guest-window-manager.ts) supplies the existing guest to `createWindow` and returns directly from the custom handler. Default URL loading only occurs when there is no guest. Reuse this behavior rather than rebuilding SAML/OAuth or adding an authentication library.

## Local validation

- `tests/browser-saml.test.mjs`: redaction, bounded trace, stale completion isolation, per-session/tab ownership, ordinary navigation after SSO.
- `scripts/check-browser-saml.mjs`: actual Electron and isolated local HTTP origins. Blank/named new tab, cross-origin form POST, 307 exact POST preservation, 303 GET transition, no duplicate POST, opener/session/return-cookie preservation, HTTP 200 EpSSO error and 502 classification, parent tab return. The HTTP fixture tests transport semantics, not real HTTPS SAML signature validation.
- `scripts/check-browser-popup.mjs`: written blank popup, opener, actual POST and failed-page recovery.
- `scripts/check-browser-saml-ui.mjs`: actual BrowserPane and common styles at 1100/440/360 px, details, copy, return and overflow checks. Synthetic error data, not a company account.
- Company SSO, Windows 11, installed release and upstream EpSSO service behavior remain unverified. No release was published.

## Mail security review boundary

The current default mail origin is HTTP (`mail-portal-contract.cjs`). Exact same-host HTTPS upgrades are supported, but HTTPS for all requests is not enforced. Do not claim transport encryption without observing the actual corporate deployment. Changing the default blindly could break the known portal flow; deployment HTTPS support needs confirmation.

Managed original EML, body manifests and attachment bytes use authenticated encryption (`mail-raw-vault.mjs`). Derived search/extraction records, conversation evidence and active Wiki copies are separate storage surfaces and are not all encrypted. Read mail/attachment/Wiki evidence may be sent to the selected AI during answers or Wiki generation; storage encryption does not prevent this transmission. Company approval and provider data-handling rules are not established by this source review.

Final local results: 39 focused tests passed (0 failures), identity/TDZ/icon checks and Electron build passed. Both SAML and existing popup Electron fixtures passed. The legacy native-confirm fixture initially failed while its window/view was hidden and used a different CDP session; its driver now displays the isolated window/view and explicitly confirms through the observing Page session. With that fixture correction, all logout/expired-dialog/relogin scenarios passed. No product auto-confirm behavior was added. UI screenshots: `verification/browser-saml-2026-10-16/failure-{1100,440,360}.png`.
