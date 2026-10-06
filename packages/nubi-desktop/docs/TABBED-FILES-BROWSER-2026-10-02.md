# Tabbed files and Chromium browser

사용자 요청: 오른쪽 보조 영역의 앞에 파일 탐색기/브라우저 아이콘을 두고 파일을 탭으로 관리한다. Git 제목은 아이콘만 표시한다. 경로 입력/폴더 이동/확장자 아이콘/선택 음영/코드 편집/터미널 탭을 실제 호스트와 연결한다. 대화 너비는 유지하고 보조 영역만 겹쳐 넓힌다.

## Adoption decision

2026-10-02 공식 저장소 화면 기준 React Arborist 약 3.7k stars, React Complex Tree 약 1.4k, Monaco 약 46.7k, xterm.js 약 21.2k. 이 숫자는 전 분야에서 가장 유명하다는 순위가 아니다. React 19 peer 범위와 로컬 설치 소스/라이선스를 확인하고 다음 조합을 채택했다.

- [React Arborist](https://github.com/jameskerr/react-arborist) 3.16.0, MIT: 가상 목록, 선택, 키보드 이동, 필터를 실제 파일 탐색기에 사용한다. 변경/이동/삭제 drag 기능은 켜지 않는다. 기존 Git 비교용 트리는 유지한다. 더 큰 UI 프레임워크를 추가하지 않는다.
- [Monaco](https://github.com/microsoft/monaco-editor), 기존 고정 버전: 확장자별 언어/구문 강조/편집/undo/커서 복원을 직접 재사용한다. VS Code/Theia 전체를 다시 가져오지 않는다.
- [xterm.js](https://github.com/xtermjs/xterm.js) 6.0.0와 Fit addon 0.11.0, MIT: 독립 터미널 탭의 실제 실행 출력 표시. 기존 Processes/셸 탐지/중지/영수증을 재사용한다. 대화나 모델 승인으로 사용자의 직접 실행을 가장하지 않는다.
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view): 실제 Chromium 페이지를 내장한다. deprecated BrowserView나 외부 사이트를 iframe으로 우회하는 방식은 선택하지 않았다.

## Implemented flow

탐색기 아이콘/브라우저 아이콘 뒤에 열린 파일과 웹페이지 탭을 같은 줄에 둔다. 별도의 브라우저 탭 줄을 중복하지 않는다. 파일/웹 탭의 닫기 X는 선택 버튼 옆에 별도 버튼으로 두고 닫을 때 해당 탭을 먼저 활성화하지 않는다. 선택한 탭이 가려지면 탭 줄만 스크롤하고 중앙 대화 너비는 바꾸지 않는다. 파일에서 웹으로 이동해도 편집 모델과 웹페이지 세션을 유지한다. 주소창과 경로 입력, 탐색 버튼은 같은 크기/색감/hover 토큰을 사용한다. 경로 입력과 클릭 가능한 breadcrumb로 현재 프로젝트의 디렉토리를 이동한다. 디렉토리는 더블클릭/Enter로 열고 파일을 선택하면 음영과 편집기를 함께 갱신한다. 실제 디렉토리 항목을 최대 2,000개씩 표시하며 하위 폴더 경로를 직접 열 수 있다. 링크/비공개 경로는 기존 범위 검사로 제외한다.

열린 텍스트 파일의 Monaco 모델, 미저장 내용, undo와 커서 위치를 보존한다. 저장은 기존 내용 해시와 실제 readback으로 확인한다. 이미지 PNG/JPEG/GIF/WebP/ICO는 4 MB까지 실제 bytes로 미리보기하며 코드 편집기로 수정하지 않는다. SVG는 XML 코드로 편집한다. 다른 바이너리/비UTF-8 파일은 현재 편집 범위를 넘어선다고 알린다. 미저장 탭 닫기는 명시적인 확인을 요구한다. 파일/웹 탭 칩 오른쪽의 작은 X 또는 가운데 버튼/Delete로 개별 탭을 닫고 Ctrl/Cmd+W는 미저장 파일을 임의로 버리지 않는다.

보조 영역 + 메뉴의 터미널/파일/새 페이지로 도구를 연다. 터미널은 독립 탭으로 열고 …에서 사용할 셸을 선택한다. 설정의 기본 셸은 유지하며 Windows 기본 PowerShell, CMD와 발견한 Git Bash, macOS/Linux Bash를 제공한다. 입력한 명령은 실제 셸에서 탭의 현재 디렉토리로 실행하며 단독 cd/Set-Location은 해당 탭의 프로젝트 내부 디렉토리를 갱신한다. 출력/중지/종료와 최근 입력을 탭별로 보존하고 다른 탭에서도 실행 상태를 계속 조회한다. 가운데 버튼/Delete/Ctrl+W로 유휴 터미널 탭을 닫고 실행 중이면 먼저 중지하도록 안내한다. 현재 구현은 명령 실행형 콘솔이며 지속 PTY/TUI/대화형 stdin은 제공하지 않는다.

브라우저는 주소/검색, 다중 탭, 뒤로/앞으로, 새로고침/중지, 페이지 찾기, 네이티브 메뉴의 확대/축소/인쇄/사진 저장/다운로드/방문 기록을 연결한다. 대화의 HTTP/HTTPS 링크도 같은 보조 영역의 웹 탭으로 열린다. 모델 로그인은 기존 외부 로그인 흐름을 유지한다. Ctrl/Cmd+L/F/T/W/R을 주소/페이지 찾기/새 탭/닫기/새로고침에 연결하며 웹페이지에 초점이 있어도 같은 동작을 수행한다. localhost 주소는 HTTP로 열어 로컬 페이지와 연결한다. Chromium 전용 session을 사용하며 비밀번호 가져오기/자동 완성/브라우저 확장 설치는 구현하지 않는다. 탭/쿠키/방문 기록은 이 프로세스 범위이고 자동 영구 저장하지 않는다. 웹 미리보기는 Chromium native view를 표시할 수 없으므로 Electron 전용 안내를 표시하며 같은 UI를 모의 인터넷 페이지로 채우지 않는다.

## 2026-10-04 파일 참고 화면 반영

파일 작업 안에 상단 breadcrumb, 왼쪽 독립 Monaco 편집기와 오른쪽 폴더 트리를 둔다. 제자리 폴더 펼치기/접기는 기존 react-arborist의 controlled data/onToggle/keyboard navigation을 사용하고 `browseDirectory`는 해당 폴더만 요청한다. 트리는 파일명, 확장자별 작은 아이콘과 선택 음영을 표시하며 일반 탐색에 Git 변경 개수를 붙이지 않는다. 경로 입력/Enter와 breadcrumb는 기존 프로젝트 범위 검사로 이동한다. 필터는 실제 불러온 폴더의 파일명을 대상으로 하며 미조회 프로젝트 전체를 검색한 것으로 표현하지 않는다.

한 번 클릭은 탭을 늘리지 않는 미리보기다. 더블클릭/Enter는 파일 탭을 만들고 편집을 시작하면 자동으로 탭을 남긴다. 이전의 깨끗한 임시 미리보기 모델만 해제하고 고정 탭/dirty 버퍼와 undo/viewState는 보존한다. 파일 탭의 X, 저장 hash/readback과 이미지 미리보기 계약은 유지한다. 미선택 편집 영역에는 설명 문구를 추가하지 않는다. 기존 브라우저/터미널 탭으로 이동해도 트리의 펼친 폴더와 입력을 유지한다.

편집기 파일 읽기는 `editorSource`로 분리했다. 기존 `read`는 에이전트 지침을 함께 읽어 단일 규칙 파일 32 KB와 전체 64 KB 한도를 적용하므로, 큰 AGENTS.md가 있는 프로젝트의 일반 편집도 거부했다. 사람의 파일 열기는 프로젝트 ID, task worktree, privatePath, UTF-8/1 MB와 해시를 검사하며 지침을 분석하지 않는다. 에이전트의 규칙 한도와 쓰기/승인 보호는 그대로 유지한다.

640px 미만의 보조 영역에서는 탐색기를 편집기 위에 겹쳐 연다. 파일을 탭으로 열면 탐색기를 접고 같은 폴더 아이콘으로 다시 연다. 넓게 보기에서는 편집기와 트리를 나란히 보며 탐색기만 접을 수 있다. 외부 사이드바와 중앙 Agent 너비 계약은 바꾸지 않는다. [React Arborist 공식 API](https://github.com/jameskerr/react-arborist)의 controlled-tree 패턴과 기존 [Monaco Editor](https://github.com/microsoft/monaco-editor)를 재사용하며 새 라이브러리를 도입하지 않는다. Codex의 실제 내부 라이브러리로 표시하지 않는다.

## 2026-10-04 확인 범위

Electron 빌드 완료. 같은 실제 worker에 연결한 localhost 화면에서 프로젝트의 packages/nubi-desktop/electron-app을 제자리에서 펼치고 절대 경로/Enter 이동을 확인했다. 실제 누비 이미지의 한 번 클릭은 미리보기만 표시하고 더블클릭은 작은 X를 가진 파일 탭을 만드는 것을 확인했다. 화면은 /private/tmp/nubi-files-reference-2026-10-04.png에 보관했다.

텍스트 열기가 rules_limit으로 거부되는 원인은 실제 root/하위 AGENTS.md가 각각 32 KB를 넘는 상태와 기존 read 경로에서 확인했다. editorSource 분리 수정은 빌드됐으며 현재 연결된 메일을 보존하기 위해 앱 재시작 승인을 기다린다. 새 backend의 실제 텍스트 편집/저장과 Windows 설치판은 아직 확인하지 않았다. 자동 테스트는 사용자 요청에 따라 실행하지 않았다.

## Boundaries

원격 페이지에는 preload/Node/누비 IPC/모델 토큰을 넣지 않는다. native view bounds는 실제 창과 보조 영역 안으로 제한하고 모달/다른 탭/숨긴 창에서는 감춘다. 다운로드는 native 저장 대화상자를 사용한다. 인터넷 기록 삭제는 확인 후 브라우저 session만 지운다. Beta Computer Use와 Desktop A2A는 계속 비활성이다.

확인 범위: 소스 검토와 Electron 빌드. 사용자 결정에 따라 테스트/실명령/실사이트/Windows 설치 검증은 실행하지 않는다. 빌드 성공을 실제 계정 로그인, 브라우저 사이트 호환성 또는 대화형 셸 검증으로 표현하지 않는다.
