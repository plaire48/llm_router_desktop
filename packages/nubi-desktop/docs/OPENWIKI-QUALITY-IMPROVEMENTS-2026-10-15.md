# OpenWiki quality improvements — 2026-10-15

## Scope

This implements the first evidence-integrity, temporal-history, long-mail and retrieval improvements from `OPENWIKI-QUALITY-ASSESSMENT-2026-10-15.md`. Existing Wiki generation, source-change preservation, project isolation, approval boundaries and the 8-minute / 120-research-call guard remain in place. No new service or dependency was introduced.

## Changes

- **Quoted observations, not inferred truth.** Every admitted mail statement must reproduce a complete source sentence or line, including its negation and conditions. The model's value must equal its quotation. Missing quotes and paraphrases are rejected for all kinds. A host-computed body hash and character span accompany the quotation. Subject/predicate/kind remain fallible navigation hints. `source_excerpt` proves source presence, not factual truth, approval authority or completeness. Legacy records remain explicitly unverified and require reading the original. Spans refer to the body supplied to extraction (the mail organizer removes quoted reply history first), not raw MIME bytes.
- **Chronological observations.** Newer-first imports no longer discard earlier statements. Dated repetitions remain separate so A → B → A survives any import order. Same-time disagreement remains visible. Re-importing the same source/value/date is idempotent. Interval changes and inserted observations commit in one SQLite savepoint. A failed write rolls both back. The agent tool description now distinguishes observation dates from verified effective dates.
- **Long mail.** Extraction uses up to 12 sequential sections of 3,000 characters with 240-character overlap and eight statements per section. Exact duplicate entity/attribute/statement combinations are removed. Coverage records contain actual successfully processed ranges, failures and rejected candidates. A section limit or transport failure cannot imply full coverage. These are coverage measurements, not a claim that every relevant fact was extracted. Facts remain a convenience over the saved page; failure does not discard mail.
- **Corpus-wide ranking.** `wiki_query` no longer ranks only the first 400 files / 4 MiB. It maintains a per-service, per-project in-memory MiniSearch index. It checks the current file inventory and scope every query, reloads changed files and replaces indexed content by hash. Deleted, ignored and older revisions are excluded. The 48 best document candidates feed existing structural excerpt retrieval; declared graph links remain available. Selected original bytes are hash-checked again before citation. This is a two-stage lexical improvement, not semantic embeddings or a reranker.

## Explicit bounds

The admitted search corpus has a 64 MiB raw-file budget and uses the existing 1 MiB per-file and inventory limits. Two project caches are retained per service. Index memory has overhead beyond raw bytes. Skipped files, candidate limits and changed-during-read results make retrieval incomplete; they are not silently represented as complete coverage. Metadata checks still cost filesystem work; the cache avoids rereading and reindexing unchanged bodies, not all I/O.

Mail temporal identity still uses extracted subject + predicate. Entity resolution and cross-sentence entailment are not solved. An exact sentence can still omit context from another sentence: the agent must read the original for material decisions. No pre-existing mail is automatically re-extracted, and the generated summary page has its own synthesis path; these changes do not retroactively certify old summaries.

## Verification

- 103 related tests passed: extraction admission, reversed approval rejection, owner evidence, condition preservation, long-tail correction, bounded/failed coverage, six import permutations, same-time conflicts, write rollback, actual mail organization/storage integration, full-corpus retrieval, >4 MiB retrieval, ignored/deleted/changed evidence, Wiki generation/update/carry/context and research-budget regressions.
- Claude Opus 5.5, medium: five synthetic extraction component cases passed once (refusal, conditional approval, owner, unapproved request, tail correction). This tests the actual provider/structured-output boundary; it is not a mailbox, generation or overall accuracy evaluation.
- 1,200 synthetic pages on this Mac: old first-400 search missed a decisive last page; new search found it. New cold search 175 ms; five warm searches p50 56 ms, p95 71 ms. All 1,200 unchanged bodies were reused on warm search. Old limited lexical scan was 51 ms, so this is improved coverage and reuse, not a claim that first search is faster.
- Live Code 20 / Personal 20 acceptance benchmark, three trials per case: see `verification/openwiki-quality-2026-10-15/summary.json` for the current measured state. Preliminary runs before the final source freeze remain separate. Do not sum them into the final candidate's score.

## Evaluation contract

`eval/wiki-quality-40/cases.json` fixes 40 distinct acceptance tasks and answer/source checks. The actual Desktop agent, planner, tools, review and provider adapter execute through `eval/driver.mjs`. Inputs are synthetic. Answers are not placed in the agent workspace. Personal fixtures exercise search/read/answer; extraction and actual ingestion have separate component/integration tests.

The runner records candidate and benchmark hashes, provider/model/effort, each answer, source references, transcript, time, model and delegated calls, repeated reads and unchanged-file checks. It stops between cases if the candidate changes. Three isolated workspaces may run concurrently; shared-provider contention affects latency. Missing trials stay in the denominator. The source/model must match to compare or resume results.

Automatic expected-string and decisive-source checks are a screening gate. They can miss contradictions or reject legitimate paraphrases, and must be manually reviewed. The dataset was authored during this work; it is not an independently blinded holdout. A zero-failure result would not establish 95% supported claims, general production quality, real company mailbox behavior or Windows success. Those remain separate gates.

## Reproduce

```sh
node --test --test-concurrency=1 tests/mail-facts.test.mjs tests/mail.test.mjs tests/wiki-evidence.test.mjs tests/wiki-folder-pages.test.mjs tests/wiki-research-budget.test.mjs tests/wiki-steering.test.mjs tests/wiki-carry.test.mjs tests/compaction-wiki-evidence.test.mjs tests/knowledge-map.test.mjs tests/wiki-initialization-flow.test.mjs tests/wiki-update.test.mjs tests/mail-thread.test.mjs
node scripts/measure-wiki-search-performance.mjs
node eval/model-session.mjs --provider claude --model claude-opus-5-5 --effort medium
node eval/wiki-quality-40/extraction-live.mjs
node eval/wiki-quality-40/run.mjs --out verification/wiki-quality-new-run --trials 3
```

Use `--prepare-only` to record the planned denominator without spending model quota. `--resume` requires matching source and benchmark hashes. Never point the recording harness at company or personal material.

## Remaining quality work

- Independently judge material-claim support, omissions, cross-sentence conditions and concise answers; do not substitute automatic string matching.
- Compare direct lookup and delegated research on genuinely complex cases before changing routing. Existing direct lookup was retained; there is no new semantic router in this change.
- Evaluate generated Code/Personal pages with the bundled LEDGER claim categories and original sources. Existing generation regressions are not generated-content accuracy.
- Consider contextual chunk metadata or a reranker only after measured failures justify them. Existing lexical retrieval and declared graph links are reused rather than adding another infrastructure layer.

## Presentation experiment — not adopted

Six final-turn replays (three tasks, two trials) added a shorter-answer instruction to the Claude CLI adapter only in the evaluation wrapper. Responses shortened, but one changed “authority information was not provided” into “no authority exists.” The candidate was rejected and the product adapter was not changed. This failure is kept in `presentation-comparison.json` and is not counted as a failure of the frozen product candidate. A more compact answer needs semantic checks, not an arbitrary character cap.

The same authority overclaim also appeared in the frozen product baseline (`personal-12`, trial 2). The replay does not establish that shortening caused it; it exposes a pre-existing entailment-review weakness. `personal-02`, trial 1 also calls a necessary condition the only condition. A separate four-case review-guidance experiment rejected both overclaims and accepted two accurate controls.

## Actual Code generation and content audit

The real Desktop folder initialization completed with Claude Opus 5.5 medium in 611,208 ms (38 model calls) on the isolated 11-source order-service corpus. It produced 12 Markdown pages, seven claim files containing 75 extracted claims, the manifest and source checkpoint. Only `openwiki/` was added to the original synthetic folder; no `.git` was created there. The state became `current`. Concurrent evaluation workloads were active, so this timing is not an isolated latency benchmark.

Content quality is not fully correct. Manual inspection of seven substantive pages found two executable counterexamples: the generated discount guide promises error-free integer multiplication without a safe-integer bound, and the status guide says all unknown states return false although `canMove('toString','paid')` throws TypeError. A diagram also degraded to a text fence. Source hashes and the `verified` generation metadata do not prove these prose assertions. See `generation-folder/content-audit.json` and its preserved synthetic corpus. No generated output was edited to conceal the run. This is a targeted content audit, not an exhaustive LEDGER run or an overall claim-support percentage.

## Measured answer-format conflict

The main agent initially says to use 1–3 sentences for lookups, but a later system message asks for a compact table after every conclusion. Trial-2 answers repeatedly restate the same facts in both prose and tables. The proposed correction makes tables conditional on actual comparison needs, while preserving material uncertainty and approvals. This is separate from the rejected blanket shortening experiment above.

## Completed baseline and follow-up candidate

The frozen 120-run baseline completed: Code 58/60 automated passes, Personal 59/60, zero runtime errors and no source changes. Manual review identified legitimate paraphrase false negatives and necessary-condition/authority overclaims in passing answers; 117/120 is not a semantic accuracy score.

The final candidate adds `CLAIM_REVIEW_GUIDANCE` only for knowledge evidence, reserves it before evidence admission in the existing context budget, and preserves it across malformed-review repairs. The base review, normal conversation path and approval checks stay intact. It also removes the mandatory-table instruction that conflicted with concise lookup guidance. Focused regression: **150/150**, no skips. `npm run compile` succeeded. A knowledge repair test verifies the actual prompt and evidence survive repair; a large-evidence test verifies the added guidance stays inside the input budget. The existing repair expectation now uses the actual constructed input prompt rather than assuming every review uses only the base prompt.

Twelve selected full-agent trials (code-07, personal-02, personal-12, personal-17, each three times) ran on the final candidate. Both baseline and follow-up scored 11/12 on unchanged automatic checks. The follow-up false negative is an accurate paraphrase of conflicting decisions. All twelve follow-up answers were manually read; the original necessary/sufficient and missing-authority overclaims were not reproduced. One historical-state answer still has an overstrong current-state lead. Tables dropped 12 → 0, average answer length 733 → 677 characters; repeated caveats remain. Latency did not improve (p50 43.4 → 50.6 seconds with different concurrent load). Do not extrapolate these selected trials to all 120 or claim a causal speed gain. See `review-fixed-summary.json` and the Korean result report `OPENWIKI-QUALITY-RESULTS-2026-10-15.md`.
