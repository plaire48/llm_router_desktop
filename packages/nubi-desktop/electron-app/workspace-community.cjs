const {createHash,randomUUID}=require('node:crypto');
const {readFile,writeFile,mkdir,rename}=require('node:fs/promises');
const path=require('node:path');
const {ORIGIN:GHES_ORIGIN,safeUrl}=require('../../nubi-vscode/src/ghes.cjs');
const REPO='/api/v3/repos/Manufacturing-IT/ai_workspace',vars={owner:'Manufacturing-IT',name:'ai_workspace'};
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const SHA=/^[a-f\d]{40}$/;
const fields='id number title body createdAt updatedAt locked author { login avatarUrl ... on User { name email databaseId } } category { id name } comments(first:0) { totalCount }';
const pageInfo='pageInfo { hasNextPage endCursor }';
const fail=code=>{throw Error(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
function decode(body){return String(body||'').replace(/^<!-- e2e-talk:v[12]:[a-f\d-]+ -->\n?/i,'').split('\n<!-- /e2e-talk -->')[0].replace(/\n\n\[AI Talk에서 보기\]\([^\n]+\)[^]*$/,'').replace(/<!-- e2e-(?:discussion|talk)-comment:[^>]+ -->/g,'').trim();}
function post(row,legacy=false){return {key:(legacy?'i':'d')+row.number,number:row.number,title:String(row.title||'').replace(/^\[(?:AI Workspace|Skill Hub|E2E Report)\]\[Talk\]\s*/,''),body:decode(row.body),rawBody:row.body||'',format:/^<!-- e2e-talk:v1:/.test(row.body||'')?'html':'markdown',author:legacy?{login:row.user?.login,name:row.user?.name,avatarUrl:row.user?.avatar_url}:row.author,createdAt:row.createdAt||row.created_at,updatedAt:row.updatedAt||row.updated_at,comments:legacy?row.comments:row.comments?.totalCount||0,locked:!!row.locked,category:row.category||{name:'이전 글'},legacy};}
function number(key){if(!/^[di][1-9]\d{0,9}$/.test(key||''))fail('community_input');return Number(key.slice(1));}
const ICON_LIMIT=128*1024,ICON_MIMES=['image/png','image/x-icon'],LOGIN=/^[a-z\d](?:[a-z\d._-]{0,62}[a-z\d])?$/i;
const iconPath=h=>`data/workspace/icons/${h}.json`;
// Same descriptor and file contract as ai_workspace src/workspace/workspaceIcon.js, so apps registered here appear on the page unchanged.
function iconDescriptor(icon){if(!icon||typeof icon!=='object')return null;if(!/^[a-f\d]{64}$/.test(icon.hash||'')||icon.path!==iconPath(icon.hash)||!ICON_MIMES.includes(icon.mime)||!Number.isSafeInteger(icon.size)||icon.size<22||icon.size>ICON_LIMIT)return null;return {hash:icon.hash,path:icon.path,mime:icon.mime,size:icon.size};}
function prepareIcon(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>ICON_LIMIT)fail('community_icon');
 let mime;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){if(bytes.length<33||bytes.readUInt32BE(8)!==13||bytes.readUInt32BE(12)!==0x49484452||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>256||bytes.readUInt32BE(20)>256)fail('community_icon');mime='image/png';}
 else if(bytes.readUInt16LE(0)===0&&bytes.readUInt16LE(2)===1){const count=bytes.readUInt16LE(4),end=6+16*count;if(count<1||count>32||end>bytes.length)fail('community_icon');for(let i=0;i<count;i++){const start=6+16*i,length=bytes.readUInt32LE(start+8),offset=bytes.readUInt32LE(start+12);if(!length||offset<end||offset+length>bytes.length)fail('community_icon');}mime='image/x-icon';}
 else fail('community_icon');
 const h=hash(bytes);return {descriptor:{hash:h,path:iconPath(h),mime,size:bytes.length},document:{schemaVersion:1,hash:h,mime,content:bytes.toString('base64')}};
}
function webUrl(text){let u;try{u=new URL(text);}catch{fail('community_input');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2048)fail('community_input');return u.href;}
class WorkspaceCommunity{
 constructor({account,outboxFile}){this.account=account;this.outboxFile=outboxFile;this.busy=false;}
 async session(){const c=await this.account.credential(),actor=this.account.profile?.login;
  const active=()=>{if(c.generation!==this.account.generation||this.account.state!=='connected')fail('ghes_session_changed');};
  const request=async(route,body,options={})=>{active();const v=await this.account.request(route,{token:c.token,body,limit:8*1024*1024,...options});active();return v;};
  const gql=async(query,variables)=>{const v=await request('/api/graphql',{query,variables:{...vars,...variables}});if(v.errors?.length||!v.data)fail('community_graphql');return v.data;};
  return {request,gql,active,actor,token:c.token};
 }
 async pending(){try{const v=JSON.parse(await readFile(this.outboxFile,'utf8'));return Array.isArray(v)?v:[];}catch(e){if(e.code==='ENOENT')return [];fail('community_storage');}}
 async record(items){await mkdir(path.dirname(this.outboxFile),{recursive:true});const temp=this.outboxFile+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(items),{mode:0o600,flag:'wx'});await rename(temp,this.outboxFile);}
 async metadata(s){const v=await s.gql(`query NubiTalkSetup($owner:String!,$name:String!){repository(owner:$owner,name:$name){id hasDiscussionsEnabled discussionCategories(first:100){nodes{id name} ${pageInfo}}}}`);const r=v.repository;if(!r?.hasDiscussionsEnabled)fail('community_disabled');if(!Array.isArray(r.discussionCategories?.nodes)||r.discussionCategories.pageInfo?.hasNextPage)fail('community_format');return r;}
 async listDiscussions(s,cursor=null){if(cursor!==null&&(typeof cursor!=='string'||cursor.length>1000))fail('community_input');const v=await s.gql(`query NubiTalkList($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){discussions(first:30,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{${fields}} ${pageInfo}}}}`,{after:cursor});const c=v.repository?.discussions;if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')fail('community_format');return {items:c.nodes.map(r=>post(r)),cursor:c.pageInfo.hasNextPage?c.pageInfo.endCursor:null};}
 async detail(s,key){const n=number(key);if(key[0]==='i'){const r=await s.request(REPO+'/issues/'+n);if(r.pull_request||!/^<!-- e2e-talk:v1:/.test(r.body||''))fail('community_missing');return {...post(r,true),id:r.node_id};}
  const v=await s.gql(`query NubiTalkDetail($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){${fields}}}}`,{number:n});if(!v.repository?.discussion)fail('community_missing');return {...post(v.repository.discussion),id:v.repository.discussion.id};
 }
 async comments(s,key,cursor=null){const n=number(key);if(key[0]==='i'){const page=Number(cursor||1);if(!Number.isSafeInteger(page)||page<1||page>100)fail('community_input');const rows=await s.request(REPO+`/issues/${n}/comments?per_page=50&page=${page}`);if(!Array.isArray(rows))fail('community_format');return {items:rows.map(r=>({id:String(r.id),body:decode(r.body),rawBody:r.body,author:{login:r.user?.login,avatarUrl:r.user?.avatar_url},createdAt:r.created_at})),cursor:rows.length===50?String(page+1):null};}
  if(cursor!==null&&(typeof cursor!=='string'||cursor.length>1000))fail('community_input');
  const v=await s.gql(`query NubiTalkComments($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){discussion(number:$number){comments(first:50,after:$after){nodes{id body createdAt author{login avatarUrl ... on User{name email}} replies(first:50){nodes{id body createdAt author{login avatarUrl ... on User{name email}}} ${pageInfo}}} ${pageInfo}}}}}`,{number:n,after:cursor});const c=v.repository?.discussion?.comments;if(!Array.isArray(c?.nodes))fail('community_format');return {items:c.nodes.map(r=>({...r,rawBody:r.body,body:decode(r.body),replies:(r.replies?.nodes||[]).map(v=>({...v,body:decode(v.body)})),moreReplies:!!r.replies?.pageInfo?.hasNextPage})),cursor:c.pageInfo?.hasNextPage?c.pageInfo.endCursor:null};
 }
 async verify(s,pending){let cursor=null;for(let i=0;i<100;i++){const result=pending.action==='post'?await this.listDiscussions(s,cursor):await this.comments(s,pending.key,cursor);const marker=pending.action==='post'?`e2e-talk:v2:${pending.nonce}`:`e2e-${pending.key[0]==='i'?'talk':'discussion'}-comment:${pending.nonce}`;const found=result.items.find(row=>row.rawBody?.includes(marker)&&row.author?.login?.toLowerCase()===pending.actor.toLowerCase());if(found)return {saved:true,key:found.key||pending.key};if(!result.cursor)return {saved:false,pending:true};cursor=result.cursor;}return {saved:false,pending:true};}
 async blob(s,file,ref){let v=await s.request(REPO+'/contents/'+file.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(ref));const sha=v.sha;if(!SHA.test(sha||''))fail('community_format');if(v.encoding==='none')v=await s.request(REPO+'/git/blobs/'+sha);if(v.encoding!=='base64'||typeof v.content!=='string')fail('community_format');const bytes=Buffer.from(v.content.replace(/\s/g,''),'base64');if(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')!==sha)fail('community_changed');try{return JSON.parse(bytes.toString('utf8'));}catch{fail('community_format');}}
 async catalog(s){const meta=await s.request(REPO),branch=meta.default_branch;if(typeof branch!=='string')fail('community_format');const commit=await s.request(REPO+'/commits/'+encodeURIComponent(branch));if(!SHA.test(commit.sha||''))fail('community_format');const document=await this.blob(s,'data/workspace/catalog.json',commit.sha);if(document.schemaVersion!==1||!Array.isArray(document.items)||document.items.length>2000)fail('community_format');for(const i of document.items)if(!/^[a-f\d-]{36}$/i.test(i.id||'')||typeof i.title!=='string'||typeof i.description!=='string'||i.title.length>100||i.description.length>1000)fail('community_format');return {branch,head:commit.sha,document};}
 item(i){return {id:i.id,title:i.title,description:i.description,kind:i.kind==='site'?'site':'link',...(i.kind==='site'?{}:{url:webUrl(i.url)}),...(iconDescriptor(i.icon)?{icon:iconDescriptor(i.icon)}:{}),createdBy:i.createdBy,updatedBy:i.updatedBy,updatedAt:i.updatedAt};}
 async apps(s){const c=await this.catalog(s);return {items:c.document.items.map(i=>this.item(i))};}
 // The stored icon file is read back and re-verified (hash, mime, size) before it is shown.
 async appIcon(s,id){const c=await this.catalog(s),entry=c.document.items.find(i=>i.id===id);if(!entry)fail('community_missing');const icon=iconDescriptor(entry.icon);if(!icon)return {dataUrl:null};const doc=await this.blob(s,icon.path,c.head);if(doc?.schemaVersion!==1||doc.hash!==icon.hash||doc.mime!==icon.mime||typeof doc.content!=='string'||doc.content.length>Math.ceil(ICON_LIMIT/3)*4)fail('community_format');const bytes=Buffer.from(doc.content,'base64');if(bytes.length!==icon.size||hash(bytes)!==icon.hash)fail('community_format');return {dataUrl:`data:${icon.mime};base64,${bytes.toString('base64')}`};}
 // Registration follows ai_workspace workspaceClient.save for a new link app: catalog item plus icon file in one commit on the default branch.
 async registerApp(s,a){
  const title=String(a.title??'').trim(),description=String(a.description??'').trim();if(!title||title.length>100||!description||description.length>1000)fail('community_input');
  const url=webUrl(String(a.url??'').trim());const prepared=a.icon?prepareIcon(Buffer.from(String(a.icon).replace(/\s/g,''),'base64')):null;
  if(typeof s.actor!=='string'||!LOGIN.test(s.actor))fail('ghes_login_required');
  const c=await this.catalog(s),now=new Date().toISOString(),id=randomUUID();
  const item={id,title,description,url,...(prepared?{icon:prepared.descriptor}:{}),maintainers:[],editors:[],createdAt:now,createdBy:s.actor,updatedAt:now,updatedBy:s.actor};
  const base=await s.request(REPO+'/git/commits/'+c.head);if(!SHA.test(base?.tree?.sha||''))fail('community_format');
  const changes=[{path:'data/workspace/catalog.json',document:{schemaVersion:1,items:[...c.document.items,item]}}];
  if(prepared){let stored=null;try{stored=await s.request(REPO+'/contents/'+prepared.descriptor.path.split('/').map(encodeURIComponent).join('/')+'?ref='+c.head);}catch(e){if(e.message!=='ghes_resource_missing')throw e;}if(!stored)changes.push({path:prepared.descriptor.path,document:prepared.document});}
  const tree=[];for(const change of changes){const blob=await s.request(REPO+'/git/blobs',{encoding:'utf-8',content:JSON.stringify(change.document,null,2)+'\n'});if(!SHA.test(blob?.sha||''))fail('community_format');tree.push({path:change.path,mode:'100644',type:'blob',sha:blob.sha});}
  const created=await s.request(REPO+'/git/trees',{base_tree:base.tree.sha,tree});if(!SHA.test(created?.sha||''))fail('community_format');
  const commit=await s.request(REPO+'/git/commits',{message:`app: add ${id}`,tree:created.sha,parents:[c.head]});if(!SHA.test(commit?.sha||''))fail('community_format');
  try{await s.request(REPO+'/git/refs/heads/'+encodeURIComponent(c.branch),{sha:commit.sha,force:false},{method:'PATCH'});}catch(e){if(/^ghes_(session|login|sso|network|rate)/.test(e.message))throw e;fail('community_changed');}
  return {saved:true,item:this.item(item)};
 }
 async person(s,login){
  if(typeof login!=='string'||!LOGIN.test(login))fail('community_input');
  this.people??=new Map();const cached=this.people.get(login.toLowerCase());if(cached&&Date.now()-cached.at<10*60*1000)return cached.value;
  const user=await s.request('/api/v3/users/'+encodeURIComponent(login));if(typeof user?.login!=='string')fail('community_format');
  const text=(value,limit=200)=>typeof value==='string'&&value.trim()?value.trim().slice(0,limit):null;
  const source=safeUrl(String(user.avatar_url||''))||(Number.isSafeInteger(user.id)?new URL(`/avatars/u/${user.id}`,GHES_ORIGIN):null);
  let avatar=null;if(source&&typeof this.account.avatar==='function'){try{avatar=await this.account.avatar(source,s.token,undefined,AbortSignal.timeout(5000));}catch{avatar=null;}}
  const value={login:user.login,name:text(user.name),email:text(user.email,320),company:text(user.company),location:text(user.location),bio:text(user.bio,400),url:safeUrl(String(user.html_url||''))?.href||null,avatar:typeof avatar==='string'&&avatar.startsWith('data:image/')&&avatar.length<700000?avatar:null};
  this.people.set(login.toLowerCase(),{at:Date.now(),value});return value;
 }
 async call(a={}){
  const s=await this.session();
  if(a.action==='apps')return this.apps(s);
  if(a.action==='appIcon')return this.appIcon(s,a.id);
  if(a.action==='person')return this.person(s,a.login);
  if(a.action==='registerApp')return this.registerApp(s,a);
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
function workspaceAppUrl(base,id){if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id||''))fail('community_input');const url=new URL(webUrl(base));url.hash='workspace/site='+id;return url.href;}
module.exports={WorkspaceCommunity,decode,webUrl,workspaceAppUrl};
