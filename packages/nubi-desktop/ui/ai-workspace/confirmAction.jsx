import React from 'react';
import { createRoot } from 'react-dom/client';
import { CxConfirmation } from './CxConfirmation';
import { confirmationCopy } from './confirmationCopy';

let active = false;

// One shared CX confirmation for actions that discard an unsaved draft.
// Resolve only after unmount so focus and scroll locks are restored first.
export function confirmAction({kind = 'leave', ...options} = {}) {
  const content = confirmationCopy(kind, options);
  if (active) return Promise.resolve(false);
  active = true;
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.dataset.cxConfirmation = '';
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        active = false;
        resolve(value);
      });
    };
    root.render(<CxConfirmation {...content} onCancel={() => finish(false)} onConfirm={() => finish(true)}/>);
  });
}
