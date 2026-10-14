# Load secondary screens on demand

The user asked to split JavaScript so initial loading does not hold up the interface. This extends the October 14 artwork extraction and embedded Workspace splitting.

## Change

Workbench now dynamically imports WikiBrowser, MailHistory, SkillManager, MailLibrary, McpPanel and SkillRegistration. The chat, navigation and approval controls remain immediately available. Each screen has a local Suspense fallback and error boundary so a failed chunk does not replace the application shell. Explicit retry uses a fresh lazy type and reuses the successful retry when the screen is reopened. Routine parent updates do not recreate the screen type or reset its inputs.

Existing fonts, CSS, transitions and reduced-motion behavior remain. CSS stays in the existing renderer stylesheet, avoiding missing styles on first screen entry. No dependencies or worker runtime were added. This is code loading deferral; it does not parallelize JavaScript execution or reduce model/server latency.

Basis: React's [lazy](https://react.dev/reference/react/lazy) and [Suspense](https://react.dev/reference/react/Suspense) contracts, with lazy types created outside normal renders and a local boundary instead of suspending the full app.

## Measured bundle result

Same esbuild settings, minified renderer entry and its static JavaScript dependency graph:

- Before: 1,972,091 bytes.
- After split and retry recovery: 1,799,414 bytes, 8.76% less initial JavaScript.
- Separate image/CSS files are excluded from those JavaScript counts. Total installed code is not reduced by this percentage.
- This is additional to the earlier 4.82 MB to 1.97 MB change, not a new full-app speed claim.

## Checks

- Actual bundle graph test: all six screens absent from initial static dependencies; original shared PNG still emitted exactly once.
- Browser boundary fixture: no load before opening; typing during delay; failed load preserves chat draft; explicit retry; parent update preserves screen input; successful retry reused on re-entry.
- Mail UI regression: portal connection states, diagnostics, narrow layout and folder import controls passed with synthetic data.
- Native Electron: code Wiki edit/save/readback/graph and five-category recursive EML import/dedup passed with temporary local files.
- Native Electron 3 launches: AI Workspace, mail and settings opened; 2 real view transitions per run; no renderer exceptions or observed 50 ms long tasks in sampled transitions. Other local QA ran concurrently, so these timings are not a controlled before/after speed comparison.
- Identity, icon/TDZ checks and Electron build passed. Focused renderer/timeline/conversation tests: 6 passed.

No live company login, model call, Windows performance or release verification is claimed.
