# In-app HTTPS diagnosis

## Finding

The current BrowserHost uses Chromium's default certificate verifier and proxy resolution. No certificate override, proxy override, certificate bypass switch, or custom CA filter is installed in production. General pages use an isolated session; company login and popup children retain their originating company session. The Node service's configureSystemTrust applies to Node requests, not WebContents navigation.

The reported corporate Windows failure has not been reproduced. A successful external browser does not identify the cause: managed browser proxy configuration, client certificate selection, trust chain, or a different redirect destination still require the actual native error.

The confirmed product defect was loss of error detail: all certificate errors were collapsed to browser_certificate_failed, while TLS negotiation and proxy failures became browser_load_failed.

## Applied

- Distinguish certificate verification, TLS negotiation, proxy, DNS, timeout and connection failure.
- Preserve native numeric error and validated ERR_* identifier plus the existing navigation stage in tab memory.
- Explain authority, date, hostname, revoked certificate, client certificate and proxy authentication failures separately.
- Expand/copy diagnostics within the existing browser error surface using shared tokens. No new modal or bypass action.
- Clear diagnostics after navigation recovery. Failed subframes do not replace the whole page.
- Diagnostics contain no URL, POST, headers, cookie, certificate bytes or proxy credentials. No network trace is recorded.
- Preserve default verification, session isolation, popup POST/opener and proxy configuration. No certificate installation or trust-policy mutation.

## Verification

- Unit tests: browser-network-error and browser-saml, 7 passed.
- Native Electron, temporary local self-signed HTTPS: ordinary, redirect and new-tab failures report ERR_CERT_AUTHORITY_INVALID (-202); server HTTP handler never receives the blocked requests.
- Persistent company fixture session retained through popup; recovery clears error; diagnostic copy contains only fixed fields.
- Temporary fixture-only proxy failure reports ERR_PROXY_CONNECTION_FAILED (-130).
- Default, ordinary browser and company session proxy resolution agree on this Mac.
- Existing native SAML fixture passes POST, 307/303, opener/session and return.
- Actual UI at 1100/440/360px: diagnostic disclosure/copy and overflow checks.
- These are local Mac fixtures, not corporate certificate trust, real SSO, Windows, installed-release, or successful company HTTPS verification. No release made for this change.

## Basis

- Electron WebContents navigation/error contract: https://www.electronjs.org/docs/latest/api/web-contents
- Electron session/proxy contract: https://www.electronjs.org/docs/latest/api/session
- Chromium network error definitions: https://raw.githubusercontent.com/chromium/chromium/main/net/base/net_error_list.h

Reuse existing Chromium trust and session handling rather than install a custom verifier or force a proxy based on an unconfirmed cause. The next corporate-PC check should compare the same URL and the native error with the working external browser; no password or authentication query values are needed.
