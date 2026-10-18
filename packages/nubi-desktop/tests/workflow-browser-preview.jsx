import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {WorkflowCanvas,workflowStatus} from '../ui/WorkflowCanvas.jsx';
import {animatedSetter} from '../ui/viewTransition.js';
import {expandStepTools} from '../runtime/workflow-tools.mjs';
import {completionLabel} from '../runtime/workflow-completion.mjs';
import {convertBlueprint} from '../runtime/workflow-import-blueprint.mjs';
import blueprint from './fixtures/blueprint-sample.yaml';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import './workflow-browser-preview.css';

// View-only scenarios. No host API, execution, approval or persistence is connected.
const {workflow}=convertBlueprint(blueprint);
const scenarios={
 waiting:{label:'승인 대기',cursor:'confirm',steps:{'decide-source':{status:'complete'},route:{status:'complete'},confirm:{status:'waiting'}}},
 running:{label:'진행 중',cursor:'summarize',steps:{'decide-source':{status:'complete'},route:{status:'complete'},confirm:{status:'complete'},'send-note':{status:'skipped'},summarize:{status:'running'}}},
 complete:{label:'완료',cursor:null,steps:Object.fromEntries(workflow.steps.map(step=>[step.id,{status:step.id==='send-note'?'skipped':'complete'}]))}
};
function Preview(){
 const [mode,setModeRaw]=useState('waiting'),[selected,setSelectedRaw]=useState('confirm');
 const setMode=animatedSetter(setModeRaw),setSelected=animatedSetter(setSelectedRaw);
 const scenario=scenarios[mode],step=workflow.steps.find(value=>value.id===selected),status=scenario.steps[selected]?.status||'pending';
 return <main className="workflow-browser-preview">
  <header className="workflow-preview-heading"><div><small>누비 Workspace <span>Beta</span></small><h1>업무 단계 지도</h1><p>현재 위치를 보고 필요한 단계의 내용을 확인해요.</p></div><span className="workflow-preview-badge">합성 미리보기</span></header>
  <section className="workflow-preview-toolbar" aria-label="예시 상태 선택"><div className="workflow-preview-segments">{Object.entries(scenarios).map(([key,value])=><CxButton key={key} aria-pressed={mode===key} onClick={()=>{setMode(key);setSelected(value.cursor||'guard');}}>{value.label} 예시</CxButton>)}</div><p>실제 실행 없음</p></section>
  <section className="workflow-preview-status" aria-live="polite"><Icon name={mode==='complete'?'check':'workflow'} size={18}/><div><strong>{scenario.label}</strong><span>{mode==='waiting'?'합성 내용 확인 단계에서 사람의 확인을 기다리는 예시예요.':mode==='running'?'합성 결과 정리 단계가 진행 중인 예시예요.':'선택된 경로의 모든 단계를 마친 예시예요.'}</span></div></section>
  <div className="workflow-preview-grid"><section className="workflow-preview-map"><h2>{workflow.name}</h2><WorkflowCanvas workflow={workflow} checkpoints={scenario.steps} onSelect={value=>setSelected(value.id)}/></section>
   <aside className="workflow-preview-inspector" aria-label="선택한 단계"><h2>단계 정보</h2><nav aria-label="단계 목록">{workflow.steps.map(value=><button type="button" key={value.id} aria-current={selected===value.id?'step':undefined} onClick={()=>setSelected(value.id)}><span>{value.name}</span><small>{workflowStatus[scenario.steps[value.id]?.status||'pending']}</small></button>)}</nav>{step&&<section><h3>{step.name}</h3><p>{workflowStatus[status]}</p>{step.goal&&<p>{step.goal}</p>}{step.ask&&<p>{step.ask}</p>}{step.kind==='agent'&&<><h4>작성자가 고른 도구</h4><p>{step.tools.join(', ')||'없음'}</p><h4>호스트가 보탠 선행 도구</h4><p>{(step.resolvedTools||expandStepTools(step.tools).tools).filter(tool=>!step.tools.includes(tool)).join(', ')||'없음'}</p></>}{(step.done_when||step.verify)&&<p>완료 조건: {completionLabel(step.done_when||step.verify)}</p>}{status==='waiting'&&<p className="workflow-preview-note">확인 화면의 예시입니다. 여기서 실제 승인하거나 실행하지 않아요.</p>}</section>}</aside></div>
  <footer>합성 자료로 만든 읽기 전용 화면입니다. 상태 선택은 표시만 바꾸며 실제 작업을 실행하지 않습니다.</footer>
 </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
