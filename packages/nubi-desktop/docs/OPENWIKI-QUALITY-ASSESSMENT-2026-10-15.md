# OpenWiki quality assessment — 2026-10-15

## Verdict and evidence boundary

The architecture has useful source identity, freshness, history and bounded research safeguards. Current quality is not established as high. Prior hard-40 OpenWiki results were 9/10 on a frozen older candidate, one trial per case with a small synthetic corpus. They are not the current build's score or a large-repository result.

This review inspected current source, reread recorded live evaluations, ran 28 existing focused tests successfully, and executed three synthetic function-level probes. It made no live model calls or product-source changes. The probes demonstrate missing validation, not an observed rate of real-model mistakes.

## Confirmed weaknesses

| Priority | Current behavior | Evidence | Improvement |
| --- | --- | --- | --- |
| P0 | A quote saying “배포 승인을 거절합니다.” accepts a fact whose value is “승인됨” | `groundFacts` checks quote containment, not whether the quote supports the value; synthetic contradictory input accepted | Store exact evidence spans and separate observed quotation from inferred value. Require entailment/negation checks for material claims, with explicit unverified/conflicting states. |
| P0 | An invented owner without a matching quote survives | `STRICT_KINDS` covers deadline/approval/request/amount only; synthetic owner retained after quote removal | Apply evidence requirements to all fact kinds, including absent/unknown kind. Never present ungrounded extracted facts as verified. |
| P0 | Importing newer mail before older mail loses the older period in the fact index | `recordMailFacts` skips an older value; synthetic 10/14 then 10/1 import gives no fact for 10/5 | Insert facts by effective time, preserve original observation time and conflicts. Do not overwrite today's value to repair history. Original mail remains available; this is a fact-index gap. |
| P1 | Long mail fact extraction sees only a leading excerpt, with at most eight facts | `FACT_LIMITS.excerpt=3000`, `perMail=8`; summary hints do not guarantee missing tail evidence is recovered | Split by sections/thread boundaries, preserve source offsets, report coverage and deduplicate grounded facts. Include late corrections and conditions. |
| P1 | Fast wiki search reads only an initial bounded set and rereads documents each query | `queryWiki`: 400 documents / 4MiB before ranking, five returned excerpts | Incremental hash-based index over all eligible pages; search before loading selected passages. Retain ignored-path and freshness checks. This limit is specific to `wiki_query`, not all OpenWiki research paths. |
| P1 | Complex questions can trigger repeated research and synthesis | Historical S30 and hard-40 traces; current 8-minute / 120-research-call guard | Measure routing, unique evidence and marginal progress. Use existing direct fact lookup first; escalate to delegated synthesis only when evidence is insufficient. Reserve budget for final checking and disclose partial coverage. |

Current mail fact extraction is enabled in `runtime/service-entry.mjs`. Time-aware facts already exist; adding Graphiti-like storage from scratch would duplicate work. Structural BM25 plus declared-graph fusion already exists. Evaluate improvements to these implementations before adopting another service.

## Evaluation proposal

Freeze 40 unseen cases: Code 20 (single fact, cross-file reasoning, updates, absent/conflicting evidence: five each); Personal 20 (threads, time/versions, long messages, conflicting decisions: five each). Run each three times on the same candidate/provider/effort: 120 executions. Keep tuning cases separate from holdout cases. Include corpus-size variants rather than only increasing reasoning difficulty.

Record separately: answer correctness, decisive-source recall@k, claim support, current-vs-historical accuracy, appropriate abstention, requested output format/readability, p50/p95 elapsed time, unique reads, repeated reads and model calls. Timeouts and partial answers stay in the denominator. Human or independently configured judging supplements deterministic source/value/date checks; it never replaces them.

Use bundled `packages/openwiki/evals/ledger` for generated-page claim categories (`supported`, `stale`, `invented`, `unverified`). A successful generation or unchanged source hash does not establish factual correctness. Re-evaluate after uncommitted edits, deletion, rename and out-of-order mail imports.

Proposed release gates, not current measured results: zero fabricated citations and critical approval/amount/date reversals in the frozen set; at least 95% supported material claims; at least 90% strict task pass, with repeated all-three-pass rate reported separately. Calibrate latency targets with the connected provider and corpus size rather than assuming a universal response-time guarantee.

## Order

1. Add the three reproduced gaps and long-mail cases to the frozen regression suite; fix evidence admission and chronological insertion.
2. Measure full-corpus retrieval and introduce incremental indexing, retaining project/account boundaries.
3. Benchmark existing direct lookup vs delegated research, then tune escalation and stop conditions.
4. Run Code/Personal end-to-end holdout evaluation and report shortcomings without averaging away critical errors.

## References

- Local: `HARD40-EVALUATION-2026-10-13.md`, `LIVE-EVAL.md` S30, `MAIL-WIKI-QUALITY-2026-10-14.md`, current `runtime/wiki-evidence.mjs`, `runtime/mail-facts.mjs`, `runtime/wiki-research-budget.mjs`.
- [Anthropic contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval): contextual chunks, lexical/semantic retrieval and reranking are candidates to compare with the existing lexical/graph path, not an assumed improvement.
- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): representative datasets, task-specific criteria and continuous evaluation. This proposal reuses the local harness; it does not require the hosted Evals platform.
