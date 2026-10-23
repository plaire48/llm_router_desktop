import React from 'react';
import {AgentMark, NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {NUBI_VERSION} from './app-version.mjs';

// Desktop lockup: the original artwork, with its own optical spacing.
// The accessible product name stays complete when the toolbar is narrow.
export function WorkspaceBrand({variant='toolbar'}) {
  const intro=variant==='intro'||variant==='loading';
  return <span className="nubi-logo nubi-workspace-brand" data-variant={variant} role="img" aria-label={`누비 Workspace ${NUBI_VERSION}`}>
    <span className="nubi-brand-emblem" aria-hidden="true"><AgentMark size={intro?64:26} mood={intro?'still':'idle'} lively={!intro}/></span>
    <span className="nubi-brand-name" aria-hidden="true"><span className="nubi-brand-title"><span className="nubi-brand-wordmark"><NubiWordmark/></span><span className="nubi-logo-product">Workspace</span></span><span className="nubi-version-badge">v{NUBI_VERSION}</span></span>
  </span>;
}
