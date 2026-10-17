# Approval filtering and pagination

## Applied

- Portal approvals reuse the mail column filter and numbered pagination components, page settings styles and shared CX controls. Title search, submitted/completed date filters, sortable headings, filter chips, 10/20/50/100 rows and direct page entry are available.
- Filters, sort and page size changes return to page one. A selected document remains readable. Search matches are highlighted. Missing completion dates are not inferred as an approval status.
- The supplied userscript only proves the `pageNum` API. No speculative server-side search, sort or page-size arguments are added.
- Default browsing fetches enough server pages for the requested view. Only visible missing titles are hydrated, with three concurrent readers and batched rendering. List/title metadata is reused within the open view and cleared on explicit refresh/account change.
- Filtering/sorting scans all available list pages before reporting result counts. Title reads are needed only for title search/sort, after date filtering. Progress reflects real list/title counts. Superseded queries stop issuing requests; already completed metadata is reusable. Failed reads are disclosed, not counted as an exhaustive search. Repeated pages fail without an infinite loop. No body text search is claimed.

## Validation

- 50 focused Node checks passed (approval search, diagnostics, portal contract and bundle).
- Chrome fixture passed at 1100, 440 and 360 px: global title/date filters, reset, page navigation, document retry, HTTP/login/parse failures, first-page reset, direct page entry, page size and global sort.
- 60-row fixture: initial title calls reduced to 20; two title DOM update batches observed. Search finds row 59 and subsequent page/sort/filter changes reuse the one already loaded list response.
- Local Electron build passed. Screenshots: `verification/approval-list-2026-10-16/filtered-1100.png`, `filtered-360.png`, `pagination-settings.png`, `hydration-60.png`.
- This is fixture/source/local build evidence. Corporate portal access and Windows installation have not been verified for this change. No release was published in this task.

## Tradeoff

First global title search may be slower when the portal omits titles: its item endpoint is then necessary to read them. Default navigation does not eagerly download every document. No extra table dependency is introduced; existing mail patterns are reused.

## Corrected visual direction

The user clarified that the existing approval design is the reference and mail must follow it, not the reverse. The exploratory approval restyling was reverted. Mail now uses the approval-style inline search/pager layout, inset header, caption-weight column headings, row spacing, adjacent filter icons and numbered footer. Mail's advanced filters remain available from the sliders icon, with Escape dismissal; saved searches, selection and AI actions remain available.

Real browser fixtures compare mail and approval at 1100 and 440 px, including measured row/header heights, font, font size/weight, header background and padding. The separate mail stability scenario passed for arrivals, selected rows, scroll, document reading, explicit updates, page changes, refresh failure and account changes. Corporate service and Windows evidence remain outside this check.
