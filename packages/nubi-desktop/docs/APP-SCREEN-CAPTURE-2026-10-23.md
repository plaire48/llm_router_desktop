# 직접 캡처와 에이전트 자동 캡처

사용자 확인 2026-10-23: 기존 직접 캡처를 유지하고, 에이전트가 UIA로 대상 창과 컨트롤을 찾아 자동 캡처하는 경로를 함께 제공한다.

## 사용자 흐름

- 직접 캡처: 기존 입력창의 화면 캡처 버튼 또는 `/capture`, `/capture_web`에서 영역을 선택하고 요청에 첨부한다. 취소해도 작성 중인 문장을 유지한다.
- 자동 캡처: “검토 앱의 오류 내용을 캡처해 확인해 줘”처럼 요청한다. 에이전트가 앱 이름으로 창을 찾고, 필요하면 UIA 컨트롤 이름으로 영역을 찾는다. 대상이 모호할 때만 기존 대화 질문으로 확인한다.
- 자동 캡처의 이미지도 기존 실행 기록과 답변의 썸네일, 공통 확대 창에서 확인한다. 미리보기를 다시 열어도 새 캡처를 수행하지 않는다.

자동 외부 앱 캡처 도구는 Windows에서만 제공한다. macOS의 기존 Workspace와 웹 캡처는 유지한다. 이 변경은 앞선 화면 복귀 검토의 5개 항목을 수정한 작업은 아니다.

## 구현과 재사용

`AppScreenCapture`는 한 에이전트 실행 안에서만 창과 컨트롤 ID를 보관한다.

1. `find_app_capture_targets(windowQuery, controlQuery?)`는 제목 또는 프로세스 이름에 해당 문자열이 들어 있는 보이는 창을 최대 10개 반환한다. `controlQuery`가 있으면 해당 창의 UIA 이름과 AutomationId에서 최대 20개 컨트롤을 찾는다. 이 단계는 이미지나 입력 값을 읽지 않는다.
2. `inspect_app_window(windowId, elementId?, question, maxWidth?)`는 현재 실행에서 발급한 ID만 허용한다. 컨트롤을 선택한 경우 해당 영역을 잘라 크기를 줄인 PNG를 반환한다.
3. 기존 `analyzeCapture`와 현재 제공자의 이미지 모델 경로를 사용한다. 기본 모델 선택을 바꾸지 않는다. 이미지 모델이 없으면 실제 분석 성공으로 표시하지 않는다.
4. 기존 `storeAgentCapture`에 정확한 PNG를 별도 저장하고 대화에는 ID, 크기, 영역과 화면 이름만 남긴다. 동일 이미지가 답변과 실행 이력에 연결된다.

네이티브 진입은 기존 Knox UIA 읽기와 같은 Windows PowerShell STA, UTF-8 표준 입출력 방식을 사용한다. 별도 Python, 외부 UIA 서버나 새 모델 프레임워크를 설치하지 않는다. 메일 본문 해석기는 재사용하지 않는다. 이 경로는 UIA 메타데이터와 이미지 캡처만 필요하기 때문이다.

이미지는 [Microsoft PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow)로 대상 창의 렌더링을 요청한다. 공식 문서상 동기 호출이므로 앱의 UI 스레드에서 실행하지 않고 최대 15초인 자식 프로세스에서 실행한다. 지원하지 않는 앱이나 빈 이미지는 직접 캡처로 복구한다. 전체 바탕화면 캡처나 다른 앱의 픽셀을 가져오는 폴백은 없다.

## 유지하는 경계

- `DESKTOP_FEATURES.computerUse`는 `false`를 유지한다. 클릭, 키 입력, 앱 실행, 포커스 이동과 winapp 드라이버를 활성화하지 않는다.
- 누비 worker와 부모 Electron 프로세스의 창은 네이티브 검색과 캡처에서 제외한다. 누비 자체 화면은 기존 Workspace 캡처 경로를 통해 로그인 화면 보호를 유지한다.
- HWND, PID와 시작 시각, 창 제목, 컨트롤 runtime ID와 이름, 종류, 위치를 대조한다. ID는 2분 후 만료되며 다른 실행으로 복원하지 않는다. 오래된 ID와 바뀐 대상은 다시 찾는다.
- UIA가 비밀번호로 표시한 컨트롤은 검색 결과에서 제외하고 해당 이미지 영역을 가린다. 캡처 전후 비밀번호 컨트롤 위치와 선택 대상이 달라지면 이미지를 반환하지 않는다. UIA가 제공하지 않는 사용자 정의 화면의 민감 정보까지 탐지한다고 주장하지 않는다.
- UIA 탐색은 최대 2,500개 컨트롤이며 보이는 ControlView의 부분 관측이다. 값과 TextPattern 본문은 읽지 않는다. 출력은 최대 너비 2,400px, 800만 픽셀, PNG 8MiB로 제한한다.
- 취소 후 늦게 온 응답과 손상된 PNG를 반환하지 않는다. 캡처는 읽은 화면의 근거이며 저장, 전송이나 업무 완료의 증거가 아니다.

## 검증 기록

로컬 계약 및 관련 회귀 검사 32개 통과. 합성 UIA 응답을 사용한 실제 Pi 도구 루프에서 컴퓨터 조작이 꺼진 상태의 자동 캡처, 이미지 분석, 답변과 이력에 동일 PNG 연결을 확인했다. 취소, 만료, 다른 창의 ID, 대상 변경, 잘못된 이미지, 누비 자체 창 제외와 수동 캡처 도구 보존도 확인했다.

실제 macOS Electron에서는 다음 6개 경로를 확인했다. 자동 캡처의 외부 창 응답과 분석 모델은 합성이며 Windows UIA를 실행한 결과가 아니다.

- 대화에서 자동 캡처의 정확한 PNG 표시
- 공통 확대 보기 열기와 닫기
- 직접 캡처 취소 시 입력 초안 유지
- 직접 영역 캡처와 기존 자동 캡처를 같은 대화에 표시
- 실제 700px 창에서 표시
- 새로고침 뒤 자동 캡처 이미지 보존

결과와 공통 디자인 검사 캡처는 `verification/app-screen-capture-2026-10-23/electron/`에 있다. 최종 Electron 빌드와 PowerShell 구문 분석, C# 상호운용 선언 컴파일 및 좌표 대조 검사는 로컬에서 통과했다.

**남은 검증:** 실제 Windows UIA, PrintWindow, WPF 앱과 사내 앱, 여러 모니터와 DPI, 실제 모델의 대상 선택 품질. macOS에서 네이티브 실행은 `app_capture_windows`로 거부되는 것만 확인했다. Windows 설치판이나 사내 앱 사용 완료로 표시하지 않는다.

```sh
node --test tests/app-screen-capture.test.mjs tests/workspace-capture.test.mjs tests/captures.test.mjs tests/capture-analysis.test.mjs tests/capture-cache.test.mjs tests/capture-surface.test.mjs tests/agent-capabilities.test.mjs tests/tool-feedback.test.mjs
npm run build:electron
node scripts/check-electron-app-capture.mjs
```

Windows에서 준비한 자기 소유 WPF 시험 창의 네이티브 검증:

```sh
node scripts/check-app-screen-capture.mjs
```

Windows 시험은 이 macOS 작업에서 실행하지 않았다. 스크립트는 창과 UIA 영역 캡처, 비밀번호 마스킹 메타데이터, 닫힌 창 거부를 확인하도록 준비했다.
