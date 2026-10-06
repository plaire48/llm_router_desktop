# 누비 Workspace Electron 전환

최신 사용자 결정: Theia 제거, 전용 Electron 앱. 기존 Codex 참고 화면의 왼쪽 프로젝트/대화, 중앙 에이전트, 오른쪽 보조 파일/변경/이력 구성을 유지한다. A2A는 이번 제품에서 지원하지 않는다.

## 실행 구조

Electron main → 제한된 sandbox preload RPC → 공유 Nubi React Workbench. main이 전용 Node 자식 실행기를 시작한다. Pi와 OpenWiki, 제공자, 승인 및 영수증은 기존 실행기를 사용한다. Theia 서버, CLI, IDE 서비스와 의존성을 active workspace/package lock에서 제거했다. 이전 Theia 확장 소스와 브라우저 앱은 참고 소스로만 보존한다.

파일을 열면 독립 Monaco MIT 편집기를 지연 로드한다. 파일별 모델은 보조 영역을 닫아도 유지한다. 일반 저장은 예상 파일 해시 검사와 저장 후 readback, 제안 반영은 기존 prepareProposal/confirmProposal과 dirty/version/hash 확인, Monaco undo를 유지한다. 프로젝트 전환은 dirty 버퍼가 있으면 거부한다. 검색, Git 변경과 브랜치별 최근 50개 커밋을 같은 창에서 본다. 커밋은 파일별 변경량과 읽기 전용 inline diff로 표시한다. 터미널은 기존 승인된 프로세스 실행기의 명령/출력/중지 화면이다. 대화형 PTY는 아직 제공하지 않는다.

## 커밋 이력 비교 (2026-10-02)

오른쪽 보조 영역에서 로컬/remote-tracking 브랜치 선택 → 커밋 선택 → 폴더별 변경 파일 트리 → 코드 비교로 이어진다. 브랜치를 checkout하거나 원격을 fetch하지 않는다. 커밋 파일 트리에서만 실제 Git numstat의 `+`/`−`를 표시하고, 선택한 파일 하나에만 Monaco를 지연 생성한다. 수정 전후 줄은 옅은 빨강/초록, 변경 글자는 조금 더 진한 배경이며 문법 색과 줄 번호를 유지한다. unchanged region은 주변 3줄을 남겨 접고 사용자가 펼칠 수 있다. 기존 편집 모델과 undo는 건드리지 않으며 비교 모델은 닫을 때 해제한다. 빠른 선택 변경 뒤 늦게 도착한 결과는 현재 선택을 덮어쓰지 않는다. 실패는 기존 2초 토스트로 알리고 재조회 버튼을 남긴다.

사용자 후속 결정: 일반 파일 보기는 왼쪽 사이드바에서 실제 프로젝트 파일을 폴더 계층과 파일명으로 표시하며 `+`/`−`는 붙이지 않는다. 파일 선택은 오른쪽 편집기로 이어지고 같은 프로젝트 폴더의 대화 목록을 유지한다. 일반 탐색과 커밋 상세가 공통 ProjectFileTree를 사용하며 한 자식 폴더만 있는 경로는 묶어서 표시한다. 필터 입력, 폴더 접기/펼치기, 선택 배경과 기존 DriftLabel의 이름 이동을 재사용한다. 한 번에 500개 파일을 표시하고 더보기로 늘린다. 파일을 읽거나 수정한 특정 대화에 대한 새 연결 관계는 추정하지 않는다.

오른쪽 보조 영역의 상단 오른쪽 버튼으로 에이전트 작업 영역까지 넓혀 볼 수 있다. 확장한 뒤 `>` 또는 Escape는 기존 3분할로 복귀한다. 왼쪽 메뉴와 프로젝트 목록의 실제 경계를 따라 확장 위치를 계산하며 시스템/사이드바 크기 변경에 맞춘다. 중앙 Workbench는 마운트된 상태를 유지하고 확장 영역에 가려진 내용만 inert로 처리한다. 대화 초안, 실행, 편집 모델과 변경 비교 상태를 새로 만들거나 자동 저장하지 않는다. 보조 영역을 닫으면 확장 상태를 해제한다.

Git 객체 ID로 전후 blob을 읽으므로 현재 파일 내용과 과거 커밋을 섞지 않는다. 브랜치는 실제 refs 목록에서 검증하고 커밋은 선택 브랜치 tip에서 도달 가능한 것으로 제한한다. root commit은 빈 트리, merge commit은 첫 부모와 비교한다. 이름 변경은 삭제/추가로 표시한다. 보호 경로는 제외 수를 표시하며 파일 목록은 최대 500개로 제한하고 나머지가 있음을 알린다. 바이너리, 비 UTF-8, symlink/submodule과 1 MiB 초과 파일은 코드 비교를 만들지 않는다. 기존 raw-patch RPC는 유지한다.

GitHub 확인 당시 [Monaco Editor](https://github.com/microsoft/monaco-editor)는 약 46.8k stars, [diff2html](https://github.com/rtfpessoa/diff2html)은 3.4k, [React Diff Viewer](https://github.com/praneshr/react-diff-viewer)는 1.7k였다. 이 비교 후보 중 가장 널리 쓰이고 이미 포함된 MIT Monaco 0.57.0의 diff API를 재사용한다. diff2html은 unified patch 표시에는 적합하지만 별도 렌더러/문법 강조 의존성을 더하지 않아도 기존 Monaco로 접힌 구간과 글자 단위 비교를 제공할 수 있어 도입하지 않는다. Codex의 실제 내부 라이브러리는 확인한 사실로 표시하지 않는다. 설치된 `monaco.d.ts`의 `renderSideBySide`, `hideUnchangedRegions`, `diffAlgorithm`, `renderIndicators` 공개 계약을 확인했다. 별 수는 변동 가능하다. 이번 확인 범위는 사용자 요청대로 Electron 빌드이며 UI/실계정/Windows 테스트는 실행하지 않는다.

main IPC는 같은 창의 최상위 `app://bundle/index.html` frame만 허용한다. protocol은 번들 내부 realpath만 제공하며 CSP를 우회하지 않는다. Node API와 인증값은 main/worker에 둔다. GHES 계정은 전용 safeStorage 암호화 저장소를 사용하고 평문/basic_text는 거부한다. 기존 VS Code/브라우저/Office 토큰을 가져오지 않는다. Clone은 기존 challenge/nonce/회사 origin 검증 askpass를 재사용한다.

## OpenWiki 자동 초기화

폴더/Git/ZIP 프로젝트 열기는 곧바로 화면을 연다. Git 없는 폴더도 읽고 수정할 수 있으며 Git 초기화나 첫 커밋을 자동 실행하지 않는다. ZIP은 새 폴더에만 추출하고 traversal, symlink, 암호화 및 Windows 이름 충돌을 거부한다. 제한은 20,000 entries, 파일 16 MiB, 전체 256 MiB다.

Wiki가 없으면 로그인 대기 상태를 기록하고 현재 선택한 제공자/모델 연결 후 실행한다. OpenWiki-SDS 실제 init runner를 임시 프로젝트 snapshot에서 실행한다. `파일 읽기`, `구성 분석`, `문서 작성`, `저장 확인` 상태를 별도로 표시한다. 처리 수를 모르는 구성 분석에는 %를 만들지 않는다. 문서 시작 이벤트는 완료 문서 수에 포함하지 않는다.

원본 소스 hash를 재검사하고 새 Markdown 페이지만 exclusive 쓰기/readback 후 게시한다. 기존 Wiki와 사용자 편집은 덮어쓰지 않으며 generator가 임시 폴더에 만든 AGENTS/workflow는 프로젝트에 반영하지 않는다. 임시 저장소 Claims는 프로젝트 근거로 옮기지 않는다. 기존 Wiki가 있으면 init을 건너뛰고 기존 승인형 갱신 흐름을 사용한다. 실행 중 취소/모델 변경/소스 변경/중단은 attention 또는 cancelled로 남기고 자동 재실행하지 않는다. 현재 자동 init은 읽을 수 있는 UTF-8 소스 범위이며 바이너리/OCR 전체 분석은 아니다.

## 메일 첨부

A2A UI와 위임 도구를 제거하고 collaboration 서버를 시작하지 않는다. POP3 원문/첨부 hash 보존은 유지한다. 첨부의 `문서 열기`로 실제 내용을 읽고 `현재 모델에 질문`으로 직접 호출한다. PDF 텍스트, DOCX 본문, XLSX 셀과 저장값, PPTX 슬라이드 텍스트, UTF-8 문서를 읽는다. OCR/이미지, Office 재계산/서식/암호화 및 구형 DOC/XLS/PPT는 검증하거나 읽었다고 표시하지 않는다. 미지원/빈 문서/크기 초과는 명시적으로 표시한다. 첨부의 지시는 실행 권한이 아니며 모델 도구/A2A에 전달하지 않는다.

## 선택 근거

- Electron 공식 [protocol](https://www.electronjs.org/docs/latest/api/protocol), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 패턴을 적용했다. 서버 없는 앱 번들, main/preload/renderer 격리와 OS 암호화를 사용한다.
- [Monaco ESM](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md) 독립 편집기만 도입한다. IDE 확장 호스트 전체가 필요한 작업은 현재 범위가 아니다.
- 파일/Git는 기존 경계와 native Git을 재사용한다. 새 데이터 저장 시스템이나 별도 에이전트 프로토콜을 도입하지 않는다.
- 기술 버전과 제품의 Beta 표시를 분리한다. Windows 설치판과 실제 제공자 로그인은 별도 검사다.

## 검증

검사 결과와 화면은 `verification/electron-shell.json`, `verification/electron-shell.png`에 기록한다. 새 자동 Wiki/ZIP/저장/첨부 검사는 `tests/electron-features.test.mjs`, AI Pro 단계 진단은 `tests/provider-login-stages.test.mjs`다. 합성 generator/model은 실제 모델 품질을 증명하지 않는다. Windows 설치판 로그인 문제의 원인은 아직 실제 오류로 확정하지 않았다.

### GPT 요청 거절 수정 (2026-10-02)

사용자 후속 결정: FabriX는 추론 설정을 지원하지 않는다. 입력창의 추론 컨트롤은 AI Pro/ChatGPT에만 마운트하고 FabriX로 바꾸면 열린 추론 모달도 제거한다. 기존 제공자 계층은 FabriX의 추론 옵션을 빈 목록으로 반환하고 변경 요청을 거부한다. FabriX 요청 변환기는 허용된 max_new_tokens/temperature/top_p만 llmConfig로 옮기며 reasoning, reasoning_effort와 summary를 전송하지 않는다. AI Pro와 ChatGPT의 추론 설정은 유지한다.

실행 중 앱의 저장된 진단에서 2026-10-02 11:02:51 KST의 `gpt-6.1-sol` 요청은 HTTP 400, `invalid_value`, 문제 필드 `reasoning.summary`로 거절됐다. 도구 호출 전 실패이며 당시 추론 단계는 `low`였다. 공유 ChatGPT 클라이언트가 보내던 `reasoningSummary: 'off'`가 실제 요청의 `reasoning.summary: 'off'`로 직렬화되는 것을 설치된 Pi 0.86.1 소스에서 확인했다. 설치된 OpenAI SDK의 summary 계약은 `auto`/`concise`/`detailed`/null이며 off는 포함하지 않는다.

Pi의 공개 `onPayload` 훅으로 선택적 summary 필드만 제거하고 모델, 추론 effort, 인증과 응답/도구/복구 계약은 유지한다. 단순 옵션 생략은 Pi가 auto를 기본으로 넣으므로 선택하지 않았다. 설치 모듈 수정이나 의존성 교체는 하지 않는다. 사용자 결정에 따라 Electron 빌드만 수행하며 자동 테스트는 실행하지 않는다. 실제 모델의 수정 후 응답 성공은 새 요청으로 확인하기 전까지 미확인이다.

## Web preview before desktop packaging

`npm run build:electron` then `npm run preview:web` serves the same Electron renderer at `http://127.0.0.1:4318/?login`. The preview uses an in-memory, browser-only sample bridge. It reads no local project or credentials, sends no mail, runs no command, and calls no provider. A visible preview strip names this boundary. Files, conversations, commit history, mail and attachment questions can be inspected with sample data.

The desktop welcome retains the existing shared Nubi palette and bird assets. Only the soft aura and drifting motion change. The text size control lives in settings. Reduced motion, hidden-window motion pause and composer focus are preserved. Both the renderer and preview load the shared CX stylesheet, including local Korean fonts.

## Rounded controls and identity tokens

사용자 색상 정정 2026-10-02: 모델 선택 모달의 제공자 탭과 연결 버튼을 기존 공통 팔레트로 복원한다. AI Pro는 옅은 파랑/보라, ChatGPT는 중립색, FabriX는 옅은 청록이며 로그인 버튼과 같은 글자색을 쓴다. 모든 제공자를 파랑으로 덮던 Desktop CSS를 제거하고 모델명/제공자명과 테두리 없는 CX는 유지한다.

프로젝트 경로 복사는 선택한 대화가 현재 프로젝트에 속하는지 실행기에서 확인한 뒤 정규화된 프로젝트 폴더 절대 경로를 반환한다. 임시 작업 폴더 경로를 사용하지 않는다. Electron 클립보드 쓰기가 성공하면 공통 2초 토스트에 `프로젝트 경로가 복사되었습니다.`를 표시하며 실패도 토스트로 알린다. 웹 미리보기도 같은 host dispatch를 사용한다. 확인 범위는 Electron 빌드다.

사용자 후속 결정 2026-10-02: 모든 Desktop 모달의 세로 여백을 줄인다. 공통 헤더/푸터는 상하 8px, 본문은 상하 12px이며 좌우 여백과 글자 크기는 유지한다. 회사 계정 모달도 같은 본문 세로 토큰을 사용한다. 후속 사용자 정정에 따라 모델 선택 모달은 기존 CX의 440px 목록 높이와 헤더/본문/푸터 여백을 원복한다. 제공자 아이콘 옆 AI Pro/ChatGPT/FabriX 이름을 표시하고 모델명, 검색과 연결 텍스트를 유지한다. 스킬/추론 팝업의 세로 padding과 구획 간격도 줄인다. 대화 삭제 안내의 두 문장은 문자열 escape 대신 React br로 분리하며 삭제 대상과 원본 기록은 바꾸지 않는다. 확인 범위는 Electron 빌드이며 화면 테스트는 실행하지 않는다.

The latest visual direction keeps the supplied HTML CX identity. Navigation uses Nubi blue and its light surface. Mint stays in the bird and ambient light. Per-menu rainbow accents are removed. The login keeps the original shared white card, provider artwork and 12px rounded provider rows. General controls use a soft 18px pebble radius. The newly supplied Codex screenshot supersedes the filled new-conversation treatment: navigation and new conversation are neutral, with blue reserved for selected state and primary execution. Normal button borders are transparent, while keyboard focus and error states retain visible boundaries.

`electron-app/ios-tokens.css` defines semantic action, surface, icon and motion tokens on top of the shared deck. Native CX controls are reused; no icon package, Apple artwork or external font service is added. Icons use the same 24px grid and 1.8px rounded stroke. Control targets are 44px. Press feedback uses a 130ms scale transition; the supplementary pane enters over 340ms. OS reduced motion and reduced transparency remain supported. The user supplied a fresh Codex screenshot in this turn. Its compact neutral rail, flat project/conversation list, rounded composer, restrained utility icons and action hierarchy guide the layout. Direct app capture remains unavailable through the app tool.

The web preview check verifies the login, control geometry and spacing, actual CSS motion, text settings, Monaco, commit history, mail/document question flow, conversation, narrow layout and reduced motion. Results are sample-data UI evidence. The Electron shell check separately verifies file saving/readback, Git patch/history, disabled A2A, isolation, persistent central agent, terminal execution and narrow layout on macOS. Neither establishes a Windows installation or real provider login.

## Beta scope and sidebar overlay

사용자 결정 2026-10-02: Computer Use는 `runtime/beta-features.mjs`의 release flag로 비활성화한다. 앱 연결 화면은 마운트하지 않고 컴퓨터 도구와 관련 워크플로는 available-tools 목록에서 제외한다. 앱 파일 선택과 실행기 요청도 같은 정책으로 거절하며 상태 조회는 unavailable을 반환한다. UIA/포인터/키보드/승인/복구 소스와 기존 기록은 보존한다. 환경변수나 사용자 설정으로 우회 활성화하지 않는다.

Electron 사이드바와 너비 조절 경계, 오른쪽 파일 보조 영역은 절대 위치의 overlay로 배치한다. 대화 영역의 flex 너비는 접기/펼치기와 사이드바 드래그에 영향을 받지 않는다. 공통 panelLeft/panelLeftClose 아이콘을 같은 버튼 좌표에 사용하고 오른쪽 보조 영역도 같은 아이콘 형태를 쓴다. 상단 메일 연결 아이콘과 모달/토스트의 닫기 X를 제거한다. 메일은 설정과 왼쪽 수신 이력에서 접근하며 모달은 Escape/배경 클릭, 토스트는 2초 자동 종료를 유지한다. 확인 범위는 Electron 빌드이며 화면 테스트는 실행하지 않는다.

## One CX notification surface

사용자 결정 2026-10-02: Workbench의 복사/삭제/스킬 등록/파일 반영/대기열 안내와 실행 오류, Electron 파일/커밋 이력/보조 영역 오류를 모두 기존 WorkspaceToast store로 연결한다. 검정 토스트 portal과 CSS, 화면별 2초 타이머를 제거한다. 흰 표면과 원형 카운트다운을 유지하고 실제 성공은 확인 표시, 오류는 느낌표로 구분한다. X는 다시 추가하지 않는다. 같은 문구도 새 알림 ID로 표시되며 동시에 한 개만 보인다.

Electron은 앱 루트에 viewport 하나를 두어 프로젝트 전환 중에도 유지한다. 독립 Workbench 호스트는 기본 viewport를 유지한다. 활성 CX 모달 안으로 portal을 옮겨 body의 inert 배경에 알림이 갇히지 않게 하고 이동 중 남은 표시 시간을 보존한다. 숨겨진 창과 키보드 초점에서는 기존 카운트다운 일시 정지를 유지한다. 실제 요청/초안/오류 복구 기록은 이 표시 변경으로 삭제하지 않는다. 공개 CX feedback의 single-notice/모달/카운트다운 패턴을 재사용하고 사용자 지정 2초와 X 제거는 Desktop에서 유지한다. 확인 범위는 Electron 빌드이며 테스트는 실행하지 않는다.

새로고침 중 웹 bridge 누락도 확인했다. 빌드 해시가 붙은 renderer URL을 정확히 문자열 매칭하던 주입을 head 끝 주입으로 바꿨다. 재빌드와 소유 Electron 재시작 후 기존 웹 화면에서 프로젝트 목록과 연결 화면이 다시 표시된다. 실제 모델 응답이나 Windows 설치 검증으로 확대하지 않는다.

## Auxiliary sidebar width

사용자 결정 2026-10-02: 파일 편집기/변경 비교/검색/Git 변경/커밋 이력 보조 영역의 왼쪽 경계를 드래그해 너비를 조절한다. 기존 useSidebarResize를 방향/대상/CSS 변수/저장 키로 구성해 재사용한다. 새 splitter 라이브러리는 도입하지 않는다. pointer capture로 끌기를 유지하고 드래그 중에는 CSS 변수만 갱신해 실행 중인 대화와 편집기 모델을 다시 만들지 않는다. Monaco의 기존 automaticLayout을 유지한다.

보조 영역은 absolute overlay이고 대화창의 flex 너비는 바뀌지 않는다. 너비를 로컬 레이아웃 설정에 기억하고 실제 창 크기에 맞춰 제한한다. 화살표 키는 경계를 이동하며 Home/End는 최소/최대, Escape/pointer cancel은 진행 중인 조절 취소, 더블클릭은 기본 너비 복원이다. 넓게 보기에서는 조절 경계를 숨기고 돌아오면 이전 너비를 사용한다. AI Workspace의 기존 넓게 보기/iframe 동작은 보존한다. 확인 범위는 Electron 빌드이며 테스트는 실행하지 않는다.
