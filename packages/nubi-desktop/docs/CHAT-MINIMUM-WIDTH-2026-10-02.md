# Chat minimum width

User decision: the compact composer must keep its tools on one line while either sidebar is resized. Model and approval controls keep only their icons at compact widths. Their accessible names, tooltips and menus remain available.

## Implementation

- Reuse the shared Nubi composer and the existing pointer/keyboard sidebar resize hook. No new layout dependency.
- At composer content widths of 560px or less, hide the model/approval labels and chevrons. Keep reasoning, context usage and send/stop controls on the same row.
- Measure the rendered compact control widths, group gaps, input-card borders and reading-column insets with ResizeObserver. Child changes and font readiness trigger recalculation. This includes an additional queued-send, stop or input-expansion control when present.
- Share that minimum between left-sidebar limits, right-sidebar limits and the conversation column. The initial fallback is 380px until a composer is available.
- Use overlay sidebars when the window cannot fit the minimum chat, project list and auxiliary panel. Closed sidebars release their space. Opening a compact project list does not reduce the conversation further.

## Verification boundary

Electron build completed. Manual observation of the real-worker web surface at 1180px showed a 372px conversation minimum, a 324px composer and a 296px tool row. The tool row had equal client and scroll widths and nowrap layout. Both sidebar keyboard expansion limits preserved the minimum. Compact approval still opened its existing menu. These are observed dimensions for the current controls, not a fixed product-wide minimum.

No automated tests or model calls were run. Windows rendering and installer behavior were not measured.
