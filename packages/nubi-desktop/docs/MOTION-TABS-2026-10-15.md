# Dialog motion and document tabs

## Result

Dialog content changes now bridge the old and new surface bounds instead of snapping. A short elastic entrance uses the shared 360 ms token. Resize uses a gently elastic 360 ms settling curve; close remains 220 ms. Buttons, focus, Escape and approval state are not delayed by animation. The follow-up smoothness review keeps root/navigation out of screen snapshots so another navigation click remains available during transition; see `SMOOTH-PERFORMANCE-2026-10-15.md`.

The auxiliary file/web/terminal strip displays an icon and single-line name. The active tab has a white surface and an inline close action. Other close actions appear on hover or keyboard focus; touch shows them persistently. Tabs scroll horizontally. ResizeObserver keeps the entire selected tab visible when a web title or pane width changes. The file breadcrumb is a separate quiet rounded row and reveals the current file on selection.

## Implementation decision

Reference: https://jobda.acca.ai/static/video/tutorial/VIDEO_BASIC_SELF_INTRODUCTION.mp4

The reference's continuous card resizing is adapted to the existing CX modal lifecycle. It is not copied as an asset. No animation dependency is added. ResizeObserver measures a mounted panel after actual layout changes. An inert, inaccessible surface animates transform only from previous to new bounds, while the actual content takes its final layout and fades in briefly. This avoids stretching glyphs and avoids animating page layout every frame. Native Web Animations handle cancellation and cleanup.

Reduced motion, hidden windows and ordinary automated checks disable the effect. The dedicated motion check explicitly enables the production motion path under automation. A viewport resize cancels the old surface and immediately fits the new viewport. Streaming text and list rows have no added animation. Existing provider colors, Nubi character, approvals and authentication flows are preserved.

## Verification

- `node scripts/check-dialog-motion.mjs`: 7 checks, normal/reduced motion, resize interruption, natural text transforms, focus, close/reopen cleanup, real tool list → skills → registration flow, 440 px viewport.
- `node scripts/check-electron-shell.mjs`: isolated native Electron project, edit/save/readback, terminal, browser, tabs, active-tab visibility and expanded dock. See the current `verification/electron-shell.json` for results.
- `node --test tests/modal-motion.test.mjs`: 3 passing source contracts.
- `node scripts/check-identity.mjs`: passed.
- `npm run build:electron`: passed.

Artifacts: `verification/motion-tabs-2026-10-15/review.html`, actual modal test recording `dialog-motion.webm`, native tab screenshots. Test fixture data is labelled as such. This is macOS Electron/Chrome validation, not Windows 11 performance or company-service authentication validation. No installer was published.
