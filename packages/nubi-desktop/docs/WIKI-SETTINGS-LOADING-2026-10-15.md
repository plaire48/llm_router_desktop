# Wiki settings loading and navigation

WikiUpdate returned null until the first status request completed, including after an initial request failure. Combined with the library's 200px minimum height, this looked like an empty modal between the completed initialization and document disclosures.

The first request now displays the common TaskProgressBar, short status heading and elapsed seconds. The percentage is omitted because the status request has no reliable denominator. Failure displays an error and retry action; completion replaces the progress card with the existing update controls. The library no longer reserves a fixed empty height. Common dialog chrome and spacing tokens remain unchanged.

Clicking the active Mail or Wiki navigation button now returns to Home using the shared home handler. It closes the screen and auxiliary pane, not the running agent or background wiki/mail work. Existing saved conversations remain available.

Verification: delayed-response React/CX fixture at 1280px and 440px covered immediate progress, elapsed time, failure/retry, successful replacement and overflow. Isolated macOS Electron verified Mail -> Mail -> Home and Wiki -> Wiki -> Home, then existing graph interactions. Identity check, TDZ check, wiki-update-view tests and Electron renderer build passed. No Windows/live mailbox validation or release was performed.

Screenshots: verification/wiki-settings-loading-2026-10-15/.
