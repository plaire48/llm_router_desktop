# Skill and conversation menu refinement

## Component contract

The composer skill picker contains its title, available skill names and two navigation entries. Repeated section headings and per-row subtitles are removed. Full skill descriptions remain available as tooltips. Loading, empty, failure and partial-catalog states stay distinct; choosing a skill only adds it to the existing draft.

Skill management uses one row for tabs and actions. The local tab is named `내 스킬`; registration remains a named primary action. Trash and refresh are named icon buttons without a permanent zero count. At narrow container widths tabs show icons with accessible names and tooltips. Local entries keep the skill name and utility actions on one row. Source problems and restore state remain visible. Removing or restoring a skill keeps the existing confirmation, hash and recovery contracts.

Conversation `…` opens a floating horizontal tray: pin and delete, each an 18px icon in a 44px target. Text is retained in accessible names and tooltips. The tray never changes the conversation row geometry, never wraps and remains inside the viewport. Left/right arrows supplement existing up/down navigation; Escape returns focus, outside click dismisses, and deletion still opens its confirmation. Running conversations do not expose deletion.

## Basis and validation

Reuse the existing CX components, Nubi design tokens and native top-layer popover. No dependency or alternate dialog framework is introduced. The component-spec skill informed state, keyboard and responsive acceptance criteria. Verify wide/narrow geometry and focus with existing shared/modal scripts, then inspect the actual Electron app. Fixture checks do not establish real marketplace authentication or Windows behavior.

Completed verification: modal suite passed 29 checks; shared suite completed 34 records (including existing disabled-feature skips) and verified the horizontal action tray, 44px targets, row stability, left/right navigation, one-Escape dismissal and deletion confirmation. Complete Electron surface suite passed 104 captures/checks, including newly added skill management at 200% text. The renderer build and design identity check passed. In the user's actual app, a renderer refresh applied the changes without restarting the authentication worker. The saved conversation's horizontal pin/delete tray, simplified empty skill picker and single-row management controls were inspected. The app is left with the updated skill-management dialog open; no real skill was added, deleted or restored.
