import {assertDesignRules} from './design-rules.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const {adaptation,palette}=JSON.parse(await readFile(new URL('../design/reference.json',import.meta.url),'utf8'));
export const desktopDialogScale=large=>({size:(large?adaptation.largeBody:adaptation.body)+'px',line:(large?adaptation.largeBody*adaptation.lineRatio:adaptation.line)+'px',heading:adaptation.heading+'px',headingLine:adaptation.headingLine+'px'});

export async function assertDialogChrome(dialog) {
  await assertDialogIdentity(dialog);
  const facts=await dialog.evaluate(root=>{
    const parts=['header','body','footer'].map(name=>root.querySelector(':scope > .cx-panel-'+name)).filter(Boolean);
    const close=root.querySelector('.cx-panel-header-actions [data-action=close]');
    const title=root.querySelector('.cx-panel-header h2');
    const header=parts.find(node=>node.classList.contains('cx-panel-header'));
    const body=parts.find(node=>node.classList.contains('cx-panel-body'));
    const footer=parts.find(node=>node.classList.contains('cx-panel-footer'));
    const fullModal=!root.classList.contains('nubi-anchored-dialog')&&header?.checkVisibility();
    const textStart=node=>{
      if(!node)return null;
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text;
      while(text=walker.nextNode())if(text.textContent.trim()&&!text.parentElement.closest('svg,[aria-hidden="true"],.nubi-panel-title-icon')){
        const range=document.createRange();range.selectNodeContents(text);const rect=[...range.getClientRects()].find(box=>box.width>0);if(rect)return rect.left;
      }
      return null;
    };
    const textAxis=fullModal?{title:textStart(title),body:body.getBoundingClientRect().left+parseFloat(getComputedStyle(body).paddingLeft)}:null;
    if(textAxis){
      const rows=[...body.querySelectorAll('.nubi-settings-section>legend,.nubi-mail-filter-form>section h3,.nubi-mail-section-title,.nubi-mail-collection-location>div,.nubi-account-info dt,.nubi-account-settings>summary,.nubi-mail-model-value,.deck-disclosure>summary,.nubi-custom-skill-note,.nubi-action-head h3')];
      const field=body.querySelector('.deck-field-label');if(field)rows.push(field);
      textAxis.rows=rows.filter(node=>node.checkVisibility()).map(node=>({kind:node.className||node.tagName,text:node.textContent.trim().slice(0,50),left:textStart(node)}));
      textAxis.targets=[...body.querySelectorAll('.nubi-settings-row,.deck-disclosure>summary,.nubi-account-settings>summary,.nubi-mail-model-disclosure>summary,.deck-field-label')].filter(node=>node.checkVisibility()).flatMap(node=>{
        const icon=node.querySelector('.nubi-settings-row-icon,svg,img');if(!icon?.checkVisibility())return [];
        const target=node.getBoundingClientRect(),glyph=icon.getBoundingClientRect();return [{kind:node.className||node.tagName,left:target.left,right:target.right,iconLeft:glyph.left,iconRight:glyph.right}];
      });
    }
    const iconRail=textAxis?.title==null?0:textAxis.title-header.getBoundingClientRect().left-parseFloat(getComputedStyle(header).paddingLeft);
    return {geometry:fullModal?{
      gutter:parseFloat(getComputedStyle(header).paddingLeft),
      closeInset:close?.checkVisibility()?{top:close.getBoundingClientRect().top-root.getBoundingClientRect().top,right:root.getBoundingClientRect().right-close.getBoundingClientRect().right}:null,
      narrow:innerWidth<=600,
      textRail:iconRail,
      top:parseFloat(getComputedStyle(header).paddingTop),
      bottom:parseFloat(getComputedStyle(footer||body).paddingBottom),
      footerTop:footer?parseFloat(getComputedStyle(footer).paddingTop):0,
      contextOffsets:root.classList.contains('context-dialog')?[...body.children].map(node=>parseFloat(getComputedStyle(node).marginInlineStart)):[]
    }:null,textAxis,insets:parts.map(node=>[parseFloat(getComputedStyle(node).paddingLeft)-(fullModal&&!node.classList.contains('cx-panel-header')?iconRail:0),parseFloat(getComputedStyle(node).paddingRight)]),
      titleWeight:getComputedStyle(title).fontWeight,
      radius:getComputedStyle(root).borderRadius,
      bottomSheet:document.documentElement.hasAttribute('data-modal-motion')&&matchMedia('(max-width:760px)').matches&&root.parentElement?.matches('.cx-panel-backdrop.is-modal'),
      close:close?.checkVisibility()?{width:close.getBoundingClientRect().width,height:close.getBoundingClientRect().height,radius:getComputedStyle(close).borderRadius}:null,
      sectionGap:getComputedStyle(root.querySelector(':scope > .cx-panel-body')).rowGap,leadingGlyph:(()=>{const glyph=root.querySelector('.cx-panel-header .nubi-panel-title>:is(.nubi-panel-title-icon,svg,img)');if(!glyph?.checkVisibility())return null;const header=root.querySelector('.cx-panel-header'),box=glyph.getBoundingClientRect(),bounds=header.getBoundingClientRect();return {left:box.left,min:bounds.left+parseFloat(getComputedStyle(header).paddingLeft)};})()};
  });
  assert(new Set(facts.insets.flat()).size===1,'Dialog sections share the outer gutter around the reserved icon column');
  if(facts.textAxis?.title!=null)assert(Math.abs(facts.textAxis.title-facts.textAxis.body)<1,'Modal title and body share one text start: '+JSON.stringify(facts.textAxis));
  if(facts.textAxis)for(const row of facts.textAxis.rows)assert(row.left==null||Math.abs(row.left-facts.textAxis.body)<1,'Modal section shares the title text start: '+JSON.stringify(row));
  if(facts.textAxis)for(const row of facts.textAxis.targets)assert(row.iconLeft>=row.left-1&&row.iconRight<=row.right+1,'Leading icon stays inside its click target: '+JSON.stringify(row));
  if(facts.geometry){
    const g=facts.geometry,expected=g.narrow?adaptation.modal.narrowInset:adaptation.modal.inset;
    assert(Math.abs(g.textRail-adaptation.modal.textRail)<1,'Modal text uses the shared icon column and gap');
    assert.equal(g.gutter,expected,'Modal uses the shared responsive gutter');
    assert.equal(g.top,g.gutter,'Top and side outer insets match');
    if(g.closeInset){assert(Math.abs(g.closeInset.top-g.gutter)<1,'Close button uses common top inset: '+JSON.stringify(g.closeInset));assert(Math.abs(g.closeInset.right-g.gutter)<1,'Close button uses common right inset: '+JSON.stringify(g.closeInset));}
    assert.equal(g.bottom,g.gutter,'Bottom and side outer insets match');
    assert.equal(g.footerTop,0,'Body owns the action gap; footer must not double it');
    assert(g.contextOffsets.every(value=>value===0),'Context body has no extra horizontal indent');
  }
  assert.equal(facts.titleWeight,String(adaptation.modal.titleWeight));
  assert.equal(facts.radius,facts.bottomSheet?`${adaptation.modal.radius}px ${adaptation.modal.radius}px 0px 0px`:adaptation.modal.radius+'px');
  assert.equal(facts.sectionGap,adaptation.modal.sectionGap+'px');if(facts.leadingGlyph)assert(facts.leadingGlyph.left>=facts.leadingGlyph.min-1,'Title icons stay inside the shared gutter');
  if(facts.close){assert.equal(facts.close.width,facts.close.height,'Close target must be square');assert(facts.close.width>=adaptation.workControl.height);assert.equal(facts.close.radius,adaptation.workControl.radius+'px');}
  return facts;
}

export async function assertDesktopDialog(dialog,{large=false}={}) {
  await dialog.waitFor();
  await assertDialogIdentity(dialog);
  const facts=await dialog.evaluate(root=>{
    const css=getComputedStyle(root),title=getComputedStyle(root.querySelector('h2'));
    const buttons=[...root.querySelectorAll('button')].filter(e=>e.checkVisibility());
    return {font:css.fontFamily,size:css.fontSize,line:css.lineHeight,radius:css.borderRadius,
      danger:root.matches('.nubi-delete-conversation,.nubi-delete-skill,.nubi-danger-confirmation'),dangerToken:css.getPropertyValue('--deck-red').trim(),title:{size:title.fontSize,line:title.lineHeight},blue:css.getPropertyValue('--brand-action').trim(),
      buttons:buttons.map(e=>({size:getComputedStyle(e).fontSize,radius:getComputedStyle(e).borderRadius,kit:e.classList.contains('cx-kit-button'),chip:e.classList.contains('nubi-page-chip'),label:e.getAttribute('aria-label')||e.textContent.trim(),iconOnly:e.dataset.iconOnly,title:e.title})),
      fields:[...root.querySelectorAll('.nubi-url-pair label,.nubi-db-fields label,.nubi-map-controls label,.nubi-db-tls,.nubi-recovery-option,.nubi-run-form small')].filter(e=>e.checkVisibility()).map(e=>({size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight})),
      overflow:root.scrollWidth>root.clientWidth};
  });
  const {size,line,heading,headingLine}=desktopDialogScale(large);
  assert(facts.font.includes('Noto Sans KR'));assert.equal(facts.size,size);assert.equal(facts.line,line);assert.equal(facts.radius,adaptation.modal.radius+'px');
  assert.deepEqual(facts.title,{size:heading,line:headingLine});assert((facts.danger?[facts.dangerToken]:[palette.blue,palette['blue-deep']]).map(value=>value.toLowerCase()).includes(facts.blue.toLowerCase()),'Actions use the semantic token for the dialog purpose');
  assert.equal(facts.overflow,false);assert(facts.buttons.every(b=>b.label&&b.size===size));
  assert(facts.fields.every(field=>field.size===size&&field.line===line),'Dialog labels and instructions must track the body scale: '+JSON.stringify(facts.fields));
  assert(facts.buttons.filter(b=>b.kit&&!b.chip).every(b=>b.radius===adaptation.workControl.radius+'px'));
  assert(facts.buttons.filter(b=>b.chip).every(b=>b.radius==='100px'),'Page chips use the reference pill radius');
  assert(facts.buttons.filter(b=>b.iconOnly).every(b=>b.title));
}

// All application-owned modal chrome and field labels share semantic tokens.
// Rich mail/document content and provider artwork retain their source styling.
export async function assertDialogIdentity(dialog) {
 await assertDesignRules(dialog.page());
 const facts=await dialog.evaluate(root=>{
  const css=getComputedStyle(root),probe=document.createElement('span');root.append(probe);
  const color=name=>{probe.style.color=`var(${name})`;return getComputedStyle(probe).color;};
  const tokens={primary:color('--nubi-text-primary'),surface:color('--nubi-surface-dialog'),danger:color('--nubi-text-danger'),action:color('--nubi-text-action'),label:css.getPropertyValue('--nubi-weight-label').trim(),emphasis:css.getPropertyValue('--nubi-weight-emphasis').trim()};probe.remove();
  const visible=selector=>[...root.querySelectorAll(selector)].filter(e=>e.checkVisibility());
  return {name:root.querySelector('h2')?.textContent,tokens,background:css.backgroundColor,color:css.color,title:getComputedStyle(root.querySelector('h2')).color,
   labels:visible('label[for]').map(e=>({text:e.textContent.trim().slice(0,40),color:getComputedStyle(e).color,weight:getComputedStyle(e).fontWeight})),
   errors:visible('p[role="alert"]:not([class])').map(e=>getComputedStyle(e).color),
   links:visible(':scope > .cx-panel-body > p > a,:scope > .cx-panel-body > form > p > a').filter(e=>!e.className).map(e=>getComputedStyle(e).color)};
 });
 assert.equal(facts.background,facts.tokens.surface,facts.name+' modal surface');assert.equal(facts.color,facts.tokens.primary,facts.name+' body ink');assert.equal(facts.title,facts.tokens.primary,facts.name+' title ink');
 for(const label of facts.labels){assert.equal(label.weight,facts.tokens.label,facts.name+' label weight: '+label.text);assert.equal(label.color,facts.tokens.primary,facts.name+' label ink: '+label.text);}
 for(const color of facts.errors)assert.equal(color,facts.tokens.danger,facts.name+' error ink');
 for(const color of facts.links)assert.equal(color,facts.tokens.action,facts.name+' link ink');
 return facts;
}
