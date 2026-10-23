# 외부 창을 가져오기 전 내부 브라우저 유지

사용자 요청: 외부 브라우저를 실제로 가져오지 않은 상태에서도 기존 내부 브라우저가 정상적으로 보여야 한다. 외부 연동 설정을 끄는 것을 복구의 전제로 삼지 않는다.

## 수정

- `BrowserRouter.showInternal`은 연동 기본값과 확장 연결 여부만으로 외부 화면을 선택하지 않는다. 실제 창 가져오기 단계가 시작되기 전에는 내부 페이지 열기와 조작을 기존 내부 런타임으로 보낸다.
- `BrowserPane`은 내부 컴포넌트를 유지한다. 외부 연결 상태 조회 실패나 가져오기 실패가 기존 페이지를 제거하지 않는다. 실패 안내만 추가한다.
- `.nubi-browser-host`에 누락됐던 flex 및 최소 높이 계약을 연결했다. 수정 전 0이던 페이지 영역 높이가 같은 UI fixture에서 655px로 복구됐다.
- 주소 도구 모음의 연결 아이콘에서만 외부 연결 설정을 연다. 기존 본문 위에 별도의 외부 브라우저 버튼이나 설정 화면을 자동으로 끼우지 않는다.
- 전역 설정에 외부 연동 스위치를 추가했다. ON 상태여도 창을 가져오지 않았다면 내부 화면을 유지한다. OFF는 진행 중인 가져오기를 취소하고 원래 외부 창 복구를 확인한다. 복구 미확정을 OFF 성공으로 표시하지 않는다.
- 연동 설정 변경만으로 내부 native viewport를 숨기지 않는다. 기존 탭과 페이지 내 입력을 보존한다. 설정 저장 실패도 성공한 선택값으로 표시하지 않는다.
- 이미 관찰한 내부 탭의 조작은 다른 외부 창의 자동화 준비 상태에 막히지 않는다. 기존 인증 전용 탭 보호, 원래 외부 세션과 미확정 조작 재전송 금지는 유지한다.
- 에이전트의 내부 페이지 캡처도 같은 라우터를 사용한다. ON 설정만 보고 아직 가져오지 않은 외부 브라우저로 캡처를 보내지 않는다.

## 확인한 근거

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| `browser-mode`, `external-browser`, `browser-window-dock`, `workspace-capture`, `workspace-window-capture` | 56/56 | Node 회귀. 실제 OS 도킹 성공을 뜻하지 않음 |
| `check-browser-layout.mjs` | 6/6 | 실제 컴포넌트와 합성 호스트. ON/확장 연결/가져오기 실패/조회 실패/설정 변경/재진입 |
| `check-browser-fallback-electron.mjs` | 6/6 | macOS 실제 Electron과 로컬 합성 페이지. 초기 저장 설정은 external. 실제 worker/main 페이지 및 창 캡처 포함 |
| `design:check` | 통과 | 공통 색, 글꼴, 포털과 빌드 포함 검사 |

실제 Electron에서는 같은 내부 WebContents ID, `getVisible() === true`, 높이 617px인 native 영역, 페이지 제목과 입력값 재읽기를 확인했다. OFF와 ON을 거친 뒤에도 같은 페이지의 입력이 남았고 OS 외부 실행 호출은 0회였다. 같은 격리 프로필로 재시작했을 때 external 설정을 유지하면서 `showInternal === true`로 시작했다.

`check-electron-shell.mjs`의 외부 기본 화면 자동 표시 기대값도 이번 요청으로 교체했다. 통합 검사는 내부 탭 생성 이벤트를 기다리며, 메일 설정 진입은 두 버튼 중 상단 메뉴를 명시한다.

결과와 이미지는 `verification/browser-mode-2026-10-23/`에 있다. `electron-internal-content.png`는 실제 자식 WebContentsView 캡처다. `electron-agent-page.png`와 `electron-internal-composed.png`는 제품의 `captureWorkspace` 요청을 통해 저장했다. 후자는 제품 캡처기가 실제 부모 화면과 보이는 자식 페이지를 합성한 이미지다. `electron-internal-shell.png`와 `electron-internal-page.png`는 부모 화면 캡처이며 Electron API 특성상 자식 페이지 픽셀을 포함하지 않는다. 부모 캡처만으로 빈 페이지라고 판단하지 않는다.

추가 UI 검사에서는 실제 Electron shell 23항목, 스킬 등록 흐름 11항목, shared UI, forms UI, mail UI가 통과했다. `verify:identity` 전체 성공으로 보고하지 않는다. 마지막 `test:modals-ui`에서 별도 영역인 440px 스킬 탭의 폭 검사(`skill tabs fit at 440`, `check-modals.mjs:165`)가 실패했다. 이번 브라우저 수정의 대상 CSS는 해당 스킬 탭에 적용되지 않는다.

Windows의 실제 외부 창 가져오기, 사내 로그인, 설치판 실행은 이번 macOS 내부 화면 복구 검증의 범위에 포함되지 않는다.
