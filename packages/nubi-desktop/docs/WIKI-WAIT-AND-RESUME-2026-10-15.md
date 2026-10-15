# Wiki waiting and resumable initialization

## Behavior

Repository init and update use a Wiki-only model wait policy: no five-minute absolute request deadline, ten-minute inactivity deadline, and a slow-response notice after thirty seconds. Parsed model activity renews the inactivity deadline. File enumeration and reading are not subject to this model timer. User cancellation remains immediate. Ordinary chat and image policies are unchanged.

A silent timeout pauses rather than automatically repeating another ten-minute request. Existing bounded network/server recovery remains. Once a terminal model error occurs, later page workers cannot issue the same failing request again, and a runner returning skipped pages cannot hide that model failure as successful generation.

Initial generation keeps one source snapshot and the native OpenWiki durable run under the owning project's private storage (`wiki-preparation/run-*`). Retry revalidates current source hashes, Git HEAD and the saved source copy. Matching inputs reuse OpenWiki's `.run.json`, page/Claims state and completed-page reconciliation; changed or missing copies restart from current sources. The original project is not Git-initialized. Restart alone never resumes a cancelled job.

A finished model generation is recorded separately from publication. Retrying failed publication reuses those generated documents. Completion or explicit reset removes the saved worktree. A failed run retains its copy until retry/reset; the copy consumes local disk space. It contains the same admitted text sources as the previous temporary snapshot, with a private parent directory, not credentials. The app's private-path exclusions still apply.

### Git preparation timeout follow-up

The reported `wiki_git_timeout` happens before model analysis. `git add`, `commit`, `read-tree` and HEAD verification inherited the interactive 20-second limit; only worktree creation had a longer limit. Initial failure cleanup discarded copies before the ready checkpoint, so retry repeated the preparation even when Git had already completed part of it. Plain-folder preparation also rewrote the history working tree and wrote the same sources into the analysis copy twice.

Git preparation now has a ten-minute limit per command and the owning job's AbortSignal. This is a bounded command budget, not a predicted duration. Initial failures retain both unfinished and ready copies. Matching source hashes/HEAD reuse the private preparation directory; existing detached worktrees must match the original repository's common directory and HEAD before reuse. Ready copies still validate their contents before invoking OpenWiki. Git verification timeout does not invalidate a saved checkpoint.

Plain-folder history prunes removed/excluded sources, writes only changed content and keeps unchanged mtimes for Git's index cache. It retains its private incremental history; the original project is never initialized or committed. The analysis copy is written once, and a receipt written after copying `.git` avoids repeating a completed history copy on retry. An incomplete history copy is rebuilt. This uses independent Git objects rather than shared alternates: extra disk space is accepted so later maintenance of the source history cannot remove objects needed by a retained analysis copy. Reference considered: [Git clone shared-object caveats](https://git-scm.com/docs/git-clone).

The UI names the current preparation operation (repository, source copy, index, commit, history copy, verification), retains elapsed time, and reports file counts only when measured. Retry checks current sources again, then reuses prepared files/documents. It does not promise to resume a Git process midway through its command. Cancellation stops the Git child and never starts the model or resumes automatically. Slow Windows disk/security scanning has not been measured on the reporting PC; the specific slow sub-operation is now visible without exposing command output or paths.

## Design choice and boundaries

Reuse the installed OpenWiki native generation lifecycle (`src/generation/repository-run.ts` and `src/agent/repository-runner.ts`) instead of inventing another per-page resume format or replaying a full model transcript. OpenWiki owns page validity and completed-page reconciliation. Desktop owns source isolation, admission, cancellation and publication.

The new durable copy applies to initial generation. Update proposals retain their existing apply/discard and failure cleanup contracts; they benefit from the new model wait policy but do not gain durable update-copy resume in this change. Source scanning is repeated to verify freshness before reuse. An interrupted page's incomplete model reasoning is not recovered; that page can be researched again.

## Verification

### Planning completion and durable failure boundary

An AI Pro-style prose-only completion reproduced `planning / wiki_failed` with the actual bundled OpenWiki planner. The planner requires a validated `submit_plan` call; an explanation alone is not a plan. Desktop now retains the current transcript and asks for the missing tool submission up to twice. Rejected/empty responses during planning use the same submission reminder instead of asking for a short prose sentence. Only a matching native `accepted` tool receipt permits a text-only final response. Persistent omission reports `wiki_plan_missing`; native invalid-plan/recursion failures and transport failures receive distinct sanitized codes. The production user's original server response was unavailable, so this reproduces one confirmed failure path, not every cause of `wiki_failed`.

The real runner also revealed that its finalizer removes `.run.json` after skipped pages. Checking the terminal model error only after the runner returned was too late. Desktop now stops at the native `finalizing` progress boundary before removal. Explicit retry reuses the accepted plan and only retries unfinished page work. Original files are unchanged and cancellation does not restart work. This preserves initial-generation checkpoints; the update-copy limitation above remains.

Verification uses the actual bundled runner with scripted model responses: prose followed by a valid plan, invalid response followed by a plan, persistent omission, and page authentication failure followed by explicit resume. It does not prove the user's live AI Pro server or Windows machine succeeds.

- Fake clock: eight minutes of active model response survive; ten minutes of silence ends once; cancellation interrupts immediately.
- Desktop integration with synthetic model: local/Git snapshots survive host reopen, changed sources restart, publication retry does not invoke the model again, terminal failures are not swallowed by skipped pages.
- Real local Git with injected preparation timeouts: both plain-folder and Git partial preparation survive host reopen, use the same analysis directory, preserve original project state and complete on retry. Verification timeout reuses copied Git history and unchanged file mtimes. A real child process verifies cancellation with the longer budget.
- Focused source/update regression batch: 53 passed. Preparation/init/native-bundle/wait batch after the follow-up: 33 passed (overlapping tests, not additive).
- Existing Desktop Wiki source, update, UI state and chat-admission regressions.
- Existing shared recovery regressions and upstream OpenWiki durable lifecycle/runner suites.
- Synthetic checks are not live-provider throughput measurements or Windows/company-network verification.
