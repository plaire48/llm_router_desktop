import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {fail} from './contracts.js';
const record=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const invalid=():never=>fail('file_operation_invalid');
/** A small declarative HTML subset for the existing Word HTML importer. No fetching or executable markup. */
export function assertDraftHtml(input:unknown){
 if(typeof input!=='string'||input.length>60000||/<!|<\?|[\x00-\x08]/.test(input))invalid();
 const xml='<root>'+(input as string).replace(/<br\s*>/gi,'<br/>')+'</root>';if(XMLValidator.validate(xml)!==true)invalid();
 const tags=new Set(['root','p','div','span','b','strong','i','em','u','s','sub','sup','br','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','ul','ol','li']);
 const styles=new Set(['color','background-color','font-family','font-size','font-weight','font-style','text-align','text-decoration','line-height','margin-top','margin-bottom','padding','border','border-collapse','width','height']);
 const walk=(node:any)=>{if(Array.isArray(node)){node.forEach(walk);return;}if(!record(node))return;for(const [key,value]of Object.entries(node)){
  if(key==='#text')continue;
  if(key.startsWith('@_')){const attr=key.slice(2);if(attr==='style'){if(typeof value!=='string'||/[\\{}<>@]|url\s*\(|expression\s*\(/i.test(value))invalid();for(const declaration of value.split(';').filter(Boolean)){const at=declaration.indexOf(':');if(at<1||!styles.has(declaration.slice(0,at).trim().toLowerCase()))invalid();}}
   else if(!['colspan','rowspan','start','type'].includes(attr)||!/^[a-zA-Z0-9 -]{1,16}$/.test(String(value)))invalid();
  }else {if(!tags.has(key.toLowerCase()))invalid();walk(value);}
 }};walk(new XMLParser({ignoreAttributes:false,parseAttributeValue:false,parseTagValue:false}).parse(xml));
}
export function boundedAddress(value:unknown){
 const m=/^\$?([A-T])\$?([1-9]\d{0,2})$/.exec(String(value));if(!m||Number(m[2])>400)invalid();return{col:m![1]!.charCodeAt(0)-64,row:Number(m![2])};
}
export function boundedRange(value:unknown){const pieces=String(value).split(':');if(pieces.length>2)invalid();const first=boundedAddress(pieces[0]),last=boundedAddress(pieces[1]??pieces[0]);if(last.row<first.row||last.col<first.col)invalid();return{first,last};}
export function assertExcelOperationBounds(op:Record<string,any>){
 for(const key of ['address','start','anchorCell','targetCell'])if(op[key]!==undefined)boundedAddress(op[key]);
 for(const key of ['range','source','dataRange','sourceRange','printArea'])if(op[key]!==undefined&&typeof op[key]==='string')boundedRange(op[key]);
 if(['copy_range','fill_range'].includes(op.op))boundedRange(op.target);
 if(op.op==='set_range'){
  if(!Array.isArray(op.values)||!op.values.length||op.values.some((r:any)=>!Array.isArray(r)||!r.length))invalid();
  const anchor=op.start??String(op.range??'').split(':')[0],first=boundedAddress(anchor),width=Math.max(...op.values.map((r:any[])=>r.length));
  if(first.row+op.values.length-1>400||first.col+width-1>20)invalid();
 }
 for(const key of ['row','rows'])if(op[key]!==undefined&&(!Number.isInteger(op[key])||op[key]<0||op[key]>400))invalid();
 for(const key of ['column','columns'])if(op[key]!==undefined){if(typeof op[key]==='number'){if(!Number.isInteger(op[key])||op[key]<0||op[key]>20)invalid();}else if(!/^[A-T]$/.test(op[key]))invalid();}
 if(op.count!==undefined&&(!Number.isInteger(op.count)||op.count<1||op.count>(['insert_cols','delete_cols'].includes(op.op)?20:400)))invalid();
 if(op.op==='set_hyperlink'&&op.target!==null&&(typeof op.target!=='string'||!/^#(?:'[^'[\]]+'|[\p{L}\p{N}_ ]+)!\$?[A-T]\$?[1-9]\d{0,2}$/u.test(op.target)))fail('file_operation_host_link_required');
 if(op.op==='edit_chart'&&(typeof op.chartPath!=='string'||!/^xl\/charts\/chart\d+\.xml$/.test(op.chartPath)))invalid();
}
