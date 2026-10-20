import {DocumentAgentError,fail} from './contracts.js';
import registry from './excel-function-registry.json';
type Shape={name:string;rows:unknown[][]};
type Area={name:string;row:number;col:number;endRow:number;endCol:number;whole?:boolean};
type Value={area?:Area;literal?:string|number|boolean};
const functions=new Set(registry.office2016Candidates),hostFunctions=new Set(registry.requiresHostCapabilities);
/** Recognized identifiers, NOT a claim that each function has calculated successfully. */
export const supportedFormulaFunctions=Object.freeze(registry.office2016Candidates.filter(name=>!hostFunctions.has(name)));
export const formulaFunctionCatalog=Object.freeze({...registry,claim:'Identifier and introduction-version inventory; calculation and native Office verification are separate'});
export const formulaMaxLength=8192;
// Retain known signatures; the injected calculator verifies other function signatures.
const arities:Record<string,[number,number]>={SUM:[1,255],AND:[1,255],OR:[1,255],NOT:[1,1],IF:[2,3],COUNTIF:[2,2],COUNTIFS:[2,254],SUMIF:[2,3],SUMIFS:[3,255],ROUND:[2,2],IFERROR:[2,2],VLOOKUP:[3,4],INDEX:[2,4],MATCH:[2,3],DATE:[3,3],TEXT:[2,2],PI:[0,0],NA:[0,0],INDIRECT:[1,2],OFFSET:[3,5]};
class FormulaValidationError extends DocumentAgentError {constructor(readonly detail:string){super('excel_formula_invalid');}}
export const formulaErrorDetail=(error:unknown):string=>error instanceof FormulaValidationError?error.detail:'';
/** Analyze bounded new-draft references. Writing and calculation stay with existing engines. */
export function formulaReferences(formula:string,current:string,sheets:Shape[],options:{referenceScope?:'observed'|'worksheet';onReference?:(area:Area)=>void}={}):string[] {
 const bad=(detail='Invalid Excel formula syntax.'):never=>{throw new FormulaValidationError(detail);};
 const worksheet=options.referenceScope==='worksheet';
 if(typeof formula!=='string'||!formula.length||formula.length>formulaMaxLength)bad();
 formula=formula.replace(/^=/,'');
 const lexer=/(?:(?:'(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_. ]*)!)?(?:\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9]\d*:\$?[1-9]\d*)|"(?:[^"]|"")*"|'(?:[^']|'')+'!\$?[A-Za-z]{1,3}\$?[1-9]\d*|[\p{L}_][\p{L}\p{N}_. ]*!\$?[A-Za-z]{1,3}\$?[1-9]\d*|(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?|\$?[A-Za-z]{1,3}\$?[1-9]\d*(?![\p{L}\p{N}_.])|[\p{L}_][\p{L}\p{N}_.]*|#(?:N\/A|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|NULL!)|<>|<=|>=|[+*/(),;:{}^%=<>&-]|\s+/guy;
 const tokens:string[]=[];let consumed=0;
 for(let match;(match=lexer.exec(formula));){consumed=lexer.lastIndex;if(!/^\s+$/.test(match[0]))tokens.push(match[0]);}
 if(consumed!==formula.length)bad();
 let at=0,depth=0;const refs=new Set<string>();
 const column=(letters:string)=>{let n=0;for(const c of letters.toUpperCase())n=n*26+c.charCodeAt(0)-64;return n;};
 const add=(area:Area)=>{
  const sheet=sheets.find(s=>s.name.toLowerCase()===area.name.toLowerCase());
  if(!sheet)bad('Reference must name a sheet in this authorized draft.');
  if(area.row<1||area.col<1||area.endRow<area.row||area.endCol<area.col||area.endRow>1048576||area.endCol>16384)bad('Reference exceeds the Excel worksheet grid or reverses its range.');
  if(!worksheet&&(area.whole||area.endRow>sheet!.rows.length))bad('Reference exceeds the observed range.');
  // Blank worksheet cells keep their Excel semantics in the serialized formula.
  // Dependencies visit only allocated cells, never a million empty rows.
  for(let r=area.row;r<=Math.min(area.endRow,sheet!.rows.length);r++){
   if(!worksheet&&area.endCol>sheet!.rows[r-1]!.length)bad('Reference exceeds the observed range.');
   for(let c=area.col;c<=Math.min(area.endCol,sheet!.rows[r-1]!.length);c++)refs.add(`${sheet!.name}!${c}:${r}`);
  }
  area.name=sheet!.name;options.onReference?.({...area});return area;
 };
 const reference=(token:string,defaultSheet=current):Area|undefined=>{
  const range=/^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?(?:\$?([A-Z]{1,3}):\$?([A-Z]{1,3})|\$?([1-9]\d*):\$?([1-9]\d*))$/i.exec(token);
  if(range)return add({name:range[1]?.replaceAll("''","'")??range[2]??defaultSheet,row:range[5]?Number(range[5]):1,endRow:range[6]?Number(range[6]):1048576,col:range[3]?column(range[3]):1,endCol:range[4]?column(range[4]):16384,whole:true});
  const m=/^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(token);if(!m)return;
  return add({name:m[1]?.replaceAll("''","'")??m[2]??defaultSheet,col:column(m[3]!),row:Number(m[4]),endCol:column(m[3]!),endRow:Number(m[4])});
 };
 const take=(token:string)=>{if(tokens[at++]!==token)bad();};
 function atom():Value {
  if(++depth>128)bad();const token=tokens[at++];if(!token)bad();let value:Value={};
  if(token==='+'||token==='-'){value=atom();value=typeof value.literal==='number'?{literal:token==='-'?-value.literal:value.literal}:{};}
  else if(token==='('){value=expression();take(')');}
  else if(token==='{'){
   let width:number|undefined,count=0;
   for(;;){const item=expression();if(item.area||item.literal===undefined)bad();count++;
    if(tokens[at]===','){at++;continue;}if(width!==undefined&&width!==count)bad();width=count;count=0;
    if(tokens[at]===';'){at++;continue;}take('}');break;
   }
  }else if(tokens[at]==='('){
   const name=token.toUpperCase().replace(/^(?:_XLFN\.|_XLWS\.)+/,'');
   if(!functions.has(name))bad(`Function ${name.slice(0,80)} is not in the Office 2016 function inventory. Use an Office 2016 equivalent; dynamic-array spill syntax is unavailable.`);if(hostFunctions.has(name))fail('excel_formula_host_capability_required');
   take('(');const args:Value[]=[];
   if(tokens[at]!==')')for(;;){args.push([',',')'].includes(tokens[at]??'')?{}:expression());if(tokens[at]!==',')break;at++;}
   take(')');if(args.length>255)bad();
   const arity=arities[name];if(arity&&(args.length<arity[0]||args.length>arity[1])||name==='COUNTIFS'&&args.length%2!==0||name==='SUMIFS'&&args.length%2!==1)bad();
   if(name==='INDIRECT'){
    if(typeof args[0]?.literal!=='string'||args[1]&&args[1].literal!==true)fail('excel_formula_dynamic_reference_requires_host');
    const text=args[0]!.literal as string,direct=reference(text);
    if(direct)value={area:direct};else{const parts=text.split(':');if(parts.length>2)bad();const first=reference(parts[0]!);if(!first)bad();const last=parts.length===2?reference(parts[1]!,first!.name):first;if(!last||last.name!==first!.name)bad();value={area:add({...first!,endRow:last!.endRow,endCol:last!.endCol})};}
   }else if(name==='OFFSET'){
    const base=args[0]?.area,numbers=args.slice(1).map(a=>a.literal);
    if(!base||!numbers.every(n=>typeof n==='number'&&Number.isInteger(n)))fail('excel_formula_dynamic_reference_requires_host');
    const [r,c,h=base!.endRow-base!.row+1,w=base!.endCol-base!.col+1]=numbers as number[];
    value={area:add({name:base!.name,row:base!.row+r!,col:base!.col+c!,endRow:base!.row+r!+h!-1,endCol:base!.col+c!+w!-1})};
   }
  }else if(!token.startsWith('\"')&&token.includes(':')){const area=reference(token);if(!area)bad();value={area};}
  else if(/^\d|^\.\d/.test(token))value={literal:Number(token)};
  else if(token.startsWith('"'))value={literal:token.slice(1,-1).replaceAll('""','"')};
  else if(['TRUE','FALSE'].includes(token.toUpperCase()))value={literal:token.toUpperCase()==='TRUE'};
  else if(token.startsWith('#'))value={};
  else {const area=reference(token);if(!area)bad();value={area};}
  if(tokens[at]===':'){at++;if(!value.area||value.area.whole)bad();const last=reference(tokens[at++]??'',value.area!.name);if(!last||last.name!==value.area!.name)bad();value={area:add({...value.area!,endRow:last!.endRow,endCol:last!.endCol})};}
  while(tokens[at]==='%'){at++;value=typeof value.literal==='number'?{literal:value.literal/100}:{};}
  depth--;return value;
 }
 function power():Value {let v=atom();while(tokens[at]==='^'){at++;atom();v={};}return v;}
 function product():Value {let v=power();while(['*','/'].includes(tokens[at]??'')){at++;power();v={};}return v;}
 function sum():Value {let v=product();while(['+','-'].includes(tokens[at]??'')){at++;product();v={};}return v;}
 function concat():Value {let v=sum();while(tokens[at]==='&'){at++;const right=sum();v=v.literal!==undefined&&right.literal!==undefined?{literal:String(v.literal)+String(right.literal)}:{};}return v;}
 function expression():Value {let v=concat();while(['=','<>','<','>','<=','>='].includes(tokens[at]??'')){at++;concat();v={};}return v;}
 expression();if(at!==tokens.length)bad();return [...refs];
}
export function assertAcyclic(graph:Map<string,string[]>) {
 const done=new Set<string>(),active=new Set<string>();
 const visit=(key:string,depth:number)=>{if(active.has(key)||depth>128)fail('excel_formula_invalid');if(done.has(key))return;active.add(key);for(const next of graph.get(key)??[])visit(next,depth+1);active.delete(key);done.add(key);};
 for(const key of graph.keys())visit(key,0);
}
