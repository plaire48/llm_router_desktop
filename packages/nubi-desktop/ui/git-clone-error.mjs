const guidance={
 clone_gateway:['저장소 서버 또는 중간 프록시 오류','잠시 후 다시 시도해 주세요. 반복되면 사내 Git 관리자에게 HTTP 상태 코드를 전달해 주세요.'],
 clone_server:['저장소 서버가 요청을 처리하지 못했어요','잠시 후 다시 시도해 주세요. 반복되면 Git 서버 상태를 확인해 주세요.'],
 clone_login_required:['사내 GitHub 로그인이 필요해요','상단 로그인에서 사내 GitHub에 연결한 뒤 다시 가져와 주세요.'],
 clone_auth:['Git 인증 또는 접근 권한을 확인해 주세요','로그인 상태와 해당 저장소의 읽기 권한을 확인해 주세요.'],
 clone_repository_unavailable:['저장소를 찾거나 접근할 수 없어요','저장소 주소와 읽기 권한을 확인해 주세요. 비공개 저장소도 같은 오류가 날 수 있어요.'],
 clone_tls:['Git 서버 인증서를 확인하지 못했어요','회사 인증서와 PC 시간을 확인해 주세요. 인증서 검증은 유지됩니다.'],
 clone_proxy:['Git 프록시에 연결하지 못했어요','사내망 또는 VPN 연결과 프록시 인증 설정을 확인해 주세요.'],
 clone_dns:['Git 서버 주소를 찾지 못했어요','저장소 주소와 사내망 또는 VPN 연결을 확인해 주세요.'],
 clone_network:['Git 서버 연결이 끊겼어요','사내망 또는 VPN 연결을 확인한 뒤 다시 시도해 주세요.'],
 clone_timeout:['Git 서버 응답 시간이 초과됐어요','네트워크 상태를 확인한 뒤 다시 시도해 주세요.'],
 clone_target_exists:['같은 이름의 폴더가 이미 있어요','기존 프로젝트라면 폴더 열기를 사용하거나 다른 저장 위치를 선택해 주세요.'],
 clone_destination_missing:['저장 위치를 찾지 못했어요','사용할 수 있는 폴더를 다시 선택해 주세요.'],
 clone_permission:['저장 폴더에 쓸 수 없어요','쓰기 권한이 있는 다른 폴더를 선택해 주세요.'],
 clone_disk_full:['저장 공간이 부족해요','여유 공간을 확보하거나 다른 드라이브를 선택해 주세요.'],
 clone_path_long:['파일 경로가 너무 길어요','경로가 짧은 폴더를 저장 위치로 선택해 주세요.'],
 clone_path_invalid:['이 PC에서 만들 수 없는 파일 이름이 있어요','저장소 파일 이름이 Windows에서 사용 가능한지 확인해 주세요.'],
 clone_ssh_key:['SSH 키 인증을 받지 못했어요','이 PC의 SSH 키 등록을 확인하거나 HTTPS 주소를 사용해 주세요.'],
 clone_ssh_host:['SSH 서버 신원을 확인하지 못했어요','서버 키를 관리자에게 확인한 뒤 SSH 신뢰 설정을 점검해 주세요.'],
 clone_ssh_unavailable:['SSH 실행기를 찾지 못했어요','HTTPS 주소를 사용하거나 SSH 실행 환경을 확인해 주세요.'],
 clone_checkout:['자료는 받았지만 파일 배치를 마치지 못했어요','받은 파일은 보존합니다. 저장 권한과 경로 길이를 확인해 주세요.'],
 clone_transfer:['저장소 전송을 마치지 못했어요','네트워크와 추가 파일 서비스 상태를 확인한 뒤 다시 시도해 주세요.'],
 clone_git_missing:['Git 실행기를 찾지 못했어요','최신 누비 설치 파일로 내장 Git을 복구해 주세요.'],
 clone_git_blocked:['Git 실행이 차단됐어요','앱 실행 권한과 보안 프로그램의 차단 내역을 확인해 주세요.'],
 clone_auth_helper:['Git 인증 준비를 마치지 못했어요','앱 설치 경로와 임시 폴더의 접근 권한을 확인해 주세요.'],
 clone_interrupted:['Git 가져오기가 중단됐어요','로그인 상태와 앱 실행 환경을 확인한 뒤 다시 시도해 주세요.'],
 remote_invalid:['저장소 주소를 확인해 주세요','HTTPS 또는 SSH 저장소 주소를 입력해 주세요.'],
 clone_failed:['저장소 가져오기를 마치지 못했어요','오류 상세의 단계와 종료 코드를 확인해 주세요. 원인이 확인되지 않아 자동으로 다시 실행하지 않았어요.'],
};
export const cloneStageLabels={destination:'저장 위치 준비',connecting:'저장소 연결',enumerating:'자료 확인',counting:'자료 확인',compressing:'전송 준비',receiving:'자료 받기',resolving:'변경 계산',checkout:'파일 배치',filtering:'추가 파일 받기',opening:'프로젝트 열기'};
export function gitCloneError(error){
 const code=Object.hasOwn(guidance,error?.message)?error.message:'clone_failed',details=error?.cloneFailure;
 const [title,action]=guidance[code];const status=Number.isInteger(details?.httpStatus)&&details.httpStatus>=400&&details.httpStatus<=599?details.httpStatus:null;
 return {code,title:title+(status?` (${status})`:''),action,stage:cloneStageLabels[details?.stage]||'저장소 가져오기',retained:details?.retained===true,diagnostic:[`오류 코드: ${code}`,`단계: ${cloneStageLabels[details?.stage]||'저장소 가져오기'}`,status?`HTTP: ${status}`:null,Number.isInteger(details?.exitCode)?`Git 종료 코드: ${details.exitCode}`:null].filter(Boolean).join('\n')};
}
export const gitCloneErrors=Object.fromEntries(Object.entries(guidance).map(([code,[title,action]])=>[code,`${title}. ${action}`]));
