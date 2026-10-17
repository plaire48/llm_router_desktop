import React,{useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {SettingToggle} from './SettingToggle.jsx';
import {EXTERNAL_AI_POLICY_URL} from './external-ai-policy.mjs';
import './external-ai-policy.css';

export function ExternalAiPolicy({onContinue,onClose,onOpenPolicy}){
 const [remember,setRemember]=useState(false);
 return <DetailPanel className="deck-dialog nubi-panel nubi-external-ai-policy" title={<span className="nubi-policy-title"><Icon name="infoCircle" size={20}/>외부 AI 보안 안내</span>} variant="modal" hideHelp onClose={onClose} footer={<><CxButton onClick={onClose}>취소</CxButton><CxButton variant="primary" onClick={()=>onContinue(remember)}>확인하고 연결</CxButton></>}>
  <div className="nubi-policy-content">
   <section className="nubi-policy-section" aria-labelledby="nubi-policy-personal">
    <div className="nubi-policy-heading"><Icon name="user" size={20}/><h3 id="nubi-policy-personal">Q1. 개인정보(이름, 이메일, 연락처 등)를 입력해도 되나요?</h3></div>
    <p>A. <strong>입력하지 않아야 합니다.</strong> 개인정보, 민감 정보, 계정 정보(서버 ID/PW 등)는 입력을 금지합니다.</p>
    <p>업무상 불가피한 경우 <strong>가명 처리 또는 비식별 처리 후</strong> 입력해 주시기 바랍니다.</p>
   </section>
   <section className="nubi-policy-section" aria-labelledby="nubi-policy-history">
    <div className="nubi-policy-heading"><Icon name="message" size={20}/><h3 id="nubi-policy-history">Q2. AI와의 대화 내용은 어디에 저장되나요?</h3></div>
    <p>A. 대화 로그는 외부 서버에 저장되나, <strong>SDS 전용 테넌트로 분리된 환경에서 관리됩니다.</strong></p>
    <p>향후 기밀 정보가 포함된 질의 이력이 확인될 경우, 정보보호 규정에 따라 <strong className="nubi-policy-warning">보안 위규로 처리</strong>될 수 있습니다.</p>
   </section>
  <a className="nubi-policy-link" href={EXTERNAL_AI_POLICY_URL} title="[공통] 외부생성형AI 보안 정책 변경 및 FAQ" onClick={onOpenPolicy?event=>{event.preventDefault();onOpenPolicy(EXTERNAL_AI_POLICY_URL);}:undefined}><Icon name="linkExternal" size={16}/>보안 정책 및 FAQ</a>
  <SettingToggle label="다시 보지 않기" checked={remember} onChange={setRemember}/>
 </div></DetailPanel>;
}
