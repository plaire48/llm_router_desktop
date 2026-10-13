# Project source search recovery

User report: `관련 소스 찾기 실행 실패`. The label belongs to `source_search`, which searches project files. It is separate from `ask_openwiki` and `wiki_query`; this label alone does not establish a Wiki generation or model failure. The affected Windows run's exact error is not yet available.

## Changes

- Preserve explicit host-approved error codes in Desktop traces and translate known path, input, source and query errors. The status tooltip shows only an approved fixed code, never an exception message or server reply. Shared hosts do not opt into additional codes by default.
- Show the canonical `프로젝트 파일 검색` label so a source search is distinguishable from project Wiki research.
- Normalize `.` and ordinary relative Windows separators in the search scope. Absolute, traversal, private and out-of-project paths remain rejected.
- If the packaged native search module/executable is missing or access to execution is denied, reuse the existing scoped UTF-8 file reader for bounded exact-text search. No system PATH changes, executable installation, TLS change or alternate shell command is introduced.
- Retain the same one-MiB file bound, ten-second search budget, match/excerpt limits, protected-file exclusions, symlink scope checks, cancellation, current hashes and incomplete coverage. Native zero-match exit code 1 remains a successful empty result. Search candidates never grant edit or command approval.

## Validation

48 focused source search, feedback and trace cases passed, including actual Agent execution with a synthetic provider: a path error is recorded, the model reads the correct current file, and a final answer is delivered. Missing/blocked native executable cases are simulated, with actual temporary project files and hashes. They do not prove the cause of the user's installed Windows failure.

Actual shared component rendering in Chrome verifies translated error text and fixed-code tooltip at 360px and 800px. Local Electron build passed. Windows installed execution, the affected account/model and the specific reported run remain separate evidence.
