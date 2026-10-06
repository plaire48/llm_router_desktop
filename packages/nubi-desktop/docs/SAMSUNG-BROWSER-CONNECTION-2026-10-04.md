# 삼성 브라우저와 누비 연결 검토

최신 사용자 결정 2026-10-04: 웹페이지는 기존 누비 오른쪽 브라우저로 연다. 아래 삼성 브라우저 연결안은 참고 기록으로 보존하며 현재 제품에 추가하지 않는다.

기존 삼성 브라우저 탭의 로그인 상태를 유지하면서 누비의 대화와 연결하는 것이 목표다. 내장 브라우저를 삼성처럼 꾸미는 것과 실제 삼성 탭을 연결하는 것은 서로 다른 기능이다. 현재는 검토안이며 삼성 브라우저 연결을 구현하거나 실제 계정으로 확인한 상태가 아니다.

## 확인한 현재 구조

- 누비는 `electron-app/browser-host.cjs`의 Electron `WebContentsView`를 사용한다. 실행마다 별도의 메모리 session을 만들므로 삼성 브라우저의 쿠키와 localStorage를 공유하지 않는다.
- 기존 누비 확장은 `activeTab`, `scripting`, `debugger`, `offscreen`을 사용한다. `tabCapture`와 `nativeMessaging`은 현재 manifest에 없다. 화면 중계와 Desktop 연결은 추가 구현 및 권한 검토가 필요하다.
- 기존 Desktop 위키 페어링은 소스와 위키의 읽기 전용 연결이다. 브라우저 화면 또는 제어 채널로 그대로 사용하지 않는다. Beta A2A/Computer Use 비활성은 유지한다.

## 가능한 방식과 선택

| 방식 | 기존 로그인 상태 | 판단 |
| --- | --- | --- |
| 주소를 드래그해 내장 브라우저에서 열기 | 이어지지 않음 | 새 페이지를 여는 용도다. 기존 삼성 탭 연결로 표시하지 않는다. |
| 삼성 탭을 누비 확장으로 연결 | 원래 삼성 탭에서 유지 | 우선 검토 대상. 본문/선택 영역을 대화 근거로 연결하고 원래 탭으로 돌아간다. 삼성의 실제 API 호환성을 먼저 확인한다. |
| 삼성 탭 화면을 오른쪽에 실시간 중계 | 원래 삼성 탭에서 유지 | 다음 단계. 화면 중계만으로 마우스/키보드 조작은 구현되지 않는다. 입력 연결과 OS 인증 창은 별도 범위다. |
| Electron의 Chromium을 삼성 엔진으로 교체 | 자동 공유되지 않음 | 공개 삼성 문서에서 이 용도의 내장 SDK/API를 확인하지 못했다. 실행 파일이나 User-Agent 변경으로 대체하지 않는다. |
| Windows 창을 강제로 누비 안에 도킹 | 기존 프로세스에 남음 | 기본 제품 경로로 채택하지 않는다. SetParent는 존재하지만 cross-process DPI 처리와 삼성 창 수명/입력/팝업에 대한 별도 검증이 필요하며 공식 삼성 내장 계약이 아니다. |

## 제안 흐름

1. 삼성 브라우저의 누비 확장에서 현재 탭의 **누비에 연결**을 누른다. Desktop의 **열린 탭 연결** 또는 채팅의 탭 선택 폼에서도 같은 흐름으로 진입한다.
2. 오른쪽 공통 탭 줄에 삼성 연결 표시와 실제 제목을 둔다. 주소를 다시 여는 동작과 연결한 탭을 활성화하는 동작을 구분한다.
3. 기존 확장이 실제로 읽은 본문 또는 사용자가 고른 영역을 중앙 입력의 근거 칩으로 넣는다. 초안을 유지하고 자동 전송하지 않는다. 답변 출처에서 원래 탭과 읽은 위치로 돌아간다.
4. 실제 API 확인 후 탭 화면 중계를 추가한다. 원래 삼성 탭은 그대로 유지하며 화면만 Desktop에 전달한다. 보조 영역을 숨기면 중계를 쉬고 탭 연결 상태는 유지한다.
5. 드래그는 확장이 발급한 짧은 수명의 일회 연결 항목으로 지원하는 것을 검토한다. 일반 브라우저 창/탭 드래그가 앱에 URL만 전달하면 주소 열기로 처리하고 로그인 상태까지 연결됐다고 표시하지 않는다.

쿠키, 인증 토큰, localStorage 전체를 Desktop/LLM으로 복제하지 않는다. 실제 사이트 동작은 삼성의 기존 탭에서 실행하므로 그 탭의 로그인과 저장 상태를 계속 사용한다. Desktop 모델 인증과 사이트 로그인은 별도로 유지한다. 비밀번호, 패스키와 OS 인증은 원래 브라우저에서 사용자가 완료한다.

연결은 해당 탭/document/origin에 묶고 새 문서나 다른 origin으로 이동할 때 이전 근거의 유효성을 확인한다. 브라우저 탭 닫기와 Desktop 연결 해제를 구분한다. 연결 해제는 원래 탭과 로그인 상태를 삭제하지 않는다. 모델에 전달하는 것은 사용자가 요청한 페이지 근거이며 실행 권한이나 브라우저 저장소가 아니다.

## 구현 전 확인할 범위

현재 삼성 공식 Windows 릴리스 문서는 31.0.0.55(2026-09-17)를 안내한다. 사용자가 쓰는 실제 버전과 회사의 확장 정책은 별도 확인해야 한다. Chrome 문서의 API 설명은 삼성 동작의 증거가 아니다.

- 실제 Windows 삼성 브라우저에서 기존 배포 ZIP의 설치/재로드, `activeTab`/`scripting`과 선택 탭 읽기를 확인한다.
- `tabCapture`/offscreen과 Native Messaging의 존재, 권한, 전송 경로를 확인한다. 화면 스트림 ID를 다른 Electron origin에서 직접 사용하지 않고 로컬 중계 설계를 검증한다. Native Messaging 등록 경로를 Chrome의 레지스트리 경로라고 추정하지 않는다.
- SSO/다단계 로그인 후 같은 삼성 탭의 상태, 탭 이동/닫기/확장 worker 재시작을 확인한다. 토큰은 기록하거나 화면 근거로 수집하지 않는다.
- 화면 중계의 지연, 크기 변경, 초점, 한글 입력과 모달을 검증한다. 영상 표시를 상호작용 가능한 브라우저 완성으로 표시하지 않는다.

## 공식 근거

- [Samsung Windows release notes](https://developer.samsung.com/browser/release-note/windows-release-note.html): 실제 PC 제품 버전 확인.
- [Samsung ExtensionAllowedTypes](https://developer.samsung.com/browser/policy/extension-allowed-types.html): 확장 설치와 회사 정책이 적용됨. 개별 API 지원을 보장하는 문서는 아니다.
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [Session](https://www.electronjs.org/docs/latest/api/session): Electron이 생성한 페이지와 session의 내장 구조.
- [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), [screen capture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture): 사용자 실행 후 탭 화면 캡처, 탐색 수명과 스트림 소비 범위.
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): 확장과 native 앱의 메시지 연결 및 허용 origin 검증. 삼성 지원은 미확인.
- [Microsoft SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent): 다른 프로세스 창 연결에서 DPI awareness 차이에 따른 문제와 강제 reset이 문서화돼 있다.

현재 코드는 변경하지 않았다. 검토를 위해 브라우저 프로필을 읽거나 쿠키/토큰을 옮기지 않았고 원격 디버깅 포트나 새 브라우저 접근 권한을 활성화하지 않았다.
