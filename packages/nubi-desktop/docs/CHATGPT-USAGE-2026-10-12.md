# ChatGPT usage visibility — 2026-10-12

## Behavior and cause

- The composer keeps its context ratio ring and adds a compact token count in the same button. Exact numbers and measurement source remain in the tooltip and details. Estimated counts use ≈. This is the current conversation context, not an account quota.
- Before an actor response completes, persist an estimate of the actual request messages and advertised tools. Replace it with normalized provider counters when a successful answer arrives. A failed/missing usage response never becomes a measured zero. Planner, reviewer and other conversations do not become the current conversation measurement.
- Account refresh and the two-second ledger poll used the same revision counter. A poll arriving during a slow quota request invalidated its UI result; the user had to wait for another poll. Pause ledger polls during an explicit quota request, invalidate earlier reads, and release the gate on success/error/close. Closing/reopening still rejects obsolete responses.
- The shared native provider did not forward ChatGPT's onMeasurement callback. Terminal responses that reported usage and then failed validation lost those counters. Preserve the report for the ledger's finally path, while preserving the failed answer state. Successful reports are still counted once.

## Reuse decision

Reuse the existing Pi Responses transport, same-stream observer, normalized usage ledger, CX ContextMeter and UsagePanel. No new tokenizer or accounting SDK is introduced. SDK placeholder zeroes cannot distinguish missing upstream metrics; local estimates are useful for the composer but must not fill historical app totals or account quota. The existing account endpoint and five-minute cache contract are unchanged. The optional token count is enabled only by Desktop.

## Verification

- 51 focused runtime regressions passed, including the real bundled Pi decoder with synthetic Responses SSE, Desktop actor → gauge → ledger, failed terminal usage, unknown usage and persisted ledger reload.
- Real Workbench rendering with synthetic RPC at 1280, 440 and 360 px: compact token count, one-row controls, context details, delayed 3.2-second quota, immediate result application, and cache reuse after reopening passed. Screenshots are in verification/chatgpt-usage/.
- Electron source build and Desktop identity checks passed.
- Shared extension identity gate: 1,716 unit tests, design, candidate build and the first two browser suites passed. The PDF browser suite timed out waiting 25 seconds for an extension service worker; the full gate remains failed (extensions/aipro-chat/verification/pre-release-2026-10-12T06-59-01-202Z/report.json).
- Focused extension usage-browser and account-usage-browser both passed with the full Playwright Chromium executable. They cover distinct zero/missing usage, saved totals, repeated frames, quota refresh/reopen, 401 refresh and stale/error states. This focused result does not replace the failed full identity gate.
- No live ChatGPT account or Windows installed build was verified. No installer was generated or uploaded. Existing installed apps require a subsequent updated build.
