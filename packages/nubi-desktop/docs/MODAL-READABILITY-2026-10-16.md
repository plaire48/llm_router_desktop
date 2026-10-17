# Modal readability

- Shared section gap: 20px, separate from the 8px label/field gap. Font sizes, brand colors and required actions remain intact.
- MCP tool lists start collapsed. Optional working directory and environment/header values share a collapsed disclosure. Save and automatic connection stay visible. Collapsing does not remove or reset values.
- Claude connection summary uses the shared field gap; its existing installation troubleshooting stays collapsed.
- Narrow MCP grid items shrink within the dialog. Claude footer actions remain reachable with enlarged text.
- Verified using production React components with synthetic data: 1280px normal, 360px short window, 440px at 200% text. Actual account connection and Windows installer are outside this visual check.
- Evidence: verification/dialog-bounds/result.json and mcp-folded-1280-100.png.

## Mail and longer content

- Mail settings, collection rows and storage setup use the same 20px grouping gap. Source location and attachment retention choices stay visible.
- Connected mail's file-import section starts folded. Active, interrupted or failed imports reveal status and recovery actions. The disconnected portal/file choice remains directly visible.
- Collection policy notes live under data management with the existing storage details; no storage setting or input value is removed.
- Wiki update lists over three documents fold under a file-icon heading; update/apply/resume controls and error summaries remain outside the list.
- Icon validation now also inspects DeckDisclosure icon props after a real browser check caught an unsupported forwarded icon. The corrected UI uses the existing file icon.

Follow-up verification: 36 normal/short-window/enlarged-text dialog cases passed, including folded mail import and 12-page wiki list. Mail UI flow passed with interruption/reveal/resume, reconnect and reset checks. Seven wiki view tests passed. Final local Electron bundle succeeded. Long wiki paths now truncate within the available width rather than widening the modal and pushing recovery buttons offscreen.
