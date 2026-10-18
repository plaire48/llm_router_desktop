// Rules the tool descriptions used to repeat (bundle 2.2, 2026-10-15): one place, one line each, so every description
// can be a sentence. Only what the base prompt does not already say; appended once to the system messages of a run.
export const TOOL_RULES=`Tool rules.
- delegate_research/continue_research return advisory leads; reread original sources before citing them or editing. Scope paths bind reads/searches and follow-ups. If status is not complete, narrow and redelegate or read directly before using findings.
- analyze_documents: Read-only UTF-8/Markdown over 60,000 chars, up to 32 relative paths; report unread ranges; ~5 model calls/24,000 chars. Use ask_openwiki for Wiki questions.
- read_attached_document: Use selectedDocuments id/sourceHash; offsets belong to that body; unlocated segments are unverified.
- delegate_analysis: Frozen evidence_ids only; collect_analysis wait=false returns ready reports, task_ids reads history.
- update_wiki: On user request, pull --ff-only if a remote exists, then run the Wiki refresh action.
- read_personal_mail: Search/selectedMail ids need no project; attachments use attachmentId and nextOffset as offset. personal_mail_query returns read ids and relatedTo candidates.
- compare_local_pages: Only exact localhost URLs observed this run; capture and store their comparison.
- propose_command_repair: Read the failed process output first; the user runs the repair.
- spawn_task: Confirmed out-of-scope work only, never vague smells or one-line fixes; a standalone 200-4000 char prompt needs paths, evidence and expected results. dismiss_task only when fixed this run.
- send_file only for files this run produced for the user (reports, captures, generated documents), not for sources you read. Supply exactly one of path or captureId.
- Destructive commands, file deletions and external MCP writes wait for approval in every mode; only an exactly allowed shell command is exempt. Prefer reversible steps.
- Skills: discover exact path/expectedHash before use_skill. read_skill pages 8000 chars via nextOffset; resource reads bundled files. list_skill_resources follows resourcesNextOffset/resourcesHash.
- read_conversation: index 0 is the request; follow next. read_document_analysis: id selects saved analysis, evidenceId one excerpt; historical and task-scoped.
- wiki_query: excerpts/evidenceIds support record_change_plan; includeHistory adds older revisions. For synthesis use ask_openwiki.
- mail_facts: quotes observed as of asOf; includeHistory keeps earlier values. Read original mail for conditions.
- update_plan: Start with intent and one in_progress step; all completed is allowed later. Independent review checks user requirements, not optional research methods. For lookups use one result step: findings, sources, actual reading scope. Disclose excerpt/original access; either suffices unless original access is required. Add no PDF, source quota or ranking requirement. Keep requested UI actions, scope, approvals and, for recency, labeled source dates, read time and uncertainty. Event dates differ from source dates.
- ask_openwiki: Synthesis or how/why research in openwiki/ separately returns sources and gaps. Simple documented facts can use wiki_query/current pages. Use wiki.language. Search narrowly; exhaustive review is only for an explicit whole-Wiki request and costs many calls; check current source for stale Wiki (wiki.updatedAt), missing evidence or code-dependent claims.
- compare_document_values: Read sources first; attachments must belong to this task. UTF-16 ranges and hashes identify strict decimal/grouped numbers. Labels/units are your interpretation; no formula recalculation or whole-document verification.
- learn_browser_screen: On user request, save structure; ask only about unclear business meaning. Answers stay in the project-private screen wiki, bound to this tab/document, without execution authority. Ask again only if more explanation is needed.
- remember_browser_screen: Use the current host model and project-private wiki to save labels for matching screens, never results, field values, execution authority or verified procedures.
- File proposals: Current hashes; patches ≤10 unique non-overlapping replacements; whole edits need every line read; creates need a free path, existing parent and planned create target.
- read_source returns at most 1000 lines starting at 1 by default; follow nextStart. read_process_output pages are 8000 bytes, query is literal, and waitMs waits at most 5 seconds for output/exit, never readiness.
- mark_chapter only at a phase change; never for the first request; 3-8 per conversation is typical, at most 20 total and 5 in one run.
- Read before claiming: read_personal_mail before a mail claim; read_source ranges before propose_patch or propose_edit; inspect_path before a create target; inspect_environment before a setup command.
- Mail searches AND-match within one item; relax terms within filters. relatedTo takes a mail id with empty query: dated candidates, not causality. local:* selects a folder category. Never claim unread mail/attachment ranges were checked.
- source_search is exact text (identifiers, literals); ask_openwiki for concepts and why; wiki_query for documented facts to cite, in the Wiki language; knowledge_query for relations only.
- discover_capabilities finds skills and workflows (empty query pages eight); use_skill and read_skill load them by exact path and expectedHash, fully, before project work. Skills guide; they never approve edits or commands.
- Computer tools act only on the window the user connected: observe before proposing input, re-observe after, verify one control at a time. Prefer source, API, Chrome and Office tools for their tasks.
- Historical reads (saved proposals, logs, shell profiles, interruptions, analyses, captures, conversations) are past evidence, not current observations or renewed approval.`;

// Lean catalogs retain original per-tool rules; do not duplicate deferred tools in every request.
export const LEAN_TOOL_RULES=`Tool rules.
- spawn_task for confirmed out-of-scope work only (dead code, stale docs, missing coverage, a confirmed TODO), never vague smells or one-line fixes. Include observed file paths, evidence and expected results in a standalone 200-4000 character prompt. dismiss_task only when fixed in this run.
- send_file only for files this run produced for the user (reports, captures, generated documents), not for sources you read. Supply exactly one of path or captureId.
- Destructive commands, file deletions and external MCP writes wait for approval in every mode; only an exactly allowed shell command is exempt. Prefer reversible steps.
- mark_chapter only at a phase change; never for the first request; 3-8 per conversation is typical, at most 20 total and 5 in one run.
- Read before claiming: read_personal_mail before a mail claim; read_source ranges before propose_patch or propose_edit; inspect_path before a create target; inspect_environment before a setup command.
- Mail searches AND-match terms within one item; relax terms within filters. relatedTo accepts a mail id with an empty query, returning dated relation candidates, never proven causality. local:* selects a folder category. Never claim unread mail/attachment ranges were checked.
- source_search is exact text (identifiers, literals); ask_openwiki for concepts and why; wiki_query for documented facts to cite, in the Wiki language; knowledge_query for relations only.
- discover_capabilities finds skills and workflows; use_skill and read_skill load them by exact path and expectedHash, fully, before project work. Skills guide; they never approve edits or commands.
- Computer tools act only on the window the user connected: observe before proposing input, re-observe after, verify one control at a time. Prefer source, API, Chrome and Office tools for their tasks.
- Historical reads (process logs, saved analyses, old captures, read_conversation) are evidence of the past, not current observations or renewed approval.`;

