# Terminal output reliability

## Findings and changes

- The renderer combines PTY chunks per animation frame, but the worker acknowledged at most 65,536 characters per batch. A larger parsed batch left phantom pending output and could permanently pause the shell. Acknowledgements now subtract the actual parsed length, bounded by pending output and validated as a nonnegative safe integer.
- An exit could write its label before the buffered final output. The batch now flushes first, preserving split ANSI sequences, Korean text and surrogate pairs without stripping terminal control codes.
- Some fit paths (tab visibility changes) resized xterm before the geometry observer, without notifying the PTY. All actual xterm grid changes now notify the shell. Windows backend/build metadata comes from the worker's real OS release and follows the installed node-pty backend selection. xterm receives this before replay, enabling its documented Windows resize handling.

The dark terminal, shell choice, input, approval boundaries, copy controls and raw command evidence remain intact. No command is rerun, profile edited, execution policy changed or system locale changed. These are confirmed code defects; the user's particular Windows display failure has not yet been reproduced on Windows.

## Verification

- `node --test tests/terminal-stream.test.mjs tests/interactive-terminal.test.mjs tests/terminal-locale.test.mjs tests/terminal-mouse.test.mjs tests/powershell-output.test.mjs tests/shell-encoding.test.mjs`: 27 pass, 0 fail, 1 Windows-only runtime test skipped on Mac.
- `npm run build:electron`: passed local build, TDZ and icon checks.
- `node scripts/check-command-terminal.mjs`: real Mac Electron/Bash PTY passed Korean input, persistent state, Ctrl+C, approved-command record linkage, no command replay, 12,000 lines of Korean output, native window resize, next command and final output before exit. Screenshot reviewed at `verification/command-terminal-2026-10-15/terminal.png`.
- Logs: `/tmp/nubi-terminal-stream-tests.log`, `/tmp/nubi-terminal-stream-build.log`, `/tmp/nubi-terminal-stream-electron.log`.
- Windows 11 PowerShell 5.1/7 and ConPTY runtime remain unverified. No installer, upload or release.

## Method

Kept the existing xterm.js and node-pty integrations. Followed [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/): acknowledge the same number of units consumed by the parser, with bounded backpressure. Checked the installed xterm 6 `windowsPty` API and node-pty 1.1.0 backend selection source. No new dependency.
