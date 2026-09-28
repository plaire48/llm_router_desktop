import {excelCapabilities} from './excel-capabilities.mjs';
import {officeHost} from './office-hosts.mjs';
export const CONTENT_OPERATIONS=Object.freeze({word:['append_paragraph','append_table','replace_text','fill_field'],powerpoint:['add_slide','set_slide_content','duplicate_slide','replace_text']});
export const CONTENT_OPERATION_GUIDANCE={
  word:'Word 2016 only. Apply ONE operation JSON: {type:append_paragraph,text,style:Normal|Title|Heading1|Heading2|Heading3}, {type:append_table,rows:[[text]]}, {type:replace_text,targetId,text}, or {type:fill_field,targetId,text}. fill_field requires an observed native-editable plain content control; use its title/tag and ask missing facts. Append operations require an agent-owned new document. Existing targets must be observed and editable within the original scope. Never replay an uncertain write. PowerPoint operations are unavailable.',
  powerpoint:'PowerPoint 2016 only. Apply ONE operation JSON: {type:add_slide,title,bullets:[text],notes:text}, {type:set_slide_content,targetId,title,bullets:[text],notes:text} for an already-created draft slide, {type:duplicate_slide,targetId}, or {type:replace_text,targetId,text}. add_slide requires an agent-owned new presentation. Existing targets must be observed native-editable shapes in scope. Preserve mixed runs and slide masters; check overflow after writing. Never replay an uncertain write. Word paragraph/table/content-control operations are unavailable.'
};
export function officeCapabilities(host,runtime){
  officeHost(host);
  const valid=runtime?.host===host&&runtime?.platform==='win32'&&typeof runtime.officeVersion==='string'&&/^\d+(?:\.\d+)*$/.test(runtime.officeVersion)&&[32,64].includes(runtime.processBitness)&&Number.isFinite(runtime.observedAt);
  const observation=valid?{...runtime,version16:runtime.officeVersion.split('.')[0]==='16',office2016Edition:'unverified',source:'native_addin_start',instruction:'Office reports major version 16 for multiple editions. This snapshot does not identify perpetual Office 2016 or prove any document operation.'}:{state:'unverified',instruction:'Native Office runtime information is unavailable. Do not claim installed Office compatibility.'};
  return {host,target:'Windows Office 2016',runtime:observation,
    nativeOperations:host==='excel'?['set_values','set_formulas','format_range']:[...CONTENT_OPERATIONS[host]],
    capabilities:host==='excel'?excelCapabilities().capabilities:[
      {feature:host==='word'?'paragraphs, heading styles, tables, selected plain text controls':'slides, title/body, notes, selected editable shapes',status:'implemented_with_native_scope_checks'},
      {feature:'template copy, selected input fields, save and independent readback',status:'implemented_with_hitl_and_preservation_checks'},
      {feature:host==='word'?'headers/footers, TOC, image generation and tracked-change editing':'chart/image generation, SmartArt, animations and arbitrary layout design',status:'not_implemented'}
    ],
    skills:{discovery:'list_document_skills',activation:'use_document_skill',resources:['read','find'],scripts:['prepare_python','run_script'],note:'A skill cannot add unsupported COM operations. Binary package assets are preserved, not automatically editable Office templates. Adapt compatible code in memory drafts; never run arbitrary shell commands.'},
    validation:{sourceContracts:'implemented',actualOffice2016:'not_measured',liveModelQuality:'not_measured',nasca:'not_verified'},
    instruction:'This is declared tool coverage, not all Office features or a runtime success claim. Use only tools actually offered in this turn. Check current native editable flags and exact scope before proposing a write. Prefer native document APIs for content; UIA supplements observed GUI controls and cannot waive unsupported operations, HITL or readback. Ask for a supported alternative when essential requirements are unavailable.'};
}
