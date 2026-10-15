# Mail inline sign-in and disconnect policy

## Latest user decision

2026-10-15: Mail authentication uses an ID/password form in the conversation. A valid existing session requires no credential entry. A disconnected mail session is logged out, background retries stop, and Windows receives a concrete notification leading back to the form. This replaces the automatic recovery/backoff implementation considered earlier in this session. GHES token authentication remains separate.

## Implementation

- `MailLoginForm` holds credentials in ephemeral input elements, not React conversation state. A trusted Electron-only `portalCredentials` request goes straight to main, never the worker or LLM. Password input clears on submission; payload fields clear on completion; unmount clears inputs. No password persistence or diagnostic logging.
- `portalSession` verifies the actual fixed identity/folder APIs first. A verified existing session starts normal collection without another credential request. OS network status and portal URL alone never establish success.
- A hidden, sandboxed `MailCredentialLogin` loads the existing portal home and lets Chromium perform SSO navigation and native POST/opener popups. It submits once to the actual form, not a reverse-engineered authentication endpoint. No credential replay/retry. DOM polling waits for navigation only.
- Submission requires HTTPS, an allowlisted Samsung host, `/loginapp/login`, one visible password input, one unambiguous username input, same-origin POST, and an unambiguous submit action. An unsupported form, MFA, different SSO host/path, insecure HTTP or timeout stops with a fixed code. No bypass of company policy, TLS, or additional authentication.
- On connection failure, main aborts in-flight reads, stops the polling timer, disconnects the runtime account and clears Samsung portal cookies in the app session. Original mail/attachments/wiki remain. Old callbacks cannot overwrite a new session. Cookie removal does not revoke a server session globally or sign out the external browser.
- Chromium cookie removal operates at registrable-domain scope: Samsung `.net` and `.com` cookies in this app are removed. GHES `code.sdsdev.co.kr` and AI provider cookies are not targeted. A clearing failure is explicit and does not silently reuse the old session.
- A real Electron Windows Notification names the affected service and asks the person to check company network/VPN and sign in. Duplicate notices coalesce. Click focuses Nubi and opens the form. A background failure does not immediately navigate away from an editor.
- 401, 403, network, TLS, malformed HTML and 429/503 remain distinguishable. Under the latest user policy all connection failures stop the session; this does not claim that a VPN failure proved authentication expiry or company blocking.

## Methodology and sources

Reuse the browser's established session, separate transport/authorization/authentication outcomes, fail closed without automatic credential replay, keep secrets outside conversations, and tie notifications to actual state transitions. No new authentication library was needed.

- [Electron window opening](https://www.electronjs.org/docs/latest/api/window-open/) — native popup/opener behavior.
- [Electron Session](https://www.electronjs.org/docs/latest/api/session) — cookie lifetime and domain-scoped removal.
- [HTTP response semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) — transport/401/403 are distinct.

## Evidence and limits

41 focused tests passed. They cover HTTP classification, actual bundled submission script, cookie-clear scope, stopping all retries, silent existing-session reuse, late failures after logout, approval transport failure, one credential submission, payload clearing, and Windows notification routing with a fake Notification implementation.

`node scripts/check-mail-recovery-ui.mjs` renders the real form in Chrome at 1000 and 600 px, tests password clearing, session reuse without input, one request per submit, no conversation API calls, HTTPS form submission, rejection of HTTP actions and ambiguous username inputs. SSO responses are mocked. Artifacts: `verification/mail-session-recovery-2026-10-15/login-form*.png` and `result.json`.

`node scripts/check-mail-inline-sso.mjs` also passed in actual Electron: the hidden form submitted one native popup POST, returned through `window.opener`, kept every window hidden, cleared the temporary credential object, and closed all login windows. Actual Chromium cookie removal deleted the synthetic Samsung cookies while preserving the synthetic GHES cookie. HTTPS was intercepted by an isolated synthetic session. Evidence: `verification/mail-session-recovery-2026-10-15/electron-sso.json`.

Actual Samsung SSO DOM, its login endpoint scheme, MFA and Windows 11 OS toast rendering are **not verified here**. A company environment must confirm that the actual login form matches the supported contract. Earlier `retrying.png`/`narrow.png` files represent the superseded recovery proposal, not current behavior. Electron source build, TDZ checks (354 files) and icon checks (70 icons) passed. No installer release in this task.
