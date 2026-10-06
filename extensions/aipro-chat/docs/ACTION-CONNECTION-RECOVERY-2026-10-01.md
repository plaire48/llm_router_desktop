# Browser action and connection recovery

## Scope and cause boundary

The user reports repeated “code execution failed” during clicking, navigation and opening with Qwen, on Windows Samsung Browser. Their extension chat opens. Neither the banner nor chat startup establishes that action commands work. The actual Windows failure has not been reproduced here.

Source inspection identified two concrete diagnostic gaps: debugger attach failures could become generic script errors, and a failed initial promotion left a Playwright client that could cause a later passive read to retry attachment. Automatic visual recovery existed but excluded ambiguous/disabled/generic repeated failures. It also replaced the returned observation without updating the runtime's next-action observation binding.

## Applied changes

- Check debugger API availability and perform a read-only `Page.getFrameTree` handshake after attaching the owned tab, before its first action or screenshot.
- Distinguish attach rejection, conflict, policy rejection, unsupported protocol and handshake failure. Fixed categories cross into feedback and progress; raw errors, addresses and credentials do not.
- Close the request's empty client after failed initial promotion. Passive content-script reads remain separate. Connection failure preserves work and asks once about reconnecting rather than repeatedly generating code or captures. User cancellation still prevents reattachment; another debugger is never forcibly detached.
- Strengthen existing semantic-tool preference for basic clicking, opening, navigation and screenshots. This is model guidance, not a proof that Qwen will always select the correct tool. No automatic guessed-target conversion was added.
- Keep immediate capture for existing visual target errors. Ambiguous, disabled, focus and generic action failures receive a viewport capture after two failures on the same observed page. Renewed refs, changed script text or error names do not buy another automatic capture of that unchanged page.
- Preserve command receipts and update both returned and runtime observations with the capture's new refs. A screenshot never clears unknown writes or proves completion.
- Keep capture timeout distinct. A failed automatic capture retains its safe reason and uses its host DOM observation or one read-only snapshot. Permission, connection, cancellation, native dialog and approval failures do not invoke that alternate route. Text-only model runs receive an explicit unavailable status instead of pixels.

## Method and dependency choice

Reuse the bundled Playwright/CRX transport and existing masked capture, DOM binding, host receipts and Pi loop. No package was added, no Chromium implementation was copied and no external router was introduced. The current dependency licenses and notices remain in the package.

[Playwright actionability](https://playwright.dev/docs/actionability) separates uniqueness, visibility, stability, enabled state and event targeting. The implementation retains these checks and does not use forced clicks. [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) distinguishes attach rejection, supported command domains, target identity and detach events. The [Chromium debugger source](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/extensions/api/debugger/debugger_api.cc) supplies actual conflict and policy error categories; it is a reference only. The [infobar implementation](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/extensions/api/debugger/extension_dev_tools_infobar_delegate.cc) confirms that the banner is a browser warning, not a task-success receipt.

Generic automatic retry of action code was rejected: a click may have opened a tab or a preceding write may have completed. The repair observes current state and preserves receipts first. Screenshot-only recovery was rejected because failed transport cannot be repaired by more screenshots and screenshots cannot establish business outcomes.

## Verification boundary

Focused unit checks, actual Chrome fixtures and the selected regression gate are recorded under `verification/action-recovery-*`. The new `action-visual-recovery-browser` fixture uses Qwen's wire format with synthetic model replies and real Chrome actions: two actual ambiguous failures, one auto capture, one native click opening a new tab, landed URL/text checks, no wrong-button click and no changed memo.

`browser-debugger-browser` checks actual attach/click/input, cancellation and cleanup. Rejection cases inject documented API errors; this is not a real DevTools conflict or Samsung capability test. Read-after-failed-promotion must make no attach attempt.

The first new visual fixture did not pregrant the full site-access permission requested by its send gesture; the headless native permission prompt prevented submission (`round=0`, no task). This was a fixture error. Only its test-copy manifest was corrected; production permissions were not expanded.

The fixed quality profile is `quality-baseline-v15` with 137 browser stages, including three fresh profiles for the new visual/action case. A selected gate is focused evidence, not the full matrix or this profile's overall quality score. Real Qwen inference, Windows Samsung action compatibility and the user's failing website remain unverified. Source changes and candidate builds do not update the published verified 1.4.44 ZIP or the installed extension.

## Recorded results

- Full unit checks: 1,712 passed. Focused unit/contract checks: 90 passed.
- Selected gate: 25/25 stages passed, including seven suites repeated in three fresh profiles, debugger host coverage, design check and candidate build. Report: `verification/pre-release-2026-10-01T07-06-34-482Z/report.json`. This is not a full release gate.
- Actual Chrome 148.0.7778.178: debugger host checks and Qwen-format visual/action fixture passed. Model replies are synthetic; this is not Samsung or real Qwen inference.
- Control using the exact published 1.4.44 ZIP: injected conflict, policy, unsupported protocol and generic attach rejection all returned `script_failed`; each subsequent passive read also failed. The revised host returns distinct connection categories and its passive read succeeds without another attachment.
- A separate actual Chrome 148 probe injected a screenshot transport timeout. It continued from the host's fresh DOM, clicked the intended control once and verified the newly opened page. No image was passed to Qwen and no original input changed. Its lower-level Playwright wrapper classified this injected transport timeout as `script_timeout`; the host-owned capture deadline has the separate `capture_timeout` category. The probe does not establish every screenshot-failure cause.

Bounded evidence and comparison records: `verification/action-connection-recovery-2026-10-01/results.json` and `candidate-receipt.json`. Candidate ZIP SHA-256: `c8c59df3a276da78b9ee2b49137f842f04d25c1928c4aee07a24e457b099d54e`. No release asset or installed extension was replaced.
