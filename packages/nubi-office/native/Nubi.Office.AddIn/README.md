# Nubi VSTO deployment entry point

This is the installer build of the existing Nubi ribbon and task pane. The agent,
providers, UI, workbook engine and native host are unchanged and are reused.
The original Office AI Agent's unrelated Word/PowerPoint, XLL, legacy chat and
database dependencies are not part of the Nubi installer.

`ThisAddIn.Designer.vb` and `ThisAddIn.Designer.xml` originate from the pinned
Apache-2.0 Office AI Agent source in `vendor/office-ai-agent/ExcelAi`.
`ThisAddIn.vb` is the existing Nubi integration from that directory. The original
license is included in the installed `NubiOffice/licenses` directory.

The Excel-owned task pane caption is intentionally empty to avoid an additional
Nubi title above the embedded chat. Use the documented `CustomTaskPanes.Add`
title argument; keep Office's window controls and docking behavior. This changes
the caption text, not the native title-bar height.

Reference: https://learn.microsoft.com/en-us/dotnet/api/microsoft.office.tools.customtaskpanecollection.add?view=vsto-2022
No additional package or native-window hook is needed. The caption change is
source-only until the next explicitly requested Windows build and visual check.
