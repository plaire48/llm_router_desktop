# Code Wiki structure guidance

## Applied

Desktop now supplies a read-only repository structure map to the existing native OpenWiki planner and page writers. The map indexes JavaScript/TypeScript functions, classes, methods, policy constants, relative imports, reexports and statically resolved symbol references. It runs in the existing isolated TypeScript worker; no dependency, executable, repository plugin or compiler configuration is installed or executed.

The planner receives a bounded overview. Each page receives its seed files and nearby callers/dependencies first. Update context prioritizes changed files and their neighbors. The native Claims, source fingerprint, page manifest, pending-page resume and approval contracts remain authoritative. The map is navigation data, not evidence or proof of runtime execution. Writers must read original sources.

Collection excludes existing private/generated/OpenWiki-ignored paths and refuses symlink escapes. Limits are 400 admitted code files, 256 KiB per file, 8 MiB total, 4,000 symbols, 8,000 edges and an 18,000-character model context. A single lazy map is shared within one run; a new or resumed run rebuilds it. Analysis timeout/failure falls back to ordinary source tools. Cancellation still stops the run. No-op updates do not collect a map.

These limits apply only to the optional navigation map. They do not reduce the existing full Wiki source inventory or prohibit reading other source files.

Syntax failures, excluded large files, omitted entries and unresolved references are explicit. Package aliases, dynamic dispatch and non-JS/TS languages are not claimed as resolved. Other languages retain existing source exploration. Build/configuration files are listed as navigation metadata; no test execution is inferred.

## Benchmark decisions

- [CodeWiki incremental updates](https://github.com/FSoft-AI4Code/CodeWiki/blob/main/guides/incremental-updates.md): adopt dependency-aware investigation and retain the existing source-change/Claims update lifecycle. Do not replace the native resume implementation.
- [Aider repository map](https://aider.chat/docs/repomap.html): adopt bounded, task-relevant symbol context. Use deterministic seed/change/adjacency ranking; this is not Aider's ranking algorithm or copied implementation.
- [SCIP](https://github.com/scip-code/scip): precise language indexers are a later option. No SCIP/LSP server is bundled in this change. The existing TypeScript compiler provides scoped static symbol resolution without a new runtime.
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/): syntax trees alone do not prove execution or semantic call targets. No regex call graph or new parser dependency was added.

The upstream tools are references, not product dependencies. There is no claim of broad language coverage or CodeWikiBench-level performance.

## Validation

Static regressions cover alias/reexport resolution, name shadowing, invalid syntax, unresolved dynamic calls, policy constants, source exclusion, worker cancellation, map budgets and fresh source on subsequent runs. Native runner tests cover planner/page context, no-op avoidance, cancellation and oversized context rejection. Existing generation/update/resume tests are rerun.

`eval/wiki-code-map-live.mjs --live` compares native generations using the same pinned synthetic `order-service` corpus and authenticated Claude adapter. The first comparison changed only the map; the final candidate also includes the writing-rule and response-repair changes below. The ten-item rubric is `eval/wiki-code-map-rubric.json`. Results live under `verification/code-wiki-map-2026-10-16/` and require source-based review; generation success alone is not semantic accuracy. This is a small sequential comparison, not the proposed multi-repository/repeated benchmark, company-data validation or Windows verification.

The first candidate failed with `claude_response_invalid` before plan submission. A clean second attempt generated both pages, but incorrectly generalized fractional item values as rejected inputs and duplicated much of the detail page in quickstart. The original failure and output are retained. Wiki inference now repairs that pre-dispatch format rejection with the existing bounded repair policy; accepted tool receipts are preserved and schemas remain strict. Writer guidance now keeps conditions/exceptions next to the assertion, distinguishes item checks from aggregate checks, and gives each fact one primary page. The final candidate is evaluated separately rather than overwriting the earlier result.

## Measured outcome

See [the source-based evaluation report](../verification/code-wiki-map-2026-10-16/review.md). With Claude Opus 5.5 / medium, the baseline took 218.7 seconds, 48 exploration calls and 2,415 quickstart body characters. The final candidate took 201.8 seconds, 42 exploration calls and 1,873 characters. These are single sequential observations, not statistically established gains. All five attempts, including the initial format failure, are retained.

The final candidate's 35 evidence references resolve to their current versions, and source files are unchanged. Nevertheless it incorrectly declares a downstream numeric guard unreachable: a finite integer input can overflow in intermediate arithmetic. This synthetic counterexample was executed and recorded. The final candidate meets 9/10 reviewed rubric items versus 10/10 for the single baseline. No general semantic-quality improvement is claimed. Shorter quickstart and more efficient navigation are distinct from factual accuracy; independent claim-condition review and broader repeated evaluation remain necessary.
