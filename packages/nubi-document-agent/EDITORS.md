# Internal and external document editors

Status (2026-10-17 follow-up): registered in the Workspace central agent with live-buffer transport, existing approval forms and durable one-time claims. Actual Electron/Monaco editing is verified with a scripted model. An Obsidian plugin is built but not installed or tested in a real Obsidian host. Windows Notepad/PDF accessibility reading is implemented and cross-compiled, but not run on Windows. These native adapters are read-only. See `../../docs/research/2026-10-17-workspace-document-integrations.md`.

The user selected both modes on 2026-10-17: edit a document in Nubi, or connect the document already open in an external editor. Neither mode replaces the other. Both use the existing central agent and host approval flow.

## Implemented

`@nubi/document-agent/editors` exports:

- `createMonacoEditorPort`: a pinned Nubi-style Monaco editor/model, live selection and unsaved content, range edits with undo boundaries.
- `createObsidianEditorPort`: a pinned public Obsidian Editor, cursor/offset conversion and `replaceRange`. No private CodeMirror access, Vault scanning, disk overwrite or keyboard simulation.
- `createEditorSession`: bounded observation, exact partial edit proposals, existing host approval, durable host claim, one dispatch, full-buffer independent readback.
- `createEditorSkill`: read/propose tools for the existing GenOffice/HostModelPort loop. It does not create another agent, model connection, approval UI or execution loop.

Both adapters are dependency-injected. They run in the same UI process as the editor or behind a host-owned transport that preserves the atomic compare-and-edit operation. A renderer cannot safely serialize an Editor instance to the worker. The Workspace host now supplies this transport in `nubi-desktop/runtime/live-editor-host.mjs` and `electron-app/live-editor-client.js`. The optional module still owns no transport or application lifecycle.

## Host responsibilities

1. Let the user choose the document and `누비에서 편집` or `외부 앱 연결`. Pin project/task, connection generation, document and editor identity. Do not silently switch modes while either buffer has unsaved changes.
2. Supply the currently connected editor. Monaco `readOnly` must reflect its actual option; `isConnected` must check the active permitted editor/model. Obsidian must check the pinned MarkdownView and file, and increment the supplied revision on `editor-change`. Unloading a plugin or changing the note revokes the connection.
3. Add `createEditorSkill(session, signal)` to the existing task's skill composition. It reads at most 12,000 UTF-16 code units in one result, with `nextOffset` and partial coverage. The source appears once. The host still enforces its token budget.
4. Present the returned proposal through the existing approval flow. Only the approved fingerprint may pass the existing `Host.policy.authorize` implementation.
5. Provide `claim` and `record` through the existing durable task store. Claim the exact proposal and fingerprint atomically before dispatch. A pending claim after restart is uncertain until reconciled; never construct a new proposal to replay it automatically. `record` failure also requires reconciliation, even if the editor changed successfully. No in-memory demo ledger may replace this in production.
6. `replaceIfCurrent` must compare the complete old buffer, identity, revision and read-only state in the app UI turn immediately before editing. No await or remote round trip may separate that comparison from the app mutation.
7. Verify the receipt and independent full-buffer readback. `verified` means that edit and all unaffected text were observed. `not_started`, `unconfirmed` and `verification_failed` are not successful completion. Cancellation or response loss after dispatch is never retried.
8. Keep saving in the existing host/app flow. `saveStatus: not_requested` means Nubi did not request or verify a save. Obsidian may autosave independently; this module does not disable that behavior or claim disk persistence.
9. Call `disconnect` on task/app detach. It clears observations and proposals without closing the editor or discarding the user's text. New sessions require a fresh connection generation. Proposals are intentionally not restored by this module; the host owns persisted records.

Whole buffer limit is 1,000,000 UTF-16 code units. At most four observations and four proposals are retained per session. Read ranges and inserted text are capped at 12,000. A host may reconnect after a completed batch using a fresh observation, never to replay uncertain changes. Larger documents require a separately bounded adapter, not silent truncation.

## Minimal composition

```ts
import {createMonacoEditorPort,createEditorSession,createEditorSkill} from '@nubi/document-agent/editors';

const port = createMonacoEditorPort({
  connectionId: hostConnectionId,
  documentId: pinnedDocumentId,
  editor,
  isConnected: () => activeEditor === editor && editor.getModel() === pinnedModel,
  readOnly: () => editor.getOption(monaco.editor.EditorOption.readOnly),
  dirty: () => pinnedModel.getValue() !== savedText,
});
const session = createEditorSession(port, {projectId,taskId});
const skill = createEditorSkill(session, abortSignal);
// Compose skill into the existing host model loop.
// After the existing host has presented and authorized its exact proposal:
const result = await session.apply(approvalId, {
  policy: existingHost.policy,
  claim: durableTaskStore.claimExactEditorOperation,
  record: durableTaskStore.recordEditorResult,
}, abortSignal);
```

The names `durableTaskStore`, `hostConnectionId` and `existingHost` above describe host injection points, not new implemented Workspace APIs.

## PDF and Notepad boundaries

Existing Nubi PDF.js previews and extracted document snapshots remain available. This text editor module does not advertise PDF body editing, OCR or external PDF application automation. PDF pages, selection and annotation need their own capability adapter. A PDF preview is not a text editor.

TXT and Markdown can already be edited by Nubi's Monaco for authorized project files. External human-only file browsing remains read-only; this module does not grant arbitrary file writes. Original encoding and disk conflict checks remain host saving responsibilities.

Windows Notepad requires a separately verified UI Automation adapter for the exact document/tab and unsaved buffer. TextPattern reading is not evidence of writable ValuePattern. No blind Ctrl+A/type fallback or automatic activation of disabled Computer Use is added here. The existing Office 2016/native/NASCA boundary is unchanged.

## Evidence, 2026-10-17

- `npm test`: 331/331 package tests, including 23 new editor tests. Adapters in those tests use fake app objects.
- `eval/editors/browser.jsx`: actual installed Monaco in the browser. LF and CRLF each passed selection, partial multiline edit/readback and undo. This fixture imports the product's editor module, but its approval and durable claim are test stubs.
- Browser result: `../nubi-desktop/artifacts/editor-connection-2026-10-17/monaco-result.json`; screenshot `monaco.png` in the same directory.
- No actual Obsidian installation was found in `/Applications`. No real Obsidian, Windows Notepad, Office, external PDF app, live-model flow or Workspace registration was verified.

## API references

- Obsidian public Editor: https://docs.obsidian.md/Plugins/Editor/Editor
- Obsidian Vault and concurrent writes: https://docs.obsidian.md/Plugins/Vault
- Monaco API: the installed `nubi-desktop/node_modules/monaco-editor/monaco.d.ts`, including `getVersionId`, `executeEdits` and `pushUndoStop`.
- Windows UI Automation text patterns: https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/add-content-to-a-text-box-using-ui-automation
