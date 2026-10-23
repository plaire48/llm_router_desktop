# Workspace rendering responsiveness

The change preserves the existing palette, shaders, springs, display-frame motion,
modal focus ownership and business execution contracts. It removes work that was
competing with input on the renderer thread.

## Causes and changes

- A local class/role update previously queried 499 unchanged message subtrees
  1,996 times in the 500-message regression. Local facts now inspect changed
  subjects, their ancestors and newly added subtrees. Global layout attributes
  still update in the MutationObserver delivery before paint.
- The navigation baseline contained synchronous WebGL context/shader preparation:
  two tasks over 50ms, maximum task 62ms and maximum frame interval 116.7ms.
  Background colour fields, navigation/tab glass and the loading/project 3D ring
  now create contexts and render on module workers using OffscreenCanvas.
- Worker transport permits one frame in flight and one replaceable latest frame.
  A slow GPU cannot create an unbounded message queue. Hidden/covered surfaces
  drop pending frames. Disposal terminates the worker, and context restoration
  retains the same geometry/palette/motion state without replaying user actions.
- Shader completion uses KHR_parallel_shader_compile polling when available.
  Main-thread fallback yields before reading link status. It remains supported
  for environments without canvas transfer and unsplit preview bundles.
- FontFaceSet.ready and the initial atmosphere geometry read forced layout during
  React mount. Loadingdone and ResizeObserver now supply that information after
  layout. Initial motion discovery shares the next-paint coalescer instead of
  forcing style and animation discovery during mount.

No business data, provider authentication, source text, URLs, approval decisions
or execution requests enter these graphics workers. No CSS animation is removed,
and no new :has() selector is introduced.

## Verification

Results, failed intermediate measurements and raw traces are retained under
`verification/freeze-1.3.0/responsive-*`. Performance limits and heap-retention
checks are unchanged. A performance pass must be distinguished from functional
success and instrumented diagnostic traces.

- The 500-message local-mutation regression reads zero unchanged subtrees in both
  normal and reduced motion while publishing and clearing the correct facts.
- Real Chrome OffscreenCanvas workers render the colour field, refractive lens
  and Three.js ring, including actual context loss/restoration and nonempty
  pixel readback. Product worker IPC has no diagnostic commands.
- The Electron optical suite first checks the production worker path, then uses
  the supported direct renderer for uniform-level spring/optics inspection.
- Final test counts, performance verdicts and local UI results are recorded below
  after running the checks. Windows/GPU-driver/installer and live service results
  remain separate.

## References

- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Layout thrashing and batching](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
- [Long tasks](https://web.dev/articles/optimize-long-tasks)
- [Parallel shader completion](https://developer.mozilla.org/en-US/docs/Web/API/KHR_parallel_shader_compile)

## Local results and additional focus recovery

The full unit run completed with 2,679 passed, zero failed and 201 platform /
feature exclusions. An earlier run caught a duplicate renderer import; that
compile error was repaired and the full suite rerun. Do not relabel the earlier
failed run as a pass.

Normal/reduced UI probes each exercise six nested-dialog cycles, six native
popover Escape cycles and a popover action that opens a new modal. The original
shell lock and the new modal's focus remain protected. A proposed native-menu focus change was reverted after the test showed that the
first-run tour stole focus when automation was deliberately disabled to enable
animations. The optical fixture records its tour opt-out and retains the actual
menu Escape/focus assertions; production menu behavior is unchanged.

The full detailed-trace diagnostic covered 20 Chrome/Electron scenes and retained
all heap cycles and timing failures. It found no >200ms freezes, but mail and
navigation still exceeded timing limits with stack/invalidation tracing enabled.
This diagnostic did not pass P1 and is not presented as a clean performance gate.
Untraced qualification is recorded separately below.

## Final qualification

`verification/freeze-1.3.0/responsive-untraced/both.json` records exit 0 for both
Chrome and isolated Electron. Each environment completed all five scenes at
1280px and 440px: 20 scenes total, no unjudged scenes or timing violations.
Every scene had zero tasks over 50ms and zero freezes over 200ms. Maximum measured
input-to-paint upper estimates were 44.6ms in Chrome and 44.9ms in Electron. Both
post-timing lifecycle/forced-GC renderer-retention cycles passed for every scene.
The harness retains all samples and its existing environment-specific limits;
Electron frame samples are diagnostic, not a substitute for its native-input and
long-task requirements. The earlier traces are diagnostics, not a controlled
speedup ratio against this untraced qualification.

Additional final evidence:

- 95 focused regressions passed after the final worker metadata update.
- The actual built Electron optics/navigation/modal journey passed 18 checks
  after explicitly recording the separate first-run-guide opt-out in its test
  profile. The real worker path and supported direct fallback are both checked.
- The atmosphere suite passed 52 checks across default GPU and forced SwiftShader,
  1280/440px, CPU 4x, hide/re-entry, context loss, no-WebGL and reduced motion.
- The dialog growth/shrink/interruption suite passed. The final shared input
  probe passed all 12 nested-dialog cycles, 12 popover cycles, action-dialog focus
  preservation and all three real worker pixel/context-restoration checks.

The full broad UI gate remains incomplete. Five failures were reproduced on an
unmodified archive of baseline `c7d4699410a71bf6033f815b058bf74dffba1305` with the
same dependencies/runtime: mail-dialog semantic color, modal semantic color,
shared accessibility contrast classification, irreversible-action UI and mail
saved-anchor drift of 14px. Logs are retained in
`verification/responsiveness/baseline/`. Other broad failures, including the
all-surfaces applied-list wait and the separate motion Electron launch timeout,
are not accepted as passes or waived. A whole-UI/release pass is not claimed.
Actual product-app Electron fixtures use a test-only mock macOS keychain because
the separate OS keychain consent remains unresolved. Product credential storage
settings are unchanged. Windows/Samsung/SSO/installed-app acceptance is pending.
