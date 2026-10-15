# Git clone failure diagnostics

The reported `fatal: unable to access ... requested URL returned error: 502` is an HTTP gateway failure. It does not establish an authentication problem or identify whether the Git server or a proxy is responsible.

## Changes

- Inspect a bounded 16 KiB stderr buffer in memory and classify HTTP, authentication, certificate, proxy, DNS, transport, SSH and filesystem failures. Never persist or forward raw stderr, remote URLs or credentials as diagnostics.
- Send only an allowlisted error code, actual phase, HTTP status, exit code, known signal and partial-file retention flag through clone IPC. Show a persistent notice in the existing project form, with short recovery guidance and collapsed details.
- Keep the entered address. Remove only the empty directory allocated by the failed attempt, permitting a manual retry at the same location. Preserve pre-existing directories and partial files; do not retry or delete them automatically.
- For the exact company HTTPS origin, omit URL usernames so the existing scoped app Git authentication supplies its own identity. Keep TLS verification and Windows system certificate trust. Enable long paths for the Windows clone invocation only.

This reuses the existing Git process, scoped askpass authentication, progress parser and CX notice. No new Git library, authentication mechanism, global Git configuration or TLS bypass was introduced.

## Evidence

- 12 focused tests passed: error classification, split/bounded stderr, secret exclusion, retry cleanup, partial and existing directory preservation, URL normalization and progress/success behavior.
- Design identity checks and Electron build passed.
- `scripts/check-electron-clone-error.mjs`: actual Git against an isolated local HTTP 502 endpoint, main-to-renderer diagnostics, persistent notice, address retention and two manual attempts at the same destination passed. Normal and narrow screenshots are in `verification/git-clone-errors-2026-10-15/`.
- `scripts/check-electron-git-clone.mjs`: actual local Git clone, visible progress, IPC and project opening passed.

Company server/proxy recovery, company credentials and Windows MinGit execution remain unverified. No installer or release was published for this patch.
