# 누비 워크플로우 에이전트 1단계 구현 계획 (정의 형식과 러너 최소)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람이 적은 `workflow.yaml`을 누비가 검증하고(dry-run), 순차 실행하며(사람 단계, 에이전트 단계, 도구 단계), 체크포인트로 재개하고, 보고서를 남기는 최소 러너를 만든다. 캔버스는 읽기 전용 뷰까지.

**Architecture:** 설계 `docs/superpowers/specs/2026-10-18-nubi-workflow-agent-design.md` §3의 A안. 새 에이전트 루프를 만들지 않는다. 에이전트 단계는 기존 `createTask` + `startAgent`로 **단계마다 새 대화**를 만들고 허용 도구만 노출한다. 사람 단계는 기존 질문 카드와 `answerAgent` 경로를 쓴다. 도구 단계는 기존 Playwright 요청, `prepareSetupAction`(명령 승인), 파일 읽기를 감싼 어댑터로 간다. 모든 단계는 `workflow-run:` 레코드에 체크포인트를 남기고 (단계 id, 입력 해시)로 캐시된다.

**Tech Stack:** Node 25 ESM, `yaml@2.9`, `ajv@8`(기존), React 18, `@xyflow/react@12.12`(MIT, 새 의존성, 읽기 전용 뷰), node:test, esbuild 검사 스크립트, Electron 42.

**Spec:** `docs/superpowers/specs/2026-10-18-nubi-workflow-agent-design.md` (§3.1 정의 형식, §3.2 러너, §3.3 어댑터, §3.4 검증, §9 Claude Code 벤치마크 반영)

## Global Constraints

- **Apple iOS 벤치마크와 성능(2026-10-18 사용자 지시)**: 화면을 만들거나 고치는 작업은 Apple HIG 모션(짧고 목적 있는 전환, ease-out, 작은 탄성, 모션 감소 존중)과 기존 수치(모달 열기와 크기 280ms, 닫기 180ms, 화면 전환 280ms)를 따르고 `ui/viewTransition.js`, `modalMotion.js`, `frame-coalescer.mjs`를 재사용한다. 메인 스레드 50ms 이상 작업 금지(무거운 계산은 worker), 긴 목록은 가상화, 새 화면마다 `check-motion-performance`와 `check-ui-responsiveness`에 장면을 추가하고 전후 수치를 기록한다. 프리징 보고가 있으면 재현 → 측정 → 수정 → 재측정 순서.
- **오픈소스 먼저(2026-10-18 사용자 지시)**: 작업을 시작하기 전에 관련 오픈소스 후보를 조사해(스타는 `gh api`로 실측, 라이선스, 최근 커밋, 누비 적합성) 작업 기록에 표로 남기고, 채택/패턴 참고/보류를 명시한다. 기존 의존성과 중복되면 도입하지 않는다.
- 한국어 메시지와 로그. 가운뎃점 금지.
- 호스트가 순서와 완료를 판정한다. 모델의 "했다"는 증거가 아니다. 단계 출력은 선언한 JSON Schema로 검증한다.
- 승인 모델 그대로: 되돌리기 어려운 작업과 외부 반영은 모든 모드에서 확인. `permissions.externalWrite:never`인 워크플로우는 외부 반영 단계를 저장 때 거절.
- 비밀은 `secret:이름` 참조만. YAML에 평문 비밀이 보이면(`memory.mjs`의 `secretLike`) 저장 거절.
- 템플릿은 `{{ }}` 안의 작은 표현식만: 경로 접근, `==`, `!=`, `&&`, `||`, `!`, 필터 `default`, `trim`, `upper`, `lower`, `json`. 임의 코드 실행 없음.
- 재개와 재시도는 멱등 키가 있는 도구 단계를 두 번 실행하지 않는다. 승인됐으나 결과가 불명한 단계는 사람 단계로 바꾼다.
- 공용 런타임과 평가 채점 규칙은 바꾸지 않는다. 새 의존성은 `@xyflow/react` 하나(설계 §8 미결 2 승인 뒤 설치).
- 도구 예산 시험(6,000 토큰)과 소형 창 압축 시험을 넘기지 않는다. 새 도구는 워크플로우 단계 대화에서만 노출한다.
- 작업마다 실패 시험 → 구현 → `node --test` → 검사 → `npm run test:gates` → Claude QA → main 업로드(Claude). Codex는 push하지 않는다.
- 사내 데이터(실제 e2e task JSON, 티켓 내용)는 시험 fixture에 넣지 않는다. 구조만 닮은 합성 자료를 만든다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `runtime/workflow-schema.mjs` | JSON Schema(ajv)와 저장 전 의미 검사(순환, 어댑터 존재, 비밀 평문, 권한 축소만) |
| `runtime/workflow-template.mjs` | `{{ }}` 표현식 평가(화이트리스트) |
| `runtime/workflow-package.mjs` | `.nubi/workflows/<slug>/` 읽기(workflow.yaml, README.md, fixtures/), 해시, 목록 |
| `runtime/workflow-run.mjs` | 실행 레코드와 체크포인트, 단계 캐시 키, 상태 전이 |
| `runtime/workflow-adapters.mjs` | web, terminal, documents 어댑터(observe/act/verify, irreversible), 합성 어댑터 |
| `runtime/workflow-runner.mjs` | 순차 러너(사람, 에이전트, 도구, branch), 재개, 보고서 호출 |
| `runtime/workflow-report.mjs` | 실행 보고서 Markdown(가림 적용) |
| `runtime/workflow-import-e2e.mjs` | 기존 e2e task JSON → workflow.yaml 변환 |
| `runtime/agent.mjs` | 단계 대화 전용 도구 `submit_step_output`, 허용 도구 필터, `task.origin.kind==='workflow_step'` |
| `runtime/project-service.mjs` | 서비스 메서드(`listWorkflows`, `validateWorkflow`, `dryRunWorkflow`, `startWorkflow`, `workflowRun`, `answerWorkflow`, `cancelWorkflow`, `importE2eTask`)와 허용 목록, `answerAgent` 분기 |
| `runtime/routines.mjs` | 루틴 `kind:'workflow'` |
| `ui/WorkflowPanel.jsx`, `ui/WorkflowRunView.jsx`, `ui/WorkflowCanvas.jsx`, `ui/workflow.css` | 목록, 실행 상태(단계 목록, 현재 단계, 대기 질문), 읽기 전용 캔버스 |
| `tests/workflow-*.test.mjs` | 단위 시험 |
| `tests/workflow-fixture-project/` | 합성 시범 워크플로우 패키지 |
| `scripts/check-workflow-ui.mjs`, `scripts/check-electron-workflow.mjs` | 화면 검사와 실제 Electron 감독 실행 검사 |
| `docs/WORKFLOW-AGENT-2026-10.md` | 사용자 문서(형식, 저작 절차, 한계) |

---

## Task 1: 스키마, 템플릿, 패키지 로더

**Files:**
- Create: `runtime/workflow-schema.mjs`, `runtime/workflow-template.mjs`, `runtime/workflow-package.mjs`, `tests/workflow-schema.test.mjs`, `tests/workflow-template.test.mjs`, `tests/workflow-package.test.mjs`

**Interfaces:**
- Produces: `WORKFLOW_SCHEMA`, `validateWorkflow(document,{adapters}) -> {ok:true,workflow}|{ok:false,errors:[{code,path,message}]}` (codes: `workflow_schema`, `workflow_cycle`, `workflow_adapter_unknown`, `workflow_secret_plain`, `workflow_permission_widened`, `workflow_external_write_forbidden`); `evaluateTemplate(text,scope) -> string`, `evaluateCondition(expr,scope) -> boolean` (throws `template_invalid`); `loadWorkflowPackage(root,slug) -> {slug,workflow,readme,fixtures,hash}`, `listWorkflowPackages(root) -> [{slug,name,version,hash,valid,errors}]`.

- [x] **Step 1: 실패하는 시험**

`tests/workflow-schema.test.mjs`:

```js
import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateWorkflow} from '../runtime/workflow-schema.mjs';
const adapters={web:['read','verify'],terminal:['run'],documents:['exists','read','hash']};
const base={name:'시범',version:1,trigger:{kind:'manual'},inputs:{ticket:{type:'string',required:true}},permissions:{tools:['web','documents'],externalWrite:'ask'},steps:[
  {id:'read',kind:'tool',adapter:'web.read',args:{url:'{{ inputs.ticket }}'},verify:{kind:'text_present',value:'{{ inputs.ticket }}'}},
  {id:'draft',kind:'agent',goal:'초안',tools:['wiki_query','propose_new_file'],done_when:{kind:'file_exists',path:'out/{{ inputs.ticket }}.md'},outputs:{schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}}}},budget:{calls:20,minutes:10}},
  {id:'ok',kind:'human',ask:'승인?',outputs:{decision:['approve','revise']}}]};
test('a valid workflow passes and keeps the parsed shape',()=>{const r=validateWorkflow(base,{adapters});assert.equal(r.ok,true);assert.equal(r.workflow.steps.length,3);});
test('unknown adapter, plain secret, cycle and widened permission are refused with codes',()=>{
  assert.equal(validateWorkflow({...base,steps:[{id:'x',kind:'tool',adapter:'mail.send',args:{}}]},{adapters}).errors[0].code,'workflow_adapter_unknown');
  assert.equal(validateWorkflow({...base,inputs:{token:{type:'string',default:'ghp_abcdefghijklmnopqrstuvwxyz0123'}}},{adapters}).errors[0].code,'workflow_secret_plain');
  assert.equal(validateWorkflow({...base,steps:[{id:'a',kind:'branch',when:'true',then:'b'},{id:'b',kind:'branch',when:'true',then:'a'}]},{adapters}).errors[0].code,'workflow_cycle');
  assert.equal(validateWorkflow({...base,steps:[{...base.steps[0],permissions:{tools:['web','terminal']}}]},{adapters}).errors[0].code,'workflow_permission_widened');
  assert.equal(validateWorkflow({...base,permissions:{tools:['web'],externalWrite:'never'},steps:[{id:'p',kind:'tool',adapter:'web.read',args:{},externalWrite:true}]},{adapters}).errors[0].code,'workflow_external_write_forbidden');
});
```

`tests/workflow-template.test.mjs`:

```js
import {test} from 'node:test';import assert from 'node:assert/strict';
import {evaluateTemplate,evaluateCondition} from '../runtime/workflow-template.mjs';
const scope={inputs:{ticket:'CR-12'},steps:{ok:{output:{decision:'approve'}}}};
test('templates read paths and filters only',()=>{
  assert.equal(evaluateTemplate('티켓 {{ inputs.ticket | lower }}',scope),'티켓 cr-12');
  assert.equal(evaluateTemplate('{{ inputs.missing | default("없음") }}',scope),'없음');
  assert.equal(evaluateCondition("steps.ok.output.decision == 'approve' && !inputs.missing",scope),true);
  for(const bad of ['{{ process.exit(1) }}','{{ inputs.ticket.constructor }}','{{ require("fs") }}'])assert.throws(()=>evaluateTemplate(bad,scope),/template_invalid/);
});
```

`tests/workflow-package.test.mjs`: 임시 폴더에 `.nubi/workflows/sample/workflow.yaml`, `README.md`, `fixtures/basic.json`을 쓰고 `listWorkflowPackages`가 1개, `hash`가 내용 변경 때 바뀜, 잘못된 YAML은 `valid:false`와 `errors`.

- [x] **Step 2: 실패 확인** — `node --test tests/workflow-schema.test.mjs tests/workflow-template.test.mjs tests/workflow-package.test.mjs` → FAIL (module missing)

- [x] **Step 3: 구현**

`runtime/workflow-template.mjs` 핵심: 토크나이저로 `{{ … }}`를 찾고 식은 손으로 파싱한다(식별자 경로 `a.b.c`, 문자열 리터럴, 숫자, `==`, `!=`, `&&`, `||`, `!`, 괄호, 파이프 필터). `eval`과 `Function`을 쓰지 않는다. 경로 접근은 `Object.hasOwn` 기반이며 `__proto__`, `constructor`, `prototype`는 거절.

```js
// A small expression language for workflow fields: paths, literals, ==, !=, &&, ||, !, parentheses and a few filters.
// No code execution; prototype names are refused (template_invalid).
const FILTERS={default:(v,d)=>v==null||v===''?d:v,trim:v=>String(v??'').trim(),upper:v=>String(v??'').toUpperCase(),lower:v=>String(v??'').toLowerCase(),json:v=>JSON.stringify(v??null)};
const FORBIDDEN=new Set(['__proto__','constructor','prototype']);
export function evaluateTemplate(text,scope){return String(text??'').replace(/\{\{([\s\S]*?)\}\}/g,(_,expr)=>{const v=evaluateExpression(expr.trim(),scope);return v==null?'':String(v);});}
export function evaluateCondition(expr,scope){return !!evaluateExpression(String(expr||'').trim(),scope);}
export function evaluateExpression(expr,scope){const tokens=tokenize(expr);const parser=new Parser(tokens,scope);const value=parser.parseOr();if(!parser.done())fail('template_invalid');return value;}
// tokenize/Parser: 약 80줄. 경로 읽기는 readPath(scope,['inputs','ticket']) 로 FORBIDDEN 검사.
```

`runtime/workflow-schema.mjs`: ajv 스키마(단계 종류별 `oneOf`, `id` 패턴 `^[a-z][a-z0-9-]{0,39}$`, `adapter` 패턴 `^[a-z]+\.[a-z_]+$`, `outputs.schema`는 JSON Schema 객체), 의미 검사 함수들(`cycleIn(steps)`: `then`/`else`/`next`/`loop.body` 그래프 DFS; `plainSecrets(document)`: 모든 문자열 값에 `secretLike`; `permissionWidened`; `externalWriteForbidden`).

`runtime/workflow-package.mjs`: `yaml.parse`, 파일 해시(sha256), `fixtures/*.json` 로드, 슬러그는 폴더명. `.nubi/workflows` 밖은 보지 않는다(`relativeFile` 재사용).

- [x] **Step 4: 시험** → PASS
- [x] **Step 5: 업로드 준비** — 메시지: `feat(nubi-desktop): 워크플로우 정의 형식 — 스키마, 템플릿, 패키지 로더`.

Task 1 로컬 검증 완료(2026-10-18): 새 시험 17/17, 도구 예산과 내보내기 포함 집중 시험 26/26. 최종 소스 `test:gates` 종료 코드 0, 총 2,078개 중 1,878 통과/200 제외/실패 0. 화면 117개 장면과 마지막 Electron/MCP 승인 검사 통과. 새 UI와 실제 워크플로우 실행은 이후 작업 범위다. Claude QA 인계와 변경 파일은 `docs/WORKFLOW-AGENT-PHASE1-TASK1-2026-10-18.md`. Codex는 업로드하지 않았다.

---

## Task 2: 실행 레코드와 체크포인트

**Files:**
- Create: `runtime/workflow-run.mjs`, `tests/workflow-run.test.mjs`

**Interfaces:**
- Produces: `createRun(store,{workflow,hash,inputs,trigger}) -> run`(`workflow-run:<id>`: `{id,slug,version,hash,inputs,trigger,status:'running'|'waiting'|'complete'|'partial'|'failed'|'cancelled',steps:{[id]:{status,inputHash,output,receipts,startedAt,finishedAt,error}},cursor,createdAt,updatedAt}`); `stepCacheKey(stepId,inputs) -> hash`; `markStep(store,runId,stepId,patch)`; `resumePoint(run) -> stepId|null`; `listRuns(store,{slug,limit})`.

- [x] **Step 1: 실패하는 시험**

```js
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRun,markStep,resumePoint,stepCacheKey,listRuns} from '../runtime/workflow-run.mjs';
const store=()=>{const m=new Map();return {get:k=>m.get(k),set:(k,v)=>m.set(k,v),list:p=>[...m.entries()].filter(([k])=>k.startsWith(p)).map(([,v])=>v)};};
const wf={name:'w',version:1,steps:[{id:'a',kind:'tool'},{id:'b',kind:'human'},{id:'c',kind:'agent'}]};
test('a run records per-step checkpoints and resumes after the last completed step',()=>{
  const s=store();const run=createRun(s,{workflow:wf,hash:'h1',inputs:{x:1},trigger:{kind:'manual'}});
  markStep(s,run.id,'a',{status:'complete',output:{ok:true},inputHash:stepCacheKey('a',{x:1})});
  markStep(s,run.id,'b',{status:'waiting'});
  assert.equal(resumePoint(s.get('workflow-run:'+run.id)),'b');
  assert.equal(s.get('workflow-run:'+run.id).status,'waiting');
});
test('an approved step with unconfirmed result is not re-executed on resume',()=>{
  const s=store();const run=createRun(s,{workflow:wf,hash:'h1',inputs:{},trigger:{kind:'manual'}});
  markStep(s,run.id,'a',{status:'unconfirmed',receipts:['setup-action:1']});
  const point=resumePoint(s.get('workflow-run:'+run.id));assert.equal(point,'a');assert.equal(s.get('workflow-run:'+run.id).steps.a.status,'unconfirmed');
});
test('cache keys change with inputs and the same key is reused across runs',()=>{assert.notEqual(stepCacheKey('a',{x:1}),stepCacheKey('a',{x:2}));assert.equal(stepCacheKey('a',{x:1,y:[1,2]}),stepCacheKey('a',{y:[1,2],x:1}));});
```

- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — 캐시 키는 안정 정렬 JSON의 sha256. `markStep`은 `updatedAt`과 실행 상태를 함께 갱신(모든 단계 complete면 `complete`, 하나라도 `failed`면 `failed`, `waiting`/`unconfirmed`면 `waiting`). 레코드 크기 한도: 단계 출력은 64KB까지 인라인, 넘으면 `output-ref`(별도 레코드).
- [x] **Step 4: 시험** → PASS

---

Task 2 로컬 완료(2026-10-18): 새 시험 10/10, Task 1~2 합계 27/27. 최종 `test:gates` 종료 코드 0, 2,088개 중 1,888 통과/200 제외/실패 0. 변경 파일과 근거: `docs/WORKFLOW-AGENT-PHASE1-TASKS2-5-2026-10-18.md`.

## Task 3: 어댑터 (web, terminal, documents)와 합성 어댑터

**Files:**
- Create: `runtime/workflow-adapters.mjs`, `tests/workflow-adapters.test.mjs`

**Interfaces:**
- Produces: `createAdapters(service,{taskId,runId}) -> {web:{read,verify,irreversible:()=>false},terminal:{run,irreversible:({script})=>irreversibleCommand(script).matched},documents:{exists,read,hash,irreversible:()=>false}}`; 각 동작은 `async(args,{signal,summary}) -> {ok,observation|result,receipts:[id],error?}`; `createSyntheticAdapters(fixture) -> same shape`(fixture의 `responses[stepId]`를 돌려줌); `ADAPTER_CATALOG`(스키마 검증용 이름 목록).

- [x] **Step 1: 실패하는 시험** — 합성 어댑터로 각 동작의 결과 모양, `terminal.run`이 실제로는 `prepareSetupAction`을 거쳐 `setup-action:` 영수증 id를 돌려주는지(서비스 fixture), `web.verify`의 `text_present`/`element_visible`/`url_is`가 snapshot 결과로 판정되는지, `documents.hash`가 프로젝트 밖 경로를 `path_scope`로 거절하는지.
- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — `web.read(url)`: 기존 `playwrightRequest('open')` 뒤 `browser_snapshot`; `web.verify`는 snapshot 텍스트/역할 검사. `terminal.run({profile,script})`: `prepareSetupAction` → 자동 승인 흐름이 없으면 `waiting`(사람 단계로 승격) → 완료 뒤 `exit_code`와 출력 8KB. `documents.*`는 `relativeFile`/`readSource`. 모든 동작은 영수증 id를 남기고 `summary`(동작 요약 한 줄)를 영수증에 기록한다.
- [x] **Step 4: 시험** → PASS

---

Task 3 로컬 완료(2026-10-18): 새 시험 19/19, 워크플로우/승인/F13 집중 시험 71/71. 최종 소스 `test:gates` 종료 코드 0, 총 2,107개 중 1,907 통과/200 제외/실패 0. Task 4와 5는 설계 §8 질문 4의 답 대기. 자세한 변경 파일과 검증 경계는 `docs/WORKFLOW-AGENT-PHASE1-TASKS2-5-2026-10-18.md`.

## Task 4: 러너 (순차, 사람, 에이전트, 도구, branch)와 재개

**Files:**
- Create: `runtime/workflow-runner.mjs`, `tests/workflow-runner.test.mjs`
- Modify: `runtime/agent.mjs`(워크플로우 단계 대화: `task.origin.kind==='workflow_step'`일 때 허용 도구만 노출 + `submit_step_output` 도구), `runtime/project-service.mjs`(`createTask` origin에 `workflow_step` 허용, `answerAgent` 분기)

**Interfaces:**
- Produces: `createWorkflowRunner(service) -> {start({slug,inputs,trigger}) -> run, resume(runId,{answer}) -> run, cancel(runId)}`; 단계 대화 도구 `submit_step_output({output})`(스키마 검증, 통과하면 단계 `complete`); `task.origin={kind:'workflow_step',runId,stepId}`.
- **재확인(2026-10-18, 설계 §8 답 4)**: `runtime/workflow-tools.mjs`의 `TOOL_PREREQUISITES`(호스트 고정)와 `expandStepTools(declared) -> {tools, added}`. 작성자는 능력 도구만 적고(`tools:[propose_new_file]`), 호스트가 선행 도구(`inspect_path`, `record_change_plan`)와 공통 도구(`update_plan`, `submit_step_output`)를 보탠다. 알 수 없는 도구 이름은 `workflow_tool_unknown`. 모델에 보이는 목록과 실행 허용 목록은 둘 다 `resolvedTools`. 관찰과 계획은 자동으로 만들지 않는다(기존 거절 유지). 시험: 확장 결과 확인 사례 추가(Step 1의 네 번째 시험 기대값을 `['inspect_path','propose_new_file','read_source','record_change_plan','submit_step_output','update_plan']`로).

- [x] **Step 1: 실패하는 시험**

```js
import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';import {ProjectService} from '../runtime/project-service.mjs';import {installAgent} from '../runtime/agent.mjs';
import {createWorkflowRunner} from '../runtime/workflow-runner.mjs';
installAgent(ProjectService);
test('tool → human → agent runs in order, pauses on the human step, resumes with the answer and judges done_when from receipts',async t=>{
  const f=await fixture(t,{workflows:{sample:{steps:[{id:'read',kind:'tool',adapter:'documents.exists',args:{path:'README.md'},verify:{kind:'truthy'}},{id:'ok',kind:'human',ask:'계속?',outputs:{decision:['approve','stop']}},{id:'write',kind:'agent',goal:'메모를 쓴다',tools:['propose_new_file'],done_when:{kind:'file_exists',path:'out/memo.md'},outputs:{schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}}}}}]}}});
  const runner=createWorkflowRunner(f.service);let run=await runner.start({slug:'sample',inputs:{},trigger:{kind:'manual'}});
  assert.equal(run.status,'waiting');assert.equal(run.cursor,'ok');assert.ok(f.service.task(run.taskId).question);
  run=await runner.resume(run.id,{answer:'approve'});
  // fixture model proposes out/memo.md and calls submit_step_output; the fixture applies the proposal
  await f.settle();run=f.service.store.get('workflow-run:'+run.id);
  assert.equal(run.steps.write.status,'complete');assert.equal(run.steps.write.output.summary.length>0,true);assert.equal(run.status,'complete');
});
test('a human answer of stop ends the run as partial and nothing after it executes',async t=>{
  const f=await fixture(t,{workflows:{sample:{steps:[{id:'ok',kind:'human',ask:'계속?',outputs:{decision:['approve','stop']}},{id:'write',kind:'agent',goal:'메모',tools:['propose_new_file'],done_when:{kind:'file_exists',path:'out/memo.md'}}]}}});
  const runner=createWorkflowRunner(f.service);let run=await runner.start({slug:'sample',inputs:{},trigger:{kind:'manual'}});
  run=await runner.resume(run.id,{answer:'stop'});assert.equal(run.status,'partial');assert.equal(run.steps.write,undefined);assert.equal(f.service.store.list('task:').filter(task=>task.origin?.kind==='workflow_step').length,0);
});
test('restart resumes from the waiting step and never replays a tool step with an unconfirmed receipt',async t=>{
  const f=await fixture(t,{workflows:{sample:{steps:[{id:'run',kind:'tool',adapter:'terminal.run',args:{profile:'bash',script:'echo hi'},idempotency:'run-1'},{id:'ok',kind:'human',ask:'계속?',outputs:{decision:['approve']}}]}}});
  const runner=createWorkflowRunner(f.service);let run=await runner.start({slug:'sample',inputs:{},trigger:{kind:'manual'}});
  f.service.store.set('workflow-run:'+run.id,{...f.service.store.get('workflow-run:'+run.id),steps:{...run.steps,run:{...run.steps.run,status:'unconfirmed'}},cursor:'run'});
  const second=await f.reopen();const runner2=createWorkflowRunner(second.service);const resumed=await runner2.resume(run.id,{});
  assert.equal(resumed.status,'waiting');assert.equal(resumed.cursor,'run');assert.equal(second.service.store.list('setup-action:').length,1,'the command was not issued a second time');
});
test('an agent step sees only its allowed tools and submit_step_output; other tools are not offered',async t=>{
  const seen=[];const f=await fixture(t,{onModelRequest:request=>seen.push(request.tools.map(tool=>tool.function.name)),workflows:{sample:{steps:[{id:'write',kind:'agent',goal:'메모',tools:['read_source','propose_new_file'],done_when:{kind:'file_exists',path:'out/memo.md'}}]}}});
  const runner=createWorkflowRunner(f.service);await runner.start({slug:'sample',inputs:{},trigger:{kind:'manual'}});await f.settle();
  const names=new Set(seen.flat());assert.deepEqual([...names].sort(),['inspect_path','propose_new_file','read_source','record_change_plan','submit_step_output','update_plan'].sort());
});
```

- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현**

`workflow-runner.mjs` 핵심 흐름:

```js
// The host owns the order. A model never reorders steps; it only works inside an agent step's own conversation.
export function createWorkflowRunner(service){
  const adapters=()=>createAdapters(service);
  async function execute(run){
    const workflow=run.workflow;
    while(true){
      const step=workflow.steps.find(s=>s.id===run.cursor);if(!step)return finish(run,'complete');
      const scope={inputs:run.inputs,steps:outputsOf(run)};
      const key=stepCacheKey(step.id,resolvedArgs(step,scope));
      if(run.steps[step.id]?.status==='complete'&&run.steps[step.id].inputHash===key){run.cursor=next(workflow,step,scope);continue;} // cached
      if(run.steps[step.id]?.status==='unconfirmed')return hold(run,step,'이전 실행의 결과가 확인되지 않았어요. 확인 뒤 이어서 진행해 주세요.');
      if(step.kind==='human')return await ask(run,step,scope);
      if(step.kind==='branch'){run.cursor=evaluateCondition(step.when,scope)?step.then:step.else;markStep(...);continue;}
      if(step.kind==='tool'){const result=await runTool(run,step,scope);if(result.waiting)return hold(run,step,result.reason);if(!result.ok)return failOrHuman(run,step,result);}
      if(step.kind==='agent'){const result=await runAgentStep(run,step,scope);if(result.waiting)return hold(run,step);if(!result.ok)return failOrHuman(run,step,result);}
      run.cursor=next(workflow,step,scope);
    }
  }
  // runAgentStep: service.createTask({request:step.goal+입력 요약,origin:{kind:'workflow_step',runId,stepId}}) → startAgent → 완료 대기 → done_when을 영수증으로 판정 → submit_step_output으로 받은 출력 검증.
  // ask: run.taskId(우산 대화)에 question을 만들고 status waiting. resume(runId,{answer})가 outputs를 기록하고 execute를 다시 돈다.
  return {start,resume,cancel};
}
```

`agent.mjs`: `task.origin?.kind==='workflow_step'`이면 `createToolSet`의 `available`에 단계 `tools` 집합만 허용하고 `submit_step_output`을 추가한다(설명 한 문장: 'Submit this step's result object; the host validates it against the declared schema.'). 도구 예산 시험은 워크플로우 단계 대화를 제외한다(기본 대화에는 노출되지 않음).

`project-service.mjs`: `answerAgent`에서 `task.kind==='workflow'`(우산 대화)이면 `workflowRunner.resume`. 허용 목록에 새 메서드.

- [x] **Step 4: 시험** → PASS. `tests/lean-tools.test.mjs`, `tests/compaction-turn.test.mjs` 회귀.

---

## Task 5: dry-run과 보고서

**Files:**
- Create: `runtime/workflow-report.mjs`, `tests/workflow-dry-run.test.mjs`, `tests/workflow-report.test.mjs`
- Modify: `runtime/workflow-runner.mjs`(`mode:'dry-run'`은 합성 어댑터와 fixture 모델, 사람 단계는 fixture의 답으로 자동 응답, 사이드 이펙트 0)

- [x] **Step 1: 실패하는 시험** — dry-run이 `fixtures/basic.json`(입력, 단계별 합성 응답, 사람 답)으로 끝까지 돌고 `complete`; 응답이 빠진 단계는 `partial`과 이유; 어떤 `setup-action:`/`proposal:` 레코드도 만들지 않음. 보고서는 제목, 실행 정보(버전, 해시, 트리거), 단계별 상태와 영수증 id, 사람 답, 미해결 목록을 담고 `secretLike`와 인증값 가림을 통과.
- [x] **Step 2: 실패 확인** → FAIL
- [x] **Step 3: 구현** — `workflow-report.mjs`는 2차 `conversation-export.mjs`의 `safeText`를 재사용한다. 보고서는 실행 폴더가 아니라 `workflow-run` 레코드에 붙이고 내보내기는 기존 저장 대화상자 경로.
- [x] **Step 4: 시험** → PASS

---

## Task 6: 서비스 메서드와 화면 (목록, 실행 상태, 읽기 전용 캔버스)

**Files:**
- Create: `ui/WorkflowPanel.jsx`, `ui/WorkflowRunView.jsx`, `ui/WorkflowCanvas.jsx`, `ui/workflow.css`, `scripts/check-workflow-ui.mjs`, `tests/workflow-ui-fixture.jsx`
- Modify: `runtime/project-service.mjs`(메서드와 허용 목록), `ui/Workbench.jsx`(왼쪽 레일 "워크플로우" 진입점, 실행 중 우산 대화에 단계 목록), `package.json`(`@xyflow/react`)

**Interfaces:**
- Produces: 서비스 `listWorkflows()`, `validateWorkflow({slug})`, `dryRunWorkflow({slug,fixture})`, `startWorkflow({slug,inputs})`, `workflowRun({runId})`, `cancelWorkflow({runId})`; 화면: 목록(이름, 버전, 유효성, 마지막 실행), 실행 뷰(단계 목록과 상태, 현재 단계, 대기 질문은 기존 질문 카드), 캔버스(xyflow 읽기 전용: 노드 다섯 종류 색/아이콘, 상태 배지, 위키 근거 칩, 점선은 에이전트 제안용 예약).

- [ ] **Step 1: 의존성** — `npm i @xyflow/react@12.12.0` (설계 §8 미결 2 승인 뒤). 번들 크기 측정값을 `docs/WORKFLOW-AGENT-2026-10.md`에 기록.
- [ ] **Step 2: 실패하는 검사** — `scripts/check-workflow-ui.mjs`: fixture 워크플로우 2개(유효 1, 오류 1)로 목록 렌더, 오류 항목에 코드, 실행 뷰에서 단계 3개와 현재 단계 표시, 캔버스에 노드 3개와 연결 2개(`[data-step-kind]`), 1280/440 너비, 디자인 토큰만(hex, px 금지), 모달은 `deck-dialog`.
- [ ] **Step 3: 실패 확인** → FAIL
- [ ] **Step 4: 구현** — 캔버스는 `ReactFlow`에 `nodesDraggable={false}`, `nodesConnectable={false}`, 자동 배치는 단순 세로 레이아웃(dagre 없이 단계 순서대로). 노드는 공통 토큰(`workspace-identity.css`)만. 실행 뷰의 질문은 기존 `QuestionDecision`을 재사용(우산 대화의 질문).
- [ ] **Step 5: 검사** → PASS. `npm run design:check`.

---

## Task 7: e2e task JSON 변환기

**Files:**
- Create: `runtime/workflow-import-e2e.mjs`, `tests/workflow-import-e2e.test.mjs`, `tests/fixtures/e2e-task-sample.json`(합성, 구조만 닮음)
- Modify: `runtime/project-service.mjs`(`importE2eTask({path}) -> {slug,workflow,warnings}`)

**Interfaces:**
- Produces: `convertE2eTask(json) -> {workflow,warnings:[{nodeId,code,message}]}`. 대응: `decide_*` → `agent`(goal=name, inputs→템플릿 참조, outputs→schema 객체), `file_change_*` → `agent`(tools: `propose_new_file`, `propose_patch`, `read_source`; done_when: 산출 경로가 있으면 `file_exists`), `type:'if'` → `branch`, 사람 확인 노드 → `human`, 알 수 없는 노드는 `human`으로 두고 경고.

- [ ] **Step 1: 실패하는 시험** — 합성 샘플 15노드가 단계 15개로 바뀌고 `validateWorkflow`를 통과하며, 입력 참조 `$.nodes.decide_7.output.output`이 `{{ steps.decide-7.output.output }}`로 바뀌고, 알 수 없는 노드 1개가 경고와 함께 `human`이 된다.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — id는 소문자와 하이픈으로 정규화(충돌 시 접미사), `inputs_from`은 워크플로우 `inputs`, `max_auto_steps_per_pump`는 `budget`으로.
- [ ] **Step 4: 시험** → PASS

---

## Task 8: 시범 워크플로우 패키지와 실제 Electron 감독 실행 검사

**Files:**
- Create: `tests/workflow-fixture-project/.nubi/workflows/change-request-definition/{workflow.yaml,README.md,fixtures/basic.json}`(합성 티켓과 합성 위키 페이지), `scripts/check-electron-workflow.mjs`

- [ ] **Step 1: 패키지** — 설계 §5의 흐름을 합성으로: `read-ticket`(documents.read 합성 티켓 파일) → `draft`(agent: 위키 질의와 새 파일) → `approve`(human) → `verify`(tool: documents.exists + hash) → `report`(agent: 요약 출력 schema). 외부 반영 없음(`externalWrite:never`).
- [ ] **Step 2: 검사** — 실제 Electron + fixture 모델: 목록에서 시범 선택 → dry-run 통과 표시 → 실행 → 사람 단계에서 질문 카드 → 답 → 완료 → 보고서 열기. 앱을 강제 종료하고 다시 열어 대기 단계부터 재개되는 장면 포함. 1280/440.
- [ ] **Step 3: 실패 확인 → 구현 → 통과**.

---

## Task 9: 루틴 트리거 연결

**Files:**
- Modify: `runtime/routines.mjs`(`kind:'workflow'`, `slug`, `inputs`), `ui/RoutineSettings.jsx`(대상 선택: 대화 요청 또는 워크플로우), `tests/routines.test.mjs`

- [ ] **Step 1: 시험** — 루틴 `kind:'workflow'`가 정시에 `startWorkflow`를 부르고, 대기 중인 사람 단계가 있으면 다음 예약에서 중복 시작하지 않는다(기존 `pending` 규칙).
- [ ] **Step 2: 실패 확인 → 구현 → 통과**.

---

## Task 10: 문서, QA, 업로드

- [ ] **Step 1: 문서** — `docs/WORKFLOW-AGENT-2026-10.md`: 형식(필드 표), 템플릿 문법, 어댑터 표, dry-run과 감독 실행 절차, 한계(Windows 실측 전 office 없음), 시범 패키지 안내. `AGENTS.md`에 "워크플로우 순서는 호스트가 강제, 단계 출력은 스키마" 한 줄.
- [ ] **Step 2: QA** — `npm run test:gates` + `check-workflow-ui` + `check-electron-workflow` + Claude QA 묶음. 도구 예산과 압축 시험 유지.
- [ ] **Step 3: 업로드(Claude)** — 메시지: `feat(nubi-desktop): 워크플로우 에이전트 1단계 — 정의 형식, 러너, dry-run, 보고서, 읽기 전용 캔버스, e2e 변환기`.


---

## 1단계 검토 결과 (2026-10-18, Claude 독립 검토 — Task 8 시범 실행 전에 고칠 것)

Task 1~5 시험 110개는 통과했다. 코드 추적으로 확인한 결함은 아래 아홉이며 **W1~W5, W7은 Task 8(시범 실행) 전에**, W6, W8, W9는 같은 묶음에서 고친다. 각 항목은 실패 시험을 먼저 추가한다.

### W1. 분기가 아닌 단계의 `next`가 무시되어 양쪽 경로가 모두 실행됨 (치명)
- 원인: `workflow-run.mjs:64` `markStep`이 체크포인트의 `next`만 보고 다음 단계를 정하는데, 러너는 branch 패치(`workflow-runner.mjs:187`)에만 `next`를 넣는다. tool/agent/human 완료 패치에는 정의의 `next`가 들어가지 않아 배열 순서로 넘어간다.
- 재현: `[pick(branch then:A else:B), A(next:end), B, end]` → pick→A 뒤 B도 실행된다. 기존 시험은 `then:'end'`만 써서 못 잡았다.
- 고침: 모든 완료 패치에 `next:step.next`를 넣거나 `markStep`이 정의에서 후속을 읽게 한다. 시험: 위 재현이 B를 건너뛰는지.

### W2. 분기가 아닌 단계의 `when`이 평가되지 않음 (치명)
- 원인: 스키마는 모든 단계에 `when`을 허용하지만 러너는 branch에서만 읽는다(`runner:186`). 설계 §3.1 예시의 `publish` 단계가 무조건 실행된다.
- 고침: tool/agent/human 단계도 디스패치 전에 `when`을 평가해 거짓이거나 `undefined`면 `skipped`. 템플릿의 `!x`, `x != 'a'`는 `x`가 undefined일 때 **닫힌 방향**으로(조건을 만족하지 않은 것으로) 처리한다. 시험: 미완료 단계 출력에 기대는 조건이 실행을 막는지.

### W3. `startAgent` 일시 실패 뒤 에이전트 단계가 영구히 멈춤 (중요)
- 원인: `runner:114`가 `agentStarted:true`를 먼저 저장하고 `startAgent`가 `agent_busy`/`provider_missing`/위키 미준비로 던지면 되돌리지 않는다. 다음 재개는 `workflow_output_missing`으로 다시 대기.
- 고침: `agentStarted`는 `startAgent`가 돌아온 뒤에 저장하거나 사전 거절 오류에서는 초기화. 시험: 첫 시작 실패 → 공급자 연결 → 재개 시 에이전트가 실제로 시작되는지.

### W4. `submit_step_output`을 끝내 부르지 않은 단계가 `partial`이 아니라 `waiting`으로 남음 (중요)
- 원인: `runner:117,123`. 모델이 산문으로 끝내거나 예산 마무리 호출(도구 없음)로 끝나면 `workflow_output_missing` 대기 상태로 질문도 카드도 없이 멈춘다. 제안 반영 뒤 러너를 깨우는 경로도 없다.
- 고침: 하위 대화가 `review`/`paused`/`cancelled`로 끝났고 대기 중인 질문/승인이 없으며 제출이 없으면 `finish(run,'partial','workflow_output_missing')`. 제안 반영(`confirmProposal`)과 질문 답은 러너를 깨운다. 시험: 산문으로 끝난 단계가 `partial`로 닫히는지.

### W5. 템플릿과 데이터 오류가 try 밖에서 터져 `running` 좀비 실행을 남김 (중요)
- 원인: `scopeOf`(147), `resolve(step.args)`와 `stepCacheKey`(170), 174, 179, `ask()`(68)가 try(184) 앞에 있다. `template_invalid`나 `workflow_data_invalid`가 나면 `start`/`resume`이 거부되고 실행은 체크포인트 없이 `running`에 머문다. dry-run도 진단 대신 충돌.
- 고침: 범위 계산, 인자 해석, 멱등 키 계산까지 모두 같은 catch 안으로 넣어 `finish(run,'partial',code)`로 닫고, dry-run은 그 코드를 진단으로 보고한다. 시험: `{{ inputs.ticket | jsmUrl }}` 같은 잘못된 필터가 `partial`과 코드로 끝나는지.

### W6. `delegate_analysis` 계열이 단계 도구 제한을 우회 (중요)
- 원인: 단계 도구에 `read_source`/`source_search`/`wiki_*`가 있으면 공용 `runAgent`가 분석 코디네이터 도구를 자기 목록에 더하고(`agent-runtime.js:218-224`), 모델에는 숨기지만 도착한 호출은 `beforeToolCall`을 지나 `analyses.execute`로 바로 간다(611). `agent.mjs:591`의 `workflow_tool_forbidden`을 거치지 않는다.
- 고침: 워크플로우 단계에서는 `completeAnalysis`를 넘기지 않거나 공용 러너의 분석 도구 이름을 거절한다(선택적 인자, 기본 동작 보존). 시험: 위조된 `delegate_analysis` 호출이 거절되는지.

### W7. `human.outputs.decision`이 검증되지 않아 실제 실행이 충돌 (중요)
- 원인: 스키마 `outputs:{type:'object'}`. 설계 §3.1 예시 `decision: approve|revise`는 문자열로 파싱되고 dry-run은 `String.includes` 부분 일치로 통과하지만 실제 실행의 `ask()`에서 `choices.map is not a function`.
- 고침: `decision`은 비어 있지 않은 문자열 배열로 스키마 고정, 답 비교는 정확 일치. 설계 §3.1 예시도 `decision: [approve, revise]`로 고친다(Claude가 수정). 시험 추가.

### W8. `permissions`와 `externalWrite:never`가 실행 때 아무 효과가 없음 (중요)
- 원인: 러너와 어댑터가 `permissions`를 읽지 않는다. 저장 때 검사는 작성자가 `externalWrite:true`로 표시한 단계에만 걸린다. 에이전트 단계의 `tools`도 `permissions.tools`와 대조되지 않는다.
- 고침: 실행 때 ① 에이전트 단계의 `resolvedTools`를 `permissions.tools`가 허용한 어댑터/도구 집합으로 교차 검증(저장 때도), ② `externalWrite:never`면 외부 반영 도구(메일 보내기, 외부 MCP 쓰기, `send_file`은 제외)와 `irreversibleCommand`/`irreversibleMcpTool` 매칭 작업을 **거절**(승인 카드도 띄우지 않음), ③ `timeout`과 `on_failure`(retry 뒤 human)를 실제로 적용, `wiki` 해시 불일치는 경고로 보고서에. 실행 전체 상한(기본 2시간) 추가. 시험 각각.

### W9. 작은 것들
- `start()`가 `createTask` 전에 실행 레코드를 저장해 `createTask` 실패 시 `taskId` 없는 고아 실행이 남는다 → 순서를 바꾸거나 실패 시 레코드를 `failed`로.
- 자유 입력 사람 단계의 답이 글자 그대로 "stop"이면 취소된다 → 취소는 명시적 선택지나 단추로만.
- 멱등 키가 실행 안에서만 비교된다 → 설계 예시(`{{ inputs.ticket }}:publish`)대로 같은 워크플로우의 **이전 실행**과도 비교(저장소 조회), 일치하면 `skipped`와 사유.

### W1~W9 수정 검증 진행 (Codex)

- [x] 각 검토 항목의 실패 시험과 후속 경계 재현
- [x] W1~W9 구현과 집중 시험 167/167 (새 시험 30개)
- [x] 공통 보고서 1280px/440px 화면 검사와 직접 확인
- [x] 최종 `test:gates` 전체 종료 확인: 종료 0, 2,181개 중 1,981 통과 / 0 실패 / 200 건너뜀, 화면 117개와 Electron/MCP 검사 통과
- [ ] Claude QA와 업로드 (Claude 담당)

인계: `docs/WORKFLOW-AGENT-W1-W9-2026-10-18.md`. Task 6과 Task 8은 시작하지 않았다.

### 확인되어 괜찮은 것
단계 출처 바인딩과 단일 제출, 모델 노출 도구 필터와 실행 때 금지, 복구 넛지의 필터 재사용, 템플릿 평가기의 금지 이름과 깊이/길이 상한, dry-run의 무부작용, `terminal.run`의 승인 경유와 비가역 검사, 문서 어댑터의 루트 격리, 보고서 가림, 순환 검출, 재시작 시 미확정 처리.

---

## 2단계 이후 (이 계획 밖)

어댑터 계약 확정과 Windows 실측(office, VS Code), 저작(대화 저작 스킬, 캔버스 편집, 시연에서 만들기, 대화 저장에서 만들기), 운영(메일/A2A 트리거, 대시보드, 버전과 되돌리기, 위키 환류), 조직 공유. 설계 §4.
