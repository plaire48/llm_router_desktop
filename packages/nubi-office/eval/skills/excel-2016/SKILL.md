---
name: excel-2016
description: Create or revise an Excel 2016 workbook, preserving existing formulas and layout and verifying the completed result.
---

Read `skills/excel-2016/references/authoring.md` for authoring and verification guidance.
For missing business facts use ask_user. Existing native approval rules remain authoritative.
Use native reads for existing workbooks. Never open NASCA files with a script or archive library.
For a new workbook, write_document_chunk builds a draft. `draft/sheet.json`, when available, is the current sheet's JSON specification: read it, use edit for exact corrections, then commit_document_sheet. Edits to this resource change the pending sheet, not the Excel file or acceptance status.
Use only the currently supplied tools. Use run_script for pure JavaScript calculations: write a memory .js file defining function transform(input) and returning JSON. Read references/calculations.md before first use. Python execution and dependency installation are unavailable.
