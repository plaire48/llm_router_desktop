# PowerShell CLIXML and directory access errors

The reported FullyQualifiedErrorId is `DirUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetChildItemCommand`. This identifies a directory enumeration denial; the actual denied path and its ACL on the user's Windows PC are not available. It does not establish a service login failure.

The existing launcher already uses explicit Text input/output and UTF-8 console transport. Keep this contract. A nested shell or older installed launcher can still expose serialized errors; neither possibility has been verified on the user's PC.

## Change

- Decode only marked `#< CLIXML` pipe output. Restore XML entities and PowerShell UTF-16 escapes once, including CR/LF and Korean. Ordinary output streams immediately.
- Reuse installed `saxes` 6.0.0 (ISC); no new dependency, XML deserialization, shell invocation, DTD or external entity resolution. Buffer at most 256 KiB for a marked document. Malformed, unknown, oversized or interrupted documents remain readable as original output.
- Preserve the disk log verbatim, process exit code, approval and replay protections.
- Retain a directory-access diagnostic separately from incorrect-command repair, including when a later PowerShell statement exits successfully. Both the terminal and agent receipt receive the partial-coverage warning. Do not suppress inaccessible paths, elevate or modify ACL/execution policy automatically.

## Verification

26 focused tests passed; one Windows-only encoding test was skipped on macOS. Tests cover split bytes/chunks, Korean, literal escapes, bounded malformed/DTD input, raw logs, exit status and separation from HTTP authentication. Actual Electron process/IPC/xterm rendering of an injected CLIXML fixture passed and command input was released after failure. This is not an actual Windows ACL or installed-build verification.

References: [Microsoft PowerShell CLI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1). Logs: `verification/powershell-output-tests.log`, `verification/powershell-output-electron.log`.

Final visual review also replaced the terminal font fallback with Menlo/Consolas/Liberation Mono/monospace, preventing a proportional Latin fallback from widening every terminal cell. The final Electron suite passed 19 checks (`verification/workspace-fixes-electron.log`); `verification/native-surfaces/terminal-access-denied.png` is a local fixture capture, not the user’s connected Windows app.
