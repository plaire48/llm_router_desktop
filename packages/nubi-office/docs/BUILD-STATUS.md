# Office 0.8.2 build status

The user requested that Windows installer builds run only when they explicitly request the final build. Do not trigger another installer workflow during source iteration.

- The 2026-09-23 template source iteration adds confirmed fields, same-run questions, value-only fills, Excel-managed copy registration with embedded XML metadata, and preservation reports (compared/different/unverified). The publication checkout is tested against its pinned shared sources; the working tree also contains independent Nubi changes. See verification/template-harness.json for exact counts/hashes and the observed working-tree parser compatibility failure. New native code/tests remain uncompiled and UI runtime unverified. No app or installer build ran. See TEMPLATE-FILLING.md.

- Previous source-only iteration adds Excel 2016 workbook discovery/inspection/range RPCs, isolated bounded analyses, source fingerprint checks before edits, and live multi-sheet evaluation scenarios. See EXCEL-2016-AGENT.md. New native C# code and its added contract tests have NOT been compiled or executed in this iteration. The prior installation failure below is unresolved; these changes do not establish a working new installer.

- Published installer remains 0.8.1. No 0.8.2 GitHub release was created.
- Source changes include connection cause mapping (including AI Pro callback failures), Windows system CA use without a TLS bypass, complete JSON wrapping and uppercase requirement IDs, one tool per model decision, and same-run no-progress HITL.
- 96 scripted Node regression tests passed on Windows. Production UI document and cell workflows passed with controlled model replies and simulated Excel COM. Local .NET host cross-compilation passed.
- Latest installer attempt: https://github.com/plaire48/ai_workspace/actions/runs/35734239528, source d8324b1d96c648bbf8042700ada16a68010fbcd5.
- Installer creation succeeded; final installation verification FAILED at tests/installed-host.ps1:28 (Native worker session failed). Constructor reflection now works; the session task did not satisfy the completion/count check. Do not assume the application or test harness cause without investigation. Registration and file hash checks precede this point. Reinstallation/uninstall checks did not run in this attempt.
- Investigate task completion versus provider-count parsing and synchronization context in the Windows PowerShell probe before the next final build. Keep the check; do not downgrade a failed verification to success.
- Real corporate authentication, actual Excel 2016 COM execution and Qwen task accuracy remain unverified. The user's generic connection failure has no confirmed real-PC root cause.
