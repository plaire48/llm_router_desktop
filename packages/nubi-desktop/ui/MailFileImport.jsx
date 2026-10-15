import {TaskProgressBar} from './TaskProgressBar.jsx';
import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {ResponseTime} from './ResponseTime.jsx';
import {FolderMark} from './marks.jsx';
import './mail-file-import.css';
const failures={mail_import_protected:'보호된 파일',mail_import_link:'바로가기 제외',mail_import_empty:'본문 없음 (첨부만 있거나 읽을 수 없는 형식)',mail_size_limit:'개별 파일 처리 용량 초과',mail_parse_failed:'메일 형식 확인 필요',mail_source_changed:'파일 변경됨',mail_import_read:'읽기 권한 확인 필요',mail_storage_full:'저장 공간을 확보한 뒤 이어 가져오세요.',mail_timeout:'읽는 시간이 오래 걸려요. 다시 시도해 주세요.',mail_import_folder:'원본 폴더를 선택해 주세요.'};
export function MailFileImport({progress,busy,onChoose,onCancel,onResume,card=false}){
 const active=['scanning','importing'].includes(progress?.state);
 const resumable=!active&&progress?.directory&&(['cancelled','interrupted','failed'].includes(progress.state)||progress.failures?.length>0);
 const resume=<CxButton disabled={busy} onClick={onResume}><Icon name="play" size={16}/>이어 가져오기</CxButton>;
 const choose=<CxButton disabled={busy||active} onClick={onChoose}><FolderMark size={16}/><span>폴더 선택</span></CxButton>;
 const title=active?(progress.state==='scanning'?'파일 찾는 중':'파일 가져오는 중'):progress?.state==='completed'?(progress.total?'가져오기 완료':'지원하는 파일이 없어요'):progress?.state==='cancelled'?'가져오기 중지됨':progress?.state==='interrupted'?'가져오기가 중단됐어요':progress?.state==='failed'?'폴더를 확인해 주세요.':null;
 return <section className={`nubi-mail-section nubi-mail-file-import${card?' nubi-mail-import-card':''}`} aria-label="파일에서 가져오기">
  <div className="nubi-mail-import-heading">{card&&<span className="nubi-mail-import-icon" aria-hidden="true"><FolderMark size={22}/></span>}<div><strong>파일에서 가져오기</strong><small>{card?'EML, MHTML, MYSINGLE 폴더를 통째로 가져와요.':'EML, MHTML, MYSINGLE / 하위 폴더 포함'}</small></div>{!card&&!resumable&&choose}{resumable&&<CxButton className="nubi-icon-button" aria-label="다른 메일 폴더 선택" title="다른 폴더 선택" disabled={busy||active} onClick={onChoose}><FolderMark size={16}/></CxButton>}</div>
  {card&&!resumable&&<div className="nubi-mail-import-card-action">{choose}</div>}
  {progress&&<div className="nubi-mail-import-status" role="status"><div>{active?<span className="status-spinner"/>:<Icon name={progress.state==='completed'?'check':'infoCircle'} size={16}/>}<strong>{title}</strong>{active&&<ResponseTime timing={{startedAt:progress.startedAt}} live label="" showIcon={false}/>} {active&&<CxButton className="nubi-icon-button" aria-label="파일 가져오기 중지" title="중지" disabled={busy} onClick={onCancel}><Icon name="xClose" size={16}/></CxButton>}</div>
   {active&&<TaskProgressBar label={progress.state==='scanning'?'메일 파일 탐색':'파일 가져오기 진행률'} value={progress.state==='importing'&&progress.total>0?progress.completed/progress.total*100:undefined}/>}
   <small>{progress.state==='scanning'?`${(progress.total||0).toLocaleString()}개 파일 발견`:(active||resumable)?`${progress.completed||0} / ${progress.total||0}개 처리`:`추가 ${progress.imported||0} / 중복 제외 ${progress.duplicates||0}`}{progress.failures?.length?` / 확인 필요 ${progress.failures.length}`:''}</small>
   {progress.currentFile&&<span title={progress.currentFile}>{progress.currentFile}</span>}
   {progress.error&&progress.error!=='mail_cancelled'&&<small>{failures[progress.error]||'폴더를 다시 선택해 주세요.'}</small>}
  </div>}
  {resumable&&<div className={`nubi-mail-import-resume${card?' nubi-mail-import-card-action':''}`}><small>완료한 파일은 유지됩니다.</small>{resume}</div>}
  {!!progress?.failures?.length&&<details><summary>읽지 못한 파일</summary><ul>{progress.failures.slice(0,100).map((item,index)=><li key={index}><span title={item.file}>{item.file}</span><small>{failures[item.error]||'읽기 실패'}</small></li>)}</ul></details>}
 </section>;
}
