# 누비 Workspace 품질 기준선과 보강 (2026-10-05)

전용 Electron 앱(`electron-app/`)을 대상으로 자동 시험을 다시 돌려 기준선을 재고, 실제 결함을 고치고, Electron 본체의 수명주기를 보강했다. 작업은 Codex가 같은 폴더를 고치는 동안 스크래치 사본에서 하고 이 세션이 쓴 파일만 반영했다. 실제 Electron 실행 확인은 macOS에서 했다. Windows 설치판, 실계정, 실모델 품질은 이 기록의 범위가 아니다.

## 1. 자동 시험 기준선

9월 30일 이후 자동 시험이 한 번도 실행되지 않았다(사용자 결정으로 Electron 빌드만 수행). 10월 5일 새벽에 `npm test`를 돌린 결과와 원인은 다음과 같다.

| | 시험 | 통과 | 실패 | 건너뜀 |
|---|---|---|---|---|
| 기준선 (작업 전) | 781 | 561 | 220 | 0 |
| 보강 뒤 (실제 패키지) | 787 | 587 | 5 | 195 |
| 10-06 보강 뒤 (실제 패키지, `npm test`) | 788 | 592 | 0 | 196 |

| 실패 원인 | 개수 | 조치 |
|---|---|---|
| Beta에서 끈 기능(A2A, 앱 조작)의 시험이 `a2a_disabled`, `computer_beta_disabled`로 떨어짐 | 약 175 | `tests/beta-feature.mjs`의 `featureTest`로 기능이 꺼진 동안 건너뛴다(삭제하지 않음). `runtime/beta-features.mjs`에 `a2a:false`를 적었다 |
| Theia 잔재(`@theia/cli`, `@theia/monaco-editor-core`, `mocha`, Theia 위젯) | 5 | `archive-compat` 삭제, `dependency-quality`는 standalone Monaco 0.57의 내장 DOMPurify가 설치본과 같은 3.4.15인지 확인, `project-open`은 Electron 폴더 대화상자 기준 |
| Codex의 의도된 변경에 시험이 못 따라감(위키 갱신 라벨, 75% 요약, Gmail 앱 비밀번호, 스킬 휴지통, GHES 코드, Git 없는 폴더 열기, 검토 복구 호출 수, 핵심 도구 집합) | 약 20 | 시험을 현재 결정에 맞춰 갱신. 근거는 각 시험의 주석 |
| 실제 결함 | 4 | 아래 2절 |
| 메일 시나리오(10-04 메일 정책 변경: 새 설치는 자동 정리 OFF, 기준선 메일 처리, 재시도 횟수) | 5 | 10-06에 해결(5절). 시나리오를 현재 정책에 맞추는 과정에서 런타임 결함 2건을 찾아 고쳤다 |

## 2. 고친 결함

| 결함 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 검토 입력 초과 | 64K 창에서 긴 사용자 메시지 24개가 있는 작업이 답을 쓴 뒤 `context_input_too_large`로 멈춤. 그 복구가 큰 도구 결과를 지워 Wiki 근거까지 사라짐 | `result-review.mjs`가 사용자 메시지 전부(`corrections`)를 검토 입력에 넣고 한도를 넘으면 던짐 | `boundedCorrections`: 검토 입력의 40% 안에서 최신 메시지부터 남기고 나머지는 `omittedCorrections`로 셈. 현재 턴 글도 같은 한도로 자름 |
| Wiki 근거가 참조로 바뀜(B12 회귀) | 압축 뒤 변경 계획이 `wiki_evidence_required`로 거부되고 Wiki를 다시 묻는 반복(2026-09-29 L1/S16의 고리) | 10-04의 `citations` 필드로 `wiki_query` 결과가 공유 압축기의 2,048자 선을 넘어 `cached_tool_result` 참조로 바뀜 | `agent.mjs` `keepWikiVerbatim`: 실행이 처음 본 Wiki 결과(12,000자 이하)를 기억해 참조 자리에 되돌린다. 크기 때문에 지운 결과는 되돌리지 않는다 |
| 작은 창의 요약 여유 | 22K 창에서 75% 트리거가 입력 한도 1,400토큰 아래라 도구 결과 하나로 한도를 넘김 | `context-policy.mjs`가 모든 창에 전체 창의 75%를 적용 | 공유 압축기의 큰 창 기준(입력 128K)부터만 75%, 그 아래는 입력 예산의 75%(화면은 '자동 요약'과 입력 제한 보호 문구) |
| 웹 브릿지 주입 | `</head>`가 없는 페이지에 `host-bridge.js`가 들어가지 않음 | `web-host.cjs`가 `</head>`만 찾음 | `<body>` 바로 뒤, 그것도 없으면 맨 앞에 넣음 |

요청의 고정 비용(지시문과 핵심 도구)이 10-04 이후 lean 창 기준 5,670에서 6,942 토큰으로 늘었다. 22K 창 시나리오 세 파일은 26K로 재기준했고(`compaction-turn`, `protected-relax`, `compaction-wiki-evidence`), 핵심 도구 집합의 크기 상한은 측정값(10,223자, 전체 28,905자)에 맞췄다. 메일 도구와 웹 페이지 도구의 설명은 뜻을 지키며 줄였다.

## 3. Electron 본체 수명주기 (`electron-app/lifecycle.cjs`, `main.cjs`, `preload.cjs`)

| 보강 | 전 | 후 |
|---|---|---|
| 단일 실행 | 바로가기를 두 번 누르면 창과 실행기가 둘 생기고 같은 프로젝트가 `project_locked` | `requestSingleInstanceLock`: 두 번째 실행은 바로 종료하고 첫 창을 앞으로 |
| 창 위치와 크기 | 항상 1480×960 | `storage/window-state.json`에 저장, 다음 실행에 복원. 없어진 모니터 자리면 중앙, 최대화 상태 유지 |
| 실행기 종료 | 실행기가 죽으면 모든 요청이 `host_disconnected`, 앱을 다시 켜야 함 | `WorkerSupervisor`: 10분에 3번까지 0.5초부터 늘어나는 간격으로 다시 시작. 진행 중이던 요청은 영수증으로 확인하도록 거절, 재시작 중 들어온 요청은 기다림. 열려 있던 프로젝트를 새 실행기에서 다시 연 뒤 `nubi:host-event`(`worker_restarting`, `worker_restarted`, `worker_failed`)를 보냄 |
| 화면 프로세스 | 렌더러가 죽으면 빈 창 | 새로고침. 응답 없음이면 "기다리기 / 다시 열기" 대화상자 |
| 실행기 오류 | stderr 버림 | `storage/worker.log`(2MB, 한 번 회전) |
| 종료 | disconnect만 | 2.5초 안에 안 나가면 kill |

렌더러는 `window.nubi.onHostEvent`를 구독해 재시작 중과 재시작 뒤의 토스트, 실패 시 오류 안내를 띄운다(`renderer.jsx`, 10-06). `scripts/check-electron-lifecycle.mjs`가 실제 Electron에서 토스트 문구까지 확인한다.

확인: `tests/electron-lifecycle.test.mjs`(결정 함수와 감독자, Electron 없이), `scripts/check-electron-lifecycle.mjs`(실제 Electron: 실행기 kill 뒤 `worker_restarted`와 프로젝트 복원, 두 번째 실행 종료 코드 0, 창 상태 저장과 복원). 두 번째 것은 단일 실행 잠금 때문에 사용자의 Workspace가 떠 있으면 실행할 수 없다.

## 4. 발견만 하고 넘기는 것

- **시작 모달(해결).** `renderer.jsx`의 `startupConnections`가 실행마다 조건 없이 "메일을 연결해 주세요"를 띄웠다. 사용자 결정(2026-10-05): 자동 정리가 켜져 있고 계정이 없을 때만 띄운다. 호스트가 메일 상태로 `mailPrompt`를 정하고(`lifecycle.cjs` `startupMailPrompt`), 렌더러는 그 값만 본다. `scripts/check-electron-lifecycle.mjs`가 새 저장소에서는 안 뜨고 자동 정리를 켠 저장소에서는 뜨는 것을 확인한다.
- **`scripts/check-electron-shell.mjs`(해결, 10-06).** 9단계(파일 편집기, 저장과 읽기, Git 변경, 커밋 이력, A2A 비활성, 샌드박스, 상주 에이전트, 터미널, 좁은 배치)를 실제 Electron에서 통과한다. 10-04 이후 바뀐 것: 파일은 더블클릭으로 열림, 커밋 이력은 별도 섹션에 Monaco diff, 터미널은 파일 도크의 '도구 추가' 메뉴, 보조 영역은 '오른쪽 사이드바 닫기'. 10-05에 '파일 편집기' 단계에서 멈춘 원인은 내가 줄 중간에 넣은 `//` 주석이 뒷부분(탭 대기, 단계 기록)을 지운 것이었다.
- **닿지 않는 코드.** Git 없는 폴더도 열리므로 `project-setup.mjs`의 승인 설정 흐름과 `ProjectSetup.jsx`는 호출되지 않는다. `vendor/decompress-compat`는 Theia 제거 뒤 쓰는 곳이 없다.
- **문맥 압축의 공유 의존.** Wiki 근거 보존은 Desktop 쪽에서 되돌리는 방식이다. 공유 압축기(`extensions/aipro-chat/context-evidence.js`)의 `cacheableReads`에서 Wiki 도구를 빼면 근본 해결이지만 브라우저 누비의 동작도 바뀌므로 그 세션과 조율한다.

## 5. 2026-10-06 보강: 메일 런타임, 검증 스크립트, 화면 결함

메일 시나리오 5건을 현재 정책에 맞추는 과정에서 런타임 결함 2건을 찾아 고쳤고, 10-02 이후 화면 변경과 어긋난 검증 스크립트를 현재 화면에 맞췄다. 이 보강 뒤 `npm test`는 788개 중 592 통과, 0 실패, 196 건너뜀(끈 기능)이다.

### 5.1 메일 런타임 결함 (`runtime/mail.mjs`)

| 결함 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 저장 직전 끊긴 Wiki가 복구되지 않음 | Wiki 파일은 다 썼는데 기록 직전에 실패(충돌, 저장 오류)하면 메일이 `확인 필요`로 남고, 앱을 다시 켜도 다시 시도해도 그대로 | `retry`와 `drain`이 연결된 계정과 모델이 있어야 움직이는데, 재시작 뒤에는 계정(`this.account`)이 없어 아무 행도 고르지 못함 | 준비된 Wiki(`prepared`)는 파일 해시만 확인하면 되므로 계정과 모델 없이 복구하는 `reconcilePrepared`를 두고 시작 시와 `retry`에서 실행. 저장 단계는 `savePrepared`로 묶어 `drain`과 공유. 모델은 다시 부르지 않는다 |
| 모델 실패가 저장 실패로 보임 | 모델 응답 실패(네트워크, 한도)가 재시도 뒤 `mail_storage_failed`로 기록되고 화면에는 저장 문제처럼 보임 | 알 수 없는 오류를 모두 저장 실패로 묶는 `code()` | 모델 단계 오류는 `mail_summary_failed`, 중단은 `mail_cancelled`. 재시도는 메일 자체 모델(`backgroundModel`)을 고정하므로 호스트의 모델이 바뀌어도 다른 모델을 쓰지 않는다. 화면 문구(`ui/MailLibrary.jsx`) 추가 |

### 5.2 메일 시나리오 갱신 (`tests/mail.test.mjs`)

- 기준선 메일도 정리된다(10-04 결정 "ON은 서버에 남은 메일을 가져온다"의 결과): 수집 시나리오는 두 메일이 각각 한 번씩 정리되는 것으로 센다.
- 자동 정리 ON은 서버가 정한 다음 확인 시각부터 수집한다(`mail_check_wait` 정책). 시나리오는 직접 `cycle()`로 확인한다.
- 재시도는 메일 자체 모델을 고정한다: 호스트 모델이 바뀌어도 세 번 모두 같은 모델로 부르고, 끝에 `mail_summary_failed`를 남긴다.
- 검색 v2는 사용자가 고친 Wiki를 `changed` 목록 대신 `matches[].sourceState==='edited'`로 알린다.
- 모델 미선택 거부 코드는 `mail_model_missing`이다.
- `settled()`는 수집, 첨부 읽기, 정리, 복구가 모두 50ms 동안 없을 때 끝난다(이어지는 행 처리를 놓치지 않도록).
- 사용자 결정(2026-10-07): 자동 정리는 나중에 연결된 모델을 자동으로 쓴다. 명시적으로 다른 모델을 고르면 그 선택이 우선한다(`a model connected later is used automatically`). 이 결정으로 메일 시험 10개가 모두 실행되고 통과한다.

### 5.3 검증 스크립트

| 검사 | 상태 | 현재 화면에 맞춘 것 |
|---|---|---|
| `test:shell`(`check-electron-shell.mjs`) | 통과(9단계) | 4절 참고 |
| `test:lifecycle`(`check-electron-lifecycle.mjs`) | 통과 | 시작 모달 조건, 실행기 재시작 토스트, 종료 직후 재실행(10-07: 위 종료 대기 수정으로 안정) |
| `design:check` | 통과 | 공유 팔레트 값을 컴포넌트 범위에서 다시 정의해도(`.nubi-applied-menu`) 값이 같으면 통과. 값이 다르면 실패 |
| `test:mail-ui` | 통과 | '메일 설정' 다이얼로그, 단계형 양식(서비스와 아이디 → 비밀번호 → 연결), 연결 실패 시 비밀번호를 비우고 토스트로 알림(현재 설계), `메일 자동 정리` 스위치, '메일 로그아웃'. 검색은 메일 페이지로 옮겨가 이 검사에서 뺌 |
| `test:shared-ui` | 통과(30개, 2026-10-07) | 로그인과 작성창, 모델 표시, 승인 방식(제목 있는 다이얼로그), 대화 흐름(답변 article은 모델 이름 라벨), 작업 계획(실행별 `runId`, 현재 실행은 펼침), 대화 검색과 새 대화(사이드바), 압축 상태(활동 섹션의 현재 단계), 컨텍스트 사용량(정책 행 75%), 관리자 승인, **문서 분석 6개 시나리오**(아래 5.4의 분석 이력 복원), 대화 목록(날짜별, 초안 유지, 삭제 확인은 10-02 결정대로 취소와 확인), 프로젝트 시작(카드와 Git URL 양식). 앱 조작 시나리오 5묶음은 `DESKTOP_FEATURES.computerUse`가 꺼진 동안 건너뜀. 좁은 창의 사이드바 단계는 Electron 배치(`integrated`)로 돌린다: 공유 배치에는 440px에서 사이드바 여는 버튼이 없다 |
| `test:modals-ui` | 통과(20개, 1280px과 440px) | Electron 배치(`integrated`, 픽스처가 `workspaceView`를 넘김): 설정, 프로젝트 자료, 메일 설정(메일 페이지의 '메일 연결'에서, Escape는 그 버튼으로 복귀), 스킬 관리(작성창 스킬 메뉴의 '커스텀 관리'), 대화 검색, 컨텍스트 사용량, 모델 선택과 FabriX 연결, 승인 방식 메뉴, 삭제 확인. 큰 글자 토글과 앱 연결, OpenWiki 다이얼로그는 화면에서 빠져 제외. 메일 페이지 픽스처는 `search`, `facets`, `history`, `skillTrash` 응답이 필요. 등록 버튼의 알약 모서리는 설계(`workspace-identity.css`)라 칩으로 인정 |
| `test:skills-ui`(Theia) | 제외 | 사용자 결정(2026-10-07): Theia는 쓰지 않는다. 스크립트와 npm 항목을 지웠다. Electron에서도 스킬 등록은 모델 로그인 뒤 작성창의 스킬 메뉴에서만 열려 자동 검사에는 합성 모델이 필요하다(없음). 대화상자는 `test:modals-ui`가, 가져오기는 단위 시험(`skill-import`, `skill-marketplace`)이 덮고, `main.cjs`의 네이티브 선택 창에서 `importSkill`로 이어지는 연결만 수동 확인 대상으로 남는다 |

### 5.4 찾은 화면 결함

- **대화 검색에서 고른 대화가 메일 페이지 뒤에 가려짐.** 사이드바에서 대화를 고르면 메일 페이지를 닫는데(`setMailPage(false)`), '대화 검색' 다이얼로그에서 고르면 `selectSession`만 불러 메일 페이지가 그대로 남았다. `selectSession`이 메일 페이지도 닫도록 고쳤다(`ui/Workbench.jsx`). 모달 검사가 이 경로를 지난다.
- **분석 이력 섹션이 빠짐.** 10-04의 실행별 활동 재설계가 `AnalysisHistory`(문서 분석 진행: 역할, 범위, 일부 확인, 읽지 못한 구간, 이전 분석 페이징, 검토 진행) 렌더링을 떨어뜨렸다. 런타임은 계속 기록을 저장하고(`analysisHistory`), 활동 trace에는 분석 작업자가 "완료/중" 한 줄로만 남아 일부 확인 결과와 범위가 보이지 않았다. 현재 실행의 활동 바로 뒤에 섹션을 복원하고, 이전 Workbench처럼 분석 작업자 단계는 활동 trace에서 뺐다(`ui/Workbench.jsx`, `ui/WorkspaceActivity.jsx`). 공유 UI 검사의 문서 분석 6개 시나리오가 이 화면을 지난다.
- **종료 직후 다시 실행하면 `project_locked`.** 종료 시 호스트는 실행기에 연결 해제만 보내고 바로 나갔고, 실행기는 정리 뒤 1.8초 뒤에 나가면서 그동안 프로젝트 저장소의 잠금(`owner.db`)을 쥐고 있었다. 그 사이에 다시 실행하면 프로젝트가 `project_locked`로 열리지 않았다(수명주기 검사의 재실행 단계에서 재현). 종료는 실행기가 나갈 때까지 기다리고(`WorkerSupervisor.stop()`이 종료를 돌려줌, `before-quit`가 기다린 뒤 종료), 프로젝트 열기는 `project_locked`에 한해 짧게 다시 시도한다(600ms 간격 4회: 단일 실행 잠금이 있어 살아 있는 두 번째 인스턴스는 아니다). `electron-app/lifecycle.cjs`, `electron-app/main.cjs`.
- **프로젝트가 없을 때 빈 프로젝트 라벨.** 머리글이 이름 없는 빈 `nubi-project-label`을 그렸다(사용자 결정 2026-09-30: 프로젝트 이름이 없으면 라벨도 없음). 이름이 있을 때만 그린다.
- **좁은 창에서 대화 검색으로 고른 뒤 사이드바가 덮고 있음.** 좁은 배치(900px 미만)의 사이드바는 내용 위에 겹치는 덮개인데, 사이드바 목록에서 고르면 닫히고 '대화 검색'에서 고르면 열린 채 남아 작성창을 가렸다(모달 검사 440px에서 '스킬 관리' 버튼을 누르지 못함). 다이얼로그 선택도 좁은 배치에서는 사이드바를 닫도록 고쳤다.

## 6. 2026-10-07 정리: 검증 게이트와 남은 개선 후보

사용자 결정(2026-10-07): 검증과 수정은 Electron 앱만 대상으로 한다. 그에 맞춰 검증 체계를 정리했다.

- **게이트 한 번에 실행**: `npm run test:gates`가 단위 시험, 팔레트, 양식, 메일 UI, 모달, 공유 UI 검사, Electron 빌드, 셸 검사, 수명주기 검사를 차례로 돌린다. 브라우저 검사는 동시에 돌리면 Chrome이 멈추므로 반드시 차례로 돌린다.
- **공유 UI 검사는 Electron 배치(`integrated`)로**: 모든 페이지를 레일 탐색, 사이드바 토글, 메일 페이지가 있는 배치로 연다. 픽스처는 `integrated`에도 `workspaceView`를 넘긴다. 좁은 창(440px)에서는 사이드바가 내용을 덮는 덮개이므로 검사는 내용을 만지기 전에 사이드바를 접는다.
- **Theia 기반 검사 제거**: `test:skills-ui`, `test:setup-ui`, `test:mail-host-ui`는 Theia 브라우저 앱을 띄우던 검사라 npm 항목과 스크립트를 지웠다. 설정 흐름 검사는 Electron에서 Git 없는 폴더도 바로 열리므로 닿지 않는 흐름이었고, 메일 호스트 검사는 `test:mail-ui`와 모달 검사가 덮는다.
- **`decompress` 의존성 제거**: `package.json`만 `file:./vendor/decompress-compat`를 가리키고 잠금 파일과 `node_modules`에는 없었다(Theia 시절 호환 shim, 어느 소스도 가져오지 않음). 항목과 `vendor/decompress-compat`를 지워 `package.json`과 잠금 파일을 맞췄다.
- **Electron 셸 검사 보강**: 레일의 메일 페이지와 메일 설정 다이얼로그, 프로젝트 자료, 설정 다이얼로그를 모델 없이 지나는 단계를 더했다.

남은 개선 후보(이번에 손대지 않음):

| 후보 | 이유 | 비고 |
|---|---|---|
| `runtime/project-setup.mjs`, `ui/ProjectSetup.jsx`, `setup-actions` 흐름 제거 | Git 없는 폴더도 열리므로 `setup`이 채워지지 않아 화면에 닿지 않는다 | Codex의 설계 의도 확인 뒤 제거. 시험 `tests/project-setup.test.mjs`와 함께 |
| 스킬 등록 Electron 자동 검사 | 스킬 관리가 작성창(모델 로그인 뒤)에서만 열린다 | 검사용 합성 모델 제공자가 있어야 가능 |
| 공유 압축기의 Wiki 근거 보존 | Desktop이 결과를 되돌리는 방식(B12) | 공유 `context-evidence.js` 수정은 브라우저 세션과 조율 |
| 분석 이력 섹션의 trace 중복 | 분석 작업자 단계를 trace에서 뺐으므로 중복은 없으나, 이전 실행(activityHistory)의 분석 기록은 섹션의 '이전 분석'에만 보인다 | 실행별로 나눠 보여 줄지는 설계 결정 |
