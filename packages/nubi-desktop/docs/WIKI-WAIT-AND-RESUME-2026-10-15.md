# Wiki waiting and resumable initialization

## Behavior

Repository init and update use a Wiki-only model wait policy: no five-minute absolute request deadline, ten-minute inactivity deadline, and a slow-response notice after thirty seconds. Parsed model activity renews the inactivity deadline. File enumeration and reading are not subject to this model timer. User cancellation remains immediate. Ordinary chat and image policies are unchanged.

A silent timeout pauses rather than automatically repeating another ten-minute request. Existing bounded network/server recovery remains. Once a terminal model error occurs, later page workers cannot issue the same failing request again, and a runner returning skipped pages cannot hide that model failure as successful generation.

Initial generation keeps one source snapshot and the native OpenWiki durable run under the owning project's private storage (`wiki-preparation/run-*`). Retry revalidates current source hashes, Git HEAD and the saved source copy. Matching inputs reuse OpenWiki's `.run.json`, page/Claims state and completed-page reconciliation; changed or missing copies restart from current sources. The original project is not Git-initialized. Restart alone never resumes a cancelled job.

A finished model generation is recorded separately from publication. Retrying failed publication reuses those generated documents. Completion or explicit reset removes the saved worktree. A failed run retains its copy until retry/reset; the copy consumes local disk space. It contains the same admitted text sources as the previous temporary snapshot, with a private parent directory, not credentials. The app's private-path exclusions still apply.

## Design choice and boundaries

Reuse the installed OpenWiki native generation lifecycle (`src/generation/repository-run.ts` and `src/agent/repository-runner.ts`) instead of inventing another per-page resume format or replaying a full model transcript. OpenWiki owns page validity and completed-page reconciliation. Desktop owns source isolation, admission, cancellation and publication.

The new durable copy applies to initial generation. Update proposals retain their existing apply/discard and failure cleanup contracts; they benefit from the new model wait policy but do not gain durable update-copy resume in this change. Source scanning is repeated to verify freshness before reuse. An interrupted page's incomplete model reasoning is not recovered; that page can be researched again.

## Verification

- Fake clock: eight minutes of active model response survive; ten minutes of silence ends once; cancellation interrupts immediately.
- Desktop integration with synthetic model: local/Git snapshots survive host reopen, changed sources restart, publication retry does not invoke the model again, terminal failures are not swallowed by skipped pages.
- Existing Desktop Wiki source, update, UI state and chat-admission regressions.
- Existing shared recovery regressions and upstream OpenWiki durable lifecycle/runner suites.
- Synthetic checks are not live-provider throughput measurements or Windows/company-network verification.
