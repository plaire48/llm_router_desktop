// Evidence collector for design QA. Findings require contextual review; this
// does not turn a rendered fixture into an iOS/assistive-technology certification.
export async function auditCxSurface(page){
 return page.evaluate(()=>{
  const excluded='svg,.monaco-editor,.xterm,[aria-hidden=true],.visually-hidden,.nubi-logo,.nubi-word-paper,.nubi-ppt-canvas,.nubi-excel-grid-scroll,.talk-rich-content';
  const shown=node=>node.checkVisibility()&&!node.closest(excluded);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true}),cache=new Map();
  const color=value=>{if(cache.has(value))return cache.get(value);ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const p=[...ctx.getImageData(0,0,1,1).data];p[3]/=255;cache.set(value,p);return p;};
  const blend=(front,back)=>{const a=front[3]+back[3]*(1-front[3]);return [0,1,2].map(i=>(front[i]*front[3]+back[i]*back[3]*(1-front[3]))/(a||1)).concat(a);};
  const luminance=p=>p.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const label=node=>(node.getAttribute('aria-label')||[...(node.getAttribute('aria-labelledby')||'').split(/\s+/)].map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||[...(node.labels||[])].map(n=>n.textContent).join(' ').trim()||node.getAttribute('title')||node.textContent.trim()).slice(0,100);
  const identify=node=>({tag:node.tagName,class:typeof node.className==='string'?node.className:'',text:node.textContent.trim().slice(0,70)});
  const contrast=[],unmeasured=[],names=[],targets=[];let textCount=0;
  for(const node of document.body.querySelectorAll('*')){
   if(!shown(node)||![...node.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))continue;
   if(node.closest(':disabled,[aria-disabled=true]'))continue;
   const style=getComputedStyle(node);if(Number(style.opacity)===0)continue;textCount++;
   let bg=[0,0,0,0],unknown=false;
   for(let parent=node;parent;parent=parent.parentElement){const ps=getComputedStyle(parent);if(ps.backgroundImage!=='none'||Number(ps.opacity)<1){unknown=true;break;}bg=blend(bg,color(ps.backgroundColor));if(bg[3]>=.999)break;}
   if(unknown){unmeasured.push(identify(node));continue;}
   bg=blend(bg,[255,255,255,1]);const fg=blend(color(style.color),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   const size=parseFloat(style.fontSize),minimum=size>=24||size>=18.667&&Number(style.fontWeight)>=700?3:4.5;
   if(ratio+.01<minimum)contrast.push({...identify(node),ratio:+ratio.toFixed(2),minimum,color:style.color,background:bg.slice(0,3).map(Math.round),size,weight:style.fontWeight});
  }
  const coarse=matchMedia('(pointer:coarse)').matches,floor=coarse?44:24;
  for(const node of document.querySelectorAll('button,a[href],summary,input:not([type=hidden]),select,textarea,[role=button]')){
   if(!shown(node)||node.closest(':disabled,[aria-disabled=true]'))continue;
   const name=label(node);let r=node.getBoundingClientRect();if(!name)names.push(identify(node));
   // A native checkbox's enclosing label is also its actual hit region.
   for(const target of node.labels||[]){const box=target.getBoundingClientRect();if(box.width>=r.width&&box.height>=r.height)r=box;}
   if(r.width+.1<floor||r.height+.1<floor)targets.push({...identify(node),name,width:+r.width.toFixed(1),height:+r.height.toFixed(1),minimum:floor});
  }
  const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(n=>n.checkVisibility()).map(node=>({name:label(node),role:node.getAttribute('role'),inert:Boolean(node.closest('[inert],[aria-hidden=true]'))}));
  return {coarse,textCount,contrast,unmeasuredBackgrounds:unmeasured.length,unmeasuredSamples:unmeasured.slice(0,5),missingNames:names,smallTargets:targets,dialogs};
 });
}
