# PowerShell Korean text transport

The previous normal shell path encoded commands as UTF-16LE but only configured console output and `$OutputEncoding`. Console input retained its previous encoding. The elevated command did not use that same setup. Administrator log tails could start in the middle of a multibyte character; launcher output was decoded per chunk.

## Changes

- Share console input/output and `$OutputEncoding` UTF-8 setup for normal PowerShell and both existing administrator wrappers. Python child standard streams use `PYTHONIOENCODING=utf-8` in that command session.
- Preserve UTF-16LE `-EncodedCommand`, literal Korean paths/quotes, command length limits, explicit privilege consent, receipts and no automatic retransmission.
- Explicit `-InputFormat Text -OutputFormat Text` prevents the encoded/noninteractive host's implicit error CLIXML selection. No XML parser or new shell framework is necessary.
- Existing normal stdout/stderr streaming StringDecoder is retained. Administrator receipt streaming now uses StringDecoder and flushes at close; retained UTF-8 log tails skip only a leading continuation fragment and respect bytesRead.
- Terminal rendering uses the central monospace stack with the bundled Noto Sans KR fallback for Korean glyphs.

## Boundaries

These are command transport and display changes. Windows system locale, execution policy and user profiles remain untouched. PowerShell file read/write defaults are not overridden. In particular, a UTF-8 ps1 without BOM can still be read as ANSI by Windows PowerShell 5.1; use its original declared encoding or a compatible PowerShell version rather than silently rewriting project source. A legacy executable that hardcodes CP949 despite the console code page needs an explicit per-program encoding contract; no automatic UTF-8/CP949 guessing or replay is introduced.

## Primary sources and adoption

- [Microsoft PowerShell CLI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1): EncodedCommand requires UTF-16LE and output/input Text formats are supported.
- [Microsoft character encoding](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.5): Windows PowerShell and PowerShell 7 file defaults differ; `$OutputEncoding` concerns external program communication and does not change file redirection encoding.
- [PowerShell upstream issue 4681](https://github.com/PowerShell/PowerShell/issues/4681): console InputEncoding, OutputEncoding and OutputEncoding variable need consistent UTF-8.
- [PowerShell console host source](https://github.com/PowerShell/PowerShell/blob/master/src/Microsoft.PowerShell.ConsoleHost/host/msh/ConsoleHost.cs): ErrorFormat selects XML for an encoded noninteractive command with redirected errors when output format was not specified. Explicit Text uses the existing public CLI contract. The framework source is reviewed, not copied or bundled.

Verification: source review and Electron build only, per the user's no-tests decision. No commands, administrator/UAC operations, Windows PowerShell 5.1, PowerShell 7 or Windows installation checks were executed on this macOS host. Build success is not proof of every Windows/legacy executable's Korean output.

Follow-up 2026-10-12: marked CLIXML display normalization and directory-access diagnostics are now documented in `POWERSHELL-CLIXML-2026-10-12.md`; the explicit Text/UTF-8 launcher contract above remains.
