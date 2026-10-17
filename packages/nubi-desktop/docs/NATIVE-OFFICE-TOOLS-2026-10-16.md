# Native Office tools in Workspace

2026-10-17: Desktop now provides an Electron-only open-document picker and a bundled private STA/stdio host reusing the existing Office X COM implementation. See [external Office integration, build instructions and current limits](../../../docs/research/2026-10-17-workspace-external-office-integration.md). Source and macOS checks do not establish actual Windows/Office 2016/NASCA execution.

The existing Pi/model, question approval, task controller and recovery store host the independent native Office skill. See [implementation and evidence](../../../docs/research/2026-10-16-workspace-native-office-tools.md).

Trusted host integration calls `service.registerNativeOfficeConnection(connection)`, with `environment:'windows-office'`, `app`, `scope:{projectId,taskId}`, native `documentId`, `officeSessionId`, optional `documentTitle`, and the existing bound `call(name,input,signal)` implementation. That caller must preserve native approval, CheckSource, UI/STA serialization, document identity and receipts. This method cannot be invoked from the renderer or model. `nativeOfficeStatus` is a read-only public host method.

A test-only fixture requires the explicit in-process `{allowFixture:true}` option; there is no user/model/IPC fixture switch. The shipped worker creates no native connection by itself. Real Windows attachment/COM execution and NASCA/save verification remain required.

`npm run build:document-agent-native` builds only the native skill/verifier. It also runs in `pretest` and the runtime build. `node scripts/check-native-office-ui.mjs` exercises the real approval component with a stateful test host. `node scripts/check-electron-native-office.mjs`, after the Electron build, proves accurate unavailable status in the actual product worker. These do not require Office.

Excel previews keep green inside the preview only. Folded grids and details are unmounted, preserving user selection/scroll on reopen. They display observed cells and proposed/expected changes, not a rendered Office document or completed calculation.
