# Common collection table

The existing approval list is the visual reference. The user's correction is explicit: adapt mail to approvals, not approvals to mail.

## Shared implementation

`ui/CollectionTable.jsx` opts app-owned tables into `ui/collection-table.css`. Semantic `--nubi-table-*` tokens alias the existing Nubi/CX typography, spacing, surfaces and emphasis. Reuse the component for new app-owned tables.

- Inset header surface, caption-size labels and emphasis weight.
- Body-size primary labels, restrained secondary dates and file icons where meaningful.
- Header padding 12 px, cell padding 8 px vertically and 12 px horizontally. Standard primary target is 44 px; explicit compact mail density remains available.
- Sort and filter controls sit beside the column label. Existing pinned-column and resize behavior remains owned by ControlledTable.
- Search and range controls precede the table; numbered PageNumbers follow it. Do not add controls to read-only extracted document tables that have no search/pagination operation.
- Narrow tables scroll horizontally inside their existing viewport; page controls wrap within the available width.

## Scope

MailTable, ApprovalHistory, WikiTable, AI Workspace ControlledTable (including directory administration), and app-rendered spreadsheet extraction in DocumentPreview use the shared component. Wiki row descriptions and paths remain available through the row title tooltip rather than adding a second line to every row.

Authored HTML emails, original web pages, PDFs and user-authored document layouts retain their own formatting. This change does not alter source data, login, mail retrieval, permissions or server pagination. Existing page-size preferences and filters remain owned by each screen.

## Verification

- `node scripts/check-approval-list-ui.mjs`: local browser fixtures at 1100/440/360 px; mail/approval metric equality; wiki/workspace common font, weight, surface and padding; narrow header actions and pager bounds; filtering, selection, resizing and page navigation.
- `node scripts/check-community-wiki-ui.mjs`: actual UI components with fixture data at 1100/440/360 px; wiki filter combinations, reopening, empty-result recovery, document opening and draft retention.
- `npm run build:electron`: local renderer and Electron bundle build.

Screenshots and computed styles: `verification/approval-list-2026-10-16/`. These checks are local fixture and build evidence, not live corporate account or Windows installer verification. No release is part of this table-style change.

## Design decision

Reuse the existing table components, column behavior and PageNumbers instead of introducing a data-grid dependency. This preserves the established interaction model and avoids an extra rendering layer. Tokens are additive; existing source/selection contracts remain unchanged.
