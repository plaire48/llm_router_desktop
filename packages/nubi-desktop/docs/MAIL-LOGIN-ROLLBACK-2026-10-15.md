# Restore interactive portal login

User rollback on 2026-10-15 removes the recent conversation ID/password form and hidden automatic submission from the active product path. Login first checks the existing session; otherwise it opens the original in-app portal browser, preserving native redirects/POST/opener and the app's existing session. No credential input is requested by the chat. The former `portalCredentials` IPC is explicitly refused and the MailPortal credential adapter entry point removed. Its standalone reference module/tests remain outside the active bundle.

A background disconnect still stops collection and produces the existing system notification. It does not open a browser automatically. Explicit login and notification clicks start login. Existing originals, storage-location onboarding, five-minute collection and other mail improvements remain.

Verification: 25 focused tests and Electron build passed. An actual Electron renderer with a synthetic portal connection verified the browser-open flow, absence of credential inputs, rejection of obsolete credential IPC, session reuse and notification-click-only behavior. This is not company-network or Windows SSO proof. No installer release.
