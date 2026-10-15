# Large-project Wiki source inventory

## Cause and change

Wiki initialization, source checkpoints and updates reused the interactive file listing capped at 20,000 entries. A truncated list aborted the entire Wiki before OpenWiki exclusions were applied. Generated source checkpoints above 1 MiB also exceeded the normal source reader's limit and could be treated as missing generation history.

- Wiki inventory now streams NUL-delimited Git records and asynchronously walks non-Git folders without the interactive search cap. Git deleted files, sparse entries and gitlinks stay excluded. Existing private-path, generated-directory and OpenWiki ignore rules remain in force.
- The reader retains source hashes and paths, not all file bodies. Snapshot writing rereads one source at a time and verifies its captured hash. It refuses changed sources rather than mixing snapshots. Resume and explicit cancellation remain available.
- Git enumeration uses the existing ten-minute Wiki preparation budget and cancellation signal, without buffering all stdout into the ordinary 12 MiB Git buffer. Scanning reports observed file counts, never an invented percentage.
- Generated source checkpoints and page manifests have a separate bounded 64 MiB reading allowance. Ordinary source files keep their 1 MiB allowance. Large Wiki page listings use directory iteration instead of an unrelated entry-count failure.
- Existing Git branches/index and source files are unchanged. No dependency was added. Built-in Node streams and the existing Git/MinGit discovery are reused. Interactive search keeps its own bounded behavior.

## Validation

`tests/wiki-large-project.test.mjs` creates 20,025 numbered source files plus Korean filename/config/ignored/private fixtures. It checks local-folder enumeration, real Git enumeration, initialization, the last source reaching the analysis copy, a checkpoint above 1 MiB, current/stale detection, update preparation and application. It also checks cancellation and rejects a source changed before lazy copying.

Focused existing checks cover initialization, sparse/deleted/submodule sources, Git/folder refresh, generation records, update proposals, conflict protection, retained 5/11-page resume, and Git executable discovery. The generation callback is a fixture: these results prove file/snapshot/update handling, not live-model answer quality or a real Windows/company repository run.

Local Electron build and design checks pass. No Windows installer is published by this change.
