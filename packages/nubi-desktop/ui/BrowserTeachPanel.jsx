import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {CxButton,CxInput,CxSelect,DetailPanel,Icon} from '@e2e/cx-design-system';
import {SettingsSection,SettingsField,PanelTitle} from './SettingsSection.jsx';
import {CaptureChips} from './CaptureChips.jsx';
import {BrowserScriptCard} from './BrowserScriptCard.jsx';
import {teachDraft,boardProjection,bindingKey,runMatches,reviewable} from './browser-teach-view.mjs';
import './browser-teach.css';

// Ports are host-owned. Missing ports disable actions; this component never creates a replay engine.
// Re-key on project/session/revision/card changes so a late result cannot affect a different recording.
export function BrowserTeachPanel(props){return <TeachSession key={bindingKey(props.binding)+JSON.stringify(props.card)} {...props}/>;}
function TeachSession({binding,card,observation,capture,onTest,onSave,onApprove,onClose}){
 const [answers,setAnswers]=useState({}),[run,setRun]=useState(null),[inspected,setInspected]=useState([]),[saved,setSaved]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[board,setBoard]=useState(false),[selected,setSelected]=useState(null),[confirm,setConfirm]=useState(false),[unconfirmed,setUnconfirmed]=useState(false);
 const alive=useRef(true),locked=useRef(false),revision=useRef(0),form=useId();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const draft=useMemo(()=>teachDraft(card,answers),[card,answers]),draftKey=JSON.stringify(draft.card);
 const rows=useMemo(()=>boardProjection(observation,capture),[observation,capture]);
 const choice=q=>typeof answers[q.id]==='object'?({mail:'메일에서',wiki:'위키에서'}[answers[q.id].kind]||q.choices[0]):answers[q.id]||q.choices?.[0];
 const ready=draft.questions.every(q=>q.kind==='value'?(!['메일에서','위키에서'].includes(choice(q))||Boolean(answers[q.id]?.field?.trim()||answers[q.id]?.page?.trim())):typeof answers[q.id]==='string'&&answers[q.id].trim());
 const approvedEvidence=reviewable(run,binding,draftKey,inspected);
 function change(id,value){revision.current++;setAnswers(old=>({...old,[id]:value}));setRun(null);setInspected([]);setSaved(null);setError('');}
 async function act(action,issued=false){if(locked.current)return;locked.current=true;setBusy(true);setError('');const current=revision.current;try{await action(()=>alive.current&&current===revision.current);}catch{if(alive.current&&current===revision.current){setError('작업 결과를 확인하지 못했어요.');if(issued)setUnconfirmed(true);}}finally{locked.current=false;if(alive.current)setBusy(false);}}
 async function test(){setConfirm(false);await act(async live=>{const value=await onTest({binding,draftKey,card:draft.card});if(!live())return;if(!runMatches(value,binding,draftKey)||!value.receiptId)throw Error('run_unconfirmed');setRun(value);setInspected([]);},true);}
 async function save(){await act(async live=>{const value=await onSave({binding,draftKey,card:draft.card,receiptId:run?.receiptId||null});if(!live())return;if(!runMatches(value,binding,draftKey)||!value.script?.hash||!value.script?.version||value.script.status!=='draft')throw Error('save_unconfirmed');setSaved(value.script);});}
 async function approve(identity){await act(async live=>{const value=await onApprove({binding,draftKey,...identity,captureIds:inspected});if(!live())return;if(!runMatches(value,binding,draftKey)||value.script?.status!=='reviewed'||value.script.hash!==saved.hash||value.script.version!==saved.version||value.script.slug!==saved.slug)throw Error('approval_unconfirmed');setSaved(value.script);});}
 return <section className="nubi-browser-teach" aria-label="브라우저 가르치기" aria-busy={busy}>
  <header className="nubi-browser-teach-heading"><PanelTitle icon="linkExternal">브라우저 가르치기</PanelTitle>{onClose&&<CxButton aria-label="닫기" title="닫기" disabled={busy} onClick={onClose}><Icon name="xClose" size={18}/></CxButton>}</header>
  <p className="nubi-muted">기록한 순서와 값의 출처를 확인하고 한 번 실행해 보세요.</p>
  {error&&<p role="alert">작업을 완료하지 못했어요. 실행 결과를 확인한 뒤 다시 시도해 주세요.</p>}
  <SettingsSection icon="list" title={draft.plan.title||'계획 초안'}>
   <ol className="nubi-browser-teach-steps">{draft.plan.steps.map(step=><li key={step.index}><Icon name={step.slot?'pencil':step.guard?'clipboardCheck':'arrowRight'} size={18}/><div><strong>{step.summary}</strong><small>{answers['why:'+step.index]||step.reason}{!answers['why:'+step.index]&&step.reasonGuessed?' (추측)':''}</small></div>{step.guard&&<span className="nubi-muted">확인 필요</span>}</li>)}</ol>
   <CxButton disabled={!rows.length} onClick={()=>setBoard(true)}><Icon name="image" size={18}/>화면에서 확인</CxButton>
  </SettingsSection>
  {draft.questions.length>0&&<SettingsSection icon="helpCircle" title="필요한 내용만 확인할게요">
   {draft.questions.map(q=><React.Fragment key={q.id}><SettingsField id={form+q.id} label={q.prompt} description={q.kind==='value'&&answers[q.id]==='고정값'?'값은 절차에 저장하지 않고 실행할 때 별도로 받습니다.':undefined}>
    {q.choices?<CxSelect disabled={busy||Boolean(saved)} value={choice(q)} onChange={e=>change(q.id,e.target.value)}>{q.choices.map(choice=><option key={choice}>{choice}</option>)}</CxSelect>:<CxInput disabled={busy||Boolean(saved)} value={answers[q.id]||''} maxLength={400} onChange={e=>change(q.id,e.target.value)}/>}
   </SettingsField>
    {q.kind==='value'&&choice(q)==='메일에서'&&<SettingsField id={form+q.id+'-field'} label="메일에서 사용할 항목" description="본문을 복사하지 않고 항목 이름만 적습니다."><CxInput disabled={busy||Boolean(saved)} value={answers[q.id]?.field||''} placeholder="예: subject" onChange={e=>change(q.id,{kind:'mail',field:e.target.value})}/></SettingsField>}
    {q.kind==='value'&&choice(q)==='위키에서'&&<SettingsField id={form+q.id+'-page'} label="위키 페이지" description="본문 대신 페이지 참조를 적습니다."><CxInput disabled={busy||Boolean(saved)} value={answers[q.id]?.page||''} onChange={e=>change(q.id,{kind:'wiki',page:e.target.value})}/></SettingsField>}
   </React.Fragment>)}
  </SettingsSection>}
  {run&&<section aria-label="시험 실행 결과" className="nubi-browser-teach-results"><h2>{run.success?'실행 결과를 확인해 주세요':'중단된 단계를 확인해 주세요'}</h2><p role="status">{run.success?'영수증으로 실행을 확인했어요. 캡처를 확인한 뒤 초안을 승인할 수 있어요.':run.stopped||'완료를 확인하지 못했어요. 자동으로 다시 실행하지 않습니다.'}</p>
   {(run.captures||[]).map(item=><div key={item.id}><CaptureChips captures={[item]}/><label className="nubi-browser-capture-check"><input type="checkbox" checked={inspected.includes(item.id)} disabled={busy||Boolean(saved&&saved.status!=='draft')} onChange={e=>setInspected(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/>{item.label||'실행 캡처'} 확인</label></div>)}
  </section>}
  {saved?<BrowserScriptCard script={saved} run={run} busy={busy} canApprove={approvedEvidence} onApprove={onApprove?approve:undefined}/>:<div className="nubi-browser-teach-actions"><CxButton disabled={busy||!ready||!onSave} onClick={save}>초안 저장</CxButton><CxButton variant="primary" disabled={busy||Boolean(run)||unconfirmed||!ready||!onTest} onClick={()=>setConfirm(true)}>시험 실행</CxButton></div>}
  {unconfirmed&&<p role="status">실행 결과가 미확정입니다. 호스트에서 확인할 때까지 다시 실행하지 않습니다.</p>}
  {!onTest&&<p className="nubi-muted">브라우저 실행 연결을 기다리고 있어요. 아직 실행하지 않았습니다.</p>}
  {confirm&&<DetailPanel className="deck-dialog nubi-panel" variant="modal" title={<PanelTitle icon="arrowRight">시험 실행</PanelTitle>} onClose={()=>setConfirm(false)} footer={<CxButton variant="primary" disabled={busy} onClick={test}>실행 요청</CxButton>}><p>기록한 {draft.plan.steps.length}단계를 현재 브라우저에 실행합니다.</p><p>제출과 저장은 기존 승인 규칙을 따릅니다. 입력값과 실제 대상은 호스트에서 다시 확인합니다.</p></DetailPanel>}
  {board&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" variant="modal" title={<PanelTitle icon="image">화면에서 확인</PanelTitle>} onClose={()=>setBoard(false)}>
   <p className="nubi-muted">번호는 이 화면을 설명하기 위한 표시예요. 실행 대상으로 저장하지 않습니다.</p>
   <div className="nubi-browser-board"><img src={capture.dataUrl} alt="관찰한 브라우저 화면" width={capture.width} height={capture.height}/>{rows.filter(r=>r.rect).map(row=><button type="button" key={row.number} className="nubi-browser-board-box" style={{left:row.rect.left+'%',top:row.rect.top+'%',width:row.rect.width+'%',height:row.rect.height+'%'}} aria-label={`${row.number}번 ${row.name||row.role}`} title={`${row.number}번 ${row.name||row.role}`} aria-pressed={selected===row.number} onClick={()=>setSelected(row.number)}><span>{row.number}</span></button>)}</div>
   <ol className="nubi-browser-board-list">{rows.map(row=><li key={row.number}><button type="button" aria-pressed={selected===row.number} onClick={()=>setSelected(row.number)}>{row.number}. {row.name||row.role}{!row.rect?' (위치 확인 필요)':''}</button>{selected===row.number&&row.context&&<p>{row.context}</p>}</li>)}</ol>
  </DetailPanel>}
 </section>;
}
