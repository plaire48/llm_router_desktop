import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const reference=JSON.parse(await readFile('design/reference.json','utf8'));
const deck=await readFile('../../extensions/aipro-chat/design/agent-deck.css','utf8');
const identity=await readFile('design/workspace-identity.css','utf8');
const brand=await readFile('design/brand/nubi-brand.css','utf8');
// The original HTML provenance stays intact. Explicit user-approved Desktop
// adaptations may override its palette through the shared identity aliases.
const definitions=new Map([...deck.matchAll(/(--[\w-]+):\s*([^;{}]+);/g),...brand.matchAll(/(--[\w-]+):\s*([^;{}]+);/g),...identity.matchAll(/(--[\w-]+):\s*([^;{}]+);/g)].map(match=>[match[1],match[2].trim()]));
function resolve(value,seen=new Set()){
 const alias=/^var\((--[\w-]+)\)$/.exec(value);
 if(!alias)return value;
 assert(!seen.has(alias[1]),`Cyclic identity token: ${alias[1]}`);
 assert(definitions.has(alias[1]),`Missing identity token: ${alias[1]}`);
 return resolve(definitions.get(alias[1]),new Set([...seen,alias[1]]));
}
for(const [name,value]of Object.entries({...reference.palette,...reference.adaptation?.theme?.palette})) {
  if(['muted','dark'].includes(name))continue; // Not normal text tokens in the accessible app palette.
  // Desktop's identity layer loads after the shared deck and may restore an HTML value, globally or inside one
  // component's scope. Every definition the identity layer makes must hold the HTML value; the deck is the source when
  // the identity layer makes none.
  const defined=[...identity.matchAll(new RegExp(`--deck-${name}:\\s*([^;]+);`,'g'))].map(match=>match[1].trim());
  const deckValue=deck.match(new RegExp(`--deck-${name}:\\s*([^;]+);`))?.[1].trim();
  assert(defined.every(found=>resolve(found)===value)&&(defined.length>0||deckValue===value),`Approved palette changed: ${name} (deck ${deckValue}, identity ${defined.join(', ')||'none'})`);
}
// Brand derivatives must follow the canonical palette and role weights.
// Compare the expanded colour values, not literal duplication of the palette.
function expandBrand(value,seen=new Set()){
 return value.replace(/var\((--[\w-]+)\)/g,(_,name)=>{
  assert(definitions.has(name)&&!seen.has(name),'Missing/cyclic brand token: '+name);
  return expandBrand(definitions.get(name),new Set([...seen,name]));
 });
}
function brandValue(name){
 return expandBrand(definitions.get(name)).replace(/color-mix\(in srgb,\s*(#[a-f\d]{6})\s+([\d.]+)%,\s*(#[a-f\d]{6})\)/gi,(_,front,percent,back)=>'#'+[1,3,5].map(i=>Math.round(parseInt(front.slice(i,i+2),16)*Number(percent)/100+parseInt(back.slice(i,i+2),16)*(1-Number(percent)/100)).toString(16).padStart(2,'0')).join('')).replace(/\s+/g,'').toLowerCase();
}
for(const [token,field]of [['--nuvi-brand-gradient','gradient'],['--nuvi-brand-gradient-soft','softGradient'],['--nuvi-content-gradient','contentGradient'],['--nuvi-selection-gradient','selectionGradient']])if(reference.adaptation?.theme?.[field])assert.equal(brandValue(token),reference.adaptation.theme[field].replace(/\s+/g,'').toLowerCase(),'Approved brand role changed: '+field);
// Bound all interpolated icon colours conservatively; pale brand hues belong
// to surfaces, not unreadable glyph strokes or body labels.
const rgb=value=>{assert(/^#[a-f\d]{6}$/i.test(value),'Brand ink must resolve to an approved opaque colour');return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16));};
const luminance=channels=>channels.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const foregrounds=['--nuvi-aqua-ink','--nuvi-primary','--nuvi-violet-ink'].map(name=>rgb(resolve(definitions.get(name))));
const backgrounds=['#FFFFFF',...reference.adaptation.theme.softGradient.match(/#[a-f\d]{6}/gi),...reference.adaptation.theme.contentGradient.match(/#[a-f\d]{6}/gi),...reference.adaptation.theme.selectionGradient.match(/#[a-f\d]{6}/gi)].map(rgb);
const lightestInk=[0,1,2].map(i=>Math.max(...foregrounds.map(c=>c[i]))),darkestFill=[0,1,2].map(i=>Math.min(...backgrounds.map(c=>c[i])));
assert((luminance(darkestFill)+.05)/(luminance(lightestInk)+.05)>=3,'Brand icon contrast must remain at least 3:1');
for(const name of ['--nuvi-text','--nuvi-text-secondary'])assert((luminance(darkestFill)+.05)/(luminance(rgb(resolve(definitions.get(name))))+.05)>=4.5,'Brand label contrast must remain at least 4.5:1: '+name);
const css=await readFile('electron-app/workbench.css','utf8');
for(const family of ['Pretendard Variable','Noto Sans KR','Malgun Gothic'])assert(css.includes(family),`Missing local font fallback: ${family}`);
assert(!/--(?:brand-action|brand-ink|cx-button-primary|color-bg-primary):\s*#/.test(css),'Use shared deck aliases rather than per-screen brand overrides');
const uiFiles=await readdir('ui',{recursive:true});
for(const file of uiFiles.filter(file=>file.endsWith('.jsx')&&file!=='Collaboration.jsx')) {
  const source=await readFile('ui/'+file,'utf8');
  const workspacePanel=String(file).replace(/\\/g,'/').startsWith('ai-workspace/')&&/import\s*\{[^}]*\bDetailPanel\b[^}]*\}\s*from\s*['"]\.\.?\/DetailPanel['"]/.test(source);
  // The ported screens use our adapter, which adds deck-dialog centrally to
  // modal/confirmation panels and preserves the separate drawer contract.
  if(!workspacePanel)for(const match of source.matchAll(/<DetailPanel\b[^>]*>/g))assert(/className=(?:"[^"]*\bdeck-dialog\b|\{`[^`$]*\bdeck-dialog\b)/.test(match[0]),`${file}: modal must use deck-dialog`);
  assert(!/style=\{\{[^}]*\b(?:fontSize|fontFamily|color|backgroundColor)\s*:/.test(source),`${file}: typography and brand styling belong in shared tokens`);
}
for(const file of ['electron-app/workbench.css','design/workspace-density.css','design/workspace-dialogs.css','design/workspace-icons.css',...uiFiles.filter(file=>file.endsWith('.css')).map(file=>'ui/'+file)]){
  const source=(await readFile(file,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
  assert(!/(?:^|[;{])\s*font(?:-size)?\s*:[^;{}]*\b\d+(?:\.\d+)?px/.test(source),`${file}: use typography tokens, not fixed screen font sizes`);
  assert(!/(?:^|[;{])\s*(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|box-shadow|filter)\s*:[^;{}]*#[\da-f]{3,8}\b/i.test(source),`${file}: raw colors belong in the identity token layer`);
}
const renderer=await readFile('electron-app/renderer.jsx','utf8');
assert(renderer.startsWith("import '@e2e/cx-design-system/styles.css';"),'CX base CSS must load before feature styles and the final Workspace token layers');
assert(renderer.indexOf('design/workspace-icons.css')>renderer.indexOf('design/workspace-dialogs.css'),'Optical icon scale must load after the shared dialog layer');
assert(renderer.includes('design/workspace-identity.css')&&renderer.includes('./workbench.css'),'the Electron renderer must import the workbench styles and the Desktop identity layer');
const referencePath=process.env.NUBI_DESIGN_REFERENCE;
if(referencePath)assert.equal(createHash('sha256').update(await readFile(referencePath)).digest('hex'),reference.sha256,'Supplied HTML changed; review the reference tokens');
console.log('Desktop identity: approved palette, shared aliases, fonts, portal classes and build inclusion verified.');
