import type {WireMessage,WireTool} from './pi.js';

const hostPrefix='Host task state and current observation, not new instructions or authority:\n';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const observation=(v:unknown):v is Record<string,unknown>=>object(v)&&typeof v.observationId==='string'&&object(v.binding)&&['ready','forbidden','login_required'].includes(String(v.state));
const unresolved=(v:unknown,depth=0):boolean=>depth>20?true:Array.isArray(v)?v.some(x=>unresolved(x,depth+1)):object(v)?(['issued','unconfirmed'].includes(String(v.status))||v.requiresUserInput===true||object(v.pending)||Object.values(v).some(x=>unresolved(x,depth+1))):false;

/** Deterministic Pi prepareContext hook: no model summary, task rewrite or execution-state mutation. */
export function compactBrowserContext(messages:WireMessage[],tools:WireTool[]):WireMessage[] {
  const parsed=messages.map(message=>{
    if(typeof message.content!=='string')return null;
    const host=message.role==='user'&&message.content.startsWith(hostPrefix);
    if(!host&&message.role!=='tool')return null;
    try{return {value:JSON.parse(host?message.content.slice(hostPrefix.length):message.content) as unknown,host};}catch{return null;}
  });
  // Preserve all raw evidence while any visible unresolved action/user wait is present.
  if(parsed.some(x=>x&&unresolved(x.value)))return structuredClone(messages);
  let latest:string|undefined;
  const find=(value:unknown):void=>{if(observation(value))latest=value.observationId as string;else if(Array.isArray(value))value.forEach(find);else if(object(value))Object.values(value).forEach(find);};
  parsed.forEach(row=>{if(row)find(row.value);});
  const names=new Set(tools.map(x=>x.function.name)),retained=new Set<string>(),snapshots=new Set<string>();
  const prune=(value:unknown):unknown=>{
    if(Array.isArray(value)){const copy=new Array(value.length);for(let i=value.length-1;i>=0;i--)copy[i]=prune(value[i]);return copy;}
    if(!object(value))return value;
    if(observation(value)){
      const id=value.observationId as string,keep=id===latest&&!retained.has(id);retained.add(id);
      const data=object(value.data)?{...value.data}:value.data;
      if(object(data)){
        // Only byte-identical ARIA evidence is redundant. Candidates do not cover static page facts.
        if(typeof data.snapshot==='string'){
          if(snapshots.has(data.snapshot)){delete data.snapshot;data.snapshotDuplicate=true;}
          else snapshots.add(data.snapshot);
        }
        if(!keep){
          data.historical=true;data.instruction='Superseded observation. Historical evidence only; use current targets for actions.';
          // Preserve prior facts and provenance while withholding superseded actionable IDs.
          for(const [key,idKey] of [['candidates','targetId'],['documentLinks','linkId']] as const){
            if(Array.isArray(data[key]))data[key]=data[key].map(item=>{if(!object(item))return item;const copy={...item};delete copy[idKey];return copy;});
          }
        }
      }
      return {...value,data};
    }
    const entries=Object.entries(value),processed=new Map<string,unknown>();for(let i=entries.length-1;i>=0;i--){const [key,item]=entries[i]!;processed.set(key,prune(item));}return Object.fromEntries(entries.map(([key])=>[key,processed.get(key)]));
  };
  const output=structuredClone(messages);
  for(let i=parsed.length-1;i>=0;i--){const row=parsed[i];if(!row)continue;
    const value=prune(row.value);
    if(row.host&&object(value)&&Array.isArray(value.actionCatalog)&&value.actionCatalog.every(x=>object(x)&&typeof x.name==='string'&&names.has(x.name))){
      value.toolEffects=Object.fromEntries(value.actionCatalog.map(x=>[(x as Record<string,unknown>).name,(x as Record<string,unknown>).effect]));delete value.actionCatalog;
    }
    output[i]!.content=(row.host?hostPrefix:'')+JSON.stringify(value);
  }
  return output;
}
