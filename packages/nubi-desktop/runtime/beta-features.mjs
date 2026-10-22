// Release policy, shared by the UI and host. Keep the implementation for a
// later release without exposing an environment or user-setting bypass.
// a2a: the Workspace-to-browser link of 2026-10-01 is kept in the code and off in this release (README).
// mailAttachmentReading: on since 1.2.1 (user decision 2026-10-14): attachments are read with the mail body.
// workflows: off since 2026-10-22 (user decision): workflows and routines return after a feature review; code and data stay.
export const DESKTOP_FEATURES = Object.freeze({computerUse:false,a2a:false,mailAttachmentReading:true,workflows:false});
