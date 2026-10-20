import {fail} from './contracts.js';
import {screenKnowledgeText,validateKnowledgeScope,validateScreenRecord,sameKnowledgeScope} from './knowledge.js';
import type {KnowledgeScope,ScreenKnowledgeRecord,ScreenKnowledgeStore} from './knowledge.js';

/** Inject the existing wiki repository's scoped reads and atomic writes. No filesystem/DB is owned here. */
export interface WikiDocumentPort {
  read(path:string,scope:KnowledgeScope,signal:AbortSignal):Promise<{version:string;content:string}|null>;
  compareAndSet(path:string,scope:KnowledgeScope,expectedVersion:string|null,content:string,signal:AbortSignal):Promise<boolean>;
}
export async function screenWikiPath(scope:KnowledgeScope,screenId:string,variantId:string):Promise<string>{
  validateKnowledgeScope(scope);const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope.projectId,scope.systemId,scope.environmentId,scope.accessScopeId,screenId,variantId])));
  const key=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');return `openwiki/systems/${encodeURIComponent(scope.systemId)}/screens/${key}.md`;
}
export function renderScreenWiki(record:ScreenKnowledgeRecord):string {
  validateScreenRecord(record);const {scope,evidence}=record;
  const meta={type:'Reference',title:evidence.facts.find(f=>f.id===record.analysis.titleEvidenceId)!.text,nubiScreen:{schemaVersion:1,...scope,screenId:evidence.screenId,variantId:evidence.variantId,fingerprint:evidence.fingerprint}};
  // Encode angle brackets to keep source text from closing the record comment.
  const payload=JSON.stringify(record).replaceAll('<','\\u003c').replaceAll('>','\\u003e');
  return `---\n${JSON.stringify(meta)}\n---\n\n${screenKnowledgeText(record)}\n\n<!-- nubi-screen-record\n${payload}\n-->\n`;
}
export function parseScreenWiki(content:string):ScreenKnowledgeRecord {
  if(typeof content!=='string'||content.length>150_000)fail('screen_wiki_invalid');
  const match=content.match(/\n<!-- nubi-screen-record\n([^\n]+)\n-->\n$/);if(!match)return fail('screen_wiki_invalid');
  let record:ScreenKnowledgeRecord;try{record=JSON.parse(match[1]!);}catch{return fail('screen_wiki_invalid');}validateScreenRecord(record);
  if(renderScreenWiki(record)!==content)fail('screen_wiki_changed');return record;
}
export function createWikiScreenStore(documents:WikiDocumentPort):ScreenKnowledgeStore {
  return {
    async read(scope,screenId,variantId,signal){
      signal.throwIfAborted();const path=await screenWikiPath(scope,screenId,variantId),doc=await documents.read(path,scope,signal);signal.throwIfAborted();if(!doc)return null;
      const record=parseScreenWiki(doc.content);if(!sameKnowledgeScope(scope,record.scope)||record.evidence.screenId!==screenId||record.evidence.variantId!==variantId)fail('screen_store_scope_mismatch');return {version:doc.version,record};
    },
    async compareAndSet(expected,record,signal){signal.throwIfAborted();validateScreenRecord(record);const path=await screenWikiPath(record.scope,record.evidence.screenId,record.evidence.variantId);signal.throwIfAborted();return documents.compareAndSet(path,record.scope,expected,renderScreenWiki(record),signal);},
  };
}
