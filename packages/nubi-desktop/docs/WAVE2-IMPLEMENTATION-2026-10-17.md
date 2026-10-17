# 2차 물결 적용 기록

기준은 현재 작업 폴더의 1.2.10이다. 설계 §8의 4~6번 답을 적용했다. Codex는 push하지 않으며 Claude가 QA 뒤 비공개 main 업로드를 맡는다. Task 0과 13의 회사 PC 실측, Task 6과 3차 물결은 실행하지 않았다.

## Task 0b

`.gitignore`에 `artifacts/`, `releases/`를 더했다. 두 경로 모두 변경 전 `git check-ignore` 종료 코드 1, 변경 후 0이다. 기존 제외 항목은 보존했다. 업로드는 하지 않았다.

## Task 1

대화 전체 20개, 한 실행 5개의 챕터를 허용한다. 위치와 runId는 호스트가 정하며 다른 실행의 챕터를 보존한다. 제목과 한 줄 요약은 기존 대화 사이에 표시한다. 목차는 두 개부터 보이며 본문 스크롤 영역 밖의 전용 공간에 배치한다. 넓은 화면은 오른쪽, 좁은 화면은 위쪽 한 줄이다.  긴 대화의 앞부분으로 이동할 때 기존 기록 더 보기 경로로 필요한 기록을 드러낸다. 좁은 화면은 가로 목차이며 최대 20개도 화면의 절반 높이를 넘지 않는다. 동작 줄이기 설정을 따른다.

`mark_chapter`는 읽기 도구 목록에 넣지 않았다. 현재 Desktop에는 계획 예시의 `isReadTool`이 없어 기존 `READ_TOGETHER`에서 계획 갱신처럼 처리한다. 공용 런타임은 바꾸지 않았다. 명령과 하위 작업자 기록의 기본 접힘도 바꾸지 않았다.

사용자 후속 요청에 따라 프로젝트 이름과 `…`을 한 행 배경으로 합쳤다. 개별 버튼의 배경은 투명하게 두고 선택/hover/focus는 바깥 행에 적용한다. 합성 화면에 실제 프로젝트 관리 메뉴를 연결해 분리 배경 실패를 먼저 재현했고 수정 후 통과했다.

### 검사

- 실패 시험: 챕터 모듈 부재, 화면 목차 부재, 20개 목차 높이 초과를 각각 확인한 뒤 구현했다.
- 챕터 호스트 실행과 저장, 도구 예산, lean 도구, Wiki, 작은 문맥 시나리오: 41/41 통과.
- 승인 진단, Wiki 압축 근거, 보호 메시지, 중단과 재개: 31/31 통과.
- `check-wave2-ui.mjs`: 1280px, 440px, 86개 메시지의 과거 챕터 이동, 20개 목차 검사 통과. 두 폭의 캡처를 직접 확인했다. 사용자 지적 후 본문과 목차 영역의 겹침 실패를 재현하고, 영역을 분리한 뒤 이동 전후 겹침 없음까지 통과했다.
- 디자인 검사와 메일 UI 사전 검사 통과.
- 전체 `npm run test:gates`: 다섯 번째 실행 종료 코드 0. 단위 1,937개 중 1,737 통과, 실패 0, 플랫폼 조건 200개 건너뜀. 챕터와 기존 화면 검사, 빌드, 실제 macOS Electron 셸, 스킬, 에이전트, 웹, 수명주기, 전체 화면 117개 검사가 통과했다. 최종 로그는 `verification/wave2/task1-gates-final.log`에 보관했다. 앞선 실패와 수정 근거는 아래에 유지한다.

### 전체 검사에서 찾은 문제

첫 전체 실행은 1,936개 중 1,730 통과, 6 실패, 플랫폼 조건 200개 건너뜀이었다. 여섯 실패는 챕터 변경 전 agent/tool-rules 소스를 주입해 모두 재현했다.

- 승인 진단 시험이 dispatch 뒤의 새 터미널 로거까지 추출해 참조 오류가 났다. 추출 끝을 dispatch 경계로 바로잡았다.
- Wiki 압축 시험은 전체 도구 수 증가로 최종 검토 요청이 26k 창을 넘었다. 32k lean fixture에서 기존의 실제 압축과 원문 근거 검증을 유지했다.
- 전송 복구 시험 두 개는 큰 입력의 별도 재시도 제한에 걸렸다. 128k fixture로 전송 복구를 분리하고 원래 시도 횟수 검증을 유지했다.
- 보호 메시지 시험은 조언형 검토가 더 이상 추가 읽기를 강제하지 않아 압축에 진입하지 않았다. 네 번째 응답에서 서버의 `context_overflow`를 발생시켜 실제 압축 복구와 반복 제한을 검사했다.
- 도구 스키마 예산은 기존 6,465, 최초 챕터 추가 뒤 6,558로 6,000을 넘었다. 전체 도구 목록의 설명과 중복 매개변수 주석을 줄이고 규칙으로 옮겼다. 최종 스키마는 5,994토큰이다. 스키마의 실제 `description` 속성까지 삭제하던 주석 제거기를 보완했으며 변경 계획 실행으로 확인했다.

두 번째 전체 실행 중 작은 창 회귀 두 개를 확인했다. 전체 도구용 규칙이 lean 요청에도 실려 불필요한 압축을 일으켰다. lean은 기존 도구별 설명과 공통 규칙을 유지하고 전체 목록만 짧은 설명과 이동한 규칙을 사용하도록 고쳤다. 원래 평가 시나리오와 채점은 바꾸지 않았고 압축 알고리즘도 수정하지 않았다.

기존 화면 검사기 다섯 개에는 현재 제품에서 쓰는 WebP 로고 로더가 빠져 있었다. 실패 로그를 확인한 뒤 `.webp` 파일 로더를 추가했다. 제품 이미지와 평가 기준은 그대로다.

Electron 셸 시험은 외부 브라우저 기본 화면을 먼저 검사하고, 기존 내부 브라우저 검사는 격리된 시험 프로필에서 명시적으로 내부 모드를 선택해 유지했다. 내부 화면에서 창 좌표가 어긋나는 실패 두 번과 후속 통과를 모두 보존한다. 중복 스크롤 효과 제거 실험은 실패해 되돌렸으며 제품 renderer는 작업 전과 같다. 후속 실패의 좌표 기록에서 `.desktop-shell`이 가로 95px, 세로 75px 이동함을 확인했다. 외곽 셸만 `overflow:clip`으로 바꿔 프로그램에 의한 스크롤도 막았고, 대화/탭/브라우저의 내부 스크롤은 유지했다. 매 화면에서 외곽 스크롤이 0인지 확인하는 검사와 기존 브라우저/터미널/파일 셸 흐름이 통과했다. 큰 그림자와 모션이 있는 셸의 콘텐츠를 지우거나 레이아웃을 바꾸지는 않았다.

전체 화면 시험의 정지한 작은 로고 가정도 현재 제품과 달랐다. 실제 측정한 기존 `nubi-brand-float`의 6초 주기와 세로 2px 이내 이동, 큰 새의 hover 종료 뒤 `nubi-bird-curious` 복귀로 검사하며 동작 줄이기/배경 일시정지 검증은 유지한다. 새 제품 모션을 추가하지 않았다. 모션 전용 검사도 통과했다.

### 이번 변경 파일

Desktop 기준 새 파일:

- `runtime/chapters.mjs`
- `ui/ChapterMarks.jsx`
- `ui/chapter-marks.css`
- `tests/chapters.test.mjs`
- `scripts/check-wave2-ui.mjs`
- `docs/WAVE2-IMPLEMENTATION-2026-10-17.md`

Desktop 기준 수정 파일:

- `.gitignore`
- `runtime/agent.mjs`
- `runtime/tool-rules.mjs`
- `ui/Workbench.jsx`
- `ui/WorkspaceActivity.jsx`
- `tests/shared-ui-fixture.jsx`
- `tests/approval-diagnostics.test.mjs`
- `tests/compaction-wiki-evidence.test.mjs`
- `tests/recovery.test.mjs`
- `tests/protected-relax.test.mjs`
- `tests/wiki-steering.test.mjs`
- `package.json`
- `scripts/check-modals.mjs`
- `scripts/check-ui-responsiveness.mjs`
- `scripts/check-shared-ui.mjs`
- `scripts/check-codex-chat-ui.mjs`
- `scripts/check-all-surfaces.mjs`
- `scripts/check-electron-shell.mjs`
- `electron-app/shell.css`
- `design/workspace-density.css`

루트 계획 문서의 체크박스와 진행 기록도 갱신했다. 설계 문서 §8에는 Task 2의 승인 규칙 충돌 질문 7을 추가했다.

### 기존 변경과 검증 경계

`runtime/live-editor-host.mjs`, `tests/document-all-work.test.mjs`, `.github/workflows/nubi-desktop-windows.yml`은 이전 1.2.10 문서 편집기 회귀 보완과 Windows 설치판 검사/진단 보존 작업이다. 워크플로에는 Windows 검증 산출물을 `verification.zip`으로 묶어 릴리스에 첨부하는 진단 보존이 포함된다. 세 파일 모두 이전 비공개 릴리스 스냅샷 `4c790e4`와 바이트가 같으며 이번 챕터 작업에서 수정하지 않았다.

합성 모델과 로컬 브라우저 검사는 실제 제공자, 회사 SSO, Windows 11, Office 2016, NASCA 실행 증거가 아니다. Task 1은 로컬 QA까지 완료했고 Claude 검토와 업로드는 남아 있다. Codex는 push하지 않았다.

## Task 2 설계 확인 대기

A5는 외부 발송과 쓰기를 항상 승인 대상으로 두고 정확한 명령만 예외로 정한다. 기존 MCP는 서버와 도구 단위의 항상 허용을 지원한다. 현재 분류는 `readOnlyHint`뿐이어서 읽기 외의 탐색과 외부 발송을 구분하는 계약이 없다. 기존 승인 계약 보존과 새 규칙의 우선순위를 임의로 바꾸지 않기 위해 설계 §8 질문 7을 추가했다. 사용자 지시대로 Task 2 구현과 이후 단계는 답변까지 중단한다.
