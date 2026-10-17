# 메일 첨부와 실제 Office의 한 작업 흐름

상태: 현재 소스와 Microsoft/Electron 문서를 확인한 적용 명세. 제품 실행 코드와 Windows Office 연결은 아직 변경하지 않았다. 사용자는 후속 답변에서 **누비 창 안에 실제 Office 화면을 넣기**를 선택했다. 나란히 열기는 선택한 최종 UX를 대체하지 않는다. 위키 오류 수정은 별도 요청으로 재개했으며 Office 구현과 분리한다.

## 원하는 동작

Office 첨부를 클릭하면 실제 Excel, Word, PowerPoint 문서를 연다. 누비의 메일 목록, 선택, 스크롤과 중앙 화면을 보존한다. AI 질문은 별도 명시적 동작이며, 파일 열기를 모델 전송으로 취급하지 않는다.

첨부 행은 파일명과 앱 아이콘, 짧은 연결 상태, AI 질문, 다운로드로 구성한다. 내부 파서 미리보기를 실제 Office로 표시하지 않는다. Office를 찾지 못했거나 원본을 보관하지 않은 경우 이유를 표시하고, 다른 문서나 추출 텍스트를 대신 열지 않는다.

선택한 시각 통합 방식은 누비 안의 실제 Office 화면이다. 우선 Excel의 Windows native 창 결합 PoC에서 직접 편집과 탈착 복원을 확인한다. 문서 소유권과 AI 계약은 아래처럼 유지한다.

## 현재 경로와 재사용 지점

- `packages/nubi-desktop/ui/MailReader.jsx`의 첨부 클릭은 `onDocument`를 호출한다. 같은 버튼에서 읽기와 표시가 묶여 있다.
- `electron-app/renderer.jsx`의 `openMailDocument`는 `mailDocument`로 추출한 본문을 받아 `document` 보조 영역을 연다. 실제 Office를 여는 동작은 아니다.
- `ui/MailHistory.jsx`는 첨부 본문 검색 결과의 메일을 선택할 때도 자동으로 `onDocument`를 호출한다. 메일 선택만으로 원치 않는 문서 열기까지 이어지는 경로를 분리해야 한다.
- `runtime/mail.mjs`의 `download`는 메일 원문 해시와 첨부 바이트 해시를 검증한다. native 열기에도 이 검증된 원본 공급 계약을 재사용한다. renderer가 보낸 임의 경로나 실행 파일을 받지 않는다.
- `runtime/office-document.mjs`는 읽기용 사본을 열고 닫는 백그라운드 추출기다. 사용자가 편집하는 실제 문서 세션으로 재사용하지 않는다.
- `runtime/native-office-host.mjs`에는 작업/프로젝트/문서/Office 세션에 묶인 연결, 관찰, 승인, 수정과 readback 계약이 있다. `registerNativeOfficeConnection`에 실제 Windows 연결을 공급하는 제품 producer는 현재 확인되지 않았다.
- `packages/nubi-office/native/Nubi.Office.Host`의 `NubiPane`, `ContentPort`, `DocumentPort`, `ExcelPort`를 재사용 후보로 삼는다. 기존 엔진과 승인 계약을 유지하고 Desktop A2A를 켜지 않는다.

## 원본과 열린 문서

1. 클릭한 메일 ID, 원문 해시, 첨부 ID와 해시를 main/worker에서 재검증한다. 확장자와 확인한 문서 종류로 앱을 결정한다.
2. 원본 바이트를 재작성/복호화하지 않고 사용자 전용 보관 영역의 열기용 사본으로 준비한다. 외부 앱이 사용할 경로는 renderer에서 만들지 않는다. 원본 미보관은 실제 파일 없음으로 표시한다.
3. 실제 설치된 Microsoft 앱으로 연다. 일반 파일 연결만 사용했다면 Microsoft 앱 열기 성공이라고 표시하지 않는다. 보안 안내와 보호 보기는 Office가 소유하고 누비가 자동 확인하지 않는다.
4. 실행 요청, 문서 열림, Office 호스트 연결, AI 관찰 완료를 각각 구분한다. 창 제목이나 PID만으로 같은 문서라고 확정하지 않는다.
5. 원본 메일의 첨부와 사용자 작업 사본을 구분한다. 사용자 수정은 원본 메일이나 기존 추출 캐시를 덮어쓰지 않는다. 열린 사본을 만료 타이머로 삭제하지 않으며, 연결 해제를 문서 닫기/강제 종료로 구현하지 않는다.

## AI 연결

연결 식별자는 `projectId`, `taskId`, 원문/첨부 해시, 작업 사본 ID, `officeSessionId`, `documentId`를 포함한다. 문서의 수정 상태/관찰 세대는 별도로 확인한다.

- Excel: 선택 셀의 시트/주소, 값, 수식, 표시 문자열, 단위와 필요한 머리글을 읽는다. 의존 셀은 실제 질문에 필요한 범위만 확장한다.
- Word: 선택 문단/표와 문서 위치를 읽고 전체 본문을 매번 넣지 않는다.
- PowerPoint: 현재 슬라이드와 선택 개체, 실제 텍스트를 읽는다. 이미지 판독은 필요한 경우 해당 영역 캡처를 보조로 붙인다.
- 선택 변경으로 모델을 매번 호출하지 않는다. 가벼운 연결/선택 메타데이터만 갱신하고 질문을 보낼 때 원본 상태와 읽은 범위를 확인한다.
- 추출된 원래 첨부와 Office에서 수정한 문서를 서로 다른 근거 버전으로 표시한다. 과거 추출 본문을 현재 열린 문서 내용으로 쓰지 않는다.
- COM 객체는 Office UI/STA에 남기고 값/구조화 결과만 보낸다. 모델과 실행 루프는 기존 호스트 것을 사용한다.
- AI 변경은 기존 한 번의 승인, 문서 재검증, 실행, 계산/재읽기 계약을 거친다. 변경 성공과 저장 성공을 구분한다.

## 주변 UI 일치

사용자가 후속으로 주변 UI 일치를 요청했다. 문서 탭, 파일 아이콘, 연결 상태, 선택 범위, AI 질문과 분리/닫기 동작은 기존 누비 공통 CX 컴포넌트와 `workspace-identity.css`/공유 deck 토큰을 재사용한다. Office 리본/수식 입력/시트 자체를 누비 스타일로 다시 그리지 않는다. 닫기는 누비 표시 해제와 Office 문서 닫기를 구분하며 미저장 문서를 자동 종료하지 않는다.

`packages/nubi-desktop/scripts/create-office-frame-review.mjs`가 화면 검토용 시안을 만든다. 실제 `NubiLogo`, `FileKindIcon`, `CxButton`, `Icon`, 공통 CSS를 사용한다. 연결 전 상태를 명시하며 표/리본을 모사하지 않고 AI 동작도 비활성으로 둔다. 1440/960/440px과 확대 글자에서 가로 넘침, 메일 본문 보존과 문서 영역 닫기/재열기를 확인했다. 이는 표시 시안 검증이며 제품 연결이나 실제 Office 임베딩 검증이 아니다.

시안과 검사 기록: `packages/nubi-desktop/verification/office-native-frame-2026-10-16/index.html`, `frame-*.png`, `checks.json`. 실제 Windows PoC에서는 작은 창/확대 시 Office 최소 크기, 잘림, 포커스와 native 영역 가림/복원을 별도로 확인한다.

## 화면 통합 선택

| 방식 | 실제 의미 | 판단 |
| --- | --- | --- |
| 실제 Office 창과 누비를 나란히 연결 | 원래 Excel/Word/PPT UI를 그대로 쓰며 동일 문서를 AI에 바인딩 | 내부 결합에 실패했을 때 사용자가 선택할 복구 후보. 최종 내부 표시 요구를 완료한 것으로 삼지 않는다. |
| Office 안의 누비 작업창 | 실제 문서 옆에 같은 작업의 AI 질문/선택 범위를 제공 | 기존 VSTO 자산 재사용 후보. 새로 독립 모델/대화를 만들지 않는다. |
| DWM 실시간 화면 표시 | 실제 창의 라이브 화면을 누비 영역에 표시 | 시각 투영 후보. 자체 편집/키보드/셀 선택 기능으로 표시하지 않는다. |
| 외부 HWND 재부모화 | 실제 Office 창을 누비의 native 영역에 결합 | Windows 11 + Office 2016 PoC 선행. Electron 기본 웹뷰 기능이 아니며 배율, IME, 포커스, 리본, 저장/보호 보기, 다중 문서 창과 분리 복원 검증이 필요하다. |

진짜 내부 조작이 목표라면 라이브 미리보기만으로 완료하지 않는다. 재부모화 실패 시 원래 창/스타일/위치를 복원하고 사용자 문서를 닫지 않는 탈착 경로가 먼저 있어야 한다. 현재 macOS 환경에서 Windows 실제 Office 안착이나 NASCA 호환 성공을 확인할 수는 없다.

## 평가와 적용 순서

1. 메일 선택과 첨부 열기/AI 질문을 분리한다. 첨부 클릭 전후 같은 메일, 중앙 화면, 스크롤과 미작성 대화가 유지되는지 확인한다.
2. 원본 해시를 확인한 native 열기를 연결한다. 같은 이름의 여러 첨부, 클릭 중 메일/프로젝트 변경, 중복 클릭, 앱 미설치, 저장되지 않은 원본을 평가한다.
3. 실제 Office 연결 뒤 선택 범위 질문부터 기존 native 호스트에 연결한다. 서로 다른 문서/시트/창과 수정 세대가 섞이지 않는지 검증한다.
4. 사용자가 선택한 화면 통합 방식을 Windows에서 시험한다. 100/125/150/200% 배율, 다중 모니터, 한글 입력, 리본/필터/수식 입력, 보호 보기, 창 이동/최소화/종료와 저장 안내를 확인한다.
5. Office 2016/NASCA 문서 열기, 사용자 편집, AI 읽기, 승인된 수정, 저장과 재열기를 각각 입증한다. 로컬 fixture와 소스 빌드를 그 성적으로 대체하지 않는다.

## 확인한 공식 근거

- [Electron shell.openPath](https://www.electronjs.org/docs/latest/api/shell): OS의 기본 방식으로 파일을 여는 기능이며 문서 바인딩/Office 연결 성공을 보장하지 않는다.
- [Microsoft SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent): native 창 부모를 바꾸며 창 스타일/UI 상태 조정과 서로 다른 DPI 모드의 제약이 있다.
- [Microsoft DWM Thumbnail](https://learn.microsoft.com/en-us/windows/win32/dwm/thumbnail-ovw): 대상 창 안에 실시간 시각 연결을 제공한다. 문서 개체 모델 연결이나 편집 기능을 제공하는 계약은 아니다.
- [Microsoft Custom task panes](https://learn.microsoft.com/en-us/visualstudio/vsto/custom-task-panes?view=visualstudio): Office 문서 프레임에 연결한 작업창과 Office 개체 모델 접근의 기반이다.
- [Microsoft Office threading](https://learn.microsoft.com/en-us/visualstudio/vsto/threading-support-in-office?view=visualstudio): Office 객체 모델 접근은 STA/메인 스레드와 busy/rejected call 처리가 필요하다.
