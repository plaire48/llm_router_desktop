export const TALK_TEAM_CHANGED = 'e2e:talk-team-changed';

// Refresh the app feed only after a confirmed comment. This is not email delivery.
export function refreshTalkNotifications() {
  globalThis.window?.dispatchEvent(new Event(TALK_TEAM_CHANGED));
}
