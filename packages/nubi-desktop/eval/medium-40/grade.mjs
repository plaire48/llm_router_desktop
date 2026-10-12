import {changedPaths} from '../corpus.mjs';
import {mailId,datasetId} from './fixtures.mjs';
import {leaderToolResults} from '../transcript.mjs';

const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s,，*_`]/g,'');
// Numeric facts cannot pass by appearing inside a different, larger number.
export function includesFact(text,alternatives){
 const answer=normalize(text);
 return alternatives.some(value=>{
  const fact=normalize(value);let start=0,index;
  while((index=answer.indexOf(fact,start))>=0){
   const before=answer[index-1]||'',after=answer[index+fact.length]||'';
   if(!(/^\d/.test(fact)&&/[\d.]/.test(before))&&!(/\d$/.test(fact)&&/[\d.]/.test(after)))return true;
   start=index+1;
  }
  return false;
 });
}
export function evidenceChecks(c,run){
 const completed=(run.operations||[]).filter(r=>r.state==='completed'),checks=[];
 const add=(name,passed,detail)=>checks.push({name,passed:!!passed,...(detail!==undefined?{detail}:{})});
 add('answer_facts',c.expected.every(g=>includesFact(run.answer,g)),c.expected.filter(g=>!includesFact(run.answer,g)));
 add('forbidden_absent',!(c.forbidden||[]).some(f=>includesFact(run.answer,[f])));
 if(c.category==='bash'){
  const ran=(run.commands||[]).filter(r=>r.execution==='started'&&r.state==='completed'&&r.exitCode===0);
  const catalog=ran.findIndex(r=>/report\.sh\s+catalog\s*$/.test(r.script));
  const reads=c.requiredDatasets.map(i=>ran.findIndex(r=>new RegExp('report\\.sh\\s+read\\s+["\']?'+datasetId(c,i)+'["\']?\\s*$').test(r.script)));
  add('multiple_bash_observations',catalog>=0&&reads.every(index=>index>catalog),ran.map(r=>r.script));
 }else if(c.category==='mail'){
  const read=completed.filter(r=>r.tool==='read_personal_mail').map(r=>r.receipt?.id),ids=c.requiredMails.map(i=>mailId(c,i));
  add('mail_search',completed.some(r=>r.tool==='personal_mail_query'));
  add('required_originals_read',ids.every(id=>read.includes(id)),ids.filter(id=>!read.includes(id)));
  add('required_mail_citations',ids.every(id=>run.sourceReferences?.some(ref=>ref.id===id)),ids.filter(id=>!run.sourceReferences?.some(ref=>ref.id===id)));
 }else if(c.category==='skill'){
  const paths=c.requiredSkills.map(name=>`.nubi/skill/${name}/SKILL.md`);
  add('relevant_skills_read',paths.every(p=>completed.some(r=>['read_skill','use_skill'].includes(r.tool)&&r.path===p)),paths);
  add('input_facts_read',leaderToolResults(run.transcript||[]).join('\n').includes(c.context));
 }else{
  const paths=c.requiredPages.map(i=>`openwiki/policies/${c.id}-${i+1}.md`),observed=leaderToolResults(run.transcript||[]).join('\n');
  add('wiki_evidence',paths.every(p=>observed.includes(p)));
  add('wiki_citations',paths.every(p=>run.sourceReferences?.some(ref=>ref.path===p)));
  checks.push({name:'wiki_route',passed:true,diagnostic:true,detail:completed.some(r=>r.tool==='ask_openwiki')?'delegated':completed.some(r=>r.tool==='wiki_query')?'targeted_search':'direct_read'});
 }
 if(c.category!=='bash')add('no_unrequested_execution',!(run.commands||[]).length);
 return checks;
}
export async function gradeMedium(c,run){
 const checks=evidenceChecks(c,run);
 checks.unshift({name:'delivered',passed:run.state==='review'&&!!run.answer&&!run.error&&!run.needsHuman});
 const changed=await changedPaths(run.root);checks.push({name:'unchanged_files',passed:changed.length===0,detail:changed});
 const passed=checks.every(c=>c.passed);
 return {passed,outcome:run.error?'error':run.needsHuman?'needs_human':passed?'passed':'failed',checks,falseCompletion:!passed&&run.state==='review'&&run.reviewStatus==='ready'};
}
