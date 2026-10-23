// Knox reference logic adapted to the existing Node host. This module owns no
// model, credentials, web server or subprocess. Workspace registration is separate.
import {createHash} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {MailWikiVault} from './mail-wiki-vault.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const appName=value=>String(value||'').toLowerCase().replace(/\.exe$/,'');
const sameWindow=(a,b)=>a.hwnd===b.hwnd&&a.processId===b.processId&&a.processName===b.processName&&a.windowTitle===b.windowTitle;
const checkLimit=limit=>{if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('knox_limit');};
const attachmentMetadata=parts=>(parts||[]).map(({id,filename,name,contentType,size,sha256})=>({id,filename:filename||name||'',contentType,size,sha256}));

// Use an already connected, exact window through Nubi's existing WinappComputer.
// Reading never invokes, selects, scrolls, focuses, opens or sends into an app.
export async function readKnoxWindow(computer,binding,stream){
  const expected=stream==='chat'?'knoxteams':stream==='memo'?'mysingle.desktopmemo':null;
  if(!expected||!binding?.id||!Number.isSafeInteger(binding.hwnd)||!Number.isSafeInteger(binding.processId)||
    appName(binding.processName)!==expected||typeof binding.windowTitle!=='string')throw Error('knox_binding_required');
  const before=await computer.status(binding.hwnd);
  if(!sameWindow(binding,before))throw Error('knox_binding_changed');
  const snapshot=await computer.inspect(binding.hwnd);
  let memoFields=null;
  if(stream==='memo'&&typeof computer.value==='function'){
    const selectors=new Set((snapshot.elements||[]).map(element=>element.selector));
    const bodySelector=['txtMessage','RichTextBox_Memo'].find(selector=>selectors.has(selector));
    if(selectors.has('txtTitle')&&bodySelector){
      // Only current observed controls; the existing native adapter enforces the
      // password flag and value-size boundary. Never open/select a different memo.
      try{
        const title=await computer.value(binding.hwnd,'txtTitle'),body=await computer.value(binding.hwnd,bodySelector);
        if(title!==await computer.value(binding.hwnd,'txtTitle'))throw Error('knox_memo_changed');
        memoFields={title,body,bodyCoverage:'observed editor value; document completeness unknown'};
      }catch{memoFields=null;}
    }
  }
  const after=await computer.status(binding.hwnd);
  if(!sameWindow(before,after))throw Error('knox_binding_changed');
  if(!Array.isArray(snapshot.elements)||snapshot.elements.length>400)throw Error('knox_observation_invalid');
  const texts=snapshot.elements.filter(element=>!element.isOffscreen&&element.isPassword!==true&&element.name?.trim())
    .map(element=>String(element.name).slice(0,500));
  const text=[...texts,...(memoFields?[memoFields.title,memoFields.body]:[])].join('\n');
  return {
    records:text?[{id:`${binding.id}:${sha(text)}`,data:{kind:'uia-visible-text',text,windowTitle:before.windowTitle,
      ...(stream==='chat'&&binding.room?{room:binding.room}:{}),
      observedAt:new Date().toISOString(),partial:true,identityQuality:'window observation; native message/memo identity unknown',
      ...(memoFields||{}),
      sourceScope:'visible UIA labels only; not a full message or memo history'}}]:[],
    coverage:{kind:'native-uia',windowBinding:binding.id,complete:false,truncated:snapshot.truncated===true,
      originalCoverage:snapshot.coverage||null,collectionScope:'visible labels from one connected window'},
    warnings:['visible_labels_only'],
  };
}

// Reuse the OS-vault-backed encrypted page store. Only its managed session copy
// is readable by OpenWiki. dispose wipes that copy; no plaintext fallback.
export function createKnoxEvidenceStore({rawDirectory,storeDirectory,secrets,protect}={}){
  const inside=(root,file)=>{const relative=path.relative(root,file);return !relative||!path.isAbsolute(relative)&&relative.split(path.sep)[0]!=='..';};
  if(!path.isAbsolute(rawDirectory||'')||!path.isAbsolute(storeDirectory||'')||inside(rawDirectory,storeDirectory)||inside(storeDirectory,rawDirectory))throw Error('knox_evidence_directory');
  const vault=new MailWikiVault({storeRoot:storeDirectory,sessionRoot:rawDirectory,secrets,protect});
  let ready,closing=false,queue=Promise.resolve();
  const write=async({runId,stream,data})=>{
    if(!/^[A-Za-z0-9_.-]{1,160}$/.test(runId)||!['mail','chat','memo','jsm','ask'].includes(stream))throw Error('knox_evidence_name');
    ready||=(async()=>{if(!await vault.ready())throw Error('knox_evidence_vault');await vault.hydrate();})();
    await ready;
    if(vault.disposed)throw Error('knox_evidence_closed');
    const text=JSON.stringify(data,null,2)+'\n',name=`${runId}-${stream}.md`,target=path.join(rawDirectory,name);
    await vault.persist(name,text);
    const temporary=target+'.tmp';await writeFile(temporary,text,{mode:0o600,flag:'wx'});await rename(temporary,target);
    return target;
  };
  return {write(input){if(closing)return Promise.reject(Error('knox_evidence_closed'));const job=queue.catch(()=>{}).then(()=>write(input));queue=job;return job;},
    async dispose(){closing=true;await queue.catch(()=>{});await vault.dispose();}};
}

export function createKnoxNativeReader({sourceId,mail,computer,windows={},jsm,questions,evidence}={}){
  if(typeof sourceId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(sourceId))throw Error('knox_source_id');
  return {sourceId,...(evidence?{writeEvidence:input=>evidence.write(input)}:{}),async read({stream,limit,rooms=[],projects=[]}){
    checkLimit(limit);
    if(stream==='mail'){
      if(!mail?.searchMail||!mail?.read)throw Error('knox_mail_unavailable');
      // Existing PersonalMail owns MIME parsing, original hashes, vault, index and
      // native Office. No duplicate .mysingle scanner, plaintext DB or POP3 client.
      const page=await mail.searchMail({query:'',limit});
      const summaries=page.results;
      if(!Array.isArray(summaries)||summaries.length>limit)throw Error('knox_mail_contract');
      const records=[];
      for(const summary of summaries){
        const source=await mail.read(summary.id);
        if(source.id!==summary.id||source.sourceHash!==summary.sourceHash)throw Error('knox_mail_changed');
        const body=source.mail;
        records.push({id:source.id,sourceHash:source.sourceHash,data:{
          subject:body.subject,from:body.from,to:body.to,cc:body.cc,date:body.date,messageId:body.messageId,
          text:body.text,truncated:body.truncated===true,sourceFolder:body.sourceFolder,documentKind:body.documentKind,
          attachments:attachmentMetadata(body.attachments),attachmentContent:'not-read',
        }});
      }
      return {records,coverage:{kind:'native-mail-store',total:page.total,returned:records.length,truncated:page.truncated===true,
        complete:false,originals:'existing PersonalMail vault; not recopied'},warnings:[]};
    }
    if(stream==='chat'||stream==='memo'){
      const binding=windows[stream];
      if(!computer||!binding)throw Error('knox_binding_required');
      if(stream==='chat'&&rooms.length&&(!binding.room||!rooms.includes(binding.room)))throw Error('knox_room_scope');
      return readKnoxWindow(computer,binding,stream);
    }
    if(stream==='jsm'){
      if(!projects.length||projects.some(project=>! /^[A-Z][A-Z0-9]*$/.test(project))||!jsm?.listCachedIssues)throw Error('knox_jsm_scope');
      const result=await jsm.listCachedIssues({projects:[...projects],limit});
      if(!Array.isArray(result.issues)||result.issues.length>limit)throw Error('knox_jsm_contract');
      const normalized=result.issues.map(issue=>normalizeKnoxJsmIssue(issue,result.fieldNames));
      const records=normalized.map(data=>({id:data.key,data:{...data,processFlow:knoxProcessFlow(normalized,data.key)}}));
      if(records.some(record=>!projects.includes(record.id.split('-')[0])))throw Error('knox_jsm_scope');
      return {records,coverage:{kind:'host-jsm-cache',total:result.total,returned:records.length,complete:false,
        truncated:result.truncated===true,comments:'unknown',history:'unknown',liveRefresh:false},warnings:[]};
    }
    if(stream==='ask'){
      if(!questions?.listRecorded)throw Error('knox_questions_unavailable');
      const result=await questions.listRecorded({limit});
      if(!Array.isArray(result.items)||result.items.length>limit)throw Error('knox_questions_contract');
      return {records:result.items.map(item=>{
        if(typeof item.id!=='string'||!item.id||typeof item.runId!=='string'||!item.runId)throw Error('knox_question_binding');
        return {id:JSON.stringify([item.runId,item.id]),data:{...item,authorization:'historical-record-only',executionVerified:false}};
      }),coverage:{kind:'native-question-history',complete:false,truncated:result.truncated===true},warnings:[]};
    }
    throw Error('knox_stream_unsupported');
  }};
}

const ci=value=>{if(Array.isArray(value))value=value[0];if(value&&typeof value==='object')value=value.label||value.name||value.value;const match=/^(.*?)\s*\(([A-Z][A-Z0-9]*-\d+)\)\s*$/.exec(String(value||''));return match?{name:match[1],key:match[2]}:{name:String(value||''),key:null};};
const person=value=>value?.displayName||'';
const sensitive=/ncrypt|암호|password|비밀번호|secret|token/i;
export function knoxWikiText(value){
  return String(value||'').replace(/\r\n/g,'\n').replace(/\{(?:code|noformat)[^}]*\}([\s\S]*?)\{(?:code|noformat)\}/g,'\n$1\n')
    .replace(/\{[a-zA-Z]+(?::[^}]*)?\}/g,'').replace(/^h[1-6]\.\s*/gm,'').replace(/\[([^\]|\n]+)\|([^\]\n]+)\]/g,'$1 ($2)')
    .replace(/\[~([^\]]+)\]/g,'@$1').trim();
}
export function normalizeKnoxJsmIssue(issue,fieldNames={}){
  if(!/^[A-Z][A-Z0-9]*-\d+$/.test(issue?.key||''))throw Error('knox_ticket_key');
  const f=issue.fields||{};
  const links=(f.issuelinks||[]).slice(0,200).map(link=>{
    const other=link.outwardIssue||link.inwardIssue;
    if(!other||!/^[A-Z][A-Z0-9]*-\d+$/.test(other.key||''))throw Error('knox_ticket_link');
    return {key:other.key,relation:link.outwardIssue?link.type?.outward:link.type?.inward,
      type:link.type?.name,direction:link.outwardIssue?'out':'in',summary:other.fields?.summary,status:other.fields?.status?.name,issueType:other.fields?.issuetype?.name};
  });
  // Comments and changelog expansions can be paged by Jira. Keep totals and
  // actual returned counts; no automatic browser/API fetch is hidden here.
  const comments=(f.comment?.comments||[]).map(item=>({id:String(item.id||''),author:person(item.author),created:item.created,updated:item.updated,body:knoxWikiText(item.body)}));
  const histories=(issue.changelog?.histories||[]).flatMap(entry=>(entry.items||[]).filter(item=>!sensitive.test(item.field||'')).map(item=>({author:person(entry.author),created:entry.created,field:item.field,from:item.fromString??item.from??'',to:item.toString??item.to??''})));
  const extra=[],sla=[];
  for(const [id,value] of Object.entries(f)){
    const name=fieldNames[id]||id;
    if(!/^customfield_/.test(id)||sensitive.test(id)||sensitive.test(name)||value==null||value===''||['customfield_10825','customfield_10826','customfield_10827','customfield_10537'].includes(id))continue;
    if(value&&typeof value==='object'&&('ongoingCycle' in value||'completedCycles' in value)){
      const completed=value.completedCycles||[],cycle=value.ongoingCycle||completed.at(-1)||{},friendly=item=>item?.friendly||'';
      sla.push({name:value.name||name,state:cycle.paused?'paused':value.ongoingCycle?'running':'completed',breached:cycle.breached===true,
        goal:friendly(cycle.goalDuration),elapsed:friendly(cycle.elapsedTime),remaining:friendly(cycle.remainingTime)});
    }else{
      const text=typeof value==='string'?knoxWikiText(value):JSON.stringify(value);
      if(/^\s*</.test(text))continue;
      extra.push({id,name,value:text.slice(0,4000),truncated:text.length>4000});
    }
  }
  return {key:issue.key,type:f.issuetype?.name||'',status:f.status?.name||'',resolution:f.resolution?.name||'',
    isOpen:!f.resolution,summary:f.summary||'',description:knoxWikiText(f.description),assignee:person(f.assignee),reporter:person(f.reporter),
    created:f.created||null,updated:f.updated||null,due:f.customfield_10537||f.duedate||null,
    service:ci(f.customfield_10825),system:ci(f.customfield_10826),subsystem:ci(f.customfield_10827),
    links,linkCoverage:{total:f.issuelinks?.length||0,returned:links.length,complete:false},comments,history:histories,extra,sla,
    commentCoverage:{total:f.comment?.total??null,returned:comments.length,complete:false},
    historyCoverage:{total:issue.changelog?.total??null,returnedHistories:issue.changelog?.histories?.length||0,complete:false},
    attachments:(f.attachment||[]).map(item=>({id:String(item.id),filename:item.filename,size:item.size,mime:item.mimeType})),attachmentContent:'not-read',
    sourceUrl:null,sourceFormat:'cached-jira-issue',trust:'untrusted-external-data'};
}

const PROCESS_LINKS=new Set(['OneCall Link','OneCall Change Link','OneCall SubOneCall Link','Incident Link','Incident Change Link','Problem Link','Problem Change Link','Problem/Incident','Change Link','Task Link','DevSubejct Link','Release Link']);
const LANES=[['OneCall-App','Incident'],['Problem'],['Change-App','Change-Infra','Development Subject'],['Dev Task'],['Release'],['Test','Test Execution','Test Defect']];
export function knoxProcessFlow(tickets,key){
  const stored=new Map(tickets.map(ticket=>[ticket.key,ticket]));
  if(!stored.has(key))throw Error('knox_ticket_missing');
  const previews=new Map(),adjacent=new Map(),allEdges=new Map();
  for(const ticket of tickets)for(const link of ticket.links){
    if(!PROCESS_LINKS.has(link.type))continue;
    previews.set(link.key,{key:link.key,summary:link.summary,status:link.status,type:link.issueType});
    const from=link.direction==='out'?ticket.key:link.key,to=link.direction==='out'?link.key:ticket.key;
    allEdges.set(JSON.stringify([from,to,link.type]),{from,to,type:link.type});
    for(const [a,b] of [[ticket.key,link.key],[link.key,ticket.key]]){if(!adjacent.has(a))adjacent.set(a,new Set());adjacent.get(a).add(b);}
  }
  const seen=new Set([key]);let frontier=[key];
  for(let depth=0;depth<5&&frontier.length&&seen.size<80;depth++){
    const next=[];
    for(const node of frontier)for(const other of adjacent.get(node)||[]){if(!seen.has(other)&&seen.size<80){seen.add(other);next.push(other);}}
    frontier=next;
  }
  return {nodes:[...seen].map(id=>{const ticket=stored.get(id)||previews.get(id)||{key:id};const lane=LANES.findIndex(types=>types.includes(ticket.type));return {key:id,type:ticket.type||null,summary:ticket.summary||'',status:ticket.status||null,stored:stored.has(id),lane:lane<0?6:lane,current:id===key};}),
    edges:[...allEdges.values()].filter(edge=>seen.has(edge.from)&&seen.has(edge.to)),
    coverage:{maxDepth:5,maxNodes:80,complete:false,liveRefresh:false}};
}
