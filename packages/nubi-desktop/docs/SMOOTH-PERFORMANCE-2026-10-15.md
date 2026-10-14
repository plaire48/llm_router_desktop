# Smooth transitions and repeat-work reduction

Preserve the existing design, layout and animations. This follow-up improves the requested soft modal movement and responsiveness; it does not change authentication, model execution or approval policy.

## Findings and changes

1. **Navigation clicks during a screen transition were lost.** A physical mouse click reproduced a target of `html` rather than the Settings button. Setting `pointer-events:none` on the overlay alone was insufficient because the captured root contains the navigation. Root and toolbar now remain outside snapshots. Main/sidebar/auxiliary panes keep their transitions. New interaction skips a stale transition, pending state updates execute once and in order, and temporary listeners are removed on completion.
2. **Large polled state was serialized twice per comparison.** `mergeSnapshot` now compares JSON fields and reuses unchanged nested records. Deletions, question changes, source references and approval state are retained accurately. The active conversation layout is memoized by its task object, avoiding recomputation while typing or when another task changes. No records are truncated or removed.
3. **Modal movement uses a small elastic settle.** Opening remains 360ms, resize 360ms, closing 220ms. The resize surface receives the elasticity; live text remains at its final geometry. Reduced motion, interruption and focus are preserved.
4. **Closed modal scroll records are released.** A leaving picture no longer retains detached scrolled elements in the offset map after its exit completes.

## Measurements

Synthetic 50 tasks / 500 messages, approximately 5.74MB JSON, 30 repetitions excluding parsing/transport: merge median **11.00ms → 0.73ms**, p95 **13.80ms → 1.08ms**. Existing messages retain their object identity after a streaming update. This is a snapshot-processing measurement, not an overall app speedup.

Actual macOS Electron, isolated small Git project, 3 launches per set: first-screen median **407ms → 416ms**, project-ready **1,223ms → 1,229ms**, frame-interval p95 median **20.9ms → 21.0ms**. No 50ms long tasks in either measured transition set. Startup and ordinary transition timings were effectively similar; OS noise and automation stability waits are not a claimed improvement. The opening cinematic is skipped by automation.

## Validation

- 17 focused tests: state sharing/removal, transition interruption/order, conversation activity, session navigation, optimistic sending and modal contracts.
- 8 rendered motion checks: grow/shrink/interruption, stable text/focus, repeated close/open, reduced motion, 440px, real modal flow and physical navigation click during a transition.
- Final local Electron build passed, including icon and TDZ checks. Identity check passed.
- All-surfaces: 115 checks passed, including narrow windows and 200% text. Results are saved in `verification/all-surfaces/diagnostic.json`.
- Recording and reproducible results: `verification/smooth-performance-2026-10-15/review.html`.

Real Windows 11, a large connected mailbox, company SSO and live model/server wait times are not measured here. No installer was published.

## Method and alternatives

Reuse existing Web Animations, View Transitions, React memoization and immutable JSON state. No new animation or state library is needed. Shortening or removing all animation would hide the input problem rather than fix it. Do not animate width/height every frame or scale live modal text.

- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance): avoid blocking renderer work and measure individual phases.
- [Chrome same-document transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document): snapshot lifecycle and interruption.
- [CSS working group hit-testing clarification](https://lists.w3.org/Archives/Public/public-css-archive/2025Jan/0810.html): the overlay and captured elements have distinct hit-testing limits. The actual UI test was necessary; a CSS-only assumption failed.
