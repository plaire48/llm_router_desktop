// Read actual button geometry in the active UI, with authored content excluded.
// Distribution is recorded by action group; deliberate left/right grouping is
// not classified as a defect merely because a group sits at an edge.
export async function auditButtonLayout(page){
 return page.evaluate(()=>{
  const excluded='.message-body,.monaco-editor,.xterm,.talk-rich-content,.nubi-word-paper,.nubi-ppt-canvas,.nubi-excel-grid-scroll';
  const shown=n=>n.checkVisibility({opacityProperty:true})&&!n.closest('[inert],[aria-hidden=true],.visually-hidden,'+excluded);
  const root=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(shown).at(-1)||document.body;
  const groupSelector='.nubi-toolbar-actions,.nubi-header-actions,.nubi-sidebar-actions,.cx-panel-header-actions,.cx-panel-footer,.composer-tools,.composer-leading,.model-picker,.provider-account-actions,.composer-actions,.nubi-composer-footer,.nubi-skill-page-actions,.nubi-start-secondary,.nubi-mail-reader-tools,.nubi-mail-document-toolbar';
  const round=n=>Math.round(n*100)/100,box=n=>{const r=n.getBoundingClientRect();return {x:round(r.x),y:round(r.y),width:round(r.width),height:round(r.height),right:round(r.right),bottom:round(r.bottom)};};
  const label=n=>n.getAttribute('aria-label')||n.textContent.trim().slice(0,60);
  const probe=document.createElement('i');Object.assign(probe.style,{position:'absolute',pointerEvents:'none',height:'0'});root.append(probe);
  const pixels=(node,name)=>{const value=getComputedStyle(node).getPropertyValue(name).trim();if(!value)return NaN;probe.style.width=value;return parseFloat(getComputedStyle(probe).width);};
  const buttons=[],issues=[],observations=[];
  for(const node of root.querySelectorAll('button,.cx-action-button,[role=button]')){
   if(!shown(node))continue;
   const r=box(node),css=getComputedStyle(node);if(r.width<1||r.height<1)continue;
   const role=node.closest('.nubi-workspace-rail')?'navigation':node.closest('.nubi-window-toolbar')?'toolbar':node.closest('.cx-panel-footer')?'modal-footer':node.closest('.cx-panel-header-actions')?'modal-header':node.closest('.composer-bottom,.nubi-composer-footer')?'composer':'content';
   const text=[];const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let item;
   while(item=walker.nextNode()){if(!item.textContent.trim()||!shown(item.parentElement)||item.parentElement.closest('svg'))continue;const range=document.createRange();range.selectNodeContents(item);for(const b of range.getClientRects())if(b.width>1&&b.height>1)text.push({x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height});}
   const glyphs=[...node.querySelectorAll('svg.ui-icon,svg[viewBox="0 0 24 24"],img.provider-icon')].filter(n=>n.checkVisibility()&&!n.closest('.agent-mark,.nubi-logo'));
   const identity={name:label(node),class:node.className,role},data={...identity,box:r,gap:css.gap,padding:[css.paddingTop,css.paddingRight,css.paddingBottom,css.paddingLeft],radius:css.borderRadius,fontWeight:css.fontWeight,glyphs:[]};
   // Full project/model/history cards have their own multi-line content layout.
   const singleLine=new Set(text.map(t=>Math.round(t.y))).size<=1;
   const regular=singleLine&&r.height<=Math.max(64,pixels(node,'--nubi-work-control-height')*1.65)&&!node.matches('.nubi-start-card,.model-option,.nubi-history-item,.nubi-marketplace-card,[role=switch]');
   for(const glyph of glyphs){const disclosure=glyph.dataset.icon?.startsWith('chevron')&&node.matches('button[aria-expanded],button[aria-haspopup],summary,.nubi-settings-row,.nubi-skill-menu-marketplace,.nubi-applied-trigger');
    const g=box(glyph),iconOnly=text.length===0&&glyphs.length===1,provider=!!glyph.closest('[data-provider],.provider-icon,.connection-logo'),expected=pixels(node,disclosure?'--nubi-icon-disclosure':'--nubi-glyph-size');
    const centreY=Math.abs(g.y+g.height/2-r.y-r.height/2),centreX=Math.abs(g.x+g.width/2-r.x-r.width/2);let labelGap=null,textCentre=null;
    if(text.length&&new Set(text.map(t=>Math.round(t.y))).size===1){const left=Math.min(...text.map(t=>t.x)),right=Math.max(...text.map(t=>t.right)),top=Math.min(...text.map(t=>t.y)),bottom=Math.max(...text.map(t=>t.bottom));labelGap=g.right<=left+1?left-g.right:g.x>=right-1?g.x-right:null;textCentre=Math.abs(g.y+g.height/2-(top+bottom)/2);}
    const details={icon:glyph.dataset.icon||'custom',box:g,iconOnly,expected:round(expected),centreX:round(centreX),centreY:round(centreY),labelGap:labelGap===null?null:round(labelGap),textCentre:textCentre===null?null:round(textCentre)};data.glyphs.push(details);
    const add=(rule,extra={})=>issues.push({...identity,rule,icon:details.icon,...extra});
    if(g.x<r.x-1||g.right>r.right+1||g.y<r.y-1||g.bottom>r.bottom+1)add('glyph_outside_target',{button:r,glyph:g});
    if(regular&&centreY>3)add('glyph_vertical_alignment',{delta:round(centreY)});
    if(regular&&iconOnly&&centreX>3)observations.push({...identity,rule:'icon_only_offset',delta:round(centreX)});
    if(regular&&!provider&&Number.isFinite(expected)&&Math.abs(g.width-expected)>.6)add('glyph_token_size',{actual:g.width,expected:round(expected)});
    if(regular&&labelGap!==null&&labelGap<3)observations.push({...identity,rule:'tight_icon_label_gap',gap:round(labelGap)});
   }
   const coarse=matchMedia('(pointer:coarse)').matches,minimum=coarse?44:24;
   if(!node.disabled&&(r.width<minimum-.2||r.height<minimum-.2))issues.push({...identity,rule:'small_target',box:r,minimum});
   buttons.push(data);
  }
  const groups=[];
  for(const group of root.querySelectorAll(groupSelector)){
   if(!shown(group))continue;const nodes=[...group.querySelectorAll('button,[role=button]')].filter(n=>shown(n)&&n.closest(groupSelector)===group);if(!nodes.length)continue;
   const bounds=box(group),items=nodes.map(n=>({name:label(n),box:box(n)})),pairs=[];
   for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i].box,b=items[j].box,x=Math.min(a.right,b.right)-Math.max(a.x,b.x),y=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);if(x>1&&y>1)issues.push({rule:'button_overlap',group:group.className,a:items[i],b:items[j]});if(y>Math.min(a.height,b.height)/2&&x<=1){const gap=Math.max(a.x,b.x)-Math.min(a.right,b.right);pairs.push({a:items[i].name,b:items[j].name,gap:round(gap)});}}
   const sorted=[...items].sort((a,b)=>a.box.x-b.box.x);const distribution={class:group.className,box:bounds,justify:getComputedStyle(group).justifyContent,cssGap:getComputedStyle(group).gap,buttons:items,pairs,rows:new Set(items.map(a=>Math.round(a.box.y+a.box.height/2))).size};
   if(sorted.length)distribution.occupiedWidth=round(sorted.at(-1).box.right-sorted[0].box.x);
   for(const pair of pairs)if(pair.gap<(matchMedia('(pointer:coarse)').matches?8:4)-.2)issues.push({rule:'crowded_action_group',group:group.className,...pair});
   groups.push(distribution);
  }
  probe.remove();return {buttons,groups,issues,observations,coarse:matchMedia('(pointer:coarse)').matches};
 });
}
