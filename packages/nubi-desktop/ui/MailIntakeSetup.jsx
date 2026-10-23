import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,CxTextarea,DetailPanel,Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {SettingToggle} from './SettingToggle.jsx';
import {MailAttachmentStorageOption} from './MailAttachmentStorageOption.jsx';
import {FolderMark} from './marks.jsx';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {useBackgroundOperation} from './background-modal.jsx';
import {DEFAULT_MAIL_INTAKE,normalizeMailIntake} from '../runtime/mail-intake-policy.mjs';
import './mail-intake-setup.css';

const mailboxLabels={inbox:'받은 메일',sent:'보낸 메일',other:'기타 메일',notice:'결재 문서',processed:'승인한 결재',submitted:'기안한 결재',draft:'임시보관함',spam:'스팸함',queue:'대기함',trash:'휴지통'};
const messages={mail_encryption_key_lost:'이 PC 계정의 메일 암호화 키를 찾지 못했어요. 기존 자료를 보관한 계정에서 다시 열어 주세요.',mail_encryption_integrity:'보관 자료의 암호화를 확인하지 못했어요. 기존 자료는 유지됩니다.',mail_storage_permission:'선택한 폴더에 저장할 권한이 없어요. 다른 위치를 골라 주세요.',mail_intake_invalid:'기간과 메일 주소를 확인하고 메일함을 하나 이상 선택해 주세요. 주소는 한 줄에 하나씩 입력해 주세요.',mail_busy:'메일 작업이 끝난 뒤 다시 저장해 주세요.',mail_storage_not_empty:'비어 있는 저장 폴더를 선택해 주세요.',mail_storage_nested:'원문과 위키 폴더가 서로 겹치지 않는 위치를 선택해 주세요.',mail_storage_full:'저장 공간이 부족해요. 다른 위치를 선택해 주세요.',mail_source_changed:'이동 중 파일이 바뀌었어요. 저장 위치를 다시 확인해 주세요.',mail_encryption_unavailable:'암호화 저장소를 열지 못했어요. 앱을 다시 연 뒤 저장해 주세요.'};
const lines=text=>text.split(/[\n,;]+/).map(value=>value.trim()).filter(Boolean);
export function MailIntakeSetup({api,status,onClose,onDone}){
 const [draft,setDraft]=useState(()=>({...DEFAULT_MAIL_INTAKE,...status.intakePolicy})),[addresses,setAddresses]=useState(()=>Object.fromEntries(['includeSenders','includeSubjects','excludeSenders','excludeSubjects'].map(key=>[key,(status.intakePolicy?.[key]||[]).join('\n')])));
 const [includeAttachments,setIncludeAttachments]=useState(status.includeAttachments!==false),[locations,setLocations]=useState({}),[busy,setBusy]=useState(false),[picking,setPicking]=useState(null),[error,setError]=useState(null),[progress,setProgress]=useState(null);
 const lock=useRef(false),alive=useRef(true);const background=useBackgroundOperation({title:'메일 가져오기 설정',risk:'선택한 조건은 이후 가져올 메일에 적용해요. 저장 위치를 바꾸면 기존 보관 파일도 이동해요.'});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!busy)return;let live=true,pending=false;const read=async()=>{if(pending)return;pending=true;try{const value=await api('mail',{action:'storageProgress'});if(live)setProgress(value.progress);}catch{}finally{pending=false;}};void read();const timer=setInterval(read,400);return()=>{live=false;clearInterval(timer);};},[busy,api]);
 async function choose(kind){if(lock.current||picking)return;setPicking(kind);setError(null);try{const value=await api('chooseMailStorageFolder',{kind});if(alive.current&&!value.cancelled)setLocations(current=>({...current,[kind+'Directory']:value.path}));}catch{if(alive.current)setError('폴더를 선택하지 못했어요. 다시 시도해 주세요.');}finally{if(alive.current)setPicking(null);}}
 async function save(event){event.preventDefault();if(lock.current||picking)return;let policy;try{policy=normalizeMailIntake({...draft,...Object.fromEntries(Object.entries(addresses).map(([key,value])=>[key,lines(value)]))});}catch{setError(messages.mail_intake_invalid);return;}lock.current=true;setBusy(true);setError(null);try{const value=await background.run(()=>api('mail',{action:'configureIntake',policy,includeAttachments,...locations}));if(alive.current)onDone(value);}catch(cause){if(alive.current)setError(messages[cause.message]||'설정을 저장하지 못했어요. 저장 위치와 권한을 확인한 뒤 다시 시도해 주세요.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 const stage=({scanning:'이동할 파일 확인 중',copying:'파일 복사와 확인 중',committing:'저장 위치 적용 중',cleaning:'이전 위치 정리 중'})[progress?.stage]||'메일 설정 저장 중';
 const percent=progress?.stage==='copying'&&progress.totalBytes>0?Math.floor(progress.bytes/progress.totalBytes*100):undefined;
 const location=(kind,label,value)=><div className="nubi-mail-intake-location"><FolderMark size={18}/><div><strong>{label}</strong><span title={locations[kind+'Directory']||value}>{locations[kind+'Directory']||value||'현재 기본 위치'}</span></div><WorkspaceAction action="edit" iconOnly label={`${label} 선택`} disabled={busy||!!picking} onClick={()=>void choose(kind)}/></div>;
 const textField=(key,label,placeholder)=><label className="nubi-mail-intake-field"><span>{label}</span><CxTextarea aria-label={label} rows={2} maxLength={10000} placeholder={placeholder} disabled={busy} value={addresses[key]} onChange={event=>setAddresses(current=>({...current,[key]:event.target.value}))}/></label>;
 return <DetailPanel variant="modal" hideHelp className="deck-dialog nubi-panel nubi-mail-intake-setup" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="mail" size={18}/></span>메일 가져오기 설정</span>} busy={busy} onClose={busy?undefined:onClose} footer={<><CxButton disabled={busy||!!picking} onClick={onClose}>취소</CxButton><CxButton variant="primary" type="submit" form="nubi-mail-intake-form" disabled={busy||!!picking}>{busy?'저장 중':'저장하고 계속'}</CxButton></>}>
  <form id="nubi-mail-intake-form" className="nubi-mail-intake-form" onSubmit={save}>
   <section className="nubi-mail-intake-section"><h3>어떤 메일을 가져올까요?</h3>
    <label className="nubi-mail-intake-field"><span>메일 기간</span><CxSelect aria-label="가져올 메일 기간" disabled={busy} value={draft.period} onChange={event=>setDraft(current=>({...current,period:event.target.value}))} options={[{value:'all',label:'전체 기간'},{value:'30',label:'최근 30일'},{value:'90',label:'최근 90일'},{value:'365',label:'최근 1년'},{value:'custom',label:'기간 지정'}]}/></label>
    {draft.period==='custom'&&<div className="nubi-mail-intake-dates">{[['from','시작 날짜'],['to','종료 날짜']].map(([key,label])=><label key={key} className="nubi-mail-intake-field"><span>{label}</span><CxInput type="date" aria-label={label} disabled={busy} value={draft[key]} onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))}/></label>)}</div>}
    <details><summary>메일함과 가져올 대상</summary><div className="nubi-mail-intake-options">{Object.entries(mailboxLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={draft.mailboxes.includes(key)} disabled={busy} onChange={()=>setDraft(current=>({...current,mailboxes:current.mailboxes.includes(key)?current.mailboxes.filter(value=>value!==key):[...current.mailboxes,key]}))}/><span>{label}</span></label>)}</div>{textField('includeSenders','가져올 보낸 사람','비워 두면 모든 보낸 사람\n예: owner@example.test 또는 @example.test')}{textField('includeSubjects','가져올 제목 단어','비워 두면 모든 제목')}</details>
    <small>연결 방식에서 읽을 수 있는 메일에 적용해요. 기간을 지정하면 날짜를 확인할 수 없는 메일은 제외해요.</small>
   </section>
   <section className="nubi-mail-intake-section"><h3>어디에 저장할까요?</h3><SettingToggle icon="file" label="원문 파일 보관" description={draft.retainOriginals?'메일 원문 파일을 암호화해 보관해요.':'검색과 위키용 본문, 읽은 첨부 내용만 암호화해 보관해요.'} checked={draft.retainOriginals} disabled={busy} onChange={value=>setDraft(current=>({...current,retainOriginals:value}))}/>
    {draft.retainOriginals&&<>{location('raw','원문 저장 위치',status.rawRoot)}<MailAttachmentStorageOption checked={includeAttachments} disabled={busy} onChange={setIncludeAttachments}/></>}
    {location('wiki','위키 저장 위치',status.wikiStoreRoot||status.wikiRoot)}{status.desktop?.transport==='uia'&&status.connectionMethod==='desktop'&&<small>Knox Desktop에서는 열린 메일의 본문 기록을 보관해요. EML 원문과 첨부 원본은 제공되지 않아요.</small>}<small>설정은 이후 가져올 메일에 적용해요. 위치를 변경하면 기존 보관 파일도 옮겨요.</small>
   </section>
   <details className="nubi-mail-intake-section"><summary>제외할 메일</summary>{textField('excludeSenders','제외할 보낸 사람','메일 주소 또는 @도메인을 한 줄에 하나씩')}{textField('excludeSubjects','제외할 제목 단어','예: 광고\n뉴스레터')}<small>제외 조건을 우선 적용해요. 이미 가져온 메일은 유지해요.</small></details>
   {busy&&<section role="status" className="nubi-mail-intake-section"><strong>{stage}</strong><TaskProgressBar backgroundTask={background.id} label={stage} value={percent} estimate={{identity:progress?.stage,completed:progress?.bytes,total:progress?.totalBytes}}/></section>}
   {picking&&<p role="status">폴더 선택 창에서 저장 위치를 골라 주세요.</p>}{error&&<p role="alert">{error}</p>}
  </form>
 </DetailPanel>;
}
