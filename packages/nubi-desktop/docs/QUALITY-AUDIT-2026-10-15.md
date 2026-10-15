# Conversation and runtime quality audit — 2026-10-15

Recent conversation rendering, terminal records and image disclosures were reviewed. Existing UI tokens, approval boundaries and execution behavior are preserved. No installer was published and the user's running app was not restarted.

## Findings fixed

| Issue | Change | Evidence |
| --- | --- | --- |
| A preview reader that never settles leaves a permanent spinner | Read-only preview requests settle after 15 seconds; no automatic retry or command execution | Timeout and late-response unit tests |
| Broken PNG data can leave a blank thumbnail without recovery | Captures offer explicit retry; mail images offer original-source recovery after decoding failure | Chrome fixtures exercise invalid images and recovery |
| A failed old request can interfere with a newer cache entry | Cache generation and entry identity isolate stale requests | Reader switch and retry unit tests |
| Capture caching was bounded only by count | Retain at most 12 entries and 16 MiB of data-URL characters | Budget eviction test; this is not a limit on total renderer memory or decoded pixels |
| A reviewed failed command can display “결과 확인됨” in its collapsed header | Actual running, failed, interrupted and nonzero-exit states take precedence over review labels | Command status regression test |
| A rejected command's expanded record can imply an execution | Display “명령 기록” and “실행하지 않았어요.” when rejected without a process | UI branch review; no process replay added |
| Full-window tool schemas exceeded the 6,000-token regression budget (6,028) | Shorten descriptive wording while retaining argument schemas, limits and approval contracts | Tool-budget and lean-tool tests pass; the budget was not raised |

## Verification

- Initial full unit run: 1,500 tests, 1,268 passed, 36 failed, 196 skipped. Of the failures, 35 were in local socket/server-dependent tests and one was the tool-description budget.
- Reran the 14 affected socket/server test files with local execution allowed: 84 tests, 78 passed, 6 skipped, 0 failed. This includes mock authentication transports, mail retrieval, development-server continuation, MCP and Git credential bridging. It does not establish company network or real account success.
- After the description fix, tool-budget, lean-tools, capture-cache and command-status tests: 16 passed, 0 failed, including six newly added regressions. These are targeted follow-up runs, not a second full-suite run.
- Conversation capture browser checks passed at 1,280 and 440 pixels: exact image, common modal, missing reference, corrupt image, explicit retry, reload and terminal disclosure.
- Mail thumbnail browser checks passed: lazy loading, deduplication, inline expansion, 420-pixel viewport, changed-source recovery and corrupt-image recovery.
- Electron local build, initialization-order check (400 files), common icon check (70 icons) and design identity check passed. Runtime was recompiled after the final description edit.

Logs are local: `/tmp/nubi-quality-audit-tests.log`, `/tmp/nubi-quality-audit-recheck.log`, `/tmp/nubi-quality-audit-design.log`. Browser evidence is under `verification/conversation-captures-2026-10-15/` and `verification/mail-attachments-2026-10-15/`.

## Remaining limits

- Long conversations still mount all message DOM initially. The prior memoization and offscreen rendering work reduces updates, layout and paint, but does not bound initial DOM or all memory. Full virtualization needs separate search, selection, approval, expanded-record and scroll-anchor verification.
- Preview timeout ends the UI wait; it does not abort the underlying host read. No write or process is retried by this recovery path.
- The tool-description change has regression coverage, not a new live-model answer-quality measurement.
- Skipped tests, Windows installer behavior, real PowerShell, company SSO and real provider sessions were not verified by this audit. The results are not an all-features release sign-off.

## Approach

Retained the earlier measured React memoization and IntersectionObserver/content-visibility approach rather than introducing a new message-list library during a fault audit. Used bounded caching, stale-result isolation and explicit read recovery. Official references already reviewed for the preceding performance change: React `memo`, MDN Intersection Observer and CSS `content-visibility`; see `CHAT-RENDERING-PERFORMANCE-2026-10-15.md` for measurements and boundaries.
