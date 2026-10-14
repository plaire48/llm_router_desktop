const layers = [];
const originalInert = new Map();
const returnTargets = new WeakMap();
let originalOverflow;
let observer;
const feedbackListeners = new Set();
export const subscribeModalFeedback = listener => { feedbackListeners.add(listener); return () => feedbackListeners.delete(listener); };
export const modalFeedbackTarget = () => topLayer()?.panel || document.body;
const notifyFeedbackTarget = () => feedbackListeners.forEach(listener => listener());

const topLayer = () => layers.at(-1);

export function modalControls(panel) {
  return [...panel.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')].filter(node => {
    const box = node.getBoundingClientRect();
    return node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert]') &&
      !node.classList.contains('visually-hidden') && box.width > 1 && box.height > 1 && getComputedStyle(node).visibility !== 'hidden';
  });
}

function updateBackground() {
  const current = topLayer()?.panel;
  if (!current) return;
  for (const node of document.body.children) {
    if (!(node instanceof HTMLElement)) continue;
    if (!originalInert.has(node)) originalInert.set(node, node.inert);
    node.inert = node.contains(current) ? false : true;
  }
}

export function activateModal(panel, { initialFocus, confirmation, onClose }) {
  // React StrictMode replays effects while focus is already inside this panel.
  const previous = panel.contains(document.activeElement) && returnTargets.has(panel)
    ? returnTargets.get(panel) : document.activeElement;
  returnTargets.set(panel, previous);
  const layer = { panel };
  if (!layers.length) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    observer = new MutationObserver(updateBackground);
    observer.observe(document.body, { childList: true });
  }
  layers.push(layer);
  updateBackground();
  notifyFeedbackTarget();
  const focus = () => {
    const target = (initialFocus && panel.querySelector(initialFocus)) ||
      (confirmation && modalControls(panel).find(node => node.closest('.cx-panel-footer'))) ||
      panel.querySelector('h2') || panel;
    target.focus({ preventScroll: true });
  };
  focus();
  const keydown = event => {
    if (topLayer() !== layer || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = modalControls(panel), first = items[0], last = items.at(-1);
    if (!items.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    if (!items.length) { event.preventDefault(); focus(); }
  };
  const focusin = event => {
    if (topLayer() === layer && !panel.contains(event.target)) focus();
  };
  document.addEventListener('keydown', keydown);
  document.addEventListener('focusin', focusin);
  return () => {
    const wasTop = topLayer() === layer;
    layers.splice(layers.indexOf(layer), 1);
    notifyFeedbackTarget();
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('focusin', focusin);
    if (layers.length) updateBackground();
    else {
      observer.disconnect();
      for (const [node, inert] of originalInert) node.inert = inert;
      originalInert.clear();
      document.body.style.overflow = originalOverflow;
    }
    // A parent and its help dialog may unmount together. Restore after both clean up.
    queueMicrotask(() => {
      if (layers.some(item => item.panel === panel)) return;
      returnTargets.delete(panel);
      if (!wasTop) return;
      const current = topLayer()?.panel;
      // A replacement dialog may already have focused its safe action.
      // Do not let the closing layer move that focus back to the panel itself.
      if (current?.contains(document.activeElement)) return;
      if (previous?.isConnected && !previous.closest('[inert]') && (!current || current.contains(previous))) previous.focus({ preventScroll: true });
      else current?.focus({ preventScroll: true });
    });
  };
}
