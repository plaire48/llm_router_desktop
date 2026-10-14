// Explain the rejected operation without exposing tokens, account data or response bodies.
export function githubAccessMessage(url,method,status) {
  if(status!==403&&status!==404)return '';
  let path;try{path=new URL(url).pathname;}catch{return '';}
  const read=method==='GET',suffix=` (HTTP ${status})`;
  if(read&&/\/(?:user\/\d+|users\/[^/]+)$/.test(path))return '사용자 프로필을 조회할 수 없습니다. 계정 상태와 프로필 조회 권한을 확인하세요.'+suffix;
  if(path.endsWith('/audit-log'))return '팀 변경 이력을 조회할 수 없습니다. 조직 Owner와 App의 조직 Administration 읽기 권한이 필요합니다.'+suffix;
  if(/\/orgs\/[^/]+\/teams\/[^/]+\/repos\//.test(path))return '팀의 저장소 연결을 확인할 수 없습니다. 팀 연결과 App의 조직 Members, 저장소 Metadata 읽기 권한을 확인하세요.'+suffix;
  if(/\/orgs\/[^/]+\/teams\/[^/]+\/members(?:hips\/[^/]+)?$/.test(path)) {
    if(!read)return '팀 소속을 변경할 수 없습니다. 본인의 팀 관리 권한과 App의 조직 Members 쓰기 권한을 확인하세요.'+suffix;
    return status===404?'팀을 조회할 수 없습니다. 팀 주소의 이름과 조회 권한을 확인하세요.'+suffix:'팀 사용자를 조회할 수 없습니다. App의 조직 Members 읽기 권한과 팀 공개 범위를 확인하세요.'+suffix;
  }
  if(/\/orgs\/[^/]+\/(?:members|memberships\/[^/]+)$/.test(path))return '조직 사용자 정보를 조회할 수 없습니다. 조직 가입과 App의 조직 Members 읽기 권한을 확인하세요.'+suffix;
  if(/\/collaborators\/[^/]+\/permission$/.test(path))return '사용자의 저장소 권한을 확인할 수 없습니다. 저장소 접근 권한과 App의 Metadata 읽기 권한을 확인하세요.'+suffix;
  if(/\/assignees(?:\/[^/]+)?$/.test(path))return read&&status===404?'선택한 사용자를 문의 담당자로 배정할 수 없습니다. 해당 사용자의 저장소 접근 권한을 확인하세요.'+suffix:'문의 담당자 배정이 거부되었습니다. 문의 저장소 Write와 App의 Issues 읽기/쓰기 권한을 확인하세요.'+suffix;
  return '';
}
