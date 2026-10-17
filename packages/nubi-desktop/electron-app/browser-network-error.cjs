// Fixed diagnostics only: no URLs, certificate bytes, proxy credentials or headers.
function loadFailure(code){
 if(code<=-200&&code>=-299)return 'browser_certificate_failed';
 if([-107,-110,-113,-117,-123,-134,-135,-141,-151].includes(code))return 'browser_tls_failed';
 if([-111,-115,-120,-121,-127,-130,-131,-136].includes(code))return 'browser_proxy_failed';
 return ({'-102':'browser_connection_refused','-105':'browser_dns_failed','-106':'browser_offline','-7':'browser_timeout','-118':'browser_timeout'})[code]||'browser_load_failed';
}
function networkDiagnostic(code,description,stage='opening'){
 const result={category:loadFailure(code),stage:['opening','saml','post','redirect','return','page'].includes(stage)?stage:'opening'};
 if(Number.isInteger(code)&&code<0&&code>=-999)result.netCode=code;
 if(typeof description==='string'&&/^ERR_[A-Z0-9_]{1,70}$/.test(description))result.netError=description;
 return result;
}
function networkMessage(diagnostic){
 const specific={
  ERR_CERT_AUTHORITY_INVALID:'인증서 발급 기관을 신뢰하지 못했어요. 일반 브라우저와 회사 인증서 적용 상태를 확인해 주세요.',
  ERR_CERT_DATE_INVALID:'인증서 유효기간 또는 PC의 날짜와 시간을 확인해 주세요.',
  ERR_CERT_COMMON_NAME_INVALID:'접속 주소와 인증서의 서버 이름이 달라요. 접속 주소를 확인해 주세요.',
  ERR_SSL_CLIENT_AUTH_CERT_NEEDED:'서버가 사용자 인증서를 요청했어요. 회사 인증서 적용 상태를 확인해 주세요.',
  ERR_BAD_SSL_CLIENT_AUTH_CERT:'서버가 사용자 인증서를 받아들이지 않았어요.',
  ERR_SSL_CLIENT_AUTH_PRIVATE_KEY_ACCESS_DENIED:'사용자 인증서의 키에 접근하지 못했어요. 회사 인증서 권한 확인이 필요해요.',
  ERR_PROXY_AUTH_REQUESTED:'회사 프록시 인증이 필요해요. 일반 브라우저와 프록시 로그인 설정을 확인해 주세요.',
  ERR_PROXY_AUTH_UNSUPPORTED:'회사 프록시의 인증 방식을 처리하지 못했어요.',
  ERR_CERT_REVOKED:'폐기된 인증서예요. 서버 관리자에게 확인해 주세요.',
  ERR_SSL_VERSION_OR_CIPHER_MISMATCH:'서버와 보안 연결 방식을 맞추지 못했어요. 서버 또는 회사 프록시 설정 확인이 필요해요.',
  ERR_PROXY_CERTIFICATE_INVALID:'회사 프록시의 인증서를 확인하지 못했어요.',
 };
 return specific[diagnostic?.netError]||({browser_certificate_failed:'서버 인증서를 확인하지 못했어요. 오류 상세에서 원인을 확인해 주세요.',browser_tls_failed:'보안 연결을 완료하지 못했어요. 서버 또는 회사 프록시 설정 확인이 필요해요.',browser_proxy_failed:'회사 프록시에 연결하지 못했어요. VPN과 프록시 설정을 확인해 주세요.'})[diagnostic?.category]||null;
}
module.exports={loadFailure,networkDiagnostic,networkMessage};
