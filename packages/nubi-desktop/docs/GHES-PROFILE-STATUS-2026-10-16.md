# GHES profile status visibility

Two source defects caused missing status indicators in Desktop:

- `readProfileStatus` normalized custom image emoji, then `view` parsed the normalized value as raw GraphQL again. Its empty Unicode field caused the image status to become null. The view now retains the validated account-scoped value and checks its expiry.
- The emoji was a sibling of the account name. Compact toolbar rules hide non-avatar spans, including that status. Both the toolbar and profile dialog show status to the right of the name, outside its truncation container. Compact toolbar rules target only the name label, keeping status visible.

Company image URLs still use the existing authenticated image protocol; server HTML is never rendered. A failed image uses a neutral indicator and preserves its name/message in the tooltip. Status deletion, expiration, account generation and logout protections remain. No mood is inferred or invented.

Validation: nine focused host tests passed, including custom GraphQL image status through repeated status/view/cache reads. Production GhesAccount component fixtures verified Unicode/custom image states, removal and expiry at 1100/440/360 px. Local Electron build and identity check passed. Fixtures use synthetic profiles and intercepted images; company GHES and Windows installation are not verified. No release or app restart was performed.

Screenshots: `verification/ghes-profile-status-2026-10-16/`.
