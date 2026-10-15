# Project switch progress

The existing switch cover used only an indeterminate bar for ordinary project opens. It now shows the target project name, current operation and elapsed seconds using the same tokens and progress geometry as Git import.

- The renderer starts timing before requesting the transition. It updates elapsed time on a monotonic clock once per second and clears the timer when the transition ends.
- Host events identify actual project opening, lock-release waiting and catalog persistence. Folder selection and ZIP extraction have their own states. Events carry only a bounded request ID and stage, with no paths or credentials. Late events from another transition are ignored.
- No percentage or remaining time is inferred from elapsed time. Git stage percentages remain tied to Git output. After 15 seconds, a short wait instruction distinguishes the native picker from ongoing processing.
- The existing guard against replaying the old project, draft protections, native browser visibility and failure recovery remain in place.

## Verification

- `scripts/check-project-switch-cover.mjs`: actual isolated macOS Electron, two temporary local projects, delayed IPC response, visible target name and advancing elapsed seconds, real host-stage events, successful transition, old-view suppression and failure restoration.
- `scripts/check-git-clone-progress-ui.mjs`: actual Chrome rendering with synthetic progress, 360px layout, long target name, minute/second duration, indeterminate bar and reduced motion.
- Common design checks and Electron build passed. Windows installer and company/remote Git timing were not measured.

Screenshots: `verification/project-switch-cover/switching.png` and `verification/git-clone-progress/project-opening-narrow.png`.
