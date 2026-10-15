# Mailboxes and approval navigation

- Four stable Korean mailbox tabs replace raw server folder names and extra folder tabs. Existing stored folder selections migrate to categories; portal IDs and stored originals remain unchanged. Imported inbox/sent mail is included by the existing category search. Approval documents stay in their separate tab.
- Preserve the Mail/Approvals tab on re-entry. Citation-driven mail opening explicitly returns to Mail. Imported approvals arriving in asynchronous status select their local view when disconnected.
- Previously the portal list awaited every approval body to resolve titles. Return rows immediately, hydrate missing titles with at most four workers, reuse the host body cache on selection, and ignore results after page changes or unmount. Authentication failure stops further title scheduling. No endpoint, login partition or approval write permission is added.
- Shared segmented controls, icons and typography remain. Narrow mailbox tabs scroll on one line; approval table columns retain one-line headings.

## Evidence

`verification/mail-navigation-2026-10-15/` contains rendered Chrome screenshots and assertions at 1100, 600 and 440px. The fixture checks all four category search requests, title loading without blocking rows, body rendering, pagination and re-entry. These synthetic portal responses do not prove company SSO or production approval API success on Windows.
