import {OfficeSkills} from './OfficeSkills.jsx';
import {OfficeTemplates} from './OfficeTemplates.jsx';
import {catalogMutation,catalogEntries} from './template-catalog.js';
import {officeHost} from '../worker/office-hosts.mjs';
import {prepareRunPayload,conversationForRun} from './run-context.js';
import {ContentDetails} from './ContentDetails.jsx';
import {TaskRecovery} from './TaskRecovery.jsx';
import {OfficeComposer} from './OfficeComposer.jsx';
import {OfficeTools} from './OfficeTools.jsx';
import {OfficeDocumentResult} from './OfficeDocumentResult.jsx';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {createInputDelivery} from './input-delivery.js';
import {OfficeQuestion} from './OfficeQuestion.jsx';
import {templatePreservation} from '../worker/template-preservation.mjs';
import {TemplatePreservation} from './TemplatePreservation.jsx';
import {recoverWorkerRead} from './worker-recovery.js';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {CxAppShell, CxButton, CxNotice, ActionButton, Icon, notifyToast} from '@e2e/cx-design-system';
import {Welcome} from '../../../extensions/aipro-chat/src/Welcome.jsx';
import {NubiHeaderActions, NubiLogin} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {AgentMark, NubiLogo} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {AmbientScene, useIdleExpression, useMotionPreference} from '../../../extensions/aipro-chat/src/Atmosphere.jsx';
import {ModelSelection} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {ConversationHistory} from '../../../extensions/aipro-chat/src/ConversationHistory.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {ChangeHistory, ConnectionDialog, OfficeUsage, OfficeHelp, PROVIDER_NAMES} from './OfficeDialogs.jsx';
import {rpc} from './bridge.js';
import {errorText as officeErrorText} from './errors.js';
import {SelectionDetails} from './SelectionDetails.jsx';
import {OfficeViewPreview} from './OfficeViewPreview.jsx';
import {OfficeTransaction} from './OfficeTransaction.jsx';
import {TaskActivity} from './TaskActivity.jsx';

const providers = PROVIDER_NAMES;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const newConversation = provider => ({id:crypto.randomUUID(),provider,title:'새 대화',updatedAt:Date.now(),messages:[],draft:'',clarification:null});
const initialConversation = newConversation('aipro');

export default function App() {
  const [session,setSession] = useState(null), [scope,setScope] = useState(null), [busy,setBusy] = useState(false), [accountBusy,setAccountBusy] = useState(false);
  const host=session?.host||'excel',hostProfile=officeHost(host);
  const errorText=code=>officeErrorText(code,host);
  const intro={title:`${hostProfile.subject}${host==='excel'?'을':'를'} 누비는 AI Agent, 누비`,description:<>작은 뱁새가 {hostProfile.subject}{host==='excel'?'을':'를'} 누비며<br/>{hostProfile.description}</>};
  const [error,setError] = useState(''), [dialog,setDialog] = useState(null), [connectProvider,setConnectProvider] = useState(null), [modelProvider,setModelProvider] = useState(null);
  const [conversations,setConversations] = useState([initialConversation]), [currentId,setCurrentId] = useState(initialConversation.id);
  const [welcomeAnimated,setWelcomeAnimated] = useState(false), [away,setAway] = useState(false), [changes,setChanges] = useState([]), [restoring,setRestoring] = useState(false);
  const [changesLoading,setChangesLoading]=useState(false),[changesError,setChangesError]=useState('');
  const [stopping,setStopping]=useState(false),[catalogError,setCatalogError]=useState(null);
  const refreshingModels=useRef(false);
  const interaction=useRef(null);
  const [interactionVisible,setInteractionVisible]=useState(true);
  function locateInteraction(){const target=interaction.current;if(target){target.scrollIntoView({block:'center'});target.focus();}}
  const helpFocus=useRef(false),approvalWaiter=useRef(null),inputWaiter=useRef(null);const [inputQuestion,setInputQuestion]=useState(null);const [approval,setApproval]=useState(null);
  function decideApproval(approved){const waiter=approvalWaiter.current;if(!waiter)return;approvalWaiter.current=null;setApproval(null);waiter.resolve({approved});}
  async function answerInput(choice) {
    const waiter=inputWaiter.current;if(!waiter)return false;
    setInputQuestion(current=>current?.callId===choice.questionId?{...current,sending:true}:current);
    try{return await waiter.choose(choice);}finally{setInputQuestion(current=>current?.callId===choice.questionId?{...current,sending:false}:current);}
  }
  function cancelInput(){inputWaiter.current?.cancel();inputWaiter.current=null;setInputQuestion(null);}
  const [selectionLoading,setSelectionLoading]=useState(false),[selectionError,setSelectionError]=useState('');
  async function showSelectionDetails(){if(running.current||selectionLoading)return;setDialog('cell-details');setScope(null);setSelectionLoading(true);setSelectionError('');try{const selected=await rpc('selection');setScope(host==='excel'?await rpc('read',{scopeId:selected.scopeId}):selected);}catch(cause){setSelectionError(errorText(cause.message));}finally{setSelectionLoading(false);}}
  const list = useRef(null), textarea = useRef(null), follow = useRef(true), running = useRef(false), stopped = useRef(false), activeRun = useRef(null), pendingRequest = useRef(null), authGeneration = useRef(0);
  useLayoutEffect(()=>{
    const target=interaction.current;
    setInteractionVisible(true);
    if(!busy||!target||typeof IntersectionObserver==='undefined')return;
    let active=true;
    const observer=new IntersectionObserver(entries=>{if(!active)return;const entry=entries.find(item=>item.target===target);if(entry)setInteractionVisible(entry.isIntersecting);},{root:list.current,threshold:0});
    observer.observe(target);
    return()=>{active=false;observer.disconnect();};
  },[busy,inputQuestion?.callId,approval?.callId]);
  const motion = useMotionPreference(), resting = useIdleExpression(busy || !!session?.pending || motion.paused);
  const chat = conversations.find(item => item.id === currentId) || initialConversation;
  const draft = chat.draft, messages = chat.messages, empty = !messages.length, blocked = busy || accountBusy || !!session?.pending;
  const selectedModel = session?.models?.find(model => model.id === session.model);
  const data = {activeProvider:session?.provider || 'aipro',settings:{modelId:session?.model || ''},catalog:{...session?.modelCatalog,models:(session?.models || []).map(model => ({...model,name:model.id,displayName:model.label})),error:catalogError && catalogError.provider===session?.provider ? 'catalog_refresh_failed' : null,errorMessage:catalogError && catalogError.provider===session?.provider ? catalogError.message : null},connections:Object.fromEntries((session?.providers || []).map(item => [item.id,{present:item.connected}])),pending:session?.pending ? {provider:session.pending,phase:'waiting'} : null,report:{provider:session?.provider,error:session?.loginError}};
  const updateChat = (id,update) => setConversations(items => items.map(item => item.id === id ? {...item,...(typeof update === 'function' ? update(item) : update),updatedAt:Date.now()} : item));
  const report = (text,failure=false) => {if (failure) setError(errorText(text)); notifyToast(failure ? errorText(text) : text,{error:failure,source:'office'});};
  useEffect(() => {
    let alive=true;
    void Promise.allSettled([rpc('session')]).then(([connection])=>{
      if (!alive) return;
      if (connection.status==='fulfilled') {const next=connection.value;setSession(next);setConversations(items=>items.map(item=>item.id===initialConversation.id ? {...item,provider:next.provider} : item));}
      else {setSession({provider:'aipro',models:[]});setError(errorText(connection.reason.message));}

    });
    return ()=>{alive=false;authGeneration.current++;};
  },[]);
  useLayoutEffect(()=>{if(dialog==='settings' && helpFocus.current){helpFocus.current=false;}},[dialog]);
  useLayoutEffect(() => {if (follow.current && list.current) list.current.scrollTop=list.current.scrollHeight;},[messages,busy]);
  const openModels = provider => {setModelProvider(provider || session.provider);setDialog('models');};
  async function changeProvider(provider) {
    const next = await rpc('selectProvider',{provider});setSession(next);
    if (provider !== chat.provider) {const previous=conversations.findLast(item => item.provider === provider);if (previous) setCurrentId(previous.id);else createConversation(provider);}
  }
  function createConversation(provider=session.provider) {const item=newConversation(provider);setConversations(items => [...items,item]);setCurrentId(item.id);setError('');setWelcomeAnimated(false);follow.current=true;setAway(false);}
  async function connect(provider) {
    if (running.current || !Object.hasOwn(providers,provider)) return;
    if (provider==='fabrix') {setDialog(null);setConnectProvider(provider);return;}
    setAccountBusy(true);setError('');const attempt=++authGeneration.current;
    try {
      let next=await rpc('login',{provider});setSession(next);
      while (next.pending && authGeneration.current === attempt) {await pause(600);next=await rpc('session');if (authGeneration.current === attempt) setSession(next);}
      if (authGeneration.current !== attempt) return;
      if (next.loginError) report(next.loginError,true);
      else if (next.connected) {if (chat.provider !== provider) createConversation(provider);report('연결했습니다. 모델을 선택해 작업을 시작하세요.');}
    } catch(cause) {report(cause.message,true);} finally {if (authGeneration.current === attempt) setAccountBusy(false);}
  }
  async function cancelLogin() {authGeneration.current++;setAccountBusy(false);try {setSession(await rpc('cancelLogin'));} catch(cause) {report(cause.message,true);}}
  async function disconnect(provider) {setAccountBusy(true);try {setSession(await rpc('disconnect',{provider}));report('연결을 해제했습니다.');} finally {setAccountBusy(false);}}
  async function refreshModels({silent=false}={}) {
    if(refreshingModels.current || running.current || session?.pending)return false;
    refreshingModels.current=true;setAccountBusy(true);const provider=session?.provider;
    try {setSession(await rpc('refreshModels'));setCatalogError(null);if(!silent)notifyToast('모델 목록을 새로 읽었습니다.',{source:'office'});return true;}
    catch(cause) {setCatalogError({provider,message:errorText(cause.message)});return false;}
    finally {refreshingModels.current=false;setAccountBusy(false);}
  }
  async function historyAction(type,payload={}) {
    if (running.current) return;
    if (type === 'NEW_CHAT') createConversation();
    else if (type === 'SELECT_CONVERSATION') {const target=conversations.find(item=>item.id===payload.id);if (!target) return;setSession(await rpc('selectProvider',{provider:target.provider}));setCurrentId(target.id);setError('');follow.current=true;setAway(false);}
    else if (type === 'RENAME_CONVERSATION') updateChat(payload.id,{title:payload.title.trim()});
    else if (type === 'DELETE_CONVERSATION') {setConversations(items=>items.filter(item=>item.id!==payload.id));if (payload.id===currentId) createConversation();}
  }
  async function showChanges() {setDialog('changes');setChangesLoading(true);setChangesError('');try {setChanges(await rpc('history'));} catch(cause) {setChangesError(errorText(cause.message));} finally {setChangesLoading(false);}}
  async function restoreChange(item) {if(restoring || busy)return;setRestoring(true);setChangesError('');try {await rpc('restore',{changeId:item.id});setChanges(await rpc('history'));report('원래 셀 내용으로 복원했습니다.');} catch(cause) {setChangesError(errorText(cause.message));} finally {setRestoring(false);}}
  async function openTemplate() {
    if(running.current||blocked)return;running.current=true;setBusy(true);setError('');
    try{const result=await rpc('template_open');if(result.cancelled)return;
      if(!result.copied||!result.scope||!result.record||!result.comparison?.before||!result.comparison?.after)throw new Error('template_open_failed');
      const preservation=templatePreservation(result.comparison.before,result.comparison.after,{stage:'opened_copy'});
      const item={...newConversation(session.provider),documentSkill:chat.documentSkill,title:result.record.name,messages:[{id:crypto.randomUUID(),role:'assistant',state:'done',content:preservation.differenceCount?'새 사본에서 차이를 발견했습니다. 아래 항목을 확인해 주세요. 입력 전에 현재 양식과 항목 연결을 다시 검토합니다.':'등록 양식의 새 사본을 열었습니다. 아래 확인 범위를 참고해 채울 내용을 알려주세요.',run:{preservation}}],templateCopy:{record:result.record,documentId:result.scope.documentId,worksheet:result.scope.worksheet,address:result.scope.address}};
      setConversations(items=>[...items,item]);setCurrentId(item.id);setScope(result.scope);setDialog(null);report('새 문서 사본을 열었습니다. 채울 내용을 알려주세요.');
    }catch(cause){report(cause.message,true);}finally{running.current=false;setBusy(false);}
  }
  async function useCatalogTemplate(entry){
    if(running.current||blocked)return;
    running.current=true;setBusy(true);setError('');
    try{
      const result=await catalogMutation('template_catalog_use',{templateId:entry.id},{call:rpc});
      if(result.cancelled)return;
      if(result.entry?.id!==entry.id||result.entry?.host!==host||!result.scope)throw new Error('template_record_invalid');
      let binding,run;
      if(host==='excel'){
        if(!result.copied||!result.record||!result.comparison?.before||!result.comparison?.after)throw new Error('template_open_failed');
        binding={templateCopy:{record:result.record,documentId:result.scope.documentId,worksheet:result.scope.worksheet,address:result.scope.address}};
        run={preservation:templatePreservation(result.comparison.before,result.comparison.after,{stage:'opened_copy'})};
      }else{
        if(!result.loaded||result.scope.host!==host)throw new Error('template_open_failed');
        binding={contentTemplate:{id:entry.id,host,name:result.entry.name,summary:result.entry.summary,usageNotes:result.usageNotes,scopeId:result.scope.scopeId,documentId:result.scope.documentId}};
      }
      const item={...newConversation(session.provider),documentSkill:chat.documentSkill,...binding,title:result.entry.name,templateName:result.entry.name,draft,
        messages:[{id:crypto.randomUUID(),role:'assistant',state:'done',content:host==='excel'?'양식의 새 사본을 열었습니다. 채울 내용을 알려주세요.':'등록한 양식을 다시 확인했습니다. 채울 내용을 알려주시면 사본을 만들어 작성합니다.',run}]};
      setConversations(items=>[...items,item]);setCurrentId(item.id);setScope(result.scope);setDialog(null);follow.current=true;
      requestAnimationFrame(()=>textarea.current?.focus());
    }finally{running.current=false;setBusy(false);}
  }
  function registerCurrentTemplate(){
    if(running.current||blocked)return;
    setDialog(null);
    void send({text:'현재 문서와 선택한 입력 영역을 분석해서 재사용할 양식으로 등록해줘. 구조와 입력 위치를 확인하고 필요한 업무 규칙은 질문해줘.',mode:'template-register'});
  }
  async function stop() {setStopping(true);stopped.current=true;decideApproval(false);cancelInput();if (activeRun.current || pendingRequest.current) await rpc('runCancel',activeRun.current?{id:activeRun.current}:{requestId:pendingRequest.current}).catch(cause=>report(cause.message,true));}
  async function send(choice) {
    const question=messages.findLast(message=>message.state==='awaiting_user' && !message.questionAnswered);
    if(choice?.optionId&&!question?.run?.questionForm?.options.some(o=>o.id===choice.optionId))return false;
    const request=(choice?.text ?? (choice?.optionId?question?.run?.questionForm?.options.find(o=>o.id===choice.optionId)?.label:undefined) ?? draft).trim();
    if (running.current || blocked || !session?.connected || !request || choice?.questionId && choice.questionId!==question?.id) return false;
    running.current=true;stopped.current=false;setStopping(false);setBusy(true);setError('');notifyToast('',{source:'office'});follow.current=true;setAway(false);
    const conversationId=currentId, replyId=crypto.randomUUID();
    let lastStatus,replyCreated=false,accepted=false;
    const updateReply = update => updateChat(conversationId,item=>({messages:item.messages.map(message=>message.id===replyId ? {...message,...update} : message)}));
    async function readWorker(method,payload){
      return recoverWorkerRead(method,payload,{call:rpc,cancelled:()=>stopped.current,wait:pause,
        onRetry:({paused,code,failures})=>updateReply({run:{...(lastStatus || {state:'running',phase:'starting'}),recovery:{state:paused?'paused':'waiting',code,withoutProgress:failures},activity:[...(lastStatus?.activity||[]),{id:'connection-recovery',kind:'recovery',state:'waiting',title:paused?'연결 복구를 멈추고 확인을 기다립니다.':'연결을 확인하고 진행 상태를 다시 불러옵니다.',detail:'이미 실행한 도구는 반복하지 않습니다.',startedAt:Date.now()}]}}),
        onStall:()=>new Promise(resolve=>{approvalWaiter.current={resolve};setApproval({callId:crypto.randomUUID(),name:'request_approval',replyId,payload:{kind:'recovery',title:'진행 상태를 다시 확인할까요?',summary:'세 차례 연결을 확인했지만 응답을 받지 못했습니다.',target:'현재 작업과 전달 대기 중인 실행 결과 보존',verification:'다시 시도해도 셀 변경, 저장 도구를 재실행하지 않습니다.'}});})});
    }
    try {
      const history=conversationForRun(messages);
      let selection=null;
      try{selection=chat.contentTemplate&&choice?.mode!=='template-register'?await rpc('office_read',{scopeId:chat.contentTemplate.scopeId,offset:0}):await rpc('selection');setScope(selection);}catch(cause){if(!['select_cells','range_limit','single_range_required','document_closed'].includes(cause.message))throw cause;setScope(null);}
      if (chat.clarification && ['documentId','worksheet','address'].some(key=>chat.clarification[key]!==selection?.[key])) throw new Error('cells_changed');
      const requestId=crypto.randomUUID(), runPayload=prepareRunPayload({requestId,request,scope:selection,mode:choice?.mode==='template-register'?'template-register':'auto',history,...(chat.documentSkill&&choice?.mode!=='template-register'?{documentSkill:chat.documentSkill,skillInput:chat.skillInput}:{}),...(chat.contentTemplate&&choice?.mode!=='template-register'?{contentTemplate:chat.contentTemplate}:{}),...(chat.templateCopy&&choice?.mode!=='template-register'?{templateRecord:chat.templateCopy.record,templateBinding:{documentId:chat.templateCopy.documentId,worksheet:chat.templateCopy.worksheet,address:chat.templateCopy.address}}:{}),...(host==='excel'&&choice?.mode!=='template-register'&&!chat.templateCopy&&!chat.documentSkill?{templateCatalog:true}:{})});
      updateChat(conversationId,item=>({...(choice?.mode==='template-register'?{templateName:undefined,templateCopy:undefined,contentTemplate:undefined}:{}),title:item.messages.length ? item.title : request.slice(0,80),draft:choice ? item.draft : '',messages:[...item.messages,{id:crypto.randomUUID(),role:'user',content:request},{id:replyId,role:'assistant',content:'',state:'pending',model:selectedModel?.label || session.model}]}));replyCreated=true;
      if(stopped.current)throw new Error('cancelled');
      pendingRequest.current=requestId;let current;
      try{current=await rpc('runStart',runPayload);}
      catch(cause){if(!['office_timeout','worker_timeout'].includes(cause.message))throw cause;current=await readWorker('runLookup',{requestId});}
      activeRun.current=current.id;accepted=true;if(question)updateChat(conversationId,item=>({messages:item.messages.map(message=>message.id===question.id ? {...message,questionAnswered:true,questionDraft:''} : message)}));const handled=new Set();
      // A form opened by this run stays bound to the conversation, so the next message continues in the same copy.
      let openedCopy;const bindCopy=status=>{const opened=status.templateCopy;if(openedCopy||host!=='excel'||!opened?.record||!opened.entry?.name)return;openedCopy={record:opened.record,documentId:opened.documentId,worksheet:opened.worksheet,address:opened.address};updateChat(conversationId,{templateName:opened.entry.name,templateCopy:openedCopy});};
      while (current.state==='running') {
        lastStatus=current;if(current.skillInput)updateChat(conversationId,{skillInput:current.skillInput});
        if (stopped.current) {current=await rpc('runCancel',{id:current.id});break;}
        updateReply({run:current});bindCopy(current);
        if(host!=='excel'&&choice?.mode!=='template-register'&&chat.contentTemplate&&current.templateCopy?.ready&&current.contentScope&&!current.registeredTemplate)updateChat(conversationId,{contentTemplate:{...chat.contentTemplate,...current.contentScope}});
        const action=current.action;
        if (action && !handled.has(action.callId)) {
          handled.add(action.callId);let result;
          try {
            if (action.name==='show_plan') {flushSync(()=>updateReply({run:current}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));result={displayed:true};}
            else if(action.name==='request_input'){
              const delivery=createInputDelivery(action,{deliver:result=>readWorker('toolResult',{id:current.id,callId:action.callId,result}),cancelled:()=>stopped.current,onAccepted:text=>{
                updateChat(conversationId,item=>({messages:item.messages.map(message=>message.id===replyId?{...message,inputAnswers:[...(message.inputAnswers||[]),{question:action.payload.text,text}]}:message)}));
                inputWaiter.current=null;setInputQuestion(null);
              }});
              inputWaiter.current=delivery;setInputQuestion({...action,replyId});
              result=await delivery.promise;
            }
            else if(action.name==='get_selection'){result=await rpc('selection');setScope(result);}
            else if(action.name==='request_approval')result=await new Promise(resolve=>{approvalWaiter.current={resolve};setApproval({...action,replyId});});
            else if (['office_read','office_read_text','office_receipt','office_create','office_copy','office_apply','office_save','office_template_register'].includes(action.name)) result=await rpc(action.name,action.payload);
            else if (['document_open','document_save','document_reconcile','document_read'].includes(action.name)) result=await rpc(action.name,action.payload);
            else if(['document_skill_catalog','document_skill_manifest','document_skill_resource'].includes(action.name))result=await rpc(action.name,action.payload);
            else if(['view_observe','view_image','view_act','view_receipt'].includes(action.name))result=await rpc(action.name,action.payload);
            else if(action.name==='template_register')result=await catalogMutation('template_register',{...action.payload,scopeId:action.scopeId},{call:rpc,operationId:action.callId});
            else if(action.name==='template_catalog_index')result=await catalogMutation('template_catalog_index',action.payload,{call:rpc,operationId:action.callId});
            else if(action.name==='template_catalog_list')result=await rpc('template_catalog_list');
            else if(action.name==='template_catalog_use')result=await catalogMutation('template_catalog_use',action.payload,{call:rpc,operationId:action.callId});
            else if (['workbook_sheets','workbook_structure','workbook_range'].includes(action.name)) result=await rpc(action.name,{...action.payload,scopeId:action.scopeId});
            else if(action.name==='reconcile_changes')result=await rpc('reconcile',{scopeId:action.scopeId,...action.payload});
            else if(action.name==='restore_change')result=await rpc('restore',action.payload);
            else result=await rpc(action.name==='apply_changes' ? 'apply' : 'read',{scopeId:action.scopeId,operationId:action.callId,plan:action.plan});
          } catch(cause) {if(action.name==='request_input')throw cause;result={error:cause.message};}
          if(!stopped.current && action.name!=='request_input')await readWorker('toolResult',{id:current.id,callId:action.callId,result});
        }
        await pause(180);current=await readWorker('runStatus',{id:current.id});
      }
      let content;
      if (stopped.current || current.state==='cancelled') content=current.kind==='document'?`문서 작성을 중지했습니다. 열려 있는 초안은 ${hostProfile.name}에서 확인할 수 있습니다.`:`작업을 중지했습니다. 이미 적용한 변경은 ${hostProfile.name}에서 확인해 주세요.`;
      else if (current.state==='failed') {content=errorText(current.error);report(current.error,true);}
      else content=current.question || current.answer || '선택 영역을 확인했습니다.';
      updateReply({content,run:current,state:current.state,error:current.error});bindCopy(current);
      updateChat(conversationId,{clarification:current.state==='awaiting_user' ? (openedCopy?{documentId:openedCopy.documentId,worksheet:openedCopy.worksheet,address:openedCopy.address}:selection) : null});
      const refreshed=await Promise.allSettled([rpc('session'),rpc('history')]);if(refreshed[0].status==='fulfilled')setSession(refreshed[0].value);if(refreshed[1].status==='fulfilled')setChanges(refreshed[1].value);
      if(host!=='excel'&&current.registeredTemplate?.catalogued){
        const registered=current.registeredTemplate;updateChat(conversationId,{templateName:registered.name,contentTemplate:{id:registered.id,host,name:registered.name,summary:registered.entry.summary,usageNotes:registered.usageNotes,scopeId:registered.scopeId,documentId:registered.scopeId,stage:'source'}});
      }else if(host!=='excel'&&choice?.mode!=='template-register'&&chat.contentTemplate&&current.templateCopy?.ready&&current.contentScope)updateChat(conversationId,{contentTemplate:{...chat.contentTemplate,...current.contentScope}});
      if(current.skillInput)updateChat(conversationId,{skillInput:current.skillInput});
      if (current.state==='done') report(current.artifact?.saved?'문서를 작성하고 저장했습니다.':current.registeredTemplate?.catalogued?'양식 목록에 등록했습니다.':current.registeredTemplate?'양식 사본을 저장했습니다.':current.writes ? (host==='excel'?'셀 변경과 결과 확인을 마쳤습니다.':'문서 수정과 결과 확인을 마쳤습니다.') : '분석을 마쳤습니다.');
    } catch(cause) {
      const cancelled=stopped.current||cause.message==='cancelled',state=cancelled?'cancelled':'failed';
      if(!cancelled)report(cause.message,true);if (activeRun.current || pendingRequest.current) await rpc('runCancel',activeRun.current?{id:activeRun.current}:{requestId:pendingRequest.current}).catch(()=>{});
      if (replyCreated) updateReply({content:cancelled?`작업을 중지했습니다. 이미 적용한 변경과 열린 문서는 ${hostProfile.name}에서 확인해 주세요.`:errorText(cause.message),state,error:cause.message,run:lastStatus ? {...lastStatus,state,error:cause.message,activity:lastStatus.activity?.map(event=>event.state==='running' ? {...event,state:cancelled?'cancelled':'error',endedAt:Date.now()} : event),plan:lastStatus.plan ? {...lastStatus.plan,steps:lastStatus.plan.steps.map(step=>['running','recovering'].includes(step.state) ? {...step,state:cancelled?'paused':'failed'} : step)} : undefined} : undefined});
    } finally {decideApproval(false);cancelInput();running.current=false;activeRun.current=null;pendingRequest.current=null;setBusy(false);setStopping(false);setAway(false);requestAnimationFrame(()=>textarea.current?.focus());}
    return accepted;
  }
  const headerActions=<NubiHeaderActions
    history={{'aria-expanded':dialog==='history',onClick:()=>setDialog('history')}}
    usage={{title:'이 창의 토큰 사용량','aria-expanded':dialog==='usage',onClick:()=>setDialog('usage')}}
    settings={{id:'settings-toggle','aria-label':'더 보기',title:'더 보기','aria-expanded':dialog==='settings',onClick:()=>setDialog('settings')}}/>;
  const latestAssistant=messages.findLast(message=>message.role==='assistant')?.id;
  const usage=conversations.flatMap(item=>item.messages.flatMap(message=>message.run?.metrics?.usage || []));
  const lastMeasured=messages.findLast(message=>message.run?.metrics?.usage?.length);
  const activeQuestion=messages.findLast(message=>message.state==='awaiting_user' && !message.questionAnswered)?.id;
  return <CxAppShell brand={<NubiLogo mood={busy ? 'working' : resting}/>} actions={headerActions}>
    {(!session?.connected || empty) && <AmbientScene/>}
    {!session ? <span className="status-spinner loading" role="status" aria-label="불러오는 중"/> : !session.connected && empty ? <NubiLogin mood={session.pending ? 'working' : error ? 'sad' : resting} intro={intro} error={error} pending={data.pending} onLogin={connect} onCancel={cancelLogin}></NubiLogin> : <section className={`chat-page${empty ? ' is-empty' : ''}`}>
      {error && <CxNotice tone="danger">{error}</CxNotice>}
      <div className="conversation-wrap"><div id="conversation" className="conversation" ref={list} aria-label="대화 내용" onScroll={e=>{const view=e.currentTarget;follow.current=view.scrollHeight-view.scrollTop-view.clientHeight<80;setAway(!follow.current);}}><div className="conversation-content">
        {empty && <Welcome animate={!welcomeAnimated && !draft && !motion.paused} onComplete={setWelcomeAnimated} mood={resting} intro={intro}/>}
        {messages.map(message=><article key={message.id} className={`message message-${message.role} ${message.role}`} data-state={message.state} aria-label={message.role==='user' ? '내 메시지' : '누비 답변'}>
          {message.role==='assistant' && <><div className="answer-model"><AgentMark size={26} mood={message.state==='pending' ? 'working' : message.state==='failed' ? 'sad' : 'still'}/><span>{message.model}</span></div><TaskActivity run={message.run} showSummary={!message.content} latest={message.id===latestAssistant} input={inputQuestion?.replyId===message.id?inputQuestion:null} approval={approval?.replyId===message.id?approval:null}/>{approval?.replyId===message.id && <div ref={interaction} tabIndex={-1} className="office-interaction-target" role="region" aria-label="반영 전 확인"><OfficeTransaction approval={approval} onDecision={decideApproval} onOpen={documentId=>rpc('document_focus',{documentId}).catch(cause=>report(cause.message,true))}/></div>}{message.run?.documentView && <OfficeViewPreview view={message.run.documentView} call={rpc}/>}
          {message.run?.registeredTemplate?.saved && <OfficeDocumentResult host={host} title={message.run.registeredTemplate.name} detail={message.run.registeredTemplate.catalogued?'양식 목록 / 등록 완료':'양식 사본 저장됨 / 등록 확인 필요'} path={message.run.registeredTemplate.path}/>}{message.run?.templateCopy?.path && !message.run?.artifact?.saved && !message.run?.registeredTemplate && <OfficeDocumentResult host={host} title={message.run.task?.title} detail={message.run.templateCopy.ready?'양식 사본 / 최종 저장 전':'양식 사본 / 보존 확인 필요'} path={message.run.templateCopy.path}/>}{message.run?.artifact?.saved && <OfficeDocumentResult host={host} title={message.run.task?.title} detail={`${hostProfile.name} 문서 / 저장됨`} path={message.run.artifact.path} onOpen={()=>rpc(host==='excel'?'document_focus':'office_focus',host==='excel'?{documentId:message.run.artifact.documentId}:{scopeId:message.run.artifact.scopeId}).catch(cause=>report(cause.message,true))}/>}</>}
          <div className="message-content" hidden={message.state==='pending' || message.state==='awaiting_user'}><MessageBody role={message.role} content={message.content}/></div>
          {message.role==='assistant' && approval?.replyId!==message.id && <TemplatePreservation report={message.run?.preservation}/>}
          {!!message.inputAnswers?.length && <DeckDisclosure title={`확인한 내용 ${message.inputAnswers.length}개`} icon="check">{message.inputAnswers.map((entry,index)=><div key={index} className="reply-note"><strong>{entry.question}</strong><p>{entry.text}</p></div>)}</DeckDisclosure>}
          {inputQuestion?.replyId===message.id && <div ref={approval?undefined:interaction} tabIndex={-1} className="office-interaction-target" role="region" aria-label="답변할 질문"><OfficeQuestion key={inputQuestion.callId} question={{...inputQuestion.payload,id:inputQuestion.callId,draft:inputQuestion.draft||'',answer:null}} disabled={stopped.current} onDraft={async draft=>setInputQuestion(current=>current?{...current,draft}:null)} onChoose={answerInput}/></div>}
          {message.state==='awaiting_user' && <OfficeQuestion question={{inputLimit:8000,id:message.id,text:message.content,kind:'text',options:[],inputMode:'text',...message.run?.questionForm,draft:message.questionDraft || '',answer:message.questionAnswered ? {answered:true} : null}} disabled={blocked || !session.connected || message.id!==activeQuestion} onDraft={async value=>updateChat(currentId,item=>({messages:item.messages.map(entry=>entry.id===message.id ? {...entry,questionDraft:value} : entry)}))} onChoose={send}/>}
          {message.state==='pending' && !message.run?.activity?.length && <span className="reply-status" role="status"><span className="status-spinner" aria-hidden="true"/>작업 계획을 세우는 중</span>}
          {message.id===latestAssistant && message.state==='failed' && !busy && <TaskRecovery code={message.error||message.run?.error} run={message.run} onAction={action=>action==='connection'?openModels():action==='selection'?showSelectionDetails():showChanges()}/>}
          {message.role==='assistant' && message.content && <div className="message-actions"><CopyButton text={message.content} label="답변 복사" successMessage="답변을 복사했습니다."/></div>}
        </article>)}
      </div></div>{away && !empty && <CxButton id="follow-latest" className="jump-latest" aria-label="최신 작업 보기" title="최신 작업 보기" onClick={()=>{follow.current=true;setAway(false);list.current.scrollTop=list.current.scrollHeight;}}><Icon name="arrowDown" size={18}/></CxButton>}</div>
      {!session.connected ? <div className="conversation-reconnect"><span>{providers[session.provider]} 연결 필요</span><ActionButton action="login" iconOnly label="연결과 모델 선택" onClick={()=>openModels()}/></div> : <OfficeComposer skillName={chat.documentSkill?.name} onClearSkill={()=>updateChat(currentId,{documentSkill:undefined,skillInput:undefined})} onResetSkillInput={()=>{updateChat(currentId,{skillInput:undefined});report('다음 요청에서 스킬 입력을 다시 받습니다.');}} onTemplates={()=>setDialog('templates')} templatesOpen={dialog==='templates'} templateName={chat.templateName} onClearTemplate={()=>updateChat(currentId,{templateName:undefined,templateCopy:undefined,contentTemplate:undefined})} loadTemplates={host==='excel'&&!chat.templateCopy&&!chat.documentSkill?async()=>catalogEntries(await rpc('template_catalog_list'),host):undefined} hostName={hostProfile.name} data={data} draft={draft} busy={busy} blocked={blocked} inputRef={textarea}
        run={messages.findLast(message=>message.role==='assistant')?.run} input={inputQuestion} approval={approval} stopping={stopping} interactionVisible={interactionVisible} onLocate={locateInteraction}
        onSend={send} onStop={stop} onDraft={value=>updateChat(currentId,{draft:value})} modelsOpen={dialog==='models'} onModels={()=>openModels()} onRefreshModels={refreshModels}/>}
    </section>}
    {dialog==='skills' && <OfficeSkills host={host} hostName={hostProfile.name} onImported={skill=>updateChat(currentId,{documentSkill:skill,skillInput:undefined})} onUse={skill=>{updateChat(currentId,{documentSkill:skill,skillInput:undefined});setDialog(null);textarea.current?.focus();}} onClose={()=>setDialog(null)}/>}
    {dialog==='templates' && <OfficeTemplates onSkills={()=>setDialog('skills')} host={host} hostName={hostProfile.name} onRegister={registerCurrentTemplate} onUse={useCatalogTemplate} onClose={()=>setDialog(null)}/>}
    {dialog==='models' && <ModelSelection key={modelProvider} data={data} providerLabels={providers} initialProvider={modelProvider} disabled={busy || accountBusy} loading={accountBusy} onProviderSelect={changeProvider} onSelect={async model=>{try {setSession(await rpc('selectModel',{model}));return true;} catch(cause) {report(cause.message,true);return false;}}} onRefresh={refreshModels} onLogin={connect} onLogout={disconnect} onCancelLogin={cancelLogin} onClose={()=>setDialog(null)}/>}
    {dialog==='history' && <ConversationHistory conversations={conversations.filter(item=>item.messages.length).map(item=>({...item,current:item.id===currentId}))} providerLabels={providers} disabled={blocked} onAction={historyAction} onClose={options=>{setDialog(null);if(options?.focusComposer)requestAnimationFrame(()=>textarea.current?.focus());}}/>}
    {dialog==='settings' && <OfficeTools disabled={busy||selectionLoading} templateDisabled={blocked||!session?.connected} onSelection={showSelectionDetails} selectionLabel={hostProfile.selection} onTemplate={host==='excel'?openTemplate:undefined} onHistory={host==='excel'?showChanges:undefined} onHelp={()=>setDialog('help')} onClose={()=>setDialog(null)} version={__APP_VERSION__} initialFocus={helpFocus.current ? 'button[aria-label*="도움말"]' : undefined}>
      <DeckDisclosure title="연결 진단" icon="link"><div className="advanced-content"><div className="connection-row"><span>{session?.connected ? `${providers[session.provider]} 연결됨` : '로그인 필요'}</span><CopyButton getText={async()=>JSON.stringify({product:'nubi-office',provider:session?.provider,connected:session?.connected,version:__APP_VERSION__,modelsLoaded:session?.models?.length,modelCatalog:session?.modelCatalog,model:session?.model,verified:session?.verified},null,2)} label="진단 복사"/></div><p className="reply-note">{session?.verified ? '모델 응답을 확인했습니다.' : '모델 응답 확인 전입니다.'}</p></div></DeckDisclosure>
    </OfficeTools>}
    {connectProvider && <ConnectionDialog provider={connectProvider} onClose={()=>setConnectProvider(null)} onConnected={next=>{setSession(next);if (chat.provider!==next.provider) createConversation(next.provider);setConnectProvider(null);report('연결 정보를 설정했습니다. 첫 응답에서 모델 연결을 확인합니다.');}}/>}
    {dialog==='cell-details' && host!=='excel' && <ContentDetails host={host} scope={scope} loading={selectionLoading} error={selectionError} onRefresh={showSelectionDetails} onClose={()=>setDialog(null)} onRequest={target=>{updateChat(currentId,{draft:`${hostProfile.name}의 ${target}에 ${draft}`});setDialog(null);requestAnimationFrame(()=>textarea.current?.focus());}}/>}
    {dialog==='cell-details' && host==='excel' && <SelectionDetails scope={scope} loading={selectionLoading} error={selectionError} onRefresh={showSelectionDetails} onClose={()=>setDialog(null)} onRequest={address=>{updateChat(currentId,{draft:`${scope.worksheet}!${address} 셀의 ${draft}`});setDialog(null);requestAnimationFrame(()=>textarea.current?.focus());}}/>}
    {dialog==='changes' && <ChangeHistory items={changes} loading={changesLoading} error={changesError} busy={busy || restoring} onRetry={showChanges} onRestore={restoreChange} onClose={()=>setDialog(null)}/>}
    {dialog==='usage' && <OfficeUsage usage={usage} latest={lastMeasured?.run.metrics.usage.at(-1)} model={lastMeasured?.model} onClose={()=>setDialog(null)}/>}
    {dialog==='help' && <OfficeHelp host={host} onClose={()=>{helpFocus.current=true;setDialog('settings');}}/>}
  </CxAppShell>;
}
