# 누비 Workspace Beta 1.1.4

Office X(`runtime-src/claude-cli.mjs`)의 Windows Claude 설치 탐지·실행 어댑터를 Workspace에 반영했다. CLI 버전이 실행되는 후보를 확인하고 손상된 후보를 건너뛰며, 현재 사용자 PATH·npm 사용자 지정 설치·PowerShell 스크립트·별칭·프로필 함수 경로를 후속 실행에도 유지한다. npm 패키지는 선언된 bin을 직접 실행하며 CLI 인증 파일이나 토큰을 읽지 않는다. 동기 프로세스 시작 실패와 임시 폴더 오류는 Claude 전용 코드로 처리하고, 임시 폴더 정리 실패가 정상 연결 결과를 덮어쓰지 않게 했다.

메일 인증은 비밀번호 끝 공백을 보존하고 USER/PASS 거절과 표준 메일함 점유 응답을 구분한다. 메일 수정은 로컬 TLS 서버와 번들 worker를 포함한 17개 검사에서 통과했다. 사내 서버 인증 성공은 미검증이다. 상세는 MAIL-AUTH-2026-10-13.md다.

사용자 요청에 따라 이번 1.1.4의 추가 기능·모델·Windows 설치 회귀 검사를 생략하고 Windows x64 EXE를 패키징한다. Office X의 기존 검사는 참고이며 Workspace 1.1.4의 실행 성공 증거로 표시하지 않는다. 1.1.3의 설치/업데이트/제거 및 Agent 39/40 성적은 이전 버전의 기록이다. 이번 수정의 실제 회사 PC Claude 로그인과 POP3 인증은 재확인이 필요하다.

새 EXE와 SHA-256, 설치/사내 배포 안내와 Publish-NubiUpdate.ps1을 함께 제공한다. nuri 배포는 사내 PC에서 수행하고 latest/windows-x64.json은 스크립트로 갱신한다. 기존 1.1.3 EXE는 덮어쓰지 않는다.
