# Chat width, proposal decisions and shared Wiki reads

User reports: fixed chat width, proposal cards with no usable decision during analysis, uncolored diff counts, and shared Wiki errors asking for an initial commit without evidence.

## Changes

- The chat content container sizes the shared transcript/composer token: `clamp(700px, 84cqi, 1120px)`. Existing available-width constraints and side insets handle smaller windows and the auxiliary pane.
- Proposed file cards appear only when the conversation can be reviewed, with no pending question or active project agent. Cancelled/superseded records are not invitations. Uncertain saves retain a separate read-only comparison notice.
- Added/deleted lines use existing success/danger text tokens and keep numeric signs. Repeated review badges are removed; successful syntax validation uses an accessible check icon.
- Explicit cancellation preserves source and proposal artifacts, records cancellation, and rejects pending commands whose prerequisite is that proposal. New-file preparation rechecks state after async validation. Electron editor proposal writes pass their proposal ID, validate exact task/path/hashes and current state, and reserve the write before asynchronous I/O. A late cancelled save cannot overwrite the source. Normal manual editor saves retain their existing contract.
- Shared Wiki snapshots try the exact declared branch via Git ref, commits, then branch endpoint on 404/409/422 only. Authentication/permission failures are not bypassed; successful reads remain pinned to a validated commit SHA. No repository initialization or writes occur during listing. Failed refresh clears the old upload snapshot. The error no longer asserts that the user lacks a first commit.

The alternate read route follows the [GHES branch API](https://docs.github.com/en/enterprise-server@3.17/rest/branches/branches#get-a-branch). Existing Git-object hash checks and compare-and-swap publication remain authoritative; adding a read fallback does not authorize writes.

## Verification

- Focused source regressions: project, new files/rules, setup actions, approval policy, recovery, proposal cancellation and Wiki repository tests.
- `node scripts/check-chat-proposals-ui.mjs`: actual React/CX components with synthetic task states; analysis to review, visible apply/cancel, cancellation, uncertain-save visibility, colors, transcript/composer alignment and no horizontal page overflow.
- At window widths 900 / 1440 / 1920 / 440, measured conversation widths are 700 / 1120 / 1120 / 344 pixels. Screenshots and measurements: `verification/chat-proposals/`.
- Shared design check and local Electron bundle build.

No live company GHES verification or Windows installer update was performed. The original company failure is not proven to be an empty repository; persistent server errors still require company-environment verification. These source changes are newer than the published 1.1.6 installer.
