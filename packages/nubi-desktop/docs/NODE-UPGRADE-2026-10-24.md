# Node runtime upgrade, 2026-10-24

## Versions and scope

| Environment | Before | Selected |
| --- | --- | --- |
| Desktop build and CI | CI 24.18.0; local shell 25.4.0 | Node 24.22.1 LTS, npm 11.19.1 |
| Desktop application | Electron 42.11.10, bundled Node 24.19.0 | Electron 45.0.0, bundled Node 24.22.0 |

The [official Node download](https://nodejs.org/en/download) lists 24.22.1 as the latest LTS and 26.12.1 as Current. Node 25 is EOL. The [Node support policy](https://nodejs.org/en/about/previous-releases) recommends LTS for production. The existing Node 24 code target is retained. No Node 26-only APIs are introduced.

The repository `.nvmrc` is the single development/CI pin. All seven setup-node steps that build or check Desktop, including the VS Code packaging dependency, read it. The independent Office installer job keeps its existing Node pin. Desktop's npm engine range excludes the unsupported Node 25 line and requires at least the selected LTS patch. Electron dependency, package lock, builder configuration and third-party version notice agree.

The source-input gate requires `.nvmrc` and compares its candidate/source hashes. Missing or changed pins block delivery, including when no compiled JavaScript directly imports this file.

The [latest stable Electron 45.0.0](https://releases.electronjs.org/release/v45.0.0) contains Node 24.22.0. Node 24.22.1 is currently available only in Electron 46 alpha. An alpha runtime is not adopted. Consequently, this change does **not** claim that the application's bundled runtime includes every fix in the [October 21 Node security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). A stable Electron carrying those fixes remains an upstream follow-up. Replacing system Node alone cannot change Electron's runtime.

## Compatibility and provenance

- Reviewed [Electron 43–45 breaking changes](https://www.electronjs.org/docs/latest/breaking-changes). The sandboxed preload only requires `electron` and does not use the removed Node shims/Buffer globals. Browser pages remain sandboxed with Node integration disabled. Existing asynchronous safeStorage, worker ownership, approvals and process isolation remain in place.
- Node's official macOS arm64 archive matched SHA-256 `89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7`. The local verification runtime is installed at `~/.local/share/nubi-devtools/node-v24.22.1-darwin-arm64`. Commands below use its bin directory first in PATH. Existing Homebrew Node and shell startup files are preserved.
- Electron's official Windows x64 ZIP matched its upstream SHASUMS256.txt: `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`. Its executable and Chromium notices were inspected without executing Windows code. Exact public-attribution reviews were renewed for this version; new certificate/test-operator and binary metric matches were individually reviewed. Executable binding still requires the exact upstream bytes and finding counts. Older macOS packaging reviews do not authorize new bytes.
- The Electron installation changed one locked dependency. Existing optional Tiptap peer-version warnings remain; they are unrelated to the runtime change.
- Actual terminal and lifecycle checks first encountered a process remaining alive after its windows closed. A native stack sample located a macOS Keychain `SecItemCopyMatching` wait; actual OS crypto/restart acceptance remains pending the system prompt. [Electron's own test change](https://releases.electronjs.org/pr/53790) documents the same cookie-keychain prompt problem and uses `--use-mock-keychain` for automated tests. A separate ignored test-only launcher uses that flag with temporary storage. Product launch/configuration does not include it, and those results do not verify OS-protected storage.
- Reviewed [Electron issue 55208](https://github.com/electron/electron/issues/55208): reissuing a prevented quit inside a promise callback can reset the native quitting flag. The final quit is now scheduled with a 4ms timer after worker exit and vault/notification flush. A trace confirms `will-quit` and `quit` are reached. No forced product exit, skipped persistence or lock bypass is introduced. Stuck isolated test processes were cleaned up before retesting.

## Validation

- Node 24.22.1: full unit suite, 2,663 pass, 0 fail, 201 existing disabled/platform skips (2,864 total).
- Final lifecycle/source-input/safety focused checks: 62 pass, 0 fail, 0 skip.
- Parsed configuration check: development runtime, all seven CI pins, npm engine/lock and Electron dependency/lock/builder agree. Existing gate coverage and design identity checks pass.
- Official Windows Electron executable/notices preflight: 2 files, no blocking findings. This is an upstream artifact preflight, not a packaged installer scan or Windows execution.
- Main-process version readback: Electron 45.0.0, Node 24.22.0. Real local SAML fixture: all 10 popup/session/POST/redirect/return checks pass. No company account is used.
- Built macOS Electron with temporary storage and test-only mock Keychain: lifecycle check passes worker kill/restart, single-instance forwarding, quit/relaunch, window geometry restoration, missing-project recovery and busy local port handling. The disabled workflow scene remains skipped. Mail intake's four existing end-to-end scenarios pass settings/cancel, folder collection/filtering, encrypted derived content, location migration and restart/readback. These are local fixture and mock-Keychain results.
- Final actual Electron/native PTY check with the same test-only mock Keychain: 8 checks pass, including Korean/Unicode/ANSI input/output, command approval and exactly-once execution, default-shell opening, Ctrl+C recovery, large output, resizing and final-output ordering. The test exits normally. Local timing is not a Windows performance claim.

Source and local macOS evidence do not establish actual macOS Keychain restoration, Windows installation, Office/NASCA, Samsung browser, company SSO or real-model quality.
