# Mail expiry confirmation and login waiting

The installed 1.2.9 was reported to leave the native confirmation on `abnormal-logout` open and then terminate authentication. This change addresses observable code gaps; the real company popup has not been inspected from this Mac.

## Changes

- Recognize known session-expiry messages in both native `alert` and `confirm` on the configured portal/login origins and exact Samsung login hosts. HTTP and HTTPS variants are accepted without changing transport policy.
- Accept once per document, at most three times per owned mail login tab. Arbitrary confirms, prompts, credentials, spoofed origins and nonstandard ports remain excluded.
- Subscribe even when the debugger is already attached. For newly loaded login tabs, initialize the blank renderer and enable Page dialog events before loading the portal. Preserve Chromium popup ownership and original POST data.
- Keep API probes paused while a dialog, redirect or login page awaits input. Login input has no five-minute timeout. Explicit cancellation still stops the connection.
- Treat interactive 401/403 and delayed shared-session verification as authentication pending. On the portal home, probes back off from 2 to 10 seconds; success requires the fixed mail API on the shared session. Do not replay SSO requests or auto-submit credentials.
- Keep the existing background collection failure/disconnect policy. This is an explicit interactive-login recovery only.
- Use the existing browser guide and mail connection progress form for the automatic transition state. No new modal.

## Evidence

- Focused mail lifecycle and dialog checks: passed. Includes manual unknown confirmation, trusted/untrusted origins, debugger reuse, cancellation, delayed background verification, and login waiting beyond 20 minutes with a simulated clock.
- Native Electron isolated HTTPS fixture: abnormal logout alert and portal-home alert/confirm advance to login automatically, wait for user login, preserve POST/opener, verify the shared mail session and close only owned login tabs. DOM logout-page buttons remain manual; the reported native popup is the automatic target.
- Mail UI browser check: passed, including 440px layout and keeping the login alive when the settings modal closes.
- Company SSO and a user Windows 11 PC have not been exercised here. Windows CI and installer evidence must be recorded separately for the rebuilt release.
