// Automatic approval (user decision 2026-09-30: three modes and "always allow", as in Codex and Claude Code).
// The mode is kept for each project:
//   ask       every proposal waits for the user;
//   edits     file proposals are applied as they come;
//   commands  file proposals, and the project's own check commands: a test, build, lint or check script that the
//             manifest declares, run by its package manager with nothing else on the line.
// A command the user allowed runs by itself in every mode. Administrator commands and app control always wait for
// the user. Commands run without isolation, so no other command is automatic.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fail} from './files.mjs';
import {irreversibleCommand,irreversibleProposal,commandSegments} from './irreversible-actions.mjs';
import {allowPattern,wildcardMatch} from './command-prefix.mjs';

export const APPROVAL_MODES=Object.freeze(['ask','edits','commands']);
const KEY='setting:approvals',ALLOWED_LIMIT=100;
const CHECK_SCRIPT=/^(?:test|tests|build|lint|check|typecheck|type-check|verify|validate)(?:[:-][\w.-]+)?$/i;
// A name that also says it ships, changes files or data, or runs on is never a check, whatever it starts with:
// lint:fix rewrites files that no proposal showed.
const NOT_A_CHECK=/deploy|publish|release|push|upload|migrat|install|seed|drop|reset|clean|start|serve|watch|fix|format|write|update/i;
const OPERATORS=/[;&|<>`$()\\\r\n]/;
const plain=script=>typeof script==='string'?script.trim():'';

export function approvalPolicy(store){
  const value=store.get(KEY);
  return {mode:APPROVAL_MODES.includes(value?.mode)?value.mode:'ask',allowedCommands:Array.isArray(value?.allowedCommands)?value.allowedCommands:[],allowedMcpTools:Array.isArray(value?.allowedMcpTools)?value.allowedMcpTools:[]};
}
export function setApprovalMode(store,mode){
  if(!APPROVAL_MODES.includes(mode))fail('approval_mode_invalid');
  store.set(KEY,{...approvalPolicy(store),mode});return approvalPolicy(store);
}
// Always-allow prefixes adopted from opencode (packages/core/src/shell/parse.ts, permission.ts at d93568f3; user request
// 2026-10-23): allowing a command also saves the deciding words of each subcommand ("npm run test *"). A later command
// runs by itself only when every subcommand matches a saved prefix of the same shell and it is not irreversible. A line
// with substitution, redirection, escapes or grouping is not read, so only its exact text can be allowed, and deletion
// and privilege programs never get a prefix.
const UNREAD=/[`$<>()\\{}]/;
const NEVER_GENERAL=new Set(['rm','rmdir','del','erase','rd','ri','remove-item','sudo','su','doas','runas','dd','mkfs','format','diskpart','shutdown','reboot','kill','killall','taskkill','stop-process','chmod','chown','icacls','takeown']);
const program=word=>String(word||'').split(/[\\/]/).at(-1).toLowerCase().replace(/\.(?:exe|cmd|bat)$/,'');
export function commandScan(script){
  const text=plain(script);
  if(!text||UNREAD.test(text))return null;
  const parts=commandSegments(text);
  return parts.length?parts.map(words=>({resource:words.join(' '),save:NEVER_GENERAL.has(program(words[0]))?null:allowPattern(words)})):null;
}
const prefixAllowed=(policy,{profile,script})=>{
  const scan=commandScan(script);
  if(!scan||irreversibleCommand(script).matched)return false;
  const patterns=policy.allowedCommands.filter(item=>item.profile===profile).flatMap(item=>Array.isArray(item.patterns)?item.patterns:[]);
  return patterns.length>0&&scan.every(part=>part.save!==null&&patterns.some(pattern=>wildcardMatch(part.resource,pattern)));
};
export const commandAllowed=(policy,{profile,script})=>policy.allowedCommands.some(item=>item.profile===profile&&item.script===plain(script))||prefixAllowed(policy,{profile,script});
// "Always allow" keeps the exact command for its shell plus its prefixes. It never covers an administrator command.
export function allowCommand(store,{profile,script,privilege}){
  if(privilege==='administrator')fail('approval_administrator');
  if(typeof profile!=='string'||!profile||!plain(script)||plain(script).length>16000)fail('approval_command_invalid');
  const policy=approvalPolicy(store);
  if(!policy.allowedCommands.some(item=>item.profile===profile&&item.script===plain(script))){
    if(policy.allowedCommands.length>=ALLOWED_LIMIT)fail('approval_command_limit');
    const patterns=[...new Set((commandScan(script)||[]).map(part=>part.save).filter(Boolean))];
    store.set(KEY,{...policy,allowedCommands:[...policy.allowedCommands,{profile,script:plain(script),patterns,addedAt:new Date().toISOString()}]});
  }
  return approvalPolicy(store);
}
export const mcpToolAllowed=(policy,{serverId,tool})=>(policy.allowedMcpTools||[]).some(item=>item.serverId===serverId&&item.tool===tool);
export function allowMcpTool(store,{serverId,tool}){
  if(typeof serverId!=='string'||!serverId||typeof tool!=='string'||!tool)fail('approval_mcp_invalid');
  const policy=approvalPolicy(store);
  if(!mcpToolAllowed(policy,{serverId,tool})){
    if(policy.allowedMcpTools.length>=ALLOWED_LIMIT)fail('approval_command_limit');
    store.set(KEY,{...policy,allowedMcpTools:[...policy.allowedMcpTools,{serverId,tool,addedAt:new Date().toISOString()}]});
  }
  return approvalPolicy(store);
}
export function removeAllowedMcpTool(store,{serverId,tool}){
  const policy=approvalPolicy(store);
  store.set(KEY,{...policy,allowedMcpTools:policy.allowedMcpTools.filter(item=>!(item.serverId===serverId&&item.tool===tool))});
  return approvalPolicy(store);
}
export function removeAllowedCommand(store,{profile,script}){
  const policy=approvalPolicy(store);
  store.set(KEY,{...policy,allowedCommands:policy.allowedCommands.filter(item=>!(item.profile===profile&&item.script===plain(script)))});
  return approvalPolicy(store);
}

// A check command of the project. npm runs only its test script without `run`. Watch modes never end on their own.
export function checkCommand(script,scripts={}){
  const text=plain(script);
  if(!text||OPERATORS.test(text)||/watch/i.test(text))return false;
  const match=/^(npm|pnpm|yarn)(?:\.cmd)?\s+(?:(run|run-script)\s+)?([\w:.-]+)(?:\s+--(?:\s+[\p{L}\p{N}_:./=@,+-]+)*)?$/iu.exec(text);
  if(!match)return false;
  const [,manager,run,name]=match;
  if(manager.toLowerCase()==='npm'&&!run&&name!=='test')return false;
  return Object.hasOwn(scripts,name)&&CHECK_SCRIPT.test(name)&&!NOT_A_CHECK.test(name);
}
async function manifestScripts(root){
  try{const value=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));return value?.scripts&&typeof value.scripts==='object'&&!Array.isArray(value.scripts)?value.scripts:{};}
  catch{return {};}
}

// What the host may carry out now without the user: the file proposals to apply, or else one command to run.
// Nothing while the agent runs, a question waits or a command is running.
export async function autoApprovals(service,{taskId}){
  const task=service.task(taskId),policy=approvalPolicy(service.store),none={mode:policy.mode,proposals:[],command:null};
  if(service.agent?.running||task.question||task.state!=='review'||service.setupBusy||service.afterEditChecks?.has(taskId)||service.processes?.active.size||service.processes?.pending.size)return none;
  const state=service.state(),open=state.proposals.filter(p=>p.taskId===taskId&&p.state==='proposed').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  // Store reasons before returning any automatic action; the next state snapshot renders them.
  const annotate=(prefix,row,classification)=>{
    if(classification.matched&&service.store.get(prefix+row.id)?.irreversible?.reason!==classification.reason){row.irreversible={reason:classification.reason};service.store.set(prefix+row.id,{...service.store.get(prefix+row.id),irreversible:row.irreversible});}
  };
  for(const row of open)annotate('proposal:',row,irreversibleProposal(row));
  for(const [prefix,rows] of [['setup-action:',state.setupActions||[]],['command-repair:',state.commandRepairs||[]]])for(const row of rows)if(row.taskId===taskId&&row.state==='proposed'&&row.kind!=='input')annotate(prefix,row,irreversibleCommand(row.script));
  if(policy.mode!=='ask'&&open.length){
    // The newest proposal of each file, as the editor applies them.
    const seen=new Set(),proposals=[];for(const p of open)if(!seen.has(p.path)){seen.add(p.path);if(!p.sourceChanged&&!irreversibleProposal(p).matched)proposals.push(p.id);}
    return {...none,proposals};
  }
  const scripts=policy.mode==='commands'?await manifestScripts(await service.target(taskId)):{};
  if(service.afterEditChecks?.has(taskId))return none;
  const waiting=action=>(action.afterProposals||[]).some(id=>service.store.get('proposal:'+id)?.state==='proposed');
  const commands=[...(state.setupActions||[]).filter(v=>v.taskId===taskId&&v.state==='proposed'&&v.kind!=='input'&&v.privilege!=='administrator'&&!waiting(v)).map(value=>({kind:'setup',value})),
    ...(state.commandRepairs||[]).filter(v=>v.taskId===taskId&&v.state==='proposed').map(value=>({kind:'repair',value}))]
    .sort((a,b)=>String(a.value.createdAt).localeCompare(String(b.value.createdAt)));
  for(const {kind,value:observed} of commands){
    // Manifest reading yields. A completed edit batch may have revoked automatic
    // checking on this card while that read was in flight.
    const value=service.store.get((kind==='setup'?'setup-action:':'command-repair:')+observed.id);
    if(!value||value.state!=='proposed'||waiting(value))continue;
    const reason=commandAllowed(policy,value)?'allowed':policy.mode==='commands'&&!value.manifestChanged&&!irreversibleCommand(value.script).matched&&checkCommand(value.script,scripts)?'check':null;
    if(reason)return {...none,command:{kind,id:value.id,fingerprint:value.fingerprint,script:value.script,reason}};
  }
  return none;
}

export function installApprovalPolicy(ProjectService){
  ProjectService.prototype.approvalPolicy=function(){this.ready();return approvalPolicy(this.store);};
  ProjectService.prototype.setApprovalMode=function({mode}){this.ready();return setApprovalMode(this.store,mode);};
  // Always allow the command of a proposal the user sees, then approve it as usual.
  ProjectService.prototype.allowCommand=function({kind='setup',id}){
    this.ready();const value=this.store.get((kind==='repair'?'command-repair:':'setup-action:')+id);
    if(!value||value.kind==='input')fail('approval_command_invalid');
    return allowCommand(this.store,value);
  };
  ProjectService.prototype.removeAllowedCommand=function({profile,script}){this.ready();return removeAllowedCommand(this.store,{profile,script});};
  ProjectService.prototype.removeAllowedMcpTool=function({serverId,tool}){this.ready();return removeAllowedMcpTool(this.store,{serverId,tool});};
  ProjectService.prototype.autoApprovals=function({taskId}){this.ready();return autoApprovals(this,{taskId});};
}
