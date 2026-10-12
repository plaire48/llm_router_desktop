# Nubi Workspace Beta 1.1.3 release candidate

## Changes

- Agent transport communicates the actual host tool-batch limit and repairs rejected response structure before dispatch. Command continuation reuses only freshly hash-checked prerequisites and fully read skill instructions; each new command still requires its own approval.
- Answer review receives registered source identities, decisive source guidance and process timestamps. Unknown citation identities are corrected through the existing bounded review loop rather than silently treated as valid.
- Windows Claude discovery supports native, npm and WinGet install locations plus current user/system PATH entries. Official npm package metadata identifies its executable; legacy JavaScript entries use Node argv without a shell. Credentials and login remain owned by the installed Claude CLI. Installation, access failure and authentication remain different states.
- Windows HITL uses real system notifications and the product question form. Beta excludes attachment body reading and external A2A/Computer Use.

## Evaluation boundary

The completed matched hard-task comparison used 10 business scenarios across Bash, mail, skills and OpenWiki (40 tasks). Real ChatGPT GPT-5.6 Sol medium, fixed synthetic sources, macOS, one trial per case. Delivery improved from 22/40 to 40/40; source-audited pass improved from 20/40 to 33/40. Raw automatic pass was 18/40 to 32/40. This is not a general product score, real corporate mail test or repeat reliability result. Subsequent targeted retests are reported separately in HARD40-EVALUATION-2026-10-13.md.

## Release evidence

Pending final Windows build and installed-app verification. Do not treat this file as a successful release record until CI run, commit and checksum are filled in.

## Corporate deployment

The build repository is private `plaire48/llm_router_desktop`. Internal publishing to `code.sdsdev.co.kr/Manufacturing-IT/nuri` must be performed on the company PC using `Publish-NubiUpdate.ps1`; `latest/windows-x64.json` is updated only after the uploaded EXE is downloaded and hash-verified. No source or credentials belong in that channel file.
