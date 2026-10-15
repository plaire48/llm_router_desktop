# Mail session confirmation

The user identified a native JavaScript alert above the portal page, not an HTML button. The previous helper only clicked an HTML confirmation on two logout URLs. On the portal home a native alert could remain open while a background API returned 403; the login catch then closed the owning tab.

## Behavior

- The person confirms the original portal alert. No automatic `handleJavaScriptDialog`, DOM click, credential submission, or cookie extraction is performed. The retired automatic logout-button helper was removed.
- Only mail-login BrowserHost tabs and their owned children observe Page dialog events. A weak state table exposes only fixed guide states, never the message or authentication URL. Agent tools still cannot inspect/capture authentication tabs.
- Stop API probes and error-page evaluation while a native dialog is open. For a recognized company session-expired alert, wait through the gap between manual confirmation and the next full navigation. Pause the authentication deadline only while the native dialog is awaiting the person; redirect/network work remains bounded. Cancellation still invalidates the connection.
- Catch paths recheck dialog state before treating an API error as terminal. Genuine access denial outside that state retains its original error classification.
- Browser header: `세션 만료` / `확인을 누르고 다시 로그인해 주세요.`; other dialogs: `포털 팝업을 확인해 주세요.`; after confirmation: `열린 포털에서 로그인해 주세요.`. Fixed token-based row height, common icons, accessible status and full tooltip. Native viewport geometry follows the row through the existing ResizeObserver.

## Method and evidence

Used [Electron's Debugger transport](https://www.electronjs.org/docs/latest/api/debugger) with the [Page dialog lifecycle](https://chromedevtools.github.io/devtools-protocol/tot/Page/) as a read-only observer. No Network or Runtime domains are enabled. Replacing `window.alert` or intercepting arbitrary native dialogs globally was rejected because it would alter the portal's behavior and other authentication flows.

`node scripts/check-mail-portal-login.mjs` passed actual isolated Mac Electron: original form POST/opener, persistent session, DOM logout confirmations waiting for explicit fixture clicks, a real native alert on the portal home held open for more than a poll interval, zero premature mail API probes, explicit fixture-driver acceptance, delayed redirect, login and background mail verification. The test driver accepts the synthetic alert; product code does not. Playwright's default auto-dismiss is disabled in this test.

`node --test tests/mail-session-dialog.test.mjs tests/mail-auth-lifecycle.test.mjs tests/mail-portal.test.mjs`: 35 passed. Includes origin/type/message boundaries, no automatic acceptance commands, redirect-gap gating, cancellation and late previous-session responses.

These are synthetic portal responses in actual Mac Electron, not real company authentication or Windows proof. No release was published.
