# Claude Code local adapter

## Decision

Desktop adds Claude after FabriX. The existing Pi harness keeps planning, source/Personal mail retrieval, approvals, tool execution, observations and final verification. An installed, unmodified Claude Code CLI supplies model responses and structured Nubi tool proposals. This is not the disabled direct Anthropic subscription OAuth adapter in the router. Office and browser provider defaults remain unchanged.

Clicking Claude first checks the existing CLI connection. An installed, authenticated CLI connects directly. Only missing or outdated CLI opens a setup step. When authentication is missing, an explicit Claude click launches `claude auth login` and opens its authorization page inside Workspace. The app discovers the native CLI in the official user install directory or absolute PATH entries. No installer or CLI download is executed automatically. `--safe-mode` and structured-output support are checked before connecting. Sonnet/Haiku aliases and pinned Opus 5.5 (`claude-opus-5-5`) are selectable, not represented as an account-specific model catalog. Haiku does not expose an effort selector. Context capacity is taken from a reported model result when available, not guessed from an alias.

## Execution and authentication

- Credentials remain CLI-owned. No CLI credential file, Keychain secret, browser cookie, session token or private `claude.ai` endpoint is read by Nubi.
- Nubi stores only its provider/model/effort preference in the existing OS-protected store. Reopening validates authentication through `claude auth status`. Disconnect removes the Nubi connection, not the user's CLI login.
- Each call uses stdin, a private temporary working directory, `--safe-mode`, an empty built-in tool list, an empty strict MCP configuration, no slash commands and no session persistence. Parent API-key, endpoint and Claude runtime overrides are not forwarded. There is no shell interpolation or permission bypass.
- Structured calls are allowlisted against the supplied Nubi tools. The existing host validates arguments, performs HITL, executes and records receipts. A CLI tool proposal never executes a command by itself.
- Cancellation terminates the child; output and duration are bounded. CLI stderr is not exposed because it can contain account details. Temporary directories are removed when a call exits.
- Nubi's aggregate ledger uses the CLI result token totals, including cache tokens. The context meter uses the last reported assistant turn separately, falling back to an estimate when unavailable. CLI internal turns are not represented as one context window.

## Account usage

ChatGPT quota stays first. Claude follows it with an icon, remaining percentage, reset time and last response time. Only `rate_limit_event` values actually reported by the CLI are normalized. Five-hour and seven-day windows are separate; absent values are not 0% or 100%. Reset or older-than-five-minute observations are marked for refresh, and update on the next Claude response. No paid/silent model call is made solely to refresh the meter.

`unifiedWindows` is a compatibility observation reported in the upstream issue tracker, not a stable documented API guarantee. The official status-line schema documents five-hour and seven-day counters, but safe mode disables status-line customizations; Nubi does not install a hook to collect them. Missing headless telemetry remains visibly unavailable.

## Research and adoption

- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance): current terms distinguish hosting an unmodified CLI with users authenticating directly from intermediating Claude.ai credentials. Adopt the former, keep the latter disabled.
- [CLI reference](https://code.claude.com/docs/en/cli-reference) and [headless use](https://code.claude.com/docs/en/headless): adopt safe mode, native authentication, structured output and stream JSON. Do not use `--bare`, which does not use subscription OAuth.
- [Claude plan with Agent SDK](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan): verify current plan guidance; do not assume a third-party token-exchange API.
- [Status-line schema](https://code.claude.com/docs/en/statusline), [headless rate event report](https://github.com/anthropics/claude-code/issues/91857): distinguish documented interactive counters from observed optional CLI event fields.
- Simple Icons Claude path, CC0-1.0, uses terracotta `#D97757`; darker text and pale selection surfaces follow Nubi contrast/spacing tokens. Source and full license are in THIRD-PARTY-NOTICES and vendor/licenses.

No Agent SDK dependency or second tool executor was added: the existing CLI and Pi boundary suffice. This avoids a second set of approval, project and transcript semantics. A future native SDK/control-protocol adapter would require separate receipt and cancellation tests.

## Verification

Local Claude Code 2.1.273, user-authenticated on macOS:

- Actual short Korean reply succeeded; the result reported 1,350 tokens.
- Actual `source_search` proposal selected `query: login` with 1,539 reported tokens. This check did not execute a shell or modify a project.
- Both responses supplied five-hour and seven-day quota windows; observed remaining values were 90% and 92% at that time, not a permanent account claim.
- `tests/claude-code.test.mjs` checks isolation, invalid/unadvertised calls, missing login, counters, quota gaps, process cancellation, output limits and preference restoration. The final focused suite, including ChatGPT accounting, credential persistence and harness routing, passed 32/32 checks. The login-host regression separately passed 2/2 with its required localhost permission.
- `node scripts/check-claude-ui.mjs --live` explicitly opts into a short real CLI response, tests the actual Electron model and quota UI, narrow layout and restart selection. It uses a temporary project/state and writes sanitized observations to `verification/claude-code/live-report.json`.
- The final live Electron run passed all 8 UI checks, including narrow layout and reconnecting the same CLI/model after app restart. Its final short verification response reported 1,330 tokens; the account windows remained 90% / 92% at 18:54 KST.
- Electron compilation and the design identity gate are local checks. Windows CLI discovery, company proxy/certificates, installation, all model aliases and extended agent-task quality are not established by these results.

Screenshots in `verification/claude-code` show the actual local Electron UI. The temporary project is a UI test fixture; quota values are from the signed-in CLI, not fixture percentages.

## Follow-up: shared reasoning UI and pinned evaluation

- Claude Code was updated through its official updater to 2.1.296. A real probe resolved `claude-opus-5-5` and reported a 1,000,000-token context window. Existing `opus` preferences migrate to that exact model ID.
- The shared ChatGPT reasoning trigger and slider now also render for Claude. The host `reasoningOptions` is authoritative, including ordering; absent/empty options hide the control. Opus offers low/medium/high/xhigh/max; Sonnet offers low/medium/high; Haiku has none. Default medium and model/effort restoration use the existing Desktop store, without separate Claude localStorage persistence.
- The trigger tooltip retains the literal `--effort` request; the main UI keeps one short label. No separate CLI panel is shown. Organization policy may cap an effort request, so requested effort is not described as observed effective effort. See [official model configuration](https://code.claude.com/docs/en/model-config).
- An anchored reasoning dialog keeps its original trigger active so clicking it again closes the dialog. Other background controls remain inert. The fourth login button continues the same entrance stagger; the connection surface uses existing modal motion, respecting reduced motion.
- Added one component rendering regression (`tests/reasoning-picker.test.mjs`) covering restored values, medium default, host capability filtering, Haiku hiding and the shared trigger. It found and fixed an initial-render preference flash.
- Actual Electron verification passed 14 checks: shared login motion, reduced motion, model/usage UI, all five effort choices via keyboard, reset, narrow-window alignment, trigger toggle and restart preserving Opus 5.5/high. The short live CLI reply also succeeded. Screenshots and current quota observations are in `verification/claude-code`; no Windows installation claim.

- Provider reasoning colors reuse shared geometry: OpenAI charcoal (`#191F28`), Claude terracotta (`#D97757`, darker text `#8E422C`), and AI Pro logo gradient (`#2D4BF5` to `#5500FF`). The rendered three-provider check verifies icon/title colors, track fill tokens, viewport fit and trigger toggle. This fixture validates UI behavior, not other providers’ live inference. See `verification/reasoning-providers/result.json`.

## Conditional setup and in-app login

- A Claude click checks the installed CLI. Already authenticated users connect directly; missing/outdated installations show only the relevant guide. Status polling and startup restoration never start authentication.
- Missing authentication starts the official `claude auth login` subprocess. A child-only `BROWSER` helper forwards the CLI's original browser authorization URL to the existing isolated Electron web tab. The printed CLI URL is intentionally not used: it is a manual-code fallback, with a different redirect URI.
- Only official Claude authorization origins/paths with a loopback callback, state and PKCE challenge are accepted. The URL is unchanged. The helper's temporary URL file lives in a private temporary directory and is deleted immediately; no stdout, credentials or URL query values are logged or persisted by the adapter.
- The CLI owns the loopback server, code exchange, token storage and refresh. Nubi waits for successful CLI exit and checks `auth status` before publishing a connected model. It stores only provider/model/effort preferences. No direct Claude OAuth adapter or private account API is introduced.
- Duplicate starts are rejected. Cancel/timeout/disposal abort the login child; stale completion does not activate a model. Completion/cancellation closes only that attempt's authentication tab. A browser opening failure remains an explicit error.
- No CLI download or installation runs automatically. The official guide opens in Workspace. A transient probe timeout is not classified as a missing login.
- Method: use the official [CLI authentication command](https://code.claude.com/docs/en/cli-reference) plus the existing native browser bridge, without new packages. The installed 2.1.296 CLI was checked with an isolated temporary config: it handed off an official claude.com authorization URL whose callback was localhost; cancellation terminated the child. This verifies URL handoff, not a fresh SSO completion or Windows execution.
- Regression tests cover authorization URL scope, browser failure, temporary cleanup, cancellation/stale completion, duplicate login, preference-only persistence and startup without login. UI fixtures separately cover install/update/login-retry surfaces. Already authenticated Electron connection is checked without a model call.
