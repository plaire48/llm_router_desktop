import {needsDevelopmentGuidance} from './development-workflow.mjs';

// A project request without an explicit connector scope must be able to begin
// coding without first guessing the right Korean/English trigger word.
export function preferOpenCodeCoding(task,{workspaceKind='project',scope=null}={}){
 if(scope&&scope!=='code')return false;
 if(scope==='code'||task.changePlan||task.workPlan?.intent?.workflowIds?.includes('source-change')||needsDevelopmentGuidance(task))return true;
 const workflows=task.workPlan?.intent?.workflowIds||[];
 if(workflows.some(id=>['mail','document','office','browser','computer'].includes(id)))return false;
 const latest=(task.messages||[]).findLast(m=>m.role==='user')?.content||task.request||'';
 if(/메일|이메일|엑셀|파워포인트|워드\s*문서|\b(?:xlsx|docx|pptx|spreadsheet)\b/i.test(latest))return false;
 return workspaceKind==='project'||/코드|코딩|버그|프로그래밍|함수|컴파일|리팩터|디버그|\b(?:code|coding|refactor|function|compile)\b/i.test(latest);
}
