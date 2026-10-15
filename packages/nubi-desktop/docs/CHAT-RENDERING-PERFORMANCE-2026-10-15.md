# Long conversation rendering

The user reported stuttering as messages accumulate. Preserve the existing layout, motion, approvals, citations, text selection and scroll behavior.

## Applied changes

- Reuse unchanged message rows with React memoization and stable event delegates. Read current handlers after each commit rather than retaining stale project/source callbacks. The existing immutable snapshot merge supplies stable message references. Questions, the latest answer, review placement and regeneration state remain live.
- One IntersectionObserver per transcript tracks visibility with a 200px margin. Pause offscreen mascot animations and apply `content-visibility:auto` using the observed row height, rather than guessing a fixed height. Loaded rows stay in the DOM for selection and accessibility; visible motion resumes normally. Release observers when the conversation unmounts.
- Keep the existing scroll controller. Avoid scanning every user message when following the bottom or reading history; only the explicit turn-anchor mode needs that scan.
- Earlier changes already defer image and executed terminal content until disclosure expansion. They remain in place.

## Benchmark and alternatives

- [React memo](https://react.dev/reference/react/memo): adopted row-level reuse with stable, current callbacks. Merely wrapping a list while recreating all its props would not help.
- [Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API): adopted a shared viewport observer instead of per-frame geometry loops.
- [content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility): adopted automatic offscreen rendering skipping. Do not use `hidden` or remove already loaded history nodes.
- [Virtuoso message-list scroll control](https://virtuoso.dev/message-list/scroll-modifier/): reviewed separation of append, prepend and explicit scroll intent. Kept the existing tested scroll controller. A new virtual-list dependency would require migrating dynamic question/approval blocks, selection and history searching, so it is not introduced in this focused change.
- Deferred input/list scheduling alone would reschedule the expensive painting without removing it. No global animation removal, content deletion, approval delay or new dependency was added. Codex/Claude private implementation is not claimed as a source.

## Measurement

Production Workbench fixture, 240 messages including Markdown tables and lists, Chrome with 4x CPU throttling. Three independent runs, 30 controlled input changes per run. Each sample measures dispatch until two animation frames; this is a repeatable local rendering proxy, not native keyboard INP or model latency.

| Median across runs | Before | Row reuse + offscreen rendering |
|---|---:|---:|
| Input-to-two-frames median | 269.7ms | 33.8ms |
| Input-to-two-frames p95 | 284.6ms | 49.8ms |
| Script time across 30 changes | 1,038.1ms | 120.7ms |
| Task time across 30 changes | 8,020.5ms | 958.1ms |

Row memoization alone reduced script time to about 140ms but left input frames near 250ms; offscreen rendering was necessary. At this first measurement all 240 messages remained mounted. Initial opening was approximately 0.8s. The subsequent recent-first loading pass below addresses that separate bottleneck.

Raw results: `verification/chat-rendering-2026-10-15/baseline.json`, `candidate.json`, `candidate-viewport.json`. Reproduce with `node scripts/measure-chat-rendering.mjs <label>`.

## Verification boundary

Local browser checks cover reading position while typing, older messages remaining accessible, streaming/admission scroll behavior, visible question/command approvals at 1280/440/360px, capture expansion, and same-image preview. New live-snapshot/visibility assertions verify offscreen animation pause/resume and updated final message rendering. Windows 11 performance, connected mail/provider load and installed-app performance require separate measurement. No installer or release was published.

Completed: scroll, decision-flow and conversation-captures browser scripts passed; `measure-chat-rendering.mjs verify` passed the narrow-view animation and immutable-snapshot update assertions. Six snapshot/activity unit tests, TDZ/icon/design checks and local Electron build passed. The live fixture initially returned a mutable shared object unlike the real IPC boundary; it now clones initial state before validating updates.

## Recent-first cold opening (follow-up)

Render the latest 40 messages first, then prepend 40 at a time when the top marker enters view. A keyboard-accessible previous-history button uses the same path. Keep loaded rows, stable keys and DOM identity; restore the first visible row's position after a prepend. Existing pending questions and active-run anchors expand the window when necessary. Never delay approvals behind history loading. Storage and the app's full-history search are unchanged; browser-native Find only sees loaded DOM rows.

Keep the existing scroll controller and use the reviewed Virtuoso prepend/scroll-intent pattern without introducing a new list dependency. A new virtualization dependency would require reworking dynamic approvals and text selection. This bounded initial rendering change preserves them.

| Three-run median, 4x CPU | Before | Recent-first | Reduction |
|---|---:|---:|---:|
| 240 messages | 795.8 ms | 214.7 ms | 73% |
| 1,000 messages | 3,129.8 ms | 214.9 ms | 93% |

Initial mounted messages: 40 in both cases. Total DOM elements: 7,788 → 1,492 (240), 31,728 → 1,492 (1,000). Timing is an in-page conversation click until two animation frames in the production Workbench fixture, excluding application startup, storage/IPC and model latency. The initial task snapshot and activity grouping still contain full history; this is not a claim of bounded memory or arbitrarily large database loading.

Evidence: `verification/chat-cold-open-2026-10-15/{baseline,candidate,regression}.json`. Reproduce with `node scripts/measure-chat-cold-open.mjs candidate` and `node scripts/check-chat-history-window.mjs`.

Follow-up checks passed: recent 40, anchor/DOM identity preservation, automatic prepend, all 160 messages reachable, latest update, append, input stability, reload, and pending question outside the recent batch. Existing scroll, 1280/440/360px decision flow, offscreen motion and progress-display checks passed. Full-history search, snapshot and portal unit checks passed 28/28. Local build, TDZ, icons and design checks passed.

## Mac SSO verification boundary

The isolated Electron portal-login check passed POST/opener preservation, shared persistent session, authenticated background reader, owned-tab cleanup, abnormal-logout/logout confirmation and relogin. The old inline-SSO checker still expected the hidden credential-form behavior the user had reverted; it now delegates to the current portal-login regression rather than restoring that behavior.

Actual company authentication remains unverified: from this Mac, the portal home timed out after 8 seconds and the GHES hostname returned ENOTFOUND. No credentials or cookie contents were collected. Windows 11, installed-app cold opening and actual company/VPN SSO require a later available environment. No installer or release was published.
