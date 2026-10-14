# Personal mail relationships

Mail pages were connected only through Markdown links and matching thread keys. The library discarded In-Reply-To, References and participant metadata; the graph then relabelled every edge as a document reference. Model retrieval did not expose a related-mail lookup.

## Applied

- A shared bounded relationship builder serves the WikiLibrary and `personal_mail_query({query:'', relatedTo:id})`.
- Message-ID / In-Reply-To identify replies; References and existing thread IDs retain conversation links. Header behavior follows [RFC 5322 section 3.6.4](https://www.rfc-editor.org/rfc/rfc5322#section-3.6.4).
- Without headers, matching specific subject terms and participants within 120 days create candidates. Generic subjects, message type, proximity alone and runtime account mismatches do not create links. No external graph database, embedding service or extra LLM call is introduced.
- Links carry source IDs, hashes, dates, relation kind and reasons. Chronology is separate from causality. The model must read both originals before using changes, conditions or conflicting claims. Related lookup preserves explicit filters and marks bounded coverage.
- The graph keeps relation meaning, draws candidates with dashed lines, and shows compact relation/date captions. Existing stored Category values replace the generic Mail label in the table. Month groups use mail dates when present.
- Existing pages are read without rewriting originals. Legacy page source metadata can be read without regeneration. New pages retain References headers.

## Boundaries

This is a conservative navigation layer, not general semantic understanding. Synonyms, unrelated subject changes without headers, and explicit causal/decision relationships still require model comparison of originals. Dates alone do not prove causality, supersession or current status. No live mailbox or AI accuracy claim follows from synthetic regression checks.

Tests: mail-relations, mail-thread, mail-search, wiki-frontmatter, wiki-library, wiki-graph. UI fixture uses real WikiLibrary and WikiBrowser at wide/narrow widths. Windows, live portal mail and real-model relationship quality require separate evidence.

Validation on 2026-10-15: 41 focused tests passed; WikiBrowser + real WikiLibrary fixture passed at 1280px and 440px with no page errors or horizontal overflow. Runtime compilation and Electron bundle build passed. A synthetic 3,000-mail relationship pass took 266ms on this Mac; this measures relationship computation only, not disk reading, graph rendering, model latency or Windows performance. Screenshots and logs: `verification/mail-relations-2026-10-15/`.
