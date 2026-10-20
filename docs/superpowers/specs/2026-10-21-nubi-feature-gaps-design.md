# 누비 Workspace 기능 공백 점검과 설계 (2026-10-21, Claude)

사용자 지시(2026-10-21): "기능을 중심으로 부족한 부분을 네가 알아서 찾아서 설계해라." 1.3.0 전부 포함 범위(릴리스 계획)와 실제 사용 여정을 대조해 어느 계획에도 없는 기능 공백과, 계획에는 있지만 순서가 너무 뒤여서 핵심 흐름이 끊기는 항목을 찾았다. 각 항목은 목적, 설계 요지, 파일과 단계, 수용 기준, 배치를 적는다. 구현은 Codex 또는 Claude가 맡고, 설계 변경이 필요하면 §8에 질문을 적는다.

## 1. 점검 방법

하루 업무 여정을 열 단계로 나누고, 각 단계에서 "사용자가 해야 하는 일 / 지금 제품이 해 주는 일 / 끊기는 곳"을 적었다. 근거는 현재 RPC 표면(123개 메서드), Workbench 패널 23개, 설계 §3.8 운영 항목, 릴리스 계획의 과제 묶음이다.

| 여정 단계 | 지금 되는 것 | 끊기는 곳 |
|---|---|---|
| 시작, 모델 연결 | 시작 장면, 4개 제공자 연결, 자동 모델 | 없음 |
| 프로젝트 열기, 위키 준비 | 초기화, 큰 저장소 범위, 내구성, 커버리지, 검색 1단계 | 위키 질문 로그 환류(W10)는 후반 |
| 대화와 작업 | 작업, 질문, 승인 카드, 명령 제자리 출력, 되돌리기 | **놓친 질문/승인/실패를 한곳에서 보는 곳이 없다(G1)** |
| 문서(Office) | 초안, 수정, 네이티브 적용 | 양식 적용(11~13)은 핵심 뒤쪽 |
| 메일 | 수집, 분류, 카드, 보내기 승인 | **메일 도착이 작업이나 워크플로우를 시작하지 못한다(G2)** |
| 루틴 | 일정 + 자유 요청, 질문 대기 알림 | 워크플로우 루틴(Task 9) 런타임은 끝, 화면 연결 남음(G0) |
| 워크플로우 | 가져오기, 검증, 감독 실행, 타임라인, 디자인 정합 | **공유와 버전(§3.8 "AI Workspace에 게시, 다른 누비에서 가져오기, 되돌리기")이 어느 과제에도 없다(G3)** |
| 공유와 협업 | A2A 수락 뒤 실행 | A2A 트리거로 워크플로우 시작(F4)은 3단계 |
| 보고와 사용량 | 실행 보고서, 사용량과 초기화 | 워크플로우 대시보드(F5)는 3단계 |
| 종료, 절전, 업데이트 | 위키 작업의 절전/오프라인 일시 정지, 업데이트 준비 | **에이전트 대화와 워크플로우 실행은 절전/오프라인 규칙이 없다(G4)** |
| 접근성 | 아이콘 라벨, 키보드 선택 | **접근성 최소 규칙이 검사에 없다(G5)** |

## 2. 공백 목록과 우선순위

| 번호 | 공백 | 우선 | 배치 |
|---|---|---|---|
| G0 | 워크플로우 루틴 화면 연결(Task 9 UI, 승격 제안의 소비처) | P0 | Task 9 마무리(Codex) |
| G1 | 행동 필요 목록(놓친 질문, 승인, 실패, 감독 필요, 루틴 오류를 한곳에) | P0 | Buzz B9를 3차 Task 6에서 떼어 핵심 13 뒤로 앞당김 |
| G2 | 메일 도착 트리거(필터 → 작업 또는 워크플로우, 감독 통과 전 무인 금지) | P1 | F4에서 메일 부분만 떼어 L2 뒤에 |
| G3 | 워크플로우 공유와 버전(패키지 내보내기/가져오기, 버전 기록, 되돌리기) | P1 | 저작 UI 6 뒤 |
| G4 | 절전/오프라인 규칙의 일반화(에이전트 대화와 워크플로우 실행) | P1 | W0 패턴 재사용, Q8 뒤 |
| G5 | 접근성 최소 규칙 검사(이름 없는 버튼 0, 포커스 순서, 대비) | P1 | Q7 디자인 검사 공통화에 포함 |

P0는 rc1 전, P1은 1.3.0 최종 전이다. 어느 것도 새 의존성이 없다.

## 3. 설계

### G0. 워크플로우 루틴 화면 연결 (Task 9 UI)

런타임(2026-10-21 Claude 구현): 루틴 레코드 `kind:'prompt'|'workflow'`, `slug`, `inputs`; `definitionHash`(trigger.schedule 제외); 감독 통과 키 `workflow-qualified:<slug>:<definitionHash>`; 루틴 트리거의 무인 시작은 감독 통과 뒤에만, 아니면 `workflow_supervision_required` 알림 한 번; `listWorkflows` 행에 `trigger`, `definitionHash`, `qualified`, `routine{id,enabled,nextRunAt,schedule}`, `proposal`; `registerWorkflowRoutine({slug,enabled})`; YAML `trigger.kind: routine`은 제안 레코드만; 일정 변경은 YAML `trigger.schedule`에 되쓰기; 자유 요청 루틴 3회 성공 뒤 `workflow-promotion:<routineId>` 한 번.

화면(§3.12 양식 재사용):
- `ui/RoutineSettings.jsx`: "실행할 작업" 절의 "요청" 자리에 선택지(대화 요청 / 워크플로우). 워크플로우를 고르면 `listWorkflows`의 유효한 행 중 `trigger.kind==='routine'`인 것을 CxSelect로 보이고, 선택한 워크플로우의 `inputs` 스키마(string, number, integer, boolean만)로 입력 칸을 만든다. 목록 행에는 종류 아이콘(대화: message, 워크플로우: workflow)과 "감독 실행 필요" 상태(루틴 lastError가 `workflow_supervision_required`)를 한 줄로 보이고 버튼은 "감독 실행 열기" 하나다(워크플로우 패널의 해당 행으로 이동). 승격 제안(`workflow-promotion:*`)은 해당 루틴 행 아래 점선 카드 "워크플로우로 만들기"로 보이고, 누르면 요청 한 줄을 agent 단계 하나로 둔 초안 패키지를 `saveImportedWorkflow`로 만든 뒤 워크플로우 패널로 이동한다(§3.5 점선 제안 → 사람 확정). 제안은 한 번만 보이고 "나중에"를 누르면 `state:'dismissed'`.
- `ui/WorkflowPanel.jsx`: 목록 행 `small`에 다음 예정 시각("다음 10. 22. 09:00")과 루틴 배지(아이콘 clock, 켜짐/꺼짐). 상세 머리글 동작에 "루틴으로 등록"(trigger.kind routine이고 routine이 없을 때, `registerWorkflowRoutine`). `proposal`이 있으면 상세 위에 한 줄 "이 워크플로우는 일정이 있어요. 루틴으로 등록할까요?"와 버튼 하나. 감독 통과 여부는 숙성 표시기(2단계 Task 1)가 생기기 전까지 상세의 상태 줄에 "검증됨 / 감독 실행 필요"로만 보인다.
- fixture와 검사: `tests/workflow-workbench-fixture.jsx`, `tests/shared-ui-fixture.jsx`의 `listWorkflows`, `listRoutines`, `saveRoutine` 합성 응답에 새 필드를 넣고 `scripts/check-electron-workflow.mjs`에 루틴 등록, 입력 칸, 감독 필요 상태, 승격 제안 장면을 1280/440으로 추가한다.
- 수용 기준: 시험 (a)~(f) 통과(이미 통과), 화면 검사 1280/440 통과, 디자인 규칙(채움 버튼 하나, 원시 코드 금지) 통과, 캡처 2쌍(루틴 설정, 워크플로우 목록).

### G1. 행동 필요 목록

목적: 질문, 승인, 실패, 감독 필요, 루틴 오류가 대화 카드와 Windows 알림으로 흩어져 있어 자리를 비운 뒤 무엇을 해야 하는지 한눈에 볼 수 없다. Buzz B9(행동 필요 인박스)와 같은 것이며 3차 Task 6에 묶여 너무 뒤에 있다.

설계 요지: 새 저장이 아니라 **파생 목록**이다. `humanDecisions(state)`(이미 있음)에 세 종류를 더해 한 함수 `actionItems(service)`로 만든다. ① 대기 중 질문과 승인(기존), ② 실패한 작업과 partial 워크플로우(최근 7일, 읽지 않은 것), ③ 루틴 오류(`lastError`)와 감독 필요 제안(`routine-proposal`, `workflow-promotion`, `workflow_supervision_required`). 각 항목은 {종류, 프로젝트, 제목, 한 줄 사유, 열기 동작, 생긴 시각}이며 정렬은 질문과 승인 먼저, 그다음 최신순.

화면: 상단 막대 종 아이콘에 개수 알약(이미 아이콘이 있으면 재사용), 누르면 `panel==='actions'` 목록. 행 양식은 진행 기록 행(아이콘, 제목, 한 줄, 오른쪽 시각)이고 버튼은 행마다 "열기" 하나다. 비어 있으면 "처리할 일이 없어요." 한 줄. 읽음 처리는 열기 동작이 곧 읽음이며 별도 체크 없음.

파일: `ui/action-items.mjs`(파생 함수와 시험), `ui/ActionItemsPanel.jsx`, `ui/Workbench.jsx`(패널과 알약), `runtime/project-service.mjs`에 `actionItems` RPC(프로젝트 전체는 호스트의 `routines.list()`와 각 프로젝트 store를 읽는 `ProjectServices` 쪽), `tests/action-items.test.mjs`, `scripts/check-action-items-ui.mjs`(1280/440, 빈 상태와 12건 상태).

수용 기준: 질문 1, 승인 1, 실패 1, 루틴 오류 1, 감독 필요 1을 심은 합성 상태에서 5건이 정해진 순서로 보이고 각 "열기"가 해당 대화나 패널로 간다. Windows 알림(decision notices)과 같은 사건에 대해 중복 생성 없음. 1280/440 캡처.

### G2. 메일 도착 트리거

목적: §3.8의 트리거 네 가지 중 "메일 도착"이 아무 과제에도 없다(F4는 A2A와 묶여 3단계). 메일 분류가 이미 있으므로 "조건에 맞는 메일이 오면 작업이나 워크플로우를 시작"은 작은 추가다.

설계 요지: 루틴의 세 번째 종류가 아니라 **메일 규칙**이다. `mail-rule:<id>` {name, projectId, match:{from?, subjectIncludes?, label?}, action:{kind:'prompt'|'workflow', request?|slug?, inputs?}, enabled, lastMatchedAt}. 기존 메일 수집이 끝날 때 `mailRules.evaluate(messages)`가 조건을 평가해 **한 메일당 한 번**만 실행한다(메일 id로 `mail-rule-run:<ruleId>:<mailId>` 영수증). 워크플로우 동작은 Task 9와 같은 조건(감독 통과 전 무인 금지, 아니면 알림 한 번)을 쓰고, 입력에는 메일 제목/보낸 사람/본문 발췌가 `inputs.mail` 객체로 들어간다(본문은 데이터이지 지시가 아니다. §3.7). 실행 중복 방지는 루틴과 같은 `pending` 규칙을 공유한다.

화면: 메일 패널 설정에 "규칙" 절(목록 행 + 추가). 양식은 루틴 설정과 같은 SettingsSection이며 조건 세 칸과 동작 선택이다.

파일: `runtime/mail-rules.mjs`, `runtime/mail.mjs`(수집 끝 훅 한 줄), `ui/MailRules.jsx`, `tests/mail-rules.test.mjs`, 화면 검사 장면 추가. 수용 기준: 같은 메일로 두 번 실행되지 않음, 조건 불일치 0건 실행, 감독 통과 전 무인 시작 0건, 캡처 2쌍.

배치: L2 뒤, F4(A2A 트리거) 앞. F4는 이 모듈의 `action` 부분을 재사용한다.

### G3. 워크플로우 공유와 버전

목적: §3.8 "공유: AI Workspace에 게시, 다른 누비에서 가져오기. 버전과 되돌리기"가 과제 목록에 없다. 팀이 같은 절차를 쓰려면 패키지를 주고받고 이전 버전으로 돌아갈 수 있어야 한다.

설계 요지: 패키지는 이미 폴더(`.nubi/workflows/<slug>/`)이고 프로젝트가 git이면 이력이 있다. 추가할 것은 셋이다. ① **내보내기**: 패키지 폴더를 단일 `.nubiflow.zip`(workflow.yaml, README.md, fixtures/)으로 만든다. 비밀 패턴과 외부 경로를 검사해 거절한다. ② **가져오기**: 기존 `saveImportedWorkflow` 입구로 zip을 풀어 새 초안 슬러그로 저장한다(덮어쓰기 없음, 실행 없음, 감독 통과는 당연히 없음). ③ **버전**: `workflow.version`을 올릴 때 이전 `workflow.yaml`을 `.nubi/workflows/<slug>/versions/<n>.yaml`로 보관하고 상세에 "이전 버전으로 되돌리기"를 둔다(되돌리기는 새 버전으로 기록, 감독 통과는 definitionHash가 같으면 유지). AI Workspace 게시는 기존 ai_workspace 게시 경로(릴리스 절차 메모)의 파일 첨부로 zip을 올리는 것으로 한정하고, 서버 쪽 카탈로그는 만들지 않는다.

파일: `runtime/workflow-share.mjs`(export/import/version), `ui/WorkflowPanel.jsx`(동작 셋), `tests/workflow-share.test.mjs`. 수용 기준: 내보낸 zip을 다른 프로젝트에서 가져오면 동일 definitionHash, 비밀 패턴 포함 패키지는 내보내기 거절, 되돌린 버전은 새 버전 번호로 기록.

배치: 저작 UI 6 뒤.

### G4. 절전과 오프라인 규칙의 일반화

목적: W0로 위키 작업만 절전과 오프라인에서 멈췄다가 스스로 잇는다. 에이전트 대화와 워크플로우 실행은 모델 호출 중 절전되면 `model_failed`로 끝나고 사람이 다시 시작해야 한다.

설계 요지: `electron-app/wiki-lifecycle.cjs`의 이벤트(suspend, resume, offline, online)를 `lifecycle` 일반 이벤트로 바꾸고, `runtime/recovery.mjs`의 `modelTransport`에 "일시 정지 사유" 하나를 추가한다. 사유가 있으면 새 모델 호출을 시작하지 않고 대기하며, 사유가 풀리면 기존 재시도 정책으로 잇는다. 진행 중이던 호출의 실패는 사유가 있었다면 사용자 오류가 아니라 `paused`로 분류해 자동 재시도 1회를 허용한다. 워크플로우 러너는 단계 시간 제한(W8)에서 일시 정지 시간을 빼고 센다. 화면은 작업 카드에 "절전 중 멈춤, 복귀 뒤 이어감" 한 줄과 하단 상태 막대의 연결 알약(기존 토큰).

파일: `electron-app/wiki-lifecycle.cjs` → `host-lifecycle.cjs`(이름 바꾸고 위키는 그대로 구독), `runtime/recovery.mjs`, `runtime/workflow-runner.mjs`(시간 제한 보정), `tests/lifecycle-pause.test.mjs`. 수용 기준: 절전 주입 중 모델 호출 0건, 복귀 뒤 자동 1회 재시도, 워크플로우 단계 시간 제한이 일시 정지만큼 늘어남, 위키 W0 시험 불변.

배치: Q8 뒤(같은 호스트 이벤트를 다룸).

### G5. 접근성 최소 규칙

목적: §3.12 디자인 규칙은 겉모습 중심이다. 이름 없는 아이콘 버튼, 포커스 순서, 대비는 검사하지 않는다. Q7(디자인 검사 공통화)에 세 규칙을 넣으면 비용이 작다.

설계 요지: `scripts/design-rules.mjs`(Codex가 Q7로 만드는 중)에 ① `button`, `[role=button]`, `a`에 접근성 이름이 비어 있으면 실패, ② 모달이 열리면 포커스가 모달 안에 있고 Tab 순환이 모달을 벗어나지 않음, ③ 본문 글자와 배경 대비 4.5:1 미만(muted 글자는 3:1) 실패를 추가한다. 검사는 기존 공통 화면 38장면 위에서 돌고 새 장면은 없다. 예외는 선언 목록(`design-exceptions.json`)에 사유와 함께만 둔다.

수용 기준: 38장면에서 위반 0 또는 선언 목록에 사유가 있는 항목만. 배치: Q7 안.

## 4. 순서 반영

핵심 13 → rc1 사이에 G0(Task 9 마무리)와 G1을 넣는다. 나머지는 위 배치대로 릴리스 계획 "전부 포함 과제 묶음"에 줄을 추가한다. 이 문서의 설계가 §3의 다른 절과 충돌하면 §8에 질문을 적는다.
