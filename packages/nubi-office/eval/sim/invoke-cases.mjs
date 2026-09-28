// Cases for calling a registered template by command or by sentence. The
// catalog holds five templates; two of them start with "출장".
import {forms,formById} from './forms.mjs';

const quotation=formById('quotation'),trip=formById('trip-request');
export const invokeCases=[
  ...forms.flatMap(form=>[
    {id:'command-'+form.id,form:form.id,request:`/${form.title.replaceAll(' ','')} ${form.reuse.request}`,dialogue:form.reuse.dialogue},
    {id:'sentence-'+form.id,form:form.id,request:form.reuse.request,dialogue:form.reuse.dialogue}
  ]),
  {id:'command-initials',form:'quotation',request:'/ㄱㅈㅅ '+quotation.reuse.request,dialogue:quotation.reuse.dialogue},
  {id:'command-ambiguous',form:'trip-request',request:'/출장 '+trip.reuse.request,dialogue:[{match:'어느 양식',answer:'출장 신청서'},...trip.reuse.dialogue]},
  {id:'command-unknown',expect:'none',request:'/회의록 오늘 회의 내용을 정리해줘',dialogue:[]},
  {id:'sentence-unrelated',expect:'edit',request:'A2의 값을 4로 바꿔줘. 다른 셀은 그대로 둬.',dialogue:[],checks:[{address:'A2',field:'value',operator:'equals',expected:4}],allowedChanges:['A2:value']}
];
