// CX owns the modal lifecycle. Feedback follows its currently interactive panel.
export const modalFeedbackTarget = () => [...document.querySelectorAll('[aria-modal="true"]')]
  .findLast(node => node.isConnected && !node.closest('[inert],[hidden],[data-modal-motion="leaving"]')) || document.body;
export function subscribeModalFeedback(listener) {
  const observer = new MutationObserver(listener);
  observer.observe(document.body, {childList:true});
  return () => observer.disconnect();
}

export function modalControls(panel) {
  return [...panel.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')].filter(node => {
    const box = node.getBoundingClientRect();
    return node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert]') &&
      !node.classList.contains('visually-hidden') && box.width > 1 && box.height > 1 && getComputedStyle(node).visibility !== 'hidden';
  });
}
