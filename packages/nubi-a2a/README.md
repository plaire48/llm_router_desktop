# Nubi A2A collaboration

> Verification status (2026-10-01): the previously frozen browser candidate and Desktop route were disabled when checked. Product connection restoration is now being developed in parallel under the user's additional request; source changes alone are not app-to-app success. Shared protocol tests do not establish live model or document-processing success. See [the verification and its candidate boundary](../../extensions/aipro-chat/docs/A2A-VERIFICATION-2026-10-01.md).

Nubi Desktop supplies versioned source and OpenWiki context. The browser and Office receive a task, import it into their existing chat, and return that chat's completed answer to the original desktop task. The desktop's next analysis receives those drafts as reference data.

This is a local coordinator with two outbound clients. It does not advertise three independently hosted A2A servers or remote Excel/browser execution.

## Development

Run `npm ci --prefix packages/nubi-a2a` from the repository root before installing/building the consuming applications. The SDK is bundled into their existing runtimes; end users do not install this package, Node, or a separate router. Tests: `npm test --prefix packages/nubi-a2a`.

## Adopted library and protocol

- Official [`@a2a-js/sdk`](https://github.com/a2aproject/a2a-js) **1.2.0**, Apache-2.0. Uses its actual JSON-RPC client, Agent Card resolver, DefaultRequestHandler, event pipeline, protobuf JSON codecs and task-store filtering.
- [A2A 1.0](https://a2a-protocol.org/v1.0.0/specification/) `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`. No claimed 0.3, gRPC, streaming, push or general third-party-agent conformance.
- Protocol tasks carry Nubi's `nubi-collaboration-v1` application data in DataParts. A shared context ID links the original desktop task. Artifacts retain request, criteria IDs, relative source paths, hashes, bounded excerpts, Wiki freshness and context digest.
- `jose` is the SDK dependency. Original license texts are in `licenses/`; consumer builds include them.

Using the official transport avoids maintaining a look-alike protocol. Existing Pi runtimes, browser ownership checks and Office native/HITL execution remain the actors. MCP/OpenWiki read tools remain separate from cross-agent task exchange.

## Workflow

1. Desktop: open a task, expand **다른 누비와 작업**, request a browser scenario or Office review document, then generate a recipient connection address.
2. Recipient: open **설정 → 누비 작업 연결**, paste the address and connect. Pick **요청 가져오기**.
3. Review the imported context in the existing composer. Sending it starts the normal local agent, including its questions and edit approvals.
4. Reopen the connection panel and choose **답변 보내기**. Only the host-observed completed answer from the bound run can be sent. Caller-supplied answer text is ignored by host adapters.
5. Desktop displays the received draft and retains it in SQLite. The next desktop analysis includes bounded received drafts. Source/Wiki versions are checked again before accepting a result.

## State and recovery

- A request awaits recipient input (`INPUT_REQUIRED`). `COMPLETED` means the draft artifact was delivered, never that an application test passed or a document was saved. The artifact has `verification: not_run`; desktop acceptance criteria are unchanged.
- Request/message IDs, payload fingerprints, persisted receipts and `GetTask` reconcile duplicate/uncertain delivery. They never replay browser actions, shell commands or Office edits.
- SQLite task/artifact records survive desktop restart. Invitations do not. Bearer tokens are kept as SHA-256 hashes with their expiry, so a paired app keeps working after a desktop restart until the token expires, the app disconnects, or the same app pairs again. Re-pairing the same task preserves a recipient run binding when its ID and context digest match. Different projects cannot inherit it.
- Chrome stores credentials and task bindings in trusted `chrome.storage.session`, so MV3 suspension and UI reload can resume lookup. Browser restart requires reconnecting. Office holds them only in the worker's memory; worker restart recovery is not claimed.
- Only one imported task is active per recipient. Disconnect or request detachment retains the conversation. Transfer cancellation prevents later delivery. It does not cancel an independently started local browser or Office run; that run's existing Stop control owns execution cancellation.
- Current inbox shows the latest 25 tasks and explicitly signals more results. Desktop overview shows 30. No automatic retention/deletion policy was introduced.

## Boundaries

Loopback IPv4 only. The desktop starts the listener on explicit request/invite. Invitations are recipient-specific, single-use and expire after ten minutes. Bearer access expires after eight hours; pairing again revokes the previous token for that recipient. The Agent Card and task methods require authentication. Recipient stores isolate both task contents and pagination counts. Host/Origin validation and request/response size limits apply. Authentication is never model context. No existing SSO/token store is shared.

Source context is bounded (four files for browser, three for Office, two Wiki excerpts); omissions are explicit. User request and acceptance criteria are never silently truncated. Oversized imported requests fail with a request to narrow scope (browser 16,000 characters, Office 8,000). Wiki text and returned drafts are untrusted reference data. DB row values are not collected. A source hash is version evidence, not proof of factual correctness or deployed behavior.

This first workflow exchanges scenario/document drafts. Executed browser evidence, screenshot/file artifact upload, Office file transfer, automatic multi-host execution, LAN/cloud discovery, task subscriptions and external generic-agent adapters are not implemented.

## Task exchange (`nubi-task-v1`)

A second agent on the same hub lets the desktop and the browser ask each other for work. It has its own Agent Card (`/tasks/.well-known/agent-card.json`) and endpoint (`/tasks/a2a`), task records (`nubi-task:`) and receipts, so the collaboration flow above and its listings are unchanged. Legacy general Office draft tokens are refused here. Native Office roles office-excel, office-word and office-powerpoint accept the office-document-task skill from Desktop only. They share the same SDK and isolated recipient task store.

Skills, by recipient. There are no command-execution or app-control skills.

| Recipient | Skill | Purpose |
|---|---|---|
| browser | `web-lookup` | Find facts on the web with source URL and quote |
| browser | `web-page-check` | Open given pages and check the requested items |
| browser | `web-form-draft` | Fill a web form as a draft; saving or submitting still needs the browser user's approval |
| desktop | `source-search` | Find related code and its location |
| desktop | `knowledge-query` | Answer from the desktop knowledge store |
| desktop | `document-analysis` | Read a desktop document and summarize the request |
| desktop | `ask-openwiki` | Ask OpenWiki and return its sources |

States and who moves them:

| Action | By | From | To |
|---|---|---|---|
| `task` (new) | requester | none | `submitted` |
| `accept` | recipient, after its user accepts | `submitted` | `working` |
| `reject` | recipient | `submitted` | `rejected` |
| `progress` | recipient | `working` | `working` |
| `complete` | recipient | `working` | `completed` |
| `fail` | recipient | `working` | `failed` |
| `CancelTask` | requester | `submitted` or `working` | `canceled` |

A request is `{recipient, skill, request, context?, urls?, facts?}` (request 8,000 characters, context 16,000, up to 8 http(s) URLs and 20 requested fact names). A result is `{summary, facts, evidence, verification, localRunId}`. Each fact is `{name, value, source_url?, quote?, path?, hash?, evidenceId?}` and must name at least one of `source_url`, `path` or `evidenceId`; an `evidenceId` must match an evidence entry `{id?, url | path, title?, capturedAt}`. `verification` is `host_checked` only when the recipient host checked the facts against what it read; otherwise `not_run`. Completion means delivery, not that the facts were verified by the requester.

Every message is checked before the SDK runs it, so a malformed or out-of-order message is refused and leaves the task unchanged. A retried message with the same ID returns its first answer; the same ID with different content is refused as a collision.

API (both sides, from `client.mjs`): `taskApi(connection)` returns `request`, `accept`, `progress`, `complete`, `fail`, `reject`, `cancel`, `get` and `list({state, pageSize, pageToken})`. State-changing calls take `{messageId}`; store it before sending and reuse it on retry. The desktop gets the same API as `server.tasks`, and `createCollaborationServer({onTask})` is called after each change with `{event, task}` where `event` is `created`, `accepted`, `rejected`, `progress`, `completed`, `failed` or `canceled`.

Ports: `createCollaborationServer({ports: TASK_PORTS})` tries 47821 to 47825 in order, then a random port. After a restart moves the hub, `locateHub(connection)` asks each candidate port to prove it holds the connection's token hash. The proof is an HMAC over a fresh nonce and the answering port, so a local listener that relays the real hub's answer is refused and the token is only sent to the real hub.

## Office automatic delegation (0.8.12 source)

Workspace offers delegate_to_office only for paired native Office roles. Office accepts a request into a new conversation, runs its existing executor with separate edit/save approvals, reports actual progress and returns the bound completed answer automatically. Workspace resumes the original conversation. Each app has its own token and task view. Authentication and native permissions remain host-owned. Local/scripted verification and fork bundle builds do not prove Windows Office execution. See [Office A2A](../nubi-office/docs/A2A-COLLABORATION.md).
