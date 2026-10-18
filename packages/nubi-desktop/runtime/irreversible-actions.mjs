// Classification only. Existing host approval and execution contracts remain authoritative.
function segments(script){
 const result=[],words=[];let word='',quote=null,started=false;
 const flush=()=>{if(started)words.push(word);word='';started=false;};
 const end=()=>{flush();if(words.length)result.push(words.splice(0));};
 for(const char of String(script||'')){
  if(quote){if(char===quote)quote=null;else word+=char;continue;}
  if(char==='"'||char==="'"){quote=char;started=true;continue;}
  if(/[;&|\r\n]/.test(char)){end();continue;}
  if(/\s/.test(char)){flush();continue;}
  word+=char;started=true;
 }
 end();return result;
}
const base=value=>String(value||'').split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/,'');
function normalized(words){
 let args=[...words],program=base(args.shift());
 for(let depth=0;depth<8&&['sudo','env','nice','time'].includes(program);depth++){
  while(args.length&&(args[0].startsWith('-')||program==='env'&&/^[A-Za-z_][\w]*=/.test(args[0]))){const option=args.shift();if(['-u','-g','-n','--user','--group','--adjustment'].includes(option))args.shift();}
  program=base(args.shift());
 }
 return [program,...args];
}
export function irreversibleCommand(script,depth=0){
 if(depth>4)return {matched:false};
 for(const words of segments(script)){
  const [command,...args]=normalized(words);
  if(['powershell','pwsh','cmd','sh','bash','zsh'].includes(command)){
   const at=args.findIndex(a=>/^(?:-c|\/c|-command|-encodedcommand)$/i.test(a));
   if(at>=0){let payload=args.slice(at+1).join(' ');if(/^-encodedcommand$/i.test(args[at])){try{payload=Buffer.from(payload,'base64').toString('utf16le');}catch{payload='';}}const found=irreversibleCommand(payload,depth+1);if(found.matched)return found;}
  }
  const flags=args.filter(a=>/^-[^-]/.test(a)).map(a=>a.slice(1)).join('');
  const psFlag=name=>args.some(a=>a.startsWith('-')&&a.length>1&&name.startsWith(a.slice(1).toLowerCase()));
  if(command==='rm'&&(args.includes('--recursive')||flags.includes('r')||flags.includes('R'))&&(args.includes('--force')||flags.includes('f')))return {matched:true,reason:'재귀 삭제'};
  if(['rm','rmdir','del','erase','rd','remove-item'].includes(command)&&psFlag('recurse')&&psFlag('force'))return {matched:true,reason:'재귀 삭제'};
  if(/^(rd|rmdir|del|erase)$/.test(command)&&args.some(a=>/^\/s$/i.test(a)))return {matched:true,reason:'재귀 삭제'};
  if(command!=='git')continue;
  while(args[0]?.startsWith('-')){const option=args.shift();if(['-C','-c','--git-dir','--work-tree','--namespace','--config-env'].includes(option))args.shift();}
  if(args[0]==='push'&&args.some(a=>/^(--force(?:-with-lease)?(?:=.*)?|-f)$/.test(a)))return {matched:true,reason:'강제 push'};
  if(args[0]==='reset'&&args.includes('--hard')||args[0]==='clean'&&flags.includes('f')||args[0]==='checkout'&&args.includes('--')&&args.includes('.'))return {matched:true,reason:'작업 내용 버리기'};
 }
 return {matched:false};
}
export function irreversibleProposal(proposal){return proposal?.kind==='delete'?{matched:true,reason:'기존 파일 삭제'}:{matched:false};}
const MCP_NAME=new Set(['send','publish','post','submit','deliver','notify','mail','delete','remove','purge','drop','destroy','truncate','reset']);
export function irreversibleMcpTool(tool,{serverId}={}){
 if(serverId==='playwright')return {matched:false};
 const a=tool?.annotations||{};if(a.readOnlyHint===true)return {matched:false};
 if(a.destructiveHint===true)return {matched:true,reason:'삭제 도구'};
 if(a.openWorldHint===true)return {matched:true,reason:'외부 반영 도구'};
 return String(tool?.name||'').replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().split(/[_\s-]+/).some(token=>MCP_NAME.has(token))?{matched:true,reason:'외부 반영 또는 삭제 도구(이름)'}:{matched:false};
}

// Read-only state projection also covers ask mode, which never polls autoApprovals.
export function approvalActionView(row){
 if(row.state!=='proposed'||row.kind==='input')return row;
 const classification=row.script!==undefined?irreversibleCommand(row.script):irreversibleProposal(row);
 const {irreversible,...rest}=row;
 return classification.matched?{...rest,irreversible:{reason:classification.reason}}:rest;
}
