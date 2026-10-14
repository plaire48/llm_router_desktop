# 기본 Playwright MCP와 인앱 연결

2026-10-15. 기본 MCP 목록에 Playwright가 등록된다. 별도 Node, Chrome, 확장 설치나 실행 중 npx 다운로드가 필요하지 않다. 사용자는 MCP 화면에서 연결을 끄고 다시 켤 수 있다. 기존 사용자 MCP 설정은 보존한다.

## 적용한 구조

- npm 레지스트리의 최신 `@playwright/mcp@0.0.83`을 정확한 버전으로 고정했다. 해당 공식 패키지가 의존하는 Playwright/Core는 `1.64.0-alpha-1790635538000`이다. 기존 검증용 Playwright 1.58.2를 대체하지 않는다.
- 공식 `createConnection(config, contextGetter)`와 MCP SDK의 in-memory transport를 사용한다. 임의의 자체 도구를 공식 MCP로 가장하지 않는다. `browser_tabs`, `browser_open`, `browser_capture`는 누비 탭 관리 어댑터이며 나머지 9개는 공식 도구다.
- Runtime worker → 기존 IPC → main의 BrowserHost → 지정한 WebContents 순서다. 단일 탭 debugger에 임의 경로를 갖는 loopback WebSocket을 연결한다. Origin이 있는 웹 클라이언트와 두 번째 연결은 거부한다. 앱 전체 디버깅 포트는 열지 않는다.
- 탭별 연결을 재사용한다. 열려 있는 웹 탭의 세션을 그대로 사용하며 쿠키를 복사하지 않는다. 별도 인증/회사 로그인/전용 세션 탭과 인증 callback 주소는 제외한다.
- 클릭과 입력은 기존 MCP HITL을 따른다. 탭 ID와 문서 ID를 승인 인자에 포함한다. 새로고침/이동 뒤 오래된 문서 ID를 거부한다. 읽기만 승인 없이 실행한다. 오류가 난 쓰기는 실행 여부 미확정으로 반환하고 상태 확인 없이 재전송하지 않도록 한다.
- 임의 JavaScript, storage/cookie, 네트워크 로그, 파일 업로드, 임의 파일 저장, 페이지 등록 WebMCP는 노출하지 않는다. Console/exception 이벤트도 모델이나 파일에 넘기지 않는다. MCP의 출력 디렉터리는 임시 폴더이며 정상 해제 시 삭제한다.
- 카탈로그 연결을 첫 채팅 전에 준비한다. 느린 외부 MCP 연결 때문에 첫 채팅이 무제한 지연되지 않도록 정의 대기는 최대 1.5초로 제한한다. 연결이 아직 안 된 외부 서버 도구는 이후 턴에서 사용 가능하다.

## 검증

- `node --test tests/mcp.test.mjs tests/mcp-config.test.mjs tests/playwright-mcp.test.mjs tests/approval-policy.test.mjs tests/project-services.test.mjs`
- `Electron scripts/check-in-app-playwright.cjs`: 실제 Electron WebContentsView, 별도 worker IPC와 공식 MCP로 열기 → 읽기 → 입력 → 클릭 → 결과 읽기 → 다른 탭 보호 → 이동 → 오래된 문서 거부. 로그인 탭 차단도 확인했다.
- `npm run compile`, `node scripts/build-electron.mjs`: 소스와 Electron 번들 검증. Windows 설치 파일 생성은 하지 않았다.
- 결과: `verification/playwright-mcp-2026-10-15/result.json`, `unit.log`, `live.log`, `in-app.png`.

최종 지연 수치는 JSON의 실행 결과를 따른다. 로컬 시험 페이지의 도구 지연이며 LLM의 도구 선택/응답 시간, 인터넷/사내 서버, 실제 로그인, Windows 설치판 품질을 포함하지 않는다. 클릭의 약 0.5초에는 공식 MCP의 실행 후 페이지 안정화가 포함된다. 이를 제거해 빠르게 보이게 만들지 않았다.

## 참고 및 선택 근거

- https://github.com/microsoft/playwright-mcp — 공식 MCP의 context getter와 구조화 스냅샷을 채택했다. 별도 브라우저를 띄우는 기본 CLI 실행은 같은 탭/세션 요구와 시작 지연 때문에 선택하지 않았다.
- 기존 누비 브라우저의 관찰/승인/미확정 실행 계약을 유지했다. 앱 전체 CDP 공개와 일반 evaluate/run_code 도구는 도입하지 않았다.
- 최신 확인: `npm view @playwright/mcp version dependencies engines --json`. 실행 때마다 latest를 받지 않고 검증한 배포 버전에 고정한다.

## 최종 결과

관련 회귀 검사 19개 통과. compile과 Electron 번들 성공. 실제 Electron + worker IPC에서 세션 재사용, 재연결, 다른 탭 보존, 인증 탭 차단과 문서 변경 차단이 통과했다. 최종 단일 실행 도구 지연(ms): connect=171, open=3, snapshotCold=60, type=16, click=557, snapshotWarm=7, navigate=21. 동일 과제의 실모델 성능 평가나 Windows 검증으로 해석하지 않는다.

## 캡처 후속 반영

`/capture`는 Workspace 화면 영역, `/capture_web`은 인앱 웹페이지 미리보기에서 영역을 선택해 첨부한다. 에이전트는 `inspect_workspace_page`, `inspect_workspace_window`, MCP `browser_capture`로 clip(x/y/width/height, CSS px)과 maxWidth(128–2400px)를 지정한다. 호스트가 먼저 잘라낸 뒤 축소하며 디스크 파일 대신 PNG를 반환한다.

MCP 이미지와 수동 첨부 모두 같은 `analyzeCapture`를 거친다. 현재 AI Pro 카탈로그에서 이미지 지원이 확인된 모델(기존 Qwen 우선 정책)을 선택하며 GLM을 멀티모달이라고 가정하지 않는다. 요청별 visionModel만 지정하고 설정을 변경하지 않는다. 원래 모델에는 짧은 분석 결과만 전달한다. 오류/취소 시에도 선택 모델은 그대로이며 지원 모델이 없으면 미확인으로 반환한다.

검증: 실제 Electron + worker IPC에서 450×240 CSS 영역을 256px 폭으로 캡처해 PNG 크기를 확인했고 해당 호출은 9ms였다. UI 420/1280px에서 드래그/실제 crop/Esc 확인, 관련 자동 검사 15개 통과. GLM → 이미지 모델 → GLM 연결은 모의 전송 검사이며 사내 AI Pro 실계정 성공으로 간주하지 않는다. 산출물은 `verification/capture-tools-2026-10-15/`에 있다.
