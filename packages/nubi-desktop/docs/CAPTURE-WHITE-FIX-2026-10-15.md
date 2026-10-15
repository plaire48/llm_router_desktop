# In-app browser capture repair

## Findings and implementation

The capture selector is a dialog. BrowserPane intentionally hides the native WebContentsView behind dialogs, leaving an empty viewport when the selector previously drew over the live app. Capturing the parent WebContents also omits its sibling browser WebContentsView. The native fixture reproduces this difference with pixel checks.

- Capture the visible window and browser view before opening the selector. Compose the browser pixels at its actual content bounds, then apply the existing clip/output limits for agent captures.
- Show that frozen frame at the same viewport position. Crop the displayed frame for attachments instead of taking another screenshot after selection. Page navigation or animation cannot silently change the selected evidence.
- Window capture excludes hidden tabs and refuses visible authentication/session views. Check browser revision, active tab, bounds and window size after capture. Same-URL main-frame navigation also changes the revision.
- A DOM-ready page can lack its first compositor surface. Retry only Electron's specific missing-surface failure, at most four attempts separated by 50 ms. Temporarily allow background painting during this recovery and restore throttling in finally. No reload, focus change, TLS change or permanent animation loop is introduced.
- Set view bounds before showing it. The browser menu captures before opening the save dialog and reports failures through the existing error notice.
- Use existing capture UI, spacing, icons, keyboard cancellation and attachment chips. No new package dependency.

Electron's documented capture behavior was checked against the installed API and official [webContents capturePage documentation](https://www.electronjs.org/docs/latest/api/web-contents/#contentscapturepagerect-opts). A white-pixel heuristic was rejected because a valid page can be white. Readiness failures and document changes must stay explicit.

## Verification

- Eleven focused Node tests passed: capture recovery/cleanup, host bridge, region/DPI limits, stored attachment payloads and image-model routing.
- `node scripts/build-electron.mjs` passed. Existing capture UI checks passed at 420 and 1280 pixels, including page and window region/full selection.
- Native Electron fixture: old parent-only screenshot lacks the green browser; composed window and region match its real pixels. Hidden tabs excluded, authentication guarded, navigation race refused. Throttling restored after missing-surface recovery.
- Actual Workspace renderer with isolated storage and a synthetic connected-model status: local HTTP page, capture selector, region attachment and Escape cancellation. After opening the selector, change the live page from green to blue: attached pixels remain the selected green frame. No real model request or account login is needed for these checks.
- Evidence: `verification/capture-white-fix/`. The parent screenshot is not evidence of a failed page load: it intentionally reproduces the missing child-view capture.

These are macOS Electron/local-page checks. Installed Windows capture and a specific company page still require Windows/company-network verification. No installer release was made.
