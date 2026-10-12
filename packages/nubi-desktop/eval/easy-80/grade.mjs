import {changedPaths} from '../corpus.mjs';
import {mailId,dataId} from './fixtures.mjs';
import {leaderToolResults} from '../transcript.mjs';
const normalize=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[\s,，*_`]/g,'');
export function includesFact(text,alternatives){return alternatives.some(value=>normalize(text).includes(normalize(value)));}
export function evidenceChecks(testCase,run){
 const completed=(run.operations||[]).filter(row=>row.state==='completed'),checks=[];
 const add=(name,passed,detail)=>checks.push({name,passed:!!passed,...(detail?{detail}:{})});
 add('answer_facts',testCase.expected.every(group=>includesFact(run.answer,group)),testCase.expected.filter(group=>!includesFact(run.answer,group)));
 add('forbidden_absent',!(testCase.forbidden||[]).some(text=>includesFact(run.answer,[text])));
 if(testCase.category==='bash'){
  const ran=(run.commands||[]).filter(row=>row.execution==='started'&&row.state==='completed'&&row.exitCode===0);
  const catalog=ran.findIndex(row=>/report\.sh\s+catalog\s*$/.test(row.script));
  const calculation=ran.findIndex(row=>new RegExp('report\\.sh\\s+run\\s+["\']?'+dataId(testCase)+'["\']?\\s*$').test(row.script));
  add('multiple_bash_observations',catalog>=0&&calculation>catalog,ran.map(row=>row.script));
 }else if(testCase.category==='mail'){
  const read=completed.filter(row=>row.tool==='read_personal_mail').map(row=>row.receipt?.id);
  const expected=testCase.mails.map((_,i)=>mailId(testCase,i));
  add('mail_search',completed.some(row=>row.tool==='personal_mail_query'));
  add('multiple_originals_read',expected.filter(id=>read.includes(id)).length>=2);
  add('multiple_mail_citations',expected.filter(id=>run.sourceReferences?.some(ref=>ref.id===id)).length>=2);
  add('mail_scope',!(run.commands||[]).length);
 }else if(testCase.category==='skill'){
  const target=`.nubi/skill/${testCase.skill}/SKILL.md`;
  // The host already supplies a discovered catalog to the initial planner.
  // Do not require redundant discovery when the advertised skill is read.
  add('skill_available',completed.some(row=>row.tool==='discover_capabilities')||JSON.stringify(run.transcript?.[0]?.request||{}).includes(target));
  add('relevant_skill_read',completed.some(row=>['read_skill','use_skill'].includes(row.tool)&&row.path===target));
  add('no_script_or_message_execution',!(run.commands||[]).length);
 }else if(testCase.category==='wiki'){
  const paths=testCase.pages.map((_,i)=>`openwiki/policies/${testCase.id}-${i+1}.md`);
  const observed=leaderToolResults(run.transcript||[]).join('\n');
  const delegated=completed.some(row=>row.tool==='ask_openwiki'),searched=completed.some(row=>row.tool==='wiki_query');
  add('wiki_evidence',(testCase.evaluationVersion===2||delegated||searched)&&paths.every(p=>observed.includes(p)));
  if(testCase.evaluationVersion===2)checks.push({name:'wiki_route',passed:true,diagnostic:true,detail:delegated?'delegated':searched?'targeted_search':'direct_read'});
  add('wiki_citations',paths.every(p=>run.sourceReferences?.some(ref=>ref.path===p)));
 }
 return checks;
}
export async function gradeEasy(testCase,run){
 const checks=evidenceChecks(testCase,run);
 checks.unshift({name:'delivered',passed:run.state==='review'&&!!run.answer&&!run.error&&!run.needsHuman});
 const changed=await changedPaths(run.root);checks.push({name:'unchanged_files',passed:changed.length===0,detail:changed});
 const passed=checks.every(c=>c.passed);
 return {passed,outcome:run.error?'error':run.needsHuman?'needs_human':passed?'passed':'failed',checks,falseCompletion:!passed&&run.state==='review'&&run.reviewStatus==='ready'};
}
