import React from 'react';
import {AgentMark, NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {NUBI_VERSION} from './app-version.mjs';

// Desktop lockup: the original artwork, with its own optical spacing.
// The accessible product name stays complete when the toolbar is narrow.
export function WorkspaceBrand({variant='toolbar'}) {
  const intro=variant==='intro';
  return <span className="nubi-logo nubi-workspace-brand" data-variant={variant} role="img" aria-label={intro?'누비 Workspace':`누비 Workspace ${NUBI_VERSION}`}>
    <span className="nubi-brand-emblem" aria-hidden="true"><AgentMark size={intro?64:26} mood="idle" lively/></span>
    <span className="nubi-brand-name" aria-hidden="true"><span className="nubi-brand-wordmark"><NubiWordmark/></span><span className="nubi-logo-product">Workspace</span></span>
    {!intro&&<span className="nubi-beta nubi-version-badge" aria-hidden="true">{NUBI_VERSION}</span>}
  </span>;
}
