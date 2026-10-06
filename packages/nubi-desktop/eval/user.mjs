// The simulated user of an evaluation case. It answers only what the case
// defines and approves only what the case allows. Anything else needs a
// person: the case then ends as needs_human instead of guessing.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const questionText=question=>typeof question==='string'?question:String(question?.text||'');
// A command the simulated user reads as one plain command: output redirection to the same stream, a trailing
// tail or head and a change into the workspace itself are dropped first; any other shell operator needs a person.
const MERGED_OUTPUT=/\s+2>&1$/,SHORTENED=/\s*\|\s*(?:tail|head)(?:\s+-n)?\s+-?\d{1,4}$/,OPERATORS=/[;&|<>`$()\\\r\n]/;
const INTO=/^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|'"]+))\s*&&\s*/;
// The same plain command as PowerShell or CMD writes it (2026-09-30, for runs on a Windows PC): a backslash separates a
// path there, output is cut with Select-Object, and the workspace is entered with Set-Location or cd before ; or &&.
// Their own expansions ($, %, ^ and the backtick) still need a person.
const WINDOWS_SHELLS=new Set(['powershell','pwsh','cmd']),SELECTED=/\s*\|\s*(?:Select-Object|select)\s+-(?:Last|First)\s+\d{1,4}$/i;
const WINDOWS_OPERATORS=/[;&|<>`$()%^\r\n]/,WINDOWS_INTO=/^(?:cd|chdir|Set-Location|sl|Push-Location|pushd)(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|'"]+))\s*(?:;|&&)\s*/i;
export function commandVerdict(patterns,script,root,profile='bash'){
  const windows=WINDOWS_SHELLS.has(String(profile).toLowerCase());
  let rest=String(script||'').trim();
  for(;;){const next=rest.replace(MERGED_OUTPUT,'').replace(SHORTENED,'').replace(windows?SELECTED:SHORTENED,'');if(next===rest)break;rest=next;}
  const into=(windows?WINDOWS_INTO:INTO).exec(rest);
  if(into){if(path.resolve(root,into[1]??into[2]??into[3])!==path.resolve(root))return 'outside_workspace';rest=rest.slice(into[0].length);}
  if(!rest||(windows?WINDOWS_OPERATORS:OPERATORS).test(rest))return 'not_allowed';
  return (patterns||[]).some(item=>new RegExp('^(?:'+item+')$','iu').test(rest))?'allowed':'not_allowed';
}

export function createUser(testCase){
  const used=new Set(),tried=new Set(),log={questions:[],answers:[],applied:[],refused:[],commands:[]};
  return{
    log,
    // Returns answerAgent arguments, or null when no single defined answer fits.
    answer(question){
      const asked=questionText(question);log.questions.push(asked);
      const matches=(testCase.dialogue||[]).map((item,index)=>({...item,index})).filter(item=>!used.has(item.index)&&new RegExp(item.match,'iu').test(asked));
      if(matches.length!==1)return null;
      used.add(matches[0].index);log.answers.push(matches[0].answer);
      if(typeof question==='string')return {answer:matches[0].answer};
      const option=(question.options||[]).find(item=>item.label===matches[0].answer);
      return {choice:option?{questionId:question.id,optionId:option.id}:{questionId:question.id,text:matches[0].answer}};
    },
    allows:kind=>(testCase.approvals||[]).includes(kind),
    // Approves this task's oldest open command when the case allows it: a setup action or a command repair,
    // never an administrator command. Returns the process it started, {refused} when a person has to decide,
    // or null when no command is open.
    async approveCommand({service,taskId,root}){
      const state=service.state();
      const open=[...(state.setupActions||[]).map(value=>({kind:'setup',value})),...(state.commandRepairs||[]).map(value=>({kind:'repair',value}))]
        .filter(({value})=>value.taskId===taskId&&value.state==='proposed'&&!tried.has(value.id))
        .sort((a,b)=>String(a.value.createdAt).localeCompare(String(b.value.createdAt)));
      if(!open.length)return null;
      const {kind,value}=open[0];tried.add(value.id);
      const verdict=!this.allows('command')?'not_allowed':value.privilege==='administrator'?'administrator':commandVerdict(testCase.commands,value.script,root,value.profile);
      if(verdict!=='allowed'){log.refused.push({kind:'command',script:value.script,reason:verdict});return {refused:verdict};}
      try{
        const decided=kind==='setup'?await service.decideSetupAction({id:value.id,fingerprint:value.fingerprint,decision:'approve'}):await service.applyCommandRepair({id:value.id});
        log.commands.push({kind,script:value.script,state:decided.state});
        return decided.resultProcessId?{processId:decided.resultProcessId}:{skipped:decided.state};
      }catch(error){
        const reason=/^[a-z_]{1,64}$/.test(error.message)?error.message:'approve_failed';
        log.commands.push({kind,script:value.script,state:'failed',reason});return {skipped:reason};
      }
    },
  };
}

// Applies this task's open proposals the way the editor does: the newest
// proposal per path, write, then let the host confirm the saved hash.
// Commands are approved separately (approveCommand); elevation and computer actions never are.
export async function applyProposals({service,taskId,user,root}){
  const open=service.state().proposals.filter(proposal=>proposal.taskId===taskId&&proposal.state==='proposed')
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),seen=new Set();
  for(const proposal of open){
    if(seen.has(proposal.path))continue;seen.add(proposal.path);
    const kind=proposal.kind==='create'?'new_file':'patch';
    if(!user.allows(kind)){user.log.refused.push({path:proposal.path,kind,reason:'not_allowed'});continue;}
    try{
      if(kind==='new_file')await service.applyNewFile({proposalId:proposal.id});
      else{
        const prepared=await service.prepareProposal({proposalId:proposal.id});
        if(!prepared.alreadyApplied){await writeFile(path.join(root,proposal.path),prepared.content);await service.confirmProposal({proposalId:proposal.id});}
      }
      user.log.applied.push({path:proposal.path,kind});
    }catch(error){user.log.refused.push({path:proposal.path,kind,reason:/^[a-z_]{1,64}$/.test(error.message)?error.message:'apply_failed'});}
  }
  return user.log;
}
