# Terminal autonomy and source comparison

2026-10-24. 누비 Desktop 소스 main을 대상으로 한다. 제품 동작, 설치된 비교 앱의 정적 코드, 공개 실행기 소스와 로컬 실행 측정을 구분한다.

## 반영한 동작

승인 설정을 저장하지 않은 프로젝트는 파일과 명령 자동을 기본으로 한다. 기존에 명시적으로 저장한 ask/edits/commands는 유지한다. 파일 자동 반영은 기존 변경 계획, 현재 읽기/해시, 부분 수정, 반영과 되돌리기 흐름을 사용한다. 새 쓰기 실행기를 만들지 않았다.

단일 로컬 조회, 버전 확인과 프로젝트 manifest의 테스트/빌드/점검은 기존 propose_setup_action 도구가 호스트 정책을 확인해 같은 actor 실행 안에서 수행한다. 명령 후 actor를 종료하고 UI가 승인과 재시작을 전달할 때까지 기다리는 경로를 줄였다. 반환하는 것은 실제 process ID, 상태, 종료 코드와 제한된 출력 미리보기다. 계속 실행 중이면 read_process_output으로 같은 프로세스를 읽는다. 실행 준비 완료를 명령 성공으로 취급하지 않는다.

관리자 실행, 실행 중 프로그램에 새 입력, 임의 inline 프로그램, 설치/구성/서버 시작과 정책 밖의 명령은 기존 사용자 승인 또는 사용자가 저장한 정확한 허용 규칙을 따른다. 셸 구문/치환/리다이렉션과 명백한 외부/자격 증명 경로를 임의로 허용하지 않는다. 이 정책은 OS 샌드박스가 아니다. 사용자 취소, 변경된 참조/셸, 승인 방식 변경, 대기 중인 파일 수정, 다른 실행과 미확정 명령은 기존 경계를 유지한다.

호스트는 setup/수정 명령과 process에 approvalSource=user 또는 automatic을 저장한다. 직접 승인한 명령은 동일 process ID의 오른쪽 실행 화면을 연다. 자동 명령은 오른쪽을 열거나 현재 파일/화면을 바꾸지 않고 대화의 도구 아이콘, 작업명과 기록으로 진행한다. 자동 기록에는 오른쪽 터미널 열기 버튼을 노출하지 않는다. 직접 연 대화형 터미널의 한글 입력, 키보드, 변수/작업 경로, 중지와 탭 수명은 유지한다.

같은 actor가 처리하는 자동 명령은 그 actor가 출력/실패를 판단한다. actor보다 오래 실행하는 프로세스만 기존 무출력/완료 복구에 돌려주며 취소한 actor를 자동 재개하지 않는다. 잘못된 명령의 수정도 승인 출처를 구분한다. 평가용 가상 사용자와 두 실행기 비교는 ask를 명시해 시나리오 밖의 명령을 실행하지 않는다.

## 코드 비교

| 대상 | 확인한 구현 | 판단 |
| --- | --- | --- |
| 누비 직접 입력 | TerminalPanel.jsx의 xterm/FitAddon, terminal-host.cjs, node-pty 작업 프로세스, animation-frame 묶음과 ACK 역압력 | 이미 실제 Bash/PowerShell/CMD/Git Bash 셸에 연결하는 PTY 구조다. |
| 누비 에이전트 명령 | Processes의 pipe 기본 실행과 선택 PTY, 해시와 영수증, 오른쪽 processId 화면의 500ms/숨김 1500ms 조회 | 오른쪽 실행 기록과 직접 입력 PTY는 구분한다. 기록 조회 지연을 셸 실행 속도로 단정할 수 없다. |
| 설치된 Codex | main-TK5axOki.js의 node-pty spawn/onData, terminal-panel-510be929d853.js의 xterm/FitAddon, renderer 재사용, onData 입력과 frame 단위 resize/scroll | Electron 안에서 실제 셸과 웹 렌더러를 함께 쓴다. 외부 OS 터미널 창을 끼워야 진짜 터미널이라는 가정은 맞지 않는다. |
| 설치된 Claude Desktop | pty-host/ptyHostWorker.js의 node-pty spawn, data/exit 메시지, scrollback 기록과 별도 프로세스 | 실제 PTY를 UI에서 분리하는 구조를 확인했다. 이 파일만으로 원격 제공 UI의 전체 렌더러 구현은 확정하지 않는다. |
| 공개 Codex 실행기 | unified_exec의 프로세스 재사용, bounded 출력, 공통 승인/실행 정책과 process handle | 승인 판단과 명령 실행 및 출력 확인을 호스트에 두는 설계 패턴을 적용했다. Codex의 샌드박스 전체를 이식한 것은 아니다. |

비교 앱의 비공개 제품 코드는 복사하지 않았다. 이미 쓰는 MIT xterm.js/node-pty와 누비의 승인/출력/복구 구현을 유지했다. 새 터미널 패키지는 추가하지 않았다. OS 터미널 창 삽입의 속도 우위나 Codex/Claude보다 빠르다는 결론은 측정하지 않았다.

## 비교 버전과 출처

설치된 앱을 읽기 전용으로 확인했다. 실행 중인 사용자 세션/자격 증명/대화 DB를 읽거나 조작하지 않았다. 코드와 ASAR 복사본은 Git/배포 대상에 넣지 않고 verification의 로컬 분석으로만 보관한다.

- Codex package openai-codex-electron 26.1021.22027. app.asar SHA-256 c288204a062a691a3f252d547a6bfea6b56f6e0b3122c46476dda35fcb68e787. node-pty ^1.1.0.
- Claude Desktop package @ant/desktop 3.6556.2. app.asar SHA-256 b2dfbbb40325d978dcb7561ad12a6f9bc199f8f46b7d3d2897af74ce8965d68a. PTY host SHA-256 db625ac877c85ac71f19020a0d3a298edf402d6a6d058fc14532f60716e4df30.
- [Codex 공개 Unified Exec](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/unified_exec/mod.rs). 공개 HEAD를 고정해 읽었다.
- [Claude Desktop 통합 터미널 공식 설명](https://code.claude.com/docs/en/desktop#run-commands-in-the-terminal). 작업 디렉토리와 환경을 공유하는 통합 터미널을 설명한다.
- [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/). parser 소비량과 출력 역압력의 기준이다.
- [Microsoft ConPTY](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session). Windows 콘솔 프로세스와 표시 호스트의 경계를 설명한다.

## 검증 경계

- 초기 관련 회귀 117개와 승인/실행/평가/취소 후속 72개가 통과했다. 자동 명령의 같은 actor 실행, 승인 방식 변경 시 발행 중단, 동시 승인 한 번만 실행, actor보다 오래 사는 명령의 기존 복구 합류, 사용자/자동 수정 명령 출처를 별도로 확인했다. 후속 수치를 합산해 서로 다른 소스를 단일 전체 성적으로 표시하지 않는다.
- 전체 Node 검사의 최초 실행은 2,914개 중 2,708 통과, 4 실패, 202 건너뜀이었다. 기본 ask를 가정하던 평가 시험 3개는 평가기에 ask를 명시해 시나리오 승인 범위를 유지했다. 도구 스키마 예산 6,000토큰을 14토큰 초과한 1개는 중복 도구 설명을 줄여 보완했다. 최초 실패와 수정 후 관련 재실행 로그는 보존하며 전체 실행을 소급 통과시키지 않는다. 최종 승인/실행/복구/취소/평가/도구 예산 회귀 76개는 모두 통과했다. 이후 명백한 외부/자격 증명 경로와 파일 본문 wildcard 제외를 포함한 로컬 경계/실행/도구 예산 42개도 통과했다.
- Electron 합성 Workbench 2560/1920/1280/760/440px에서 실시간 작업명/아이콘, 승인 응답, 공개 초안과 명령 출력 흐름이 통과했다.
- 실제 macOS Electron renderer/IPC/worker와 임시 프로젝트/로컬 호환 모델로 9개 흐름이 통과했다. 기본 자동 명령은 승인 폼 없이 실제 출력을 같은 actor가 읽고 오른쪽 탭을 늘리거나 화면을 이동하지 않았다. 1280/440px 화면도 확인했다. 직접 승인한 명령은 같은 process ID를 표시하고 펼치기/재열기로 다시 실행하지 않았다. 한글/이모지/ANSI, cwd/변수, Ctrl+C, 12,000줄 출력, 창 크기 변경과 종료 직전 출력 순서도 확인했다.
- 단회 macOS 관측은 새 터미널 메뉴부터 준비까지 866ms, 약 109만 문자/12,000줄 출력부터 마지막 marker까지 180ms였다. 전체 테스트가 병행된 로컬 관측이며 통제된 비교 실험이나 p50/p95가 아니다. 비교 앱과 속도 우열을 주장하지 않는다.
- 실제 빌드한 Electron과 원본 OpenCode 1.19.4를 연결한 별도 코드 수정 흐름도 통과했다. 명시적 ask에서 승인 전 원본/CRLF를 유지하고 승인한 변경만 적용했다. 모델은 로컬 fixture였다.
- Desktop 디자인/identity와 Electron 빌드가 통과했다. 기존 Windows Bash CJS import.meta 경고는 유지한다. 이번 환경에는 PowerShell이 없어 Office reader의 선택 파서 검사는 건너뛰었다.

근거는 verification/terminal-autonomy-2026-10-24의 vendor-analysis, native-final과 후속 로그다. Windows PowerShell/CMD/Git Bash와 실제 Windows 설치판, 비교 앱의 실제 실행 시간, 실제 모델/계정 품질은 미검증이다.
