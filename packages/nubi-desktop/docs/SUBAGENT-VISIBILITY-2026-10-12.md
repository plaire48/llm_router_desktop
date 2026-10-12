# Desktop subagent work and visibility

The existing shared Pi analysis coordinator is reused: up to two active, isolated workers and six outstanding jobs, with scoped read-only evidence, the selected provider/model, cancellation and advisory handoff contracts. No new orchestration package or parallel writer was added. Existing research/review/recovery methodology and source code remain the basis.

The gap was at the Desktop mail boundary. The host now registers personal_mail_query and read_personal_mail as frozen historical observations. Each observed result receives an analysis_evidence_id that the leader can assign to a worker. A mail read contains its exact original, extracted attachment coverage and corresponding Personal OpenWiki state/hash/text. Search results remain search evidence, never original reads. The shared coordinator marks these sources as mail, while preserving historical freshness and assigned-ID checks. Children receive no mail executor, POP3 credentials or mutation authority.

Main-agent guidance recommends independent delegation for nontrivial multi-source investigations, with a short Korean brief and done_when. The leader reads exact sources first, assigns separate evidence, collects reports and verifies the result against originals. Simple or dependent work remains sequential; guidance is not proof that every request delegates. The existing coordinator's real start/read/delivery records are the evidence.

The current run's role history stays visible alongside its latest review after completion. Role entries expose assignment, true phase, read evidence, response and main-agent delivery. A finished report is not automatically an approved action or verified result. Older runs remain separate and stopped workers cannot appear active after restart. No private reasoning or simulated progress is displayed.

Desktop external A2A remains disabled under the existing release decision. Browser/Office delegation requires an explicit destination and its real connection/authority contract; the current work does not claim that connection.

Validation: 16 existing focused agent/mail/history tests plus a new two-mail concurrency and evidence-isolation test passed. The new test waits for both worker transports before releasing them, verifies one assigned original and Personal note per worker and checks both handoffs reach review. This is synthetic transport evidence, not a real-provider claim. Renderer/runtime build and design identity check passed. Live verification is recorded below when completed.

Shared UI regression passed, including two current-run assignments staying visible after the final review and both delivery states. The actual app was restarted with the new worker and restored its saved conversation. ChatGPT authentication was cleared by the existing memory-only contract; real-provider verification is waiting for the user's reconnection. The connection dialog is open. No live multi-agent success is claimed yet.

## Live verification and review correction

After reconnection, ChatGPT GPT-6.1-Sol ran two read-only workers on the user's two saved mails and their Personal notes. Run `33163f3f-3b43-4030-b95c-f8be79cc5989` recorded both workers active concurrently, then done and delivered. Each worker recorded two reads and three model calls. Both reports were partial findings, with original-source limitations preserved. The UI displayed both assignments and delivery states.

The final reviewer nevertheless demanded proof of execution and delivery, repeated review four times, and handed off with `review_limit`. This was not a fully verified successful run. The host now includes current-run coordinator lifecycle receipts in review input, separately from advisory report contents. Receipts prove only observed execution/read/call/delivery state; they cannot establish source facts or business completion. A regression verifies scope isolation and exclusion of child conclusions. The focused search/history/review suite passed 24 tests and the Electron build passed. The corrected review path still needs a new real-model run after reconnection.
