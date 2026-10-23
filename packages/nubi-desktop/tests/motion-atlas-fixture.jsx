import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton} from '@e2e/cx-design-system';
import {GlassSurface} from '../ui/liquid-glass/GlassSurface.jsx';
import {createGlassRenderer} from '../ui/liquid-glass/renderer.mjs';
import {WorkspaceActionMenu} from '../ui/WorkspaceActionMenu.jsx';
import {mergeSnapshot} from '../ui/mergeSnapshot.js';
import {useModalMotion} from '../ui/modalMotion.js';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-pastel.css';
import '../electron-app/modal-motion.css';

function App(){
 useModalMotion();const [selected,setSelected]=useState(0);
 window.atlasSelect=setSelected;
 return <main className="desktop-shell" style={{minHeight:'100vh',padding:24,display:'flex',gap:28}}>
  <nav id="atlas-rail" role="tablist" aria-label="Motion fixture navigation" style={{width:64,height:760,overflow:'hidden',flex:'none',display:'flex',flexDirection:'column',gap:4}}>
   <GlassSurface axis="y"/>{Array.from({length:15},(_,index)=><button key={index} role="tab" aria-selected={selected===index} onClick={()=>setSelected(index)} style={{width:56,height:44,flex:'none',border:0,borderRadius:14,background:'transparent'}}>{index+1}</button>)}
  </nav>
  <section className="nubi-workbench" style={{width:760,padding:24}}>
   <h1>모션과 응답 검사</h1><CxButton id="atlas-press">변경 반영</CxButton>
   <WorkspaceActionMenu label="검사 메뉴"><button>항목 열기</button><button>항목 비교</button></WorkspaceActionMenu>
   <textarea aria-label="입력 반응" style={{display:'block',marginTop:32,width:420,height:100}}/>
  </section>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

window.atlasOptics=()=>{
 const canvas=document.createElement('canvas'),source=document.createElement('canvas');source.width=240;source.height=100;
 const context=source.getContext('2d');for(let x=0;x<240;x++){context.fillStyle=x%12<6?'#365F82':'#EAF5F8';context.fillRect(x,0,1,100);}
 const renderer=createGlassRenderer(canvas);if(!renderer)return {supported:false};renderer.resize(240,100,1,source);
 const gl=renderer.gl,original=gl.drawArrays.bind(gl),draws=[];
 gl.drawArrays=(...args)=>{draws.push(gl.isEnabled(gl.SCISSOR_TEST)?Array.from(gl.getParameter(gl.SCISSOR_BOX)):[0,0,canvas.width,canvas.height]);return original(...args);};
 renderer.draw({x:40,y:30,width:100,height:40},{radius:14,time:0});
 const bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
 const debug=gl.getExtension('WEBGL_debug_renderer_info'),backend=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const value={supported:true,backend,draws,pixels:Array.from(bytes),canvas:[canvas.width,canvas.height],error:gl.getError()};renderer.dispose();return value;
};
window.atlasSnapshotBenchmark=()=>{
 const previous={tasks:Array.from({length:50},(_,i)=>({id:String(i),state:'review',messages:Array.from({length:200},(_,j)=>({id:String(j),role:'assistant',content:'Synthetic reference text '.repeat(100),sources:[{path:'src/synthetic.ts',start:1,end:8}],review:{state:'supported',scope:'fixture'}}))}))};
 const encoded=JSON.stringify(previous),incoming=JSON.parse(encoded),times=[];
 for(let run=0;run<5;run++){const start=performance.now();if(mergeSnapshot(previous,incoming)!==previous)throw Error('snapshot_identity_lost');times.push(performance.now()-start);}
 const define=Object.defineProperty;let writes=0;
 try{Object.defineProperty=(...args)=>{writes++;return define(...args);};mergeSnapshot(previous,incoming);}finally{Object.defineProperty=define;}
 return {bytes:new TextEncoder().encode(encoded).length,times,unchangedPropertyWrites:writes};
};
