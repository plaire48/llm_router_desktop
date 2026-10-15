# Development through runtime verification

The Desktop agent must continue from an applied change to meaningful tests and, for web applications, a running in-app preview and behavior checks. Implementation instructions alone were insufficient: the recovery hook resumed approved commands only when they exited, so a long-running development server never triggered the next agent turn.

## Changes

- An approved `kind=start` action queues one continuation while its process is running. The existing task, provisional plan, skill/setup binding and approval rules remain. Startup is not marked ready or passed. Later process failure still uses normal diagnosis; a user stop does not restart work.
- Running-process continuation metadata stays on the live process record so later stdout cannot overwrite it. Repeated launch notifications cannot queue duplicate continuations.
- `read_process_output` accepts a bounded `waitMs` (0–5000), waiting for new output or exit with cancellation. Quiet processes have an empty log from creation. No command is relaunched to obtain output.
- Development routing includes environment, approved test/start commands, process output and in-app opening. Conditional guidance connects relevant regression tests, observed server URLs, actual Playwright interactions and result readback. CLI/library tasks need their own execution checks; small copy changes need proportionate inspection. Existing HITL remains authoritative.
- Active change plans with applied proposals expose their test/browser checks to independent review. Applied timestamps distinguish old tests from post-change runs. The host rejects a supported development-check verdict without qualifying evidence. Test candidates require an approved verify action, completed successful execution and nonempty untruncated output after application. Browser candidates require fresh successful built-in Playwright snapshot/readback from this run. Tab opening, screenshots, failed/unknown runs and old results cannot qualify.
- Candidate evidence is not an automatic semantic pass: the reviewer still must match tests and readback to the requested behavior. An honest blocked or approval handoff remains possible. A later user message can change scope; historical plans do not force old checks onto it. Legacy proposals lacking application timestamps cannot certify freshness.
- Existing process cards retain command/output, local URL opening and stop controls. No new modal or navigation step was added. Final output is instructed to lead with the delivered result, then concise verification and material limitations.

## Method and scope

Reused the existing Pi loop, process receipts, review recovery and official bundled Playwright integration. The previously reviewed public patterns in `CODEX-HARNESS-BENCHMARK-2026-10-15.md` remain applicable: small observable steps, execution-result feedback and evidence-based completion. No additional SDK, service, authentication path or dependency was introduced. This does not claim to reproduce private Codex internals.

## Validation

135 focused tests passed across development workflow, command continuation, result review, process output, setup approval, capabilities, recovery and compaction. The new suite includes a real local HTTP subprocess: exact approval → continued model turn while running → output read → observed URL opened through the host callback → server retained → user stop; no duplicate process or continuation. The model responses and host page-open callback in this suite are fixtures, not live model/browser accuracy evidence.

Separately, `scripts/check-in-app-playwright.cjs` passed with actual Electron WebContentsView, worker IPC and official Playwright MCP: open, snapshot, type, click, readback, session reuse, reconnect, stale-document rejection and authentication-tab protection. This is actual in-app tool execution against a local synthetic page, not an end-to-end live-model development task.

Evidence: `verification/development-workflow-2026-10-15/`. Runtime compile and Electron renderer bundle passed. Windows installed behavior, live-provider task success rates and a new Windows release remain unverified/unperformed in this change.
