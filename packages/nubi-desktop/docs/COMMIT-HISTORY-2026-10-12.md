# Commit history responsiveness and readability

## Findings and implementation

File selection previously reran both raw and numstat comparisons for the entire commit. References, tip and current branch were also fetched serially for the first list. Each rendered commit title installed a moving label and observers, while metadata and reference badges wrapped in a narrow pane.

- List metadata queries now run concurrently. Native Git `--max-count`/`--skip` semantics provide 25 visible commits and a one-record lookahead; a tip mismatch prevents paging across changed history.
- A bounded eight-entry cache shares immutable commit comparisons and in-flight requests per service and project root. Failed requests are evicted. Every detail request still validates branch ancestry; file path protections, encoding/binary/size limits and first-parent merge comparison remain.
- Opening a commit loads changed-file metadata. Only choosing a file reads its blobs and loads the diff editor.
- A bounded renderer catalog cache presents a previously read first page immediately on reopening, while fetching current data. Refresh resets to current history.
- Titles remain still, with ellipsis and full-title tooltips. Author, abbreviated hash and date occupy a single aligned metadata row; branch decorations stay on one line. Pagination stays outside the scrolling list.

## Method and alternatives

Reuse Git's native read-only primitives and the existing CX components. No additional Git library, background fetch, checkout mutation or persistent index was added. Do not cache branch permissions/ancestry or assume a cached list is current. References: [git-log](https://git-scm.com/docs/git-log), [git-diff-tree](https://git-scm.com/docs/git-diff-tree).

## Evidence

`verification/commit-history-performance.json` measures a temporary macOS repository with 250 changed files, a list/detail request and eight selected file reads. Three before/after runs:

| Measure | Before | After |
| --- | --- | --- |
| Total time | 670–689 ms | 340–347 ms |
| Git process calls | 90 | 66 |
| Whole-commit diff scans | 18 | 2 |
| Initial list | 32–38 ms | 17–18 ms |

These are local fixture timings, not a Windows or corporate storage benchmark.

Native Git regression tests cover 53 commits across pages, tip changes, invalid input, cached file reads, private-path exclusion, binary handling, ancestry rejection and project-root changes. The Electron shell test covers explicit file selection and rendered Monaco diff, alongside 17 existing shell checks. Browser checks cover narrow/wide lists, page boundaries, cached reopening and no automatic file-body request. Logs and captures are under `verification/commit-history-*.log` and `verification/git-history/`.

Electron build and identity checks passed. No Windows installer was generated or published.
