// Release policy, shared by the UI and host. Keep the implementation for a
// later release without exposing an environment or user-setting bypass.
// a2a: the Workspace-to-browser link of 2026-10-01 is kept in the code and off in this release (README).
// mailAttachmentReading: on since 1.2.1 (user decision 2026-10-14): attachments are read with the mail body.
// workflows: off since 2026-10-22 (user decision): workflows and routines return after a feature review; code and data stay.
// mailPortal: off since 2026-10-23 (user decision): mail comes in through 1. Knox Desktop Message or 2. POP3. The portal
// code stays; when it returns it sits under 다른 연결 방법 and its login waits as in 1.2.9 (five minutes, no retries).
export const DESKTOP_FEATURES = Object.freeze({computerUse:false,a2a:false,mailAttachmentReading:true,workflows:false,mailPortal:false});
