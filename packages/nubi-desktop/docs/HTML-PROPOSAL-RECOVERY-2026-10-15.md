# HTML proposal recovery

User report: GLM 5.2 showed “새 파일 제안 실행 실패” while creating HTML. The original error code and model response are unavailable; the reported incident's exact cause is not confirmed.

## Confirmed gap and change

New-file observation failures reused existing-file guidance: `source_read_required` instructed the model to call `read_source` on a file that did not exist. A create plan reported no action discriminator. Missing plans and oversized content likewise suggested existing-file recovery.

- Create-plan failures now carry `action: create`; new-file observation failures carry the exact target path.
- Recovery directs the model through `inspect_path`, a create plan and a fresh proposal. Missing parents still require approved setup, and existing files require the existing edit flow.
- Size failures require complete valid text or separate complete files, never a patch against an absent file or silent truncation.
- Activity records retain allowlisted proposal error codes and show concise cause labels instead of only generic failure.

This reuses the existing observation/plan/review mechanism. No dependency or model-specific bypass was introduced. Proposal generation does not write project files; application still checks rules, collisions and readback after human approval. HTML syntax remains explicitly unsupported by the syntax checker, so browser validation is still needed.

## Verification

The synthetic provider test exercises the actual agent loop and filesystem: missing create-plan observation, missing direct proposal observation, missing plan, accepted HTML field aliases, stored proposal, no file before approval, and exact readback after explicit application. It failed before the fix and passed after it. This is not a live GLM 5.2 or Windows installer result.
