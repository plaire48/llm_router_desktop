// Shared by initial generation and retained updates. These are model request
// failures, so a CLI request timeout must not be described as a login timeout.
export const wikiModelErrors={
  claude_login_required:'Claude 인증을 확인하지 못했어요. 다시 로그인한 뒤 이어서 시도해 주세요.',
  claude_cli_missing:'Claude Code 실행 파일을 찾지 못했어요. 모델 연결에서 설치 경로를 확인해 주세요.',
  claude_cli_unavailable:'Claude Code를 실행할 수 없어요. 설치 경로와 실행 권한을 확인해 주세요.',
  claude_cli_update:'Claude Code 업데이트가 필요해요. 업데이트한 뒤 모델을 다시 연결해 주세요.',
  claude_cli_failed:'Claude Code 요청을 마치지 못했어요. 모델 연결을 확인한 뒤 이어서 시도해 주세요.',
  claude_cli_timeout:'Claude 응답 대기 시간이 초과됐어요. 연결을 확인한 뒤 이어서 시도해 주세요.',
  claude_response_invalid:'Claude 응답 형식을 확인하지 못했어요. 보관한 작업에서 이어서 시도해 주세요.',
  invalid_model:'선택한 모델을 사용할 수 없어요. 모델 목록을 새로고침한 뒤 다시 선택해 주세요.',
  wiki_failed:'위키 갱신을 마치지 못했어요. 중단 단계와 오류 코드를 확인해 주세요.',
};
