# Browser connection wait and truthful capability reporting

The external browser connection surface no longer says that installation of an
extension is unnecessary. Its primary action remains Browser connection.

The previous direct connection path retried a missing DevToolsActivePort every
300ms for up to 90 seconds and opened Chrome's remote-debugging settings in
Samsung Browser. Chromium compatibility does not prove that Samsung exposes
Chrome's consent page. That assumption is removed.

A trusted renderer can acknowledge a connection request immediately with
`background:true`. Discovery and connection continue in main, publish checking /
connecting / tab choice or a concrete failure, and remain cancellable. The
connection settings modal closes after acknowledgement; the underlying browser
surface and shared footer retain the actual connection state. Completion and
failure produce a local notification. Existing awaited caller semantics remain
for mail/browser host operations. No model or page can initiate the UI route.

A missing Samsung endpoint is inspected once per explicit attempt and reported
as unavailable. The code does not invent an approval checkbox or launch Chrome's
settings in Samsung. Chrome's documented settings path remains a one-time setup
result requiring an explicit retry. Opening a WebSocket is bounded to 15 seconds;
missing endpoint metadata never starts a 90-second polling loop.

Cancellation releases the logical connection immediately. Late read-only
installation discovery is closed and cannot overwrite a newer tab choice.
Switching browser modes cancels pending discovery before changing mode. Existing
scope, original login/tab preservation, exact tab choice, authentication-frame
protection, uncertain-result handling and PowerShell encoding remain unchanged.

This fixes the long wait and misleading UI. It does not establish that the user's
installed Samsung version exposes an endpoint. Windows/Samsung/SSO verification
is still required; no profile cloning, debugging-flag injection, browser restart,
policy change or extension installation is used as a silent workaround.

## Verification

- Unit regression: background acknowledgement precedes held discovery; absent
  Samsung metadata makes exactly one connection attempt and opens no assumed
  Chrome permission page. Cancellation/new-attempt races retain the new choice.
- The real Electron/local Chromium harness exercises held discovery, concurrent
  modal use, cancellation, synthetic Samsung endpoint absence and then the
  original authenticated Chromium tab, input, rendering and disconnect flow.
- The synthetic Samsung configuration is a UI/host regression, not an actual
  Samsung execution. Final local check results are recorded after execution.

## Official evidence

[Chrome automatic connection configuration](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)
documents Chrome 144+ and its inspect settings.
[Samsung remote debugging policy](https://developer.samsung.com/browser/policy/remote-debugging-allowed.html)
documents command-line debugging and policy restrictions. It does not establish
that the user's Samsung build exposes Chrome's consent UI.
[Samsung Windows release notes](https://developer.samsung.com/browser/release-note/windows-release-note.html)
are a version reference, not connection-support validation.

## Executed local evidence

The focused host/UI regressions passed 51 tests. The actual Electron + temporary
Chromium journey passed 16 checks, including held discovery, concurrent modal
use, immediate cancellation, explicit missing-endpoint display and existing-tab
click/text/IME-event/navigation/read-only-auth protection. The final synthetic
held-discovery click-to-visible-state sample was 105.7ms; it excludes actual
Samsung discovery and is not a user-device latency benchmark. Screenshots and
readback are in `verification/direct-browser-content-2026-10-23/`.

The broader full UI gate is not green; baseline comparison and final performance
qualification are recorded in `UI-RESPONSIVENESS-2026-10-24.md`. Source-main
integration is distinct from Windows/Samsung connection acceptance and an
installer release.
