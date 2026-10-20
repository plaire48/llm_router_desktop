// Body portals share one visual order, regardless of dialog variant. CX keeps
// ownership of focus, Escape, busy guards and background inertness.
export function installModalStack() {
  const layers = new Map();
  let sequence = 0;
  const markTop = () => {
    const active = [...layers.keys()].filter(node => node.isConnected && node.dataset.modalMotion !== 'leaving');
    for (const node of layers.keys()) {
      if (node === active.at(-1)) node.dataset.modalTop = 'true';
      else delete node.dataset.modalTop;
    }
  };
  const register = node => {
    if (!(node instanceof HTMLElement) || node.dataset.modalMotion === 'leaving' || layers.has(node)) return;
    if (!node.matches('.cx-panel-backdrop,[aria-modal="true"]') && !node.querySelector('[aria-modal="true"]')) return;
    const original = {zIndex:node.style.zIndex, position:node.style.position};
    layers.set(node, original);
    node.dataset.modalOrder = String(++sequence);
    node.style.zIndex = `calc(var(--nubi-modal-layer-base, 1200) + ${sequence})`;
    // CX owns a fixed-position backdrop. Avoid flushing the new modal's entire
    // style tree merely to re-read that contract; retain measurement for other portals.
    const inline=node.style.position;
    const position=/^(static|relative|absolute|fixed|sticky)$/.test(inline)?inline:(!inline&&node.matches('.cx-panel-backdrop')?'fixed':getComputedStyle(node).position);
    if (position === 'static') node.style.position = 'relative';
  };
  const restore = (node, original) => {
    node.style.zIndex = original.zIndex;
    node.style.position = original.position;
    delete node.dataset.modalOrder;
    delete node.dataset.modalTop;
  };
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) register(node);
    for (const [node, original] of layers) {
      if (node.isConnected) continue;
      layers.delete(node);
      delete node.dataset.modalTop;
      // Exit motion reinserts the removed node after this observer. Preserve its
      // old height until that animation ends; never register it as a new modal.
      queueMicrotask(() => { if (!layers.has(node) && node.dataset.modalMotion !== 'leaving') restore(node, original); });
    }
    markTop();
  });
  for (const node of document.body.children) register(node);
  markTop();
  observer.observe(document.body, {childList:true});
  return () => { observer.disconnect(); for (const [node, original] of layers) restore(node, original); layers.clear(); };
}
