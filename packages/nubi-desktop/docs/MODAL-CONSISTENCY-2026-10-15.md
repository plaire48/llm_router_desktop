# Modal consistency review — 2026-10-15

Preserve the restored workspace design. Improve local modal hierarchy without changing the chat layout, font family, global background or authentication contract.

## Changes

- Claude installation, update and login share the compact modal width, typography, spacing and resize motion. Remove repeated instructions and empty step-list spacing.
- Show one emphasized status and one supporting sentence. Put installation troubleshooting behind “이미 설치했나요?” with the existing copy/check control for `claude --version`.
- Use existing external-link, refresh, login and terminal symbols. Keep the Claude brand mark and the common primary action style.
- Use the common title icon frame for the usage modal. Preserve other reviewed modal layouts rather than applying a broad redesign.
- Keep unknown connection failures visible, without repeating known setup-stage transitions as errors.

## Approach

Reuse the existing DetailPanel, CxButton, CopyButton and modal motion contracts. Progressive disclosure reduces optional troubleshooting text while keeping the next action visible. No new package, font or animation system is introduced.

## Verification

- All-surfaces Electron fixture: 115 checks passed, including 440px width and 200% text. Real production components with synthetic data; not connected-account or Windows installer evidence.
- Focused reasoning/setup fixture: provider colors, stage-specific actions, installation command copying, guide failure rendering, retry transition and copy feedback.
- Desktop identity check passed. Local Electron build passed, including TDZ and icon checks.
- Before/after screenshots and comparison: `verification/modal-consistency-2026-10-15/review.html`.

No Windows installer or release was produced for this visual refinement.
