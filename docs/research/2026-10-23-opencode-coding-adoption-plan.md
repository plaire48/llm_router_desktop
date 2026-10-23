# OpenCode coding execution adoption

The user authorizes using the original OpenCode implementation, rather than treating the current Pi runner as a fixed requirement. Coding quality is the objective; copying UI or changing a dependency name is insufficient.

Baseline: official OpenCode CLI and Desktop v1.19.4, commit `148842ef7cb1bc34192b3fff57d0f9721ab9c801`. Both official macOS arm64 release archives were downloaded and matched against GitHub's SHA-256 release digests. Source checkout: `/tmp/nubi-opencode-analysis-2026-10-23/upstream`.

## Implementation and evidence

1. Run the original pinned OpenCode executable for Workspace development tasks. Keep the existing Pi executor for other workflows. Route the user's current host model through an authenticated loopback provider bridge and expose only the admitted host tools through an authenticated MCP endpoint. Preserve the existing planning, source observations, proposals, approval, receipts, independent review and uncertain-action recovery. An unavailable native engine is an explicit error, not silent Pi fallback.
2. Bundle the pinned executable and MIT notice at build time, with archive and executable hashes and platform identity. Isolate engine state/configuration, disable external plugins and external instruction discovery, and launch without a shell. Follow Desktop's separation of renderer, server/execution process and host credentials.
3. Adapt the original text matching code with provenance. CRLF and indentation differences may resolve only to one currently observed span. Reject ambiguous, overlapping, stale or unobserved edits. Do not adopt semantic block guessing or whole-tree rollback over user changes.
4. Preserve progressive public output and actual per-tool progress, input steering, cancellation, schema validation, bounded read concurrency and exactly-once dispatch. Route all source and process operations through the existing host, including their real approval and verification contracts.
5. Compare the complete development flow using held-out temporary repositories: source discovery, caller/type inspection, a narrow edit, command approval, test output, failure repair, final review and re-entry. Report contract fixtures separately from actual model runs. Compare Pi and native OpenCode under the same task/model/host policy where an authenticated model is available. Codex and Claude Code source/CLI comparisons are distinct from a matched-model engine comparison.

## Completion criteria

- The product's development path selects native OpenCode, and evidence identifies the actual engine/version used.
- Original-engine smoke and host integration tests prove model/tool round trips, repair, changed input, cancellation, permission/uncertain-result preservation and no duplicate writes.
- Existing focused coding, review, source protection, command and context regressions pass; the built Electron path exercises the selected engine.
- A source adoption matrix states original execution, adapted source, retained host implementation and remaining differences for search, edits, diagnostics, context, tools/MCP, permissions, recovery, skills, processes and Desktop progress.
- Do not assert equality with OpenCode, Claude Code or Codex from parser tests or scripted providers. Actual model results, Windows installation and connected services remain separately identified.
