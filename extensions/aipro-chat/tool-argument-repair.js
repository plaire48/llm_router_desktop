// Models send tool arguments in shapes that mean the same thing but miss the declared schema: a list written as a
// JSON string, one value where a list is expected, "Edit" for "edit", snake_case names, or a required empty list left
// out (measured with Claude Sonnet 5.5, 2026-10-14). Only these lossless repairs are made, guided by the tool's own
// schema; anything else still reaches validation unchanged and is refused with repair hints.
const typesOf=schema=>Array.isArray(schema?.type)?schema.type:schema?.type?[schema.type]:[];
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fold=value=>String(value).trim().toLowerCase().replace(/[\s-]+/g,'_');
const camel=key=>key.replace(/[_-]+([a-z0-9])/gi,(_,letter)=>letter.toUpperCase());
const snake=key=>key.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();
function matchesType(value,type){
  switch(type){
    case 'string':return typeof value==='string';
    case 'number':return typeof value==='number'&&Number.isFinite(value);
    case 'integer':return Number.isInteger(value);
    case 'boolean':return typeof value==='boolean';
    case 'object':return isObject(value);
    case 'array':return Array.isArray(value);
    case 'null':return value===null;
    default:return true;
  }
}
const matches=(value,schema)=>{const types=typesOf(schema);return types.length?types.some(type=>matchesType(value,type)):!schema?.properties||isObject(value);};
function parseJson(text,want){
  const trimmed=text.trim();
  if(!trimmed.startsWith(want==='array'?'[':'{'))return undefined;
  try{const value=JSON.parse(trimmed);return want==='array'?(Array.isArray(value)?value:undefined):(isObject(value)?value:undefined);}catch{return undefined;}
}
function repairObject(value,schema,depth){
  const properties=schema.properties||{},required=schema.required||[],out={};
  for(const [key,item] of Object.entries(value)){
    let name=key;
    if(!Object.hasOwn(properties,key)){
      const alias=[camel(key),snake(key)].find(candidate=>candidate!==key&&Object.hasOwn(properties,candidate)&&!Object.hasOwn(value,candidate));
      if(alias)name=alias;
    }
    // A null for an optional field means "not given".
    if(item===null&&Object.hasOwn(properties,name)&&!required.includes(name)&&!typesOf(properties[name]).includes('null'))continue;
    out[name]=Object.hasOwn(properties,name)?repair(item,properties[name],depth+1):item;
  }
  for(const name of required){
    const property=properties[name],types=typesOf(property);
    if(property&&(out[name]===undefined||out[name]===null)&&types.length===1&&types[0]==='array'&&!(property.minItems>0))out[name]=[];
  }
  return out;
}
function repair(value,schema,depth){
  if(!schema||typeof schema!=='object'||depth>16)return value;
  const branches=schema.anyOf||schema.oneOf;
  if(Array.isArray(branches)){
    const direct=branches.find(branch=>matches(value,branch));
    if(direct)return repair(value,direct,depth+1);
    for(const branch of branches){const candidate=repair(structuredClone(value),branch,depth+1);if(matches(candidate,branch))return candidate;}
    return value;
  }
  const types=typesOf(schema);let next=value;
  if(types.includes('array')&&!Array.isArray(next)){
    if(typeof next==='string'){const parsed=parseJson(next,'array');if(parsed)next=parsed;}
    if(!Array.isArray(next)&&next!==undefined&&next!==null&&!types.some(type=>matchesType(next,type))){
      const itemTypes=typesOf(schema.items);
      if(!itemTypes.length||itemTypes.some(type=>matchesType(next,type)||type==='string'&&typeof next==='number'||type==='object'&&typeof next==='string'&&parseJson(next,'object')))next=[next];
    }
  }
  if(types.includes('object')&&!types.includes('string')&&typeof next==='string'){const parsed=parseJson(next,'object');if(parsed)next=parsed;}
  if(Array.isArray(next)&&types.includes('array')&&isObject(schema.items))next=next.map(item=>repair(item,schema.items,depth+1));
  if(isObject(next)&&(types.includes('object')||schema.properties))next=repairObject(next,schema,depth);
  if(types.length===1&&types[0]==='string'&&(typeof next==='number'||typeof next==='boolean'))next=String(next);
  if(Array.isArray(schema.enum)&&typeof next==='string'&&!schema.enum.includes(next)){
    const hits=schema.enum.filter(option=>typeof option==='string'&&fold(option)===fold(next));
    if(hits.length===1)next=hits[0];
  }
  return next;
}
// Returns repaired arguments (a copy) or the input unchanged when nothing applies.
export function repairToolArguments(schema,args){
  let value=args;
  if(typeof value==='string'){const parsed=parseJson(value,'object');if(parsed)value=parsed;}
  if(!isObject(value)||!schema||typeof schema!=='object')return args;
  try{return repair(structuredClone(value),schema,0);}catch{return args;}
}
