import React from 'react';
import {AgentMark, NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';

// Desktop lockup: the original artwork, with its own optical spacing.
// The accessible product name stays complete when the toolbar is narrow.
export function WorkspaceBrand() {
  return <span className="nubi-logo nubi-workspace-brand" role="img" aria-label="누비 Workspace Beta">
    <span className="nubi-brand-emblem" aria-hidden="true"><AgentMark size={26} mood="idle" lively/></span>
    <span className="nubi-brand-name" aria-hidden="true"><span className="nubi-brand-wordmark"><NubiWordmark/></span><span className="nubi-logo-product">Workspace</span></span>
    <span className="nubi-beta" aria-hidden="true">Beta</span>
  </span>;
}
