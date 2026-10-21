import React,{useId,useState} from 'react';
import {CxButton,CxInput,CxTextarea} from '@e2e/cx-design-system';
import {InteractionSurface} from '../../../extensions/aipro-chat/src/InteractionSurface.jsx';
import {SettingsField,SettingsSection} from './SettingsSection.jsx';
import {NativeDocumentPreview} from './NativeDocumentPreview.jsx';
import {CollectionTable} from './CollectionTable.jsx';
import {formState,formSourceText,validFormOutput} from './form-cards-view.mjs';

function Evidence({sources=[]}){return sources.map((source,i)=><p className="nubi-form-source" key={i}>{formSourceText(source)}</p>);}
function FillSheet({sheet={}}){return <div className="nubi-form-sheet">
 {(sheet.cells||[]).map((cell,i)=><div className="nubi-form-value" key={cell.slot||i}><strong>{cell.label||cell.slot}</strong><p>{String(cell.value??'')}</p><Evidence sources={[cell.source]}/></div>)}
 {(sheet.rows||[]).map((row,i)=><section key={row.slot||i}><h3>{row.label||row.slot}</h3><div className="nubi-form-table" role="region" aria-label={`${row.label||row.slot} 채울 행`} tabIndex={0}><CollectionTable variant="reading"><thead><tr>{(row.header||[]).map((h,j)=><th scope="col" key={j}>{h}</th>)}</tr></thead><tbody>{(row.rows||[]).map((r,j)=><tr key={j}>{r.map((v,k)=><td key={k}>{String(v??'')}</td>)}</tr>)}</tbody></CollectionTable></div><Evidence sources={[row.source]}/></section>)}
 {(sheet.sections||[]).map((section,i)=><section key={section.section||i}><h3>{section.title||section.section}</h3>{(section.paragraphs||[]).map((p,j)=><p key={j}>{typeof p==='string'?p:p.text}</p>)}<Evidence sources={section.sources||[]}/></section>)}
 {sheet.missing?.length>0&&<p role="status">아직 채우지 못한 칸: {sheet.missing.map(x=>x.label||x.slot).join(', ')}</p>}
 </div>;}
export function FormFillCard({plan,busy,output,onOutput,source,onAnswer,onApply,onCancel,onRefresh,onRender,images={},onOpen}){
 const id=useId(),[answers,setAnswers]=useState({}),state=formState(plan),sheet=state==='approval'?plan.card?.fill:plan.sheet;
 if(state==='asking')return <form onSubmit={e=>{e.preventDefault();onAnswer(answers);}}><SettingsSection icon="message" title="작성에 필요한 내용">{(plan.questions||[]).map((q,i)=><SettingsField key={q.slot} id={`${id}-${i}`} label={q.label||q.slot} description={q.question}><CxTextarea disabled={busy} value={answers[q.slot]||''} onChange={e=>setAnswers(v=>({...v,[q.slot]:e.target.value}))}/></SettingsField>)}</SettingsSection><div className="nubi-form-actions"><CxButton disabled={busy} onClick={onCancel}>작성 취소</CxButton><CxButton type="submit" variant="primary" disabled={busy}>답변 보내기</CxButton></div></form>;
 return <InteractionSurface className="nubi-form-card action-approval" icon="file" title={state==='ready'?'사본에 채울 내용':state==='approval'?(plan.card?.title||'수정된 채움표 확인'):state==='written'?'사본 저장 결과':'문서 작성 상태'}>
 {state==='running'?<p role="status">문서를 작성하고 있어요.</p>:state==='failed'?<p role="alert">작성을 마치지 못했어요. 현재 상태를 확인해 주세요.</p>:state==='cancelled'?<p role="status">작성을 취소했어요.</p>:state==='unknown'?<p role="alert">작성 상태를 확인하지 못했어요.</p>:null}
 {state==='approval'&&plan.card?.summary&&<p>{plan.card.summary}</p>}
 {state==='written'&&<p>반영한 칸: {[...(plan.sheet?.cells||[]),...(plan.sheet?.rows||[])].map(row=>row.label||row.slot).join(', ')||'해당 없음'}</p>}{['ready','approval'].includes(state)&&<FillSheet sheet={sheet}/>}{state==='written'&&<details><summary>반영한 내용과 출처</summary><FillSheet sheet={sheet}/></details>}
 {state==='ready'&&<SettingsField id={`${id}-output`} label="사본 저장 경로" description="원본은 유지하고 Workspace에 사본을 저장합니다."><CxInput disabled={busy} value={output} onChange={e=>onOutput(e.target.value)}/></SettingsField>}
 {state==='written'&&<><p>{plan.written?.output}</p><p>바뀐 문단 {plan.written?.changedParagraphs??'미확인'}개</p><p role="status">{plan.checks?.summary||'검사 결과 미확인'}</p>{Boolean(plan.checks?.failed||plan.checks?.unmet?.length||plan.written?.violations?.length)&&<p role="alert">확인이 필요한 검사 항목이 남아 있어요.</p>}{(plan.checks?.unmet||[]).map((v,i)=><p key={i}>{v.criterion}: {v.detail}</p>)}{plan.remaining&&<p>확인 못 한 곳: {plan.remaining.what||[...(plan.remaining.slots||[]),...(plan.remaining.sections||[])].join(', ')||'세부 확인 필요'}</p>}{(plan.unresolved||[]).map((v,i)=><p key={i}>미해결: {v.item} {v.target} {v.status}</p>)}
 {plan.written?.compare?.app==='word'?<NativeDocumentPreview preview={plan.written.compare} title="변경 내용"/>:<p>변경 위치 미확인</p>}
 {plan.render&&<div className="nubi-form-comparison">{['before','after'].map(side=><section key={side}><h3>{side==='before'?'변경 전':'변경 후'}</h3>{(plan.render[side]?.status!=='rendered'||!plan.render[side]?.pages?.length)?<p>렌더 미확인</p>:(plan.render[side].pages||[]).map(page=><figure key={page.index}>{images[page.path]?<img src={images[page.path]} alt={`${side==='before'?'변경 전':'변경 후'} ${page.index}쪽`}/>:<p>이미지 미확인</p>}<figcaption>{page.index}쪽</figcaption></figure>)}</section>)}</div>}
 </>}
 <div className="nubi-form-actions">{['running','ready','approval','failed','unknown'].includes(state)&&<CxButton disabled={busy} onClick={onCancel}>작성 취소</CxButton>}{['running','failed','unknown'].includes(state)&&<CxButton disabled={busy} onClick={onRefresh}>상태 확인</CxButton>}{state==='ready'&&<CxButton variant="primary" disabled={busy||!validFormOutput(output,source)} onClick={()=>onApply(false)}>확인 후 사본 저장</CxButton>}{state==='approval'&&<CxButton variant="primary" disabled={busy} onClick={()=>onApply(true)}>수정 내용 승인</CxButton>}{state==='written'&&<><CxButton disabled={busy} onClick={onRender}>전후 비교</CxButton>{onOpen&&<CxButton variant="primary" disabled={busy||!plan.written?.output} onClick={()=>onOpen(plan.written.output)}>사본 열기</CxButton>}</>}</div>
 </InteractionSurface>;
}
