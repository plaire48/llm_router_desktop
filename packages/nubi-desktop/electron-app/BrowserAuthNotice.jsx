import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
const stages={opening:'새 페이지 요청',saml:'SAML 요청',post:'POST 요청',redirect:'리다이렉트',return:'다음 페이지 요청',page:'페이지 응답'};
const reasons={epsso_request_missing:'SSO 서버에서 이동 요청을 처리하지 못했어요.',http_error:'SSO 이동 중 서버가 오류를 반환했어요.',navigation_blocked:'앱에서 지원하지 않는 주소로 이동하려고 했어요.',popup_limit:'열린 탭이 많아 새 탭을 열지 못했어요.',browser_dns_failed:'서버 주소를 찾지 못했어요. 사내망 연결을 확인해 주세요.',browser_certificate_failed:'서버 인증서를 확인하지 못했어요.',browser_timeout:'서버 응답 시간이 초과됐어요.',browser_offline:'네트워크 연결을 확인해 주세요.',browser_connection_refused:'서버에 연결하지 못했어요.',browser_load_failed:'페이지를 불러오지 못했어요.'};
export function BrowserAuthNotice({flow,canReturn,onReturn,onCopy}){
 if(!flow?.failure)return null;
 const failure=flow.failure;
 return <aside className="desktop-browser-auth-notice" aria-label="SSO 이동 확인">
  <div className="desktop-browser-auth-heading" role="status"><Icon name="infoCircle" size={18}/><strong>SSO 페이지를 확인해 주세요</strong>{canReturn&&<CxButton title="원래 탭으로 돌아가기" aria-label="원래 탭으로 돌아가기" onClick={onReturn}><Icon name="arrowLeft" size={16}/><span>원래 탭</span></CxButton>}</div>
  <p>{reasons[failure.code]||reasons.browser_load_failed}</p>
  <details><summary><Icon name="chevronDown" size={14}/><span>{stages[failure.stage]||'페이지 이동'}</span>{failure.httpStatus&&<span>HTTP {failure.httpStatus}</span>}<span className="desktop-browser-auth-detail-label">상세</span></summary>
   <ol>{flow.events.map((event,index)=><li key={index}><span>{stages[event.stage]||'페이지 이동'}</span><span>{event.method}{event.httpStatus?` ${event.httpStatus}`:''}</span><time>{(event.elapsedMs/1000).toFixed(1)}초</time></li>)}</ol>
   <div className="desktop-browser-auth-code"><code>{failure.code}</code><CopyButton label="SSO 진단 복사" resetKey={flow} onCopy={onCopy}/></div>
  </details>
 </aside>;
}
