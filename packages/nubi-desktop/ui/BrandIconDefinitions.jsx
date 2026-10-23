import React from 'react';

// One paint server per Workspace document; body portals reference the same ID.
// User-space coordinates keep horizontal/vertical strokes visible as well.
export function BrandIconDefinitions(){
 return <svg className="nubi-brand-definitions" aria-hidden="true" focusable="false" width="0" height="0"><defs>
  <linearGradient id="nubi-brand-icon-ink" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="24" y2="20">
   <stop offset="0" className="nubi-brand-ink-mint"/><stop offset=".5" className="nubi-brand-ink-blue"/><stop offset="1" className="nubi-brand-ink-lavender"/>
  </linearGradient>
 </defs></svg>;
}
