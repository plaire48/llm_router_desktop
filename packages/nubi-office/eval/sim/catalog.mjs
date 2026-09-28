// Registers the answer-key mapping of each form in a simulated host, the way a
// user would have registered these templates earlier. Evaluation only.
import {createTemplateSession} from '../../worker/template.mjs';
import {createTemplateRecord} from '../../worker/template-library.mjs';

export async function installTemplates(host,forms){
  const installed=new Map();
  for(const form of forms){
    const initial=await host.call('init',form),session=createTemplateSession(initial.scope);
    session.confirm(session.propose(form.fields,initial.scope),initial.scope);
    const record=createTemplateRecord({name:form.title,purpose:form.purpose||form.title+' 작성',notes:'',profile:session.profile(),model:{model:'answer-key',provider:'evaluation'}});
    await host.call('template_register',{scopeId:initial.scope.scopeId,record,expectedFingerprint:initial.scope.fingerprint});
    await host.call('template_catalog_index',{templateId:record.id});
    installed.set(form.id,{record,before:initial.before});
  }
  return installed;
}
// The workbook the user happens to have open when asking for a template.
export const blankWorkbook={id:'blank',mode:'edit',workbookName:'통합 문서1.xlsx',sheetName:'Sheet1',range:'A1:C3',auditRange:'A1:F6',cells:{A1:{value:'메모'},A2:{value:1}}};
