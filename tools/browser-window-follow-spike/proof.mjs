// Executed manually in the existing connector popup's DevTools console.
// Its module-scoped dispatch() is intentionally NOT accessed or exported.
export async function createProof(chrome, contextURL, nonce) {
  if (contextURL !== chrome.runtime.getURL('connect.html')) throw Error('connector_popup_required');
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce)) throw Error('invalid_nonce');
  const status = await chrome.runtime.sendMessage({ action: 'status' });
  if (!status?.connected || !Number.isSafeInteger(status.sourceTab)) throw Error('connector_not_connected');
  const source = await chrome.tabs.get(status.sourceTab);
  const [previous] = await chrome.tabs.query({ active: true, windowId: source.windowId });
  if (!previous || source.incognito) throw Error('proof_window_missing');
  const url = chrome.runtime.getURL('window-proof.html') + '#' + nonce;
  const tab = await chrome.tabs.create({ windowId: source.windowId, active: true, url,
    openerTabId: previous.id, index: previous.index + 1 });
  const after = await chrome.runtime.sendMessage({ action: 'status' });
  if (!after?.connected || after.sourceTab !== status.sourceTab) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (current?.url === url && current.windowId === source.windowId) await chrome.tabs.remove(tab.id);
    throw Error('connector_changed');
  }
  // Existing window-proof.js closes only its own tab after 11 seconds.
  return { proofStarted: true, windowId: source.windowId };
}
