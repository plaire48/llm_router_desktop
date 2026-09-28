import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const shared=new URL('../../../extensions/aipro-chat/',import.meta.url);
export function validateHtmlIdentity(css,reference){
  const tokens=Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(([,key,value])=>[key,value.trim()]));
  const expected={...Object.fromEntries(Object.entries(reference.palette).map(([key,value])=>[`--deck-${key}`,value])),
    '--deck-background':reference.background,'--deck-shadow':reference.cardShadow,
    '--deck-type-body':'14px','--deck-line-body':'22px','--deck-type-heading':'16px','--deck-line-heading':'24px'};
  for(const [key,value] of Object.entries(expected))if(tokens[key]?.toLowerCase()!==value.toLowerCase())throw new Error(`HTML identity drift: ${key}`);
}
export async function checkOfficeSurfaces(){
  const root=new URL('../src/',import.meta.url);
  for(const name of await readdir(root)){
    if(!name.endsWith('.jsx'))continue;
    const source=await readFile(new URL(name,root),'utf8');
    if(/<(?:button|input|select|textarea)\b/.test(source))throw new Error(`${name}: use shared CX controls for Office surfaces`);
    for(const [tag] of source.matchAll(/<DetailPanel\b[^>]*>/g))if(!/className="[^"]*\bdeck-dialog\b/.test(tag))throw new Error(`${name}: modal must use the shared deck-dialog identity`);
  }
  const css=await readFile(new URL('office.css',root),'utf8');
  validateOfficeCss(css);
}
export function validateOfficeCss(css){
  const directType=[...css.matchAll(/(?:^|(?<=[;{]))\s*(?:font|font-size|font-family|line-height)\s*:\s*([^;]+);/g)].some(([,value])=>!/^var\(--[\w-]+\)$/.test(value.trim()));
  if(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i.test(css)||directType)throw new Error('Office CSS must use shared color and type tokens');
}

export async function checkUiParity(){
  const manifest=JSON.parse(await readFile(new URL('../design/shared-ui.json',import.meta.url),'utf8'));
  const reference=JSON.parse(await readFile(new URL('../design/html-reference.json',import.meta.url),'utf8'));
  if(reference.sha256!==manifest.reference.sha256)throw new Error('HTML identity references disagree');
  validateHtmlIdentity(await readFile(new URL('design/agent-deck.css',shared),'utf8'),reference);
  await checkOfficeSurfaces();
  const mismatches=[];
  for(const file of manifest.files){
    try{if(createHash('sha256').update(await readFile(new URL(file.path,shared))).digest('hex')!==file.sha256)mismatches.push(file.path);}
    catch{mismatches.push(file.path);}
  }
  if(mismatches.length)throw new Error(`Shared Nubi UI changed: ${mismatches.join(', ')}. Review and sync the UI snapshot, then refresh design/shared-ui.json; never copy authentication or runtime state.`);
  return {files:manifest.files.length,matched:true,reference:manifest.reference};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await checkUiParity(),null,2));
