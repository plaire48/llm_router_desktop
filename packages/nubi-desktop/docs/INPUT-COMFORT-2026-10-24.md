# Input comfort and stable conversation focus

The current CSS pipeline was measured before editing. Ordinary modal fields were 40px tall with no vertical padding and 8px inline padding; a search field's inner input was 34px tall. The composer was 36px tall with a 27.2px line box and 4px top/bottom padding. The composer fill did not change on focus, but its outer rim gained a blue shadow and its conversation-specific inner shadow disappeared. These paint changes made clicking appear to change the color of the whole box. The new regression failed on that exact appearance difference before the fix.

## Change

Shared identity tokens now define a 2.75rem field height (44px at the default root size), 12px inline padding and 8px block padding. Normal multiline fields use 12px insets. The composer uses a 44px minimum input and 12px surrounding block spacing. Existing body 15px / reading 16px scales, Korean font fallback and semantic colors remain. No input, selection or IME event handler was replaced. The native caret inherits readable text size and visible text color; there is no custom caret overlay or forced OS caret width.

The existing CX field-height/padding tokens also feed embedded searches and shared controls. Modal and imported Workspace form height rules use the same field token rather than the button-height token. Nested search inputs retain their icon/clear-button geometry; specific borderless question layouts continue using their owning wrapper's inset and marker alignment. Editor helpers, terminal rendering, checkboxes, radio controls and authored document contents are outside these field rules. Sizes remain relative for text enlargement.

Focus now preserves the composer's original fill, border and shadow at both the painted outer card and inner conversation surface. Ordinary form focus/validation indicators and the forced-colors system focus outline remain. Ambient animation and provider colors were not removed to achieve a stable field.

This reuses the current CX controls, native inputs and shared identity/typography/dialog layers. No framework, replacement input widget, dependency or duplicate focus state was added. The change follows the existing repository design contract; external product code was not copied.

## Verification scope

The conversation checker compares actual computed fill/border/shadow before and after clicking, checks room around a native caret, and retains its typing/docking, message tools, provider surface and 200% text checks. At narrow widths it first dismisses the sidebar overlay as a user would before clicking the composer. It passed six conversation/pointer cases and five new-conversation sizes with no page errors.

The all-surfaces Electron fixture now records field font, line height, usable height, padding and caret color, and rejects clipped line boxes or transparent carets. Its previous 40px empty-input/110px composer ceilings represented the old dense design; the explicit user request changes these to a comfortable one-line 44–56px input and a maximum 128px composer. Other layout, label, font, contrast and accessibility checks are retained. The first broad run passed 48 scenes, then found a stale checker assumption that the changed-file list starts expanded. The checker now opens the existing disclosure before inspecting it; product behavior was not changed for that failure.

The Electron build and identity check passed. Twenty-four focused design, gate, modal-motion and shell-fact tests passed. Local source/fixture and actual built macOS-host results must remain distinct from Windows installation, OS caret preferences, company services, Office and real-model acceptance.

The final all-surfaces run passed 117 states with no page errors, including 200% text dialogs and narrow layouts. It recorded 90 rendered input occurrences across 27 field names, with a minimum font size of 15px. Eight DB form-clarity scenarios also passed, retaining required-field validation, typed values, password clearing and read-failure recovery.

The built macOS app was separately exercised with a real temporary project, existing local Wiki, draft, worker and IPC. Korean multiline text stayed intact at 1280/760/440/360 px; three clicks at each width preserved the exact fill/border/shadow. The current line box was 27.2px with 16px total block padding. Actual POP3 settings fields retained a 12px text inset and an unclipped 24px line; the general settings modal also rendered at 360px. This test made no connection or model call. Its first attempt used a desktop-toolbar button hidden at 360px; selecting the visible mail-page settings action completed the actual narrow-screen flow.

Local evidence is under `verification/input-comfort-2026-10-24/`, the chat checker captures under `artifacts/workspace-codex-chat-2/input-comfort/`, and the DB checks under `verification/form-clarity/`. Generated captures and temporary probes are excluded from source uploads.
