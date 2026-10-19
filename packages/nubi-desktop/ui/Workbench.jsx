import {WorkflowRunView} from './WorkflowRunView.jsx';
import {afterEditCheckMessage} from './after-edit-check-message.mjs';
import {RoutineSettings} from './RoutineSettings.jsx';
import {ConversationUsage} from './ConversationUsage.jsx';
import {SettingsSection} from './SettingsSection.jsx';
import {AfterEditCheckSetting} from './AfterEditCheckSetting.jsx';
import {ConversationArchiveSetting} from './ConversationArchiveSetting.jsx';
import {IrreversibleNotice} from './IrreversibleNotice.jsx';
import {ChapterDivider,ChapterContents} from './ChapterMarks.jsx';
import {DocumentWorkStatus} from './DocumentWorkStatus.jsx';
import {useEditorConnection} from './EditorConnection.jsx';
import {ProcessRecovery} from './ProcessRecovery.jsx';
import {SettingToggle} from './SettingToggle.jsx';
import {ConversationWindow} from './ConversationWindow.jsx';
import {observeConversationVisibility} from './conversation-visibility.mjs';
import {ExternalAiPolicy} from './ExternalAiPolicy.jsx';
import {needsExternalAiPolicy,dismissExternalAiPolicy} from './external-ai-policy.mjs';
import {gitCloneErrors} from './git-clone-error.mjs';
import {mailConnectionErrors} from './mail-connection-error.mjs';
import {MailImageThumbs} from './MailImageThumbs.jsx';
import {wikiRefreshErrors,wikiRefreshNotice} from './wiki-refresh-view.mjs';
import {ProposalCard} from './ProposalCard.jsx';
import {WorkspaceUpdate,WorkspaceUpdateProgress,useWorkspaceUpdate} from './WorkspaceUpdate.jsx';
import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import {ClaudeConnection,ClaudeAccountUsage,ClaudeQuotaPill} from './ClaudeConnection.jsx';
import {MemoryPanel,MemoryNote} from './MemoryPanel.jsx';
import {OutgoingMessages,useOutgoingMessages,deliveryRecorded} from './OutgoingMessages.jsx';
import {welcomeGreeting} from './welcome-greetings.mjs';
import {submitTaskMessage} from './submit-task-message.mjs';
import {ConversationSearch} from './ConversationSearch.jsx';
import {mailSearchDraft} from './mail-search-draft.mjs';
import {AnswerSources} from './AnswerSources.jsx';
import {SideTaskChips} from './SideTaskChips.jsx';
import {OutputFileCards} from './OutputFileCards.jsx';
import {FileKindIcon} from './FileKindIcon.jsx';
import {DocumentChips} from './DocumentChips.jsx';
import {useOfficeConnection} from './OfficeConnection.jsx';
import '../design/office-connection.css';
const loadWorkflowPanel=()=>import('./WorkflowPanel.jsx').then(module=>({default:module.WorkflowPanel}));
const WorkflowPanel=lazy(loadWorkflowPanel);
const ChatDocumentPreview=lazy(()=>import('./DocumentPreview.jsx').then(module=>({default:module.DocumentPreview})));
import {AnalysisReviewProgress} from './AnalysisReviewProgress.jsx';
import {ProgressDisplaySetting,useProgressDisplay} from './ProgressDisplaySetting.jsx';
import {AnalysisHistory} from './AnalysisHistory.jsx';
import {AGENT_COMMANDS,desktopSkillCommand} from '../runtime/agent-commands.mjs';
import {replaceComposerCommand} from './composer-command-state.mjs';
import {MessageTimestamp} from './MessageTimestamp.jsx';
import {UsagePanel} from '../../../extensions/aipro-chat/src/UsagePanel.jsx';
import {ResponseTime} from './ResponseTime.jsx';
import {AppliedFileChanges} from './AppliedFileChanges.jsx';
import {MailEvidenceChips,useMailDraftReferences,appendMailReferences,removeMailReference} from './MailEvidence.jsx';
import {WorkspaceInputs} from './WorkspaceInputs.jsx';
import {WorkspaceActivity} from './WorkspaceActivity.jsx';
import {conversationActivity} from './conversation-activity.mjs';
import {NubiPreparing} from './NubiPreparing.jsx';


import {incomingRequests,badgeText} from './agent-connections.mjs';
import {useComposerDraft} from './useComposerDraft.js';
import {SessionSidebar} from './SessionSidebar.jsx';
import {WorkspaceIconAction} from './WorkspaceIconAction.jsx';
import {WorkspaceToolbar} from './WorkspaceToolbar.jsx';
import {DriftLabel} from './DriftLabel.jsx';
import {WorkspaceNavigation} from './WorkspaceNavigation.jsx';
import {GhesAccount} from './GhesAccount.jsx';
import {marketplaceAuthenticationErrors} from './CompanySkillSignIn.jsx';
import {ghesMessages} from './ghes-account-state.mjs';
import {providerLoginError,providerLoginDiagnostics} from './provider-login-state.mjs';
import {closeSession, openSession, restoreSessionNavigation, saveSessionNavigation} from './session-navigation.mjs';
import {flushSync} from 'react-dom';
import {SkillLibrary} from './SkillLibrary.jsx';
import {ComputerConnectionForm} from './ComputerConnectionForm.jsx';
import {ComputerUse} from './ComputerUse.jsx';
import {SetupActions} from './SetupActions.jsx';
import {CaptureOverlay} from './CaptureOverlay.jsx';
import {CaptureChips,CaptureThumbs,configureCaptureReader} from './CaptureChips.jsx';
import {cropCapture,captureAttachments,CAPTURE_LIMIT} from './captures.js';
import {DecisionPrompt} from './DecisionPrompt.jsx';
import {humanDecisions} from './human-decisions.mjs';
import {SystemDecisionNotifications} from './SystemDecisionNotifications.jsx';
import {NotificationBell} from './NotificationCenter.jsx';
import {animatedSetter} from './viewTransition.js';
import {ProjectStart} from './ProjectStart.jsx';
import {WikiInitializationProgress} from './WikiInitializationProgress.jsx';
import {TerminalBlock} from './TerminalBlock.jsx';
import {WindowMark,TerminalMark,RecoveryStatus} from './marks.jsx';
import {ApprovalModeControl} from './ApprovalMode.jsx';
import {WORKSPACE_LAYOUT} from '../electron-app/workspace-layout.cjs';
import {ApprovalBar} from './ApprovalBar.jsx';
import React, {lazy,Suspense,useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo} from 'react';
import {deferredScreen} from './deferred-screen.jsx';
const WikiBrowser=deferredScreen(()=>import('./WikiBrowser.jsx'),'WikiBrowser');
const MailHistory=deferredScreen(()=>import('./MailHistory.jsx'),'MailHistory');
const SkillManager=deferredScreen(()=>import('./SkillManager.jsx'),'SkillManager');
const MailLibrary=deferredScreen(()=>import('./MailLibrary.jsx'),'MailLibrary');
const MailLoginForm=deferredScreen(()=>import('./MailLoginForm.jsx'),'MailLoginForm');
const MailStorageSetup=deferredScreen(()=>import('./MailStorageSetup.jsx'),'MailStorageSetup');
const McpPanel=deferredScreen(()=>import('./McpPanel.jsx'),'McpPanel');
const SkillRegistration=deferredScreen(()=>import('./SkillRegistration.jsx'),'SkillRegistration');
import {CxButton, CxInput, CxNotice, DetailPanel, SearchInput, Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {AgentMark, NubiLogo} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {NubiLogin} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {ProjectWikiProgress,WikiProjectIdentity} from './ProjectWikiProgress.jsx';
import {WorkspaceComposer} from './WorkspaceComposer.jsx';
import {teamWorkspaceErrors} from './teamWorkspaceErrors.js';
import {useConversationScroll} from './useConversationScroll.js';
import {useSidebarResize} from './useSidebarResize.js';
import {DeckDisclosure, DeckStatus, DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {Welcome} from '../../../extensions/aipro-chat/src/Welcome.jsx';
import {AmbientScene, useMotionPreference} from '../../../extensions/aipro-chat/src/Atmosphere.jsx';
import {ContextMeter, ModelPicker, ModelSelection, ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {workspaceContextMeterInfo} from './context-gauge.mjs';
import {FabrixConnection} from '../../../extensions/aipro-chat/src/FabrixConnection.jsx';
import {QuestionDecision} from './QuestionDecision.jsx';
import {qualityLabel} from '../runtime/quality-status.mjs';
import {GitEmptyState} from './GitEmptyState.jsx';
import {WikiUpdate} from './WikiUpdate.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {WorkspaceSkillMenu} from './WorkspaceSkillMenu.jsx';
import {WorkspaceToast, notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {ReasoningPicker} from './ReasoningPicker.jsx';
import {mergeSnapshot} from './mergeSnapshot.js';
import {useWikiWorkApi} from './useWikiWorkApi.js';
import {useAnswerReveal} from './useAnswerReveal.js';

// After the user applies the last proposal, the task continues once, unless a command waits for its approval:
// a check proposed with its fix runs when the user approves it (2026-09-30).
const AUTO_STEPS=8;
// The shared ContextMeter also estimates a draft; the composer gauge shows the task's latest answer instead.
const NO_MESSAGES=[],NO_PROMPT={};
const showNotice=message=>notifyWorkspaceToast(message,{success:true});
const showError=message=>notifyWorkspaceToast(message,{error:true});
const providerLabels=DESKTOP_PROVIDER_LABELS;
function modelDisplayName(message, provider) {
  const id = message?.modelId || message?.model || provider?.model;
  const catalog = (provider?.models || []).find(item => item.id === id || item.name === id);
  return message?.modelName || catalog?.label || catalog?.displayName || catalog?.name || id || providerLabels[provider?.provider] || '모델';
}

// Keep unchanged message rows out of composer and streaming updates. Host snapshots
// already retain unchanged message references; callbacks read the current handlers.
function useConversationHandler(handler){
  const current=useRef(handler);useLayoutEffect(()=>{current.current=handler;},[handler]);
  return useCallback((...args)=>current.current?.(...args),[]);
}
// Transcript marks are static in the accepted UI. Mount only the visible
// face instead of five images, SVG effects and mascot timers for every row.
function ConversationMark({mood}){
 const sad=mood==='sad';
 return <span className="agent-mark nubi-answer-mark" data-mood={mood} aria-hidden="true" style={{'--agent-size':'20px'}}><img className={sad?'bird-frame bird-sad':'bird-base'} src={sad?'./icons/agent-sad.webp':'./icons/agent-bird.webp'} alt="" width={20} height={20} draggable="false"/></span>;
}
const ConversationMessage=memo(function ConversationMessage({message,index,content,modelName,assistant,timing,at,regenerating,canRegenerate,markMood,questionSlot,reveal,reviewed,reviewRef,api,onSource,onRegenerate,onForget,regenerateTitle,regenerateDisabled,memoryNotes}){
  const article=useRef(null);useEffect(()=>observeConversationVisibility(article.current),[]);
  const body=questionSlot||<MessageBody role={message.role} content={content} sourceReferences={message.sourceReferences} onSource={source=>onSource(source,message)} textReveal={reveal}/>;
  const actions=content&&<div className="message-actions">
    <MessageTimestamp at={at} role={message.role}/>
    <CopyButton text={content} label={`${assistant?'답변':'내'} 메시지 복사`} successMessage="메시지를 복사했습니다."/>
    {assistant&&<ResponseTime timing={timing} label=""/>}
    {canRegenerate&&<ActionButton action="refresh" iconOnly label="다시 응답 받기" title={regenerateTitle||"미반영 제안을 대체하고 다시 응답 받기"} busy={regenerating} disabled={regenerateDisabled} onClick={()=>onRegenerate(message)}/>}
  </div>;
  return (
      <article ref={article} className={`message message-${message.role} nubi-message ${message.role}`} data-message-key={message.inputId||message.id||message.at||index} aria-label={assistant?`${modelName} 답변`:'내 메시지'}>
        {assistant?body:<div className="nubi-user-bubble">{body}<MailEvidenceChips references={message.mailReferences} onOpen={source=>onSource?.({...source,kind:'mail'},message)}/><DocumentChips documents={message.documentReferences} onOpen={source=>onSource?.(source,message)}/><CaptureThumbs captures={message.captures}/></div>}
        {assistant&&content?<div className="nubi-message-footer"><div className="answer-model" title={modelName}><ConversationMark mood={markMood}/><span>{modelName}</span></div>{actions}</div>:actions}
        {reviewed&&<div ref={reviewRef} className="nubi-review-slot nubi-answer-review"/>}
        {assistant&&<CaptureThumbs captures={message.captures} label="사용한 화면 캡처"/>}
        {assistant&&<MailImageThumbs message={message} api={api} onOpen={source=>onSource?.(source,message)}/>}
        {assistant&&<AnswerSources message={message} onOpen={source=>onSource?.(source,message)}/>}
        {assistant&&memoryNotes?.filter(note=>note.runId===message.runId).map(note=><MemoryNote key={note.runId} note={note} onForget={onForget}/>)}
      </article>
  );
});
function ConversationMessages({api,messages,indexOffset=0,task,provider,beforeMessage,afterMessage,questionMessage,questionControl,onRegenerate,onSource,onForget,regenerateDisabled=false,regenerateTitle,revealAnswers,reviewMessage,reviewRef}) {
  // Idle stays attentive. No inactivity timer or sleep/wake transition.
  const resting = 'idle';
  const openSource=useConversationHandler(onSource),regenerate=useConversationHandler(onRegenerate),forget=useConversationHandler(onForget);
  return messages.map((message,localIndex)=>{
    const index=indexOffset+localIndex;
    const content=message.displayContent||message.content||'',modelName=modelDisplayName(message,provider);
    const assistant = message.role === 'assistant';
    const latest = assistant && message === task?.messages?.at(-1);
    // A run can also contain questions or interim messages. Its final duration
    // belongs only to the last answer, never to every message from that run.
    const timing = message.responseTiming || (latest && !message.questionId && message.runId && task?.responseTiming?.runId === message.runId && task.responseTiming.state === 'completed' ? task.responseTiming : null);
    const at = assistant ? timing?.finishedAt || message.at : message.sentAt || message.at;
    const regenerating = latest && task?.replyRegeneration?.state === 'running';
    const canRegenerate = latest && onRegenerate && task.state === 'review';
    const markMood = regenerating || message.state === 'pending' ? 'working' : message.error === 'cancelled' ? 'still' : message.error ? 'sad' : resting;
    return <React.Fragment key={message.id||message.inputId||index}>
      {beforeMessage?.(message,index)}
      <ConversationMessage message={message} index={index} content={content} modelName={modelName} assistant={assistant} timing={timing} at={at} regenerating={regenerating} canRegenerate={!!canRegenerate} markMood={markMood}
        questionSlot={message===questionMessage?questionControl:null} reveal={!!(assistant&&revealAnswers?.has(message.id))} reviewed={message===reviewMessage} reviewRef={message===reviewMessage?reviewRef:null}
        api={api} onSource={openSource} onRegenerate={regenerate} onForget={forget} regenerateTitle={canRegenerate?regenerateTitle:undefined} regenerateDisabled={!!(canRegenerate&&regenerateDisabled)} memoryNotes={task?.memoryNotes}/>
      {afterMessage?.(message)}
    </React.Fragment>;
  });
}
export const waitingOn=(state,taskId)=>state.tasks?.some(t=>t.id===taskId&&t.afterEditCheckError)||[...(state.proposals||[]),...(state.setupActions||[]),...(state.commandRepairs||[])].some(item=>item.taskId===taskId&&item.state==='proposed');
const errors = {side_task_invalid:'작업의 파일 경로와 기대 결과를 구체적으로 확인해 주세요.',side_task_limit:'한 실행에서는 다음 작업을 3개까지 제안할 수 있어요.',side_task_missing:'이 작업 제안을 찾을 수 없어요.',side_task_state:'이미 처리한 작업 제안이에요. 현재 대화를 확인해 주세요.',output_invalid:'산출물을 찾을 수 없어요. 파일이나 캡처가 남아 있는지 확인해 주세요.',output_outside:'현재 프로젝트 안의 파일만 열 수 있어요.',output_card_limit:'한 번의 실행에는 산출물을 5개까지 붙일 수 있어요.',output_preview_unavailable:'이 화면에서는 캡처를 열 수 없어요. Desktop에서 확인해 주세요.',pin_limit:'대화는 50개까지 고정할 수 있어요. 기존 고정을 해제한 뒤 다시 시도해 주세요.',task_pinned:'고정한 대화는 보관할 수 없어요. 먼저 고정을 해제해 주세요.',archive_days_invalid:'자동 보관 일수는 0 이상의 정수로 입력해 주세요.',archive_invalid:'보관 상태를 다시 확인해 주세요.',pins_invalid:'고정 목록을 다시 확인해 주세요.',shell_not_selected:"기본 터미널이 바뀌었어요. 선택한 터미널에 맞는 명령을 다시 준비해 주세요.",wiki_chat_blocked:'위키 작성이 끝나면 이 프로젝트에서 대화할 수 있어요.',claude_models_unavailable:'Claude 모델 목록을 받지 못했어요. 다시 연결해 주세요.',claude_cli_missing:'설치된 Claude Code의 실행 경로를 확인해 주세요.',claude_cli_unavailable:'Claude Code 파일에 접근할 수 없어요. 실행 권한을 확인해 주세요.',claude_cli_update:'Claude Code를 업데이트해 주세요.',claude_login_required:'Claude Code에서 로그인한 뒤 다시 연결해 주세요.',claude_cli_failed:'Claude Code 실행을 완료하지 못했어요. 로그인과 연결을 확인해 주세요.',claude_cli_timeout:'Claude Code 응답이 늦어 중지했어요. 기록은 보존했습니다.',claude_response_invalid:'Claude 응답 형식을 확인하지 못했어요. 기록은 보존했습니다.',clone_root_mismatch:'복제한 저장소의 경로가 달라요. 프로젝트 폴더를 확인해 주세요.',project_active:'진행 중인 작업과 확인 질문을 마친 뒤 목록에서 제거해 주세요.',project_changed:'프로젝트가 바뀌었어요. 현재 대화에서 출처를 다시 열어 주세요.',project_catalog_unavailable:'프로젝트 목록을 저장하거나 읽지 못했어요. 저장 위치의 권한을 확인해 주세요.',project_name_invalid:'프로젝트 이름을 80자 이내로 입력해 주세요.',answer_source_changed:'답변 이후 원문이 바뀌었어요. 다시 검색해 주세요.',mail_attachment_beta_disabled:'Beta에서는 첨부 다운로드만 지원해요. 메일 본문으로 질문해 주세요.',mail_source_changed:'답변 이후 메일이나 첨부가 바뀌었어요. 다시 검색해 주세요.',skill_command_missing:'일치하는 명령이나 스킬이 없어요. /를 입력해 목록에서 선택해 주세요.',skill_command_ambiguous:'이름이 같은 스킬이 있어요. 스킬 관리에서 이름을 구분해 주세요.',agent_command_ui_only:'입력창에서 /를 입력해 해당 메뉴를 열어 주세요.',invalid_model:'선택한 모델로 요청하지 못했어요. 모델 목록을 새로고침한 뒤 다시 선택해 주세요.',request_rejected:'모델이 요청 설정을 거절했어요. 모델과 추론 정도를 확인해 주세요.',request_format:'모델이 요청 형식을 받지 못했어요. 대화 기록은 보존했습니다.',request_endpoint:'모델 서버의 요청 주소를 확인할 수 없어요.',agent_input_closed:'지금은 메시지를 반영할 수 없어요. 초안은 보존했습니다.',agent_input_changed:'대기 메시지가 바뀌었어요. 현재 목록을 확인해 주세요.',agent_input_full:'대기 메시지는 20개까지 넣을 수 있어요.',agent_input_invalid:'메시지를 16,000자 이내로 입력해 주세요.',setup_waiting_for_proposals:'수정안을 먼저 반영해 주세요. 반영하면 이 명령을 실행할 수 있어요.',process_running:'명령이 실행 중인 대화는 끝난 뒤 삭제해 주세요.',worktree_remove_failed:'대화의 작업 폴더를 지우지 못했어요. 그 폴더를 연 창이나 터미널을 닫고 다시 삭제해 주세요.',remote_invalid:'https://, ssh:// 또는 git@ 주소를 넣어 주세요.',project_picker_unavailable:'폴더 선택 창을 열지 못했어요. 앱을 다시 시작한 뒤 다시 눌러 주세요.',project_path_missing:'폴더를 찾지 못했어요. 경로를 확인하고 다시 열어 주세요.',project_path_denied:'이 폴더를 읽을 권한이 없어요. 권한이 있는 폴더를 열어 주세요.',not_git_repository:'Git 저장소가 아닌 폴더예요. Git으로 관리하는 프로젝트 폴더를 골라 주세요.',git_unavailable:'Git을 찾지 못했어요. Git을 설치한 뒤 프로젝트를 다시 열어 주세요.',git_unsafe_directory:'Git이 이 폴더의 소유자를 확인할 수 없어 막았어요. 터미널에서 git config --global --add safe.directory <폴더 경로>를 실행한 뒤 다시 열어 주세요.',git_timeout:'Git이 응답하지 않았어요. 잠시 뒤 다시 열어 주세요.',workspace_untrusted:'신뢰한 폴더만 열 수 있어요. 신뢰 확인 창에서 "Yes, I trust the authors"를 눌러 주세요.',work_plan_invalid:'AI가 작업 계획 형식을 맞추지 못했어요. 기록은 보존됐으며 ‘이어서 진행’으로 다시 시도할 수 있어요.',goal_review_failed:'요구사항과 결과를 끝까지 대조하지 못했어요. 기록을 확인하고 이어갈 수 있어요.',elevation_approval_required:'관리자 권한 실행을 별도로 승인해 주세요.',elevation_unavailable:'관리자 실행은 Windows PowerShell에서 지원합니다.',elevation_command_limit:'관리자 명령을 3000자 이내의 짧은 작업으로 나누고 권한이 필요한 이유를 적어 주세요.',context_input_too_large:'현재 모델의 문맥 한도를 넘었어요. 대화는 보존했습니다. 더 큰 문맥을 지원하는 모델로 이어가 주세요.',context_compaction_failed:'대화를 정리하지 못했어요. 원문은 보존했습니다. 다시 이어갈 수 있어요.',context_history_changed:'대화가 바뀌어 요약을 저장하지 않았어요. 현재 대화로 다시 이어가 주세요.',file_exists:'같은 이름의 파일이 생겼어요. 현재 파일을 읽고 새 제안을 만들어 주세요.',parent_missing:'저장할 폴더가 없어요. 폴더 생성부터 승인해 주세요.',project_rules_changed:'프로젝트 규칙이 바뀌었어요. 규칙과 변경 계획을 다시 확인해 주세요.',rules_unavailable:'프로젝트 규칙을 읽지 못했어요. 파일 경로와 권한을 확인해 주세요.',proposal_missing:'변경 제안이 더 이상 없어요. 목록을 새로고침해 주세요.',zip_limit:'ZIP이 너무 커요. 파일당 16 MB, 전체 256 MB까지 가져올 수 있어요.',provider_changed:'모델 연결이 바뀌었어요. 모델을 다시 고른 뒤 시도해 주세요.',process_missing:'명령 기록을 찾을 수 없어요. 이미 끝났거나 지워졌어요.',setup_changed:'근거 파일이나 제안이 바뀌었어요. 현재 내용으로 다시 준비해 주세요.',setup_cancelled:'중지한 작업입니다. 실행할 내용을 다시 확인해 주세요.',setup_execution_unconfirmed:'실행 상태를 확인해 주세요. 같은 명령을 반복하지 않습니다.',agent_busy:'AI가 다른 작업을 확인하고 있어요. 입력한 내용은 보관했어요.',proposal_invalid_syntax:'수정안에 새 문법 오류가 있어요. 오류를 고친 뒤 다시 제안해 주세요.',quality_unavailable:'문법 검사를 마치지 못했어요. 변경안은 보존했습니다.',search_unavailable:'검색 실행기를 찾지 못했어요. 설치 상태를 확인해 주세요.',wiki_evidence_stale:'위키 근거가 바뀌었어요. 현재 문서와 코드를 다시 확인해 주세요.',wiki_evidence_required:'변경 계획에 쓸 위키 근거를 다시 찾아 주세요.',tool_unsettled:'이전 도구의 결과를 기다리고 있어요. 중복 실행은 막았습니다.',recovery_changed:'현재 작업 상태를 다시 확인해 주세요.',model_timeout:'모델 응답이 없어 진행 기록을 보존했어요.',network:'모델 연결이 끊겼어요. 진행 기록부터 이어갈 수 있어요.',rate_limited:'모델 사용 한도에 도달했어요. 다른 모델로 바꾸거나 한도가 초기화된 뒤 이어가세요.',unauthorized:'모델을 다시 연결한 뒤 이어가 주세요.',question_pending:'먼저 확인 질문에 답해 주세요.',question_changed:'질문 상태가 바뀌었어요. 현재 질문을 다시 확인해 주세요.',project_locked:'다른 누비 창에서 사용 중이에요. 해당 창에서 이어가 주세요.',source_read_required:'수정할 구간을 다시 읽어야 해요.',applied_changed:'반영 후 파일이 바뀌었어요. 현재 파일로 새 제안을 만들어 주세요.',knowledge_busy:'위키 기록을 저장하고 있어요. 잠시 후 다시 확인해 주세요.',editor_dirty:'저장하지 않은 수정이 있어요. 파일을 먼저 확인해 주세요.',source_stale:'파일 내용이 바뀌었어요. 최신 내용을 다시 읽고 진행해 주세요.',provider_missing:'먼저 로그인하면 분석을 시작할 수 있어요.',project_busy:'진행 중인 작업을 마친 뒤 프로젝트를 바꿔 주세요.',preview_scope:'이 버전은 localhost 화면만 비교할 수 있어요.',preview_http_error:'비교할 화면을 열지 못했어요. 서버 주소와 실행 상태를 확인해 주세요.',command_invalid:'실행할 명령을 입력해 주세요.',shell_unavailable:'선택한 셸을 찾을 수 없어요. 설치 상태를 확인하고 다시 선택해 주세요.',agent_failed:'모델 요청을 완료하지 못했어요. 연결을 확인한 뒤 다시 시작해 주세요.',host_disconnected:'실행기 연결이 종료됐어요. 앱을 다시 열어 작업 기록을 확인해 주세요.',write_unconfirmed:'저장 결과가 제안과 다릅니다. 실제 파일을 확인해 주세요.',operation_failed:'작업을 완료하지 못했어요. 입력과 실행 환경을 확인해 주세요.'};
// A code without its own message is shown with the code, not as advice to check input and connection.
const failure=(error,lead='요청을 처리하지 못했어요. 다시 시도해 주세요.')=>teamWorkspaceErrors[error?.message]||gitCloneErrors[error?.message]||errors[error?.message]||lead+(/^[a-z][a-z0-9_]{2,60}$/.test(error?.message||'')?` 오류 코드: ${error.message}`:'');
// The task a first opened project starts with.
const OPENED_BY_BUTTON='nubi-workspace-opened-by-button';
Object.assign(errors,{answer_changed:'대화가 바뀌었어요. 마지막 답변에서 다시 눌러 주세요.',approval_pending:'승인한 동작이 시작 중이에요. 실행 상태를 확인해 주세요.',regeneration_process_active:'이 대화의 명령이 아직 실행 중이에요. 실행이 끝난 뒤 다시 응답받을 수 있어요.'});
Object.assign(errors,{mail_reference_limit:'메일 근거는 20개까지 연결할 수 있어요. 일부를 제거해 주세요.',mail_input_invalid:'연결한 메일 근거를 다시 선택해 주세요.'});
Object.assign(errors,{native_office_selection_changed:'Office 연결이 만료됐어요. +에서 문서를 다시 선택해 주세요.',native_office_scope_changed:'대화가 바뀌었어요. 이 대화에서 Office 문서를 다시 선택해 주세요.'});
const ENVIRONMENT_REQUEST='처음 연 프로젝트예요. 실행 환경(매니페스트, 잠금 파일, README, 설정 파일)을 확인하고, 필요한 의존성 설치와 빌드, 테스트를 하나씩 제안해 줘. 설치와 실행은 승인받은 뒤에만 해 줘.';
// The window reloads when a folder opens, so the button leaves a short-lived mark in storage.
const markOpened=()=>{try{localStorage.setItem(OPENED_BY_BUTTON,String(Date.now()));}catch{/* Only the environment task depends on it. */}};
const openedByButton=()=>{try{const at=Number(localStorage.getItem(OPENED_BY_BUTTON));localStorage.removeItem(OPENED_BY_BUTTON);return at>0&&Date.now()-at<120000;}catch{return false;}};
const stateLabel = {creating:'저장 확인 중',attention:'저장 확인 필요',conflicted:'기존 파일 확인 필요',checking:'실행 전 확인',paused:'복구 대기',timed_out:'시간 제한으로 중단',draft:'준비됨',ready:'작업 공간 준비됨',running:'진행 중',stopping:'중지 중',completed:'실행 종료',review:'결과 검토',waiting_input:'답변 대기',failed:'확인 필요',cancelled:'중지됨',interrupted:'중단된 작업',proposed:'검토 대기',applied:'반영됨'};
function localServerUrls(output){const seen=new Set(),urls=[];for(const match of String(output||'').matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"`<>)\]]*)?/g)){let url;try{url=new URL(match[0]);}catch{continue;}if(url.hostname==='0.0.0.0')url.hostname='localhost';if(seen.has(url.origin))continue;seen.add(url.origin);urls.push(url.href);}return urls.slice(0,3);}
export function Workbench({createEditorDraft,connectEditor,api:requestApi,initialProject=null,initialProvider=null,installUpdate,showAnalysisHistory=false,projects=[],switchProject,focusDecision,renameProject,removeProject,openCurrent,startConversation,chooseFolder,activeView,activeFile,wikiInitialization,openMailDocument,openMailSources,closeMailDocument,importProject,cloneRepository,workspaceView,openTerminal,hostLayout,toolbarHost,onMinimumAgentWidth,connectMarketplace,openTeamWorkspace,ghesAccount,ghesUpdate,ghesRepositories,openPath,openOutput,review,reviewApplied,apply,openURI,openBrowser,openWebPage,toastHost=true,startupRequest,onStartupHandled,mailDraftRequest,onMailDraftHandled}) {
  const [initialNavigation]=useState(()=>initialProject?.projectId?restoreSessionNavigation(initialProject.projectId,initialProject.tasks||[]):{tabs:[],selected:null});
  const [project,setProject]=useState(initialProject),[taskId,setTaskId]=useState(initialNavigation.selected),[environmentPending,setEnvironmentPending]=useState(false);
  const conversationTools=requestApi.capabilities?.conversationTools!==false;
  const {api,pending:wikiPending}=useWikiWorkApi(requestApi,project,setProject);
  const workspaceUpdate=useWorkspaceUpdate(api,installUpdate);
  const [mailPage,setMailPageRaw]=useState(false),[wikiPage,setWikiPageRaw]=useState(false);
  // A light poll keeps the rail's mail icon honest about collection and organisation in progress (2026-10-14).
  const [projectPicker,setProjectPicker]=useState(false),[personalStart,setPersonalStart]=useState(false),[reviewSlot,setReviewSlot]=useState(null);
  // Screenshots of the Workspace window attached to the next message (user request 2026-10-14).
  const [documentReading,setDocumentReading]=useState(false),[selectedDocument,setSelectedDocument]=useState(null);
  const [draftCaptures,setDraftCaptures]=useState([]),[capturing,setCapturing]=useState(false),[capturePreview,setCapturePreview]=useState(null);
  useEffect(()=>{configureCaptureReader(api);},[api]);
  const [skillImportBusy,setSkillImportBusy]=useState(false),skillRegistrationOrigin=useRef(null);
  const [ghesState,setGhesState]=useState(null);
  const [accountRevision,setAccountRevision]=useState(0),[accountOpen,setAccountOpen]=useState(false),[accountLoginRequest,setAccountLoginRequest]=useState(0),accountButton=useRef(null),pendingMarketplace=useRef(null);
  const [skillTab,setSkillTab]=useState('installed'),[skillsPage,setSkillsPageRaw]=useState(false),[skillRevision,setSkillRevision]=useState(0);const skillsButton=useRef(null),skillsPanelTrigger=useRef(null);
  function registerSkill(){
    if(actionLock.current||skillImportBusy)return;
    skillRegistrationOrigin.current={panel:panel==='skills'?'skills':null,trigger:document.activeElement};
    setPanel('skill-import');
  }
  function closeSkillRegistration(){
    if(skillImportBusy)return;
    const origin=skillRegistrationOrigin.current;skillRegistrationOrigin.current=null;
    setSkillTab('installed');setPanel(origin?.panel||null);
    requestAnimationFrame(()=>{const target=origin?.trigger?.isConnected?origin.trigger:document.querySelector('.nubi-custom-skill-register');target?.focus({preventScroll:true});});
  }
  function skillRegistered(){
    setSkillRevision(value=>value+1);
    const origin=skillRegistrationOrigin.current;skillRegistrationOrigin.current=null;
    setSkillTab('installed');setPanel(origin?.panel||null);
    requestAnimationFrame(()=>document.querySelector('.nubi-custom-skill-register')?.focus({preventScroll:true}));
  }
  // Hydrate a switched project before its first paint, including its selected conversation.
  // Declared after `project` above: the poll reads it (initialisation-order error reported 2026-10-14).
  const [mailBusy,setMailBusy]=useState(false),[mailStorage,setMailStorage]=useState(null);
  const mailStorageDismissed=useRef(false);
  useEffect(()=>{if(!project)return;let live=true;const read=async()=>{try{const status=await api('mail',{action:'status',includeMessages:false});if(live){setMailBusy(!!(status?.connected&&(status.checking||status.summarizing||status.readingAttachments||status.localImport?.state==='importing'||status.localImport?.state==='scanning')));if(status?.connected&&status.requiresStorageSetup&&!mailStorageDismissed.current)setMailStorage(current=>current||status);else if(!status?.connected||!status.requiresStorageSetup)setMailStorage(null);}}catch{if(live)setMailBusy(false);}};void read();const timer=setInterval(read,20000);return()=>{live=false;clearInterval(timer);};},[api,project?.projectId]);
  useEffect(()=>{if(wikiPage)setWikiPage(false);},[project?.projectId]);
  function startCompanySignIn(){
    flushSync(()=>{setPanel(null);setAccountOpen(true);setAccountLoginRequest(value=>value+1);});
  }
  function restoreMarketplacePanel(pending){
    if(!pending||pending.projectId!==project?.projectId||pending.taskId!==taskId||pending.skillsPage!==skillsPage||mailPage)return;
    if(pending.panel==='skills'){setSkillTab(pending.skillTab);setPanel('skills');}
  }
  async function connectCompanyMarketplace({interactive=true}={}){
    try{const result=await connectMarketplace();if(!result?.loginRequired)return result;}
    catch(error){if(!interactive||!marketplaceAuthenticationErrors.has(error.message))throw error;}
    if(!interactive)return {loginRequired:true};
    pendingMarketplace.current={projectId:project?.projectId,taskId,panel:panel==='skills'?'skills':null,skillTab:'marketplace',skillsPage};
    startCompanySignIn();return {cancelled:true};
  }
  async function accountConnected(){
    setAccountRevision(value=>value+1);
    const pending=pendingMarketplace.current;pendingMarketplace.current=null;
    // Any company login (top-right or a section's sign-in button) connects the skill marketplace too.
    if(!pending&&connectMarketplace)void connectMarketplace().catch(()=>{});
    if(pending&&pending.projectId===project?.projectId){
      try{const result=await connectMarketplace();if(result?.loginRequired)throw Error('ghes_login_required');}
      catch(error){showError(ghesMessages[error.message]||'스킬 연결을 다시 확인해 주세요.');}
      setSkillRevision(value=>value+1);restoreMarketplacePanel(pending);
    }
    setAccountOpen(false);
  }
  function cancelCompanyConnection(){setAccountRevision(value=>value+1);const pending=pendingMarketplace.current;pendingMarketplace.current=null;restoreMarketplacePanel(pending);setAccountOpen(false);}
  function returnHome(){panelOrigin.current=null;setMailPage(false);setWikiPage(false);setSkillsPage(false);setPanel(null);if(activeView)void workspaceView(null);selectSession(null);requestAnimationFrame(()=>composer.current?.focus());}
  function enterTeamWorkspace(){panelOrigin.current=null;setPanel(null);setMailPage(false);setSkillTab('marketplace');setWikiPage(false);setSkillsPage(true);if(activeView)void workspaceView?.(null);if(compact)setSidebarOpen(false);}
  // The inquiry screen (ai_workspace service desk) opens from the bottom of the rail (user request 2026-10-14).
  function enterInquiry(){panelOrigin.current=null;setPanel(null);setMailPage(false);setSkillTab('support');setWikiPage(false);setSkillsPage(true);if(activeView)void workspaceView?.(null);if(compact)setSidebarOpen(false);}
  const [openTabs,setOpenTabs]=useState(initialNavigation.tabs),[tabsProject,setTabsProject]=useState(initialProject?.projectId||null);
  const [minimumAgentWidth,setMinimumAgentWidth]=useState(WORKSPACE_LAYOUT.minimumAgent);
  const railWidth=hostLayout==='integrated'&&workspaceView?WORKSPACE_LAYOUT.rail:0;
  const sidebarBreakpoint=hostLayout==='integrated'?railWidth+WORKSPACE_LAYOUT.minimumProjects+minimumAgentWidth:900;
  const workbenchNode=useRef(null),[hostWidth,setHostWidth]=useState(window.innerWidth);
  const compact=hostWidth<sidebarBreakpoint;
  const [sidebarOpen,setSidebarOpenRaw]=useState(()=>window.innerWidth>sidebarBreakpoint);
  // Screen and sidebar changes morph (viewTransition.js); the setters keep their names for every caller.
  const setMailPage=useMemo(()=>animatedSetter(setMailPageRaw),[]),setWikiPage=useMemo(()=>animatedSetter(setWikiPageRaw),[]),setSkillsPage=useMemo(()=>animatedSetter(setSkillsPageRaw),[]),setSidebarOpen=useMemo(()=>animatedSetter(setSidebarOpenRaw),[]);
  const resizeSidebar=!!project&&sidebarOpen&&!compact;
  const sidebarResize=useSidebarResize(workbenchNode,{hostWidth,railWidth,reservedWidth:compact?0:minimumAgentWidth,enabled:resizeSidebar,defaultWidth:WORKSPACE_LAYOUT.projects,minWidth:WORKSPACE_LAYOUT.minimumProjects});
  useLayoutEffect(()=>{onMinimumAgentWidth?.(minimumAgentWidth);},[minimumAgentWidth,onMinimumAgentWidth]);
  const [mailLogin,setMailLogin]=useState(null);
  useEffect(()=>{
   let live=true;
   const open=()=>{setPanel(null);setMailStorage(null);setMailLogin({checkSession:true});};
   window.addEventListener('nubi-mail-login',open);
   const storage=()=>{mailStorageDismissed.current=false;void api('mail',{action:'status',includeMessages:false}).then(status=>{if(live&&status.connected&&status.requiresStorageSetup){setPanel(null);setMailLogin(null);setMailStorage(status);}}).catch(()=>{});};
   window.addEventListener('nubi-mail-storage',storage);
   const unsubscribe=window.nubi?.onHostEvent?.(event=>{if(event.type==='mail_login_open')void open();if(event.type==='mail_portal_connected'&&event.requiresStorageSetup)storage();});
   return()=>{live=false;window.removeEventListener('nubi-mail-login',open);window.removeEventListener('nubi-mail-storage',storage);unsubscribe?.();};
  },[]);
  const [request,setRequest,readDraft,moveDraft]=useComposerDraft(project?.projectId,taskId);
  const [mailReferences,setMailReferences,readMailReferences,moveMailDraft]=useMailDraftReferences(project?.projectId,taskId);
  const projectRefForSubmit=useRef(project?.projectId);projectRefForSubmit.current=project?.projectId;
  const [draftDocuments,setDraftDocuments,readDocumentDraft,moveDocumentDraft]=useMailDraftReferences(project?.projectId,taskId,'document');
  const draftScope=useRef(null);draftScope.current=JSON.stringify([project?.projectId,taskId]);
  useEffect(()=>{setDraftCaptures([]);setCapturing(false);setSelectedDocument(null);},[taskId,project?.projectId]);
  const [inputBusy,setInputBusy]=useState(false),inputLock=useRef(false),inputAttempt=useRef(null),draftLatest=useRef('');draftLatest.current=request;
  const historyTrigger=useRef(null);
  const [outgoing,setOutgoing]=useOutgoingMessages();
  const visibleOutgoing=outgoing.filter(item=>item.projectId===project?.projectId&&item.taskId===(taskId??null)&&!projectPicker);
  const sendingOutgoing=visibleOutgoing.find(item=>item.phase!=='unconfirmed');
  useEffect(()=>{if(!project)return;setOutgoing(items=>{const next=items.filter(item=>item.projectId!==project.projectId||!deliveryRecorded(item,project.tasks?.find(task=>task.id===item.taskId)));return next.length===items.length?items:next;});},[project,setOutgoing]);
  const dismissOutgoing=id=>setOutgoing(items=>items.filter(item=>item.id!==id));
  const [submitting,setSubmitting]=useState(false),submitLock=useRef(false);
  const [mailConnecting,setMailConnecting]=useState(false);
  const [conversationUsageId,setConversationUsageId]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[panel,setPanel]=useState(null);const panelRef=useRef(null);panelRef.current=panel;
  useEffect(()=>{setConversationUsageId(null);setPanel(current=>current==='conversation-usage'?null:current);},[project?.projectId]);
  const [externalAiPolicy,setExternalAiPolicy]=useState(null);
  const [claudeChecking,setClaudeChecking]=useState(false),[claudeIssue,setClaudeIssue]=useState(null);
  const usageButton=useRef(null),usageRead=useRef(0),usageAccountPending=useRef(null);
  const [usageData,setUsageData]=useState({auth:{provider:'aipro',present:false},connections:{}});
  const loadAccountUsage=useCallback(async({force,signal})=>{
    const revision=++usageRead.current;usageAccountPending.current=revision;
    try {const data=await api('usage',{action:'account',force});if(!signal.aborted&&revision===usageRead.current)setUsageData(data);}
    catch {if(!signal.aborted&&revision===usageRead.current)setUsageData(data=>({...data,accountUsage:{...data.accountUsage,error:'quota_unavailable'}}));}
    finally {if(usageAccountPending.current===revision)usageAccountPending.current=null;}
  },[api]);
  // One short Claude request reads the current limits; the pill and the panel follow the provider status.
  const readClaudeCliUsage=useCallback(()=>api('claudeCliUsage',{action:'read'}),[api]);
  const refreshClaudeQuota=useCallback(async()=>{const value=await api('provider',{action:'quota'});if(!mounted.current)return;setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);const revision=++usageRead.current;const data=await api('usage');if(mounted.current&&revision===usageRead.current)setUsageData(data);},[api]);
  useEffect(()=>{
    if(panel!=='usage')return;
    let alive=true,pending=false;
    const read=async()=>{if(pending||document.hidden||usageAccountPending.current!==null)return;pending=true;const revision=++usageRead.current;
      try {const data=await api('usage');if(alive&&revision===usageRead.current)setUsageData(data);}
      catch {if(alive&&revision===usageRead.current)setUsageData(data=>({...data,usageError:'usage_unavailable'}));}
      finally {pending=false;}
    };
    void read();const timer=setInterval(read,2000);
    return()=>{alive=false;usageRead.current++;usageAccountPending.current=null;clearInterval(timer);};
  },[panel,api]);
  const panelBehindBrowser=useRef(null);
  useEffect(()=>window.nubi?.onBrowserEvent?.(event=>{if(event.type==='opened'){panelBehindBrowser.current=['mail','usage'].includes(panelRef.current)?panelRef.current:null;panelOrigin.current=null;setPanel(null);setAccountOpen(false);}else if(event.type==='closed'&&event.returnToApp&&panelBehindBrowser.current){const back=panelBehindBrowser.current;panelBehindBrowser.current=null;setPanel(back);}}),[]);
  const [nativeChanges,setNativeChanges]=useState(null),[nativePatch,setNativePatch]=useState(null);
  async function openWorkspaceView(view){const result=await workspaceView(view);if(result?.changes){setNativeChanges(result.changes);setNativePatch(null);setPanel('changes');}}
  const [catalogLoading,setCatalogLoading]=useState(null),catalogRequests=useRef(new Map()),providerRevision=useRef(0);
  const [provider,setProvider]=useState(initialProvider),[processResult,setProcessResult]=useState(null);
  // A server started from the conversation opens in the app browser by itself, once per server (user request 2026-10-14:
  // "서버 띄우면 앱 웹에서 띄워서 보여야지"); the card below stays for reopening and stopping it.
  const openedServers=useRef(new Set());
  useEffect(()=>{
    if(!processResult||!['checking','running'].includes(processResult.state))return;
    const url=localServerUrls(processResult.output)[0];if(!url)return;
    const key=`${processResult.id}|${new URL(url).origin}`;if(openedServers.current.has(key))return;
    openedServers.current.add(key);void Promise.resolve(api('openWorkspacePage',{url})).catch(()=>{});
  },[processResult?.id,processResult?.state,processResult?.output]);
  // Claude limits travel only with model responses: read them once after login, and when the usage panel opens on data older than five minutes (user decision 2026-10-14).
  const quotaProbe=useRef(0);
  useEffect(()=>{if(panel!=='usage'||provider?.provider!=='claude'||!provider?.connected)return;const stale=!provider.quota?.windows?.length||Date.now()-(provider.quota.fetchedAt||0)>300000;if(!stale||Date.now()-quotaProbe.current<60000)return;quotaProbe.current=Date.now();void refreshClaudeQuota().catch(()=>{});},[panel,provider?.provider,provider?.connected]);
  const loginErrorToast=useRef('');
  useEffect(()=>{
    const message=providerLoginError(provider);
    if(!message){loginErrorToast.current='';return;}
    const key=`${provider?.persistenceError||provider?.loginError}:${provider?.loginDiagnostics?.at(-1)?.at||''}`;
    if(loginErrorToast.current===key)return;
    loginErrorToast.current=key;showError(message);
  },[provider?.loginError,provider?.persistenceError,provider?.loginDiagnostics]);
  const [script,setScript]=useState(''),[shell,setShell]=useState(''),[beforeUrl,setBeforeUrl]=useState(''),[afterUrl,setAfterUrl]=useState(''),[comparison,setComparison]=useState(null),[overlay,setOverlay]=useState(false);
  const [knowledge,setKnowledge]=useState(null),[timeoutSeconds,setTimeoutSeconds]=useState(0),[autoDiagnose,setAutoDiagnose]=useState(true);
  const [answer,setAnswer]=useState(''),[welcomeAnimated,setWelcomeAnimated]=useState(null);
  const [approval,setApproval]=useState({mode:'ask',allowedCommands:[]});
  const motion=useMotionPreference(),resting='idle';
  const [greeting,setGreeting]=useState(()=>welcomeGreeting());
  const intro={title:hostLayout==='integrated'?'모델을 연결해 시작하세요.':greeting,description:null};
  const modelData={activeProvider:provider?.provider||'aipro',settings:{modelId:provider?.model||''},catalog:{models:(provider?.models||[]).map(m=>({...m,name:m.id,displayName:m.label||m.id})),diagnostics:provider?.modelCatalog?.diagnostics},connections:Object.fromEntries((provider?.providers||[]).map(p=>[p.id,{present:p.connected,receivedAt:p.connectionId||0}])),pending:provider?.pending?{provider:provider.pending,phase:provider.pendingPhase||'waiting'}:null,report:{provider:provider?.provider,error:provider?.loginError}};
  const fabrixRpc=useCallback((method,args)=>api('fabrix',{method,...args}),[api]);
  const panelOrigin=useRef(null),modelTrigger=useRef(null),mailButton=useRef(null);
  const shownWikiJob=useRef(null);
  useEffect(()=>{if(wikiInitialization?.state==='attention'&&wikiInitialization.id&&shownWikiJob.current!==wikiInitialization.id&&(!panel||panel==='wiki-progress')){shownWikiJob.current=wikiInitialization.id;setPanel('wiki-progress');}},[wikiInitialization?.id,wikiInitialization?.state,panel]);
  function openModels(){modelTrigger.current=document.activeElement;setPanel('models');}
  function openMailConnection(){panelOrigin.current=null;setPanel('mail');}
  useEffect(()=>{if(!startupRequest)return;if(['wiki','wiki-update'].includes(startupRequest.target)){if(project?.projectId!==startupRequest.projectId||tabsProject!==project.projectId)return;setMailPage(false);setSkillsPage(false);setWikiPage(true);setPanel(startupRequest.target==='wiki-update'?'library':null);if(activeView)void workspaceView?.(null);onStartupHandled?.();return;}if(startupRequest.target==='answer'){if(project?.projectId!==startupRequest.projectId||tabsProject!==project.projectId)return;setProject(current=>({...current,tasks:[startupRequest.task,...(current.tasks||[]).filter(item=>item.id!==startupRequest.task.id)]}));setPanel(null);setWikiPage(false);selectSession(startupRequest.task.id);onStartupHandled?.();requestAnimationFrame(()=>conversationScroll.followLatest());return;}if(startupRequest.target==='decision'){if(project?.projectId!==startupRequest.decision.projectId||tabsProject!==project.projectId)return;selectSession(startupRequest.decision.taskId);setOpeningDecision(startupRequest.decision);onStartupHandled?.();return;}if(startupRequest.target==='mail-login'){setMailLogin({checkSession:true});setPanel(null);setMailPage(false);setSkillsPage(false);setWikiPage(false);}else if(startupRequest.target==='mail-source'){setPanel(null);setSkillsPage(false);setWikiPage(false);setMailPage(true);setMailSourceTarget({...startupRequest.source,key:startupRequest.id});if(activeView)void workspaceView?.(null);}else if(startupRequest.target==='mail')openMailConnection();else openModels();onStartupHandled?.();},[startupRequest,project?.projectId,tabsProject]);
  function closeModels(){setPanel(null);requestAnimationFrame(()=>{(modelTrigger.current?.isConnected?modelTrigger.current:composer.current)?.focus();});}
  function closePanel(trigger){setPanel(null);requestAnimationFrame(()=>trigger.current?.focus());}
  function openChildPanel(next){panelOrigin.current={panel,trigger:document.activeElement};setPanel(next);}
  function returnToPanel(){const origin=panelOrigin.current;panelOrigin.current=null;setPanel(origin?.panel||null);requestAnimationFrame(()=>{const name=origin?.trigger?.getAttribute('data-panel-link');if(name)document.querySelector(`[data-panel-link="${name}"]`)?.focus();});}
  const panelBack=panelOrigin.current?<div className="nubi-panel-navigation"><ActionButton action="back" className="nubi-panel-back" label={`${panelOrigin.current?.panel==='settings'?'설정으로':'위키 설정으로'} 돌아가기`} disabled={panel==='mail'&&mailConnecting} onClick={returnToPanel}/></div>:null;
  const libraryButton=useRef(null),appButton=useRef(null),settingsButton=useRef(null),agentButton=useRef(null),composer=useRef(null),mounted=useRef(true),polling=useRef(false),actionLock=useRef(false),autoTried=useRef(new Set()),autoSteps=useRef(new Map()),taskErrorToast=useRef('');
  const task=projectPicker?null:project?.tasks?.find(t=>t.id===taskId), proposals=project?.proposals?.filter(p=>p.taskId===taskId&&p.state!=='superseded')||[];
  const textEditor=useEditorConnection({api,connectEditor,createEditorDraft,projectId:project?.projectId,task,onChanged:refresh});
  useEffect(()=>{const receive=event=>{const value=event.detail;if(value?.projectId!==project?.projectId||typeof value.text!=='string'||!value.text.trim())return;const excerpt=value.text.slice(0,12000).split('\n').map(line=>'> '+line).join('\n');setRequest(previous=>(previous?previous+'\n\n':'')+`선택한 PDF 내용에 대해 설명해 주세요.\n출처: ${String(value.path).slice(0,500)} ${Number(value.page)}쪽\n${excerpt}`);composer.current?.focus();};window.addEventListener('nubi-document-selection',receive);return()=>window.removeEventListener('nubi-document-selection',receive);},[project?.projectId]);
  const office=useOfficeConnection({api,projectId:project?.projectId,task,onChanged:refresh});
  const [showProgress,setShowProgress]=useProgressDisplay();
  const revealAnswers=useAnswerReveal(task,project?.projectId);
  const proposalReady=task&&['review','paused','interrupted'].includes(task.state)&&!task.question&&!project?.tasks?.some(item=>['running','stopping'].includes(item.state))&&!project?.wikiChatBlocked;
  const pendingProposals=proposalReady?proposals.filter(item=>item.state==='proposed'):[],uncertainProposals=proposals.filter(item=>['attention','conflicted'].includes(item.state)),appliedProposals=proposals.filter(item=>item.state==='applied');
  const effectiveShell=project?.profiles?.some(p=>p.id===shell)?shell:project?.defaultShell||project?.profiles?.[0]?.id||'';
  const connectionRequest=DESKTOP_FEATURES.computerUse&&['pending','connected'].includes(task?.computerConnectionRequest?.state)?task.computerConnectionRequest:null;
  const running=task?.state==='running',activeTask=project?.tasks?.find(t=>t.state==='running');
  const initializationRunning=wikiInitialization?.state==='running'&&(!wikiInitialization.projectId||wikiInitialization.projectId===project?.projectId);
  const wikiChatBlocked=!!project&&(!!wikiPending||initializationRunning||project.wikiChatBlocked===true);
  const wikiChatJob=initializationRunning?wikiInitialization:project?.wikiChatJob||wikiPending;
  function openWikiSettings(){
    if(!wikiChatBlocked){setPanel('library');return;}
    setPanel(null);setWikiPage(false);setMailPage(false);setSkillsPage(false);
    if(activeView)void workspaceView?.(null);
  }
  // Preparation belongs to the project surface; never cover its progress with another dialog.
  useEffect(()=>{if(wikiChatBlocked&&['library','wiki-progress'].includes(panel))openWikiSettings();},[wikiChatBlocked,panel]);
  const wikiChatNotice=errors.wiki_chat_blocked;
  const wikiProjectName=projects.find(entry=>entry.id===project?.projectId)?.name||project?.name||String(project?.root||'').split(/[\\/]/).filter(Boolean).at(-1);
  // Keep inbox admissions and all following replies at the transcript foot.
  // A consumed steering row stays where its pending message was shown.
  const inboxTurnStart=task?.messages?.findIndex(message=>message.inputId)??-1;
  const historyMessages=inboxTurnStart<0?task?.messages||[]:task.messages.slice(0,inboxTurnStart);
  const inboxMessages=inboxTurnStart<0?[]:task.messages.slice(inboxTurnStart);
  const activityLayout=useMemo(()=>conversationActivity(task),[task]),activityRunId=activityLayout.runId,activityAnswer=activityLayout.anchor;
  // The analysis history (document and role analyses with ranges, partial outcomes and unread ranges) follows the current
  // run's activity; the per-run refactor of 2026-10-04 had dropped it although the runtime still records it.
  // Executed commands retain oldest-first run order. Pending approvals stay at the transcript foot;
  // command output is linked to its execution in the internal terminal, never replayed.
  const taskActions=(project?.setupActions||[]).filter(a=>a.taskId===taskId).reverse();
  const setupHandlers={onAlways:action=>perform(async()=>{setApproval(await api('allowCommand',{kind:'setup',id:action.id}));const value=await api('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision:'approve'});await refresh();if(value.resultProcessId){const result=await api('poll',{id:value.resultProcessId});setProcessResult(result);openTerminal?.({processId:result.id,cwd:result.cwd});setPanel(null);}}),onDecision:(action,decision)=>perform(async()=>{const value=await api('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision,elevationConsent:action.privilege==='administrator'});await refresh();if(value.resultProcessId){const result=await api('poll',{id:value.resultProcessId});setProcessResult(result);openTerminal?.({processId:result.id,cwd:result.cwd});setPanel(null);}}),onStop:process=>perform(async()=>setProcessResult(await api('stop',{id:process.id})))};
  const commandCards=items=>{const actions=showProgress?items:items.filter(action=>{const process=action.resultProcessId?[processResult,...(project?.processes||[])].find(row=>row?.id===action.resultProcessId):null;return action.state!=='rejected'&&!(action.state==='started'&&process?.state==='completed'&&(!process.recoveryState||process.recoveryState==='review'));});return actions.length?<SetupActions actions={actions} proposals={proposals} processes={project?.processes||[]} latest={processResult} onOpenTerminal={openTerminal} profiles={project?.profiles||[]} disabled={busy||running||!!task.question||task.state==='cancelled'} {...setupHandlers}/>:null;};
  const runCommands=runIds=>commandCards(taskActions.filter(a=>a.runId&&runIds.includes(a.runId)&&a.state!=='proposed'));
  const reviewMessage=!running?task?.messages?.findLast(message=>message.role==='assistant'&&!message.questionId&&!message.error&&message.runId===activityRunId):null;
  const activity=task?<>{showProgress&&<WorkspaceActivity key={activityRunId||task.id} task={task} predecessors={activityLayout.predecessors} sources={task.sources||[]} onSource={path=>perform(()=>openPath(path,taskId))}/>}{runCommands([activityRunId,...activityLayout.predecessors.map(run=>run.runId)])}{showProgress&&<AnalysisHistory key={`analysis:${task.id}`} api={api} task={task} showHistory={showAnalysisHistory} reviewSlot={reviewSlot}/>}</>:null;
  const historicalActivity=run=><React.Fragment key={run.runId}>{showProgress&&<WorkspaceActivity task={task} run={run} historical/>}{runCommands([run.runId,...(run.predecessors||[]).map(p=>p.runId)])}</React.Fragment>;
  const placedRunIds=new Set([activityRunId,...activityLayout.predecessors.map(run=>run.runId),...[...activityLayout.before.values(),...activityLayout.after.values(),activityLayout.root].flat().flatMap(run=>[run.runId,...(run.predecessors||[]).map(p=>p.runId)])]);
  const beforeActivityAnswer=(message,index)=>{
    const chapters=(task?.chapters||[]).filter(chapter=>chapter.messageIndex===index),runs=activityLayout.before.get(message),current=message===activityAnswer?activity:null;
    if(!chapters.length&&!runs?.length&&!current)return null;
    return <>{chapters.map(chapter=><ChapterDivider key={chapter.id} chapter={chapter}/>)}{runs?.map(historicalActivity)}{current}</>;
  };
  const outputAnswers=useMemo(()=>{const anchors=new Map();for(const message of task?.messages||[])if(message.role==='assistant'&&!message.questionId&&!message.error&&message.runId)anchors.set(message.runId,message);return anchors;},[task?.messages]);
  const afterActivityMessage=message=>{
    const final=outputAnswers.get(message.runId)===message,cards=final?(task?.outputs||[]).filter(card=>card.runId===message.runId):[],chips=final&&conversationTools?(task?.sideTasks||[]).filter(chip=>chip.runId===message.runId):[],runs=activityLayout.after.get(message),current=message===activityLayout.afterMessage?activity:null;
    if(!cards.length&&!chips.length&&!runs?.length&&!current)return null;
    return <>{!!cards.length&&<OutputFileCards cards={cards} onOpen={card=>perform(()=>openOutput?openOutput(card,taskId):card.path?openPath(card.path,taskId):Promise.reject(Error('output_preview_unavailable')))}/>}{!!chips.length&&<SideTaskChips chips={chips} disabled={busy} onStart={chip=>sideTaskAction('startSideTask',chip)} onDismiss={chip=>sideTaskAction('dismissSideTask',chip)}/>}{runs?.map(historicalActivity)}{current}</>;
  };
  // A change plan the current run recorded stays open while that run works and folds once its answer is delivered,
  // like the run's plan and record (user request 2026-10-14). The key remounts it at that boundary only.
  const changePlanLive=!!task&&!!activityRunId&&!['review','completed'].includes(task.state)&&(task.trace||[]).some(event=>event.tool==='record_change_plan'&&(event.runId===activityRunId||event.id?.startsWith(activityRunId+':')));
  const decisions=[...humanDecisions(project,{computerUse:DESKTOP_FEATURES.computerUse}),...(project?.backgroundDecisions||[])].map(decision=>({...decision,projectName:projects.find(entry=>entry.id===decision.projectId)?.name||(decision.projectId===project?.projectId?project?.name:null)||'프로젝트'}));
  const [openingDecision,setOpeningDecision]=useState(null),decisionProject=useRef(project?.projectId);decisionProject.current=project?.projectId;
  // Answering from the toast uses the same request as the conversation's question form.
  async function answerDecisionFromToast(decision,choice){await perform(async()=>{await api('answerAgent',{taskId:decision.taskId,choice});await refresh();});}
  async function openHumanDecision(decision){
   if(decision.projectId&&decision.projectId!==project?.projectId&&focusDecision)return focusDecision(decision);
   await perform(async()=>{
    const state=await api('state',{taskId:decision.taskId}),current={...project,...state};
    if(!mounted.current||decisionProject.current!==project?.projectId)return;
    if(!humanDecisions(current,{computerUse:DESKTOP_FEATURES.computerUse}).some(row=>row.id===decision.id))return;
    setProject(current);setMailPage(false);setWikiPage(false);setSkillsPage(false);selectSession(decision.taskId);setPanel(null);setOpeningDecision(decision);
   });
  }
  useEffect(()=>{
   if(!openingDecision||openingDecision.taskId!==taskId||busy)return;
   if(openingDecision.kind==='computer'){setPanel('computer');setOpeningDecision(null);return;}
   const node=[...document.querySelectorAll('[data-decision-id]')].find(node=>node.dataset.decisionId===openingDecision.localId);
   if(node){document.dispatchEvent(new CustomEvent('nubi-open-decision',{detail:openingDecision.localId}));setOpeningDecision(null);}
  },[openingDecision,taskId,busy,project]);
  const questionControl=task?.question&&task.state==='waiting_input'?<QuestionDecision key={task.question.id||task.id} question={typeof task.question==='string'?{id:task.id,text:task.question,options:[],kind:'text'}:task.question} disabled={busy||running||wikiChatBlocked} blocked={!!panel} onNativeEdit={args=>api('reviseNativeOfficeDraft',{taskId,...args})} onDraft={draft=>api('saveQuestionDraft',{taskId,questionId:task.question.id,draft})} onChoose={async choice=>{await api('answerAgent',{taskId,choice,...(typeof task.question==='string'?{answer:choice.text}:{})});await refresh();return true;}}/>:null;
  const detachedQuestions=(task?.questionHistory||[]).filter(question=>!task.messages.some(message=>message.role==='assistant'&&message.questionId===question.id)||!task.messages.some(message=>message.role==='user'&&message.content===question.answer?.text));
  const conversationKey=task&&!mailPage&&!skillsPage?`${project?.projectId}:${task.id}`:null;
  const conversationScroll=useConversationScroll(conversationKey);
  const [chapterJump,setChapterJump]=useState(null);

  const latestProcess=project?.processes?.find(p=>p.taskId===taskId),latestComparison=project?.comparisons?.find(c=>c.taskId===taskId);
  // Selecting a conversation always leaves the mail and skills pages: the search dialog used to leave the mail page
  // open while the sidebar closed it (defect found by the modal check, 2026-10-06).
  async function updateConversationNavigation(method,args){
    const projectId=project?.projectId;
    try{const navigation=await api(method,{...args,projectId});if(navigation?.tasks)setProject(current=>current?.projectId===projectId?{...current,conversationNavigation:navigation}:current);return navigation;}
    catch(error){showError(failure(error));return null;}
  }
  useEffect(()=>{
    if(!conversationTools||!project?.projectId||!project.conversationNavigation)return;
    const key=`nubi-pinned-tasks:${project.projectId}`;let ids=[],saved=null;
    try{saved=localStorage.getItem(key);const parsed=JSON.parse(saved);if(Array.isArray(parsed))ids=parsed.filter(id=>typeof id==='string');}catch{}
    if(project.conversationNavigation.pinnedIds!==null&&saved===null)return;
    void updateConversationNavigation('setPinnedTasks',{ids,initialize:true}).then(result=>{
      if(!Array.isArray(result?.pinnedIds))return;
      try{localStorage.removeItem(key);}catch{}
      if(result.unpinnedCount)showNotice(`최근 고정한 50개를 유지했어요. 나머지 ${result.unpinnedCount}개는 고정을 풀었고 대화 내용은 보존했어요.`);
    });
  },[project?.projectId,conversationTools]);
  useEffect(()=>{
    if(!conversationTools||!project?.projectId)return;
    const projectId=project.projectId;let live=true;
    const update=()=>{
      const viewing=!document.hidden&&document.hasFocus()&&!mailPage&&!wikiPage&&!skillsPage&&!panel?taskId:null;
      void api('markTaskRead',{projectId,taskId:viewing}).then(value=>{
        if(!live||!value?.id)return;
        setProject(current=>current?.projectId!==projectId?current:{...current,tasks:current.tasks.map(row=>row.id===value.id?{...row,unread:false}:row),...(current.conversationNavigation?{conversationNavigation:{...current.conversationNavigation,tasks:current.conversationNavigation.tasks.map(row=>row.id===value.id?{...row,unread:false}:row)}}:{})});
      }).catch(()=>{});
    };
    update();document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);window.addEventListener('blur',update);
    return()=>{live=false;document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);window.removeEventListener('blur',update);void api('markTaskRead',{projectId,taskId:null}).catch(()=>{});};
  },[project?.projectId,taskId,mailPage,wikiPage,skillsPage,panel,conversationTools]);
  async function selectSidebarSession(id){
    if(!project.tasks.some(task=>task.id===id)){
      const projectId=project.projectId;const selected=await api('conversationHistory',{taskId:id});
      setProject(current=>current?.projectId===projectId?{...current,tasks:[selected,...current.tasks]}:current);
    }
    if(wikiPage)setWikiPage(false);selectSession(id);if(compact)setSidebarOpen(false);
  }
  function sideTaskAction(method,chip){return perform(async()=>{
    const owner=project.projectId,sourceTaskId=taskId,scope=JSON.stringify([owner,sourceTaskId]);
    const result=await api(method,{projectId:owner,taskId:sourceTaskId,sideTaskId:chip.id});
    if(!mounted.current||draftScope.current!==scope)return;
    const selectedId=method==='startSideTask'?result.taskId:sourceTaskId;
    const next=await api('state',{projectId:owner,taskId:selectedId});
    if(!mounted.current||draftScope.current!==scope)return;
    setProject(current=>current?.projectId===owner?{...current,...next}:current);
    if(method==='startSideTask')selectSession(selectedId);
  });}
  function selectSession(id){if(id===null)setGreeting(previous=>welcomeGreeting({previous}));setProjectPicker(false);setPersonalStart(true);if(id!==taskId||skillsPage||mailPage){setSkillsPage(false);setMailPage(false);}setOpenTabs(tabs=>openSession(tabs,id));setTaskId(id);setError('');}
  // The trash icon deletes a conversation and its records; applied files stay (user decision 2026-09-30). The current
  // conversation's place goes back to a new conversation, not to another one.
  function deleteSession(id){return perform(async()=>{await api('deleteTask',{taskId:id});setOpenTabs(tabs=>closeSession(tabs,null,id).tabs);if(taskId===id)setTaskId(null);await refresh();showNotice('대화를 삭제했어요.');return true;});}
  async function copyProjectPath(args){
    return api('copyProjectPath',args);
  }
  async function refresh(){const result=await api('overview',{taskId});if(mounted.current)setProject(result);return result;}
  // The native shell's overview is separate from Workbench state. Refresh the
  // page inventory on completion and when reopening project materials.
  useEffect(()=>{
    if(!project?.projectId||!(panel==='library'||['completed','existing'].includes(wikiInitialization?.state)))return;
    let current=true;const projectId=project.projectId;
    api('overview',{taskId}).then(value=>{if(current&&value.projectId===projectId)setProject(previous=>previous?.projectId===projectId?{...previous,wikiFiles:value.wikiFiles}:previous);}).catch(error=>{if(current)showError(failure(error));});
    return()=>{current=false;};
  },[api,project?.projectId,panel,wikiInitialization?.id,wikiInitialization?.state,wikiInitialization?.finishedAt]);

  // Scheduled work can begin while this screen is idle. Refresh navigation and
  // decision notifications without selecting a different conversation.
  useEffect(()=>{
    let alive=true,pending=false,again=false;const projectId=project?.projectId;
    const sync=async()=>{if(pending){again=true;return;}pending=true;
      do{again=false;try{const state=await api('overview',{taskId});if(alive&&mounted.current)setProject(p=>p?.projectId===projectId&&state.projectId===projectId?mergeSnapshot(p,state):p);}catch{}}while(alive&&again);
      pending=false;
    };
    const off=window.nubi?.onHostEvent?.(event=>{if(event.type==='routine_activity')void sync();});
    window.addEventListener('focus',sync);
    return()=>{alive=false;off?.();window.removeEventListener('focus',sync);};
  },[api,project?.projectId,taskId]);

  // Before a folder opens there is no project state to merge: a model change there is not an error.
  async function refreshProvider(args){const value=await api('provider',args);if(mounted.current)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);if(value.connected){const state=await api('state',{taskId}).catch(e=>{if(e.message==='project_missing')return null;throw e;});if(state&&mounted.current)setProject(p=>({...p,...state}));}return value;}
  function showProjectStart(){setMailPage(false);setSkillsPage(false);setPanel(null);setProjectPicker(true);if(compact)setSidebarOpen(false);if(activeView)void workspaceView?.(activeView);}
  function openFolder(){return perform(chooseFolder);}
  async function perform(operation,{propagate=false}={}){if(actionLock.current)return;actionLock.current=true;setBusy(true);setError('');try{return await operation();}catch(e){if(propagate)throw e;if(mounted.current)setError(failure(e));if(['source_stale','setup_changed','setup_execution_unconfirmed','quality_unavailable','proposal_invalid_syntax'].includes(e.message))await refresh().catch(()=>{});}finally{actionLock.current=false;if(mounted.current)setBusy(false);}}
  useEffect(()=>{
    if(!environmentPending||!project?.projectId||!provider?.connected||activeTask)return;
    setEnvironmentPending(false);
    perform(async()=>{const created=await api('createTask',{request:ENVIRONMENT_REQUEST});setProject(p=>({...p,tasks:[created,...(p?.tasks||[]).filter(item=>item.id!==created.id)]}));selectSession(created.id);await api('startAgent',{taskId:created.id});await refresh();});
  },[environmentPending,project?.projectId,provider?.connected,activeTask]);
  useEffect(()=>{mounted.current=true;if(!initialProject)openCurrent().then(value=>{if(!mounted.current)return;setProject(value);if(openedByButton()&&value&&!value.tasks?.length)setEnvironmentPending(true);}).catch(e=>{if(!mounted.current)return;showError(failure(e,'프로젝트를 열지 못했어요. 다시 열어 주세요.'));});api('provider').then(value=>{if(mounted.current)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}).catch(()=>{});return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!project?.projectId||tabsProject===project.projectId)return;const restored=restoreSessionNavigation(project.projectId,project.tasks||[]);setOpenTabs(restored.tabs);setTaskId(restored.selected);setTabsProject(project.projectId);},[project?.projectId]);
  useEffect(()=>{let wasWide=null;const observer=new ResizeObserver(([entry])=>{const width=entry.contentRect.width;if(!width)return;setHostWidth(width);const wide=width>=sidebarBreakpoint;if(wasWide===true&&!wide)setSidebarOpen(false);wasWide=wide;});if(workbenchNode.current)observer.observe(workbenchNode.current);return()=>observer.disconnect();},[sidebarBreakpoint]);
  useEffect(()=>{if(tabsProject===project?.projectId)saveSessionNavigation(tabsProject,openTabs,taskId);},[tabsProject,project?.projectId,openTabs,taskId]);
  // The native window and its optional live web surface share one worker.
  // Reflect login/model changes from either surface without replaying actions.
  useEffect(()=>{let pending=false;const sync=async()=>{if(document.hidden||pending)return;pending=true;try{const value=await api('provider',{action:'status'});if(mounted.current)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}catch{}finally{pending=false;}};const timer=setInterval(sync,2000);window.addEventListener('focus',sync);return()=>{clearInterval(timer);window.removeEventListener('focus',sync);};},[api]);
  useEffect(()=>{
    if(!wikiChatBlocked&&!activeTask&&!project?.backgroundProjects?.length&&!(sendingOutgoing&&taskId)&&!provider?.pending&&!['checking','running','stopping'].includes(processResult?.state)&&!['queued','diagnosing'].includes(processResult?.recoveryState))return;
    let alive=true;const projectId=project?.projectId;
    const check=async()=>{if((document.hidden&&!window.nubi?.desktop)||polling.current)return;polling.current=true;try{
      let needsState=wikiChatBlocked||!!activeTask||!!project?.backgroundProjects?.length||!!(sendingOutgoing&&taskId),providerValue,processValue;
      if(provider?.pending){providerValue=await api('provider');if(!alive)return;needsState ||= providerValue.connected;}
      if(processResult&&(['checking','running','stopping'].includes(processResult.state)||['queued','diagnosing'].includes(processResult.recoveryState))){processValue=await api('poll',{id:processResult.id});if(!alive)return;needsState=true;}
      // One snapshot per cycle, after any command update. Discard late replies on navigation.
      const state=needsState?await api('state',{taskId}):null;
      if(!alive||!mounted.current)return;
      if(providerValue)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(providerValue)?previous:providerValue);
      if(processValue)setProcessResult(processValue);
      if(state)setProject(p=>p?.projectId===projectId?mergeSnapshot(p,state):p);
    }catch{}finally{polling.current=false;}};
    const timer=setInterval(check,1000);const visible=()=>{if(!document.hidden)void check();};document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[wikiChatBlocked,activeTask?.id,provider?.pending,processResult?.id,processResult?.state,processResult?.recoveryState,taskId,project?.projectId,project?.backgroundProjects?.length,sendingOutgoing?.id]);
  // A paired Nubi sends requests and results at any time (user decision 2026-10-01): while one is paired, or a
  // pairing address waits to be used, the header count and the exchanged tasks stay current.
  const [inviteUntil,setInviteUntil]=useState(0),linked=!!project?.peerLinks?.length||inviteUntil>0;
  useEffect(()=>{if(!inviteUntil)return;const timer=setTimeout(()=>setInviteUntil(0),Math.max(0,inviteUntil-Date.now()));return()=>clearTimeout(timer);},[inviteUntil]);
  useEffect(()=>{
    if(!linked||!project?.projectId)return;
    const check=async()=>{if(document.hidden||polling.current)return;polling.current=true;try{const state=await api('state',{taskId});if(mounted.current)setProject(p=>p?.projectId===project.projectId?mergeSnapshot(p,state):p);}catch{}finally{polling.current=false;}};
    const timer=setInterval(check,3000);return()=>clearInterval(timer);
  },[linked,project?.projectId,taskId]);
  useEffect(()=>{setShell(project?.defaultShell||'');},[project?.projectId,project?.defaultShell]);
  useEffect(()=>{if(!project?.projectId)return;let current=true;api('approvalPolicy').then(value=>{if(current)setApproval(value);}).catch(()=>{});return()=>{current=false;};},[project?.projectId]);
  // Automatic approval (user decision 2026-09-30): what the mode or an always-allowed command lets through is done the
  // way the user's own click does it, one step at a time: the proposals of files through the editor, then one command.
  // A task that keeps asking stops after AUTO_STEPS automatic steps for one message of the user.
  useEffect(()=>{
    if(!taskId||!task||running||task.question||task.state!=='review'||busy||connectionRequest)return;
    if(approval.mode==='ask'&&!approval.allowedCommands.length)return;
    // The count belongs to the task and its latest user message: switching to another task does not reset it.
    const turn=(task.messages||[]).filter(message=>message.role==='user').length;
    if(autoSteps.current.get(taskId)?.turn!==turn)autoSteps.current.set(taskId,{turn,count:0});
    const steps=autoSteps.current.get(taskId);
    if(steps.count>=AUTO_STEPS)return;
    let live=true;
    (async()=>{
      const next=await api('autoApprovals',{taskId}).catch(()=>null);
      if(!live||!next)return;
      const files=next.proposals.filter(id=>!autoTried.current.has(id)),command=next.command&&!autoTried.current.has(next.command.id)?next.command:null;
      if(!files.length&&!command)return;
      if(++steps.count===AUTO_STEPS)notifyWorkspaceToast('자동 진행을 여기서 멈췄어요. 남은 승인은 직접 확인해 주세요.');
      await perform(async()=>{
        if(files.length){
          for(const id of files){autoTried.current.add(id);await apply(id);}
          const latest=await refresh();showNotice(`파일 ${files.length}개를 자동으로 반영했어요.`);
          if(provider?.connected&&!waitingOn(latest,taskId)){await api('startAgent',{taskId});await refresh();}
          return;
        }
        autoTried.current.add(command.id);
        const value=command.kind==='setup'?await api('decideSetupAction',{id:command.id,fingerprint:command.fingerprint,decision:'approve'}):await api('applyCommandRepair',{id:command.id});
        await refresh();showNotice(command.reason==='allowed'?'항상 허용한 명령을 실행했어요.':'프로젝트 검사 명령을 자동으로 실행했어요.');
        if(value?.resultProcessId){const result=await api('poll',{id:value.resultProcessId});setProcessResult(result);openTerminal?.({processId:result.id,cwd:result.cwd});setPanel(null);}
      });
    })();
    return()=>{live=false;};
  },[project,taskId,running,task?.state,task?.question,busy,approval]);
  const observedProcesses=useRef(null);
  useEffect(()=>{
    const rows=project?.processes||[],previous=observedProcesses.current;
    observedProcesses.current={projectId:project?.projectId,ids:new Set(rows.map(row=>row.id))};
    if(!previous||previous.projectId!==project?.projectId)return;
    const fresh=rows.find(row=>row.taskId===taskId&&!previous.ids.has(row.id));
    if(fresh)openTerminal?.({processId:fresh.id,cwd:fresh.cwd});
  },[project?.processes,project?.projectId,taskId,openTerminal]);
  useEffect(()=>{let current=true;setProcessResult(project?.processes?.find(p=>p.taskId===taskId)||null);setComparison(null);const previous=project?.comparisons?.find(c=>c.taskId===taskId);if(previous)api('comparison',{id:previous.id}).then(value=>{if(current&&mounted.current)setComparison(value);}).catch(()=>{});return()=>{current=false;};},[taskId,latestProcess?.id,latestComparison?.id]);
  useEffect(()=>{let current=true;setKnowledge(null);if(taskId&&panel==='library')api('knowledgeStatus',{taskId}).then(value=>{if(current)setKnowledge(value);}).catch(e=>{if(current)setError(errors[e.message]||'위키 기록을 확인하지 못했어요.');});return()=>{current=false;};},[taskId,panel]);
  useEffect(()=>{if(!error)return;showError(error);setError('');},[error]);
  useEffect(()=>{
    if(!task?.error){taskErrorToast.current='';return;}
    const key=`${task.id}:${task.error}`;
    if(taskErrorToast.current===key)return;
    taskErrorToast.current=key;
    showError(errors[task.error]||'분석이 멈췄어요. 연결을 확인한 뒤 다시 시도해 주세요.');
  },[task?.id,task?.error]);
  const [launchingTask,setLaunchingTask]=useState(null);
  async function launchTask(id,operation){setLaunchingTask({id,startedAt:new Date().toISOString(),elapsedMs:0});try{return await operation();}finally{if(mounted.current)setLaunchingTask(null);}}
  async function submit(event){event.preventDefault();if(wikiChatBlocked)return;
    const shortcut=/^\/(capture|capture_web|skills|model|usage|wiki_update|terminal)\s*$/.exec(request.trim());
    if(shortcut){setRequest('');runComposerCommand(AGENT_COMMANDS.find(item=>item.command===shortcut[1]).action);return;}
    if(running){await sendRunningInput();return;}
    if(!request.trim()||documentReading||busy||submitLock.current||task?.question||connectionRequest)return;
    const text=request,documents=[...draftDocuments],references=[...mailReferences],captures=[...draftCaptures],attached=captureAttachments(captures),scope=draftScope.current,projectId=project?.projectId,id=crypto.randomUUID();
    const item={id,projectId,taskId:taskId??null,text,documents,references,captures,phase:'sending',at:new Date().toISOString(),inputId:id,messageCount:task?.messages?.length||0};
    submitLock.current=true;setSubmitting(true);setOutgoing(items=>[...items,item]);setRequest('');setMailReferences([]);setDraftCaptures([]);setDraftDocuments([]);
    conversationScroll.followLatest();requestAnimationFrame(()=>composer.current?.focus());
    const currentProject=()=>mounted.current&&projectRefForSubmit.current===projectId;
    let accepted=false,createdTaskId=null;
    const refreshTask=async selectedId=>{const selectedScope=JSON.stringify([projectId,selectedId]);const value=await api('state',{taskId:selectedId});if(currentProject()&&draftScope.current===selectedScope)setProject(current=>({...current,...value}));};
    try{
      if(task){
        const key=JSON.stringify([projectId,taskId,text,references,documents,attached]);
        if(inputAttempt.current?.key!==key)inputAttempt.current={key,id};
        const inputId=inputAttempt.current.id;setOutgoing(items=>items.map(item=>item.id===id?{...item,inputId}:item));
        await submitTaskMessage(api,{taskId,text,mailReferences:references,captures:attached,documentReferences:documents,inputId:inputAttempt.current.id,onState:value=>{if(currentProject()&&draftScope.current===scope)setProject(current=>({...current,...value}));}});
        accepted=true;inputAttempt.current=null;await refreshTask(taskId);
      }else{
        const created=await api('createTask',{request:text,mailReferences:references,captures:attached,documentReferences:documents});createdTaskId=created.id;
        if(!currentProject())throw Error('project_changed');
        await office.attach(created.id);
        await textEditor.attach(created.id);
        if(currentProject()){
          setProject(p=>({...p,tasks:[created,...p.tasks.filter(item=>item.id!==created.id)]}));
          setOutgoing(items=>items.map(item=>item.id===id?{...item,taskId:created.id,createdTask:true}:item));
          if(draftScope.current===scope){moveDraft(created.id);moveMailDraft(created.id);moveDocumentDraft(created.id);selectSession(created.id);requestAnimationFrame(()=>composer.current?.focus());}
        }
        if(!currentProject())throw Error('project_changed');
        if(provider?.connected){await api('startAgent',{taskId:created.id});accepted=true;await refreshTask(created.id);}
      }
      if(mounted.current)setOutgoing(items=>items.filter(item=>item.id!==id));
    }catch(cause){
      if(mounted.current){if(!accepted)setError(failure(cause));if(cause.message==='wiki_chat_blocked'){if(!createdTaskId&&draftScope.current===scope&&!readDraft()){setRequest(text);setMailReferences(references);setDraftDocuments(documents);}setOutgoing(items=>items.filter(item=>item.id!==id));inputAttempt.current=null;}else setOutgoing(items=>items.map(item=>item.id===id?{...item,phase:accepted?'accepted':'unconfirmed'}:item));
        // The bubble preserves uncertain requests. Never put them back in Send automatically.
      }
    }finally{submitLock.current=false;if(mounted.current)setSubmitting(false);}
  }

  async function inputAction(action,args={}){
    if(inputLock.current||wikiChatBlocked&&['enqueue','steer','start'].includes(action))return;inputLock.current=true;setInputBusy(true);setError('');
    try{const result=await api('agentInput',{taskId,action,runId:task.checkpoint?.runId,...args});await refresh();if(['enqueue','steer','start'].includes(action))conversationScroll.followLatest();return result;}
    catch(e){setError(failure(e));}
    finally{inputLock.current=false;if(mounted.current)setInputBusy(false);}
  }
  async function sendRunningInput(){
    const text=request.trim();if(wikiChatBlocked||documentReading||!text||busy||inputLock.current||submitLock.current)return;
    const documents=[...draftDocuments],references=[...mailReferences],captures=[...draftCaptures],attached=captureAttachments(captures),projectId=project?.projectId,scope=draftScope.current,key=JSON.stringify([projectId,taskId,task.checkpoint?.runId,text,references,documents,captures.map(item=>item.id)]);
    if(inputAttempt.current?.key!==key)inputAttempt.current={key,id:crypto.randomUUID()};
    const id=inputAttempt.current.id;
    inputLock.current=true;setInputBusy(true);setError('');
    setOutgoing(items=>[...items.filter(item=>item.id!==id),{id,inputId:id,projectId,taskId,text,documents,references,captures,queued:true,phase:'sending',at:new Date().toISOString(),messageCount:task.messages?.length||0}]);
    setRequest('');setMailReferences([]);setDraftCaptures([]);setDraftDocuments([]);conversationScroll.followLatest();requestAnimationFrame(()=>composer.current?.focus());
    let accepted=false;
    try{
      const updated=await submitTaskMessage(api,{taskId,text,mailReferences:references,captures:attached,documentReferences:documents,inputId:id,onState:value=>{if(mounted.current&&draftScope.current===scope)setProject(current=>({...current,...value}));}});
      accepted=true;inputAttempt.current=null;
      if(mounted.current&&draftScope.current===scope){
        if(updated?.id===taskId)setProject(current=>({...current,tasks:current.tasks.map(item=>item.id===taskId?updated:item)}));
        else {const value=await api('state',{taskId});if(mounted.current&&draftScope.current===scope)setProject(current=>({...current,...value}));}
      }
      if(mounted.current)setOutgoing(items=>items.filter(item=>item.id!==id));
    }catch(cause){if(mounted.current){if(!accepted)setError(failure(cause));if(cause.message==='wiki_chat_blocked'){if(draftScope.current===scope&&!readDraft()){setRequest(text);setMailReferences(references);setDraftDocuments(documents);}setOutgoing(items=>items.filter(item=>item.id!==id));inputAttempt.current=null;}else setOutgoing(items=>items.map(item=>item.id===id?{...item,phase:accepted?'accepted':'unconfirmed'}:item));}}
    finally{inputLock.current=false;if(mounted.current)setInputBusy(false);}
  }
  async function editInput(id){
    if(request.trim()){setError('입력 중인 메시지를 먼저 보내거나 비워 주세요.');return;}
    const item=task.inbox.find(item=>item.id===id);if(!item)return;
    try{appendMailReferences(readMailReferences(),item.mailReferences||[]);}catch(error){setError(failure(error));return;}
    const result=await inputAction('remove',{id});if(result){const draft=readDraft();setRequest(draft?draft+'\n'+result.text:result.text);setMailReferences(current=>appendMailReferences(current,result.mailReferences||[]));setDraftDocuments(current=>appendMailReferences(current,result.documentReferences||[]));if(draft)showNotice('초안 아래에 편집할 메시지를 넣었어요.');requestAnimationFrame(()=>composer.current?.focus());}
  }
  async function refreshCatalog(options={}){
    const selected=options.provider||provider?.provider;
    if(catalogRequests.current.has(selected))return catalogRequests.current.get(selected);
    const revision=providerRevision.current;
    setCatalogLoading(selected);
    const request=(async()=>{try{
      const value=await api('provider',{action:'refresh',input:{provider:selected}});
      if(mounted.current&&revision===providerRevision.current)setProvider(value);
      return true;
    }catch(cause){if(mounted.current)showError('모델 목록을 갱신하지 못했어요. 새로고침으로 다시 시도해 주세요.');return false;}
    finally{catalogRequests.current.delete(selected);if(mounted.current)setCatalogLoading(value=>value===selected?null:value);}})();
    catalogRequests.current.set(selected,request);return request;
  }
  async function modelAction(action,input={}){if(action==='refresh')return refreshCatalog(input);providerRevision.current++;return perform(async()=>{await refreshProvider({action,input});return true;});}
  async function regenerateResponse(message){
    if(wikiChatBlocked)return;
    if(!provider?.connected){openModels();return;}
    await perform(async()=>{await launchTask(taskId,()=>api('regenerateAnswer',{taskId,messageId:message.id}));await refresh();conversationScroll.followLatest();});
  }
  async function login(selected){
    let storage;try{storage=window.localStorage;}catch{}
    if(needsExternalAiPolicy(selected,storage)){setExternalAiPolicy({provider:selected,trigger:document.activeElement});return;}
    return connectProvider(selected);
  }
  function closeExternalAiPolicy(){const trigger=externalAiPolicy?.trigger;setExternalAiPolicy(null);requestAnimationFrame(()=>{if(trigger?.isConnected)trigger.focus();});}
  async function confirmExternalAiPolicy(remember){
    const selected=externalAiPolicy?.provider;if(!selected)return;
    if(remember){let storage;try{storage=window.localStorage;}catch{}if(!dismissExternalAiPolicy(storage))showNotice('이 환경에서는 설정을 저장하지 못해 다음 연결 때 안내가 다시 표시됩니다.');}
    setExternalAiPolicy(null);await connectProvider(selected);
  }
  async function connectProvider(selected){if(selected==='claude'){
    if(actionLock.current)return;
    providerRevision.current++;
    await perform(async()=>{
      setClaudeChecking(true);
      try {await refreshProvider({action:'login',input:{provider:'claude'}});setClaudeIssue(null);}
      catch(cause){
        if(!['claude_cli_missing','claude_cli_update','claude_login_required'].includes(cause.message))throw cause;
        setClaudeIssue(cause.message);openChildPanel('claude');
      }finally{if(mounted.current)setClaudeChecking(false);}
    });return;
  }if(selected==='fabrix'){openChildPanel('fabrix');return;}await modelAction('login',{provider:selected});}
  function openSkillPanel(tab,trigger) {
    skillsPanelTrigger.current=trigger||document.activeElement;
    setSkillTab(tab);setPanel('skills');
  }
  function addSkillToDraft(skill,skills) {
    const draft=draftLatest.current;
    setRequest(replaceComposerCommand(draft,desktopSkillCommand(skill),skills));
    requestAnimationFrame(() => composer.current?.focus());
  }
  const [mailSourceTarget,setMailSourceTarget]=useState(null);
  const mailViewState=useMemo(()=>({current:{}}),[project?.projectId]);
  const handledMailDraft=useRef(null);
  useEffect(()=>{
    if(!mailDraftRequest||handledMailDraft.current===mailDraftRequest.requestId||!project?.projectId)return;
    handledMailDraft.current=mailDraftRequest.requestId;
    void askFromMail(mailDraftRequest.reference).catch(error=>{if(mounted.current)showError(failure(error));}).finally(()=>onMailDraftHandled?.());
  },[mailDraftRequest?.requestId,project?.projectId]);
  async function askFromMail(reference){
    if(busy||inputLock.current||task?.question||connectionRequest)throw Error('agent_busy');
    const scope=draftScope.current,references=Array.isArray(reference)?reference:[reference];
    appendMailReferences(readMailReferences(),references);
    const observed=await Promise.all(references.map(item=>api('mail',{...item,action:'evidence'})));
    if(!mounted.current||draftScope.current!==scope)throw Error('agent_busy');
    const next=appendMailReferences(readMailReferences(),observed);
    setMailReferences(next);
    if(openMailSources)openMailSources(observed);else closeMailDocument?.();
    setMailPage(false);setSkillsPage(false);setProjectPicker(false);setMailSourceTarget(null);
    requestAnimationFrame(()=>composer.current?.focus());
  }
  // A rewrite request goes to the agent as an ordinary draft; the page itself is never changed here.
  function forgetRunMemory(runId){return perform(async()=>{await api('memories',{action:'undo',runId,taskId});await refresh();});}
  function askWikiRewrite({path,title,kind}){
    if(busy||inputLock.current||task?.question||connectionRequest){showError('지금은 요청을 보낼 수 없어요. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');return;}
    const target=kind==='mail'?`메일 위키 문서 "${path}"`:`위키 문서 openwiki/${path}`;
    const text=`${target} (${title})을 다시 작성해 줘. ${kind==='mail'?'원본 메일을 기준으로 정리하고':'현재 프로젝트 소스와 커밋 이력을 기준으로 내용을 보완하고'} 기존 구조와 앞머리 정보, 다른 문서로 가는 링크는 유지해 줘. 바뀐 부분은 저장 전에 알려 줘.`;
    const draft=readDraft();setRequest(draft?.trim()?`${draft.trimEnd()}\n\n${text}`:text);
    closeMailDocument?.();setWikiPage(false);setMailPage(false);setSkillsPage(false);setProjectPicker(false);
    requestAnimationFrame(()=>composer.current?.focus());
  }
  function askMailSearch({query,filters}){
    if(busy||inputLock.current||task?.question||connectionRequest)throw Error('agent_busy');
    setRequest(mailSearchDraft(readDraft(),query,filters));
    closeMailDocument?.();setMailPage(false);setSkillsPage(false);setProjectPicker(false);setMailSourceTarget(null);
    requestAnimationFrame(()=>composer.current?.focus());
  }
  async function chooseDocuments(){
    if(documentReading)return;const scope=draftScope.current;setDocumentReading(true);
    try{const result=await api('chooseChatDocuments',{projectId:project?.projectId});if(!mounted.current||draftScope.current!==scope||result.cancelled)return;
      const combined=appendMailReferences(readDocumentDraft(),result.documents||[]);if(combined.length>10)throw Error('chat_document_limit');setDraftDocuments(combined);
      if(result.errors?.length)showError(result.errors.map(item=>`${item.filename}: ${item.error==='document_empty'?'읽을 텍스트가 없어요. 스캔 이미지 여부를 확인해 주세요.':item.error==='document_limit'?'문서 크기나 읽기 한도를 넘었어요.':'문서를 읽지 못했어요. 파일 형식과 열기 권한을 확인해 주세요.'}`).join('\n'));
    }catch(error){showError(error.message==='chat_document_limit'?'문서는 한 번에 10개까지 선택해 주세요.':'문서를 첨부하지 못했어요. 다시 선택해 주세요.');}finally{if(mounted.current)setDocumentReading(false);}
  }
  async function openDocument(source,offset=source.location?.offset||0){const scope=draftScope.current;try{const value=await api('chatDocument',{id:source.id,sourceHash:source.sourceHash,offset,limit:60000,segmentIndex:source.segmentIndex??source.location?.segmentIndex});if(mounted.current&&draftScope.current===scope)setSelectedDocument(value);}catch{showError('첨부한 문서 기록을 읽지 못했어요. 문서를 다시 선택해 주세요.');}}
  function openAnswerSource(source,message) {
    if(source.kind==='document'){void openDocument(source);return;}
    if(source.kind==='mail'){
      void perform(async()=>{const observed=await api('mail',{...source,action:'evidence'});if(openMailSources){if(source.attachmentId&&openMailDocument)await openMailDocument(source.id,source.attachmentId,source);else openMailSources([observed]);}else{setMailSourceTarget({...source,key:crypto.randomUUID()});setWikiPage(false);setMailPage(true);}setPanel(null);});
    }else void perform(async()=>{const sourceProjectId=project?.projectId;const current=await api('editorSource',{projectId:sourceProjectId,path:source.path,taskId});if(!mounted.current)return;if(current.hash!==source.hash)throw Error('answer_source_changed');await openPath(source.path,taskId,{projectId:sourceProjectId,line:source.start,endLine:source.end,expectedHash:source.hash,canPresent:()=>mounted.current});});
  }
  function runComposerCommand(action){if(action==='terminal'){if(openTerminal)openTerminal();else void workspaceView?.('terminal');}else if(action==='capture'){void startWindowCapture();}else if(action==='capture-web')void startWebCapture();else if(action==='model')openModels();else if(action==='skills')openSkillPanel('installed');else if(action==='usage')setPanel('usage');else if(action==='wiki-update')refreshWiki();}
  // /wiki_update (user request 2026-10-14): pull the git remote when there is one, then the same update the 위키 갱신 button runs.
  function refreshWiki(){return perform(async()=>{try{const result=await api('wikiUpdate',{method:'refresh'});await refresh();showNotice(wikiRefreshNotice(result));}catch(error){showError(wikiRefreshErrors[error.message]||failure(error));}});}
  const mailEvidence=<>{textEditor.chip(()=>setPanel('text-editor'))}{office.chip(()=>setPanel('office'))}{documentReading&&<div className="nubi-mail-evidence-chips" role="status"><span className="status-spinner" aria-hidden="true"/>문서 읽는 중</div>}<DocumentChips documents={draftDocuments} onRemove={id=>setDraftDocuments(items=>items.filter(item=>item.id!==id))} onOpen={openAnswerSource}/><MailEvidenceChips references={mailReferences} onRemove={item=>setMailReferences(current=>removeMailReference(current,item))} onOpen={source=>openAnswerSource({...source,kind:'mail'})}/><CaptureChips captures={draftCaptures} onRemove={id=>setDraftCaptures(current=>current.filter(item=>item.id!==id))}/></>;
  // Freeze the native browser and app together before the selector hides child views.
  async function startWindowCapture(){if(capturing||draftCaptures.length>=CAPTURE_LIMIT)return;try{const shot=await api('captureWorkspace',{maxWidth:2400});setCapturePreview({...shot,target:'window'});setCapturing(true);}catch(error){showError(error?.message==='browser_auth_protected'?'로그인 화면을 닫은 뒤 캡처해 주세요.':'화면을 캡처하지 못했어요. 페이지가 표시된 뒤 다시 시도해 주세요.');}}
  async function startWebCapture(){if(draftCaptures.length>=CAPTURE_LIMIT)return;try{const shot=await api('captureWorkspace',{target:'page',maxWidth:2400});setCapturePreview(shot);setCapturing(true);}catch{showError('열린 웹페이지를 캡처하지 못했어요. 페이지가 표시된 뒤 다시 시도해 주세요.');}}
  // The capture button sits right of the + menu in the composer (user request 2026-10-15).
  const captureControl=<CxButton type="button" className="nubi-icon-button nubi-capture-button" data-icon-only aria-label="화면 캡처" title={draftCaptures.length>=CAPTURE_LIMIT?`캡처는 ${CAPTURE_LIMIT}장까지 첨부할 수 있어요`:'Workspace 화면을 캡처해 첨부'} disabled={capturing||draftCaptures.length>=CAPTURE_LIMIT} onClick={()=>void startWindowCapture()}><Icon name="image" size={18}/></CxButton>;
  async function captureRegion(rect){
    // Crop the exact frame shown in the selector. Navigation, modal hiding and
    // animations after selection must not replace the user's chosen evidence.
    if(capturePreview)return cropCapture(capturePreview,rect);
    return cropCapture(await api('captureWorkspace'),rect);
  };

  const captureSelected=async rect=>{
    setCapturing(false);
    try{
      // The selected pixels come from the preview, not a later page revision.
      const item=await captureRegion(rect);
      setDraftCaptures(current=>[...current,item].slice(0,CAPTURE_LIMIT));requestAnimationFrame(()=>composer.current?.focus());}
    catch{setError('화면을 캡처하지 못했어요. 다시 시도해 주세요.');}
  };
  const waitingRequests=incomingRequests(project).length;
  const panelTitle=(icon,label)=><span className="nubi-panel-title" title={label}><span className="nubi-panel-title-icon" aria-hidden="true">{icon==='app'?<WindowMark size={18}/>:icon==='terminal'?<TerminalMark/>:<Icon name={icon} size={18}/>}</span><span>{label}</span></span>;
  const approvalControl=project?<ApprovalModeControl key={project.projectId} policy={approval} disabled={busy} onMode={mode=>perform(async()=>{setApproval(await api('setApprovalMode',{mode}));})} onRemove={item=>perform(async()=>{setApproval(await api('removeAllowedCommand',{profile:item.profile,script:item.script}));})}/>:null;
  const modelPicker=provider?.connected?<ModelPicker data={modelData} providerLabels={providerLabels} loading={catalogLoading===provider?.provider} disabled={submitting||busy||!!activeTask||project?.backgroundActive} open={panel==='models'} onOpen={openModels} onRefresh={()=>modelAction('refresh')}/>:<CxButton className="model-trigger" data-provider={provider?.provider||'aipro'} aria-haspopup="dialog" aria-label="모델 선택" title="모델을 선택하고 로그인" disabled={busy} onClick={openModels}><ProviderIcon provider={provider?.provider||'aipro'}/><span className="model-trigger-label"><span>{provider?.models?.find(model=>model.id===provider.model)?.label||provider?.model||'모델 선택'}</span></span><Icon name="chevronDown" size={16}/></CxButton>;
  const reasoningControl=['aipro','chatgpt','claude'].includes(provider?.provider)?<ReasoningPicker api={api} provider={provider} disabled={busy||!!activeTask||project?.backgroundActive}/>:null;
  const contextModel=modelData.catalog.models.find(m=>m.id===provider?.model)||{name:provider?.model||'',displayName:provider?.model||'선택한 모델 없음'};
  const meter=workspaceContextMeterInfo({task,model:contextModel,draft:request});
  const contextMeter=<ContextMeter dialogTitle={panelTitle('chartColumn','컨텍스트 사용량')} usageInfo={meter} model={contextModel} messages={NO_MESSAGES} draft="" promptContext={NO_PROMPT} stats={{count:task?.context?.compactions||0,beforeTokens:task?.context?.beforeTokens,afterTokens:task?.context?.afterTokens}}/>;
  // With only personal conversations and no folder project, the home screen asks to open a project (user decision
  // 2026-10-14); choosing a conversation or starting a new one goes straight to chat.
  const onlyConversation=project?.kind==='conversation'&&!projects.some(entry=>entry.id!==project.projectId&&entry.kind!=='conversation');
  const defaultPicker=onlyConversation&&!taskId&&!personalStart;
  const choosingProject=projectPicker||!project||defaultPicker;
  const welcomeText=choosingProject?'프로젝트를 열어 주세요.':greeting;
  // Completion belongs to this greeting, not the entire lifetime of Workbench.
  // A reduced-motion preference shows the reserved full text immediately.
  const completeWelcome=useCallback(()=>{if(!motion.paused)setWelcomeAnimated(welcomeText);},[motion.paused,welcomeText]);
  const companyAccount=ghesAccount&&<GhesAccount account={ghesAccount} onState={setGhesState} updates={ghesUpdate} repositories={ghesRepositories} open={accountOpen} loginRequest={accountLoginRequest} onOpen={()=>{if(ghesState?.connected)setAccountOpen(true);else startCompanySignIn();}} onClose={()=>{setAccountOpen(false);restoreMarketplacePanel(pendingMarketplace.current);}} onConnected={accountConnected} onCancelled={cancelCompanyConnection} buttonRef={accountButton}/>;
  return <div ref={workbenchNode} className="nubi-workbench" style={{'--nubi-chat-min-width':`${minimumAgentWidth}px`}} data-compact={compact} data-large-text={false} data-host-layout={hostLayout} data-show-progress={showProgress} data-workspace-screen={panel==='workflows'?'workflows':wikiPage?'wiki':mailPage||panel==='mail'?'mail':skillsPage?'skills':task?'conversation':'welcome'}><AmbientScene/><SystemDecisionNotifications decisions={decisions} onOpen={openHumanDecision} onAnswer={answerDecisionFromToast}/>{toastHost&&<WorkspaceToast/>}
    <WorkspaceToolbar layoutRoot={workbenchNode} accountControl={<>{hostLayout!=='integrated'&&<WorkspaceUpdate compact update={workspaceUpdate}/>}{hostLayout==='integrated'&&!compact&&<WorkspaceIconAction icon="mail" iconOnly label="메일 설정" className="nubi-toolbar-mail" aria-haspopup="dialog" aria-pressed={panel==='mail'} onClick={()=>{panelOrigin.current=null;setPanel('mail');}}/>}{!compact&&<NotificationBell/>}{companyAccount}</>} host={hostLayout==='integrated'?toolbarHost:null} title={panel==='workflows'?'워크플로우':wikiPage?'위키':mailPage?'메일':skillsPage?'AI Workspace':task?.request||projects.find(entry=>entry.id===project?.projectId)?.name||project?.name||'시작하기'} status={task&&task.state!=='review'&&!(task.state==='running'&&activityRunId)&&(task.state==='paused'&&!connectionRequest?<RecoveryStatus/>:<DeckStatus tone={running?'active':'neutral'}>{connectionRequest?'앱 연결 대기':task.state==='waiting_input'&&task.peerWait&&!task.question?'연결한 누비 응답 대기':task.state==='running'&&Number.isFinite(task.responseTiming?.elapsedMs)?<ResponseTime timing={task.responseTiming} label="진행" live/>:stateLabel[task.state]||task.state}</DeckStatus>)} project={project} sidebarOpen={sidebarOpen} onToggleSidebar={()=>setSidebarOpen(value=>!value)} disabled={busy} onNew={()=>{setMailPage(false);setSkillsPage(false);setWikiPage(false);selectSession(null);if(compact)setSidebarOpen(false);requestAnimationFrame(()=>composer.current?.focus());}}>
      {provider?.provider==='claude'&&provider.quota?.windows?.length>0&&<ClaudeQuotaPill quota={provider.quota} plan={provider.plan} onClick={()=>setPanel('usage')}/>}
      <WorkspaceIconAction ref={toolbarHost?usageButton:undefined} icon="chartColumn" iconOnly label="토큰 사용량" aria-haspopup="dialog" onClick={()=>setPanel('usage')}/>
      {project&&<WorkspaceIconAction icon="bookmark" iconOnly indicator={wikiInitialization?.state==='running'&&<span className="status-spinner" aria-label="위키 준비 중"/>} label="위키 설정" title={wikiInitialization?.state==='running'?'프로젝트 위키 준비 중':'프로젝트 위키'} aria-busy={wikiInitialization?.state==='running'||undefined} onClick={openWikiSettings}/>}
    </WorkspaceToolbar>
    <div className={`nubi-workbench-layout${project?' has-project':''}`}>
    {panel==='office'&&office.dialog(()=>setPanel(null))}
    {panel==='text-editor'&&textEditor.dialog(()=>setPanel(null))}
    {selectedDocument&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={<span className="nubi-panel-title"><FileKindIcon name={selectedDocument.filename} size={18}/><span>{selectedDocument.filename}</span></span>} variant="modal" hideHelp onClose={()=>setSelectedDocument(null)}><p className="nubi-muted">{selectedDocument.coverage}</p><Suspense fallback={<span className="status-spinner" aria-label="문서 여는 중"/>}><ChatDocumentPreview document={selectedDocument} onRange={offset=>openDocument(selectedDocument,offset)}/></Suspense></DetailPanel>}
    {workspaceView&&hostLayout==='integrated'&&<WorkspaceNavigation onPreloadScreen={name=>{if(name==='workflows')void loadWorkflowPanel().catch(()=>{});else void ({mail:MailHistory,wiki:WikiBrowser})[name]?.preload();}} workflowActive={panel==='workflows'} onWorkflow={conversationTools?()=>{setWikiPage(false);setMailPage(false);setSkillsPage(false);setPanel(panel==='workflows'?null:'workflows');if(activeView)void workspaceView(null);}:undefined} activeView={activeView} homeActive={panel!=='workflows'&&!wikiPage&&!mailPage&&!skillsPage&&!taskId&&!activeView} onMail={()=>{if(mailPage&&!wikiPage){returnHome();return;}setWikiPage(false);setSkillsPage(false);setMailPage(true);setPanel(null);if(activeView)void workspaceView(null);}} mailActive={mailPage&&!wikiPage} mailBusy={mailBusy} onWiki={()=>{if(wikiPage){returnHome();return;}setWikiPage(true);setMailPage(false);setSkillsPage(false);setPanel(null);if(activeView)void workspaceView(null);}} wikiActive={wikiPage} rail disabled={!project} homeDisabled={busy} settingsRef={settingsButton} onHome={()=>{if(!busy)returnHome();}} onSidebarToggle={()=>setSidebarOpen(value=>!value)} sidebarOpen={sidebarOpen} onView={view=>perform(()=>openWorkspaceView(view))} onSettings={()=>setPanel('settings')} skillsRef={skillsButton} skillsActive={skillsPage&&skillTab==='installed'} teamActive={skillsPage&&skillTab==='marketplace'} onInquiry={hostLayout==='integrated'?enterInquiry:undefined} inquiryActive={skillsPage&&skillTab==='support'} onSkills={()=>{panelOrigin.current=null;setPanel(null);setSkillTab('installed');setWikiPage(false);setSkillsPage(true);if(compact)setSidebarOpen(false);}} onTeamWorkspace={hostLayout==='integrated'?enterTeamWorkspace:undefined} accountControl={toolbarHost?null:companyAccount} updateControl={<WorkspaceUpdate rail update={workspaceUpdate}/>}/>}
    {<SessionSidebar conversationTools={conversationTools} projects={projects} onSwitchProject={switchProject&&((id)=>perform(()=>switchProject(id)))} onRenameProject={renameProject&&((id,name)=>perform(()=>renameProject(id,name)))} onRemoveProject={removeProject&&((id)=>perform(()=>removeProject(id)))} filesMode={hostLayout!=='integrated'&&['files','file'].includes(activeView)} activeFile={activeFile} onOpenFile={openPath?path=>perform(async()=>{await openPath(path);if(compact)setSidebarOpen(false);}):undefined} brand={hostLayout==='integrated'&&!toolbarHost} compactAt={sidebarBreakpoint} compact={compact} project={project} wikiJob={wikiChatBlocked?wikiChatJob:null} selected={taskId} open={sidebarOpen} disabled={busy} onToggle={()=>setSidebarOpen(value=>!value)} onChooseProject={showProjectStart} onSearch={conversationTools?event=>{historyTrigger.current=event.currentTarget;setPanel('history');}:undefined} onCopyProjectPath={copyProjectPath} onNew={()=>{setMailPage(false);setWikiPage(false);selectSession(null);if(compact)setSidebarOpen(false);requestAnimationFrame(()=>composer.current?.focus());}} onSelect={id=>perform(()=>selectSidebarSession(id))} onPinsChange={conversationTools?ids=>updateConversationNavigation('setPinnedTasks',{ids}):undefined} onArchive={conversationTools?(id,archived)=>perform(async()=>{const result=await updateConversationNavigation('archiveTask',{taskId:id,archived});if(result&&archived&&taskId===id)selectSession(null);}):undefined} onUsage={conversationTools?id=>{setConversationUsageId(id);setPanel('conversation-usage');}:undefined} onExport={conversationTools?id=>perform(async()=>{const result=await api('exportConversation',{taskId:id});if(result?.saved)showNotice('대화를 Markdown 파일로 저장했어요.');}):undefined} onDelete={deleteSession}/>}
    {resizeSidebar&&<div className="nubi-sidebar-resize" {...sidebarResize}/>}
    {capturing&&<CaptureOverlay preview={capturePreview} onSelect={captureSelected} onCancel={()=>setCapturing(false)}/>}
    <div className="nubi-workbench-content">
    {panel==='workflows'?<Suspense fallback={<p role="status">워크플로우를 불러오고 있어요.</p>}><WorkflowPanel embedded={!!toolbarHost} files={project?.files||[]} api={api} projectId={project?.projectId} onOpenTask={async id=>{await refresh();setPanel(null);selectSession(id);}}/></Suspense>:wikiPage?<WikiBrowser api={api} projectId={project?.projectId} onBack={()=>setWikiPage(false)} onSettings={openWikiSettings} onRewrite={askWikiRewrite} openPath={openPath?openLibraryPath:undefined}/>:mailPage?<MailHistory viewState={mailViewState} onReturn={mailSourceTarget?()=>{closeMailDocument?.();setMailPage(false);setMailSourceTarget(null);requestAnimationFrame(()=>composer.current?.focus());}:undefined} sourceTarget={mailSourceTarget} onSettings={openMailConnection} connectionRef={mailButton} api={api} provider={provider} onDocument={openMailDocument} onAsk={askFromMail} onAskSearch={askMailSearch}/>:skillsPage?<SkillManager account={ghesState} accountRevision={accountRevision} onSignIn={startCompanySignIn} key={`${project?.projectId}:${skillTab}:${skillRevision}`} api={api} openWebPage={openWebPage} initialTab={skillTab} openPath={openPath} onRegister={registerSkill} connectMarketplace={connectMarketplace&&connectCompanyMarketplace}  onBack={()=>{setSkillsPage(false);requestAnimationFrame(()=>skillsButton.current?.focus());}}/>:<>
    {!toolbarHost&&<header className="nubi-bar">{hostLayout==='integrated'&&project?<DriftLabel className="nubi-conversation-title" title={task?.request||undefined}>{task?.request||''}</DriftLabel>:<NubiLogo size={hostLayout==='integrated'?24:32} product="Workspace" versionLabel="Beta" mood={activeTask?'working':'idle'}/>}{/* no project, no empty label (user decision 2026-09-30) */project?.name&&<DriftLabel className="nubi-project-label">{project.name}</DriftLabel>}{task&&task.state!=='review'&&!(task.state==='running'&&activityRunId)&&(task.state==='paused'&&!connectionRequest?<RecoveryStatus/>:<DeckStatus tone={running?'active':'neutral'}>{connectionRequest?'앱 연결 대기':task.state==='waiting_input'&&task.peerWait&&!task.question?'연결한 누비 응답 대기':task.state==='running'&&Number.isFinite(task.responseTiming?.elapsedMs)?<ResponseTime timing={task.responseTiming} label="진행" live/>:stateLabel[task.state]||task.state}</DeckStatus>)}<div className="nubi-header-actions">
      {provider?.provider==='claude'&&provider.quota?.windows?.length>0&&<ClaudeQuotaPill quota={provider.quota} plan={provider.plan} onClick={()=>setPanel('usage')}/>}<CxButton ref={usageButton} className="nubi-icon-button" aria-label="토큰 사용량" title="토큰 사용량" aria-haspopup="dialog" onClick={()=>setPanel('usage')}><Icon name="chartColumn" size={18}/><span>사용량</span></CxButton>
      {DESKTOP_FEATURES.computerUse&&task&&<CxButton ref={appButton} className="nubi-icon-button" aria-label="앱 연결" title="앱 연결" onClick={()=>setPanel('computer')}><WindowMark size={18}/></CxButton>}{project&&<WorkspaceIconAction icon="bookmark" iconOnly indicator={wikiInitialization?.state==='running'&&<span className="status-spinner" aria-label="위키 준비 중"/>} label="위키 설정" title={wikiInitialization?.state==='running'?'프로젝트 위키 준비 중':'프로젝트 위키'} aria-busy={wikiInitialization?.state==='running'||undefined} onClick={openWikiSettings}/>}
    </div></header>}
    {project&&workspaceView&&hostLayout!=='integrated'&&<WorkspaceNavigation settingsRef={settingsButton} onSettings={()=>setPanel('settings')} onView={view=>perform(()=>openWorkspaceView(view))}/>}
    <main className="nubi-main" data-wiki-chat-blocked={wikiChatBlocked&&!mailPage&&!skillsPage||undefined}>
      {wikiChatBlocked&&!mailPage&&!skillsPage&&<ProjectWikiProgress job={wikiChatJob} projectName={wikiProjectName} projectRoot={project?.root} onStop={()=>perform(async()=>{await api(wikiChatJob?.kind==='update'?'wikiUpdate':'wikiInitialization',wikiChatJob?.kind==='update'?{method:'cancel',id:wikiChatJob.id}:{action:'cancel'});await refresh();})}/>}
      {!task&&<NubiPreparing ready={!!provider}/>}
      {!task&&provider&&!provider.connected&&!projectPicker&&!defaultPicker&&!(!project&&projects.length>0)&&<NubiLogin checkingProvider={claudeChecking?'claude':null} providerLabels={providerLabels} mood={provider.pending||claudeChecking?'working':provider.loginError?'sad':resting} intro={intro} pending={modelData.pending} onLogin={login} onCancel={()=>modelAction('cancel')}>
        {!!mailReferences.length&&<div className="nubi-mail-login-context"><p>선택한 메일은 연결 후 질문할 수 있어요.</p>{mailEvidence}</div>}
        {provider.loginError&&provider.loginDiagnostics?.length>0&&<DeckDisclosure title="연결 진단" icon="link"><pre>{providerLoginDiagnostics(provider)}</pre></DeckDisclosure>}
      </NubiLogin>}
      {!task&&(provider?.connected||projectPicker||defaultPicker||!project&&projects.length>0)&&<section className={visibleOutgoing.length?"nubi-task nubi-submit-scene":"nubi-start chat-page is-empty"}>
        {visibleOutgoing.length?<div className="nubi-conversation-wrap"><div className="nubi-conversation-scroll" ref={conversationScroll.viewport} aria-label="대화 내용" aria-busy={false} data-admission="complete" tabIndex={0} onScroll={conversationScroll.onScroll} onWheel={conversationScroll.onUserScroll} onTouchStart={conversationScroll.onUserScroll} onKeyDown={e=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(e.key))conversationScroll.onUserScroll();}}><div className="nubi-conversation-content" ref={conversationScroll.content}><OutgoingMessages items={visibleOutgoing} onDismiss={dismissOutgoing} onSource={source=>openAnswerSource({...source,kind:'mail'})}/></div></div></div>:<Welcome key={welcomeText} animate={welcomeAnimated!==welcomeText&&!request&&!motion.paused} onComplete={completeWelcome} mood={resting} intro={false} lead="" greeting={welcomeText} markSize={200}/>}
        {choosingProject?<ProjectStart projects={projects} onSelectProject={switchProject&&((id)=>perform(()=>switchProject(id)))} modelControl={modelPicker} onCancel={projectPicker&&project?()=>setProjectPicker(false):undefined} onStartConversation={()=>{setPersonalStart(true);setProjectPicker(false);if(startConversation)void perform(startConversation);}} busy={busy} blocked={false} onOpenFolder={()=>openFolder()} onClone={cloneRepository&&(url=>perform(()=>cloneRepository(url),{propagate:true}))}/>:<WorkspaceComposer commandApi={api} taskId={taskId} onCommand={runComposerCommand} onMinimumWidth={setMinimumAgentWidth} className="nubi-compose-card" modelControl={<><WorkspaceSkillMenu api={api} taskId={taskId} onDocuments={chooseDocuments} onOffice={()=>setPanel('office')} onEditor={()=>setPanel('text-editor')} onSelect={addSkillToDraft} onMarketplace={hostLayout==='integrated'?trigger=>openSkillPanel('marketplace',trigger):undefined} onManage={trigger=>openSkillPanel('installed',trigger)} onManageMcp={trigger=>{panelOrigin.current=null;skillsPanelTrigger.current=trigger||null;setPanel('mcp');}}/>{captureControl}{modelPicker}{reasoningControl}</>} contextControl={contextMeter} actionControl={approvalControl} evidenceControl={mailEvidence} onSubmit={submit} inputRef={composer} value={request} onChange={e=>setRequest(e.target.value)} disabled={wikiChatBlocked} placeholder={wikiChatBlocked?wikiChatNotice:"함께할 일을 적어 주세요"} aria-label="작업 요청" sending={submitting} sendDisabled={documentReading||wikiChatBlocked||!request.trim()||submitting||busy}/>}

      </section>}
      {task&&<section className="nubi-task nubi-chapter-layout"><ConversationWindow id={conversationKey} messages={task.messages||NO_MESSAGES} scroll={conversationScroll} questionMessage={activityLayout.questionMessage||activityLayout.afterMessage||(running?activityAnswer:null)} jump={chapterJump} taskId={taskId} onJumpHandled={()=>setChapterJump(null)}>{historyWindow=><div className="nubi-conversation-wrap"><ChapterContents chapters={task.kind==='workflow'?[]:task.chapters||[]} onJump={chapter=>setChapterJump({...chapter,taskId})}/><div className="nubi-conversation-scroll" ref={conversationScroll.viewport} aria-label="대화 내용" aria-busy={historyWindow.loading} data-admission={historyWindow.loading?'pending':'complete'} tabIndex={0} onScroll={conversationScroll.onScroll} onWheel={conversationScroll.onUserScroll} onTouchStart={conversationScroll.onUserScroll} onKeyDown={e=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(e.key))conversationScroll.onUserScroll();}} onFocusCapture={conversationScroll.onFocusCapture}><div className="nubi-conversation-content" ref={conversationScroll.content}>{task.kind==='workflow'&&task.workflowRunId?<WorkflowRunView embedded key={task.workflowRunId} api={api} runId={task.workflowRunId} renderDecisions={decisions=><>{decisions.map(({kind,record})=>kind==='command'?<SetupActions key={record.id} actions={[record]} proposals={project.proposals||[]} processes={project.processes||[]} profiles={project.profiles||[]} disabled={busy} {...setupHandlers}/>:<ProposalCard key={record.id} proposal={record} api={api} busy={busy} onCompare={()=>perform(()=>review(record.id))} onRebase={()=>perform(async()=>{await api('mergeProposal',{proposalId:record.id});await refresh();})} onCancel={()=>perform(async()=>{await api('cancelProposal',{proposalId:record.id});await api('resumeWorkflow',{runId:task.workflowRunId});await refresh();})} onApply={()=>perform(async()=>{await apply(record.id);await refresh();})}/>)}</>} onOpenOutput={card=>perform(()=>openOutput?openOutput(card,card.taskId):card.path?openPath(card.path,card.taskId):Promise.reject(Error('output_preview_unavailable')))}/>:<>
                <article className="message message-user nubi-request" data-message-key={task.id} aria-label="내 메시지"><div className="nubi-user-bubble"><MessageBody role="user" content={task.request}/><MailEvidenceChips references={task.requestMailReferences} onOpen={source=>openAnswerSource({...source,kind:'mail'})}/><DocumentChips documents={task.requestDocuments} onOpen={openAnswerSource}/><CaptureThumbs captures={task.requestCaptures}/></div><div className="message-actions"><MessageTimestamp at={task.createdAt}/><CopyButton text={task.request} label="내 메시지 복사" successMessage="메시지를 복사했습니다."/></div></article>
                {historyWindow.start===0&&activityLayout.root.map(historicalActivity)}
                {activityLayout.atStart&&activity}

        <div className="nubi-enter">
          {!task.messages.length&&!running&&!connectionRequest&&!provider?.connected&&<p className="nubi-muted">모델을 연결해 분석을 시작하세요.</p>}

          {historyWindow.start>0&&<div className="nubi-history-more" ref={historyWindow.trigger}><CxButton aria-disabled={historyWindow.loading} onClick={historyWindow.older}><Icon name="chevronUp" size={16}/>이전 대화 보기</CxButton></div>}
          <ConversationMessages indexOffset={historyWindow.start} reviewMessage={reviewMessage} reviewRef={setReviewSlot} api={api} revealAnswers={revealAnswers} onSource={openAnswerSource} onForget={forgetRunMemory} messages={historyMessages.slice(historyWindow.start)} task={task} provider={provider} onRegenerate={regenerateResponse} regenerateTitle={wikiChatBlocked?wikiChatNotice:undefined} regenerateDisabled={wikiChatBlocked||busy||running||!!task.question||!!connectionRequest} beforeMessage={beforeActivityAnswer} afterMessage={afterActivityMessage} questionMessage={activityLayout.questionMessage} questionControl={questionControl}/>
          {!running&&task.reviewDraft&&<details className="nubi-review-draft"><summary><Icon name="infoCircle" size={16}/><span>검토 전 답변</span><Icon name="chevronDown" size={16}/></summary><p>검토가 끝나지 않아 정확성과 완료 여부를 확인해야 합니다.</p><MessageBody role="assistant" content={task.reviewDraft.content}/></details>}
          {/* The model's thinking shows inside the run's record (ui/WorkspaceActivity.jsx), where it stays after the run. */}
          {/* No answer bubble while running (user decision 2026-10-14): a half-written answer kept vanishing and reappearing
             above the chat; the thinking shows instead, and the answer appears once, when it is done. */}
          {DESKTOP_FEATURES.computerUse&&connectionRequest&&!task.question&&task.state!=='cancelled'&&<ComputerConnectionForm request={connectionRequest} key={'connection-'+connectionRequest.id} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running}/>}
          {DESKTOP_FEATURES.computerUse&&<ComputerUse showControls={false} key={`computer-${task.id}`} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running||!!task.question||task.state==='cancelled'}/>}

          {showProgress&&task.changePlan&&<DeckDisclosure key={changePlanLive?'change-plan:live':'change-plan'} attention={changePlanLive} icon="clipboardCheck" title={`작업 계획 (${task.changePlan.targets.length}개 파일)`}><p>{task.changePlan.summary}</p><ul className="nubi-plan-list">{task.changePlan.requirements.map(r=><li key={r.id}><strong>{r.text}</strong><small>{r.criterionId?'완료 조건 '+r.criterionId:'누비가 정리한 요구사항'}</small></li>)}</ul>{task.changePlan.targets.map(target=><CxButton className="nubi-file-link" key={target.path} onClick={()=>perform(()=>openPath(target.path,taskId))}><Icon name="file" size={16}/><DriftLabel as="strong">{target.path}</DriftLabel><span>{target.reason}</span></CxButton>)}<p className="nubi-muted">관련 항목 {task.changePlan.impact.items.reduce((n,item)=>n+item.nodes.length,0)}개를 검토합니다.{task.changePlan.impact.unmapped.length?' 연결 정보가 없는 파일은 영향 범위를 따로 확인해야 해요.':''}</p>{task.changePlan.wikiEvidence?.length>0&&<DeckDisclosure title={`계획의 위키 근거 ${task.changePlan.wikiEvidence.length}개`}>{task.changePlan.wikiEvidence.map(row=><CxButton key={row.evidenceId} className="nubi-file-link" onClick={()=>perform(()=>openPath(row.path,taskId))}><Icon name="file" size={16}/><DriftLabel>{row.path}:{row.start}</DriftLabel></CxButton>)}<p className="nubi-muted">계획에 사용한 문서입니다. 제안을 만들 때 변경 여부를 다시 확인합니다.</p></DeckDisclosure>}<h3>완료할 일</h3><ul className="nubi-plan-list">{task.changePlan.checks.map((check,i)=><li key={i}>{check.description}<small>{({test:'테스트',browser:'실제 화면',inspection:'직접 확인'})[check.method]}</small></li>)}</ul>{task.changePlan.assumptions.length>0&&<p className="nubi-muted">전제: {task.changePlan.assumptions.join(', ')}</p>}</DeckDisclosure>}
          {showProgress&&!!detachedQuestions.length&&<DeckDisclosure title="확인한 요구사항" icon="check">{detachedQuestions.map((q,i)=><div className="nubi-decided-question" key={q.id||i}><p>{q.text}</p><strong>{q.answer.text}</strong></div>)}</DeckDisclosure>}
          {uncertainProposals.length>0&&<section className="nubi-results" aria-label="파일 저장 확인">{uncertainProposals.map(p=><div key={p.id}><strong>{p.path}</strong><p>{p.state==='attention'?'저장 결과를 확인해 주세요. 파일을 다시 쓰지 않습니다.':'같은 경로에 파일이 생겼어요. 현재 내용을 확인해 주세요.'}</p><CxButton onClick={()=>perform(()=>review(p.id))}><Icon name="columns" size={18}/>비교</CxButton></div>)}</section>}

          {commandCards((project?.processes||[]).filter(row=>row.taskId===taskId&&!taskActions.some(action=>action.resultProcessId===row.id)).reverse().map(row=>({id:row.id,state:'started',title:'명령 실행',script:row.script,workspace:row.cwd,resultProcessId:row.id})))}

          {/* A server started from the conversation stays visible: its address, a way to open it in the app browser and the stop control above (user report 2026-10-14). */}{processResult&&['checking','running'].includes(processResult.state)&&localServerUrls(processResult.output).map(url=><section key={url} className="nubi-server-notice" aria-label="실행 중인 로컬 서버"><span className="nubi-server-notice-icon" aria-hidden="true"><Icon name="play" size={16}/></span><div><strong>로컬 서버가 실행 중이에요</strong><small>{url}</small></div><CxButton variant="primary" onClick={()=>perform(()=>api('openWorkspacePage',{url}))}><Icon name="linkExternal" size={16}/>앱 브라우저로 다시 열기</CxButton></section>)}
          <ProcessRecovery process={processResult} connected={provider?.connected} cancelled={task.state==='cancelled'} disabled={busy||running||!!task.question} onContinue={()=>provider?.connected?perform(async()=>{await api('diagnoseProcess',{id:processResult.id});await refresh();}):openModels()}/>

          {comparison&&<div className="nubi-comparison"><div className="nubi-compare-toolbar"><DeckStatus>{comparison.state==='stale'?'기준 변경됨':'캡처됨'}</DeckStatus><CxButton aria-pressed={overlay} onClick={()=>setOverlay(!overlay)}><Icon name="layers" size={16}/>{overlay?'나란히 보기':'겹쳐 보기'}</CxButton></div><div className={`nubi-captures ${overlay?'overlay':''}`}><figure><figcaption>변경 전</figcaption><img src={comparison.beforeImage} alt="변경 전 실제 로컬 화면"/></figure><figure><figcaption>변경 후</figcaption><img src={comparison.afterImage} alt="변경 후 실제 로컬 화면"/></figure></div><p className="nubi-muted">{comparison.note}</p></div>}
          <ConversationMessages reviewMessage={reviewMessage} reviewRef={setReviewSlot} api={api} revealAnswers={revealAnswers} onSource={openAnswerSource} onForget={forgetRunMemory} messages={inboxMessages.slice(Math.max(0,historyWindow.start-historyMessages.length))} indexOffset={Math.max(historyWindow.start,historyMessages.length)} task={task} provider={provider} onRegenerate={regenerateResponse} regenerateTitle={wikiChatBlocked?wikiChatNotice:undefined} regenerateDisabled={wikiChatBlocked||busy||running||!!task.question||!!connectionRequest} beforeMessage={beforeActivityAnswer} afterMessage={afterActivityMessage} questionMessage={activityLayout.questionMessage} questionControl={questionControl}/>
          {(task.chapters||[]).filter(chapter=>chapter.messageIndex===task.messages.length).map(chapter=><ChapterDivider key={chapter.id} chapter={chapter}/>)}
          <OutgoingMessages items={visibleOutgoing} onDismiss={dismissOutgoing} task={task} onSource={source=>openAnswerSource({...source,kind:'mail'})}/>
          {!activityAnswer&&!activityLayout.afterMessage&&!activityLayout.atStart&&activity}
          {!activityLayout.questionMessage&&questionControl}
          {/* Keep the latest review beside its answer; only unanswered runs need a fallback slot. */}
          {!reviewMessage&&<div ref={setReviewSlot} className="nubi-review-slot"/>}
          {!showProgress&&!running&&task.resultReview&&(!task.resultReview.runId||task.resultReview.runId===activityRunId)&&(task.resultReview.status!=='ready'||task.resultReview.nextStep||task.resultReview.checks?.some(check=>check.state!=='supported'))&&<AnalysisReviewProgress review={{...task.resultReview,state:task.resultReview.status==='error'?'failed':task.resultReview.status}} running={false}/>}
          {!showProgress&&running&&<p className="nubi-launch-progress nubi-working-status nubi-progress-atmosphere" role="status"><span className="status-spinner" aria-hidden="true"/><ResponseTime timing={task.responseTiming} label="" suffix=" 동안 작업 중" fallback="작업 중" showIcon={false} live/></p>}
          {/* Commands of runs not shown as records above (older records without a run) keep their place here. */}
          {commandCards(taskActions.filter(a=>a.state!=='proposed'&&(!a.runId||!placedRunIds.has(a.runId))))}
          {/* The run stopped at its call or time budget (bundle 3.3, 2026-10-15): say so and offer to go on. */}
          {task.runBudget?.reached&&!running&&<CxNotice>호출 {task.runBudget.calls}회, {Math.max(1,Math.round(task.runBudget.elapsedMs/60000))}분에 닿아 여기서 정리했어요. <CxButton disabled={busy||!!task.question} onClick={()=>perform(async()=>{await api('startAgent',{taskId,answer:'이어서 진행해 주세요.'});await refresh();})}><Icon name="play" size={16}/>이어서 진행</CxButton></CxNotice>}
          {task.recovery?.state==='retrying'&&<CxNotice>로그인 상태를 다시 확인합니다. ({task.recovery.attempt}회)</CxNotice>}
          {['paused','interrupted'].includes(task.state)&&<p className="nubi-muted">{task.error==='work_plan_invalid'?'계획 응답을 확인하지 못해 멈췄어요. 요청과 기록은 보관했습니다.':'진행 내용을 저장했어요. 현재 파일을 확인하고 이어갑니다.'}</p>}
          {launchingTask?.id===taskId&&!running&&<p className="nubi-launch-progress" role="status"><span className="status-spinner" aria-hidden="true"/><ResponseTime timing={launchingTask} label="" showIcon={false} live/><span>시작하는 중</span></p>}
          <div className="nubi-task-actions">
            {provider?.connected&&!running&&!submitting&&launchingTask?.id!==taskId&&!task.question&&!connectionRequest&&['draft','ready','paused','failed','interrupted','cancelled'].includes(task.state)&&<ActionButton action="refresh" iconOnly={false} visibleLabel={task.state==='draft'?'시작':'이어서 진행'} label={task.state==='draft'?'시작':'이어서 진행'} title={wikiChatBlocked?wikiChatNotice:task.state==='draft'?'시작':'이어서 진행'} disabled={wikiChatBlocked||busy||running} onClick={()=>perform(async()=>{await launchTask(taskId,()=>api(task.kind==='workflow'?'resumeWorkflow':['paused','failed','interrupted'].includes(task.state)?'resumeAgent':'startAgent',task.kind==='workflow'?{runId:task.workflowRunId}:{taskId}));await refresh();})}/>}
          </div>
          {/* Applied files are results: keep them visible with progress display off. */}
          <DocumentWorkStatus task={task}/>
          <AppliedFileChanges api={api} taskId={taskId} receipts={appliedProposals} onOpen={(row,options)=>reviewApplied?reviewApplied(row,taskId,options):openPath(row.path,taskId,{...options,expectedHash:row.hash,revealInExplorer:true})}/>
          <WorkspaceInputs kind="steer" task={task} busy={wikiChatBlocked||busy||inputBusy} onAction={inputAction} onEdit={editInput} onSource={source=>openAnswerSource({...source,kind:'mail'})}/>
          <div className="nubi-current-decisions">
          {conversationTools&&task.afterEditCheckError&&<section className="nubi-results" role="alert"><h2>편집 뒤 검사 준비가 필요해요</h2><p>{afterEditCheckMessage(task.afterEditCheckError,task.afterEditCheckPath)}</p><CxButton disabled={busy||running||!!task.question} onClick={()=>perform(async()=>{await api('retryAfterEditCheck',{taskId});await refresh();})}>검사 다시 준비</CxButton></section>}
          {pendingProposals.length>0&&<section className="nubi-results"><h2>변경 제안</h2>{pendingProposals.map(p=><ProposalCard key={p.id} proposal={p} api={api} busy={busy} onCompare={()=>perform(()=>review(p.id))} onRebase={()=>perform(async()=>{const result=await api('mergeProposal',{proposalId:p.id});await refresh();if(result.conflicted){setError('같은 부분이 바뀌었어요. 현재 파일과 제안을 비교해 주세요.');return;}await refresh();showNotice('현재 파일에 맞춰 새 제안을 만들었어요.');})} onReplan={()=>perform(async()=>{if(!provider?.connected)throw Error('provider_missing');await api('startAgent',{taskId,answer:`이전 변경 제안의 파일 ${JSON.stringify(p.path)}이 바뀌었습니다. 현재 파일을 다시 읽고 기존 요청과 사용자 수정을 보존한 새 제안을 준비해 주세요. 이전 제안: ${p.id}. 충돌한 이전 내용을 그대로 덮어쓰지 마세요.`});await refresh();})} onCancel={()=>perform(async()=>{await api('cancelProposal',{proposalId:p.id});await refresh();showNotice('변경 제안을 취소했어요.');})} onApply={()=>perform(async()=>{await apply(p.id);const latest=await refresh();showNotice('파일 반영을 확인했어요.');if(provider?.connected&&!running&&!task.question&&task.state!=='cancelled'&&!waitingOn(latest,taskId)){await api('startAgent',{taskId});await refresh();}})}/>) }</section>}
          {(project.commandRepairs||[]).filter(r=>r.taskId===taskId).map(r=>{const runRepair=always=>perform(async()=>{if(always)setApproval(await api('allowCommand',{kind:'repair',id:r.id}));const result=await api('applyCommandRepair',{id:r.id});if(result.resultProcessId){const process=await api('poll',{id:result.resultProcessId});setProcessResult(process);openTerminal?.({processId:process.id,cwd:process.cwd});}await refresh();});return <DecisionPrompt inline key={r.id} id={r.id} title="수정한 명령을 실행할까요?" summary={r.state==='proposed'?'명령 수정 제안':r.state==='started'?'수정한 명령 실행됨':r.state==='rejected'?'실행 취소됨':'실행 상태 확인 필요'} icon="terminal" label={r.state==='proposed'?'확인하고 실행':'명령 상세'} pending={r.state==='proposed'} blocked={busy||running||!!task.question}>
            <p>{r.reason}</p>{r.state==='proposed'&&<IrreversibleNotice value={r.irreversible}/>}
            <TerminalBlock profile={r.profile} workspace={r.workspace} command={r.script} label="수정한 명령"/>
            {r.state==='proposed'?<ApprovalBar approveLabel="승인" rejectLabel="취소" disabled={busy||running||!!task.question} onApprove={()=>runRepair(false)} onReject={()=>perform(async()=>{await api('rejectCommandRepair',{id:r.id});await refresh();})} onAlways={()=>runRepair(true)}/>:<p className="nubi-muted">{r.state==='started'?'실행 결과는 대화에서 확인해 주세요.':'실행 상태를 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.'}</p>}
          </DecisionPrompt>;})}
          {commandCards(taskActions.filter(a=>a.state==='proposed'))}
          </div>
        </div></>}</div></div><CxButton hidden={!conversationScroll.away} className="nubi-jump-latest" aria-label="최신 메시지로 이동" title="최신 메시지로 이동" onClick={conversationScroll.followLatest}><Icon name="arrowDown" size={18}/></CxButton></div>}</ConversationWindow>
          <div className="composer-stack nubi-followup-stack">{task.kind!=='workflow'&&<WorkspaceInputs task={task} busy={wikiChatBlocked||busy||inputBusy} onAction={inputAction} onEdit={editInput} onSource={source=>openAnswerSource({...source,kind:'mail'})}/>}
          {task.kind!=='workflow'&&!task.question&&!connectionRequest&&<WorkspaceComposer commandApi={api} taskId={taskId} onCommand={runComposerCommand} onMinimumWidth={setMinimumAgentWidth} className="nubi-compose-card nubi-followup" onStop={running?()=>perform(async()=>{await api('stopAgent',{taskId});await refresh();}):undefined} modelControl={<><WorkspaceSkillMenu api={api} taskId={taskId} onDocuments={chooseDocuments} onOffice={()=>setPanel('office')} onEditor={()=>setPanel('text-editor')} onSelect={addSkillToDraft} onMarketplace={hostLayout==='integrated'?trigger=>openSkillPanel('marketplace',trigger):undefined} onManage={trigger=>openSkillPanel('installed',trigger)} onManageMcp={trigger=>{panelOrigin.current=null;skillsPanelTrigger.current=trigger||null;setPanel('mcp');}}/>{captureControl}{modelPicker}{reasoningControl}</>} contextControl={contextMeter} actionControl={approvalControl} evidenceControl={mailEvidence} onSubmit={submit} id="followup" inputRef={composer} value={request} onChange={e=>setRequest(e.target.value)} disabled={wikiChatBlocked} placeholder={wikiChatBlocked?wikiChatNotice:running?"추가 메시지 입력":"이어서 요청해 주세요"} aria-label="추가 요청" title={running?"Enter로 대기열에 추가, Shift+Enter로 줄바꿈":""} sending={submitting} sendDisabled={documentReading||wikiChatBlocked||submitting||!provider?.connected||!request.trim()||busy||inputBusy||!!task.question||!!connectionRequest}/>}</div>


      </section>}
    </main>
    </>}
    </div></div>
    {mailLogin&&<MailLoginForm api={api} {...mailLogin} onClose={()=>setMailLogin(null)}/>}
    {mailStorage&&<MailStorageSetup api={api} status={mailStorage} onClose={()=>{mailStorageDismissed.current=true;setMailStorage(null);}} onDone={()=>{mailStorageDismissed.current=true;setMailStorage(null);showNotice('메일 저장 위치를 설정했어요.');}}/>}
    {panel==='changes'&&nativeChanges&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('columns','Git 변경')} variant="modal" onClose={()=>setPanel(null)}><div className="nubi-git-changes"><span className="nubi-muted">{nativeChanges.branch}</span>{nativeChanges.entries.map(entry=><CxButton className="nubi-git-change" key={entry.path} disabled={busy} onClick={()=>perform(async()=>setNativePatch(await api('workspaceChanges',{path:entry.path})))}><Icon name="file" size={16}/><span>{entry.path}</span><small>{({untracked:'새 파일',deleted:'삭제',added:'추가',modified:'수정'})[entry.state]}</small></CxButton>)}{!nativeChanges.entries.length&&<GitEmptyState title={nativeChanges.repositoryState==='not_git_repository'?'Git 이력이 없는 폴더예요':undefined}/>}{nativeChanges.truncated&&<p className="nubi-muted">변경이 많아 일부 파일만 표시합니다.</p>}{nativePatch&&<section><strong>{nativePatch.path}</strong>{nativePatch.state!=='deleted'&&<CxButton onClick={()=>{setPanel(null);perform(()=>openPath(nativePatch.path));}}><Icon name="file" size={16}/>파일 열기</CxButton>}{nativePatch.patch!==null&&<pre className="nubi-git-patch">{nativePatch.patch||'현재 변경이 없어요.'}</pre>}{nativePatch.patchTruncated&&<p className="nubi-muted">변경 내용의 일부만 확인했습니다.</p>}{nativePatch.state==='untracked'&&<p className="nubi-muted">새 파일은 파일을 열어 내용을 확인하세요.</p>}</section>}</div></DetailPanel>}
    {DESKTOP_FEATURES.computerUse&&panel==='computer'&&task&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('app','앱 연결')} variant="modal" onClose={()=>{setPanel(null);requestAnimationFrame(()=>appButton.current?.focus());}}>
      {connectionRequest?<ComputerConnectionForm key={connectionRequest.id} request={connectionRequest} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running}/>:<ComputerUse expanded showActions={true} key={taskId} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running||!!task.question||task.state==='cancelled'}/>}
    </DetailPanel>}
    {panel==='manual'&&task&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('terminal','실행과 비교')} variant="modal" onClose={()=>{if(panelOrigin.current)returnToPanel();else closePanel(settingsButton);}}>
      {panelBack}

          <form className="nubi-run-form" onSubmit={e=>{e.preventDefault();perform(async()=>{const result=await api('run',{taskId,script,profile:effectiveShell,timeoutMs:timeoutSeconds*1000,autoDiagnose});setProcessResult(result);openTerminal?.({processId:result.id,cwd:result.cwd});setPanel(null);await refresh();});}}><label htmlFor="run-command"><TerminalMark/>명령 실행</label><div className="nubi-inline"><CxInput id="run-command" value={script} onChange={e=>setScript(e.target.value)} placeholder="예: npm run dev -- --port 5174"/><CxSelect aria-label="셸" value={effectiveShell} onChange={e=>setShell(e.target.value)}>{project.profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</CxSelect><CxButton type="submit" variant="primary" disabled={!script.trim()||!effectiveShell||busy}><Icon name="arrowRight" size={16}/>실행</CxButton></div><small>{task.workspace?'별도 작업 공간에서 실행합니다.':'현재 프로젝트 폴더에서 실행합니다.'}</small></form>
          <DeckDisclosure title={task.workspace?'별도 작업 공간 준비됨':'별도 작업 공간'} icon="file"><p>마지막 커밋으로 만들며 커밋하지 않은 변경은 원래 폴더에 남습니다.</p>{!task.workspace?<CxButton disabled={busy} onClick={()=>perform(async()=>{await api('createWorktree',{taskId});await refresh();})}><Icon name="plus" size={16}/>작업 공간 만들기</CxButton>:<code>{task.workspace}</code>}</DeckDisclosure>
          <DeckDisclosure title="실행 설정" icon="sliders"><SettingToggle label="실행 후 AI가 결과 확인" checked={autoDiagnose} onChange={setAutoDiagnose}/><label className="nubi-recovery-option"><span>실행 시간 제한 (초)</span><CxInput aria-label="실행 시간 제한 (초)" type="number" min={0} max={86400} value={timeoutSeconds} onChange={e=>setTimeoutSeconds(Number(e.target.value))}/></label><p className="nubi-muted">0은 시간 제한 없이 실행합니다.</p></DeckDisclosure>
          <DeckDisclosure title="화면 비교" icon="columns"><form className="nubi-compare-form" onSubmit={e=>{e.preventDefault();perform(async()=>{setComparison(await api('compare',{taskId,beforeUrl,afterUrl}));setPanel(null);});}}><div className="nubi-url-pair"><label>변경 전<CxInput value={beforeUrl} onChange={e=>setBeforeUrl(e.target.value)} placeholder="http://localhost:5173"/></label><label>변경 후<CxInput value={afterUrl} onChange={e=>setAfterUrl(e.target.value)} placeholder="http://localhost:5174"/></label></div><CxButton type="submit" variant="primary" busy={busy} disabled={!beforeUrl||!afterUrl||busy}><Icon name="columns" size={16}/>비교</CxButton></form></DeckDisclosure>
    </DetailPanel>}
    {panel==='wiki-progress'&&!wikiChatBlocked&&<DetailPanel title="위키 준비" variant="modal" className="deck-dialog nubi-panel nubi-wiki-progress-dialog" hideHelp onClose={()=>setPanel(null)} footer={<><CxButton onClick={()=>setPanel(null)}><Icon name={wikiInitialization?.state==='running'?'minimize':'xClose'} size={18}/>{wikiInitialization?.state==='running'?'접기':'닫기'}</CxButton>{wikiInitialization?.state==='running'&&<CxButton onClick={()=>api('wikiInitialization',{action:'cancel'}).catch(error=>showError(failure(error)))}><Icon name="xClose" size={18}/>중지</CxButton>}{['attention','cancelled'].includes(wikiInitialization?.state)&&<CxButton variant="primary" onClick={()=>api('wikiInitialization',{action:'retry'}).catch(error=>showError(failure(error)))}><Icon name="refresh" size={18}/>{wikiInitialization?.canResume?'이어서 준비':'다시 시도'}</CxButton>}</>}><WikiProjectIdentity name={wikiProjectName} root={project?.root}/><WikiInitializationProgress job={wikiInitialization}/></DetailPanel>}
    {externalAiPolicy&&<ExternalAiPolicy onClose={closeExternalAiPolicy} onContinue={confirmExternalAiPolicy} onOpenPolicy={openWebPage?url=>{setExternalAiPolicy(null);setPanel(null);void perform(()=>openWebPage(url));}:undefined}/>}
    {panel==='claude'&&<ClaudeConnection initialIssue={claudeIssue} api={api} onConnected={async()=>{await refreshProvider();returnToPanel();quotaProbe.current=Date.now();void refreshClaudeQuota().catch(()=>{});}} onClose={returnToPanel} openWebPage={openWebPage}/>}
    {panel==='models'&&<ModelSelection title={panelTitle('list','모델 선택')} data={modelData} autoRefresh={false} selectWhileLoading showProviderNames providerLabels={providerLabels} disabled={submitting||!!activeTask||project?.backgroundActive||busy} loading={catalogLoading===provider?.provider} onError={showError} onProviderSelect={selected=>modelAction('select',{provider:selected})} onSelect={model=>modelAction('model',{model})} onRefresh={refreshCatalog} onLogin={login} onLogout={selected=>modelAction('disconnect',{provider:selected})} onCancelLogin={()=>modelAction('cancel')} onClose={closeModels}/>}
    {panel==='fabrix'&&<FabrixConnection title={panelTitle('logIn','FabriX 연결')} rpc={fabrixRpc} showActionLabels onError={showError} onNotice={notifyWorkspaceToast} requestPermission={()=>Promise.resolve(true)} onClose={returnToPanel} onConnected={async()=>{await refreshProvider();returnToPanel();}}/>}
    {panel==='mail'&&<DetailPanel className="deck-dialog nubi-panel" title={panelTitle('mail','메일 설정')} variant="modal" onClose={()=>panelOrigin.current?returnToPanel():closePanel(mailButton)}>{panelBack}<MailLibrary api={api} onConnectionBusy={setMailConnecting} provider={provider} onProviderLogin={login} onProviderAction={modelAction} providerBusy={busy||!!activeTask||project?.backgroundActive} openWebPage={openWebPage?async url=>{await openWebPage(url);setPanel(null);}:undefined}/></DetailPanel>}
    {panel==='memories'&&<DetailPanel variant="modal" className="deck-dialog nubi-panel" title={panelTitle('lightbulb','기억')} onClose={()=>setPanel('settings')}><MemoryPanel api={api}/></DetailPanel>}
    {panel==='mcp'&&<DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('workflow','MCP 서버')} onClose={()=>closePanel(skillsPanelTrigger)}><McpPanel api={api}/></DetailPanel>}
    {panel==='analysis-history'&&task&&<DetailPanel variant="modal" className="deck-dialog nubi-panel" title={panelTitle('clock','작업 기록')} onClose={()=>setPanel(null)}><AnalysisHistory api={api} task={task} showHistory/></DetailPanel>}
    <WorkspaceUpdateProgress update={workspaceUpdate}/>
    {conversationTools&&panel==='conversation-usage'&&conversationUsageId&&<ConversationUsage api={api} taskId={conversationUsageId} onClose={()=>setPanel(null)}/>}
    {conversationTools&&panel==='routines'&&<RoutineSettings api={api} projectId={project?.projectId} onClose={()=>setPanel('settings')} onStarted={async()=>{await refresh();showNotice('루틴 대화를 시작했어요. 질문과 승인은 대화에서 확인해 주세요.');}}/>}
    {panel==='settings'&&<DetailPanel className="deck-dialog nubi-panel" title={panelTitle('sliders','설정')} variant="modal" onClose={()=>closePanel(settingsButton)}><div className="nubi-settings">{conversationTools&&<CxButton className="nubi-settings-row" onClick={()=>setPanel('routines')}><span className="nubi-settings-row-icon" aria-hidden="true"><Icon name="clock" size={18}/></span><span>루틴</span><Icon name="chevronRight" size={16}/></CxButton>}<SettingsSection icon="layers" title="표시"><ProgressDisplaySetting enabled={showProgress} onChange={setShowProgress}/></SettingsSection>{conversationTools&&project&&<ConversationArchiveSetting days={project.conversationNavigation?.autoArchiveDays??30} onSave={days=>perform(async()=>{await api('setAutoArchiveDays',{projectId:project.projectId,days});await refresh();})}/>}{project?<div className="nubi-settings-field"><SettingsSection icon="code" title="기본 터미널"><CxSelect aria-label="기본 터미널" id="nubi-default-shell" value={project.defaultShell||''} disabled={busy||!!activeTask||project?.backgroundActive} onChange={e=>perform(async()=>{await api('setShellPreference',{profile:e.target.value});setShell('');await refresh();})}>{project.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}</option>)}</CxSelect></SettingsSection></div>:<p className="nubi-muted">프로젝트를 열면 기본 터미널을 설정할 수 있어요.</p>}{conversationTools&&project&&<AfterEditCheckSetting key={project.projectId} setting={project.afterEditCheck} profiles={project.profiles} defaultShell={project.defaultShell} disabled={busy||!!activeTask||project.backgroundActive} onSave={value=>perform(async()=>{await api('setAfterEditCheck',{projectId:project.projectId,...value});await refresh();})}/>}<div className="nubi-settings-rows">{project&&<CxButton className="nubi-settings-row" onClick={()=>setPanel('memories')}><span className="nubi-settings-row-icon" aria-hidden="true"><Icon name="lightbulb" size={18}/></span><span>기억</span><Icon name="chevronRight" size={16}/></CxButton>}{task&&<CxButton className="nubi-settings-row" onClick={()=>setPanel('analysis-history')}><span className="nubi-settings-row-icon" aria-hidden="true"><Icon name="clock" size={18}/></span><span>작업 기록</span><Icon name="chevronRight" size={16}/></CxButton>}</div><WorkspaceUpdate update={workspaceUpdate} onInstall={installUpdate}/></div></DetailPanel>}
    {panel==='usage'&&<UsagePanel data={usageData} providerLabels={providerLabels} afterAccount={<ClaudeAccountUsage data={usageData} onRefresh={refreshClaudeQuota} readCliUsage={readClaudeCliUsage}/>} loadAccountUsage={loadAccountUsage} scopeLabel="이 앱에서 사용한 토큰" onClose={()=>closePanel(usageButton)}/>}
    {conversationTools&&panel==='history'&&<DetailPanel className="deck-dialog nubi-panel" title={panelTitle('search','대화 검색')} variant="modal" initialFocus="#nubi-conversation-search" onClose={()=>closePanel(historyTrigger)}>
      <ConversationSearch api={api} projectId={project?.projectId} taskId={taskId} busy={busy} onSelect={id=>perform(async()=>{const selected=await api('conversationHistory',{taskId:id});setProject(current=>({...current,tasks:[selected,...current.tasks.filter(item=>item.id!==id)]}));setWikiPage(false);selectSession(id);setPanel(null);if(compact)setSidebarOpen(false);requestAnimationFrame(()=>composer.current?.focus());})}/>

    </DetailPanel>}
    {panel==='skills'&&<DetailPanel className="deck-dialog nubi-panel nubi-skill-dialog" title={panelTitle('layers','스킬 관리')} variant="modal" onClose={()=>{if(panelOrigin.current)returnToPanel();else closePanel(skillsPanelTrigger.current?.isConnected?skillsPanelTrigger:skillsButton);}}>{panelBack}<SkillLibrary key={`${project?.projectId}-${taskId||'root'}-${skillTab}-${skillRevision}`} api={api} taskId={taskId} openPath={(file,options)=>{flushSync(()=>setPanel(null));return perform(()=>openPath(file,undefined,options));}} onRegister={registerSkill} marketplaceEnabled={hostLayout==='integrated'} connectMarketplace={connectMarketplace&&connectCompanyMarketplace}  initialTab={skillTab}/></DetailPanel>}
    {panel==='skill-import'&&<DetailPanel className="deck-dialog nubi-panel nubi-skill-register-dialog" title={panelTitle('layers','스킬 등록')} variant="modal" onClose={closeSkillRegistration}><SkillRegistration api={api} taskId={taskId} onBusy={setSkillImportBusy} onRegistered={skillRegistered}/></DetailPanel>}
    {panel==='library'&&!wikiChatBlocked&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('bookmark','위키 설정')} variant="modal" onClose={()=>closePanel(libraryButton)}>{renderLibrary()}</DetailPanel>}
  </div>;
  function openLibraryPath(file){if(actionLock.current)return;flushSync(()=>setPanel(null));return perform(()=>openPath(file,taskId||undefined));}
  function renderLibrary(){return <div className="nubi-library">{wikiInitialization&&<DeckDisclosure title={({waiting_model:'위키 모델 연결 대기',waiting_source:'프로젝트를 선택해 주세요',running:'위키 준비 중',completed:'위키 준비 완료',existing:'기존 위키 유지',attention:'위키 확인 필요',cancelled:'위키 중지됨'})[wikiInitialization.state]||'위키'} icon="bookmark"><WikiInitializationProgress job={wikiInitialization}/>{wikiInitialization.state==='running'&&<CxButton onClick={()=>perform(()=>api('wikiInitialization',{action:'cancel'}))}><Icon name="xClose" size={16}/>중지</CxButton>}{['attention','cancelled'].includes(wikiInitialization.state)&&<CxButton onClick={()=>perform(()=>api('wikiInitialization',{action:'retry'}))}><Icon name="refresh" size={16}/>{wikiInitialization.canResume?'이어서 준비':'다시 시도'}</CxButton>}</DeckDisclosure>}{project&&<WikiUpdate key={project.projectId} api={api} openPath={openLibraryPath} initialization={wikiInitialization} onApplied={refresh}/>}<DeckDisclosure title={project?.wikiFiles.length?`위키 ${project.wikiFiles.length}개`:'문서 목록'} icon="bookmark">{project?.wikiFiles.slice(0,50).map(file=><CxButton className="nubi-file-link" key={file} onClick={()=>openLibraryPath(file)}><Icon name="file" size={14}/><DriftLabel>{file}</DriftLabel></CxButton>)}{!project?.wikiFiles.length&&<p className="nubi-muted">아직 위키 문서가 없어요.</p>}</DeckDisclosure>{task&&<section className="nubi-knowledge-record"><div><h2>작업을 위키에 남기기</h2><DeckStatus>{({none:'아직 기록 없음',matching:'기록과 일치',outdated:'갱신 필요',edited:'문서 직접 수정됨',missing:'문서 확인 필요'})[knowledge?.state]||'확인 중'}</DeckStatus></div><p className="nubi-muted">요청과 실행 결과를 새 버전으로 저장합니다.</p><div className="nubi-task-actions"><CxButton variant="primary" disabled={busy||running} onClick={()=>perform(async()=>{const value=await api('recordKnowledge',{taskId});await refresh();setKnowledge(await api('knowledgeStatus',{taskId}));showNotice(value.noChange?'기록이 이미 최신이에요.':'위키에 새 기록을 남겼어요.');})}><Icon name="save" size={16}/>{knowledge?.record?'기록 갱신':'위키에 기록'}</CxButton>{knowledge?.record&&<ActionButton action="openExternal" label="기록 열기" onClick={()=>openLibraryPath(knowledge.record.path)}/>}<ActionButton action="refresh" label="다시 확인" disabled={busy} onClick={()=>perform(async()=>setKnowledge(await api('knowledgeStatus',{taskId})))}/></div>{knowledge?.sources?.some(source=>source.state!=='matching')&&<p className="nubi-muted">원본이 바뀌었거나 읽을 수 없어요. 기록에 함께 표시합니다.</p>}</section>}</div>;}
}
