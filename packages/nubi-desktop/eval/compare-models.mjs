// Cross-model comparison is deliberately separate from same-model candidate
// comparisons. Require complete, identical trials and an unchanged candidate.
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const SETTINGS=['candidate','caseHash','computerHash','appsHash','corpora','limits','computerLimits','platform','node','tools','trials'];
const key=row=>row.id+'#'+(row.trial??1);
function validate(run){
  const {manifest,completion,agent,computer}=run;
  if(!manifest?.model||completion?.stable!==true||!completion.finishedAt)throw new Error('comparison_incomplete');
  if(!SETTINGS.every(k=>manifest[k]!==undefined)||!manifest.candidate?.hash)throw new Error('comparison_manifest_missing');
  if(agent?.kind!=='desktop-live-model-evaluation'||computer?.kind!=='desktop-computer-evaluation')throw new Error('comparison_report_invalid');
  for(const report of [agent,computer]){
    if(report.model!==manifest.model||report.candidate?.hash!==manifest.candidate.hash||report.tools!==manifest.tools)throw new Error('comparison_report_mismatch');
    if(!Array.isArray(report.results)||report.results.some(r=>r.outcome==='not_run'))throw new Error('comparison_incomplete');
  }
  const actual=agent.results.map(key).sort();
  const expected=manifest.cases.flatMap(id=>Array.from({length:manifest.trials},(_,i)=>id+'#'+(i+1))).sort();
  // Computer reports currently support one trial per case only.
  if(manifest.trials!==1||!isDeepStrictEqual(actual,expected)||!isDeepStrictEqual(computer.results.map(r=>r.id).sort(),[...manifest.computer].sort()))throw new Error('comparison_case_mismatch');
}
function totals(rows,computer=false){
  return {total:rows.length,passed:rows.filter(r=>r.outcome==='passed').length,
    delivered:rows.filter(r=>r.state==='review'&&(computer?!!r.answer:r.answerCharacters>0)).length,
    falseCompletion:rows.filter(r=>computer?r.outcome==='failed'&&r.state==='review'&&r.reviewStatus==='ready':r.falseCompletion===true).length,
    needsHuman:rows.filter(r=>r.outcome==='needs_human').length,errors:rows.filter(r=>r.outcome==='error').length,
    modelCalls:rows.reduce((sum,r)=>sum+(r.modelCalls||0),0),delegatedCalls:rows.reduce((sum,r)=>sum+(r.delegatedCalls||0),0),elapsedMs:rows.reduce((sum,r)=>sum+(r.elapsedMs||0),0)};
}
export function compareModels(left,right){
  validate(left);validate(right);
  for(const setting of SETTINGS)if(!isDeepStrictEqual(left.manifest[setting],right.manifest[setting]))throw new Error('comparison_settings_differ:'+setting);
  const models=[left,right].map(run=>({model:run.manifest.model,
    agent:totals(run.agent.results.filter(r=>!r.reducedWindow)),stress:totals(run.agent.results.filter(r=>r.reducedWindow)),computer:totals(run.computer.results,true)}));
  const rows=[];
  for(const suite of ['agent','computer']){
    const other=new Map(right[suite].results.map(r=>[key(r),r]));
    for(const r of left[suite].results){const next=other.get(key(r));rows.push({suite:r.reducedWindow?'stress':suite,id:r.id,trial:r.trial??1,outcomes:[r.outcome,next.outcome],calls:[r.modelCalls,next.modelCalls],delegated:[r.delegatedCalls,next.delegatedCalls]});}
  }
  return {candidate:left.manifest.candidate.hash,models,rows};
}
export function renderModels(report){
  const lines=['# 동일 하네스 모델 비교','',`후보: ${report.candidate}`,'','| 범위와 지표 | '+report.models.map(m=>m.model).join(' | ')+' |','| --- | ---: | ---: |'];
  for(const [suite,label] of [['agent','일반 작업'],['stress','좁은 문맥'],['computer','가상 앱']]){
    if(report.models.every(m=>m[suite].total===0))continue;
    lines.push(`| ${label} 독립 통과 | ${report.models.map(m=>m[suite].passed+'/'+m[suite].total).join(' | ')} |`);
    for(const [metric,title] of [['delivered','답변 전달'],['falseCompletion','검토와 채점 불일치'],['needsHuman','사람 확인 필요'],['errors','오류'],['modelCalls','주 실행기 호출'],['delegatedCalls','OpenWiki 호출']])lines.push(`| ${label} ${title} | ${report.models.map(m=>m[suite][metric]).join(' | ')} |`);
  }
  lines.push('','## 과제별','','| 과제 | 왼쪽 모델 | 오른쪽 모델 | 주 실행기 호출 |','| --- | --- | --- | ---: |');
  for(const r of report.rows)lines.push(`| ${r.id} | ${r.outcomes.join(' | ')} | ${r.calls.join(' / ')} |`);
  lines.push('','과제당 1회인 제한된 비교입니다. 실제 모델이 가상 Windows 앱을 조작했으며 실제 Windows 입력이나 사내 모델 성능을 검증한 결과가 아닙니다. 서버 부하와 동시 실행 때문에 응답 시간으로 우열을 판정하지 않습니다.','');
  return lines.join('\n');
}
export async function loadModelRun(directory){
  const read=async file=>JSON.parse(await readFile(path.join(directory,file),'utf8'));
  return {manifest:await read('manifest.json'),completion:await read('completion.json'),agent:await read('agent/report.json'),computer:await read('computer/report.json')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [a,b]=process.argv.slice(2);
  if(!a||!b)throw new Error('Usage: node eval/compare-models.mjs <first run directory> <second run directory>');
  console.log(renderModels(compareModels(await loadModelRun(a),await loadModelRun(b))));
}
