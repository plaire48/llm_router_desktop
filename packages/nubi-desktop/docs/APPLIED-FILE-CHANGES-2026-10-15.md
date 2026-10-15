# Applied file changes in the conversation

The applied-file picker is now an inline summary card. It shows the distinct file count and verified added/deleted line totals, initially three files, with more/collapse controls. Existing Nubi text, color, icon, radius and focus tokens are reused. Long paths remain single-line, with full-path titles and the shared clipped-name hover behavior.

Clicking a file opens the existing read-only Monaco Git comparison in the auxiliary pane and reveals its first change. Additions and deletions retain their semantic colors and line indicators. Unchanged regions are folded. This does not apply, undo or repeat any write.

Only applied proposal receipts belonging to the conversation are included. A file's earliest connected before snapshot is compared with its verified current contents, so two consecutive edits are not reduced to the last edit alone. Broken chains are labeled as recent changes and do not contribute to an alleged complete total. Unapproved proposals, unrelated Git changes and other tasks are excluded.

The existing `appliedFileSummary` read API accepts an exact applied path and expected hash for comparison. It rechecks the current file, receipt chain and stored snapshot scope/hash before returning before/after text. A late click cannot present a comparison after the project or conversation changes. Preview text is fetched only for the clicked file; summary responses contain no full file bodies.

The card is a result, independent of the “진행 과정 표시” preference. Switching that preference off still leaves applied files, comparison actions, questions and approvals visible. Settings copy states this explicitly.

Validation: four runtime tests cover cumulative edits, unapproved/foreign paths, stale contents, new files, tampered snapshots and partial chains. Chrome checks cover three-row/more/collapse/keyboard behavior, 360/440/1280-pixel widths, actual Monaco diff rendering at a changed line, delayed task switching, summary retry and progress preference OFF/reload/ON in the production Workbench component. Screens use synthetic file data. Local build and design checks are separate from Windows installed-app verification; no release was published.

The existing Monaco integration was reused rather than adding another diff package. `onDidUpdateDiff`, `revealFirstDiff` and disposal contracts were checked against the installed Monaco type declarations. Monaco's bundled icon font is explicitly imported so diff indicators do not show missing glyphs.
