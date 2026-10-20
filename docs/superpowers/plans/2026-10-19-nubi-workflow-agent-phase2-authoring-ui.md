# 누비 워크플로우 에이전트 2단계 구현 계획 (설계 모드 화면과 저작)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 §3.12 설계 모드 1~6을 만든다. 사용자가 대화로 워크플로우 초안을 만들고, 같은 캔버스에서 오류와 숙성 단계를 보고, YAML 원문을 고치고, 합성 실행을 지도 위에서 재생한다. 1단계 Task 15(실행 모드)가 끝난 뒤 시작한다. 2026-10-20 사용자 결정으로 1.3.0에 포함한다(릴리스 계획 후반 순서).

**Architecture:** 새 엔진 없음. 저작 대화는 기존 `createTask` + `startAgent`에 워크플로우 저작 도구 두 개(`workflow_draft`, `workflow_validate`)만 노출한 대화다. 초안은 `.nubi/workflows/<slug>/workflow.draft.yaml`에 쓰고 캔버스는 점선으로 보이며, 사람이 "확정"하면 `workflow.yaml`이 된다(설계 §3.5 "에이전트 제안 노드는 점선"). 오류 배지와 숙성 단계는 기존 `validateWorkflow`, dry-run 레코드, `workflow-qualified` 키에서만 파생한다. 재생은 dry-run 레코드의 단계 시각으로 같은 캔버스에 상태를 덧칠한다.

**Tech Stack:** 1단계와 같다(Node 25 ESM, yaml, ajv, React 18, `@xyflow/react@12.12`, node:test, esbuild 검사, Electron 42). 새 의존성 없음. 원문 편집은 스킬 수정에 쓰는 기존 원문 편집기를 재사용한다.

**Spec:** `docs/superpowers/specs/2026-10-18-nubi-workflow-agent-design.md` §3.12(화면 규칙), §3.5(저작 입구와 동기화), §3.4(검증), §3.10(웹)

**진행 순서:** 1(숙성 표시기) → 2(오류 배지) → 3(YAML 원문 탭) → 4(저작 대화) → 5(dry-run 재생) → 6(웹 동일 화면). 1~3은 작고 독립적이라 먼저 끝내 사용자가 바로 쓰게 한다.

## Global Constraints

1단계 계획 `docs/superpowers/plans/2026-10-18-nubi-workflow-agent-phase1.md`의 Global Constraints를 그대로 적용한다. 특히:
- **웹 호환(설계 §3.10)**: 이 계획의 새 UI 모듈과 파생 모듈(`workflow-errors.mjs`, `workflow-maturity.mjs`의 순수 함수 부분)은 node: import 금지.
- **Apple iOS 벤치마크와 성능**: 전환 280/180ms, `viewTransition.js`와 `modalMotion.js`, `frame-coalescer.mjs` 재사용. 캔버스 상태 변화는 색 크로스페이드 180ms, 레이아웃 재계산은 정의가 바뀔 때만. 메인 스레드 50ms.
- **오픈소스 먼저**: 작업 전 후보 조사(`gh api` 실측)와 채택/패턴 참고/보류 표. 이 계획의 참고: n8n(한 캔버스), LangGraph Studio(되감기), Temporal UI(타임라인). 새 의존성은 들이지 않는다.
- 한국어 메시지, 가운뎃점 금지. 호스트가 검증과 완료를 판정한다. 비밀 평문은 저장 거절. 사내 데이터는 fixture에 넣지 않는다.
- 작업마다 실패 시험 → 구현 → `node --test` → 검사 → `npm run test:gates` → 보고 뒤 멈춤(Claude QA와 업로드). Codex는 push하지 않는다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `runtime/workflow-maturity.mjs` | 숙성 단계 파생(순수 함수 + 저장소 조회 래퍼) |
| `runtime/workflow-errors.mjs` | `validateWorkflow` 오류 경로 → 단계 id와 칸 이름 대응(브라우저 안전) |
| `runtime/workflow-source.mjs` | YAML 원문 읽기/저장(해시 충돌 거절), 초안 파일 확정 |
| `runtime/workflow-author.mjs` | 저작 대화 도구(`workflow_draft`, `workflow_validate`)와 도구 규칙 |
| `runtime/workflow-replay.mjs` | dry-run 레코드 → 재생 프레임(시각 순 상태 배열) |
| `ui/WorkflowMaturity.jsx` | 상단 숙성 단계 표시기 |
| `ui/WorkflowProperties.jsx` | 속성 패널(오류 맨 위, 고칠 칸, 완료 조건, 권한, 위키 근거) |
| `ui/WorkflowSourceTab.jsx` | YAML 원문 탭 |
| `ui/WorkflowAuthorChat.jsx` | 저작 대화(왼쪽 열) |
| `ui/WorkflowReplay.jsx` | 재생 스크럽과 상태 덧칠 |
| `scripts/check-workflow-authoring-ui.mjs` | 설계 모드 장면 검사(1280/440, 토큰, 모션) |

---

## Task 1: 숙성 단계 표시기

**Files:**
- Create: `runtime/workflow-maturity.mjs`, `ui/WorkflowMaturity.jsx`, `tests/workflow-maturity.test.mjs`, `scripts/check-workflow-authoring-ui.mjs`
- Modify: `runtime/workflow-service.mjs`(`listWorkflows`와 `validateWorkflow` 결과에 `maturity`), `ui/WorkflowPanel.jsx`(상단 표시기), `ui/workflow.css`

**Interfaces:**
- Produces: `workflowMaturity({valid, hash, lastDryRun, qualified, routine})` → `{stage:'draft'|'validated'|'synthetic'|'supervised'|'automatic', reasons:[string]}`. 규칙: 저장됨 = draft, `valid` = validated, 같은 `hash`의 dry-run 성공 레코드 = synthetic, `workflow-qualified:<slug>:<hash>` = supervised, 루틴 `kind:'workflow'`가 이 slug를 가리키고 qualified 유지 = automatic. 해시가 다르면 synthetic 이상은 인정하지 않는다.

- [ ] **Step 1: 실패하는 시험** — 순수 함수: 해시 일치/불일치, qualified만 있고 dry-run 없음(=supervised), 루틴은 있으나 qualified 없음(=validated, 사유 "감독 실행이 아직 없어요"). 검사: 표시기 5칸, 현재 칸 `aria-current="step"`, 440px에서 아이콘만.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 서비스는 저장소 조회만 하고 판정은 순수 함수에 맡긴다. 표시기는 글자 대신 아이콘 + 짧은 라벨, 강조는 현재 칸 하나.
- [ ] **Step 4: 시험과 검사** → PASS. `npm run design:check`.
- [ ] **Step 5: 커밋**

---

## Task 2: 노드 위 오류 배지와 속성 패널 수정 안내

**Files:**
- Create: `runtime/workflow-errors.mjs`, `ui/WorkflowProperties.jsx`, `tests/workflow-errors.test.mjs`
- Modify: `ui/WorkflowCanvas.jsx`(노드 `data.errors` → 빨간 배지, 점선은 `data.draft`), `ui/WorkflowPanel.jsx`(기존 단계 정보 aside를 `WorkflowProperties`로 교체), `scripts/check-workflow-authoring-ui.mjs`(오류 장면)

**Interfaces:**
- Produces: `mapWorkflowErrors(workflow, errors)` → `Map<stepId, [{code, field, message}]>`와 `general:[...]`. `/steps/2/adapter` → 세 번째 단계의 `adapter` 칸. 단계와 무관한 오류(`/permissions`, `/lanes`)는 `general`. 브라우저 안전(순수 함수).

- [ ] **Step 1: 실패하는 시험** — 경로 대응 6가지(adapter, tools, done_when, roles, lane, 일반), 포인터 이스케이프(`~1`), 없는 인덱스는 general. 검사: 오류 워크플로우에서 해당 노드에 배지 1개, 노드 클릭 → 속성 패널 맨 위 오류 문장과 칸 이름, 정상 노드에는 배지 없음.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 배지는 토큰 색(`--deck-red` 계열)과 아이콘, 글자 없음. 속성 패널 순서: 오류 → 이름/종류 → 완료 조건(`completionLabel`) → 도구와 권한(`resolvedTools`) → 위키 근거.
- [ ] **Step 4: 시험과 검사** → PASS
- [ ] **Step 5: 커밋**

---

## Task 3: YAML 원문 탭

**Files:**
- Create: `runtime/workflow-source.mjs`, `ui/WorkflowSourceTab.jsx`, `tests/workflow-source.test.mjs`
- Modify: `runtime/workflow-service.mjs`(`readWorkflowSource({slug})`, `saveWorkflowSource({slug,hash,content})`), `runtime/project-service.mjs`(허용 목록), `ui/WorkflowPanel.jsx`(탭: 지도 / 원문), `scripts/check-workflow-authoring-ui.mjs`

**Interfaces:**
- Produces: `readWorkflowSource` → `{content, hash}`; `saveWorkflowSource` → 저장 전 `validateWorkflow`, 비밀 평문 거절(`workflow_secret_plain`), 현재 파일 해시가 `hash`와 다르면 `workflow_changed`로 거절(다른 편집기나 Codex가 고친 경우). 저장 뒤 캔버스는 새 정의로 갱신(레이아웃 재계산은 이때만).

- [ ] **Step 1: 실패하는 시험** — 해시 불일치 거절, 스키마 오류는 저장하지 않고 `errors` 반환, 비밀 평문 거절, 성공 시 새 해시. 검사: 원문 탭에서 한 줄 고치고 저장 → 지도 탭 노드 이름 갱신, 오류 저장 시도 → 오류 문장과 줄 번호(`errors[].path`에서 파생).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 편집기는 기존 원문 편집기 재사용. 탭 전환은 `viewTransition.js`(280ms). 저장 버튼 하나만 강조.
- [ ] **Step 4: 시험과 검사** → PASS
- [ ] **Step 5: 커밋**

---

## Task 4: 저작 대화 (대화로 초안 만들기, 점선 제안, 확정)

**Files:**
- Create: `runtime/workflow-author.mjs`, `ui/WorkflowAuthorChat.jsx`, `tests/workflow-author.test.mjs`
- Modify: `runtime/workflow-source.mjs`(초안 파일 `workflow.draft.yaml` 쓰기와 `confirmWorkflowDraft({slug,hash})`), `runtime/workflow-service.mjs`(`startWorkflowAuthoring({slug|new, goal})`, `confirmWorkflowDraft`), `runtime/agent.mjs`(저작 대화에서만 `workflow_draft`, `workflow_validate` 노출. 기존 `origin` 방식), `runtime/tool-rules.mjs`(저작 규칙 2줄 이내, 도구 예산 시험 유지), `ui/WorkflowPanel.jsx`(왼쪽 열에 저작 대화, 초안 노드 점선), `scripts/check-workflow-authoring-ui.mjs`

**Interfaces:**
- Produces: 도구 `workflow_draft({yaml})` → 호스트가 `validateWorkflow`로 검사해 통과하면 `workflow.draft.yaml`에 저장하고 `{ok, hash, errors}`를 돌려준다(통과 못 하면 저장하지 않고 오류만). `workflow_validate({yaml})` → 저장 없이 검사. 저작 에이전트는 위키를 읽을 수 있다(`wiki_query`, `read_source`, 읽기 도구만). 사람이 "확정"을 누르면 `confirmWorkflowDraft`가 초안을 `workflow.yaml`로 옮기고 해시를 갱신한다. 에이전트는 확정하지 못한다. 저작 대화의 모델 호출은 기존 예산과 압축 규칙을 따른다.

- [ ] **Step 1: 실패하는 시험** — 합성 모델 fixture: 목표 한 문장 → `workflow_draft` 호출 → 초안 저장과 캔버스 점선 노드 4개, 오류 YAML은 저장되지 않고 오류가 모델에 돌아감, 확정 전에는 `listWorkflows`에 초안 표시(`draft:true`)만, 확정 뒤 실선과 `validated`. 도구 예산 시험과 압축 시험 통과 유지.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 저작 대화는 일반 대화 화면 컴포넌트 재사용(말풍선 규칙 그대로). 초안 노드는 점선 테두리와 "제안" 배지. 확정 버튼은 캔버스 상단에 하나.
- [ ] **Step 4: 시험과 검사** → PASS. `npm run test:gates`.
- [ ] **Step 5: 문서와 커밋** — `docs/WORKFLOW-AGENT-2026-10.md` 저작 절.

---

## Task 5: dry-run 재생 스크럽

**Files:**
- Create: `runtime/workflow-replay.mjs`, `ui/WorkflowReplay.jsx`, `tests/workflow-replay.test.mjs`
- Modify: `runtime/workflow-service.mjs`(`workflowReplay({runId})` → 프레임 배열), `ui/WorkflowPanel.jsx`(합성 실행 뒤 "재생" 버튼), `ui/WorkflowCanvas.jsx`(`checkpoints` 입력만 바꿔 상태 덧칠, 재배치 없음), `scripts/check-workflow-authoring-ui.mjs`, `scripts/check-motion-performance.mjs`(스크럽 중 레이아웃 worker 메시지 0회)

**Interfaces:**
- Produces: `replayFrames(run)` → `[{at, statuses:{[stepId]:status}, cursor}]`를 단계 `startedAt`/`finishedAt` 순으로. 프레임 수 상한 2,000. 스크럽은 `frameCoalescer`로 프레임당 한 번만 렌더.

- [ ] **Step 1: 실패하는 시험** — 프레임 순서와 상태 누적, 시각 없는 단계 처리, 상한. 검사: 슬라이더 이동 → 노드 `data-status` 변화, 레이아웃 worker 메시지 0회, 모션 감소 설정에서 즉시 반영.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 시험과 검사** → PASS
- [ ] **Step 5: 커밋**

---

## Task 6: 웹(AI Workspace) 동일 화면

**Files:**
- Create: `scripts/check-workflow-web.mjs`
- Modify: 웹 번들 진입점(AI Workspace의 워크플로우 화면)에 Task 1~5 컴포넌트 포함, 실행 버튼은 Desktop 전용 표시(설계 §3.10)

- [ ] **Step 1: 실패하는 검사** — 웹 번들에 node: import 없음(esbuild `platform:'browser'` 빌드 성공), 설계 모드 1~6 장면 통과, 실행은 web 어댑터 단계만 가능하다는 안내.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 검사** → PASS
- [ ] **Step 5: 커밋과 보고**

---

## 이 계획 밖

드래그 편집(노드 추가와 연결), 시연에서 만들기, 대화 기록에서 만들기, 메일/A2A 트리거, 대시보드. 1단계 Task 8~13과 Task 15가 끝나고 Task 1~3을 먼저 한다.
