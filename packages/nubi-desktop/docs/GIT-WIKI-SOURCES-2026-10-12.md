# Git import and Wiki source availability

Remote HTTPS, SSH URL and SCP-style addresses normalize trailing slashes before deriving a destination name and invoking Git. Password-bearing, query/fragment and unsupported-scheme URL rejection stays intact; no credential or transport changes.

`git ls-files --cached` includes entries that cannot be read as local source files. Wiki enumeration now excludes tracked deletions, sparse entries and submodule gitlinks using Git's own index metadata. It does not fetch submodules or expand sparse checkout. Initialization and update source snapshots reuse the helper; excluded entries contribute to the initialization exclusion count. Source disappearance during reading is a source-change failure, and initialization rechecks the source inventory and hashes before publication. Existing relative provenance, original Git history, worktree cleanup and project scope protections remain.

The user's failure stage was file reading. The local missing-file case is reproduced by tracked deletions and absent gitlinks. The exact path missing on the user's Windows installation remains unknown; do not claim it is conclusively one of these cases.

12 focused tests passed: remote normalization/guards, source availability, concurrent file addition/deletion, nested clone root/history and Wiki initialization/update. Log: `verification/git-wiki-source-tests.log`. Windows installation and real-model generation remain separate verification boundaries.

The final bundled Wiki update and mail regression suite passed 32 tests (`verification/wiki-mail-regression.log`). This includes the shared initialization/update boundary, not real-provider result quality.
