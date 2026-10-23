import React,{useEffect,useRef} from 'react';
import {startWorkspaceAtmosphere} from './workspace-atmosphere.mjs';
import './workspace-atmosphere.css';
export function WorkspaceAtmosphere({scene='intro',active=true}){
 const node=useRef(null),canvas=useRef(null);
 useEffect(()=>{if(!active)return;return startWorkspaceAtmosphere(node.current,canvas.current,{scene,active});},[scene,active]);
 return <div ref={node} className="nubi-workspace-atmosphere" data-scene={scene} data-renderer="static" aria-hidden="true"><i/><i/><canvas ref={canvas}/></div>;
}
