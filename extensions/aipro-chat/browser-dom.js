// This module is bundled inside static, serializable functions at build time.
// No page/model-provided JavaScript is evaluated by the observer.
import {computeAccessibleName, getRole} from 'dom-accessibility-api';
import {paginationView} from './browser-pagination.js';
import {publicSourceURL} from './browser-public-url.js';
import {rankEvidence, evidenceExcerpt} from './evidence-search.js';
import {describeControl, inViewport, pageInformation, scrollGeometry} from './browser-information.js';

const clean = (value, limit = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const parent = el => el.parentElement || el.getRootNode()?.host;
const controls = 'button,input,textarea,select,a[href],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tab"],[role="option"],[role="combobox"],[aria-checked],[aria-pressed],[aria-expanded],[tabindex],summary';
const handlers = '[onclick],[onmousedown],[onpointerup],[onpointerdown],[ondragover],[ondrop]';
const hoverHandlers = '[onmouseenter],[onmouseover],[onpointerenter],[onpointerover]';
function activation(el) {
  if (el.matches(controls)) return 'semantic';
  if (el.matches('html,body,iframe,label') || el.isContentEditable) return null;
  if (el.matches('[draggable="true"]')) return 'drag';
  if (el.matches(handlers)) return 'handler';
  if (el.matches(hoverHandlers) || el.hasAttribute('aria-haspopup')) return 'hover';
  // Cursor inheritance must not create a ref for every label inside a card.
  // This is a candidate signal, never proof that the requested action ran.
  const owner = parent(el);
  if (getComputedStyle(el).cursor === 'grab' && (!owner || getComputedStyle(owner).cursor !== 'grab')) return 'drag';
  if (getComputedStyle(el).cursor === 'pointer' && (!owner || getComputedStyle(owner).cursor !== 'pointer') && !el.closest(`${controls},${handlers}`)) return 'pointer';
  return null;
}
export function clickTarget(el) {
  if (el.matches('input[type="checkbox"],input[type="radio"]')) {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (!el.getClientRects().length || rect.width < 2 || rect.height < 2 || style.opacity === '0' || style.pointerEvents === 'none') {
      const label = [...el.labels || []].find(node => {
        const box = node.getBoundingClientRect();
        return node.control === el && box.width > 2 && box.height > 2 && !node.closest('[hidden],[inert],[aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden';
      });
      if (label) return label;
    }
  }
  if (el.getClientRects().length) return el;
  if (getComputedStyle(el).display !== 'contents') return el;
  // A display:contents link has no box. Click one visible non-interactive
  // descendant belonging to this exact link; never force or run el.click().
  return [...el.querySelectorAll('*')].slice(0, 200).find(child => {
    const rect = child.getBoundingClientRect();
    if (!rect.width || !rect.height || child.closest('[hidden],[inert],[aria-hidden="true"]') || getComputedStyle(child).visibility === 'hidden') return false;
    for (let node = child; node && node !== el; node = parent(node)) if (node.matches(`${controls},${handlers}`)) return false;
    return true;
  }) || el;
}
// A wrapped inline link can have several hit areas. Playwright normally uses
// its first quad; a cover over that line must not hide a clear second line.
// Return an element-relative position only when live hit testing reaches this
// exact target. Playwright still performs its normal actionability checks.
export function pointerPosition(el) {
  const box = el.getBoundingClientRect(), style = getComputedStyle(el);
  const root = el.getRootNode(), hitRoot = typeof root.elementFromPoint === 'function' ? root : el.ownerDocument;
  for (const rect of [...el.getClientRects()].slice(0, 32)) {
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    if (right - left < 2 || bottom - top < 2) continue;
    for (const [rx, ry] of [[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]]) {
      const x = left + (right-left)*rx, y = top + (bottom-top)*ry;
      let hit = hitRoot.elementFromPoint(x, y);
      while (hit?.shadowRoot?.elementFromPoint) {
        const child = hit.shadowRoot.elementFromPoint(x, y);
        if (!child || child === hit) break;
        hit = child;
      }
      let node = hit;
      while (node && node !== el && !node.matches?.(`${controls},${handlers}`)) node = parent(node);
      if (node === el) return {x:x-box.left-(parseFloat(style.borderLeftWidth)||0), y:y-box.top-(parseFloat(style.borderTopWidth)||0)};
    }
  }
  return null;
}

function hoverSurfaces(el) {
  const roots = new Set([el.getRootNode(), el.ownerDocument]);
  return [...roots].flatMap(root => [...root.querySelectorAll('[role="menu"],[role="listbox"],[role="tooltip"],[role="dialog"],[popover]')].slice(0, 128));
}
function revealedSurface(node) {
  return !!node?.isConnected && !hidden(node) && node.getAttribute('aria-busy') !== 'true' && getComputedStyle(node).opacity !== '0';
}
// Retained as a local JSHandle only, never serialized to model context. The
// baseline avoids mistaking an already-open unrelated popup for a hover result.
export function prepareHoverReveal(el) {
  return {el, visible: new Set(hoverSurfaces(el).filter(revealedSurface))};
}
// Wait for visible evidence, not another input. Portals commonly mount outside
// the trigger subtree without aria-controls. A newly visible surface is only
// a reason to re-observe, never proof of ownership or completion.
export async function waitForHoverReveal({el, visible}) {
  const root = el.getRootNode(), until = Date.now() + 1500;
  let previous = null;
  while (el.isConnected) {
    const lookup = id => root.getElementById?.(id) || el.ownerDocument.getElementById(id);
    const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).slice(0, 8).map(lookup).filter(node => node?.getAttribute('role') === 'tooltip');
    const candidate = [...ids.map(lookup), ...described].find(revealedSurface) || hoverSurfaces(el).find(node => !visible.has(node) && revealedSurface(node));
    if (candidate && candidate === previous) return;
    previous = candidate;
    if (Date.now() >= until) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
function hidden(el) {
  const target = clickTarget(el);
  if (target !== el && target.matches('label') && target.control === el) return hidden(target);
  for (let node = el; node; node = parent(node)) {
    if (node.matches('[hidden],[inert],[aria-hidden="true"]')) return true;
    // Chromium can expose layout boxes inside a closed details element.
    // Only its first summary is rendered; boxes alone are not visible evidence.
    if (node.matches('details:not([open])') && node !== el && !node.querySelector(':scope > summary')?.contains(el)) return true;
  }
  return !target.getClientRects().length || ['hidden', 'collapse'].includes(getComputedStyle(el).visibility);
}
const accessible = el => clean(computeAccessibleName(el));
function activeElement(root = document) {
  let el = root.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
function keyboardState(el) {
  const focused = activeElement(el.ownerDocument);
  const readonly = !!el.readOnly || el.getAttribute('aria-readonly') === 'true';
  const editable = !readonly && !el.matches(':disabled') && !el.closest('[aria-disabled="true"]') &&
    (el.isContentEditable || el.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="number"]'));
  return {focused: focused === el || el.isContentEditable && el.contains(focused), editable};
}
function widgetRelations(el) {
  const root = el.getRootNode();
  // IDREFs are scoped to their own document/shadow root, never guessed selectors.
  const find = id => root.getElementById?.(id);
  const controls = [...new Set(`${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean))].slice(0, 8).flatMap(id => {
    const node = find(id);
    if (!node || secret(node, accessible(node))) return [];
    return [{id: clean(id), role: getRole(node), visible: !hidden(node)}];
  });
  const activeId = el.getAttribute('aria-activedescendant'), active = activeId ? find(activeId) : null;
  const activeInfo = active && !hidden(active) && !active.isContentEditable && !active.matches('input,textarea,select') && !active.querySelector('input,textarea,select,[contenteditable]') ? inspectTarget(active) : null;
  return {...(controls.length ? {controls} : {}),
    ...(['none', 'inline', 'list', 'both'].includes(el.getAttribute('aria-autocomplete')) ? {autocomplete: el.getAttribute('aria-autocomplete')} : {}),
    ...(activeInfo && !activeInfo.secret ? {activeDescendant: {id: clean(active.id), role: activeInfo.role, name: activeInfo.name, ...controlState(active)}} : {})};
}
export function controlState(el) {
  const result = {};
  const native = el.matches('input[type="checkbox"],input[type="radio"]');
  for (const key of ['checked', 'pressed', 'expanded', 'selected']) {
    const value = el.getAttribute(`aria-${key}`);
    if (['true', 'false', 'mixed'].includes(value)) result[key] = value === 'mixed' ? value : value === 'true';
  }
  if (native) result.checked = el.indeterminate ? 'mixed' : !!el.checked;
  // The applied tab, filter or navigation entry is often marked only this way.
  const current = el.getAttribute('aria-current');
  if (['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(current)) result.current = current !== 'false';
  const key = Object.hasOwn(result, 'checked') ? 'checked' : Object.hasOwn(result, 'pressed') ? 'pressed' : null;
  if (key) Object.assign(result, {state: result[key], stateKind: key, stateSource: native ? 'native' : `aria-${key}`});
  const hint = el.getAttribute('data-state');
  if (['on', 'off', 'checked', 'unchecked', 'indeterminate', 'open', 'closed'].includes(hint)) result.stateHint = hint;
  return result;
}
function secret(el, name) {
  const hint = `${el.type} ${el.name} ${el.id} ${name} ${el.autocomplete}`;
  return el.matches('input[type="file"],input[type="password"]') || /password|passwd|비밀번호|인증번호|일회용|토큰|시크릿|카드번호|보안코드|api[ _-]?key|secret|cc-|one-time-code|\b(?:otp|token|cvv|cvc|pin)\b/i.test(hint) ||
    (el.matches('input,textarea,select') || el.isContentEditable) && /\bcard\b/i.test(hint);
}
export {secret as isSensitiveElement};
export function inspectTarget(el) {
  const accessibleName = accessible(el) || (el.matches('input[type="checkbox"],input[type="radio"]') && clickTarget(el) !== el ? clean(computeAccessibleName(el, {hidden: true})) : '');
  const text = activation(el) && !el.matches('input,textarea,select') && !el.isContentEditable && !el.querySelector('input,textarea,select,[contenteditable]') ? clean(el.innerText || el.textContent) : '';
  const name = accessibleName || clean(el.placeholder || el.title) || text || clean(el.name || el.id);
  return {name, accessibleName, role: getRole(el), type: el.isContentEditable ? 'contenteditable' : el.type,
    disabled: el.matches(':disabled') || !!el.closest('[aria-disabled="true"]'),
    secret: secret(el, name), hidden: hidden(el), connected: el.isConnected, ...controlState(el), ...keyboardState(el)};
}
function contextOf(el, cache) {
  const result = [];
  for (let node = parent(el); node && result.length < 3; node = parent(node)) {
    let context = cache.get(node);
    if (context === undefined) {
      const heading = node.querySelector(':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > [role="heading"]');
      const role = getRole(node) || (heading && node.matches('section,article') ? node.localName : null);
      context = null;
      if (['dialog', 'alertdialog', 'form', 'group', 'region', 'row', 'listitem', 'navigation', 'main', 'section', 'article'].includes(role)) {
        // Row/list names computed from descendants can include editable values.
        // Use authored labels or a non-editable heading/cell as the context hint.
        const cell = role === 'row' ? node.querySelector('th,td,[role="rowheader"],[role="cell"]') : null;
        const name = node.matches('[aria-label],[aria-labelledby],fieldset') ? accessible(node) : clean(heading?.textContent || (cell && !cell.querySelector('input,textarea,select,[contenteditable]') ? cell.textContent : ''));
        if (!secret(node, name)) context = {role, ...(name ? {name} : {})};
      }
      cache.set(node, context);
    }
    if (context) result.push(context);
  }
  return result;
}
export function collectSnapshot(input) {
  const options = typeof input === 'object' && input ? input : null;
  const regionRef = options?.region_ref;
  const regionCache = globalThis.__nubiBrowserRegionsV1;
  const regionEntry = typeof regionRef === 'string' ? regionCache?.refs?.get(regionRef) : null;
  const regionRead = regionRef !== undefined;
  if (regionRead && (typeof regionRef !== 'string' || !/^r-[a-f0-9-]{36}-[0-9]+$/.test(regionRef) || options.query || options.nonce || options.expectedTexts)) return {error: 'region_arguments_invalid'};
  if (regionRead && (!regionEntry || regionCache.url !== location.href || !regionEntry.isConnected || regionEntry.ownerDocument !== document || hidden(regionEntry))) return {error: 'region_stale'};
  const query = clean(options?.query || (typeof input === 'string' ? input : '')).toLowerCase();
  const expectedTexts = Array.isArray(options?.expectedTexts) ? options.expectedTexts.slice(0, 8).filter(value => typeof value === 'string' && value.trim() && value.length <= 16000) : [];
  // One synchronous observation never mutates the page. Reuse visibility
  // checks across controls, text blocks and table/surface extraction only
  // within this call; a later observation must see the current DOM state.
  const visibility = new WeakMap();
  const isHidden = el => {
    if (!visibility.has(el)) visibility.set(el, hidden(el));
    return visibility.get(el);
  };
  // Focused retrieval can inspect further without enlarging model output.
  const nodeLimit = query || expectedTexts.length ? 16000 : 5000;
  if (options?.expectedURL && location.href !== options.expectedURL) return {error: 'browser_stale'};
  let skippedSubtrees = 0, domTruncated = false;
  const all = [], textNodes = [], walk = root => {
    // A closed details renders only its first summary. Its potentially huge
    // archived subtree must not consume the rendered-page observation budget
    // and hide following inputs/actions. Recompute on every fresh observation.
    const closedDetails = root.matches?.('details:not([open])');
    const summary = closedDetails ? root.querySelector(':scope > summary') : null;
    const children = closedDetails ? summary ? [summary] : [] : root.childNodes || [];
    if (closedDetails) skippedSubtrees += [...root.children].filter(node => node !== summary).length;
    for (const node of children) {
      if (all.length >= nodeLimit) {domTruncated = true; break;}
      if (node.nodeType === Node.TEXT_NODE) textNodes.push(node);
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // Exclude entire non-rendered subtrees before they spend the observation
      // budget. Keep visually represented native toggles and display:contents.
      const labelToggle = node.matches('input[type="checkbox"],input[type="radio"]') && clickTarget(node) !== node;
      if (node.matches('script,style,noscript,template') || !labelToggle && (node.matches('[hidden],[inert],[aria-hidden="true"]') || getComputedStyle(node).display === 'none')) {skippedSubtrees++; continue;}
      all.push(node);
      // Preserve the visual surface itself, not thousands of SVG path nodes.
      if (node.matches('svg,canvas')) {skippedSubtrees++; continue;}
      if (node.shadowRoot) walk(node.shadowRoot); walk(node);
    }
  };
  if (regionRead) all.push(regionEntry);
  walk(regionRead ? regionEntry : document.body || document.documentElement);
  const candidates = [], texts = [], regions = [], headings = [], alerts = [], focused = activeElement(), contextCache = new WeakMap();
  for (const el of all) {
    if (isHidden(el) || el.closest('script,style,noscript,template,svg,canvas')) continue;
    const rich = el.isContentEditable && el.matches('[contenteditable="true"],[contenteditable="plaintext-only"]');
    const field = el.matches('input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),textarea,select') || rich;
    const scroll = scrollGeometry(el);
    const trigger = activation(el), interactive = field || trigger || scroll;
    // Inspect names for actionable/structural nodes only; never read field values.
    const role = getRole(el);
    const info = interactive ? inspectTarget(el) : null;
    if (secret(el, info?.name || clean(el.getAttribute('aria-label')))) continue;
    if (role === 'heading' && headings.length < 40 && !el.closest('[contenteditable]') && !el.querySelector('input,textarea,select,[contenteditable]')) headings.push({level: Number(el.getAttribute('aria-level') || el.tagName.slice(1)) || 0, name: accessible(el)});
    if (['dialog', 'alertdialog', 'form', 'navigation', 'main', 'region'].includes(role) && regions.length < 24) {
      const name = accessible(el);
      if (!secret(el, name)) regions.push({role, name, ...(el.matches('dialog:modal,[aria-modal="true"]') ? {modal: true} : {})});
    }
    if (['alert', 'status'].includes(role) && alerts.length < 12 && !el.querySelector('input,textarea,[contenteditable]')) alerts.push({role, text: clean(el.textContent, 400)});
    if (interactive) {
      const state = controlState(el);
      const kind = scroll && !field && !trigger ? 'scroll_area' : el.tagName === 'SELECT' ? 'select' : ['checkbox', 'radio'].includes(el.type) ? el.type : state.stateKind === 'checked' ? (role === 'radio' || role === 'menuitemradio' ? 'radio' : role === 'switch' ? 'switch' : 'checkbox') : state.stateKind === 'pressed' ? 'toggle' : field ? 'field' : el.matches('a[href]') ? 'link' : 'control';
      const context = contextOf(el, contextCache), name = info.name || role || kind;
      const choices = el.tagName === 'SELECT' ? [...el.options].slice(0, 80).map(o => ({value: o.value.slice(0, 200), label: clean(o.label), disabled: o.disabled || !!o.closest('optgroup[disabled]')})) : undefined;
      const destination = el.matches('a[href]') ? publicSourceURL(el.href) : null;
      const descriptor = {name, accessibleName: info.accessibleName, role, kind, tag: el.tagName.toLowerCase(),
        ...(scroll ? {scroll} : {}),
        ...describeControl(el, secret), inViewport: inViewport(clickTarget(el)),
        ...(trigger && trigger !== 'semantic' ? {activation: trigger} : {}),
        ...(el.matches(hoverHandlers) ? {hoverHint: true} : {}),
        ...(el.matches('[draggable="true"]') ? {draggable: true} : {}),
        ...(el.matches('[ondragover],[ondrop]') ? {dropTarget: true} : {}),
        ...(destination ? {destination} : {}), ...(el.matches('a[target]') ? {linkTarget: clean(el.target, 80)} : {}), ...(el.matches('a[download]') ? {download: true} : {}),
        ...(el.id ? {id: clean(el.id)} : {}), ...(el.getAttribute('data-testid') ? {testId: clean(el.getAttribute('data-testid'))} : {}),
        type: info.type, disabled: info.disabled, ...(info.focused ? {focused: true} : {}), ...(field ? {editable: info.editable} : {}),
        ...widgetRelations(el), ...(context.length ? {context} : {}),
        ...(field || ['combobox', 'textbox', 'searchbox', 'spinbutton', 'listbox'].includes(role) ? {required: !!el.required || el.getAttribute('aria-required') === 'true', readonly: !!el.readOnly || el.getAttribute('aria-readonly') === 'true', invalid: el.getAttribute('aria-invalid') === 'true' || el.validity?.valid === false} : {}),
        ...(choices ? {options: choices} : {}),
        ...state,
        ...(el.hasAttribute('aria-haspopup') ? {haspopup: el.getAttribute('aria-haspopup')} : {})};
      candidates.push({el, descriptor, priority: context.some(c => ['dialog','alertdialog'].includes(c.role)) ? 0 : el === focused ? 1 : descriptor.inViewport ? 2 : 3});
    }
  }
  // A result may expose a publisher, title and snippet as separate links to
  // exactly the same address. Preserve alternatives without inferring a title.
  // The private full href is the key: redacted URLs may alias different items.
  const linkLabels = new Map();
  for (const {el, descriptor} of candidates) {
    if (!descriptor.destination || !el.matches('a[href]')) continue;
    const labels = linkLabels.get(el.href) || [];
    if (!labels.includes(descriptor.name) && labels.length < 4) labels.push(descriptor.name);
    linkLabels.set(el.href, labels);
  }
  for (const {el, descriptor} of candidates) {
    const labels = descriptor.destination && linkLabels.get(el.href);
    if (labels?.length > 1) descriptor.sameDestinationLabels = labels;
  }
  // Read in DOM order, including inline descendants. Collecting each parent's
  // direct text before its children turned "읽기 <b>준비</b> 완료" into
  // "읽기 완료 준비" and silently cut every long paragraph at 180 characters.
  const blocks = new Map(), textRegions = [], regionDetails = new Map(), regionHeadings = new Map();
  let previousBlock, previousRegion, mixedRegion = false, currentText = '', remainingText = 256000, textTruncated = false;
  const flush = () => {const text = clean(currentText, remainingText + 1); if (text.length > remainingText) textTruncated = true; if (remainingText && text) {texts.push(text.slice(0, remainingText)); textRegions.push(mixedRegion ? null : previousRegion);} remainingText = Math.max(0, remainingText - text.length); currentText = ''; mixedRegion = false;};
  for (const node of textNodes) {
    const container = node.parentElement;
    if (!container || isHidden(container)) continue;
    let blocked = false;
    for (let el = container; el; el = parent(el)) {
      if (el.matches('input,textarea,select,[contenteditable],script,style,noscript,template,svg,canvas') || secret(el, clean(el.getAttribute('aria-label')))) {blocked = true; break;}
    }
    if (blocked) continue;
    let block = container;
    for (let el = container; el; el = parent(el)) {
      if (!blocks.has(el)) blocks.set(el, !['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents'].includes(getComputedStyle(el).display));
      block = el; if (blocks.get(el)) break;
    }
    // A matching number does not identify its card, date or source. Preserve
    // the nearest semantic region; never treat the whole main as one card.
    let region, heading, link;
    for (let el = container; el; el = parent(el)) {
      if (!heading && el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) heading = el;
      if (!link && el.matches('a[href]')) link = el;
      if (el.matches('section,article,[role="region"]') && !el.matches('main,[role="main"]')) {region = el; break;}
    }
    region ||= block;
    if (!regionDetails.has(region)) regionDetails.set(region, {index: regionDetails.size,
      role: region.matches?.('section,article,[role="region"]') ? region.getAttribute('role') || region.localName : 'text_block'});
    const detail = regionDetails.get(region);
    // Only text nodes that passed the same visibility/privacy checks above
    // contribute heading context. Never read an ancestor's whole textContent.
    if (heading && (region === heading || region.contains(heading))) {
      if (!regionHeadings.has(region)) regionHeadings.set(region, heading);
      if (regionHeadings.get(region) === heading) detail.heading = clean(`${detail.heading || ''} ${node.textContent}`, 180);
    }
    if (link && (region === link || region.contains(link))) {
      const url = publicSourceURL(link.href);
      if (url && url.length <= 512 && !detail.links?.includes(url) && (detail.links?.length || 0) < 2) (detail.links ||= []).push(url);
    }
    if (block !== previousBlock || query && region !== previousRegion) {flush(); previousBlock = block; previousRegion = region;}
    // Preserve the unfiltered text's original whitespace and block boundaries.
    // Inline/display:contents regions can share a rendered block; assigning
    // that whole block to its first region would invent an association.
    else if (region !== previousRegion) mixedRegion = true;
    const left = Math.max(0, remainingText - currentText.length);
    if (node.textContent.length > left) textTruncated = true;
    currentText += node.textContent.slice(0, left);
  }
  flush();
  // Verify against the same filtered, rendered text BEFORE the model's overview
  // is truncated. Do not rank evidence or count hidden text/field values as proof.
  // Only booleans leave the document; expected values are never echoed.
  const scannedText = expectedTexts.length ? texts.join(' ').replace(/\s+/g, ' ').trim() : '';
  const textChecks = expectedTexts.map(expected => scannedText.includes(expected.replace(/\s+/g, ' ').trim()));
  // Keep all visible choices, prioritizing dialogs when a long background page
  // would otherwise exhaust the budget. Never turn DOM order into confidence.
  const roleWords = {switch: '스위치 토글', checkbox: '체크박스', radio: '라디오', button: '버튼', link: '링크', tab: '탭', combobox: '선택', textbox: '입력란', searchbox: '검색'};
  const ranked = query ? rankEvidence(candidates.map(({descriptor: d}, id) => ({id, name: `${d.name} ${d.accessibleName}`, context: `${(d.context || []).map(c => c.name || '').join(' ')} ${d.description || ''}`, text: `${d.id || ''} ${d.testId || ''} ${d.role || ''} ${roleWords[d.role] || ''} ${d.validationMessage || ''}`})), query) : [];
  // Preserve DOM order when every control fits. Moving focus must not reorder
  // an otherwise unchanged observation and look like progress to recovery.
  const ordered = query ? ranked.map(hit => ({...candidates[hit.id], match: hit.match})) :
    candidates.length > 180 ? candidates.sort((a, b) => a.priority - b.priority) : candidates;
  const chosen = ordered.slice(0, 180), elements = chosen.map(item => item.el);
  let detailBudget = 6000, omittedControlDetails = 0;
  const descriptors = chosen.map(({descriptor, match}) => {
    const {description, validationMessage, constraints, ...base} = descriptor;
    const details = {...(description ? {description} : {}), ...(validationMessage ? {validationMessage} : {}), ...(constraints ? {constraints} : {})};
    const size = JSON.stringify(details).length;
    if (size > detailBudget) {omittedControlDetails++; return {...base, detailsOmitted: true, ...(match ? {match} : {})};}
    detailBudget -= size; return {...base, ...details, ...(match ? {match} : {})};
  });
  const textMatches = query ? rankEvidence(texts.map((text, id) => ({id, text,
    context: regionDetails.get(textRegions[id])?.heading || ''})), query) : [];
  const excerpts = new Map(); let excerptSize = 0, excerptOmitted = false;
  for (const hit of textMatches.slice(0, 8)) for (const i of [hit.id, hit.id - 1, hit.id + 1]) {
    if (!texts[i] || excerpts.has(i) || textRegions[i] !== textRegions[hit.id]) continue;
    const snippet = evidenceExcerpt(texts[i], query);
    if (excerptSize + snippet.length + 1 > 16000) {excerptOmitted = true; continue;}
    excerpts.set(i, snippet); excerptSize += snippet.length + 1;
  }
  const orderedExcerpts = query ? [...excerpts].sort((a, b) => a[0] - b[0]) : texts.map((text, id) => [id, text]);
  const excerpt = query ? orderedExcerpts.map(([, text]) => text) : texts;
  const text = excerpt.join('\n'), returnedText = text.slice(0, 16000);
  // Offsets refer only to this returned text, not the source DOM or action IDs.
  // Context is bounded and advisory; links are observed candidates, not proof
  // that a figure belongs to a linked provider or that the link was opened.
  // getRandomValues also works on ordinary HTTP pages where randomUUID may
  // be unavailable. The opaque token grants no action or cross-frame access.
  const regionNonce = regionRead ? null : options?.nonce || (() => {
    const hex = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  })();
  const retainedRegions = new Map();
  const regionRefs = new Map(regionRead ? [...regionCache.refs].map(([ref, node]) => [node, ref]) : []);
  const textBlocks = [], contexts = []; let textOffset = 0, contextOmitted = false;
  for (const [id, snippet] of orderedExcerpts) {
    if (textOffset >= returnedText.length) {contextOmitted = true; break;}
    const regionNode = textRegions[id];
    const originalDetail = regionDetails.get(regionNode);
    const ref = regionRead ? regionRefs.get(regionNode) : originalDetail && `r-${regionNonce}-${originalDetail.index}`;
    const detail = originalDetail && {...originalDetail, ...(ref ? {region_ref: ref} : {})};
    if (!detail) {contextOmitted = true; textOffset += snippet.length + 1; continue;}
    const block = {start: textOffset, end: Math.min(returnedText.length, textOffset + snippet.length), regionIndex: detail.index};
    const context = contexts.some(item => item.index === detail.index) ? [] : [detail];
    if (JSON.stringify({textBlocks: [...textBlocks, block], textRegions: [...contexts, ...context]}).length <= 4000) {
      textBlocks.push(block); contexts.push(...context);
      if (ref) retainedRegions.set(ref, regionNode);
    } else contextOmitted = true;
    textOffset += snippet.length + 1;
  }
  const information = pageInformation(all, {query, hidden: isHidden, secret, domTruncated});
  const textPartial = textTruncated || text.length > 16000 || !!query && (textMatches.length > 8 || excerptOmitted || [...excerpts.keys()].some(i => texts[i].length > 1200));
  const result = {descriptors: regionRead ? [] : descriptors, text: returnedText, textFiltered: !!query, regions, headings, alerts, ...information, page_view: paginationView(all),
    ...(expectedTexts.length ? {textChecks} : {}),
    coverage: {nodesInspected: all.length, nodeLimit, skippedSubtrees, domTruncated, textTruncated: textPartial, queryFiltered: !!query,
      controlsObserved: candidates.length, controlsReturned: regionRead ? 0 : descriptors.length, omittedControlDetails,
      scope: 'Rendered DOM in this document and open shadow roots. Hidden content, field values, closed roots and unloaded virtual rows are not inspected. Counts describe this scan only.'},
    retrieval: {method: query ? 'lexical' : 'dom_order', ...(query ? {matchedControls: ranked.length, matchedTextBlocks: textMatches.length, filteredControls: candidates.length - ranked.length} : {}),
      textBlocks, textRegions: contexts, contextOmitted,
      instruction: 'Matches are candidates, not certainty or permission. textBlocks offsets locate excerpts in returned text; regionIndex groups only the observed nearest region, never an action ref or a label/value association. region_ref permits read_page mode=region only. Region links are observed candidates, not verified source attribution. Compare labels, dates and source within the same region; do not merge figures across regions. Missing context remains unknown. Compare name, region, frame and current state. Partial or truncated results do not prove absence; narrow the query, inspect visually or ask about an unresolved choice.'},
    truncated: domTruncated || textPartial || !regionRead && ordered.length > chosen.length,
    omittedControls: regionRead ? ordered.length : ordered.length - chosen.length,
    ...(regionRead ? {region_scope: {region_ref: regionRef, region_index: Number(regionRef.slice(regionRef.lastIndexOf('-') + 1)), read_only: true, partial: domTruncated || textPartial,
      instruction: 'Visible text reread only inside this observed DOM region. It may contain several cards or dates; region membership does not prove label/value association, freshness or completion. No action refs are granted.'}} : {})};
  if (!regionRead) globalThis.__nubiBrowserRegionsV1 = {url: location.href, refs: retainedRegions};
  if (options?.nonce) {
    const refs = new Map();
    result.descriptors = descriptors.map((descriptor, index) => {
      const ref = `c-${options.nonce}-${index}`; refs.set(ref, elements[index]); return {ref, ...descriptor};
    });
    globalThis.__nubiBrowserObservationV1 = {nonce: options.nonce, url: location.href, refs, markers: new Map()};
    return result;
  }
  return {...result, elements: regionRead ? [] : elements};
}
