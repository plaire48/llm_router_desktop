import {collectSnapshot} from './generated/browser-dom.js';
export {collectSnapshot, inspectTarget, clickTarget, controlState, pointerPosition, prepareHoverReveal, waitForHoverReveal} from './generated/browser-dom.js';

// Some pages put a whole configuration document into an iframe's name. The
// attribute identifies the frame; its first characters are enough for that.
export const FRAME_OWNER_LIMIT = 160;
export const frameOwner = owner => owner ? Object.fromEntries(Object.entries(owner).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, FRAME_OWNER_LIMIT) : value])) : owner;

export async function topDocumentId(tabId) {
  try {
    const [record] = await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'ISOLATED', func: () => null});
    return typeof record?.documentId === 'string' && record.documentId ? record.documentId : null;
  } catch {return null;}
}
export async function observedDocumentScope(tabId) {
  try {
    return await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'ISOLATED',
      func: () => ({url: location.href, owner: frameElement ? {tag: frameElement.tagName.toLowerCase(), id: frameElement.id, name: frameElement.getAttribute('name'), title: frameElement.getAttribute('title')} : null})});
  } catch {return [];}
}

// Only this static function accesses the isolated world's node cache. The
// model supplies an opaque reference, never JavaScript or an injected selector.
function referenceOperation({operation, nonce, ref, marker, relink}) {
  const state = globalThis.__nubiBrowserObservationV1;
  if (!state || state.nonce !== nonce || state.url !== location.href) return {error: 'browser_stale'};
  const attribute = 'data-nubi-action-target';
  const cleanup = token => {
    const item = state.markers.get(token);
    if (!item) return;
    if (item.el.getAttribute(attribute) === token) {
      if (item.previous === null) item.el.removeAttribute(attribute); else item.el.setAttribute(attribute, item.previous);
    }
    state.markers.delete(token);
  };
  if (operation === 'clear') {
    for (const token of state.markers.keys()) cleanup(token);
    delete globalThis.__nubiBrowserObservationV1; return {ok: true};
  }
  if (operation === 'release') {cleanup(marker); return {ok: true};}
  let el = state.refs.get(ref), relinked = false;
  // A list that re-renders replaces the observed anchor with an identical one.
  // Follow it only when exactly one connected anchor has the same full address
  // and the same text. Anything else stays stale; nothing is guessed by position.
  if (relink === true && el && !el.isConnected && el.tagName === 'A' && el.hasAttribute('href')) {
    const text = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
    const matches = [...document.querySelectorAll('a[href]')].filter(anchor => anchor.href === el.href && text(anchor) === text(el));
    if (matches.length === 1) {el = matches[0]; state.refs.set(ref, el); relinked = true;}
  }
  // Visibility/actionability is checked by the shared inspector after binding.
  // A display:contents link legitimately has no rectangle of its own.
  if (!el?.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]')) return {error: 'browser_stale'};
  if (operation === 'check') return el.getAttribute(attribute) === marker ? {ok: true} : {error: 'browser_stale'};
  if (operation !== 'bind' || !/^[a-f0-9-]{36}$/.test(marker)) return {error: 'browser_stale'};
  state.markers.set(marker, {el, previous: el.getAttribute(attribute)});
  el.setAttribute(attribute, marker);
  return {ok: true, ...(relinked ? {relinked} : {})};
}
async function referenceCall(entry, operation, marker, relink = false) {
  const [result] = await chrome.scripting.executeScript({target: {tabId: entry.tabId, documentIds: [entry.documentId]}, world: 'ISOLATED', func: referenceOperation,
    args: [{operation, nonce: entry.nonce, ref: entry.ref, marker, relink}]}).catch(() => {throw new Error('browser_stale');});
  if (!result?.result?.ok) throw new Error('browser_stale');
  return result.result;
}
export async function releaseObservedRefs(entries) {
  const documents = new Map();
  for (const entry of entries) {
    const source = entry.contentRef || entry;
    if (source.documentId) documents.set(`${source.tabId}:${source.documentId}:${source.nonce}`, source);
  }
  await Promise.allSettled([...documents.values()].map(source => referenceCall(source, 'clear')));
}
export async function bindObservedRef(task, entry, safeURL, {relink = false} = {}) {
  const marker = crypto.randomUUID();
  let handle;
  try {
    const binding = await referenceCall(entry, 'bind', marker, relink);
    // Bind the exact observed node only when an actual action requires
    // Playwright. No labels/indices are guessed to reconstruct a stale ref.
    for (const frame of task.page.frames()) {
      if (!safeURL(frame.url()) && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
      const locator = frame.locator(`[data-nubi-action-target="${marker}"]`);
      if (await locator.count() !== 1) continue;
      handle = await locator.elementHandle({timeout: 1000});
      await referenceCall(entry, 'check', marker);
      const bound = {handle, frame, descriptor: entry.descriptor, contentRef: entry, ...(binding.relinked ? {relinked: true} : {})};
      task.refs.set(entry.ref, bound); return bound;
    }
    throw new Error('browser_stale');
  } catch (error) {await handle?.dispose().catch(() => {}); throw error;}
  finally {await referenceCall(entry, 'release', marker).catch(() => {});}
}

export async function readWithoutDebugger(task, query, safeURL, cancelled, expectedTexts) {
  const metadata = await chrome.scripting.executeScript({target: {tabId: task.tabId, allFrames: true}, world: 'ISOLATED',
    func: () => ({url: location.href, title: document.title, owner: frameElement ? {tag: frameElement.tagName.toLowerCase(), id: frameElement.id, name: frameElement.getAttribute('name'), title: frameElement.getAttribute('title')} : null})});
  const top = metadata.find(item => item.frameId === 0)?.result;
  const topId = metadata.find(item => item.frameId === 0)?.documentId;
  if (!top || !safeURL(top.url)) throw new Error('page_restricted');
  const frames = [];
  for (const meta of metadata.sort((a, b) => a.frameId - b.frameId).slice(0, 16)) {
    if (cancelled()) throw new Error('cancelled');
    const url = safeURL(meta.result?.url);
    if (!url && !['about:blank', 'about:srcdoc'].includes(meta.result?.url)) continue;
    const frame = frames.length, nonce = crypto.randomUUID();
    try {
      const [record] = await chrome.scripting.executeScript({target: {tabId: task.tabId, documentIds: [meta.documentId]}, world: 'ISOLATED', func: collectSnapshot,
        args: [{query, nonce, expectedURL: meta.result.url, expectedTexts}]});
      if (cancelled()) {
        await referenceCall({tabId: task.tabId, documentId: meta.documentId, nonce}, 'clear').catch(() => {});
        throw new Error('cancelled');
      }
      if (!record?.result || record.result.error) throw new Error('browser_stale');
      const {descriptors, text, textFiltered, textChecks, truncated, regions, headings, retrieval, alerts, omittedControls, pageState, surfaces, tables, tableCoverage, coverage, page_view} = record.result;
      task.observedDocuments ||= new Map();
      task.observedDocuments.set(meta.documentId, {tabId: task.tabId, documentId: meta.documentId, nonce});
      for (const descriptor of descriptors) {
        task.refs.set(descriptor.ref, {ref: descriptor.ref, descriptor, tabId: task.tabId, documentId: meta.documentId, nonce});
      }
      frames.push({frame, observedAt: new Date().toISOString(), url: url || safeURL(top.url), ...(meta.result.owner ? {owner: frameOwner(meta.result.owner)} : {}), ...(meta.documentId ? {documentId: meta.documentId} : {}), elements: descriptors, text, textFiltered, ...(textChecks ? {textChecks} : {}), truncated, regions, headings, ...(retrieval ? {retrieval} : {}), alerts, omittedControls, pageState, surfaces, tables, tableCoverage, coverage, ...(page_view ? {page_view} : {})});
    } catch (error) {if (cancelled()) throw new Error('cancelled'); frames.push({frame, url, unavailable: true});}
  }
  if (cancelled()) throw new Error('cancelled');
  const stillTop = await topDocumentId(task.tabId);
  // Host-only identity for exact URL verification; never emit private query values.
  task.observedURL = top.url;
  return {title: top.title.slice(0, 180), url: safeURL(top.url), tabId: task.tabId,
    ...(topId && stillTop === topId ? {topDocumentId: topId} : {}), frames,
    frameCoverage: {discovered: metadata.length, inspected: frames.filter(frame => !frame.unavailable).length, unavailable: frames.filter(frame => frame.unavailable).length, omitted: Math.max(0, metadata.length-16), excluded: Math.min(16, metadata.length)-frames.length, discovery: 'accessible_documents_only'},
    scope: 'Observed DOM in accessible frames and open shadow roots. Input values and credentials omitted. References belong to this observation only.'};
}
