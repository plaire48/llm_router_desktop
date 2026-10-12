# Interactive terminal and responsiveness

## User outcome

The auxiliary terminal now opens a persistent native shell. It has a dark surface, the shell's real banner and prompt, a blinking cursor and direct input. There is no separate command form or Run button. Enter, history, directory changes, variables, interactive prompts and Ctrl+C belong to the shell. On Windows the PowerShell profile prefers an installed PowerShell 7 and falls back to Windows PowerShell. The app never invents a version such as 7.6.6.

Hover or keyboard focus reveals copy controls. A selected command or output can be copied separately with selection copy. Terminal-content copy copies the rendered scrollback, not raw ANSI sequences. Chat execution cards retain separate exact command and result copy buttons; prompts and waiting placeholders are not copied as command/results. Touch controls remain visible.

## Architecture and boundaries

- Existing xterm.js 6 renders the terminal. Official Microsoft node-pty 1.1.0 (MIT) supplies the PTY. Its native helpers run in a dedicated Node child so shell startup/output do not run on the Electron UI thread.
- Native IPC is restricted to the trusted app main frame. Sessions bind to a project and opaque tab ID. Open validates the current project and starting directory twice around asynchronous preparation. Duplicate opens attach once. Host shutdown cancels pending opens without replaying commands.
- A person controls the real shell at their normal OS privilege. `cd` and shell state persist; they do not change the agent's project or permissions. Hiding a tab preserves its session. Explicit terminal-tab close ends that session; app exit stops the terminal worker. Renderer failure disconnects sessions without automatically replaying input.
- AI commands still use the existing approval, bounded output, CLIXML decoding and receipt runtime. Interactive terminals are not exposed to AI tools or the web host. They do not produce synthetic success receipts or automatically analyze commands.
- Output is pushed, not repeatedly fetched in full. The worker pauses at 256 KiB of unacknowledged output and resumes as xterm acknowledges parsing. Replay is bounded to 256 KiB and rendered scrollback to 3,000 lines. It is not a permanent command audit log.
- Runtime credentials and host-only environment controls are omitted from the shell environment. No execution-policy or OS locale changes.
- Windows packaging unpacks PTY runtime helpers and excludes other-platform builds, build sources and debug symbols. macOS build preparation restores the helper executable permission stripped during npm extraction. Windows installation is not verified by a local Electron build.

## Responsiveness changes

1. Hidden native web tabs stop document-wide layout observation. Their browser sessions remain alive. Visible resize notifications are coalesced into one animation frame; modal hiding remains immediate.
2. Terminal resize work is coalesced and unchanged dimensions are skipped.
3. Agent/process status polling uses one project snapshot per cycle, after process updates. Late results from a previous conversation/project are discarded.
4. Terminal creation validates the project through the light project-path API instead of scanning all project files through `overview`.

These remove identifiable redundant work. They are not proof that every workflow is free of stalls. Network/model time and Windows hardware need separate measurements. Extra animation has not been used to conceal waits.

## Validation

- `node --test tests/interactive-terminal.test.mjs`: shell discovery, real banner arguments, scope, duplicate opens and cancellation during shutdown.
- `node scripts/check-activity-readability.mjs`: 1280/440/360px dark cards, exact copies, keyboard access, one state read per poll cycle and final process output. Synthetic Workbench state.
- `node scripts/check-electron-shell.mjs`: real local Electron/Bash PTY, persistent variables, interactive read, Ctrl+C, Korean input/path changes, copy, surrounding editor/browser/mail navigation. Hidden browser has zero geometry reads during 60 unrelated DOM updates.
- `npm run design:check`, `npm run build:electron` and `git diff --check`.
- Logs: `verification/interactive-terminal-{build,unit,electron}.log` and `verification/terminal-copy-ui.log`. Screenshot: `verification/native-surfaces/terminal-detail.png`.
- Real Windows PowerShell 7/5.1, ConPTY, packaged EXE and corporate environment remain unverified. No installer, release or upload was performed.

## Method and source selection

Reused xterm.js and adopted official node-pty rather than implementing shell line editing in React. This gives shell-owned prompts, process lifetime and input semantics. A separate worker, bounded output and frame-batched geometry follow the platform guidance; no additional animation framework was added.

- Electron performance guidance: https://www.electronjs.org/docs/latest/tutorial/performance
- xterm flow control: https://xtermjs.org/docs/guides/flowcontrol/
- node-pty source/license: https://github.com/microsoft/node-pty/tree/1.1.0
