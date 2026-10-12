# Readability and GHES profile follow-up

## Changes

- Skill search omits the result-count suffix and the catalog-wide plugin-issue disclosure. Per-skill install failure and reconciliation controls remain.
- Project start omits the static automatic-wiki caption. Actual initialization progress remains.
- User bubbles and metadata use normal layout flow. Pending input, queue admission and final user messages keep their own footer at a 4 px gap. Touch targets remain 44 px on coarse pointers.
- Browser address uses a 36 px rounded rectangle and one padding layer. Commit rows use an 8 px corner and 8 px vertical padding.
- GHES identity follows the existing AI Workspace and E2E Report structure: photo/name/login, biography, basic information, compact actions. The repository shortcut is removed.
- Narrow toolbar rules hide only the name, not the avatar. Native GHES identity includes bounded biography/location fields and follows at most two same-origin photo redirects under one 5 second deadline. Credentials never follow external photo redirects.

## Verification

- Electron build and identity token check passed.
- Shared browser fixture suite passed, including queued-to-pending-to-consumed input geometry at 1280, 620 and 440 px.
- Modal fixture suite passed, including connected profile at 1280 and 440 px, picture loading, visibility and keyboard return.
- 21 native GHES contract tests passed. Real company GHES profile/photo retrieval is not verified by these fixtures.
- Existing Windows installer run 38207117888 passed before these new UI changes. Its reports measured Finish-to-window 2.64 seconds and 93 old-install removal updates. That installer does not contain this follow-up.

References: local `ai_ai/src/AccountProfile.jsx`, `e2e-report/src/AccountProfile.jsx` and shared Workspace dialog tokens. No additional UI dependency introduced.
