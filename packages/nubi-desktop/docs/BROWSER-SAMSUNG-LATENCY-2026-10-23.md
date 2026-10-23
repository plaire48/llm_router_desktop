# 외부 삼성브라우저와 작업 화면 응답

사용자는 Playwright 열기 실패와 폼/터미널 지연을 보고했고, 외부 삼성브라우저 설정을 확인해 자동으로 맞추도록 요청했다.

현재 접근 가능한 Mac의 `browser-preference.json`은 `mode:external`, `executable:null`이었다. 외부 모드였지만 실행 대상은 OS 기본 브라우저였으며 삼성브라우저 지정은 없었다. Windows 설치판의 설정 파일이나 실제 삼성브라우저에는 접근하지 않았다.

확인한 결함과 변경:

- `BrowserRouter`는 외부 모드에서도 모델 로그인용 내부 화면이 보이면 새 업무 페이지와 Playwright 요청을 내부로 보냈다. 새 페이지와 탭 조회는 선택한 모드를 따르고, 기존에 관찰한 내부 tabId와 인증 전용 열기는 원래 보호 경계를 유지한다.
- 연결되지 않은 외부 모드의 탭 조회는 예외로 끝났다. 이제 `connectionRequired`와 다음 동작을 반환하고 기존 연결 화면을 연다. 모델에 새 브라우저 실행, 같은 열기 반복이나 패키지 설치를 연결 복구로 사용하지 않도록 알린다. 실제 승인/연결 허용이나 탭 선택을 대신하지 않는다.
- Windows의 구형 설정은 한 번 `external/samsung`으로 저장한다. 다음에 사용자가 명시적으로 바꾼 모드는 보존한다. 삼성 실행 파일은 실행 중 프로세스, 설치 등록과 제한된 Samsung 디렉터리에서 제조사/제품 메타데이터를 대조한다. 설치된 삼성브라우저를 찾지 못하면 다른 브라우저로 넘어가지 않는다. OS 기본 브라우저, 쿠키, 프로필이나 정책은 변경하지 않는다.
- 같은 삼성 설치 조회는 30초 동안 재사용하고 실패는 캐시하지 않는다. 설정 화면의 상태 조회는 설치 프로세스 조회를 기다리지 않으며 Windows 대상 이름을 표시한다.
- 관찰해 둔 승인 폼을 열기 전에 서버 상태를 기다리던 대기를 제거했다. 제출의 질문/지문 검증은 기존 호스트가 계속 수행한다.
- 승인된 명령은 실제 `resultProcessId`를 받은 즉시 터미널 탭을 표시한다. 전체 프로젝트 갱신과 별도 poll을 먼저 기다리지 않는다. 자동 승인과 명령 수정도 같은 경로를 사용하며 새 실행을 만들지 않는다.
- 터미널 경로는 기존 프로젝트/realpath/심볼릭 링크 검증으로 확인하되 `includeEntries:false`로 폴더 목록을 열거하지 않는다. 일반 탐색기의 목록은 유지한다.
- 셸 목록 조회는 같은 환경의 동시 요청을 합치고 30초 동안 재사용한다. 실패/환경 변경/만료는 다시 조사한다. 표준 위치의 PowerShell 7을 확인한 경우 `where.exe`를 실행하지 않고, 대화형 터미널은 이미 확인한 실행 경로를 사용한다. 실행 오류나 미확정 명령을 재전송하지 않는다.

검증 범위:

- `verification/browser-terminal-final-unit-2026-10-23.log`: 연결 범위, 새 페이지 라우팅, 삼성 대상 저장/재읽기, 실패/중복 실행 방지, 승인/프로젝트/디렉터리/셸 검사.
- `scripts/check-realtime-actions.mjs`: Electron 렌더러에서 상태 조회 응답을 보류한 상태로 관찰된 폼을 열고, 실제 명령 영수증을 받은 뒤 갱신 응답 전 터미널을 표시한다. 1280/440px에서 초안/실패 복구/작성/명령 출력 회귀도 확인한다. 합성 호스트 응답이며 실제 Windows 지연 수치가 아니다.
- `scripts/check-command-terminal.mjs`: 빌드 Electron과 실제 로컬 PTY, 임시 프로젝트에서 셸 입력, 명령 승인, 같은 실행 재열기와 독립 파일 읽기, 대량 출력과 종료를 확인한다. 이번 결과는 `verification/command-terminal-2026-10-23/`로 분리한다.
- `scripts/check-direct-playwright.mjs`: 확장 없는 임시 Chromium에 실제 CDP로 연결하고 공식 Playwright MCP로 페이지 열기, snapshot과 관찰 ref 클릭을 실행한다. 클릭/열기 각 1회와 원본 탭 보존을 확인한다. 최초 프로브는 구형 `ref` 인자를 사용해 실패했으며 현재 도구 스키마의 `target`으로 검사 코드를 정정했다. 이 프로브 오류를 제품의 연결 실패로 세지 않는다.
- `scripts/check-direct-browser-shell.mjs`: 실제 빌드 화면의 연결 설정과 재진입을 확인한다. 삼성 이름 검사는 Windows 대상 상태를 주입한 렌더링 검사로서 실제 Windows 설치 조회와 구분한다.

최초 폼 지연 재현 로그는 `verification/decision-terminal-latency-before-2026-10-23.log`다. 상태 조회를 보류하면 이전 코드는 800ms 안에 폼을 열지 못했다. 수정 후 실측은 해당 UI 검사 결과에 보존한다. 소스 빌드와 로컬 실행 성공은 사용자 Windows의 삼성 연결 허용 UI, 사내 SSO, 실제 제공자, 설치/업데이트/재실행 성공이 아니다. PowerShell 검색 스크립트의 Windows 파서/실행도 아직 검증하지 않았다.

공식 문서는 [Playwright CDP 연결](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp), [기존 브라우저 연결](https://playwright.dev/mcp/configuration/browser-extension), [Samsung RemoteDebuggingAllowed](https://developer.samsung.com/browser/policy/remote-debugging-allowed.html)을 참고했다. Chromium 계열이라는 사실만으로 실제 삼성브라우저의 연결 허용 기능이나 정책을 지원/통과했다고 판단하지 않는다.

최종 결과는 관련 Node 89개 통과, 빌드 통과, 실제 빌드의 설정 화면 5개 통과, 실제 Mac PTY 8개 흐름 통과, 대화 렌더러 1280/440px 통과, 실제 외부 Chromium/공식 Playwright MCP 3개 통과다. JS 화면 실행 오류는 없었다. 보류한 상태 조회와 독립적으로 폼 열기 28/12ms, 영수증의 터미널 표시 2/2ms를 측정했다. 실제 Mac 셸의 첫 열기는 Playwright 클릭부터 PTY running 화면까지 839ms였고, 이는 Windows 수치나 처음 모델이 명령을 제안하기까지의 시간이 아니다. 실제 실행의 임시 파일은 한 줄 `once`로 독립 재읽었으며 실행 기록을 다시 열어도 늘어나지 않았다.

최종 네이티브 흐름 로그는 `verification/browser-terminal-execution-final-2026-10-23.log`, 설정 화면 결과는 `verification/direct-browser-shell-2026-10-23/report.json`이다. 최초 전체 네이티브 검사는 예전 폼 컨테이너 선택자 때문에 실패했다. 현재 활성 폼의 의미를 유지하는 `[data-decision-panel]:not([hidden])`로 검사 선택자를 고친 뒤 실제 승인/터미널/파일 흐름이 통과했다. `verification/browser-terminal-ui-old-selector-2026-10-23.log`에 이전 검사 오류를 보존한다. 기존 빌드의 Windows bash CJS `import.meta` 경고, Windows 파서 검사 제외와 Node 모듈 유형 경고는 이번 변경으로 해결했다고 표시하지 않는다.
