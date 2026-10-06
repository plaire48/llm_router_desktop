# Conversation surround and responsive controls

## Applied design

- Reuse the existing auxiliary surface gradient as `--nubi-workspace-gradient`. Add a soft blue and mint surround to the conversation and input dock. Keep the composer opaque and the body text in the existing brand colors.
- Size reading insets from the remaining agent column, not the overall window. Conversation, queue and composer keep the same reading width and edges.
- Collapse the approval label first, then the model label in a narrower composer. Preserve the selected reasoning label, context donut, skill, send and stop controls. Icon controls retain accessible names and tooltips.
- Reserve the minimum reading inset in the existing one-row toolbar calculation. A wide agent no longer reserves its wide padding as a permanent resize limit.
- Compact file tab titles and header gaps from the auxiliary pane width. Tab close actions and full-path tooltips remain available.
- Clamp the reasoning dialog to the visible agent column so an expanded sidebar cannot cover its slider or close button. Keep its anchor fixed when changing reasoning levels.

## Basis and adoption

Use native CSS container queries and the existing ResizeObserver-based sidebar contract, following [MDN container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries). The actual component container is the responsive boundary. Reuse Nubi/CX controls rather than adding a UI dependency. Preserve text size and control meaning while reducing labels and spacing, following the information-density skill. No new preference controls are necessary for this request.

Keep the established 75% context policy, static model hover, transcript scrolling, minimum agent width, drafts and file buffers. This change does not alter authentication, model requests or runtime permissions.

## Verification boundary

Electron build and manual example-data preview only. No automated tests. The running authenticated Electron window must retain its current state until the pending reload/restart approval arrives; preview evidence does not confirm the update in that window or Windows.

- Final `npm run build:electron`: exit 0.
- At a 1480px layout, a 740px agent column retained the complete toolbar. At 624px, the approval label collapsed while the model name remained visible. At the measured 334px minimum, all six toolbar actions stayed in one row (294px client and scroll widths with menus closed).
- Conversation and composer edges matched at the minimum width (332–642px) and with the right pane closed (550–1250px). Closing the pane restored the model/approval labels and retained the same input draft.
- The narrow reasoning dialog stayed inside the agent bounds (dialog 390–646px, agent 320–654px). Example-data console errors: none.
- Restored the sidebar default width, removed the temporary preview draft, and reset the responsive viewport override. Screenshots: `evidence/chat-surround-wide-detail-2026-10-04.png` and `evidence/chat-surround-compact-detail-2026-10-04.png`.
