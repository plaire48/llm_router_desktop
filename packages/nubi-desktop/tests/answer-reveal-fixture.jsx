import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {ProgressDisplaySetting,useProgressDisplay} from '../ui/ProgressDisplaySetting.jsx';
import {useAnswerReveal} from '../ui/useAnswerReveal.js';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../design/workspace-typography.css';
const answer='**메일 검색을 개선했습니다.**\n\n제목과 본문을 함께 검색하고, 선택한 메일의 원문을 확인할 수 있습니다. '+
  '한글과 이모지 👨‍👩‍👧‍👦도 자연스럽게 이어집니다.\n\n- 검색 조건과 날짜 범위를 유지합니다.\n- 원문 출처를 눌러 근거를 확인할 수 있습니다.\n\n'+
  '| 확인 항목 | 결과 |\n|---|---|\n| 제목 검색 | 통과 |\n| 본문 검색 | 통과 |\n\n```js\nconsole.log("검증 완료");\n```\n\n[원문 확인](#nubi-cite-1)';
const initial={id:'task',checkpoint:{runId:'run'},messages:[{id:'old',role:'assistant',runId:'old-run',content:'이전 답변은 바로 표시됩니다.'}]};
function Fixture(){
  const [task,setTask]=useState(initial),[count,setCount]=useState(0);
  const [showProgress,setShowProgress]=useProgressDisplay();
  const reveal=useAnswerReveal(task,'project');
  window.deliverAnswer=()=>setTask({...initial,messages:[...initial.messages,{id:'new',role:'assistant',runId:'run',content:answer}]});
  window.switchConversation=()=>setTask(t=>({...t,id:t.id==='other'?'task':'other'}));
  window.rerenderAnswer=()=>setCount(c=>c+1);
  window.questionAnswer=()=>setTask({...initial,messages:[...initial.messages,{id:'question',role:'assistant',runId:'run',questionId:'q',content:'어떤 항목을 확인할까요?'}]});
  window.clearTask=()=>setTask(null);
  return <main className="desktop-shell" style={{background:'white',minHeight:'100vh',padding:32}} data-tick={count}>
    <div className="nubi-workbench"><div className="nubi-task" style={{width:'min(720px,100%)',margin:'auto'}}>
      <div style={{paddingBottom:24,fontWeight:600}}>누비 Workspace Beta</div>
      <ProgressDisplaySetting enabled={showProgress} onChange={setShowProgress}/>
      {task?.messages.map(message=><article className="nubi-message" key={message.id} data-id={message.id}>
        <MessageBody content={message.content} textReveal={reveal.has(message.id)} sourceReferences={[{href:'#nubi-cite-1',number:1,title:'메일 원문'}]} onSource={()=>{window.sourceOpened=true;}}/>
      </article>)}
    </div></div>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
