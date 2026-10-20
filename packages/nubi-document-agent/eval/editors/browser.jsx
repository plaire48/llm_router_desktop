// Local public-API integration fixture. No model, network bridge or product registration.
import {monaco} from '../../../nubi-desktop/electron-app/editor.jsx';
import {createEditorSession,createMonacoEditorPort} from '../../src/editors.ts';
document.body.innerHTML='<main><h1>누비 편집 연결 검사</h1><p>실제 Monaco 버퍼의 부분 수정과 되돌리기를 확인합니다. 제품 연결이나 외부 앱 검사가 아닙니다.</p><button id="run">검사 실행</button><pre id="result" role="status">대기</pre><div id="editor" style="height:360px;border:1px solid #e5e8eb"></div></main>';
const editor=monaco.editor.create(document.getElementById('editor'),{value:'',language:'markdown',automaticLayout:true,editContext:false});
document.getElementById('run').onclick=async()=>{
 const results=[],signal=new AbortController().signal;
 try {
  for(const eol of ['\n','\r\n']) {
   const text=['---','title: 업무','---','안녕하세요 [[연결]]','끝'].join(eol);
   const model=monaco.editor.createModel(text,'markdown');editor.setModel(model);editor.setSelection(new monaco.Selection(4,1,4,6));
   const port=createMonacoEditorPort({connectionId:'browser-fixture',documentId:'sample.md',editor,readOnly:()=>editor.getOption(monaco.editor.EditorOption.readOnly),dirty:()=>model.getValue()!==text,isConnected:()=>editor.getModel()===model});
   const session=createEditorSession(port,{projectId:'fixture',taskId:'fixture'}),observed=await session.read({selection:true},signal);
   if(observed.text!=='안녕하세요')throw Error('selection mismatch');
   const p=await session.propose({observationId:observed.observationId,start:observed.offset,end:observed.end,oldText:observed.text,newText:'반갑습니다'+eol+'새 문단'},signal);
   const host={policy:{authorize:async()=>true},claim:async()=>true,record:async()=>{}};
   const result=await session.apply(p.approvalId,host,signal);
   if(result.status!=='verified'||model.getValue()!==text.replace('안녕하세요','반갑습니다'+eol+'새 문단'))throw Error('edit/readback mismatch');
   editor.trigger('fixture','undo',null);
   if(model.getValue()!==text)throw Error('undo mismatch');
   results.push({lineEndings:eol==='\n'?'LF':'CRLF',selection:'passed',editAndReadback:'passed',undo:'passed'});
   session.disconnect();editor.setModel(null);model.dispose();
  }
  document.getElementById('result').textContent=JSON.stringify({status:'passed',results,productRegistered:false,externalAppVerified:false,liveModelVerified:false},null,2);
 } catch(error) {document.getElementById('result').textContent=JSON.stringify({status:'failed',error:error.message,results},null,2);}
};
