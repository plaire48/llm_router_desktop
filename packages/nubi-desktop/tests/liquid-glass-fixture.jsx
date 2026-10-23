import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GlassSurface} from '../ui/liquid-glass/GlassSurface.jsx';
import {createGlassRenderer} from '../ui/liquid-glass/renderer.mjs';
import '../design/workspace-identity.css';
function Fixture(){const [active,setActive]=useState(0);return <div className="desktop-shell"><div id="glass-fixture" role="tablist" style={{position:'relative',display:'flex',width:360,height:48}}><GlassSurface/>{['One','Two','Three'].map((name,index)=><button key={name} role="tab" aria-selected={active===index} onClick={()=>setActive(index)} style={{position:'relative',flex:1,border:0,background:'transparent'}}>{name}</button>)}</div></div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
window.probeRefraction=()=>{
 const source=document.createElement('canvas');source.width=240;source.height=100;
 const ctx=source.getContext('2d');for(let x=0;x<240;x++){ctx.fillStyle=x%12<6?'#365F82':'#EAF5F8';ctx.fillRect(x,0,1,100);}
 const canvas=document.createElement('canvas'),renderer=createGlassRenderer(canvas);if(!renderer)return {supported:false};
 renderer.resize(240,100,1,source);const rect={x:30,y:20,width:180,height:60};
 const capture=strength=>{renderer.draw(rect,{strength,radius:24,time:0});const bytes=new Uint8Array(240*100*4);renderer.gl.readPixels(0,0,240,100,renderer.gl.RGBA,renderer.gl.UNSIGNED_BYTE,bytes);return bytes;};
 const normal=capture(.78),flat=capture(0);let different=0,visible=0;
 for(let i=0;i<normal.length;i+=4){if(normal[i+3])visible++;if(normal[i+3]>8&&(Math.abs(normal[i]-flat[i])+Math.abs(normal[i+1]-flat[i+1])+Math.abs(normal[i+2]-flat[i+2]))*normal[i+3]/255>1)different++;}
 const error=renderer.gl.getError();renderer.dispose();return {supported:true,different,visible,error};
};
