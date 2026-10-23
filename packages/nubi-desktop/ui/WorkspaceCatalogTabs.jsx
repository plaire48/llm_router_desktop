import React from 'react';
import {AgentTabs} from '../../../extensions/aipro-chat/src/AgentTabs.jsx';
import './workspace-catalog.css';
import {GlassSurface} from './liquid-glass/GlassSurface.jsx';

// Skills and shared Wiki use one tab geometry, including keyboard navigation.
export function WorkspaceCatalogTabs({wide=true,...props}){
  return <div className="nubi-catalog-tabs" data-layout={wide?'segments':'compact'}><AgentTabs measureAfterLayout={wide} {...props}/>{wide&&<GlassSurface/>}</div>;
}
