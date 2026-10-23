import React,{useEffect,useRef} from 'react';
import {startWorkspaceAtmosphere} from './workspace-atmosphere.mjs';
import './workspace-atmosphere.css';
export function WorkspaceAtmosphere({scene='intro',active=true}){
 // Keep the loading renderer dormant between openings; unmount owns disposal.
 const node=useRef(null),canvas=useRef(null),controller=useRef(null);
 useEffect(()=>{const stop=startWorkspaceAtmosphere(node.current,canvas.current,{scene,active});controller.current=stop;return()=>{controller.current=null;stop();};},[scene]);
 useEffect(()=>controller.current?.setActive(active),[scene,active]);
 return <div ref={node} className="nubi-workspace-atmosphere" data-scene={scene} data-renderer="static" aria-hidden="true"><i/><i/><canvas ref={canvas}/></div>;
}
