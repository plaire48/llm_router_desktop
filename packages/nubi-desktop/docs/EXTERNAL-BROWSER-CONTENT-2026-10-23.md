# 외부 브라우저 콘텐츠 연결

2026-10-23 사용자 요청에 따라 오른쪽에는 외부 브라우저의 **실제 탭 콘텐츠**를 표시한다. 브라우저 창 메뉴/주소 표시줄을 덮어 붙이는 방식은 기본 연결에서 사용하지 않는다. 로그인 쿠키를 추출하거나 Electron으로 복사하지 않는다.

## 사용자 흐름

1. 처음 한 번 Chromium 연결 확장을 설치한다. 현재는 로컬 확장 폴더를 불러오는 개발 설치이며 스토어 배포는 하지 않았다.
2. **브라우저 연결**을 누르면 기본/선택한 브라우저에 일회용 로컬 연결 페이지가 열린다. 확장이 최근 사용한 업무 탭을 연결한 뒤 자기 연결 페이지를 닫는다. 연결 코드 복사는 기본 화면에서 제거했다.
3. Windows에서는 **브라우저 창 제목 표시줄 전체를 누비 오른쪽으로 끌어놓는 흐름**도 등록했다. 기존 WinEvent 감지와 측정된 드롭 영역을 재사용한다. 실제 드롭 후보의 HWND/PID/프로세스 시작 식별과 임시 확장 페이지 nonce를 대조한 뒤 그 창의 탭을 연결한다. 창을 이동·재부모화·네이티브 오버레이로 붙이지 않는다. 다른 프로필/창을 입증하지 못하면 연결을 거절한다.
4. 클릭, 휠, 키보드와 우클릭은 같은 원본 탭으로 전달한다. 기존 Playwright 경로도 그 탭을 사용한다. 화면을 숨기거나 모달을 열면 중계와 입력을 멈추며 원본 탭은 닫지 않는다.

확장은 연결할 브라우저 프로필에 설치되어 있어야 한다. 창 드래그는 Windows 전용이다. Chrome/Edge 계열을 대상으로 구현했으며 Firefox 지원을 주장하지 않는다. Windows에서 드롭한 브라우저 실행 파일은 native helper가 확인한 경로를 사용하고, 프로필을 추측하거나 프로필 파일을 복사하지 않는다. 기존 helper가 실행 파일 정보를 주지 않으면 설정된 실행 경로를 사용하며 정확한 창 증명은 계속 필수다.

## 연결과 데이터 경계

- 일회용 256비트 토큰 두 개를 분리한다. 로컬 HTTP 연결 페이지와 기존 WebSocket pairing은 다른 토큰이며 5분 뒤 만료된다. WebSocket upgrade에서 pairing을 한 번만 소비한다.
- HTTP는 `127.0.0.1`의 임의 포트에만 바인딩한다. 정확한 Host/경로, POST Origin, 짧은 요청 크기를 검사한다. `no-store`, `no-referrer`, CSP를 제공하며 CORS를 열지 않는다.
- 확장의 정적 content script는 `/nubi-browser-connect/*` 로컬 경로에만 주입된다. background는 자기 확장 ID, 최상위 프레임, 정확한 브리지 URL과 탭 ID를 확인한다. 임시 증명 탭을 사용자가 실제 페이지로 탐색한 경우 닫지 않는다. 창 확인 중 사용자가 다른 탭을 선택하면 취소한다.
- Windows 창 증명에는 해당 프로필의 정상 창들에 임시 확장 탭이 잠깐 표시된다. 임시 탭은 연결/취소/만료 때 정리된다. 잘못된 창이나 다른 계정으로 자동 폴백하지 않는다.
- 프레임은 별도 renderer 전용 `browserMirror` 포트와 `nubi:browser-mirror` 이벤트로만 전달한다. worker/model, 일반 호스트 이벤트, 대화 기록에 프레임을 넣지 않는다. 표시 뒤 ACK하는 한 프레임 backpressure를 사용한다.
- 스트림, 탭, 문서 ID, 연결 generation을 고정한다. 탐색/해제/교체 뒤 이전 입력을 재생하지 않는다. 사람의 입력 중에는 자동화 입력이 거절된다.
- SSO 화면은 사람에게 표시할 수 있지만 기존 자동화 보호를 유지한다. 인증 프레임이 보이는 동안 앱 전체 캡처도 차단하고 캡처 중 인증 프레임이 나타난 경우 결과를 거절한다.
- 사이드바 CSS 크기를 원본 탭 viewport에 적용해 글자를 축소하지 않는다. 중계 종료에서 emulation override를 해제한다. Chromium의 debugger 안내 막대가 원본 창의 사용 가능한 높이를 줄일 수 있다. 원본 창의 위치/외곽 크기는 변경하지 않는다.

공식 API 참고: [content scripts와 isolated world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [loopback match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).

## 20종 브랜드 모션 적용

[기존 20종 기준](BRAND-MOTION-GUIDE.md)을 재사용한다. 이번 흐름에서는 #4 Magnetic Window Snapping으로 실제 드롭 대상 안내, #14 Spring Squish로 버튼 누름, #20 Hourglass Hold & Flip으로 실제 연결 대기, #6 Seamless Crossfade로 첫 콘텐츠 표시를 연결했다. 설정의 좁은 모달은 기존 #8 공통 시트가 소유한다. 모든 20종을 같은 화면에서 동시에 실행하지 않는다.

새 시간/완화 토큰이나 반복 모션을 추가하지 않았다. 중앙 `workspace-motion.css`의 280/180/120ms와 공통 스프링을 사용하고, 동작 줄이기에서는 정적 상태 또는 120ms 페이드로 전환한다. 첫 실제 프레임이 표시되어야 준비 상태가 되며 애니메이션 종료를 성공으로 간주하지 않는다.

## 검증과 남은 범위

- 관련 Node 회귀 **82/82 통과**: 기존 확장/브라우저 모드/문서 고정/프레임/인증/창 감지 계약과 새 버튼/증명/Origin/탭 전환 취소를 포함한다.
- 실제 임시 Chromium 확장 + 실제 Electron 컴포넌트/host/port + 합성 HttpOnly 세션 포털에서 **14개 흐름 통과**. 코드 복사 없는 버튼 연결, 원본 클릭 5회, 영문/한글 입력, 합성 composition 중복 방지, 사이트/기본 우클릭 메뉴, 복사, 휠, 숨김/복귀, 크기 변경, 모달, 동작 줄이기, 인증 화면 캡처/자동화 차단, 탐색 뒤 세션, 브라우저 종료를 확인했다. 테스트 clipboard는 메모리 adapter다.
- `npm run design:check`, `check-design-rules.mjs`, `npm run build:electron` 통과. macOS에서 Windows Office parser는 PowerShell 부재로 건너뛰며 기존 Windows Bash CJS/import.meta 경고는 남아 있다.
- `scripts/check-browser-content-shell.mjs`에서 빌드된 전체 앱의 별도 임시 프로젝트/저장소로 **5개 확인 통과**. 실제 오른쪽 연결 화면, 버튼, 코드 복사/창 메뉴 부재, 콘텐츠 포트 등록과 페이지 오류 부재를 확인했다. 최종 결과는 아래 full-shell-report에 기록했다.

증거: `verification/external-browser-content-2026-10-23/report.json`, `connection-motion.gif`, `connection-electron.png`, `content-electron.png`, `content-narrow-electron.png`, `full-shell-report.json`. GIF는 실제 Electron 프레임 기록이며 Windows 창 드래그 영상이 아니다. 초기 실패는 fixture의 누락된 공통 CSS/아이콘, debugger 막대가 바꾸는 원본 높이 가정, 탐색 전 프레임을 준비 상태로 읽던 QA 대기 조건을 수정했다. `failure*` 파일은 그 중간 진단이며 최종 통과 증거와 구분한다.

**아직 확인하지 않은 것:** 실제 Windows 창 드래그/새 native helper 빌드, Samsung Browser, 사내 SSO와 메일 API, 물리 한글 IME/파일 선택창, 설치판 업데이트/재실행, 실모델 전체 업무. 로컬 Chrome/Electron이나 합성 SSO 경로의 통과를 이 항목들의 통과로 표시하지 않는다.

## 통합 소유권

전용 `createExternalBrowserContentPort`가 main의 trusted renderer route, 프레임 이벤트, 앱 캡처 보호와 종료 정리를 제공한다. 공통 main 통합은 별도 작업에서 적용했고 이번 후속 작업에서 main을 직접 수정하지 않았다. `browser.quickConnect`를 통해 기존 BrowserWindowDock의 OS 감지는 콘텐츠 연결로 이어진다. native overlay 구현은 이전 사용자의 분리/복구 계약을 위해 보존했지만 제품 포트가 설치된 기본 경로는 사용하지 않는다.
