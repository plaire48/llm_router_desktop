const {createHash,randomUUID}=require('node:crypto');
const {readFile,writeFile,mkdir,rename}=require('node:fs/promises');
const path=require('node:path');
const REPO='/api/v3/repos/Manufacturing-IT/ai_workspace',vars={owner:'Manufacturing-IT',name:'ai_workspace'};
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const SHA=/^[a-f\d]{40}$/;
const fields='id number title body createdAt updatedAt locked author { login avatarUrl ... on User { name databaseId } } category { id name } comments(first:0) { totalCount }';
const pageInfo='pageInfo { hasNextPage endCursor }';
const fail=code=>{throw Error(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
function decode(body){return String(body||'').replace(/^<!-- e2e-talk:v[12]:[a-f\d-]+ -->\n?/i,'').split('\n<!-- /e2e-talk -->')[0].replace(/\n\n\[AI Talk에서 보기\]\([^\n]+\)[^]*$/,'').replace(/<!-- e2e-(?:discussion|talk)-comment:[^>]+ -->/g,'').trim();}
function post(row,legacy=false){return {key:(legacy?'i':'d')+row.number,number:row.number,title:String(row.title||'').replace(/^\[(?:AI Workspace|Skill Hub|E2E Report)\]\[Talk\]\s*/,''),body:decode(row.body),rawBody:row.body||'',format:/^<!-- e2e-talk:v1:/.test(row.body||'')?'html':'markdown',author:legacy?{login:row.user?.login,name:row.user?.name}:row.author,createdAt:row.createdAt||row.created_at,updatedAt:row.updatedAt||row.updated_at,comments:legacy?row.comments:row.comments?.totalCount||0,locked:!!row.locked,category:row.category||{name:'이전 글'},legacy};}
function number(key){if(!/^[di][1-9]\d{0,9}$/.test(key||''))fail('community_input');return Number(key.slice(1));}
function webUrl(text){let u;try{u=new URL(text);}catch{fail('community_input');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2048)fail('community_input');return u.href;}
class WorkspaceCommunity{
 constructor({account,outboxFile}){this.account=account;this.outboxFile=outboxFile;this.busy=false;}
 async session(){const c=await this.account.credential(),actor=this.account.profile?.login;
  const active=()=>{if(c.generation!==this.account.generation||this.account.state!=='connected')fail('ghes_session_changed');};
  const request=async(route,body)=>{active();const v=await this.account.request(route,{token:c.token,body,limit:8*1024*1024});active();return v;};
  const gql=async(query,variables)=>{const v=await request('/api/graphql',{query,variables:{...vars,...variables}});if(v.errors?.length||!v.data)fail('community_graphql');return v.data;};
  return {request,gql,active,actor};
 }
 async pending(){try{const v=JSON.parse(await readFile(this.outboxFile,'utf8'));return Array.isArray(v)?v:[];}catch(e){if(e.code==='ENOENT')return [];fail('community_storage');}}
 async record(items){await mkdir(path.dirname(this.outboxFile),{recursive:true});const temp=this.outboxFile+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(items),{mode:0o600,flag:'wx'});await rename(temp,this.outboxFile);}
 async metadata(s){const v=await s.gql(`query NubiTalkSetup($owner:String!,$name:String!){repository(owner:$owner,name:$name){id hasDiscussionsEnabled discussionCategories(first:100){nodes{id name} ${pageInfo}}}}`);const r=v.repository;if(!r?.hasDiscussionsEnabled)fail('community_disabled');if(!Array.isArray(r.discussionCategories?.nodes)||r.discussionCategories.pageInfo?.hasNextPage)fail('community_format');return r;}
 async listDiscussions(s,cursor=null){if(cursor!==null&&(typeof cursor!=='string'||cursor.length>1000))fail('community_input');const v=await s.gql(`query NubiTalkList($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){discussions(first:30,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{${fields}} ${pageInfo}}}}`,{after:cursor});const c=v.repository?.discussions;if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')fail('community_format');return {items:c.nodes.map(r=>post(r)),cursor:c.pageInfo.hasNextPage?c.pageInfo.endCursor:null};}
 async detail(s,key){const n=number(key);if(key[0]==='i'){const r=await s.request(REPO+'/issues/'+n);if(r.pull_request||!/^<!-- e2e-talk:v1:/.test(r.body||''))fail('community_missing');return {...post(r,true),id:r.node_id};}
  const v=await s.gql(`query NubiTalkDetail($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){${fields}}}}`,{number:n});if(!v.repository?.discussion)fail('community_missing');return {...post(v.repository.discussion),id:v.repository.discussion.id};
 }
 async comments(s,key,cursor=null){const n=number(key);if(key[0]==='i'){const page=Number(cursor||1);if(!Number.isSafeInteger(page)||page<1||page>100)fail('community_input');const rows=await s.request(REPO+`/issues/${n}/comments?per_page=50&page=${page}`);if(!Array.isArray(rows))fail('community_format');return {items:rows.map(r=>({id:String(r.id),body:decode(r.body),rawBody:r.body,author:{login:r.user?.login},createdAt:r.created_at})),cursor:rows.length===50?String(page+1):null};}
  if(cursor!==null&&(typeof cursor!=='string'||cursor.length>1000))fail('community_input');
  const v=await s.gql(`query NubiTalkComments($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){discussion(number:$number){comments(first:50,after:$after){nodes{id body createdAt author{login ... on User{name}} replies(first:50){nodes{id body createdAt author{login ... on User{name}}} ${pageInfo}}} ${pageInfo}}}}}`,{number:n,after:cursor});const c=v.repository?.discussion?.comments;if(!Array.isArray(c?.nodes))fail('community_format');return {items:c.nodes.map(r=>({...r,rawBody:r.body,body:decode(r.body),replies:(r.replies?.nodes||[]).map(v=>({...v,body:decode(v.body)})),moreReplies:!!r.replies?.pageInfo?.hasNextPage})),cursor:c.pageInfo?.hasNextPage?c.pageInfo.endCursor:null};
 }
 async verify(s,pending){let cursor=null;for(let i=0;i<100;i++){const result=pending.action==='post'?await this.listDiscussions(s,cursor):await this.comments(s,pending.key,cursor);const marker=pending.action==='post'?`e2e-talk:v2:${pending.nonce}`:`e2e-${pending.key[0]==='i'?'talk':'discussion'}-comment:${pending.nonce}`;const found=result.items.find(row=>row.rawBody?.includes(marker)&&row.author?.login?.toLowerCase()===pending.actor.toLowerCase());if(found)return {saved:true,key:found.key||pending.key};if(!result.cursor)return {saved:false,pending:true};cursor=result.cursor;}return {saved:false,pending:true};}
 async blob(s,file,ref){let v=await s.request(REPO+'/contents/'+file.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(ref));const sha=v.sha;if(!SHA.test(sha||''))fail('community_format');if(v.encoding==='none')v=await s.request(REPO+'/git/blobs/'+sha);if(v.encoding!=='base64'||typeof v.content!=='string')fail('community_format');const bytes=Buffer.from(v.content.replace(/\s/g,''),'base64');if(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')!==sha)fail('community_changed');try{return JSON.parse(bytes.toString('utf8'));}catch{fail('community_format');}}
 async apps(s){const meta=await s.request(REPO),branch=meta.default_branch;if(typeof branch!=='string')fail('community_format');const commit=await s.request(REPO+'/commits/'+encodeURIComponent(branch));if(!SHA.test(commit.sha||''))fail('community_format');const catalog=await this.blob(s,'data/workspace/catalog.json',commit.sha);if(catalog.schemaVersion!==1||!Array.isArray(catalog.items)||catalog.items.length>2000)fail('community_format');return {items:catalog.items.map(i=>{if(!/^[a-f\d-]{36}$/i.test(i.id||'')||typeof i.title!=='string'||typeof i.description!=='string'||i.title.length>100||i.description.length>1000)fail('community_format');return {id:i.id,title:i.title,description:i.description,kind:i.kind==='site'?'site':'link',...(i.kind==='site'?{}:{url:webUrl(i.url)}),createdBy:i.createdBy,updatedAt:i.updatedAt};})};}
 async call(a={}){
  const s=await this.session();
  if(a.action==='apps')return this.apps(s);
  if(a.action==='app'){const item=(await this.apps(s)).items.find(i=>i.id===a.id);if(!item)fail('community_missing');return item;}
  if(a.action==='setup'){const m=await this.metadata(s);return {categories:m.discussionCategories.nodes,pending:(await this.pending()).filter(p=>p.actor===s.actor&&p.state!=='saved').map(({nonce,action,key})=>({nonce,action,key}))};}
  if(a.action==='list')return this.listDiscussions(s,a.cursor||null);
  if(a.action==='legacy'){const page=Number(a.page||1);if(!Number.isSafeInteger(page)||page<1||page>100)fail('community_input');const rows=await s.request(REPO+`/issues?state=all&sort=updated&direction=desc&per_page=50&page=${page}`);if(!Array.isArray(rows))fail('community_format');return {items:rows.filter(r=>!r.pull_request&&/^<!-- e2e-talk:v1:/.test(r.body||'')).map(r=>post(r,true)),cursor:rows.length===50?page+1:null};}
  if(a.action==='detail'){const item=await this.detail(s,a.key);return {item,comments:await this.comments(s,a.key)};}
  if(a.action==='comments'){await this.detail(s,a.key);return this.comments(s,a.key,a.cursor||null);}
  if(!['post','comment','verify'].includes(a.action)||!UUID.test(a.nonce||''))fail('community_input');
  if(this.busy)fail('community_busy');this.busy=true;
  try{const rows=await this.pending(),old=rows.find(p=>p.nonce===a.nonce&&p.actor===s.actor);
   if(old){if(old.state==='saved')return {saved:true,key:old.resultKey};const v=await this.verify(s,old);if(v.saved)await this.record(rows.map(p=>p===old?{...p,state:'saved',resultKey:v.key}:p));return v;}
   if(a.action==='verify')fail('community_missing');if(rows.some(p=>p.actor===s.actor&&p.state!=='saved'))fail('community_pending');
   const body=typeof a.body==='string'?a.body.trim():'';if(!body||body.length>(a.action==='post'?50000:4000)||/<!--\s*\/?e2e-/i.test(body))fail('community_input');
   let mutation,input;
   if(a.action==='post'){
    const title=typeof a.title==='string'?a.title.trim():'';if(!title||title.length>120||/[\r\n]/.test(title))fail('community_input');const m=await this.metadata(s);if(!m.discussionCategories.nodes.some(c=>c.id===a.category))fail('community_input');
    input={repositoryId:m.id,categoryId:a.category,title:'[AI Workspace][Talk] '+title,body:`<!-- e2e-talk:v2:${a.nonce} -->\n${body}\n<!-- /e2e-talk -->`,clientMutationId:a.nonce};mutation='mutation NubiTalkCreate($input:CreateDiscussionInput!){createDiscussion(input:$input){discussion{id}}}';
   }else{const item=await this.detail(s,a.key);if(item.locked)fail('community_locked');input={discussionId:item.id,body:body+`\n\n<!-- e2e-${item.legacy?'talk':'discussion'}-comment:${a.nonce} -->`,clientMutationId:a.nonce};mutation='mutation NubiTalkComment($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{id}}}';}
   const pending={nonce:a.nonce,action:a.action,key:a.key||null,actor:s.actor,hash:hash(JSON.stringify(input)),at:new Date().toISOString()};
   await this.record([...rows,pending]);s.active();
   try{if(a.action==='comment'&&a.key[0]==='i')await s.request(REPO+'/issues/'+number(a.key)+'/comments',{body:input.body});else await s.gql(mutation,{input});}catch{/* A mutation may have committed before the reply failed. Verify only. */}
   let result;try{result=await this.verify(s,pending);}catch{fail('community_pending');}
   if(result.saved)await this.record([...rows,{...pending,state:'saved',resultKey:result.key}]);return result;
  }finally{this.busy=false;}
 }
}
module.exports={WorkspaceCommunity,decode,webUrl};
