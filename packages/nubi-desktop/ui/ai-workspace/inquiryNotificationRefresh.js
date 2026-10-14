export const INQUIRY_CHANGED = 'e2e:inquiry-changed';

// A confirmed save invalidates the local feed. No email or remote delivery is implied.
export function refreshInquiryNotifications() {
  globalThis.window?.dispatchEvent(new Event(INQUIRY_CHANGED));
}
