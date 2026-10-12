# Workspace Beta: plan, retrieve, act, verify

## Product flow

The existing Pi actor owns one task from request to grounded answer. OpenWiki is a knowledge worker, not the owner of command execution or user consent. Desktop A2A remains disabled.

| Request | Evidence path | Completion evidence |
|---|---|---|
| Rewrite or answer from supplied text | Answer directly | Literal user text and requested transformation; no mandatory Wiki read or plan |
| Code concepts and business rules | `ask_openwiki`, then relevant current sources; literal lookups may use `wiki_query` / `source_search` | Current source plus Wiki freshness and citation coverage; a Wiki answer is not proof of current behavior |
| Personal mail | Selected IDs directly, otherwise `personal_mail_query` with sender/date filters, then `read_personal_mail` | Original body plus that email's Personal Wiki notes and their state; pending/missing notes do not become completed Wiki work |
| Bash / PowerShell | Relevant environment if needed, exact command proposal, existing approval, process receipt/output, next necessary operation | Actual output and requested effect; one exit is not whole-task success |
| Mixed request | Plan selects the necessary workflows and reconciles sources | Mail claims, Wiki claims and executed observations remain distinct |

`/mail` and `/code` keep their existing host-enforced read-only boundaries. Plain requests can select multiple domains as needed. Mail is a search of **collected local mail and its Personal Wiki**, not an automatic fresh POP3 fetch or a separate OpenWiki Personal research agent on every question. Attachment bodies remain unsupported in this Beta.

The UI uses the existing short plan/progress rows and source links. Public tool progress and actual outputs are shown; private reasoning is not. Necessary decisions use the existing in-app question/command dialog. There is no new permanent status panel or extra acceptance checklist.

## Confirmed gaps and changes

1. `taskCapabilities` had no `mail` workflow even though mail tools and a lean tool group existed. A planner choosing `workflowIds: ["mail"]` failed intent validation. The workflow now exists and describes search, original reads and coverage limits. Conceptual Code research now appears in the knowledge workflow through `ask_openwiki`.
2. The fallback planner received the task but not the active command scope or selected source IDs. It now receives bounded `routing` data: active scope, command, selected mail IDs and available proposed tool names. These are planning context, not permission or evidence. The plan still validates its schema and available workflow/skill identities.
3. Mail retrieval always returned `incomplete:false`, including unreadable sources and truncated bodies. It now reports concrete reasons, pagination separately (`hasMore`) and `serverCoverage:not_checked`. Identical empty searches are discouraged; alternate keywords keep explicit filters. Cursor reset must discard earlier accumulated pages.
4. OpenWiki grounding was checked for change-plan citations, but the independent reviewer received the original excerpts without the current-page match result. Desktop now adds matching IDs/freshness and unmatched IDs beside the preserved upstream result. Unmatched excerpts are mechanically unusable review evidence. A page match still does not prove current source behavior. The reviewer is instructed to reconcile stale source references, local mail coverage and current originals.
5. Removed contradictory capability guidance to read mail attachment bodies, and unconditional environment discovery wording for self-contained host commands.

The prior turn's successful-command continuation, selective reads, precise command approvals and popup decisions are retained; see [TASK-DECISIONS-CONTINUATION-2026-10-12.md](TASK-DECISIONS-CONTINUATION-2026-10-12.md).

## Method selection, checked 2026-10-12

| Official reference | Adopted method | Boundary |
|---|---|---|
| [OpenAI harness engineering](https://openai.com/index/harness-engineering/) | Make capability maps, execution evidence and verification available to the agent; concrete checks instead of repeated exhortations | Apply to existing host receipts and workflow catalog, not replacement of the runtime |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Load the smallest relevant context just in time, with identifiers and provenance | Selected mail IDs / scoped tools / current original reads; no forced exhaustive Wiki scan |
| [Claude Code loop](https://code.claude.com/docs/en/how-claude-code-works) and [best practices](https://code.claude.com/docs/en/best-practices) | Gather relevant context, act, inspect results and iterate; give the agent checks it can execute | Existing Pi sequential tool loop, process-output continuation and task review; do not count a command exit as task completion |
| [OpenCode agents](https://opencode.ai/docs/agents/) and [permissions](https://opencode.ai/docs/permissions/) | Separate planning from action permissions and detect repeated no-progress operations | Keep existing read-only scopes, explicit execution approval, cancellation and uncertain-write reconciliation. Do not copy permissive defaults |
| [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Fixed tasks, outcome checks, regression tests and repeated trials; distinguish deterministic, model and human judgments | Existing live eval framework plus focused defect tests and synthetic mail smoke case |

No framework or dependency added. Reuse Pi, OpenWiki-SDS, Ajv and MiniSearch with existing notices/locks. Replacing them with another complete agent runtime would add duplicated state, approval and deployment costs without fixing these confirmed boundary defects. These are method adaptations, not copied proprietary implementations or benchmark equivalence claims.

## Evaluation contract

Before changes, five focused defect checks failed. The same checks must pass after changes, alongside scoped dispatch, Wiki drift, original-mail/notes isolation, plan validation, approved multi-command continuation, cancellation and recovery regressions. Prompt wording alone is not a quality score.

For actual-model evaluation, retain catalog context limits, fixed corpus and exact candidate. Report separately:

- Independently checked requested outcome and answer delivery.
- False completion, unsupported citations and duplicate execution (target zero).
- Source scope, actual original reads, stale/missing evidence disclosure and preserved filters.
- Necessary vs unnecessary human decisions.
- Model/tool calls, token usage, elapsed time and review-limit delivery.

An outcome passes only when all of its acceptance checks pass. A focused retry does not replace a full candidate score. A broader quality claim requires the same task set and provider/model with three trials each, development and held-out cases separated. Company AI Pro, Windows PowerShell and POP3 require their own measured runs.

Reproduction:

```sh
node --test tests/harness-routing-quality.test.mjs tests/mail-search.test.mjs tests/wiki-evidence.test.mjs tests/search-command-scope.test.mjs tests/agent-task-continuation.test.mjs tests/result-review.test.mjs
node eval/run.mjs --cases E1-run-tests-report,W4-stale-provider-list --trials 1 --out verification/eval-live/harness-routing-20261012
node eval/mail-routing.mjs --out verification/eval-live/mail-routing-20261012
```

The mail smoke case uses a real selected model, the real Desktop planner/actor/reviewer, real MailSearch and Personal Wiki file reads, but fixed synthetic original-mail transport. It checks searching, reading both messages, distinguishing earlier/final dates, citations and scope. It does not test server login, mail collection or Wiki synthesis.

## Verification

- Focused suite: 43 passed, including 6 new routing/coverage/grounding checks.
- Capabilities, lean tools, previous plan answers, Personal notes and review continuation: 22 passed; 1 attachment-body test skipped by the Beta feature policy.
- Plan, recovery, setup approval and internal analysis reuse: 36 passed.
- Electron build and identity design check passed. No installer, release or deployment performed.
- Actual-model results are recorded separately in the evaluation output directories above; see the follow-up result record below.

### Actual-model result record

Existing authenticated ChatGPT relay, `gpt-5.6-sol`, original catalog context window, macOS. Three focused tasks, one trial each; this is a smoke result, not an overall score or an A/B model-quality gain.

| Task | Outcome | Calls | Wall time |
|---|---|---|---|
| E1: run failing tests, identify code cause, preserve files | Passed; approved Bash command and result-driven source analysis | 14 main, 0 Wiki | 174 s |
| W4: outdated Wiki provider list vs current source | Passed; 14 documented vs 17 in source, identified AI Pro / AI Pro CLI / FabriX and cited both sources | 7 main, 14 Wiki | 191 s |
| Personal mail: changed campaign date | Passed; searched mail, read both distinct original IDs with their Personal Wiki notes, cited both, reported November 10 → November 12 | 8 model calls | 84 s |

The first two tasks had zero false-completion grades, no review-limit/stalled delivery and no unexpected human questions. The mail answer explicitly based the final date on the original because its Personal note omitted the date. Its six smoke checks passed; both distinct IDs were also confirmed in the saved transcript. The script's original count check was subsequently tightened to require successful receipts for each distinct ID; no model rerun is implied by that grader tightening.

Measured provider token usage was unavailable in this relay: zero fields in the raw report are not a claim of zero consumption. Model-call count and elapsed time are observed. There is no measured latency improvement baseline; 84–191 seconds for these tasks leaves room for further efficiency work. Do not remove provenance or execution checks merely to make the number smaller.

- [Code/Bash report](../verification/eval-live/harness-routing-20261012/report.json)
- [Personal mail report](../verification/eval-live/mail-routing-20261012/report.json)
- [Defect baseline](../verification/harness-routing-before.log)
- [Focused regressions](../verification/harness-routing-after.log)
- [Electron flow check](../verification/harness-routing-electron.log): 10 passed against an actual local Electron window and fixture model, separately from the real-model service evaluations.

Next broader comparison should fix the same candidate/corpus for three repetitions per model across direct answers, Code Wiki/current-source conflicts, absent evidence, selected mail, mail pagination/filters, stale Personal notes, command failure/correction, multi-command continuation and cancellation. Keep holdouts separate and inspect outcome/citations independently of the agent's own reviewer. AI Pro and actual Windows/POP3 remain unmeasured by this run.
