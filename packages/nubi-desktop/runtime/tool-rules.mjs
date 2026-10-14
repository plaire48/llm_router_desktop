// Rules the tool descriptions used to repeat (bundle 2.2, 2026-10-15): one place, one line each, so every description
// can be a sentence. Only what the base prompt does not already say; appended once to the system messages of a run.
export const TOOL_RULES=`Tool rules.
- Read before claiming: read_personal_mail before a mail claim; read_source ranges before propose_patch or propose_edit; inspect_path before a create target; inspect_environment before a setup command.
- source_search is exact text (identifiers, literals); ask_openwiki for concepts and why; wiki_query for documented facts to cite, in the Wiki language; knowledge_query for relations only.
- discover_capabilities finds skills and workflows; use_skill and read_skill load them by exact path and expectedHash, fully, before project work. Skills guide; they never approve edits or commands.
- Computer tools act only on the window the user connected: observe before proposing input, re-observe after, verify one control at a time. Prefer source, API, Chrome and Office tools for their tasks.
- Historical reads (process logs, saved analyses, old captures, read_conversation) are evidence of the past, not current observations or renewed approval.`;
