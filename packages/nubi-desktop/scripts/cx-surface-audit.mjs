// Evidence collector for design QA. Findings require contextual review; this
// does not turn a rendered fixture into an iOS/assistive-technology certification.
export async function auditCxSurface(page,{scope='page',contrastMode='wcag'}={}){
 return page.evaluate(({scope,contrastMode})=>{
  const excluded='svg,.monaco-editor,.xterm,[aria-hidden=true],.visually-hidden,.nubi-logo,.nubi-word-paper,.nubi-ppt-canvas,.nubi-excel-grid-scroll,.talk-rich-content';
  const shown=node=>node.checkVisibility()&&!node.closest(excluded+', [inert]');
  const root=scope==='active'?[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(shown).at(-1)||document.body:document.body;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true}),cache=new Map();
  const color=value=>{if(cache.has(value))return cache.get(value);ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const p=[...ctx.getImageData(0,0,1,1).data];p[3]/=255;cache.set(value,p);return p;};
  const blend=(front,back)=>{const a=front[3]+back[3]*(1-front[3]);return [0,1,2].map(i=>(front[i]*front[3]+back[i]*back[3]*(1-front[3]))/(a||1)).concat(a);};
  const luminance=p=>p.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  // Conservative channel bounds cover every stop and interpolation of a
  // legacy opaque sRGB linear gradient. Unsupported images/color spaces are
  // explicitly unmeasured, never treated as white.
  const gradientBounds=value=>{
   if(!/^linear-gradient\((?:[\d.]+deg|to (?:left|right|top|bottom)(?: (?:left|right|top|bottom))?),/.test(value))return null;
   const stops=[...value.matchAll(/rgba?\([^)]+\)/g)].map(m=>color(m[0]));
   const rest=value.replace(/^linear-gradient\([^,]+,/,'').slice(0,-1).replace(/rgba?\([^)]+\)/g,'');
   if(stops.length<2||stops.some(p=>p[3]!==1)||/[^\s,.\d%+-]/.test(rest))return null;
   return [Math.min,Math.max].map(bound=>[0,1,2].map(i=>bound(...stops.map(p=>p[i]))).concat(1));
  };
  const label=node=>(node.getAttribute('aria-label')?.trim()||[...(node.getAttribute('aria-labelledby')||'').split(/\s+/)].map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||[...(node.labels||[])].map(n=>n.textContent).join(' ').trim()||node.getAttribute('title')?.trim()||[...node.childNodes].map(n=>n.nodeType===Node.TEXT_NODE?n.textContent:n.nodeType===Node.ELEMENT_NODE&&!n.matches('[aria-hidden=true]')?(n.tagName==='IMG'?n.getAttribute('alt')||'':n.textContent):'').join(' ').trim()).slice(0,100);
  const selector=node=>{const parts=[];for(let n=node;n&&n!==document.body;n=n.parentElement){parts.unshift(n.tagName.toLowerCase()+[...n.classList].map(c=>'.'+CSS.escape(c)).join('')+':nth-child('+([...n.parentElement.children].indexOf(n)+1)+')');if(n===root)break;}return parts.join(' > ');};
  const identify=node=>({tag:node.tagName,class:typeof node.className==='string'?node.className:'',text:node.textContent.trim().slice(0,70),selector:selector(node)});
  const contrast=[],unmeasured=[],names=[],targets=[];let textCount=0;
  const mutedToken=getComputedStyle(root).getPropertyValue('--nubi-text-muted').trim();const mutedProbe=document.createElement('i');mutedProbe.style.color='var(--nubi-text-muted)';root.append(mutedProbe);const mutedColor=getComputedStyle(mutedProbe).color;mutedProbe.remove();
  for(const node of root.querySelectorAll('*')){
   if(!shown(node)||!node.checkVisibility({opacityProperty:true})||![...node.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))continue;
   if(node.closest(':disabled,[aria-disabled=true]'))continue;
   const style=getComputedStyle(node);if(Number(style.opacity)===0)continue;textCount++;
   let bg=[0,0,0,0],unknown=null,bounds=null;
   for(let parent=node;parent;parent=parent.parentElement){
    const ps=getComputedStyle(parent);
    if(Number(ps.opacity)<1){unknown={ancestor:identify(parent),backgroundImage:ps.backgroundImage,opacity:ps.opacity};break;}
    if(ps.backgroundImage!=='none'){
     const gradient=contrastMode==='g5'?gradientBounds(ps.backgroundImage):null;
     if(gradient){bounds=gradient.map(stop=>blend(bg,stop));break;}
     unknown={ancestor:identify(parent),backgroundImage:ps.backgroundImage,opacity:ps.opacity};break;
    }
    bg=blend(bg,color(ps.backgroundColor));if(bg[3]>=.999)break;
   }
   if(unknown){unmeasured.push({...identify(node),cause:unknown});continue;}
   bg=blend(bg,[255,255,255,1]);bounds??=[bg,bg];
   const background=bounds.map(luminance),foreground=bounds.map(b=>luminance(blend(color(style.color),b)));
   const ratio=foreground[0]>=background[1]?(foreground[0]+.05)/(background[1]+.05):background[0]>=foreground[1]?(background[0]+.05)/(foreground[1]+.05):1;
   const size=parseFloat(style.fontSize),minimum=contrastMode==='g5'?(mutedToken&&style.color===mutedColor?3:4.5):(size>=24||size>=18.667&&Number(style.fontWeight)>=700?3:4.5);
   if(ratio+(contrastMode==='g5'?0:.01)<minimum)contrast.push({...identify(node),ratio:+ratio.toFixed(2),minimum,color:style.color,background:bg.slice(0,3).map(Math.round),size,weight:style.fontWeight});
  }
  const coarse=matchMedia('(pointer:coarse)').matches,floor=coarse?44:24;
  for(const node of root.querySelectorAll('button,a,summary,input:not([type=hidden]),select,textarea,[role=button]')){
   if(!shown(node))continue;
   const disabled=node.closest(':disabled,[aria-disabled=true]');if(disabled&&contrastMode!=='g5')continue;
   const name=label(node);let r=node.getBoundingClientRect();if(!name)names.push(identify(node));if(disabled)continue;
   // A native checkbox's enclosing label is also its actual hit region.
   for(const target of node.labels||[]){const box=target.getBoundingClientRect();if(box.width>=r.width&&box.height>=r.height)r=box;}
   if(r.width+.1<floor||r.height+.1<floor)targets.push({...identify(node),name,width:+r.width.toFixed(1),height:+r.height.toFixed(1),minimum:floor});
  }
  const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(n=>n.checkVisibility()).map(node=>({name:label(node),role:node.getAttribute('role'),inert:Boolean(node.closest('[inert],[aria-hidden=true]'))}));
  return {coarse,textCount,contrast,unmeasuredBackgrounds:unmeasured.length,unmeasuredSamples:unmeasured.slice(0,5),unmeasured,missingNames:names,smallTargets:targets,dialogs};
 },{scope,contrastMode});
}
