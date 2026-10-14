export const ghesMessages={
  ghes_network:'회사 서버에 연결하지 못했어요. 사내망이나 VPN을 확인해 주세요.',
  ghes_login_required:'회사 계정을 연결해 주세요.',ghes_session_expired:'로그인이 만료됐어요. 다시 연결해 주세요.',
  ghes_access_denied:'로그인을 승인하지 않았어요. 다시 연결할 수 있습니다.',ghes_device_expired:'로그인 코드가 만료됐어요. 다시 연결해 주세요.',
  ghes_device_unavailable:'앱의 Device Flow 설정을 확인해야 합니다.',ghes_app_configuration:'회사 GitHub App의 Client ID와 Device Flow 설정을 확인해 주세요.',
  ghes_device_disabled:'앱의 기기 코드 로그인이 꺼져 있어요. 관리자에게 Device Flow 활성화를 요청해 주세요.',
  ghes_login_endpoint_unavailable:'회사 로그인 경로를 찾지 못했어요. 관리자에게 앱 로그인 설정을 확인해 주세요.',
  ghes_identity_unavailable:'로그인 계정을 확인하지 못했어요. 회사 API 연결을 확인해 주세요.',
  ghes_resource_missing:'요청한 회사 서비스 경로를 찾지 못했어요.',
  ghes_sso_required:'사내 Github SSO 로그인을 마친 뒤 다시 확인해 주세요.',ghes_permission:'이 작업에 필요한 계정과 앱 권한을 확인해 주세요.',
  ghes_repository_missing:'저장소를 읽을 수 없어요. 접근 권한과 앱 설치 범위를 확인해 주세요.',ghes_repository_limit:'조회 범위를 넘었어요. 저장소 주소로 복제해 주세요.',
  ghes_git_unavailable:'Git 연결을 준비하지 못했어요. Git 확장과 설치 상태를 확인해 주세요.',ghes_rate_limited:'회사 서버의 요청 한도에 도달했어요. 잠시 후 다시 확인해 주세요.',
  ghes_storage:'계정을 안전하게 저장하지 못했어요. 다시 연결해 주세요.',ghes_session_changed:'계정이 바뀌었어요. 현재 계정으로 다시 확인해 주세요.',
  ghes_identity_changed:'로그인한 사용자가 바뀌었어요. 다시 연결해 주세요.',ghes_update_platform:'업데이트 설치는 Windows x64에서 지원합니다.',
  ghes_release_missing:'이 PC용 업데이트 파일을 찾지 못했어요.',ghes_release_changed:'릴리스가 바뀌었어요. 최신 버전을 다시 확인해 주세요.',
  ghes_checksum_mismatch:'업데이트 파일의 해시가 다릅니다. 설치하지 않았어요.',ghes_checksum_invalid:'업데이트 해시 파일을 확인하지 못했어요. 설치하지 않았어요.',
  ghes_package_invalid:'누비 업데이트 파일의 이름과 버전을 확인하지 못했어요. 설치하지 않았어요.',ghes_install_unconfirmed:'설치 결과를 먼저 확인해 주세요. 같은 설치를 반복하지 않습니다.',
  ghes_redirect_refused:'허용한 회사 서버 밖으로 연결되어 중단했어요. 회사 로그인을 연 뒤 다시 확인해 주세요.',ghes_browser_unavailable:'로그인 페이지를 열지 못했어요. 다시 열어 주세요.',
  // Codes that used to fall through to the bare '회사 계정을 확인하지 못했어요' (user report 2026-10-14): each says what to do.
  ghes_response_invalid:'회사 서버가 계정 정보 대신 다른 페이지를 보냈어요. 회사 로그인을 연 뒤 다시 확인해 주세요.',
  ghes_storage_read:'저장된 로그인을 읽지 못했어요. 잠시 뒤 자동으로 다시 확인해요. 계속되면 다시 로그인해 주세요.',
  ghes_login_failed:'로그인을 마치지 못했어요. 다시 로그인해 주세요.',ghes_identity_invalid:'계정 정보를 읽지 못했어요. 다시 로그인해 주세요.',
  ghes_device_invalid:'로그인 코드를 받지 못했어요. 다시 로그인해 주세요.',ghes_response_limit:'회사 서버 응답이 너무 커요. 잠시 후 다시 확인해 주세요.',
  ghes_cancelled:'확인이 중단됐어요. 연결을 다시 확인해 주세요.',ghes_url_invalid:'회사 서버 주소가 올바르지 않아요. 관리자에게 알려 주세요.',
  secret_unavailable:'이 PC의 보안 저장소를 쓰지 못했어요. 잠시 후 다시 로그인해 주세요.',
  browser_unavailable:'로그인 페이지를 열지 못했어요. 다시 열어 주세요.',update_installing:'업데이트를 설치하는 중이에요. 끝난 뒤 다시 확인해 주세요.',
};
// What the account panel shows for a failure code: a known code says what to do; anything else still says what to do
// and keeps the short code for a report.
export function ghesFailureText(code){
  const value=String(code||'');
  if(Object.hasOwn(ghesMessages,value))return ghesMessages[value];
  return `회사 계정을 확인하지 못했어요. 사내망 연결을 확인하고 '연결 다시 확인' 또는 다시 로그인해 주세요.${/^[a-z_]{1,64}$/.test(value)?` (${value})`:''}`;
}
// Failures where opening the company login page in the app can help.
export const ghesBrowserFailures=new Set(['ghes_sso_required','ghes_network','ghes_response_invalid','ghes_redirect_refused']);

const stages={device_code:'로그인 코드 발급',authorization:'로그인 승인 확인',identity:'계정 확인',repositories:'저장소 조회',request:'회사 서비스 연결'};
export function ghesDiagnosticLabel(value){
  if(!value||!Object.hasOwn(stages,value.stage)||!Number.isInteger(value.status)||value.status<100||value.status>599)return '';
  return `${stages[value.stage]} / HTTP ${value.status}`;
}
