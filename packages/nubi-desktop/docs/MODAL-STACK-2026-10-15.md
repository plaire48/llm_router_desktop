# Modal stacking

## Change

All Desktop body modal portals receive their visual layer in opening order. Confirmation dialogs no longer cover a later standard dialog due to their CSS variant. Exit-animation copies keep their previous visual layer and do not enter the active stack. View-transition naming follows the actual top layer.

AI Workspace DetailPanel now delegates to the existing CX DetailPanel. Its separate focus/inert manager previously made a newly opened Workspace panel inert when a Desktop panel remained open. Help, busy guards and feedback placement remain available. No dependency or node_modules patch was introduced.

## Validation

`node scripts/check-modal-stack-ui.mjs` renders real CX and Workspace components in Chrome. It covers confirmation followed by standard dialog, nested Workspace/help, Tab containment, Escape/focus restoration, reopen, closing the parent first, busy guards, exit motion and reduced motion. Fixture records: `verification/modal-stack/result.json` and `stack.png`.

Modal motion unit checks and design identity checks pass. Electron bundles compile. This is local source/rendering evidence, not Windows installation or company-login verification. No installer was published for this change.
