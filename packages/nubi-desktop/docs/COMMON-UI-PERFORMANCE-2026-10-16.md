# Common UI and filter responsiveness

## Changes

Keep the approval-based collection table and existing modal/motion identity. Mail, wiki and AI Workspace column filters now share `ui/filter-panel.css` for surface, padding, title/body typography, checkbox rows, icons and apply/reset controls. This removes the old filled selection tiles and differently styled footer buttons in the workspace filter.

`useFilterPosition` owns positioning for the three filters. It coalesces outer scroll/resize events into one animation frame, ignores internal option-list scrolling, and skips state updates for unchanged geometry. ResizeObserver tracks the actual popup size. Opening focuses the search field where available without scrolling the screen. Existing apply, cancel, Escape, outside-click and focus-return behavior remain intact.

Large option lists initially render 60 entries and expand through the existing ShowMore control. Search still examines all values. Mail's whole-filtered-result selection and Workspace's whole-option selection retain their prior semantics. Selected values outside the visible 60 are preserved. Set membership replaces repeated array scans; closed mail filters no longer search the sender catalog. Mail row selection also uses a cached Set.

No animation was removed, no timer invents progress, and no new UI dependency was introduced. Reused existing bounded-list rendering, memoization, animation-frame batching and compositor-based dialog transitions. Full virtualization was not necessary for these selectable filters and would complicate focus and selection preservation.

## Measurement

Same 5,000-option workload, real UI components, three independent page loads, Chrome with 4x CPU slowdown on this Mac. Opening is measured from an in-page click until two animation frames; it is not native keyboard INP or Windows timing.

| Median | Before | Final candidate |
| --- | ---: | ---: |
| Mail sender filter | 690.3 ms | 49.4 ms |
| Workspace value filter | 3,018.7 ms | 52.8 ms |
| Initially mounted checkboxes | 5,001 | 61 |

`node scripts/measure-filter-performance.mjs candidate` also verifies expansion, searching the 5,000th option, applying a selection beyond the initial page, preserving 4,999 other selections, and popup bounds at 1100 and 360 px. Evidence: `verification/filter-performance-2026-10-16/{baseline,candidate}.json` and screenshots.

## Verification boundaries

- Electron all-surfaces fixture audit: 115 screen/modal cases including narrow windows and enlarged text passed. The first attempt timed out while a bundle rebuild ran; after the build finished the identical audit passed. Do not rebuild the Electron bundle during an Electron launch check.
- Wiki/community browser checks passed, including 24 filter combinations, edit/save, navigation and draft retention.
- Dialog motion checks passed normal/reduced motion, interrupted resizing, repeated opening/closing, focus return and immediate clicks during a transition.
- Mail stability checks passed arrivals, selection, scroll, reader, explicit update, pagination, refresh failures and account switching.
- Identity, initialization-order and icon checks, six approval-search unit tests and the local Electron build passed.

These are local fixtures and build checks. Corporate SSO/data volume, Windows 11 installation and actual network/model latency are not covered. No release was published. Performance gains above apply to the measured filters, not every operation in the product.

## Final runtime checks

- 240-message chat fixture, 4x CPU, three runs: median input-to-two-frames 33.2 ms; median per-run p95 35.4 ms. History reading position and older-message access passed. This is a regression measurement, not a newly claimed chat speedup.
- Built Mac Electron, isolated small Git project, real view transitions: three runs reported no long tasks in the sampled interactions; frame p95 was 21.3–21.5 ms. Automated click-to-visible timings (including animation/actionability) were 829–839 ms for AI Workspace, 847–855 ms for mail, and 78–90 ms for settings.
- First app screen took 5.49 s on the first launch, then 0.35/0.34 s; project ready 6.29 s then 1.16/1.16 s. This cold-start outlier remains a follow-up profiling target. Do not present the filter improvement as eliminating every startup delay.
- Evidence: `verification/chat-rendering-2026-10-15/smooth-common-20261016.json` and `verification/performance-2026-10-14/smooth-common-20261016.json`.
