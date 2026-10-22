# 누비 Desktop 가벼운 흐름 계획 1: 워크플로우 끄기와 무거움 원인 제거

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크플로우와 루틴을 출시 스위치로 끄고, 스타일 다시 계산을 폭증시키는 `:has()`와 쉬는 동안 도는 배경 움직임을 없애 GPU 없는 PC에서도 대화, 메일, 위키 화면이 끊기지 않게 한다.

**Architecture:** 출시 정책 스위치 `DESKTOP_FEATURES`에 `workflows:false`를 더하고, 호스트(서비스 메서드, 에이전트 도구, 루틴 예약)와 UI(메뉴, 루틴 설정, 녹화 카드 저장)가 같은 스위치를 읽는다. CSS의 `:has()`는 React가 상위 노드에 다는 상태 속성(`data-*`)과 컴포넌트 클래스으로 바꾸고, 설계 규칙 검사로 다시 들어오지 못하게 막는다. 측정은 기존 `check-freeze-scenes.mjs`에 GPU 끔과 CPU 늦춤 조건을 정식으로 더해 바꾸기 전과 후를 같은 조건에서 비교한다.

**Tech Stack:** Electron, React, esbuild 번들 CSS, node:test, Playwright(Chrome headless, Electron).

**Spec:** `docs/superpowers/specs/2026-10-22-nubi-desktop-light-flow-design.md` (§1.1, §2 목표 1과 2, §5.1, §6, §7). 계획 2(표현 체계: 글꼴, 아이콘, 메시, 유리, 끈적한 메뉴, 스프링, 빛, 모래시계, 덮어쓰기 층 합치기, CX 미사용 규칙 빼기와 앱 화면에서 쓰는 CX `:has()` 44개 정리, CSS 크기 절반 판정)와 계획 3(다재다능한 오른쪽 창, 옆 창, 자동 열기)은 이 계획이 끝난 뒤 따로 쓴다.

## Global Constraints

- 기준 커밋: main `e123ae82`. 모든 작업은 main 판 파일에서 시작한다. 작업 폴더의 Codex WIP를 기준으로 삼지 않는다.
- 사용자에게 보이는 글은 한국어, 짧은 문장, 가운뎃점 없음.
- 스위치는 `runtime/beta-features.mjs`의 `DESKTOP_FEATURES` 하나다. 환경 변수나 사용자 설정으로 우회하지 못한다.
- 워크플로우와 루틴 코드, 시험, 저장 데이터는 지우거나 고치지 않는다. 끈 기능의 검사는 건너뛰고 건너뛴 사실을 출력한다. 게이트 목록에서 빼지 않는다.
- 시험, 한도, 정답을 통과용으로 고치지 않는다. 화면 구조가 바뀌어 검사 대상이 바뀌면 같은 기능을 확인하도록 옮기고 커밋 메시지에 적는다.
- 앱 CSS(`design/`, `ui/`, `electron-app/`)의 `:has()`는 0개로 끝난다. CX 디자인 시스템 패키지(`@e2e/cx-design-system`)는 고치지 않는다.
- 화면 결과는 바뀌지 않는다. 1280과 440 캡처를 바꾸기 전과 비교한다.
- 공용 러너(`NUBI_SHARED_RUNNER=1`)의 시간 수치는 기록만 한다. 시간 판정은 조건 A(로컬 Mac, Chrome headless, `--disable-gpu`, CPU 4배 느림)에서 한다.
- 업로드와 릴리스는 Claude가 업로드 스크립트로 한다. Codex는 푸시하지 않는다.

## Review Focus

1. 업데이트 전에 켜 둔 루틴이 있는 사용자: 업데이트 뒤 예약 실행이 멈추고, 처음 켤 때 알림이 한 번만 뜨며, 저장된 루틴은 그대로다. (Task 2)
2. 업데이트 순간 진행 중이던 워크플로우 대화(`task.kind==='workflow'`)나 워크플로우 단계 대화: 열면 화면이 깨지지 않고, 이어 하기 대신 "이 판에서는 워크플로우가 꺼져 있어요"를 보여 준다. (Task 1, Task 3)
3. 예전 대화 기록에 워크플로우 도구 호출이 남아 있어도 기록 화면이 그대로 그려진다. (Task 3)
4. `:has()`를 상태 속성으로 바꾼 뒤 상태가 어긋나는 경우: 메일 진행 막대가 사라진 뒤에도 머리글 간격이 남거나, 좁은 창에서 사이드바를 닫았는데 겹침 스타일이 남는 것. 상태를 켜고 끄는 왕복을 캡처로 확인한다. (Task 5)
5. 줄인 움직임 설정, 창 숨김, 다시 보이기: 배경 움직임을 멈춘 뒤 다시 보일 때 멈췄던 것이 되살아나지 않는다. (Task 7)

---

### Task 0: 기준 측정과 Codex 조율

**Files:**
- Modify: `scripts/check-freeze-scenes.mjs` (조건 A 실행 인자)
- Create: `docs/LIGHT-FLOW-BASELINE-2026-10-22.md`

**Interfaces:**
- Produces: `check-freeze-scenes.mjs`가 읽는 환경 변수 `FREEZE_CHROME_ARGS`(공백으로 나눈 Chrome 인자, 브라우저 모드에서만), `FREEZE_CPU_THROTTLE`(정수 배율, 1이면 끔), `FREEZE_TRACE=1`일 때 장면 행에 `styleRecalcMaxMs`, `styleRecalcTotalMs`를 더한다.

- [ ] **Step 1:** Codex에 워크플로우 제거 작업을 멈추라고 전하고, 작업 폴더에서 바뀐 워크플로우 관련 파일 목록을 받는다(이미 `scripts/check-electron-workflow.mjs` 삭제와 `runtime/agent.mjs`의 `feature_removed`가 보임). 이 계획은 main 판에서 시작하고 그 변경은 쓰지 않는다.
- [ ] **Step 2:** `check-freeze-scenes.mjs`에 위 세 가지를 더한다. 브라우저 실행 인자는 `chromium.launch({channel:'chrome',headless:true,args})`, 늦춤은 장면 페이지를 연 직후 CDP `Emulation.setCPUThrottlingRate`, 스타일 수치는 이미 저장하는 추적(`-trace.json`)의 `UpdateLayoutTree` 이벤트 길이에서 계산한다. 기본값에서는 지금과 결과가 같아야 한다.
- [ ] **Step 3:** 조건 A로 기준선을 잰다.
  Run: `FREEZE_CHROME_ARGS=--disable-gpu FREEZE_CPU_THROTTLE=4 FREEZE_TRACE=1 FREEZE_TAG=light-baseline node scripts/check-freeze-scenes.mjs`
  Expected: 장면별 행(chat, wiki, mail, workflow, terminal, navigation × 1280, 440)이 출력된다. 판정 실패로 끝나도 행은 남는다.
- [ ] **Step 4:** 장면별 긴 작업 수, 놓친 프레임 비율, 프레임 p95와 최대, 스타일 계산 최대와 합계, 묶인 CSS 크기(`verification/freeze-1.3.0/light-baseline/browser/fixture/app.css` 바이트), 앱 CSS `:has(` 수를 표로 `docs/LIGHT-FLOW-BASELINE-2026-10-22.md`에 적는다. 같은 조건의 1280과 440 장면 캡처 경로도 적는다(Task 5의 비교 기준).
- [ ] **Step 5:** 커밋. `git commit -m "chore: 가벼운 흐름 기준 측정 조건 A"`

### Task 1: 워크플로우 스위치와 호스트 차단

**Files:**
- Modify: `runtime/beta-features.mjs`
- Create: `runtime/workflow-feature.mjs`
- Modify: `runtime/project-service.mjs:458` (`installWorkflowService(ProjectService)` 다음 줄)
- Modify: `runtime/agent.mjs` (워크플로우 대화 시작 `:286`, 이어 하기 `:1035`, 취소 `:1053`, `discover_capabilities` 결과)
- Test: `tests/workflow-feature.test.mjs`

**Interfaces:**
- Produces: `DESKTOP_FEATURES.workflows` (불리언, 이 판에서 `false`).
- Produces: `workflowsEnabled(features=DESKTOP_FEATURES): boolean`
- Produces: `requireWorkflows(features=DESKTOP_FEATURES): void`, 꺼져 있으면 `Error('workflow_feature_off')`.
- Produces: `guardWorkflowMethods(ProjectService, features=DESKTOP_FEATURES): string[]` — `installWorkflowService`가 붙인 프로토타입 메서드(`importBlueprint`, `importE2eTask`, `listWorkflows`, `registerWorkflowRoutine`, `validateWorkflow`와 그 파일이 붙이는 나머지 전부)를 감싸 첫 줄에서 `requireWorkflows(features)`를 부른다. 감싼 이름 목록을 돌려준다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
test('workflows are off in this release and the switch has no bypass',()=>{
  assert.equal(DESKTOP_FEATURES.workflows,false);
  assert.ok(Object.isFrozen(DESKTOP_FEATURES));
});
test('every workflow service method refuses while the switch is off',async()=>{
  class Fake{}; installWorkflowService(Fake);
  const names=guardWorkflowMethods(Fake,{workflows:false});
  assert.ok(names.includes('listWorkflows')&&names.includes('registerWorkflowRoutine'));
  for(const name of names)await assert.rejects(async()=>Fake.prototype[name].call(new Fake(),{}),/workflow_feature_off/);
});
test('the guard passes through when the switch is on',async()=>{
  class Fake{}; Fake.prototype.listWorkflows=async()=>['ok'];
  guardWorkflowMethods(Fake,{workflows:true});
  assert.deepEqual(await Fake.prototype.listWorkflows.call(new Fake()),['ok']);
});
test('a stored workflow conversation cannot resume and says why',async()=>{
  const service=await openFixtureService(); // tests/helpers 기존 서비스 픽스처
  service.store.set('task:w1',{id:'w1',kind:'workflow',state:'waiting',workflowRunId:'r1',question:{id:'q'}});
  await assert.rejects(()=>service.answer({taskId:'w1',answer:'x'}),/workflow_feature_off/);
});
test('discover_capabilities lists no host workflows while off',async()=>{
  const result=await discoverForFixture({query:'정의서'}); // agent-capabilities 기존 시험 도우미
  assert.deepEqual(result.workflows??[],[]);
});
```

- [ ] **Step 2: 실행해 실패를 본다**
  Run: `node --test tests/workflow-feature.test.mjs`
  Expected: FAIL (`workflowsEnabled` 없음, `DESKTOP_FEATURES.workflows` undefined).
- [ ] **Step 3: 구현한다**
  `DESKTOP_FEATURES`에 `workflows:false`를 더하고 파일 머리 주석에 "workflows: 2026-10-22 사용자 결정으로 끔. 기능 검사 뒤 다시 켠다."를 적는다. `runtime/workflow-feature.mjs`에 위 세 함수를 둔다. `project-service.mjs`에서 `installWorkflowService(ProjectService)` 바로 다음에 `guardWorkflowMethods(ProjectService)`를 부른다. `agent.mjs`의 워크플로우 대화 시작, 이어 하기, 취소 분기 첫 줄에 `requireWorkflows()`를 넣고, `discover_capabilities`는 꺼져 있으면 워크플로우 목록을 비운다. 저장된 데이터는 읽지도 고치지도 않는다.
- [ ] **Step 4: 통과를 본다**
  Run: `node --test tests/workflow-feature.test.mjs tests/workflow-service.test.mjs tests/workflow-run.test.mjs tests/agent-capabilities.test.mjs`
  Expected: 새 시험 PASS. 기존 워크플로우 시험 중 서비스 메서드를 직접 부르는 시험은 `workflow_feature_off`로 실패한다. 그 시험 파일들은 머리에서 `const off=!DESKTOP_FEATURES.workflows`를 읽어 `test(name,{skip:off&&'workflows feature off (2026-10-22)'},fn)`로 건너뛴다. 건너뛴 수를 커밋 메시지에 적는다.
- [ ] **Step 5:** 커밋. `git commit -m "feat: 워크플로우 출시 스위치로 호스트 차단"`

### Task 2: 루틴 예약 멈춤과 한 번 알림

**Files:**
- Modify: `runtime/service-entry.mjs:26` (`createRoutineManager` 호출)
- Modify: `runtime/routines.mjs` (알림 표시 기록 키)
- Test: `tests/routines.test.mjs` (기존 파일에 추가)

**Interfaces:**
- Consumes: `workflowsEnabled()` (Task 1).
- Produces: `routineNotice(store): {show:boolean, text:string}` — 저장된 루틴이 하나 이상이고 `store.get('notice:routines-paused-1.3.1')`가 없으면 `show:true`. 문구는 정확히 `"루틴은 다음 판에서 다시 켜집니다. 저장한 루틴은 그대로 있어요."`.
- Produces: `acknowledgeRoutineNotice(store): void` — 위 키에 `{at: ISO 문자열}`을 기록한다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
test('routines never start while workflows are off and stored routines stay untouched',async()=>{
  const store=memoryStore(); store.set('routine:a',{id:'a',enabled:true,schedule:everyMinute,kind:'prompt',projectId:'p'});
  const before=JSON.stringify(store.get('routine:a'));
  const manager=createRoutineManager({store,listProjects:async()=>[{id:'p'}],serviceFor:()=>assert.fail('must not start'),canStart:()=>workflowsEnabled({workflows:false}),now:()=>Date.parse('2026-10-23T00:00:00Z')});
  await manager.tick();
  assert.equal(JSON.stringify(store.get('routine:a')),before);
});
test('the paused-routines notice shows once',()=>{
  const store=memoryStore(); store.set('routine:a',{id:'a'});
  assert.deepEqual(routineNotice(store),{show:true,text:'루틴은 다음 판에서 다시 켜집니다. 저장한 루틴은 그대로 있어요.'});
  acknowledgeRoutineNotice(store);
  assert.equal(routineNotice(store).show,false);
});
test('no notice when the person never saved a routine',()=>{assert.equal(routineNotice(memoryStore()).show,false);});
```

  예약 실행 함수 이름이 `tick`이 아니면 `routines.mjs`가 시간을 넘길 때 쓰는 실제 이름으로 바꾼다.
- [ ] **Step 2:** Run: `node --test tests/routines.test.mjs` — Expected: 새 시험 FAIL.
- [ ] **Step 3:** `service-entry.mjs`의 `createRoutineManager`에 `canStart:()=>workflowsEnabled()&&<지금 canStart 조건>`을 넘긴다. `routineNotice`와 `acknowledgeRoutineNotice`를 `routines.mjs`에 둔다. `canStart`가 거짓일 때 다음 실행 시각(`nextRunAt`)이나 마지막 실행 기록을 바꾸지 않는지 확인하고, 바꾼다면 그 갱신을 건너뛴다.
- [ ] **Step 4:** Run: `node --test tests/routines.test.mjs tests/routine-ui.test.mjs` — Expected: PASS.
- [ ] **Step 5:** 커밋. `git commit -m "feat: 워크플로우가 꺼진 동안 루틴 예약 멈춤과 한 번 알림"`

### Task 3: 화면에서 워크플로우와 루틴 숨기기

**Files:**
- Modify: `ui/Workbench.jsx` (`:908` `WorkspaceNavigation`에 `onWorkflow` 전달, `:1026` 루틴 패널, 루틴 알림 토스트)
- Modify: `ui/WorkspaceNavigation.jsx:24`
- Modify: 브라우저 녹화 카드의 "워크플로우 단계로 저장" 단추가 있는 컴포넌트(main에서 `git grep -n "워크플로우" -- packages/nubi-desktop/ui packages/nubi-desktop/electron-app`로 찾는다)
- Modify: 워크플로우 대화 화면에서 이어 하기 단추를 그리는 곳
- Test: `scripts/check-shared-ui.mjs` (꺼진 기능 확인 장면 추가)

**Interfaces:**
- Consumes: `DESKTOP_FEATURES.workflows`, `routineNotice`/`acknowledgeRoutineNotice`(Task 2, 기존 서비스 요청 경로로 노출).

- [ ] **Step 1: 실패하는 검사를 쓴다** — `check-shared-ui.mjs`에 장면 하나를 더한다.

```js
if(!DESKTOP_FEATURES.workflows){// workflows feature off since 2026-10-22: nothing workflow-shaped is reachable
  assert.equal(await page.getByRole('button',{name:'워크플로우',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'루틴으로 등록',exact:true}).count(),0);
  await openSettings(page); assert.equal(await page.getByText('루틴',{exact:true}).count(),0);
  await openStoredWorkflowConversation(page); // 픽스처에 kind:'workflow' 대화 하나
  await page.getByText('이 판에서는 워크플로우가 꺼져 있어요.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'이어 하기',exact:true}).count(),0);
  checks.push('workflows-off');
}
```

- [ ] **Step 2:** Run: `node scripts/check-shared-ui.mjs` — Expected: FAIL(워크플로우 단추가 있음).
- [ ] **Step 3:** 스위치가 꺼져 있으면 `onWorkflow`를 넘기지 않고, `panel==='routines'`로 가는 진입점을 그리지 않고, 녹화 카드의 워크플로우 저장 단추를 그리지 않는다. 워크플로우 대화는 기록을 그대로 보여 주고 이어 하기 대신 위 문구 한 줄을 보인다. 루틴 알림은 `routineNotice().show`일 때 기존 토스트 양식으로 한 번 띄우고, 닫으면 `acknowledgeRoutineNotice`를 부른다.
- [ ] **Step 4:** Run: `node scripts/check-shared-ui.mjs && npm run test:forms-ui && node scripts/check-browser-teach-ui.mjs` — Expected: PASS. 녹화 카드 검사가 저장 단추를 찾던 부분은 스위치를 읽어 건너뛴다.
- [ ] **Step 5:** 커밋. `git commit -m "feat: 워크플로우와 루틴 진입점 숨김"`

### Task 4: 꺼진 워크플로우 검사 건너뛰기

**Files:**
- Modify: `scripts/check-workflow-ui.mjs`, `scripts/check-electron-workflow.mjs`, `scripts/workflow-routine-scenes.mjs`를 부르는 곳, `scripts/check-freeze-scenes.mjs`의 `workflow` 장면
- Test: `tests/desktop-gates-workflow.test.mjs` (기존)

**Interfaces:**
- Produces: 건너뛸 때 표준 출력 한 줄 `{"check":"<이름>","skipped":"workflows_feature_off"}`, 종료 코드 0.

- [ ] **Step 1:** `tests/desktop-gates-workflow.test.mjs`에 시험을 더한다: `gate-baseline.json`에 `check-workflow-ui.mjs`와 `check-electron-workflow.mjs`가 그대로 있고, 각 파일 첫 실행 경로가 `DESKTOP_FEATURES.workflows`를 읽어 위 한 줄을 출력한다(파일 원문에서 `skipped":"workflows_feature_off` 문자열 확인).
- [ ] **Step 2:** Run: `node --test tests/desktop-gates-workflow.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 두 검사 파일 맨 위에서 스위치를 읽어 건너뛴다. `check-freeze-scenes.mjs`는 `workflow` 장면을 같은 조건으로 건너뛰고 행에 `skipped:'workflows_feature_off'`를 남긴다. 게이트 목록과 기준선 파일은 바꾸지 않는다.
- [ ] **Step 4:** Run: `node --test tests/desktop-gates-workflow.test.mjs && node scripts/check-workflow-ui.mjs && node scripts/check-electron-workflow.mjs` — Expected: PASS, 두 검사가 건너뜀 줄을 출력.
- [ ] **Step 5:** 커밋. `git commit -m "test: 꺼진 워크플로우 검사는 건너뛰고 기록"`

### Task 5: `:has()` 금지 규칙과 상위 노드 상태 속성

**Files:**
- Modify: `scripts/design-rules.mjs` (`sourceDesignIssues`에 `has_selector` 규칙)
- Modify: `scripts/check-design-rules.mjs` (앱 CSS 전체에 규칙 적용)
- Create: `ui/shell-state.mjs`
- Modify: `electron-app/renderer.jsx` (`.desktop-shell` 노드), `ui/Workbench.jsx` (`.nubi-workbench`, `.nubi-workbench-layout`, `.nubi-main` 노드)
- Modify: 상위 노드 `:has()`가 있는 CSS: `design/workspace-identity.css`, `design/workspace-density.css`, `design/workspace-typography.css`, `design/workspace-dialogs.css`, `design/workspace-motion.css`, `design/workspace-alignment.css`, `electron-app/ios-tokens.css`, `electron-app/workspace-tabs.css`, `ui/question-inline.css`, `ui/workspace-catalog.css`, `ui/nubi-preparing.css`, `ui/cinematic-intro.css`
- Test: `tests/design-rules.test.mjs`, `tests/shell-state.test.mjs`

**Interfaces:**
- Produces: 설계 규칙 `{rule:'has_selector', file, line, selector}` — `:has(`가 들어간 선택자마다 하나.
- Produces: `shellState(snapshot): Record<string,string>` in `ui/shell-state.mjs`. 입력은 이미 렌더러가 아는 값만 쓴다. 돌려주는 속성과 대체 관계:

| 지금 선택자 | 대체 |
|---|---|
| `:root:has(.desktop-shell)` | `:root` (셸은 항상 있다) |
| `:root:has(.desktop-shell[data-toolbar=true])`, `body:has(.desktop-shell[data-toolbar=true])` | `:root[data-toolbar=true]` (렌더러가 `documentElement`에 단다) |
| `.desktop-shell:has(>.desktop-mail-progress)` | `.desktop-shell[data-mail-progress=true]` |
| `.desktop-shell:has(.nubi-start.is-empty)` | `.desktop-shell[data-start-empty=true]` |
| `.desktop-shell[data-layout=overlay]:has(.nubi-sidebar[data-open=true])`, `.nubi-workbench-layout:has(.nubi-sidebar[data-open=true])` | `[data-sidebar-open=true]` (두 노드에 같이) |
| `.nubi-workbench[data-host-layout=integrated]:has(.nubi-sidebar[data-open=false] .nubi-sidebar-brand)` | `.nubi-workbench[data-sidebar-brand-collapsed=true]` |
| `.nubi-workbench:has(.composer:focus-within)` | `.nubi-workbench[data-composer-focus=true]` (focusin/focusout로 갱신) |
| `.nubi-workbench[data-host-layout=integrated]:has([role=dialog])` | `.nubi-workbench[data-dialog-open=true]` |
| `.nubi-workbench:has(.nubi-task)`, `.nubi-main:has(.nubi-task)` | `[data-has-task=true]` |
| `.nubi-workbench:has(.nubi-wiki-browser)` | `.nubi-workbench[data-view=wiki]` |
| `.nubi-main:has(> .nubi-preparing)` | `.nubi-main[data-preparing=true]` |
| `:root:has(.nubi-workbench[data-large-text=true])` | `:root[data-large-text=true]` |
| `body:has(.nubi-intro)` | `:root[data-intro=true]` |
| `:root:has(.nubi-workflows[data-shell-title])` | 워크플로우 화면 전용. 스위치가 꺼져 있어 쓰이지 않지만 규칙상 `.nubi-workbench[data-view=workflows]`로 바꾼다 |

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
test('has_selector flags every :has() selector with its line',()=>{
  const issues=sourceDesignIssues('ui/x.css','.a{}\n.b:has(.c){color:red}\n');
  assert.deepEqual(issues.filter(i=>i.rule==='has_selector').map(i=>[i.line,i.selector]),[[2,'.b:has(.c)']]);
});
test('shellState maps renderer facts to attributes',()=>{
  assert.deepEqual(shellState({toolbar:true,mailProgress:false,startEmpty:true,sidebarOpen:true,composerFocus:false,dialogOpen:true,hasTask:false,view:'wiki',preparing:false,largeText:false,intro:false}),
    {'data-toolbar':'true','data-mail-progress':'false','data-start-empty':'true','data-sidebar-open':'true','data-composer-focus':'false','data-dialog-open':'true','data-has-task':'false','data-view':'wiki','data-preparing':'false','data-large-text':'false','data-intro':'false'});
});
```

- [ ] **Step 2:** Run: `node --test tests/design-rules.test.mjs tests/shell-state.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 규칙과 `shellState`를 구현한다. `check-design-rules.mjs`는 앱 CSS 전체(`design/*.css`, `ui/**/*.css`, `electron-app/*.css`)에서 `has_selector`가 이 Task가 맡은 상위 노드 선택자에 하나도 없음을 단언한다(남은 지역 선택자는 Task 6에서 0으로 만든다. 그때 단언을 "전체 0"으로 바꾼다). 렌더러와 Workbench는 `shellState` 결과를 해당 노드에 달고, `data-toolbar`, `data-large-text`, `data-intro`는 `document.documentElement`에 단다. 같은 값이면 속성을 다시 쓰지 않는다(쓸데없는 스타일 무효화 방지). 표대로 CSS를 바꾼다.
- [ ] **Step 4: 화면이 같은지 본다**
  Run: `node --test tests/design-rules.test.mjs tests/shell-state.test.mjs && npm run design:check && npm run test:ui && node scripts/check-all-surfaces.mjs`
  Expected: PASS. Task 0 캡처와 같은 장면 캡처를 나란히 비교해 차이가 없음을 확인하고, 메일 진행 막대 켜고 끄기, 좁은 창 사이드바 열고 닫기, 입력창 초점 들어가고 나가기 왕복 캡처를 `verification/light-flow/state-roundtrip-{1280,440}-*.png`로 남긴다.
- [ ] **Step 5:** 커밋. `git commit -m "perf: 상위 노드 :has()를 상태 속성으로 바꿈"`

### Task 6: 남은 지역 `:has()` 없애기

**Files:**
- Modify: 남은 `:has()`가 있는 CSS 전부(Task 5 뒤 `npm run design:check`가 목록을 출력한다. 시작 시점 기준 `electron-app/workspace-tabs.css`, `ui/ai-workspace/talk.css`, `ui/wiki-browser.css`, `ui/chapter-marks.css`, `ui/ai-workspace/skills/skills.css`, `ui/workflow.css`, `ui/ai-workspace/workspace/workspace.css`, `ui/ai-workspace/search-field.css`, `ui/wiki-insights.css`, `ui/mail-table.css`, `ui/external-ai-policy.css`, `ui/ai-workspace/talk-team-notice.css`, `ui/ai-workspace/inquiry.css`)와 그 요소를 그리는 컴포넌트
- Test: `scripts/check-design-rules.mjs` (전체 0 단언)

**Interfaces:**
- Consumes: `has_selector` 규칙(Task 5).
- Produces: 컴포넌트가 다는 상태 클래스와 속성. 이름 규칙은 `data-<상태>="true|false"`. 예: `.workspace-card[data-link-hover]` 대신 `.workspace-card:hover`가 같은 결과면 `:hover`로, `label:has(input:checked)`는 `label[data-checked=true]`, `.desktop-workspace-tab:has([aria-selected=true])`는 탭 자신의 `[aria-selected=true]`, `summary:has(> svg ~ svg)`는 그리는 쪽에서 `data-icon-count="2"`.

- [ ] **Step 1:** `check-design-rules.mjs`의 단언을 "앱 CSS 전체 `has_selector` 0개"로 바꾼다.
- [ ] **Step 2:** Run: `npm run design:check` — Expected: FAIL, 남은 선택자 목록 출력.
- [ ] **Step 3:** 목록의 선택자마다 같은 화면 결과를 내는 단순 선택자나 컴포넌트 속성으로 바꾼다. 상태가 바뀌는 곳(포커스, 체크, 열림)은 그 요소 자신에 속성을 단다.
- [ ] **Step 4:** Run: `npm run design:check && npm run test:gates:fast` — Expected: PASS, `:has(` 0. Task 5와 같은 방식으로 바뀐 화면의 1280과 440 캡처를 기준과 비교한다.
- [ ] **Step 5:** 커밋. `git commit -m "perf: 앱 CSS의 :has() 0개"`

### Task 7: 쉬는 동안 도는 배경 움직임 줄이기

**Files:**
- Modify: `design/workspace-motion.css` (`--nubi-ambient-registry`, 파스텔과 반짝임과 물결과 새 표정 규칙)
- Modify: `ui/motion-policy.mjs` (`reconcileMotion`의 쉬는 동안 허용 목록)
- Test: `tests/motion-policy.test.mjs` (기존), `scripts/check-motion-quality.mjs` (기존)

**Interfaces:**
- Produces: `IDLE_AMBIENT_ALLOWED: ReadonlySet<string>` in `ui/motion-policy.mjs` — 이 계획에서는 `['nubi-brand-float']` 하나. 계획 2가 메시와 빛을 더한다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

```js
test('only allowed ambient animations keep running while idle',()=>{
  const animations=['nubi-pastel-flow','deck-twinkle','nubi-water-aura','bird-blink','nubi-brand-float'].map(fakeAnimation);
  reconcileMotion(animations,{registry:parseAmbientRegistry(REGISTRY_TEXT),paused:false,reduced:false});
  assert.deepEqual(animations.filter(a=>a.playState==='running').map(a=>a.animationName),['nubi-brand-float']);
});
test('reduced motion stops even the allowed one, and showing the window again does not revive the others',()=>{
  const animations=['nubi-pastel-flow','nubi-brand-float'].map(fakeAnimation);
  reconcileMotion(animations,{registry,paused:false,reduced:true});
  assert.ok(animations.every(a=>a.playState!=='running'));
  reconcileMotion(animations,{registry,paused:true});reconcileMotion(animations,{registry,paused:false});
  assert.equal(animations.find(a=>a.animationName==='nubi-pastel-flow').playState==='running',false);
});
```

  `fakeAnimation`과 `REGISTRY_TEXT`는 기존 `tests/motion-policy.test.mjs`의 도우미를 쓴다.
- [ ] **Step 2:** Run: `node --test tests/motion-policy.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 허용 목록 밖의 상시 움직임은 쉬는 동안 멈춘다. 상태가 바뀔 때 한 번 움직이는 움직임(새 인사, 완료 축하)은 그대로 둔다. `check-motion-quality.mjs`의 `ambient-registered`, `ambient-same-phase`, `ambient-resume`는 허용 목록만 대상으로 보도록 옮기고, 멈춘 움직임이 다시 보일 때 살아나지 않는지 새 항목 `ambient-idle-allowed-only`로 확인한다.
- [ ] **Step 4:** Run: `node --test tests/motion-policy.test.mjs && node scripts/check-motion-quality.mjs` — Expected: PASS, 쉬는 동안 도는 움직임 1개.
- [ ] **Step 5:** 커밋. `git commit -m "perf: 쉬는 동안 배경 움직임은 브랜드 새 하나만"`

### Task 8: 비활성 단추에 이유 보이기

**Files:**
- Modify: `ui/WorkspaceNavigation.jsx` (`disabled` 단추의 `title`과 `aria-description`)
- Test: `scripts/check-shared-ui.mjs`

**Interfaces:**
- Produces: `disabledReason({model, project}): string|null` in `ui/WorkspaceNavigation.jsx` — 모델 없음이면 `"모델을 연결하면 열 수 있어요"`, 프로젝트 없음이면 `"프로젝트를 열면 볼 수 있어요"`, 둘 다 있으면 `null`. 모델 없음이 먼저다.

- [ ] **Step 1:** `check-shared-ui.mjs`에 단언을 더한다: 모델 없는 픽스처에서 '파일' 단추가 비활성이고 `title`이 `"모델을 연결하면 열 수 있어요"`이며, 마우스를 올리면 같은 문구가 기존 툴팁 양식으로 보인다.
- [ ] **Step 2:** Run: `node scripts/check-shared-ui.mjs` — Expected: FAIL.
- [ ] **Step 3:** `disabledReason`을 구현하고 비활성 메뉴 단추에 단다.
- [ ] **Step 4:** Run: `node scripts/check-shared-ui.mjs` — Expected: PASS.
- [ ] **Step 5:** 커밋. `git commit -m "fix: 눌리지 않는 메뉴 단추에 이유 표시"`

### Task 9: 조건 A 재측정과 판정

**Files:**
- Create: `scripts/check-light-flow.mjs`
- Modify: `docs/LIGHT-FLOW-BASELINE-2026-10-22.md` (후 측정 열)
- Modify: `package.json` (`"test:light-flow": "node scripts/check-light-flow.mjs"`, 로컬 판정 전용, 공용 러너 게이트에는 넣지 않음)

**Interfaces:**
- Consumes: Task 0의 `FREEZE_CHROME_ARGS`, `FREEZE_CPU_THROTTLE`, `FREEZE_TRACE` 출력 행.
- Produces: `judgeLightFlow(rows): {pass:boolean, failures:string[]}` — 기준(설계 §6): chat 장면 놓친 프레임 비율 0.05 이하, 모든 장면 50ms 넘는 긴 작업 5개 이하, `styleRecalcMaxMs` 16 이하. `NUBI_SHARED_RUNNER=1`이면 판정하지 않고 `{pass:true, failures:[], unjudged:true}`.

- [ ] **Step 1:** `tests/light-flow.test.mjs`에 `judgeLightFlow` 시험을 쓴다: 기준을 하나씩 넘는 행 세 개가 각각 실패 이유 하나씩을 내고, 경계값(0.05, 5, 16)은 통과하며, 공용 러너 환경에서는 `unjudged:true`.
- [ ] **Step 2:** Run: `node --test tests/light-flow.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** `judgeLightFlow`와, 조건 A로 `check-freeze-scenes.mjs`를 실행해 행을 모아 판정하는 `check-light-flow.mjs`를 만든다.
- [ ] **Step 4:** Run: `npm run test:light-flow` — Expected: PASS. 결과를 기준선 문서의 "후" 열에 적고, 같은 표에 앱 CSS `:has(` 0과 묶인 CSS 크기를 적는다. CSS 크기 절반 목표는 계획 2(덮어쓰기 층 합치기, CX 미사용 규칙 빼기)에서 판정한다고 적는다.
- [ ] **Step 5:** 커밋. `git commit -m "test: 가벼운 흐름 조건 A 판정"`

### Task 10: 전체 게이트와 업로드

- [ ] **Step 1:** Run: `npm run test:gates:fast && npm run test:gates:electron` — Expected: PASS(공용 러너 시간 항목은 기록만). 실패가 있으면 원인을 고치고, 꺼진 워크플로우 때문에 바뀐 검사는 커밋 메시지에 적는다.
- [ ] **Step 2:** 업로드 스크립트로 main에 올린다(`ONLY_PATHS` 또는 `OVERRIDE_FILES`, 안전 회귀 검사 `--delta refs/desktop/main` 통과 뒤 `--push`).
- [ ] **Step 3:** 사용자에게 기준선 대비 수치 표와 바뀐 점을 보고한다. Windows 설치판은 계획 2가 끝난 뒤 1.3.1 후보로 만든다.
