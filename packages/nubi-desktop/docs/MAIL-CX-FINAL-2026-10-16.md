# Mail and proposal final CX check

Mail attachment labels now use body/600 primary ink; status uses caption/400 secondary ink and a full tooltip. Mail title remains 18/600, sender 600, utility controls use common size. Background status typography follows the same large-text tokens. Existing functionality and layout remain.

A stale file proposal persists `sourceChanged`, disables automatic approval and changes the primary action from Apply to Rebase. Overlapping edits offer a new agent request; cancellation and comparison remain visible. Original changes are not overwritten and a rebased proposal is not auto-applied. Restoring the original no longer supersedes a reused proposal itself.

Unsupported syntax is labelled “문법 검사 대상 아님” with a tooltip explaining that it has not been automatically validated. It is not a syntax error and does not block the user's explicit apply action. Unsupported validation and changed-source conflicts remain distinct.

Evidence: 27 proposal/runtime tests (also included in the later 217 run); proposal fixture at 1000/440/360 for normal, stale, conflict, and unsupported states. Mail fixture tests cover settings, background, reader and reset at 3 widths and 2 font sizes (24 combinations), plus 6 storage dialog combinations. These are production-component browser fixtures, not a Windows installer or live-model test.

## Modal refinement after visual feedback

The storage dialog now uses the shared icon title, a contained path field, and aligned evidence/retention rows. The common checkbox stays on the right; the icon, emphasized label and quiet consequence text remain together. Mail settings reuse the same retention component. Folder choice, migration, cancellation guards and collection behavior are unchanged.

Rendered verification repeated the 24 settings/background/reader/reset combinations and six storage-dialog combinations, including 360 px with larger text and actual checkbox interaction. The latest visual evidence is linked from `verification/mail-cx-final-2026-10-15/review-refined.html`. These are production-component fixtures with synthetic mail, not an installed-app or SSO check.
