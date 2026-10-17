# 인앱 CDP 연결 시간초과 보완

## 확인한 범위

사용자 보고는 Mac 누비 Workspace 대화의 CDP 시간초과다. 사용자가 겪은 원본 페이지와 당시 로그는 확보하지 못했다. 정상 연결 fixture는 수정 전에도 통과했다. 아래는 소스에서 발견한 정체 경로와 이를 재현한 장애 주입 검증이며 실제 사용자 장애의 단일 원인을 확정한 것은 아니다.

## 변경

- Electron Target.getTargetInfo와 로컬 capability listener 준비를 각각 5초로 제한한다. 실패하면 debugger를 해제해 다음 연결을 막지 않는다.
- 공식 Playwright MCP의 context getter는 실제 도구 호출까지 지연된다. MCP 클라이언트 생성만으로 연결이 준비됐다고 캐시하던 방식을 바꾸고 CDP handshake를 먼저 완료한다.
- CDP handshake는 7초로 제한한다. 연결 준비 시간초과만 한 번 재시도하며 실제 클릭, 입력, 탐색은 재실행하지 않는다.
- 연결이 끊어지면 해당 클라이언트를 폐기한다. 늦게 도착한 해제 요청이 새 연결을 닫지 않도록 정확한 capability endpoint를 대조한다. endpoint는 진단 문구에 노출하지 않는다.
- 동일 탭의 초기 스냅샷도 실행 큐에 넣는다. 연결 대기 후 문서 바인딩과 사용자 취소를 다시 확인한다.
- 연결 준비 실패는 stage=connection, actionIssued=false와 단계별 오류 코드로 반환한다. 실제 도구가 실행된 뒤 실패한 결과와 구분한다.

공식 MCP context getter와 기존 탭 단위 capability 구조를 유지했다. 다른 브라우저로 전환하거나 앱 전체 디버깅 포트를 열지 않는다. 구현 판단에는 설치된 @playwright/mcp 및 playwright의 context factory 실제 소스를 확인했다.

## 검증

- Node 검사 총 18개 통과: 연결 준비 정체/정리, 지속 실패 1회 재시도, 승인/취소, 미확정 실행 재호출 차단, MCP 회귀.
- CDP WebSocket이 응답하지 않는 경우도 재현했다. 7초 제한 두 번 후 14,023ms에 종료되며 두 연결 모두 정리되고 입력 명령은 전송되지 않았다.
- 실행용 build:electron 통과.
- 실제 Mac Electron + worker IPC + 공식 MCP 검사 통과. 연결 강제 종료 후 다음 Target 조회를 의도적으로 멈췄으며 5,019ms에 복구했다. 복구된 클라이언트 재사용과 클릭 1회 실행도 확인했다.
- 같은 로컬 fixture: 열기 99ms, 화면 읽기 2ms, 입력 18ms, 클릭과 후속 읽기 187ms.
- 인증 탭 차단, 오래된 문서 거부, 기존 세션/다른 탭 보존, 캡처와 로컬 서버 재접속 통과.
- 로그: /tmp/nubi-cdp-final.log. 결과: verification/playwright-mcp-2026-10-15/result.json.

Windows, 사내 페이지, 실모델 전체 대화의 지연 검증은 포함하지 않는다.
