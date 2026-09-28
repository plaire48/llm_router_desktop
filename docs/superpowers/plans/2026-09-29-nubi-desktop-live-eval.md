# 누비 Desktop 실측 루프와 계측 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 누비 Desktop의 모델 호출과 도구 호출을 실행별로 계측하고, 고정 과제 20개를 실제 모델로 돌려 관찰한 결과만으로 채점하는 평가 실행기를 만든다.

**Architecture:** 호스트가 호출 지점에서 목적을 표시해 기존 SQLite `events` 표에 크기와 사용량을 남긴다. 평가 실행기는 고정한 자료를 임시 Git 작업 공간에 풀고 실제 `ProjectService`를 화면 없이 구동한다. 로그인은 별도 세션 프로세스가 한 번만 수행하고 실행 프로세스는 유닉스 소켓으로 모델 호출만 요청한다.

**Tech Stack:** Node 24 이상, `node:test`, `node:sqlite`, 기존 Pi 0.86.1과 공유 실행기. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-29-nubi-desktop-live-eval-design.md`

## 반영 상태

2026-09-29에 사용자 요청으로 Task 1부터 12까지와 Task 13의 Step 1, 3을 `packages/nubi-desktop`에 반영했다.

| 항목 | 상태 |
|---|---|
| Task 1 ~ 12 | 반영 완료. 새 검사 63개 통과 |
| Task 13 Step 1 전체 검사 | 365개 중 364개 통과. 실패는 기존 실패 1개 |
| Task 13 Step 2 빌드 기록 갱신 | **막힘.** `npm run compile`이 디자인 검사 `HTML palette changed: green`에서 멈춘다. 계측 변경과 무관하다 |
| Task 13 Step 3 명령줄 확인 | 완료 |
| Task 13 Step 5, 6 실모델 기준선 | 미실행. 사용자 로그인 필요 |
| 저장소 커밋 | 하지 않음. 반영할 저장소 미정 |

## Global Constraints

- 작업 위치는 `packages/nubi-desktop`. 모든 명령은 이 폴더에서 실행한다.
- 새 파일은 `runtime/run-metrics.mjs`, `eval/`, `docs/LIVE-EVAL.md`, `tests/run-metrics*.test.mjs`, `tests/eval-*.test.mjs`에만 둔다.
- 수정하는 기존 파일은 `runtime/recovery.mjs`, `runtime/agent.mjs`, `AGENTS.md`, `README.md` 넷뿐이다.
- `extensions/aipro-chat`, `packages/nubi-office`, `packages/openwiki`는 수정하지 않는다. 읽기와 import만 한다.
- `eval/`은 제품 번들에 넣지 않는다. `scripts/build-runtime.mjs`와 `package.json`을 바꾸지 않는다. 새 의존성을 추가하지 않는다.
- 에이전트 동작, 프롬프트, 도구 정의를 바꾸지 않는다.
- 계측은 크기, 횟수, 정해진 형식의 코드만 저장한다. 대화 본문, 도구 인자, 도구 결과 내용을 저장하지 않는다. 기록 실패는 실행을 멈추지 않는다.
- 인증값은 세션 프로세스 메모리에만 둔다. 파일, 로그, 기록, 소켓 응답에 쓰지 않는다.
- 모의 사용자는 명령 실행, 환경 설정, 관리자 실행, 명령 수정안, 컴퓨터 동작, 앱 연결을 승인하지 않는다.
- 모델의 완료 선언과 검토기의 `ready`를 점수에 넣지 않는다. 통과로 세는 결과는 `passed`뿐이다.
- 과제 한도: 10분, 모델 호출 80회, 사용자 상호작용 12회. 평가 전용이며 제품 제한을 바꾸지 않는다.
- 보고서 종류는 `desktop-live-model-evaluation`. 위치는 gitignore된 `verification/eval-live/`.
- 평가 실행기는 등록한 자료 이름만 받는다. 회사 저장소와 회사 문서를 자료로 쓰지 않는다.
- 사용자에게 보이는 문구는 한국어로 쓴다. 중간점을 쓰지 않는다.
- 기존 검사는 시작 시점에 302개 중 301개가 통과한다. 실패 1개는 `tests/agent-reuse.test.mjs`의 입력 한도 14,000 토큰 검사이며 이 계획의 범위가 아니다. 이 검사를 고치거나 한도를 올려 통과시키지 않는다. 새로 실패하는 검사가 없어야 한다.
- 검사를 통과시키려고 과제의 정답, 한도, 검사 코드를 바꾸지 않는다. 검사가 실패하면 구현을 고친다. 계획의 코드가 틀렸다고 판단하면 멈추고 보고한다.
- 설치 파일과 Windows 빌드를 하지 않는다.
- 저장소 반영은 사용자가 반영할 저장소를 정한 뒤에만 한다. 그때는 `GIT_INDEX_FILE` 임시 인덱스와 `commit-tree`를 쓰고 작업 폴더의 브랜치와 인덱스를 바꾸지 않는다. 그 전에는 각 Task의 마지막 단계에서 변경 파일 목록만 확인한다.

## 결정 기록

| 결정 | 내용 | 근거 |
|---|---|---|
| 계측 저장소 | 기존 `events` 표에 `metric_*` 종류로 저장 | 표를 새로 만들지 않아 기존 상태 DB와 호환 |
| 목적 표시 | `modelTransport`의 넷째 인자 | 모든 모델 호출이 이 함수 하나를 지난다. 프롬프트로 추측하지 않는다 |
| 중계 | Desktop 전용 `eval/relay.mjs` | 공유 실행기는 진행 신호 없이 120초가 지나면 시간 초과로 처리한다. Office 중계는 진행 신호를 전달하지 않는다 |
| 소켓 경로 | 100바이트 초과 시 거부 | macOS의 유닉스 소켓 경로 한도는 104바이트다. 직접 실행해 `EINVAL`을 확인했다 |
| readline 오류 처리 | 소켓 줄 읽기에 오류 처리기 연결 | Node 25에서 연결 실패가 처리되지 않은 오류로 프로세스를 끝내는 것을 확인했다 |
| 자료 고정 | tar.gz와 파일별 SHA-256 목록 | 원본 폴더가 바뀌어도 정답이 유효하다 |
| 코드 수정 자료 | 합성 `order-service` | `openwiki-sds`는 의존성 설치 없이 검사를 실행할 수 없다 |
| 제안 반영 시점 | 마지막 발화 뒤 한 번, 경로별 최신 제안 | 사용자 정정 과제에서 이전 제안이 먼저 반영되면 뒤 제안이 `source_stale`이 된다 |
| 압축 과제 | 발화 4회, 문맥 한도 28,000 | 고정 비용이 약 14,000 토큰이다. 24,000에서는 매 호출 압축이 일어났고 30,000에서는 발화 3회로 압축이 일어나지 않았다 |
| 숫자 정답 | `re:(?<![\d.\-])17(?![\d.\-])` | `17`은 날짜 `2026-09-17`에도 들어 있다 |
| 부재 과제의 금지어 | `HTTPS_PROXY` 등은 `answer_flags` | 올바른 답이 "그런 변수는 문서에 없다"고 언급할 수 있다 |
| 후보 식별 | 빌드 기록의 입력 목록과 `runtime/` 전체 | 빌드 기록이 오래돼도 런타임 변경이 빠지지 않는다 |

## 검증 상태

이 계획의 모든 코드는 저장소 밖 복제 환경에서 실제 `ProjectService`와 공유 실행기에 연결해 실행했다.

| 항목 | 결과 |
|---|---|
| 새 검사 | 63개 모두 통과 |
| 전체 검사 | 365개 중 364개 통과. 실패 1개는 기존 실패 |
| 명령줄 전체 경로 | 미리 짠 모델을 실제 중계로 연결해 `run.mjs`와 `compare.mjs` 실행 확인 |
| 실모델 | 미실행. Task 13에서 사용자가 로그인한 뒤 측정 |

복제 환경은 `runtime/`과 `tests/`의 사본에 나머지 폴더를 링크로 연결한 구성이다. 실제 저장소에서 다시 확인해야 한다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `runtime/run-metrics.mjs` | 계측 기록과 합계. 본문을 저장하지 않는다 |
| `runtime/recovery.mjs` | `modelTransport`에 목적 인자와 계측 연결 |
| `runtime/agent.mjs` | 호출 지점의 목적 표시, 도구와 압축 계측 |
| `eval/relay.mjs` | 모델 호출 중계 서버와 연결 |
| `eval/model-session.mjs` | 로그인 유지 |
| `eval/transcript.mjs` | 모델 호출 전체 기록, 호출 한도, 문맥 한도 낮추기 |
| `eval/corpus.mjs` | 고정 자료 검증과 작업 공간 생성 |
| `eval/pin-corpus.mjs` | 자료 스냅샷과 해시 목록 생성 |
| `eval/corpus-src/order-service/` | 합성 자료의 원본 17개 파일 |
| `eval/corpus/` | 고정한 자료. `pin-corpus.mjs`가 생성 |
| `eval/cases.mjs` | 과제 읽기와 형식 검사 |
| `eval/cases/*.json` | 과제 20개와 정답 |
| `eval/cases/texts/L1-meeting-notes.md` | 압축 과제의 회의록 |
| `eval/user.mjs` | 모의 사용자와 제안 반영 |
| `eval/grade.mjs` | 채점 |
| `eval/driver.mjs` | 과제 구동과 한도 |
| `eval/candidate.mjs` | 실행 후보 식별 |
| `eval/run.mjs` | 실측 실행기와 보고서 |
| `eval/compare.mjs` | 보고서 비교 |
| `eval/README.md`, `docs/LIVE-EVAL.md` | 실행 방법과 범위 |

---

### Task 1: 제품 계측 모듈

**Files:**
- Create: `runtime/run-metrics.mjs`
- Test: `tests/run-metrics.test.mjs`

**Interfaces:**
- Consumes: `contextTokens(messages, tools)` (`extensions/aipro-chat/context-manager.js`), `Store#event(kind, value)`, `Store#db` (`runtime/store.mjs`)
- Produces: `createRunMetrics({store, taskId, runId, now?}) -> {beginModel, beginTool, compaction}`
-   - `beginModel({purpose, attempt, messages, tools, model}) -> {end(result), fail(code)}`
-   - `beginTool({tool, scope?}) -> {end(result), fail(code)}`. `scope`는 `'leader'` 또는 `'child'`
-   - `compaction({trigger, beforeTokens, afterTokens})`
- Produces: `readRunMetrics(store, {taskId?, runId?}) -> {events, summary}`
- Produces: `measureRequest(messages, tools) -> {messageCharacters, systemCharacters, toolCharacters, imageCount, estimatedTokens}`
- Produces: `METRIC_PURPOSES`, `METRIC_TRIGGERS`, `METRIC_KINDS`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/run-metrics.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {createRunMetrics,readRunMetrics,measureRequest} from '../runtime/run-metrics.mjs';

async function store(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-metrics-')),value=new Store(directory);
  t.after(async()=>{value.close();await rm(directory,{recursive:true,force:true});});
  return value;
}
const messages=[{role:'system',content:'SYSTEM_BODY'},{role:'user',content:'USER_SECRET_BODY'},{role:'user',content:[{type:'text',text:'caption'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}];
const tools=[{type:'function',function:{name:'read_source',description:'d',parameters:{type:'object',properties:{}}}}];

test('request sizes separate system, tool schema and images without counting image bytes',()=>{
  const size=measureRequest(messages,tools);
  assert.equal(size.systemCharacters,'SYSTEM_BODY'.length+2);
  assert.equal(size.toolCharacters,JSON.stringify(tools).length);
  assert.equal(size.imageCount,1);
  assert.ok(size.messageCharacters<200,'image data is not counted as text');
  assert.ok(size.estimatedTokens>4096,'an image keeps its fixed token estimate');
});

test('model, tool and compaction events keep typed facts only',async t=>{
  const s=await store(t);let clock=1000;const metrics=createRunMetrics({store:s,taskId:'task-1',runId:'run-1',now:()=>clock});
  const model=metrics.beginModel({purpose:'planner',attempt:2,messages,tools,model:'fixture'});clock+=250;
  model.end({content:'ANSWER_BODY',finishReason:'stop',usage:{prompt_tokens:120,completion_tokens:30,prompt_tokens_details:{cached_tokens:100}},calls:[{function:{name:'read_source',arguments:'{"path":"SECRET_ARGUMENT"}'}}]});
  const failed=metrics.beginModel({purpose:'not-a-purpose',messages,tools,model:'fixture'});failed.fail('Upstream said: SECRET RAW ERROR');
  const tool=metrics.beginTool({tool:'read_source'});clock+=40;tool.end({path:'a.txt',content:'RESULT_BODY',image:{mimeType:'image/png',data:'BBBB'}});
  metrics.beginTool({tool:'wiki_query',scope:'child'}).end({error:'wiki_missing'});
  metrics.compaction({trigger:'overflow',beforeTokens:9000,afterTokens:4000});
  const {events,summary}=readRunMetrics(s,{taskId:'task-1',runId:'run-1'});
  assert.deepEqual(events.map(e=>e.kind),['metric_model','metric_model','metric_tool','metric_tool','metric_compaction']);
  assert.deepEqual(events.map(e=>e.sequence),[1,2,3,4,5]);
  assert.equal(events[0].purpose,'planner');assert.equal(events[0].attempt,2);assert.equal(events[0].elapsedMs,250);
  assert.deepEqual(events[0].usage,{prompt_tokens:120,completion_tokens:30,cached_tokens:100});
  assert.deepEqual(events[0].calls,['read_source']);
  assert.equal(events[1].purpose,'actor','unknown purposes fall back to actor');assert.equal(events[1].error,'unknown','raw error text is not stored');
  assert.equal(events[2].imageCount,1);assert.equal(events[2].resultCharacters,JSON.stringify({path:'a.txt',content:'RESULT_BODY'}).length);assert.equal(events[2].scope,'leader');
  assert.equal(events[3].scope,'child');assert.equal(events[3].error,'wiki_missing');
  assert.equal(events[4].trigger,'overflow');
  const stored=JSON.stringify(s.db.prepare('SELECT value FROM events').all());
  for(const secret of ['SYSTEM_BODY','USER_SECRET_BODY','ANSWER_BODY','SECRET_ARGUMENT','SECRET RAW ERROR','RESULT_BODY','AAAA','BBBB'])assert.ok(!stored.includes(secret),secret);
  assert.equal(summary.modelCalls,2);assert.equal(summary.retries,1);assert.equal(summary.toolCalls,2);assert.equal(summary.compactions,1);
  assert.equal(summary.byPurpose.planner.promptTokens,120);assert.equal(summary.byTool.read_source.calls,1);
  assert.equal(summary.cacheShare,100/120);assert.deepEqual(summary.toolErrors,{wiki_missing:1});assert.deepEqual(summary.modelErrors,{unknown:1});
  assert.ok(summary.fixedShare>0&&summary.fixedShare<=1);
});

test('a settled call is recorded once and other runs are not mixed in',async t=>{
  const s=await store(t),first=createRunMetrics({store:s,taskId:'task-1',runId:'run-1'}),second=createRunMetrics({store:s,taskId:'task-1',runId:'run-2'});
  const call=first.beginModel({purpose:'actor',messages,tools,model:'fixture'});call.end({content:''});call.end({content:''});call.fail('late');
  second.beginTool({tool:'read_source'}).end({});
  assert.equal(readRunMetrics(s,{taskId:'task-1',runId:'run-1'}).events.length,1);
  assert.equal(readRunMetrics(s,{taskId:'task-1',runId:'run-2'}).events.length,1);
  assert.equal(readRunMetrics(s,{taskId:'task-1'}).events.length,2);
});

test('a failing store never throws into the measured run',()=>{
  const broken={event(){throw new Error('disk full');},db:{prepare(){throw new Error('disk full');}}};
  const metrics=createRunMetrics({store:broken,taskId:'t',runId:'r'});
  assert.doesNotThrow(()=>{metrics.beginModel({purpose:'actor',messages,tools,model:'m'}).end({});metrics.beginTool({tool:'x'}).fail('e');metrics.compaction({trigger:'history',beforeTokens:1,afterTokens:1});});
  const circular={};circular.self=circular;
  assert.doesNotThrow(()=>createRunMetrics({store:broken,taskId:'t',runId:'r'}).beginTool({tool:'x'}).end(circular));
});

test('metric events older than thirty days are removed when a run starts; other events stay',async t=>{
  const s=await store(t),old=new Date(Date.now()-31*24*60*60*1000).toISOString(),insert=s.db.prepare('INSERT INTO events (at,kind,value) VALUES (?,?,?)');
  insert.run(old,'metric_model',JSON.stringify({taskId:'old',runId:'old',sequence:1}));
  insert.run(old,'task_created',JSON.stringify({id:'old'}));
  insert.run(new Date().toISOString(),'metric_tool',JSON.stringify({taskId:'new',runId:'new',sequence:1,tool:'x',elapsedMs:0}));
  createRunMetrics({store:s,taskId:'t',runId:'r'});
  assert.deepEqual(s.db.prepare('SELECT kind FROM events ORDER BY sequence').all().map(row=>row.kind),['task_created','metric_tool']);
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/run-metrics.test.mjs`

Expected: FAIL. `Cannot find module '.../runtime/run-metrics.mjs'`

- [ ] **Step 3: 구현**

`runtime/run-metrics.mjs`

````js
// Per-run cost telemetry. Stores sizes, counts and typed codes only: never
// message bodies, tool arguments or tool results. A recording failure must
// never change the run under measurement.
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';

export const METRIC_PURPOSES = Object.freeze(['actor', 'planner', 'reviewer', 'summary', 'analysis', 'document']);
export const METRIC_TRIGGERS = Object.freeze(['history', 'threshold', 'overflow']);
export const METRIC_KINDS = Object.freeze(['metric_model', 'metric_tool', 'metric_compaction']);
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const code = value => value === undefined || value === null || value === '' ? null : typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : 'unknown';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const textLength = content => typeof content === 'string' ? content.length : JSON.stringify((Array.isArray(content) ? content : []).filter(part => part?.type === 'text')).length;
const imageParts = content => Array.isArray(content) ? content.filter(part => part?.type === 'image_url' || part?.type === 'image').length : 0;

export function measureRequest(messages = [], tools = []) {
  let messageCharacters = 0, systemCharacters = 0, imageCount = 0;
  for (const message of messages) {
    const length = textLength(message.content) + JSON.stringify(message.tool_calls || []).length;
    messageCharacters += length; imageCount += imageParts(message.content);
    if (message.role === 'system') systemCharacters += length;
  }
  return {messageCharacters, systemCharacters, toolCharacters: JSON.stringify(tools).length, imageCount, estimatedTokens: contextTokens(messages, tools)};
}

function usageFacts(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = count(usage.prompt_tokens), completion = count(usage.completion_tokens), cached = count(usage.prompt_tokens_details?.cached_tokens);
  if (prompt === null && completion === null) return null;
  return {prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached};
}

export function createRunMetrics({store, taskId, runId, now = () => Date.now()}) {
  let sequence = 0;
  const write = (kind, value) => { try { store.event(kind, {taskId, runId, sequence: ++sequence, ...value}); } catch { /* Telemetry only. */ } };
  try { store.db.prepare("DELETE FROM events WHERE kind LIKE 'metric\\_%' ESCAPE '\\' AND at < ?").run(new Date(now() - RETENTION_MS).toISOString()); } catch { /* Telemetry only. */ }
  return {
    beginModel({purpose, attempt = 1, messages, tools, model}) {
      let facts, started = now(), settled = false;
      try { facts = {purpose: METRIC_PURPOSES.includes(purpose) ? purpose : 'actor', attempt: count(attempt) || 1, model: typeof model === 'string' ? model.slice(0, 200) : null, ...measureRequest(messages, tools)}; } catch { facts = null; }
      const finish = extra => { if (settled || !facts) return; settled = true; write('metric_model', {...facts, elapsedMs: Math.max(0, now() - started), ...extra}); };
      return {
        end(result) { let extra; try { extra = {usage: usageFacts(result?.usage), finishReason: code(result?.finishReason), calls: (result?.calls || []).map(call => code(call?.function?.name)).filter(Boolean), error: null}; } catch { extra = {usage: null, finishReason: null, calls: [], error: null}; } finish(extra); },
        fail(error) { finish({usage: null, finishReason: null, calls: [], error: code(error) || 'unknown'}); },
      };
    },
    beginTool({tool, scope = 'leader'}) {
      const started = now(); let settled = false;
      const finish = extra => { if (settled) return; settled = true; write('metric_tool', {tool: code(tool) || 'unknown', scope: scope === 'child' ? 'child' : 'leader', elapsedMs: Math.max(0, now() - started), ...extra}); };
      return {
        end(result) { let extra; try { const {image, ...rest} = result && typeof result === 'object' ? result : {}; extra = {resultCharacters: JSON.stringify(rest).length, imageCount: image ? 1 : 0, error: code(rest.error)}; } catch { extra = {resultCharacters: null, imageCount: 0, error: 'unknown'}; } finish(extra); },
        fail(error) { finish({resultCharacters: 0, imageCount: 0, error: code(error) || 'unknown'}); },
      };
    },
    compaction({trigger, beforeTokens, afterTokens}) { write('metric_compaction', {trigger: METRIC_TRIGGERS.includes(trigger) ? trigger : 'threshold', beforeTokens: count(beforeTokens), afterTokens: count(afterTokens)}); },
  };
}

const bump = (target, key, fields) => { const row = target[key] ??= {calls: 0}; row.calls++; for (const [name, value] of Object.entries(fields)) row[name] = (row[name] || 0) + (value || 0); };

// Reads a run's metric events in order and totals them by purpose and tool.
export function readRunMetrics(store, {taskId, runId} = {}) {
  const rows = store.db.prepare("SELECT kind,value FROM events WHERE kind LIKE 'metric\\_%' ESCAPE '\\' ORDER BY sequence").all()
    .map(row => ({kind: row.kind, ...JSON.parse(row.value)}))
    .filter(row => (!taskId || row.taskId === taskId) && (!runId || row.runId === runId));
  const summary = {modelCalls: 0, retries: 0, toolCalls: 0, compactions: 0, elapsedMs: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedTokens: 0, measuredCalls: 0, measuredEstimatedTokens: 0,
    peakRequestCharacters: 0, fixedCharacters: 0, requestCharacters: 0, byPurpose: {}, byTool: {}, modelErrors: {}, toolErrors: {}};
  for (const row of rows) {
    if (row.kind === 'metric_model') {
      const request = row.messageCharacters + row.toolCharacters;
      summary.modelCalls++; if (row.attempt > 1) summary.retries++;
      summary.elapsedMs += row.elapsedMs; summary.estimatedTokens += row.estimatedTokens;
      summary.requestCharacters += request; summary.fixedCharacters += row.systemCharacters + row.toolCharacters;
      summary.peakRequestCharacters = Math.max(summary.peakRequestCharacters, request);
      if (row.usage?.prompt_tokens) { summary.measuredCalls++; summary.measuredEstimatedTokens += row.estimatedTokens; }
      summary.promptTokens += row.usage?.prompt_tokens || 0; summary.completionTokens += row.usage?.completion_tokens || 0; summary.cachedTokens += row.usage?.cached_tokens || 0;
      bump(summary.byPurpose, row.purpose, {elapsedMs: row.elapsedMs, estimatedTokens: row.estimatedTokens, promptTokens: row.usage?.prompt_tokens, completionTokens: row.usage?.completion_tokens, cachedTokens: row.usage?.cached_tokens, requestCharacters: request});
      if (row.error) summary.modelErrors[row.error] = (summary.modelErrors[row.error] || 0) + 1;
    } else if (row.kind === 'metric_tool') {
      summary.toolCalls++;
      bump(summary.byTool, row.tool, {elapsedMs: row.elapsedMs, resultCharacters: row.resultCharacters, imageCount: row.imageCount});
      if (row.error) summary.toolErrors[row.error] = (summary.toolErrors[row.error] || 0) + 1;
    } else if (row.kind === 'metric_compaction') summary.compactions++;
  }
  summary.fixedShare = summary.requestCharacters ? summary.fixedCharacters / summary.requestCharacters : null;
  summary.cacheShare = summary.promptTokens ? summary.cachedTokens / summary.promptTokens : null;
  summary.estimateRatio = summary.measuredEstimatedTokens ? summary.promptTokens / summary.measuredEstimatedTokens : null;
  return {events: rows, summary};
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/run-metrics.test.mjs`

Expected: `pass 5`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

---

### Task 2: 계측 연결

**Files:**
- Modify: `runtime/recovery.mjs` (`modelTransport`)
- Modify: `runtime/agent.mjs` (모델 호출 지점 6곳, 압축 2곳, 도구 실행 1곳)
- Test: `tests/run-metrics-wiring.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `createRunMetrics`, `readRunMetrics`
- Produces: `modelTransport(service, {signal, onRetry, metrics}) -> (messages, tools, childSignal?, purpose?) => Promise<result>`. `purpose`의 기본값은 `'actor'`
- 호출 지점과 목적: 주 실행 `actor`, `prepareWorkPlan` `planner`, `reviewResult` `reviewer`, `summarize` `summary`, `completeAnalysis` `analysis`, `analyze_documents` `document`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/run-metrics-wiring.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096}]});
const plan={intent:{goal:'확인',constraints:[],outcomes:['결과를 전달한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'답변',expected_outcome:'결과를 전달한다',status:'pending'}]};
const ready=messages=>({content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]});

test('each model call is recorded with the purpose of its call site and each tool with its size',async t=>{
  const {service}=await fixture(t,{scriptedReview:true,scriptedPlanning:true});let actor=0;
  service.providers={status,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[],usage:{prompt_tokens:300,completion_tokens:40}};
    if(messages[0].content.startsWith(REVIEW_PROMPT))return ready(messages);
    return ++actor===1?{...call('wiki_query',{query:'welcome'}),usage:{prompt_tokens:9000,completion_tokens:20,prompt_tokens_details:{cached_tokens:8000}}}:{content:'환영 화면은 app.txt를 사용합니다.',calls:[]};
  }};
  const task=await service.createTask({request:'환영 화면이 쓰는 파일을 알려 줘'}),{runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const {events,summary}=readRunMetrics(service.store,{taskId:task.id,runId});
  assert.deepEqual(events.filter(e=>e.kind==='metric_model').map(e=>e.purpose),['actor','planner','actor','reviewer']);
  const tools=events.filter(e=>e.kind==='metric_tool');
  assert.ok(tools.some(e=>e.tool==='wiki_query'&&e.scope==='leader'&&e.resultCharacters>0&&e.error===null));
  assert.ok(tools.some(e=>e.tool==='update_plan'));
  assert.equal(summary.byPurpose.actor.calls,2);assert.equal(summary.byPurpose.actor.cachedTokens,8000);
  assert.equal(summary.promptTokens,9300);assert.ok(summary.fixedShare>0.5,'system and tool schema dominate a short request');
  assert.ok(!JSON.stringify(events).includes('환영 화면'),'no request or answer text in telemetry');
});

test('a retried model call records every attempt and a failed tool records its code',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={model:{minTimeout:1}};let actor=0;
  service.providers={status,dispose(){},async complete(){
    actor++;
    if(actor===1)throw Object.assign(new Error('upstream'),{status:503});
    if(actor===2)return call('read_source',{path:'missing.txt'});
    return {content:'파일을 찾지 못했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'missing.txt를 읽어 줘'}),{runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  const {events,summary}=readRunMetrics(service.store,{taskId:task.id,runId});
  const actors=events.filter(e=>e.kind==='metric_model'&&e.purpose==='actor');
  assert.deepEqual(actors.slice(0,2).map(e=>[e.attempt,e.error===null]),[[1,false],[2,true]]);
  assert.equal(summary.retries,1);
  assert.ok(events.some(e=>e.kind==='metric_tool'&&e.tool==='read_source'&&typeof e.error==='string'));
});

test('a history compaction is recorded with its trigger',async t=>{
  const {service}=await fixture(t);
  const task=await service.createTask({request:'Original user goal'});
  task.messages=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:'Historical project discussion '+i+' '+'reference details '.repeat(500)}));service.store.set('task:'+task.id,task);
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000,maxOutputTokens:4096}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation'))return {content:JSON.stringify({goal:'Original user goal',constraints:[],decisions:[],completed:[],pending:[],references:[]}),calls:[]};
    return {content:'확인했습니다.',calls:[]};
  }};
  const {runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const {events}=readRunMetrics(service.store,{taskId:task.id,runId});
  assert.ok(events.some(e=>e.kind==='metric_model'&&e.purpose==='summary'));
  const compaction=events.find(e=>e.kind==='metric_compaction');
  assert.equal(compaction.trigger,'history');assert.ok(compaction.beforeTokens>compaction.afterTokens);
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/run-metrics-wiring.test.mjs`

Expected: FAIL. 세 검사 모두 계측 이벤트가 없어 실패한다.

- [ ] **Step 3: 구현**

두 파일 모두 한 줄이 매우 길다. 아래 문자열을 **정확히 한 번** 찾아 바꾼다. 찾은 횟수가 1이 아니면 멈추고 보고한다. 줄 전체를 다시 쓰지 않는다.

코드 블록의 마지막 줄바꿈은 문자열에 포함하지 않는다. 여러 줄인 문자열의 중간 줄바꿈과 들여쓰기는 그대로 포함한다. 문자열 대부분은 줄의 일부다.

#### `runtime/recovery.mjs`

**수정 1**

찾을 문자열:

````js
export function modelTransport(service,{signal,onRetry}){
  const cooldown=createModelCooldown();
  return (messages,tools,childSignal=signal)=>recoverModel(async ({signal:attemptSignal,activity})=>{
    try{return await service.providers.complete(messages,tools,attemptSignal,activity,activity);}
    catch(error){const code=safeError(error);throw Object.assign(
````

바꿀 문자열:

````js
export function modelTransport(service,{signal,onRetry,metrics}){
  const cooldown=createModelCooldown();
  // Telemetry reads the model name defensively: it must not add a failure path.
  const modelName=()=>{try{return service.providers.status().model;}catch{return null;}};
  return (messages,tools,childSignal=signal,purpose='actor')=>recoverModel(async ({signal:attemptSignal,activity,attempt})=>{
    const measured=metrics?.beginModel({purpose,attempt,messages,tools,model:modelName()});
    try{const result=await service.providers.complete(messages,tools,attemptSignal,activity,activity);measured?.end(result);return result;}
    catch(error){const code=safeError(error);measured?.fail(code);throw Object.assign(
````

#### `runtime/agent.mjs`

**수정 1**

찾을 문자열:

````js
import {reviewResult,runReviewedAgent} from './result-review.mjs';
````

바꿀 문자열:

````js
import {reviewResult,runReviewedAgent} from './result-review.mjs';
import {createRunMetrics} from './run-metrics.mjs';
````

**수정 2**

찾을 문자열:

````js
    const invokeModel = modelTransport(this,{signal:controller.signal,onRetry:
````

바꿀 문자열:

````js
    const metrics=createRunMetrics({store:this.store,taskId,runId});
    const invokeModel = modelTransport(this,{signal:controller.signal,metrics,onRetry:
````

**수정 3**

찾을 문자열:

````js
    let lastWire=[],planningHistory=[];
````

바꿀 문자열:

````js
    let lastWire=[],planningHistory=[],overflowing=false;
````

**수정 4**

찾을 문자열:

````js
throw error;wire=await context.prepare(messages,true,definitions);result=await invokeModel(wire,definitions);}
````

바꿀 문자열:

````js
throw error;overflowing=true;try{wire=await context.prepare(messages,true,definitions);}finally{overflowing=false;}result=await invokeModel(wire,definitions);}
````

**수정 5**

찾을 문자열:

````js
model:conversationModel(model),invoke:invokeModel,signal:controller.signal,capabilities:capabilityContext()});
````

바꿀 문자열:

````js
model:conversationModel(model),invoke:(wire,definitions)=>invokeModel(wire,definitions,undefined,'planner'),signal:controller.signal,capabilities:capabilityContext()});
````

**수정 6**

찾을 문자열:

````js
      try{return await invokeModel(messages,[]);}
````

바꿀 문자열:

````js
      try{return await invokeModel(messages,[],undefined,'summary');}
````

**수정 7**

찾을 문자열:

````js
    const rememberCompaction=summary=>{task.context=
````

바꿀 문자열:

````js
    const rememberCompaction=(summary,trigger)=>{metrics.compaction({trigger,beforeTokens:summary.beforeTokens,afterTokens:summary.afterTokens});task.context=
````

**수정 8**

찾을 문자열:

````js
      if(packed.memory)rememberCompaction(packed.memory);
````

바꿀 문자열:

````js
      if(packed.memory)rememberCompaction(packed.memory,'history');
````

**수정 9**

찾을 문자열:

````js
observations.wikiEvidence?.clear();rememberCompaction(summary);}});
````

바꿀 문자열:

````js
observations.wikiEvidence?.clear();rememberCompaction(summary,overflowing?'overflow':'threshold');}});
````

**수정 10**

찾을 문자열:

````js
complete:(wire,definitions,scope)=>invokeModel(wire,definitions,scope.signal),taskId,runId,store:this.store,
````

바꿀 문자열:

````js
complete:(wire,definitions,scope)=>invokeModel(wire,definitions,scope.signal,'document'),taskId,runId,store:this.store,
````

**수정 11**

찾을 문자열:

````js
await reviewResult({...input,invoke:invokeModel});
````

바꿀 문자열:

````js
await reviewResult({...input,invoke:(wire,definitions)=>invokeModel(wire,definitions,undefined,'reviewer')});
````

**수정 12**

찾을 문자열:

````js
      completeAnalysis: (wire, definitions, scope) => invokeModel(wire, definitions, scope.signal),
````

바꿀 문자열:

````js
      completeAnalysis: (wire, definitions, scope) => invokeModel(wire, definitions, scope.signal, 'analysis'),
````

**수정 13**

찾을 문자열:

````js
      if(childSignal)return operation(name,args,childSignal);
````

바꿀 문자열:

````js
      if(childSignal){const measured=metrics.beginTool({tool:name,scope:'child'});try{const result=await operation(name,args,childSignal);measured.end(result);return result;}catch(error){measured.fail(recoveryCode(error));throw error;}}
      const measured=metrics.beginTool({tool:name});
````

**수정 14**

찾을 문자열:

````js
timeoutMs:this.recoveryOptions?.operationTimeoutMs||60000});endOperation(this,item,result);
````

바꿀 문자열:

````js
timeoutMs:this.recoveryOptions?.operationTimeoutMs||60000});measured.end(result);endOperation(this,item,result);
````

**수정 15**

찾을 문자열:

````js
      catch(error){if(!READ_TOOLS.has(name)&&this.unsettledOperations.has(item.id)){item.outcome='unknown';
````

바꿀 문자열:

````js
      catch(error){measured.fail(recoveryCode(error));if(!READ_TOOLS.has(name)&&this.unsettledOperations.has(item.id)){item.outcome='unknown';
````

문법 확인:

```bash
node --check runtime/agent.mjs && node --check runtime/recovery.mjs
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/run-metrics-wiring.test.mjs`

Expected: `pass 3`, `fail 0`

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm test`

Expected: `pass 309`, `fail 1`. 실패는 `desktop shared context compaction retains every original criterion ...` 하나뿐이다. 다른 검사가 실패하면 수정 문자열을 다시 확인한다.

- [ ] **Step 6: 변경 파일 확인**

Run: `git status --short -- .`

Expected: `runtime/recovery.mjs`, `runtime/agent.mjs`, `tests/run-metrics-wiring.test.mjs`와 Task 1의 파일.

---

### Task 3: 모델 중계와 세션

**Files:**
- Create: `eval/relay.mjs`
- Create: `eval/model-session.mjs`
- Test: `tests/eval-relay.test.mjs`

**Interfaces:**
- Consumes: `safeError(error)` (`packages/nubi-office/worker/connection-errors.mjs`), `createProviders({hostLabel})` (`packages/nubi-office/worker/providers.mjs`)
- Produces: `startRelayServer({providers, socketPath}) -> {close()}`
- Produces: `connectRelayProviders({socketPath}) -> {status(), complete(messages, tools, signal, onText), dispose()}`
- Produces: `publicStatus(status)`, `defaultSocketPath()`
- 소켓 프로토콜: 줄 단위 JSON. 요청 `{id, method: status|complete|cancel, messages?, tools?, target?}`. 응답 `{id, ok, result|error}`. 진행 신호 `{id, event: 'activity'}`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-relay.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,chmod,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startRelayServer,connectRelayProviders,publicStatus} from '../eval/relay.mjs';

const posix=process.platform!=='win32';
async function session(t,providers){
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-relay-'));await chmod(directory,0o700);
  const socketPath=posix?path.join(directory,'model.sock'):`\\\\.\\pipe\\nubi-relay-test-${process.pid}-${Date.now()}`;
  const server=await startRelayServer({providers,socketPath}),client=await connectRelayProviders({socketPath});
  t.after(async()=>{client.dispose();await server.close();await rm(directory,{recursive:true,force:true});});
  return {client,server,socketPath,directory};
}
const status=()=>({provider:'chatgpt',model:'fixture',connected:true,token:'SECRET_TOKEN',sessions:{secret:'SECRET_SESSION'},models:[{id:'fixture',label:'Fixture',contextLength:200000,maxOutputTokens:8192,supportsImages:true,secret:'SECRET_MODEL_FIELD'}]});

test('status carries model limits and never a credential',async t=>{
  const {client}=await session(t,{status,complete:async()=>({content:''})});
  assert.deepEqual(client.status(),{provider:'chatgpt',model:'fixture',connected:true,models:[{id:'fixture',label:'Fixture',contextLength:200000,maxOutputTokens:8192,supportsImages:true}]});
  assert.ok(!JSON.stringify(publicStatus(status())).includes('SECRET'));
});

test('a completion returns content, calls and usage; activity reaches the caller',async t=>{
  let received;
  const {client}=await session(t,{status,async complete(messages,tools,signal,onText){received={messages,tools};onText('partial');return {content:'답변',calls:[{id:'c1',type:'function',function:{name:'read_source',arguments:'{"path":"a"}'},secret:'x'}],finishReason:'stop',usage:{prompt_tokens:10,completion_tokens:2},raw:'SECRET_RAW'};}});
  let active=0;
  const result=await client.complete([{role:'user',content:'질문'}],[{type:'function',function:{name:'read_source'}}],undefined,()=>active++);
  assert.deepEqual(received.messages,[{role:'user',content:'질문'}]);
  assert.deepEqual(result,{content:'답변',calls:[{id:'c1',type:'function',function:{name:'read_source',arguments:'{"path":"a"}'}}],finishReason:'stop',usage:{prompt_tokens:10,completion_tokens:2}});
  assert.equal(active,1);
});

test('an upstream failure keeps its safe code and status only',async t=>{
  const {client}=await session(t,{status,async complete(){throw Object.assign(new Error('Bearer SECRET_TOKEN rejected at https://internal.example'),{status:401});}});
  await assert.rejects(client.complete([{role:'user',content:'q'}],[]),error=>{assert.equal(error.status,401);assert.ok(!error.message.includes('SECRET'));assert.ok(!error.message.includes('https://'));return true;});
});

test('cancelling a run aborts the upstream call',async t=>{
  let aborted=false,started;const running=new Promise(resolve=>{started=resolve;});
  const {client}=await session(t,{status,complete:(messages,tools,signal)=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));});})});
  const controller=new AbortController(),pending=client.complete([{role:'user',content:'q'}],[],controller.signal);
  await running;controller.abort();
  await assert.rejects(pending,/cancelled/);
  for(let wait=0;wait<50&&!aborted;wait++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(aborted,true);
});

test('a lost session rejects the call with a code that is not retried',async t=>{
  const {client,server}=await session(t,{status,complete:()=>new Promise(()=>{})});
  // Attach the expectation first: the rejection arrives while the server closes.
  const pending=assert.rejects(client.complete([{role:'user',content:'q'}],[]),error=>error.message==='worker_disconnected'&&error.retryable===false);
  await server.close();
  await pending;
  await assert.rejects(client.complete([{role:'user',content:'q'}],[]),/worker_disconnected/);
});

test('a socket directory readable by others is refused',{skip:!posix},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-relay-open-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const open=path.join(directory,'open');await mkdir(open,{mode:0o755});await chmod(open,0o755);
  await assert.rejects(startRelayServer({providers:{status,complete:async()=>({})},socketPath:path.join(open,'model.sock')}),/socket_directory_not_private/);
});

test('the socket itself is owner-only',{skip:!posix},async t=>{
  const {socketPath}=await session(t,{status,complete:async()=>({content:''})});
  assert.equal((await stat(socketPath)).mode&0o077,0);
});

test('a missing session and an overlong socket path fail with clear codes',{skip:!posix},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-relay-none-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(connectRelayProviders({socketPath:path.join(directory,'absent.sock')}),/worker_disconnected/);
  const long=path.join(directory,'x'.repeat(120),'model.sock');
  await assert.rejects(connectRelayProviders({socketPath:long}),/socket_path_too_long/);
  await assert.rejects(startRelayServer({providers:{status,complete:async()=>({})},socketPath:long}),/socket_path_too_long/);
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-relay.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/relay.mjs'`

- [ ] **Step 3: 구현**

`eval/relay.mjs`

````js
// Evaluation-only model relay. One session process holds the login; evaluation
// runs ask it for completions over a private socket. The credential never
// leaves the session process: it is not written to disk, logged, or sent over
// the socket. Not a product feature and not bundled.
import {createServer,createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {chmod,mkdir,rm,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {randomUUID} from 'node:crypto';
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';

const posix=process.platform!=='win32';
const ACTIVITY_INTERVAL_MS=1000;
// A Unix socket path has a small platform limit (104 bytes on macOS, 108 on Linux).
const MAX_SOCKET_PATH_BYTES=100;
const checkPath=socketPath=>{if(posix&&Buffer.byteLength(socketPath)>MAX_SOCKET_PATH_BYTES)throw new Error('socket_path_too_long');};
// readline re-emits socket errors. Unhandled, they would end the process.
const lines=(socket,onLine)=>createInterface({input:socket,crlfDelay:Infinity}).on('error',()=>{}).on('line',onLine);
export const defaultSocketPath=()=>posix?join(tmpdir(),`nubi-desktop-eval-${userInfo().uid}`,'model.sock'):`\\\\.\\pipe\\nubi-desktop-eval-${userInfo().username}`;

const positive=value=>Number.isSafeInteger(value)&&value>0?value:undefined;
// Desktop budgets context from these limits, so they travel with the status.
const publicModel=model=>({id:model.id,label:model.label,contextLength:positive(model.contextLength),maxInputTokens:positive(model.maxInputTokens),maxOutputTokens:positive(model.maxOutputTokens),...(typeof model.supportsImages==='boolean'?{supportsImages:model.supportsImages}:{})});
export const publicStatus=status=>({provider:status.provider,model:status.model,connected:status.connected===true,models:(status.models||[]).map(publicModel)});
const publicResult=result=>({content:result.content??'',calls:(result.calls||[]).map(call=>({id:call.id,type:call.type,function:{name:call.function?.name,arguments:call.function?.arguments}})),finishReason:result.finishReason,...(result.usage?{usage:result.usage}:{})});
const publicError=error=>({code:safeError(error),...(Number.isInteger(error?.status)?{status:error.status}:{}),...(Number.isFinite(error?.retryAfterMs)?{retryAfterMs:error.retryAfterMs}:{})});

export async function startRelayServer({providers,socketPath}){
  checkPath(socketPath);
  if(posix){
    const directory=dirname(socketPath);
    await mkdir(directory,{recursive:true,mode:0o700});
    // Any local process that can open the socket can spend the user's model quota.
    if((await stat(directory)).mode&0o077)throw new Error('socket_directory_not_private');
    await rm(socketPath,{force:true});
  }
  const sockets=new Set();
  const server=createServer(socket=>{
    const pending=new Map();sockets.add(socket);
    const send=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
    const refuse=(id,code)=>send({id,ok:false,error:{code}});
    socket.on('error',()=>{});
    socket.on('close',()=>{sockets.delete(socket);for(const controller of pending.values())controller.abort();pending.clear();});
    lines(socket,line=>{
      let request;try{request=JSON.parse(line);}catch{refuse(null,'invalid_request');return;}
      const id=typeof request?.id==='string'&&request.id.length<=100?request.id:null;
      if(!id){refuse(null,'invalid_request');return;}
      if(request.method==='status'){send({id,ok:true,result:publicStatus(providers.status())});return;}
      if(request.method==='cancel'){pending.get(request.target)?.abort();send({id,ok:true,result:{cancelled:true}});return;}
      if(request.method!=='complete'){refuse(id,'unknown_method');return;}
      if(!Array.isArray(request.messages)||!Array.isArray(request.tools)||pending.has(id)){refuse(id,'invalid_request');return;}
      const controller=new AbortController();pending.set(id,controller);
      // The run's idle clock needs model activity; forward it without content.
      let last=0;const activity=()=>{const now=Date.now();if(now-last<ACTIVITY_INTERVAL_MS||!pending.has(id))return;last=now;send({id,event:'activity'});};
      Promise.resolve().then(()=>providers.complete(request.messages,request.tools,controller.signal,activity,activity))
        .then(result=>send({id,ok:true,result:publicResult(result)}),error=>send({id,ok:false,error:controller.signal.aborted?{code:'cancelled'}:publicError(error)}))
        .finally(()=>pending.delete(id));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  if(posix)await chmod(socketPath,0o600);
  return{async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));if(posix)await rm(socketPath,{force:true});}};
}

// The providers object an evaluation run uses. It holds no credential.
export async function connectRelayProviders({socketPath}){
  checkPath(socketPath);
  const socket=createConnection(socketPath),pending=new Map();let closed=false;
  // A lost session must stop the run; a retryable code would loop on a dead socket.
  const lost=()=>{if(closed)return;closed=true;for(const {reject} of pending.values())reject(Object.assign(new Error('worker_disconnected'),{retryable:false}));pending.clear();};
  socket.on('error',lost);socket.on('close',lost);
  lines(socket,line=>{
    let reply;try{reply=JSON.parse(line);}catch{return;}
    const waiting=pending.get(reply.id);if(!waiting)return;
    if(reply.event==='activity'){try{waiting.activity();}catch{/* Presentation only. */}return;}
    pending.delete(reply.id);
    if(reply.ok)waiting.resolve(reply.result);
    else{const {code,...facts}=reply.error||{};waiting.reject(Object.assign(new Error(code||'request_failed'),facts));}
  });
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',()=>reject(new Error('worker_disconnected')));});
  const request=(id,method,body={},activity=()=>{})=>new Promise((resolve,reject)=>{
    if(closed){reject(Object.assign(new Error('worker_disconnected'),{retryable:false}));return;}
    pending.set(id,{resolve,reject,activity});
    socket.write(JSON.stringify({id,method,...body})+'\n');
  });
  const status=await request(randomUUID(),'status');
  return{
    status:()=>structuredClone(status),
    complete(messages,tools=[],signal,onText=()=>{}){
      if(signal?.aborted)return Promise.reject(new Error('cancelled'));
      const id=randomUUID(),result=request(id,'complete',{messages,tools},()=>onText());
      const abort=()=>{
        const waiting=pending.get(id);if(!waiting)return;
        pending.delete(id);waiting.reject(new Error('cancelled'));
        if(!closed)socket.write(JSON.stringify({id:randomUUID(),method:'cancel',target:id})+'\n');
      };
      signal?.addEventListener('abort',abort,{once:true});
      return result.finally(()=>signal?.removeEventListener('abort',abort));
    },
    dispose(){closed=true;pending.clear();socket.destroy();}
  };
}
````

`eval/model-session.mjs`

````js
// Keeps ONE model login alive for repeated evaluation runs, so a source change
// does not require a new login. Run this first, log in once in the browser,
// then start eval/run.mjs from another terminal. Evaluation-only.
import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {startRelayServer,defaultSocketPath} from './relay.mjs';

const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
const provider=option('provider')||'chatgpt',model=option('model')||'gpt-5.6-luna',socketPath=option('socket')||defaultSocketPath();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!['chatgpt','aipro'].includes(provider)){console.error('이 세션은 브라우저 로그인 제공자(chatgpt, aipro)만 지원합니다.');process.exit(2);}
const providers=createProviders({hostLabel:'누비 워크스페이스 평가'});
console.log('브라우저에서 로그인해 주세요. 3분 안에 완료해야 합니다.');
await providers.login(provider);
while(providers.status().pending)await pause(200);
if(!providers.status().connected){console.error('로그인을 완료하지 못했습니다: '+(providers.status().loginError||'no_credential'));providers.dispose();process.exit(1);}
try{providers.model(model);}catch{console.error('이 계정의 모델 목록에 없는 모델입니다: '+model);providers.dispose();process.exit(1);}
const server=await startRelayServer({providers,socketPath});
const stop=async()=>{await server.close();providers.dispose();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log('READY '+JSON.stringify({provider,model,socket:socketPath}));
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-relay.test.mjs`

Expected: `pass 8`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

`eval/model-session.mjs`는 실제 로그인이 필요해 단위 검사가 없다. Task 13에서 사용자가 실행해 확인한다.

---

### Task 4: 대화 기록과 호출 한도

**Files:**
- Create: `eval/transcript.mjs`
- Test: `tests/eval-transcript.test.mjs`

**Interfaces:**
- Consumes: `safeError(error)`
- Produces: `recordingProviders(providers, {write?, maxModelCalls?, modelLimits?}) -> {status(), complete(...), modelCalls(), dispose()}`
- Produces: `leaderEntries(entries)`, `leaderToolResults(entries) -> string[]`
- 주 실행기의 요청은 첫 시스템 메시지가 `'You are Nubi Desktop'`으로 시작한다 (`runtime/agent.mjs`의 `systemMessages`)

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-transcript.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordingProviders,leaderEntries,leaderToolResults} from '../eval/transcript.mjs';

const status=()=>({provider:'chatgpt',model:'fixture',connected:true,models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096},{id:'other',contextLength:64000}]});
const tools=[{type:'function',function:{name:'read_source'}}];

test('each call is recorded with full messages, tool names and the response',async()=>{
  const entries=[],providers=recordingProviders({status,complete:async()=>({content:'답변',calls:[{id:'c',function:{name:'read_source',arguments:'{"path":"a"}'}}],finishReason:'tool_calls',usage:{prompt_tokens:5,completion_tokens:1}})},{write:entry=>entries.push(entry)});
  const messages=[{role:'system',content:'You are Nubi Desktop.'},{role:'user',content:'질문'}];
  await providers.complete(messages,tools);messages[1].content='changed later';
  assert.equal(entries.length,1);assert.equal(entries[0].sequence,1);assert.equal(entries[0].request.messages[1].content,'질문','the record is a copy');
  assert.deepEqual(entries[0].request.toolNames,['read_source']);
  assert.deepEqual(entries[0].response,{content:'답변',calls:[{name:'read_source',arguments:'{"path":"a"}'}],finishReason:'tool_calls',usage:{prompt_tokens:5,completion_tokens:1}});
  assert.equal(providers.modelCalls(),1);
});

test('a failure is recorded with its safe code and rethrown unchanged',async()=>{
  const entries=[],failure=Object.assign(new Error('Bearer SECRET at https://internal.example'),{status:500});
  const providers=recordingProviders({status,complete:async()=>{throw failure;}},{write:entry=>entries.push(entry)});
  await assert.rejects(providers.complete([{role:'user',content:'q'}],[]),error=>error===failure);
  assert.deepEqual(entries[0].error,{code:'request_failed',status:500});
});

test('the model call budget stops the next call without reaching the model',async()=>{
  let reached=0;const providers=recordingProviders({status,complete:async()=>{reached++;return {content:''};}},{maxModelCalls:2});
  await providers.complete([],[]);await providers.complete([],[]);
  await assert.rejects(providers.complete([],[]),error=>error.message==='evaluation_model_budget'&&error.retryable===false);
  assert.equal(reached,2);
});

test('a broken recorder does not change the result',async()=>{
  const providers=recordingProviders({status,complete:async()=>({content:'ok'})},{write(){throw new Error('disk full');}});
  assert.equal((await providers.complete([],[])).content,'ok');
});

test('a case can lower the selected model context limit but never raise it',()=>{
  const lowered=recordingProviders({status,complete:async()=>({})},{modelLimits:{contextLength:32000}}).status();
  assert.equal(lowered.models[0].contextLength,32000);assert.equal(lowered.models[1].contextLength,64000,'other models are untouched');
  const raised=recordingProviders({status,complete:async()=>({})},{modelLimits:{contextLength:900000}}).status();
  assert.equal(raised.models[0].contextLength,200000);
  assert.deepEqual(recordingProviders({status,complete:async()=>({})}).status(),status());
});

test('only the main agent tool results are collected, once each',()=>{
  const tool=(id,content)=>({role:'tool',tool_call_id:id,content});
  const entries=[
    {request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'}]}},
    {request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'},tool('a','{"path":"openwiki/a.md"}')]}},
    {request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'},tool('a','{"path":"openwiki/a.md"}'),tool('b',[{type:'text',text:'{"path":"src/b.mjs"}'},{type:'image_url',image_url:{url:'data:x'}}])]}},
    {request:{messages:[{role:'system',content:'You are an isolated research analyst'},tool('c','{"path":"child/only.md"}')]}},
    {request:{messages:[{role:'system',content:'Review the task'},{role:'user',content:'{"evidence":"reviewer/only.md"}'}]}},
  ];
  assert.equal(leaderEntries(entries).length,3);
  const results=leaderToolResults(entries);
  assert.equal(results.length,2);assert.ok(results[0].includes('openwiki/a.md'));assert.ok(results[1].includes('src/b.mjs'));
  assert.ok(!results.join('\n').includes('child/only.md'));
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-transcript.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/transcript.mjs'`

- [ ] **Step 3: 구현**

`eval/transcript.mjs`

````js
// Records every model call of an evaluation run with its full messages, and
// enforces the per-case model call budget. Full text is kept because the
// corpora are public or synthetic: never point this at a company repository.
// Credentials never pass through here.
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';

export function recordingProviders(providers,{write=()=>{},maxModelCalls=Infinity,modelLimits}={}){
  let sequence=0;
  const record=entry=>{try{write(entry);}catch{/* Recording must never change the run under test. */}};
  return{
    // A case may lower the context limit to exercise compaction. It can only lower.
    status(){
      const status=providers.status();
      if(!modelLimits)return status;
      return{...status,models:(status.models||[]).map(model=>model.id!==status.model?model:{...model,
        ...(Number.isSafeInteger(modelLimits.contextLength)?{contextLength:Math.min(model.contextLength||Infinity,modelLimits.contextLength)}:{}),
        ...(Number.isSafeInteger(modelLimits.maxInputTokens)?{maxInputTokens:Math.min(model.maxInputTokens||Infinity,modelLimits.maxInputTokens)}:{})})};
    },
    modelCalls:()=>sequence,
    // The relay connection belongs to the runner and outlives one case.
    dispose(){},
    async complete(messages,tools=[],signal,onText,onPhase){
      if(sequence>=maxModelCalls)throw Object.assign(new Error('evaluation_model_budget'),{retryable:false});
      const started=Date.now(),entry={sequence:++sequence,model:providers.status().model,startedAt:new Date(started).toISOString(),elapsedMs:0,
        request:{messages:structuredClone(messages),toolNames:tools.map(tool=>tool.function.name),characters:JSON.stringify(messages).length+JSON.stringify(tools).length}};
      try{
        const result=await providers.complete(messages,tools,signal,onText,onPhase);
        entry.elapsedMs=Date.now()-started;
        entry.response={content:result.content??'',calls:(result.calls||[]).map(call=>({name:call.function?.name,arguments:call.function?.arguments})),finishReason:result.finishReason,...(result.usage?{usage:structuredClone(result.usage)}:{})};
        record(entry);return result;
      }catch(error){
        entry.elapsedMs=Date.now()-started;entry.error={code:safeError(error),...(Number.isInteger(error?.status)?{status:error.status}:{})};
        record(entry);throw error;
      }
    }};
}

const LEADER='You are Nubi Desktop';
const systemText=entry=>entry.request.messages.find(message=>message.role==='system')?.content;
// The main agent's requests only. Planner, reviewer, summarizer and child analysts use other system prompts.
export const leaderEntries=entries=>entries.filter(entry=>typeof systemText(entry)==='string'&&systemText(entry).startsWith(LEADER));
// Text of every tool result the main agent received, in order, without duplicates.
export function leaderToolResults(entries){
  const seen=new Set(),results=[];
  for(const entry of leaderEntries(entries))for(const message of entry.request.messages){
    if(message.role!=='tool')continue;
    const text=typeof message.content==='string'?message.content:JSON.stringify((message.content||[]).filter(part=>part?.type==='text'));
    const key=(message.tool_call_id||'')+'\u0000'+text;
    if(!seen.has(key)){seen.add(key);results.push(text);}
  }
  return results;
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-transcript.test.mjs`

Expected: `pass 6`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

---

### Task 5: 합성 자료 order-service

**Files:**
- Create: `eval/corpus-src/order-service/` 아래 17개 파일

**Interfaces:**
- Produces: 의존성 없는 Node 프로젝트와 한국어 Wiki 6쪽. Task 6이 이 폴더를 고정한다
- 파일 내용은 바이트 단위로 아래와 같아야 한다. 마지막 줄 끝에 줄바꿈이 하나 있다. Task 6에서 해시로 확인한다

- [ ] **Step 1: 파일 작성**

아래 17개 파일을 그대로 만든다.

`eval/corpus-src/order-service/AGENTS.md`

````markdown
# 주문 서비스 작업 규칙

- 금액은 원 단위 정수로 다룬다. 소수 금액을 저장하지 않는다.
- 할인율 표는 `src/discount.mjs`의 `RATES`에만 둔다. 할인율은 퍼센트 정수로 적는다.
- `src/legacy/` 폴더는 외부 정산 시스템과 맞춘 코드다. 수정하지 않는다.
- 정책을 바꾸면 `openwiki/`의 해당 문서도 함께 확인한다.
````

`eval/corpus-src/order-service/README.md`

````markdown
# 주문 서비스

주문 금액, 등급 할인, 배송비, 주문 상태를 계산하는 작은 서비스다. 외부 의존성이 없다.

```bash
npm test
```

정책 설명은 `openwiki/` 폴더에 있다.
````

`eval/corpus-src/order-service/openwiki/architecture/modules.md`

````markdown
---
type: architecture
title: 모듈 구성
description: 주문 서비스의 소스 파일과 각 파일의 책임.
tags: [구성, 모듈]
---

# 모듈 구성

| 파일 | 책임 |
|---|---|
| `src/order.mjs` | 주문을 만들고 소계, 할인 후 금액, 배송비, 합계를 계산 |
| `src/discount.mjs` | 등급별 할인율과 할인 후 금액 |
| `src/shipping.mjs` | 배송비 |
| `src/status.mjs` | 주문 상태 이동 |
| `src/legacy/export.mjs` | 외부 정산 시스템용 내보내기 |

`createOrder`는 소계에 할인을 먼저 적용하고, 할인 후 금액으로 배송비를 계산한다.
````

`eval/corpus-src/order-service/openwiki/concepts/discount-policy.md`

````markdown
---
type: concept
title: 할인 정책
description: 회원 등급별 할인율, 금액 내림 규칙, 새 등급을 추가할 때의 기준.
tags: [할인, 등급, 정책]
---

# 할인 정책

## 등급별 할인율

| 등급 | 코드 키 | 할인율 |
|---|---|---|
| 일반 | `normal` | 0% |
| 실버 | `silver` | 3% |
| 골드 | `gold` | 7% |
| VIP | `vip` | 12% |

할인율 표는 `src/discount.mjs`의 `RATES`에만 둔다. 값은 퍼센트 정수다.

## 금액 계산

할인 후 금액은 10원 단위로 내림한다. 예를 들어 12,345원에 실버 할인을 적용하면 11,974.65원이 아니라 11,970원이다.

## 새 등급 추가 기준

- 코드 키는 영문 소문자로 쓴다.
- 할인율은 20%를 넘을 수 없다.
- 다음에 추가할 등급은 플래티넘이다. 코드 키는 `platinum`, 할인율은 15%로 확정했다.
- 등급을 추가하면 `test/discount.test.mjs`에 해당 등급의 검사를 넣는다.
````

`eval/corpus-src/order-service/openwiki/concepts/order-status.md`

````markdown
---
type: concept
title: 주문 상태
description: 주문 상태의 종류와 바뀔 수 있는 순서, 취소할 수 있는 시점.
tags: [주문, 상태, 취소]
---

# 주문 상태

| 상태 | 코드 값 | 다음에 갈 수 있는 상태 |
|---|---|---|
| 접수 | `received` | 결제 완료, 취소 |
| 결제 완료 | `paid` | 출고, 취소 |
| 출고 | `shipped` | 배송 완료 |
| 배송 완료 | `delivered` | 없음 |
| 취소 | `cancelled` | 없음 |

취소는 출고 전까지만 할 수 있다. 출고한 주문은 취소하지 않고 반품 절차를 따른다. 반품 절차는 이 서비스의 범위가 아니다.

상태 이동은 `src/status.mjs`의 `move`가 검사한다. 허용하지 않은 이동은 `invalid_transition` 오류를 낸다.
````

`eval/corpus-src/order-service/openwiki/concepts/shipping-policy.md`

````markdown
---
type: concept
title: 배송 정책
description: 기본 배송비, 무료 배송 기준, 제주와 도서 지역 추가 요금.
tags: [배송, 배송비, 정책]
---

# 배송 정책

## 기본 규칙

| 항목 | 값 | 코드 상수 |
|---|---|---|
| 기본 배송비 | 3,000원 | `BASE_FEE` |
| 무료 배송 기준 | 할인 후 금액 50,000원 이상 | `FREE_SHIPPING_MIN` |
| 제주와 도서 지역 추가 요금 | 4,500원 | `REMOTE_EXTRA` |

계산은 `src/shipping.mjs`의 `shippingFee`가 맡는다.

## 추가 요금

제주(`jeju`)와 도서(`island`) 지역은 추가 요금을 받는다. 무료 배송 기준을 넘은 주문도 추가 요금은 낸다.

## 정산 시스템과의 관계

`src/legacy/export.mjs`는 외부 정산 시스템에 보내는 값을 만든다. 이 파일의 추가 요금 값은 정산 시스템과 맞춘 값이다. 배송 정책을 바꿀 때 이 파일은 수정하지 않는다. 정산 값 변경은 정산 담당 부서가 따로 진행한다.
````

`eval/corpus-src/order-service/openwiki/operations/release-rules.md`

````markdown
---
type: operations
title: 배포 규칙
description: 주문 서비스를 변경할 때 지켜야 하는 규칙.
tags: [규칙, 배포, 검사]
---

# 배포 규칙

- 금액은 원 단위 정수로 다룬다.
- `src/legacy/` 폴더는 수정하지 않는다.
- 정책 값을 바꾸면 같은 값을 적은 검사와 문서를 함께 고친다.
- 새 함수에는 검사를 함께 추가한다.
- 배포 전에 `npm test`가 모두 통과해야 한다.
````

`eval/corpus-src/order-service/openwiki/quickstart.md`

````markdown
---
type: orientation-guide
title: 주문 서비스 안내
description: 주문 서비스의 구성과 정책 문서로 가는 길잡이.
tags: [주문, 안내]
---

# 주문 서비스 안내

주문 서비스는 주문 금액, 등급 할인, 배송비, 주문 상태를 계산한다. 외부 의존성이 없는 Node 모듈이다.

## 문서 찾기

| 알고 싶은 것 | 문서 |
|---|---|
| 등급별 할인율과 새 등급 추가 규칙 | [할인 정책](concepts/discount-policy.md) |
| 배송비와 무료 배송 기준 | [배송 정책](concepts/shipping-policy.md) |
| 주문 상태가 바뀌는 순서 | [주문 상태](concepts/order-status.md) |
| 코드 구성 | [모듈 구성](architecture/modules.md) |
| 변경할 때 지킬 규칙 | [배포 규칙](operations/release-rules.md) |
````

`eval/corpus-src/order-service/package.json`

````json
{
  "name": "order-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
````

`eval/corpus-src/order-service/src/discount.mjs`

````js
// 등급별 할인율(퍼센트 정수). 새 등급은 이 표에만 추가한다.
export const RATES = Object.freeze({normal: 0, silver: 3, gold: 7, vip: 12});

export function discountRate(grade) {
  if (!Object.hasOwn(RATES, grade)) throw new Error('unknown_grade');
  return RATES[grade];
}

// 할인 후 금액은 10원 단위로 내림한다.
export function applyDiscount(amount, grade) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('invalid_amount');
  return Math.floor(amount * (100 - discountRate(grade)) / 1000) * 10;
}
````

`eval/corpus-src/order-service/src/legacy/export.mjs`

````js
// 외부 정산 시스템용 내보내기. 정산 시스템과 맞춘 값이므로 수정하지 않는다.
const LEGACY_REMOTE_EXTRA = 4500;

export function exportRow(order, region) {
  const extra = ['jeju', 'island'].includes(region) ? LEGACY_REMOTE_EXTRA : 0;
  return [order.total, order.shipping, extra, order.status].join(',');
}
````

`eval/corpus-src/order-service/src/order.mjs`

````js
import {applyDiscount} from './discount.mjs';
import {shippingFee} from './shipping.mjs';

export function createOrder({items, grade = 'normal', region = 'seoul'}) {
  if (!Array.isArray(items) || !items.length) throw new Error('empty_order');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discounted = applyDiscount(subtotal, grade);
  const shipping = shippingFee(discounted, region);
  return {subtotal, discounted, shipping, total: discounted + shipping, status: 'received'};
}
````

`eval/corpus-src/order-service/src/shipping.mjs`

````js
export const FREE_SHIPPING_MIN = 50000;
export const BASE_FEE = 3000;
export const REMOTE_EXTRA = 4500;
const REMOTE_REGIONS = new Set(['jeju', 'island']);

// 주문 금액과 지역으로 배송비를 계산한다. 무료 배송이어도 제주와 도서 지역 추가 요금은 받는다.
export function shippingFee(total, region) {
  if (!Number.isInteger(total) || total < 0) throw new Error('invalid_amount');
  const base = total >= FREE_SHIPPING_MIN ? 0 : BASE_FEE;
  return base + (REMOTE_REGIONS.has(region) ? REMOTE_EXTRA : 0);
}
````

`eval/corpus-src/order-service/src/status.mjs`

````js
const NEXT = Object.freeze({
  received: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
});

export function canMove(from, to) {
  return (NEXT[from] || []).includes(to);
}

export function move(order, to) {
  if (!canMove(order.status, to)) throw new Error('invalid_transition');
  return {...order, status: to};
}
````

`eval/corpus-src/order-service/test/discount.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discountRate, applyDiscount} from '../src/discount.mjs';

test('등급별 할인율', () => {
  assert.equal(discountRate('normal'), 0);
  assert.equal(discountRate('silver'), 3);
  assert.equal(discountRate('gold'), 7);
  assert.equal(discountRate('vip'), 12);
  assert.throws(() => discountRate('unknown'), /unknown_grade/);
});

test('할인 후 금액은 10원 단위로 내림한다', () => {
  assert.equal(applyDiscount(10000, 'gold'), 9300);
  assert.equal(applyDiscount(12345, 'silver'), 11970);
  assert.equal(applyDiscount(0, 'vip'), 0);
  assert.throws(() => applyDiscount(10.5, 'gold'), /invalid_amount/);
});
````

`eval/corpus-src/order-service/test/order.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOrder} from '../src/order.mjs';
import {move} from '../src/status.mjs';
import {exportRow} from '../src/legacy/export.mjs';

test('주문 합계는 할인과 배송비를 반영한다', () => {
  const order = createOrder({items: [{price: 20000, quantity: 2}], grade: 'gold', region: 'jeju'});
  assert.deepEqual(order, {subtotal: 40000, discounted: 37200, shipping: 7500, total: 44700, status: 'received'});
});

test('주문 상태는 정해진 순서로만 바뀐다', () => {
  const order = createOrder({items: [{price: 1000, quantity: 1}]});
  assert.equal(move(order, 'paid').status, 'paid');
  assert.throws(() => move(order, 'delivered'), /invalid_transition/);
  assert.throws(() => move({...order, status: 'shipped'}, 'cancelled'), /invalid_transition/);
});

test('정산 내보내기 형식', () => {
  const order = createOrder({items: [{price: 60000, quantity: 1}], region: 'jeju'});
  assert.equal(exportRow(order, 'jeju'), '64500,4500,4500,received');
});
````

`eval/corpus-src/order-service/test/shipping.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shippingFee} from '../src/shipping.mjs';

test('무료 배송 기준과 기본 배송비', () => {
  assert.equal(shippingFee(49999, 'seoul'), 3000);
  assert.equal(shippingFee(50000, 'seoul'), 0);
});

test('제주와 도서 지역 추가 요금', () => {
  assert.equal(shippingFee(10000, 'jeju'), 7500);
  assert.equal(shippingFee(60000, 'island'), 4500);
});
````

- [ ] **Step 2: 자료의 검사 실행**

Run: `cd eval/corpus-src/order-service && node --test && cd ../../..`

Expected: `pass 7`, `fail 0`

- [ ] **Step 3: 변경 파일 확인**

Run: `git status --short -- eval/corpus-src`

Expected: 17개 파일.

---

### Task 6: 자료 고정과 작업 공간

**Files:**
- Create: `eval/corpus.mjs`
- Create: `eval/pin-corpus.mjs`
- Create: `eval/corpus/*.tar.gz`, `eval/corpus/*.manifest.json` (생성물)
- Test: `tests/eval-corpus.test.mjs`

**Interfaces:**
- Consumes: 시스템의 `tar`와 `git` 명령
- Produces: `CORPORA` (`'openwiki-sds'`, `'order-service'`), `CORPUS_DIRECTORY`
- Produces: `createWorkspace({corpus, parent?, directory?}) -> {corpus, corpusHash, directory, root, stateRoot, dispose()}`
- Produces: `corpusManifest(name, directory?) -> {name, files, hash}`, `changedPaths(root) -> string[]`, `listFiles(root)`, `fileRecords(root)`, `corpusHash(files)`
- Produces: `pinCorpus(name, {directory?, corpora?}) -> {name, files, bytes, hash}`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-corpus.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspace,corpusManifest,changedPaths,listFiles,CORPORA} from '../eval/corpus.mjs';
import {pinCorpus} from '../eval/pin-corpus.mjs';

async function pinned(t,files={'src/a.mjs':'export const a=1;\n','openwiki/home.md':'# 집\n','openwiki/.claims/home.json':'{}\n'}){
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-corpus-test-')),source=path.join(base,'source'),directory=path.join(base,'pinned');
  t.after(()=>rm(base,{recursive:true,force:true}));
  for(const [file,content] of Object.entries(files)){await mkdir(path.dirname(path.join(source,file)),{recursive:true});await writeFile(path.join(source,file),content);}
  await mkdir(path.join(source,'node_modules','x'),{recursive:true});await writeFile(path.join(source,'node_modules','x','index.js'),'ignored');
  const corpora={'order-service':{source,include:['.']}};
  const result=await pinCorpus('order-service',{directory,corpora});
  return {base,source,directory,result};
}

test('a pinned corpus unpacks into a committed Git workspace with hidden files and no ignored folders',async t=>{
  const {directory,result}=await pinned(t);
  assert.equal(result.files,3);
  const workspace=await createWorkspace({corpus:'order-service',directory});t.after(workspace.dispose);
  assert.deepEqual(await listFiles(workspace.root),['openwiki/.claims/home.json','openwiki/home.md','src/a.mjs']);
  assert.equal(workspace.corpusHash,result.hash);
  assert.deepEqual(await changedPaths(workspace.root),[],'the snapshot is fully committed');
  await access(workspace.stateRoot);
  assert.ok(!workspace.root.startsWith(directory));
});

test('changes after the snapshot are listed, including new and deleted files',async t=>{
  const {directory}=await pinned(t),workspace=await createWorkspace({corpus:'order-service',directory});t.after(workspace.dispose);
  await writeFile(path.join(workspace.root,'src','a.mjs'),'export const a=2;\n');
  await writeFile(path.join(workspace.root,'src','새 파일.mjs'),'export const b=1;\n');
  await rm(path.join(workspace.root,'openwiki','home.md'));
  assert.deepEqual(await changedPaths(workspace.root),['openwiki/home.md','src/a.mjs','src/새 파일.mjs']);
});

test('a snapshot that differs from its manifest is refused and leaves nothing behind',async t=>{
  const {directory}=await pinned(t),file=path.join(directory,'order-service.manifest.json');
  const manifest=JSON.parse(await readFile(file,'utf8'));manifest.files[0].sha256='0'.repeat(64);await writeFile(file,JSON.stringify(manifest));
  const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-corpus-parent-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  await assert.rejects(createWorkspace({corpus:'order-service',directory,parent}),/corpus_changed/);
  assert.deepEqual(await listFiles(parent),[]);
});

test('unknown corpora, missing snapshots and unsafe manifest paths are refused',async t=>{
  const {directory}=await pinned(t);
  await assert.rejects(createWorkspace({corpus:'/etc',directory}),/corpus_unknown/);
  await assert.rejects(createWorkspace({corpus:'openwiki-sds',directory}),/corpus_missing/);
  const file=path.join(directory,'order-service.manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
  manifest.files[0].path='../outside.txt';await writeFile(file,JSON.stringify(manifest));
  await assert.rejects(corpusManifest('order-service',directory),/corpus_manifest_invalid/);
});

test('a link inside a corpus source is refused',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-corpus-link-'));t.after(()=>rm(base,{recursive:true,force:true}));
  await writeFile(path.join(base,'real.txt'),'x');await symlink(path.join(base,'real.txt'),path.join(base,'link.txt'));
  await assert.rejects(listFiles(base),/corpus_link/);
});

test('registered corpora are the only names',()=>{
  assert.deepEqual(Object.keys(CORPORA).sort(),['openwiki-sds','order-service']);
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-corpus.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/corpus.mjs'`

- [ ] **Step 3: 구현**

`eval/corpus.mjs`

````js
// Pinned evaluation corpora. A corpus is a tar.gz snapshot plus a per-file
// SHA-256 manifest, so cases and their answer keys stay valid when the source
// folder changes. A workspace is always built from a registered corpus: the
// runner records full conversations, so it must never accept an arbitrary path.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIRECTORY=path.join(here,'corpus');
const packages=path.resolve(here,'..','..');
// `source` and `include` are used only by pin-corpus.mjs.
export const CORPORA=Object.freeze({
  'openwiki-sds':{source:path.join(packages,'openwiki'),include:['src','openwiki','README.md','AGENTS.md','CONTRIBUTING.md','DEVELOPMENT.md','ENTERPRISE.md','CHANGELOG.md','package.json','tsconfig.json','evals/ledger/README.md','evals/deepswe/README.md']},
  'order-service':{source:path.join(here,'corpus-src','order-service'),include:['.']},
});
const IGNORED=new Set(['node_modules','dist','.git','.DS_Store']);
const fail=code=>{throw new Error(code);};
const sha256=value=>createHash('sha256').update(value).digest('hex');

// Lists regular files under a directory as sorted POSIX relative paths. Links are refused.
export async function listFiles(root,relative=''){
  const entries=await readdir(path.join(root,relative),{withFileTypes:true}),files=[];
  for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(IGNORED.has(entry.name))continue;
    const next=relative?relative+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())fail('corpus_link');
    if(entry.isDirectory())files.push(...await listFiles(root,next));
    else if(entry.isFile())files.push(next);
    else fail('corpus_file_type');
  }
  return files;
}
export async function fileRecords(root){
  const records=[];
  for(const file of await listFiles(root)){const content=await readFile(path.join(root,file));records.push({path:file,sha256:sha256(content),bytes:content.length});}
  return records;
}
export const corpusHash=files=>sha256(JSON.stringify(files.map(file=>[file.path,file.sha256,file.bytes])));

export async function corpusManifest(name,directory=CORPUS_DIRECTORY){
  if(!Object.hasOwn(CORPORA,name))fail('corpus_unknown');
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(directory,name+'.manifest.json'),'utf8'));}catch{fail('corpus_missing');}
  if(manifest.name!==name||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.some(file=>typeof file.path!=='string'||!/^[0-9a-f]{64}$/.test(file.sha256)||path.isAbsolute(file.path)||file.path.split('/').includes('..')))fail('corpus_manifest_invalid');
  return {...manifest,hash:corpusHash(manifest.files)};
}

const git=(root,args)=>exec('git',args,{cwd:root,maxBuffer:4e6});

// Unpacks a pinned corpus into a fresh Git repository with its own state folder.
export async function createWorkspace({corpus,parent=os.tmpdir(),directory=CORPUS_DIRECTORY}){
  const manifest=await corpusManifest(corpus,directory);
  const base=await realpath(await mkdtemp(path.join(parent,'nubi-eval-'))),root=path.join(base,'repo'),stateRoot=path.join(base,'state');
  const dispose=()=>rm(base,{recursive:true,force:true});
  try{
    await mkdir(root);await mkdir(stateRoot,{mode:0o700});
    await exec('tar',['-xzf',path.join(directory,corpus+'.tar.gz'),'-C',root]);
    const actual=await fileRecords(root);
    if(corpusHash(actual)!==manifest.hash)fail('corpus_changed');
    await git(root,['init','-q']);await git(root,['config','user.email','evaluation@example.invalid']);await git(root,['config','user.name','Evaluation']);await git(root,['config','commit.gpgsign','false']);
    await git(root,['add','-A','-f','.']);await git(root,['commit','-qm','Corpus snapshot '+corpus]);
    if((await lstat(path.join(root,'.git'))).isDirectory()!==true)fail('workspace_invalid');
    return {corpus,corpusHash:manifest.hash,directory:base,root,stateRoot,dispose};
  }catch(error){await dispose();throw error;}
}

// Paths changed since the corpus snapshot, including new and deleted files.
export async function changedPaths(root){
  const {stdout}=await git(root,['status','--porcelain=v1','-z','--untracked-files=all']);
  return stdout.split('\0').filter(Boolean).map(entry=>entry.slice(3)).sort();
}
````

`eval/pin-corpus.mjs`

````js
// Creates the pinned snapshot and manifest of one corpus:
//   node eval/pin-corpus.mjs order-service
// Re-pinning changes the corpus hash. Review every answer key that uses the
// corpus afterwards: a changed source can silently invalidate it.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,mkdtemp,mkdir,rm,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CORPORA,CORPUS_DIRECTORY,fileRecords,corpusHash} from './corpus.mjs';

const exec=promisify(execFile);
const IGNORED=new Set(['node_modules','dist','.git','.DS_Store']);

export async function pinCorpus(name,{directory=CORPUS_DIRECTORY,corpora=CORPORA}={}){
  const corpus=corpora[name];if(!corpus)throw new Error('corpus_unknown');
  const stage=await mkdtemp(path.join(os.tmpdir(),'nubi-pin-'));
  try{
    for(const item of corpus.include){
      const from=path.join(corpus.source,item),to=path.join(stage,item);
      await mkdir(path.dirname(to),{recursive:true});
      await cp(from,to,{recursive:(await stat(from)).isDirectory(),filter:source=>!IGNORED.has(path.basename(source))});
    }
    const files=await fileRecords(stage);if(!files.length)throw new Error('corpus_empty');
    await mkdir(directory,{recursive:true});
    // COPYFILE_DISABLE keeps macOS from adding AppleDouble files to the archive.
    await exec('tar',['-czf',path.join(directory,name+'.tar.gz'),'-C',stage,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
    const manifest={name,schema:1,createdAt:new Date().toISOString(),files};
    await writeFile(path.join(directory,name+'.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return {name,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),hash:corpusHash(files)};
  }finally{await rm(stage,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const names=process.argv.slice(2);
  if(!names.length||names.some(name=>!Object.hasOwn(CORPORA,name))){console.error('사용법: node eval/pin-corpus.mjs <'+Object.keys(CORPORA).join('|')+'> ...');process.exit(2);}
  for(const name of names)console.log(JSON.stringify(await pinCorpus(name)));
  console.log('자료를 다시 고정했습니다. 이 자료를 쓰는 과제의 정답을 다시 검토해 주세요.');
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-corpus.test.mjs`

Expected: `pass 6`, `fail 0`

- [ ] **Step 5: 두 자료 고정**

Run: `node eval/pin-corpus.mjs openwiki-sds order-service`

Expected: 두 줄의 JSON과 안내 문구. `order-service`는 아래 값과 같아야 한다.

```json
{"name":"order-service","files":17,"bytes":9867,"hash":"6210328b4856d4bcb5dbd2f42f2f7da796a9317b16ceca7215084f1cc255e93d"}
```

`order-service`의 해시가 다르면 Task 5의 파일이 계획과 다르다. `eval/corpus/order-service.manifest.json`의 파일별 값을 아래 표와 비교해 다른 파일을 고친 뒤 다시 고정한다.

| 파일 | 바이트 | SHA-256 |
|---|---:|---|
| `AGENTS.md` | 396 | `6d8c958eb2b637053cd65250753772cbf044c54664b35e0180cfc4db63c6cbd8` |
| `README.md` | 210 | `5c3605c6b213bfb45cf05a372d12469e584b8b88d48e462938c1c1558eeceb71` |
| `openwiki/architecture/modules.md` | 613 | `048adc64eca561ed1c1bea26fb62c579b05ee4e30a1df03b70f28ae4c1fa804d` |
| `openwiki/concepts/discount-policy.md` | 947 | `d8ddcbaecf37034cd082aa6965986121ca9dc4522a3ebc5d8a565f50222633c3` |
| `openwiki/concepts/order-status.md` | 766 | `4ff1bc74b87436c5061906a6b0b8c8588a22f47d3ec0bfd742d9b331c63b2d55` |
| `openwiki/concepts/shipping-policy.md` | 992 | `163e86607003e9f690d7c6be4a332cb25f57ed9519a5d00fb14a64d26af1804d` |
| `openwiki/operations/release-rules.md` | 454 | `69d3e7ae4fa903a159fb9978d9dcf1d8b0f561ad0d9638f1179aef84a6ba8e8a` |
| `openwiki/quickstart.md` | 796 | `7323b02e3fb5089cbf1f6b88d028c40ee1b693d76010b53c5018e6365701f6a6` |
| `package.json` | 137 | `8094b3912447040221543c5124c0f73e4260754080fbb750fe75df5f3b3d0165` |
| `src/discount.mjs` | 553 | `e965fd4603a4780ea8bb9b23c6235b9a71c58a71d70aaaa38c0018938187a3c1` |
| `src/legacy/export.mjs` | 338 | `eedda5d2463ccb066fbef9a517d143df3e309ff655660b1f488361b7a0ae9106` |
| `src/order.mjs` | 529 | `389bea371dcd7598e71194e8b206177efa3da120681137ba1ed1742ff51bf6ec` |
| `src/shipping.mjs` | 542 | `ff4aca93023cd888dbf9bdc8a9b4ab063db2141e4c02d71a1cd3e5a3a403de56` |
| `src/status.mjs` | 386 | `f7212f62f6614dc894abed37e8890b0a591c8df65ebc7de238848d5752a3ce2b` |
| `test/discount.test.mjs` | 704 | `30212484346f14fff5e95441984bba05300a4c1689cbd9901acba37cffa6a54f` |
| `test/order.test.mjs` | 1060 | `def2b3b9956d0b4eeeb52c4727f9c71c5c413e64cbc60f0b2b5c74285212de99` |
| `test/shipping.test.mjs` | 444 | `3de489763bce7e12adeb00a48e4ec54bb29ab675786afd717063e65f2e81946f` |

`openwiki-sds`는 계획 작성 시점에 파일 242개, 해시 `4661dfa154bd3a09170122473855e200cab445235793843477d4f52ca02d71b4`였다. `packages/openwiki`가 그 뒤 바뀌었으면 값이 다르다. 다르면 멈추지 말고 Task 10의 검사 결과로 판단한다. 그 검사가 정답 경로와 정답 문장이 자료에 있는지 확인한다.

- [ ] **Step 6: 변경 파일 확인**

Run: `git status --short -- eval tests`

Expected: `eval/corpus.mjs`, `eval/pin-corpus.mjs`, `eval/corpus/` 아래 4개 파일, `tests/eval-corpus.test.mjs`.

---

### Task 7: 모의 사용자

**Files:**
- Create: `eval/user.mjs`
- Test: `tests/eval-user.test.mjs`

**Interfaces:**
- Consumes: `service.state().proposals`, `service.prepareProposal({proposalId})`, `service.confirmProposal({proposalId})`, `service.applyNewFile({proposalId})`
- Produces: `createUser(testCase) -> {log, answer(question), allows(kind)}`. `answer`는 `answerAgent`에 넘길 인자 또는 `null`
- Produces: `applyProposals({service, taskId, user, root}) -> log`
- 질문 객체: `{id, text, kind, options: [{id, label}]}` (`extensions/aipro-chat/user-question.js`의 `makeQuestion`)

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-user.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUser,applyProposals} from '../eval/user.mjs';

const question={id:'q1',text:'어느 등급의 할인율을 바꿀까요?',kind:'choice',options:[{id:'option-1',label:'골드'},{id:'option-2',label:'VIP'}]};

test('a defined answer is given once, as an option when the label matches',()=>{
  const user=createUser({dialogue:[{match:'등급',answer:'골드'}]});
  assert.deepEqual(user.answer(question),{choice:{questionId:'q1',optionId:'option-1'}});
  assert.equal(user.answer(question),null,'the same defined answer is not reused');
  assert.deepEqual(user.log.questions,[question.text,question.text]);assert.deepEqual(user.log.answers,['골드']);
});

test('free text is used when no option matches, and for plain text questions',()=>{
  assert.deepEqual(createUser({dialogue:[{match:'등급',answer:'실버 등급을 5퍼센트로'}]}).answer(question),{choice:{questionId:'q1',text:'실버 등급을 5퍼센트로'}});
  assert.deepEqual(createUser({dialogue:[{match:'범위',answer:'현재 화면'}]}).answer('범위는 어디까지인가요?'),{answer:'현재 화면'});
});

test('no match or more than one match needs a person',()=>{
  assert.equal(createUser({}).answer(question),null);
  assert.equal(createUser({dialogue:[{match:'배송',answer:'제주'}]}).answer(question),null);
  assert.equal(createUser({dialogue:[{match:'등급',answer:'골드'},{match:'할인율',answer:'VIP'}]}).answer(question),null);
});

test('only the approval kinds of the case are allowed',()=>{
  const user=createUser({approvals:['patch']});
  assert.equal(user.allows('patch'),true);assert.equal(user.allows('new_file'),false);
  for(const kind of ['command','setup','elevation','computer','repair'])assert.equal(user.allows(kind),false);
  assert.equal(createUser({}).allows('patch'),false);
});

test('only the newest open proposal of this task is applied per path',async()=>{
  const calls=[],proposals=[
    {id:'old',taskId:'t',path:'src/a.mjs',state:'proposed',createdAt:'2026-01-01T00:00:00.000Z'},
    {id:'new',taskId:'t',path:'src/a.mjs',state:'proposed',createdAt:'2026-01-01T00:00:05.000Z'},
    {id:'file',taskId:'t',path:'src/b.mjs',kind:'create',state:'proposed',createdAt:'2026-01-01T00:00:02.000Z'},
    {id:'done',taskId:'t',path:'src/c.mjs',state:'applied',createdAt:'2026-01-01T00:00:03.000Z'},
    {id:'other',taskId:'other-task',path:'src/d.mjs',state:'proposed',createdAt:'2026-01-01T00:00:04.000Z'},
  ];
  const service={state:()=>({proposals}),
    prepareProposal:async({proposalId})=>{calls.push('prepare:'+proposalId);return {alreadyApplied:true};},
    confirmProposal:async({proposalId})=>{calls.push('confirm:'+proposalId);},
    applyNewFile:async({proposalId})=>{calls.push('create:'+proposalId);}};
  const user=createUser({approvals:['patch','new_file']});
  await applyProposals({service,taskId:'t',user,root:'/unused'});
  assert.deepEqual(calls,['prepare:new','create:file']);
  assert.deepEqual(user.log.applied,[{path:'src/a.mjs',kind:'patch'},{path:'src/b.mjs',kind:'new_file'}]);
});

test('a refused or failed apply is recorded and does not stop the others',async()=>{
  const proposals=[{id:'a',taskId:'t',path:'src/a.mjs',state:'proposed',createdAt:'2'},{id:'b',taskId:'t',path:'src/b.mjs',kind:'create',state:'proposed',createdAt:'1'}];
  const service={state:()=>({proposals}),prepareProposal:async()=>{throw new Error('source_stale');},confirmProposal:async()=>{},applyNewFile:async()=>{throw new Error('Raw failure at /Users/someone/secret');}};
  const patchOnly=createUser({approvals:['patch']});await applyProposals({service,taskId:'t',user:patchOnly,root:'/unused'});
  assert.deepEqual(patchOnly.log.refused,[{path:'src/a.mjs',kind:'patch',reason:'source_stale'},{path:'src/b.mjs',kind:'new_file',reason:'not_allowed'}]);
  const both=createUser({approvals:['patch','new_file']});await applyProposals({service,taskId:'t',user:both,root:'/unused'});
  assert.deepEqual(both.log.refused.map(item=>item.reason),['source_stale','apply_failed']);assert.deepEqual(both.log.applied,[]);
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-user.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/user.mjs'`

- [ ] **Step 3: 구현**

`eval/user.mjs`

````js
// The simulated user of an evaluation case. It answers only what the case
// defines and approves only what the case allows. Anything else needs a
// person: the case then ends as needs_human instead of guessing.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const questionText=question=>typeof question==='string'?question:String(question?.text||'');

export function createUser(testCase){
  const used=new Set(),log={questions:[],answers:[],applied:[],refused:[]};
  return{
    log,
    // Returns answerAgent arguments, or null when no single defined answer fits.
    answer(question){
      const asked=questionText(question);log.questions.push(asked);
      const matches=(testCase.dialogue||[]).map((item,index)=>({...item,index})).filter(item=>!used.has(item.index)&&new RegExp(item.match,'iu').test(asked));
      if(matches.length!==1)return null;
      used.add(matches[0].index);log.answers.push(matches[0].answer);
      if(typeof question==='string')return {answer:matches[0].answer};
      const option=(question.options||[]).find(item=>item.label===matches[0].answer);
      return {choice:option?{questionId:question.id,optionId:option.id}:{questionId:question.id,text:matches[0].answer}};
    },
    allows:kind=>(testCase.approvals||[]).includes(kind),
  };
}

// Applies this task's open proposals the way the editor does: the newest
// proposal per path, write, then let the host confirm the saved hash.
// Commands, setup, elevation and computer actions are never approved here.
export async function applyProposals({service,taskId,user,root}){
  const open=service.state().proposals.filter(proposal=>proposal.taskId===taskId&&proposal.state==='proposed')
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),seen=new Set();
  for(const proposal of open){
    if(seen.has(proposal.path))continue;seen.add(proposal.path);
    const kind=proposal.kind==='create'?'new_file':'patch';
    if(!user.allows(kind)){user.log.refused.push({path:proposal.path,kind,reason:'not_allowed'});continue;}
    try{
      if(kind==='new_file')await service.applyNewFile({proposalId:proposal.id});
      else{
        const prepared=await service.prepareProposal({proposalId:proposal.id});
        if(!prepared.alreadyApplied){await writeFile(path.join(root,proposal.path),prepared.content);await service.confirmProposal({proposalId:proposal.id});}
      }
      user.log.applied.push({path:proposal.path,kind});
    }catch(error){user.log.refused.push({path:proposal.path,kind,reason:/^[a-z_]{1,64}$/.test(error.message)?error.message:'apply_failed'});}
  }
  return user.log;
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-user.test.mjs`

Expected: `pass 6`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

---

### Task 8: 채점

**Files:**
- Create: `eval/grade.mjs`
- Test: `tests/eval-grade.test.mjs`

**Interfaces:**
- Consumes: Task 6의 `changedPaths`, Task 4의 `leaderToolResults`
- Produces: `gradeCase(testCase, result) -> {outcome, passed, checks, falseCompletion, flagged?, error?}`
- Produces: `mentions(text, alternative) -> boolean`
- `result`의 필드: `state, answer, asked, compactions, transcript, root, reviewStatus, needsHuman, error`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-grade.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gradeCase,mentions} from '../eval/grade.mjs';

const exec=promisify(execFile);
async function workspace(t,files={'src/a.mjs':'export const value = 1;\n','src/legacy/keep.mjs':'export const legacy = 4500;\n'}){
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-grade-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [file,content] of Object.entries(files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
  const git=args=>exec('git',args,{cwd:root});
  await git(['init','-q']);await git(['config','user.email','grade@example.invalid']);await git(['config','user.name','Grade']);await git(['config','commit.gpgsign','false']);await git(['add','-A']);await git(['commit','-qm','snapshot']);
  return root;
}
const leader=content=>({request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'},{role:'tool',tool_call_id:'c1',content}]}});
const testCase=expect=>({id:'T1-grade-case',expect:{state:'review',...expect}});
const finished=(root,extra={})=>({state:'review',answer:'',asked:false,compactions:0,transcript:[],root,reviewStatus:'ready',needsHuman:false,error:null,...extra});

test('text matching ignores case, spacing and Unicode form; regular expressions are opt-in',()=>{
  assert.ok(mentions('기본 포트는  53682 입니다','53682'));
  assert.ok(mentions('FabriX 제공자','fabrix'));
  assert.ok(mentions('npm   install -g\nopenwiki','npm install -g openwiki'));
  assert.ok(mentions('한글','한글'),'decomposed Hangul matches composed');
  assert.ok(mentions('제공자는 모두 17개입니다','re:(?<![\\d.\\-])17(?![\\d.\\-])'));
  assert.ok(!mentions('2026-09-17에 생성','re:(?<![\\d.\\-])17(?![\\d.\\-])'));
  assert.ok(!mentions('a.b','a+b'),'a literal is never treated as a pattern');
});

test('answer checks need one alternative per group and no forbidden text',async t=>{
  const root=await workspace(t),expect={answer_includes:[['4,500','4500'],['제주']],answer_excludes:['6,000']};
  assert.equal((await gradeCase(testCase(expect),finished(root,{answer:'제주 추가 요금은 4500원입니다.'}))).outcome,'passed');
  const missing=await gradeCase(testCase(expect),finished(root,{answer:'추가 요금은 4,500원입니다.'}));
  assert.equal(missing.outcome,'failed');assert.deepEqual(missing.checks.filter(item=>!item.passed).map(item=>[item.name,item.group]),[['answer_includes',2]]);
  assert.equal((await gradeCase(testCase(expect),finished(root,{answer:'제주 추가 요금은 4,500원 또는 6,000원입니다.'}))).outcome,'failed');
});

test('retrieval counts what the main agent read; citation accepts a file name',async t=>{
  const root=await workspace(t),expect={retrieved:{paths:['openwiki/a.md','src/b.mjs'],min:2},cited:{paths:['openwiki/concepts/shipping-policy.md']}};
  const transcript=[leader('{"provenance":{"path":"openwiki/a.md"}}'),{request:{messages:[{role:'system',content:'You are an isolated research analyst'},{role:'tool',tool_call_id:'c2',content:'{"path":"src/b.mjs"}'}]}}];
  const partial=await gradeCase(testCase(expect),finished(root,{transcript,answer:'근거: shipping-policy.md'}));
  assert.deepEqual(partial.checks.map(item=>[item.name,item.passed]),[['state',true],['retrieved',false],['cited',true]]);
  assert.deepEqual(partial.checks[1].found,['openwiki/a.md'],'a child analyst read does not count');
  const full=await gradeCase(testCase(expect),finished(root,{transcript:[...transcript,leader('{"path":"src/b.mjs"}')],answer:'근거 없음'}));
  assert.deepEqual(full.checks.map(item=>item.passed),[true,true,false]);
});

test('file, change scope and hidden test checks read the saved workspace',async t=>{
  const root=await workspace(t);
  await writeFile(path.join(root,'src','a.mjs'),'export const value = 2;\n');
  const expect={files:[{path:'src/a.mjs',includes:['value = 2'],excludes:['value = 1']},{path:'src/legacy/keep.mjs',includes:['4500']},{path:'src/removed.mjs',absent:true}],unchanged_except:['src/a.mjs'],
    test:{files:{'test/hidden.test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/a.mjs';test('hidden',()=>assert.equal(value,2));\n"},command:['node','--test','test/hidden.test.mjs']}};
  const passed=await gradeCase(testCase(expect),finished(root));
  assert.equal(passed.outcome,'passed',JSON.stringify(passed.checks));
  assert.deepEqual(passed.checks.find(item=>item.name==='unchanged_except').changed,['src/a.mjs'],'the hidden test file is not counted as a change');
  await writeFile(path.join(root,'src','legacy','keep.mjs'),'export const legacy = 5000;\n');
  const failed=await gradeCase(testCase(expect),finished(root));
  assert.equal(failed.outcome,'failed');
  assert.deepEqual(failed.checks.filter(item=>!item.passed).map(item=>item.name),['files','unchanged_except']);
  assert.deepEqual(failed.checks.find(item=>item.name==='unchanged_except').outside,['src/legacy/keep.mjs']);
});

test('a failing hidden test fails the case',async t=>{
  const root=await workspace(t);
  const expect={test:{files:{'test/hidden.test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/a.mjs';test('hidden',()=>assert.equal(value,2));\n"},command:['node','--test','test/hidden.test.mjs']}};
  const graded=await gradeCase(testCase(expect),finished(root));
  assert.equal(graded.outcome,'failed');assert.equal(graded.falseCompletion,true);
  assert.ok((await readdir(path.join(root,'test'))).includes('hidden.test.mjs'));
});

test('completion claims never pass a case and a failed completed task is a false completion',async t=>{
  const root=await workspace(t),expect={answer_includes:[['4,500']]};
  const claimed=await gradeCase(testCase(expect),finished(root,{answer:'모든 요구사항을 완료했고 검증도 통과했습니다.',reviewStatus:'ready'}));
  assert.equal(claimed.outcome,'failed');assert.equal(claimed.falseCompletion,true);
  const honest=await gradeCase(testCase(expect),finished(root,{answer:'확인하지 못했습니다.',reviewStatus:'revise'}));
  assert.equal(honest.falseCompletion,false);
});

test('question expectations, run errors, human needs and missing compaction have their own outcomes',async t=>{
  const root=await workspace(t);
  assert.equal((await gradeCase({id:'T1-grade-case',expect:{state:'waiting_input',asked:true}},finished(root,{state:'waiting_input',asked:true}))).outcome,'passed');
  assert.equal((await gradeCase(testCase({asked:false}),finished(root,{asked:true}))).outcome,'failed');
  assert.deepEqual(await gradeCase(testCase({}),finished(root,{error:'evaluation_case_timeout'})),{outcome:'error',passed:false,checks:[],error:'evaluation_case_timeout',falseCompletion:false});
  assert.equal((await gradeCase(testCase({}),finished(root,{needsHuman:true,state:'waiting_input'}))).outcome,'needs_human');
  assert.equal((await gradeCase(testCase({compacted:true}),finished(root,{compactions:0}))).outcome,'invalid');
  assert.equal((await gradeCase(testCase({compacted:true}),finished(root,{compactions:2}))).outcome,'passed');
});

test('manual cases and flagged answers wait for a reviewer instead of passing',async t=>{
  const root=await workspace(t);
  const manual=await gradeCase({...testCase({answer_includes:[['없습니다']]}),manual:true},finished(root,{answer:'문서에 없습니다.'}));
  assert.equal(manual.outcome,'needs_review');assert.equal(manual.passed,false);
  const flagged=await gradeCase(testCase({answer_includes:[['없습니다']],answer_flags:['HTTPS_PROXY']}),finished(root,{answer:'문서에 없습니다. HTTPS_PROXY 같은 변수도 안내하지 않습니다.'}));
  assert.equal(flagged.outcome,'needs_review');assert.deepEqual(flagged.flagged,['HTTPS_PROXY']);
  const failedFirst=await gradeCase({...testCase({answer_includes:[['없습니다']]}),manual:true},finished(root,{answer:'HTTPS_PROXY를 설정하세요.'}));
  assert.equal(failedFirst.outcome,'failed','a failed check is not hidden behind review');
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-grade.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/grade.mjs'`

- [ ] **Step 3: 구현**

`eval/grade.mjs`

````js
// Grades one finished case from observable results only. The model's own
// completion claim and the reviewer's "ready" never count toward a pass.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {changedPaths} from './corpus.mjs';
import {leaderToolResults} from './transcript.mjs';

const exec=promisify(execFile);
const normalize=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
// An alternative is a literal, or a regular expression when it starts with "re:".
export function mentions(text,alternative){
  if(alternative.startsWith('re:'))return new RegExp(alternative.slice(3),'iu').test(String(text||'').normalize('NFC'));
  return normalize(text).includes(normalize(alternative));
}
const check=(name,passed,detail={})=>({name,passed:passed===true,...detail});

async function runTest(root,test){
  for(const [file,content] of Object.entries(test.files||{})){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
  try{await exec(process.execPath,test.command.slice(1),{cwd:root,timeout:60000,maxBuffer:4e6,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test'}});return {exitCode:0};}
  catch(error){return {exitCode:typeof error.code==='number'?error.code:1,timedOut:error.killed===true};}
}

// result: {state, answer, asked, compactions, transcript, root, reviewStatus, needsHuman, error}
export async function gradeCase(testCase,result){
  const expect=testCase.expect,checks=[],answer=result.answer||'';
  if(result.error)return {outcome:'error',passed:false,checks,error:result.error,falseCompletion:false};
  if(result.needsHuman)return {outcome:'needs_human',passed:false,checks,falseCompletion:false};
  // A case that needs compaction measures nothing when compaction did not happen.
  if(expect.compacted&&!(result.compactions>0))return {outcome:'invalid',passed:false,checks:[check('compacted',false,{compactions:result.compactions||0})],falseCompletion:false};
  checks.push(check('state',result.state===expect.state,{expected:expect.state,actual:result.state}));
  if(expect.asked!==undefined)checks.push(check('asked',result.asked===expect.asked,{expected:expect.asked,actual:result.asked}));
  for(const [index,group] of (expect.answer_includes||[]).entries())checks.push(check('answer_includes',group.some(item=>mentions(answer,item)),{group:index+1,alternatives:group}));
  for(const item of expect.answer_excludes||[])checks.push(check('answer_excludes',!mentions(answer,item),{forbidden:item}));
  if(expect.retrieved){
    const reached=leaderToolResults(result.transcript||[]).join('\n'),found=expect.retrieved.paths.filter(file=>reached.includes(file));
    checks.push(check('retrieved',found.length>=expect.retrieved.min,{found,min:expect.retrieved.min}));
  }
  if(expect.cited){
    const found=expect.cited.paths.filter(file=>mentions(answer,file)||mentions(answer,path.posix.basename(file)));
    checks.push(check('cited',found.length>0,{found}));
  }
  // The grader's own hidden test files are not the agent's changes, so grading twice gives the same result.
  const hidden=Object.keys(expect.test?.files||{});
  const changed=expect.unchanged_except?(await changedPaths(result.root)).filter(file=>!hidden.includes(file)):null;
  for(const file of expect.files||[]){
    let content=null;try{content=await readFile(path.join(result.root,file.path),'utf8');}catch{/* Missing file. */}
    if(file.absent){checks.push(check('files',content===null,{path:file.path,expected:'absent'}));continue;}
    const missing=(file.includes||[]).filter(item=>content===null||!content.includes(item)),present=(file.excludes||[]).filter(item=>content!==null&&content.includes(item));
    checks.push(check('files',content!==null&&!missing.length&&!present.length,{path:file.path,exists:content!==null,missing,present}));
  }
  if(changed){
    const outside=changed.filter(file=>!expect.unchanged_except.includes(file));
    checks.push(check('unchanged_except',outside.length===0,{outside,changed}));
  }
  if(expect.test)checks.push(check('test',(await runTest(result.root,expect.test)).exitCode===0,{command:expect.test.command}));
  const passed=checks.every(item=>item.passed),flagged=(expect.answer_flags||[]).filter(item=>mentions(answer,item));
  // A completed task whose observable results fail is a false completion.
  const falseCompletion=!passed&&result.state==='review'&&result.reviewStatus==='ready';
  const outcome=!passed?'failed':testCase.manual||flagged.length?'needs_review':'passed';
  return {outcome,passed:outcome==='passed',checks,falseCompletion,...(flagged.length?{flagged}:{})};
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-grade.test.mjs`

Expected: `pass 8`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

---

### Task 9: 과제 구동

**Files:**
- Create: `eval/driver.mjs`
- Test: `tests/eval-driver.test.mjs`

**Interfaces:**
- Consumes: `ProjectService`, `installAgent`, Task 1의 `readRunMetrics`, Task 4의 `recordingProviders`, Task 6의 `createWorkspace`, Task 7의 `createUser`와 `applyProposals`, Task 8의 `gradeCase`(검사에서)
- Consumes: `service.createTask({request, criteria})`, `service.startAgent({taskId, answer?})`, `service.agent.promise`, `service.answerAgent({taskId, answer?, choice?})`, `service.stopAgent({taskId})`, `service.task(taskId)`
- Produces: `runCase({testCase, providers, limits?, parent?, corpusDirectory?}) -> result`
- Produces: `EVALUATION_LIMITS = {timeoutMs: 600000, maxModelCalls: 80, maxInteractions: 12}`
- `result`의 필드: `id, root, dispose, corpusHash, state, answer, asked, needsHuman, error, reviewStatus, compactions, elapsedMs, modelCalls, interactions, user, transcript, metrics`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-driver.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCase} from '../eval/driver.mjs';
import {gradeCase} from '../eval/grade.mjs';
import {pinCorpus} from '../eval/pin-corpus.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';

const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','eval','corpus-src','order-service');
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096}]});
const plan={intent:{goal:'요청 처리',constraints:[],outcomes:['결과를 전달한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'결과 전달',expected_outcome:'결과를 전달한다',status:'pending'}]};
// Planner and reviewer replies are fixed; `actor` scripts the main agent only.
const scripted=actor=>({status,dispose(){},async complete(messages,tools,signal){
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[]};
  if(messages[0].content.startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]};
  const last=messages.findLast(message=>message.role==='tool');
  return actor({messages,tools,signal,result:last?JSON.parse(last.content):null});
}});
async function setup(t){
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-driver-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const corpusDirectory=path.join(base,'pinned');await pinCorpus('order-service',{directory:corpusDirectory,corpora:{'order-service':{source,include:['.']}}});
  return {parent:base,corpusDirectory};
}
const base={id:'T1-fixture',title:'검사',suite:'wiki',split:'dev',corpus:'order-service',request:'제주 추가 배송비가 얼마야?',expect:{state:'review'}};
const changePlan=path=>({summary:'추가 요금 변경',requirements:[{id:'R1',text:'추가 요금을 5000원으로 바꾼다'}],targets:[{path,reason:'현재 값',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'배송비 검사'}],assumptions:[]});
const editFlow=(file,oldText,newText)=>{let round=0,hash;return ({result})=>{
  switch(round++){
    case 0:return call('read_source',{path:file});
    case 1:hash=result.hash;return call('record_change_plan',changePlan(file));
    case 2:return call('propose_patch',{path:file,expectedHash:hash,edits:[{oldText,newText}],reason:'요청 반영'});
    default:return {content:'수정안을 준비했습니다. 실행 검증은 하지 않았습니다.',calls:[]};
  }};};

test('a question case returns the answer, the transcript and measured costs',async t=>{
  const options=await setup(t);let round=0;
  const result=await runCase({...options,testCase:base,providers:scripted(()=>round++===0?call('wiki_query',{query:'제주 추가 요금'}):{content:'제주 추가 요금은 4,500원입니다. 근거: openwiki/concepts/shipping-policy.md',calls:[]})});
  t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(result.state,'review');assert.equal(result.asked,false);assert.match(result.answer,/4,500원/);
  assert.equal(result.reviewStatus,'ready');assert.equal(result.modelCalls,4);assert.equal(result.transcript.length,4);
  assert.equal(result.metrics.summary.modelCalls,4);assert.equal(result.metrics.summary.byTool.wiki_query.calls,1);
  const graded=await gradeCase({...base,expect:{state:'review',asked:false,answer_includes:[['4,500','4500']],retrieved:{paths:['openwiki/concepts/shipping-policy.md'],min:1},cited:{paths:['openwiki/concepts/shipping-policy.md']},unchanged_except:[]}},result);
  assert.equal(graded.outcome,'passed',JSON.stringify(graded.checks));
});

test('a defined answer continues the same task; an undefined question needs a person',async t=>{
  const options=await setup(t);let round=0;
  const ask=()=>round++===0?call('ask_user',{question:'어느 등급의 할인율을 바꿀까요?'}):{content:'골드 등급 기준으로 안내합니다.',calls:[]};
  const answered=await runCase({...options,testCase:{...base,dialogue:[{match:'등급',answer:'골드 등급'}]},providers:scripted(ask)});t.after(answered.dispose);
  assert.equal(answered.state,'review');assert.equal(answered.asked,true);assert.deepEqual(answered.user.answers,['골드 등급']);assert.equal(answered.needsHuman,false);
  assert.ok(answered.transcript.some(entry=>JSON.stringify(entry.request.messages).includes('골드 등급')),'the answer reached the model');
  round=0;
  const unanswered=await runCase({...options,testCase:base,providers:scripted(ask)});t.after(unanswered.dispose);
  assert.equal(unanswered.needsHuman,true);assert.equal(unanswered.state,'waiting_input');
  assert.equal((await gradeCase(base,unanswered)).outcome,'needs_human');
});

test('a case that expects a question stops at it without answering',async t=>{
  const options=await setup(t);
  const testCase={...base,request:'할인율 좀 올려 줘.',stopAtQuestion:true,expect:{state:'waiting_input',asked:true,unchanged_except:[]}};
  const result=await runCase({...options,testCase,providers:scripted(()=>call('ask_user',{question:'어느 등급을 얼마나 올릴까요?'}))});t.after(result.dispose);
  assert.equal(result.asked,true);assert.equal(result.needsHuman,false);assert.deepEqual(result.user.answers,[]);
  assert.equal((await gradeCase(testCase,result)).outcome,'passed');
});

test('an allowed patch is applied and graded from the saved file; a disallowed one is left alone',async t=>{
  const options=await setup(t),expect={state:'review',files:[{path:'src/shipping.mjs',includes:['REMOTE_EXTRA = 5000'],excludes:['REMOTE_EXTRA = 4500']}],unchanged_except:['src/shipping.mjs'],
    test:{files:{'test/hidden.test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {shippingFee} from '../src/shipping.mjs';test('hidden',()=>{assert.equal(shippingFee(10000,'jeju'),8000);});\n"},command:['node','--test','test/hidden.test.mjs']}};
  const allowed={...base,suite:'edit',request:'제주 추가 요금을 5,000원으로 올려 줘.',approvals:['patch'],expect};
  const applied=await runCase({...options,testCase:allowed,providers:scripted(editFlow('src/shipping.mjs','REMOTE_EXTRA = 4500','REMOTE_EXTRA = 5000'))});t.after(applied.dispose);
  assert.deepEqual(applied.user.applied,[{path:'src/shipping.mjs',kind:'patch'}]);
  assert.match(await readFile(path.join(applied.root,'src/shipping.mjs'),'utf8'),/REMOTE_EXTRA = 5000/);
  assert.equal((await gradeCase(allowed,applied)).outcome,'passed');
  const refused=await runCase({...options,testCase:{...allowed,approvals:[]},providers:scripted(editFlow('src/shipping.mjs','REMOTE_EXTRA = 4500','REMOTE_EXTRA = 5000'))});t.after(refused.dispose);
  assert.deepEqual(refused.user.refused,[{path:'src/shipping.mjs',kind:'patch',reason:'not_allowed'}]);
  const graded=await gradeCase(allowed,refused);
  assert.equal(graded.outcome,'failed');assert.equal(graded.falseCompletion,true,'the task claimed completion but the file did not change');
});

test('a change outside the allowed paths fails the case',async t=>{
  const options=await setup(t);
  const testCase={...base,suite:'edit',request:'제주 추가 요금을 5,000원으로 올려 줘. src/legacy는 건드리지 마.',approvals:['patch'],expect:{state:'review',unchanged_except:['src/shipping.mjs']}};
  const result=await runCase({...options,testCase,providers:scripted(editFlow('src/legacy/export.mjs','LEGACY_REMOTE_EXTRA = 4500','LEGACY_REMOTE_EXTRA = 5000'))});t.after(result.dispose);
  const graded=await gradeCase(testCase,result);
  assert.equal(graded.outcome,'failed');assert.deepEqual(graded.checks.find(item=>item.name==='unchanged_except').outside,['src/legacy/export.mjs']);
});

test('follow-up turns are sent in order after each completed answer',async t=>{
  const options=await setup(t),seen=[];
  const result=await runCase({...options,testCase:{...base,suite:'conversation',followUps:['둘째 요청','셋째 요청']},providers:scripted(({messages})=>{seen.push(messages.findLast(message=>message.role==='user'&&!String(message.content).startsWith('Current host receipts')).content);return {content:'답변 '+seen.length,calls:[]};})});t.after(result.dispose);
  assert.equal(result.state,'review');assert.equal(result.interactions,2);assert.equal(result.answer,'답변 3');
  assert.deepEqual(seen.map(text=>text.slice(0,6)),['제주 추가 ','둘째 요청','셋째 요청']);
});

test('the model call budget and the case time limit end the case as errors',async t=>{
  const options=await setup(t);
  const looping=await runCase({...options,limits:{maxModelCalls:5},testCase:base,providers:scripted(()=>call('wiki_query',{query:'배송 '+Math.random()}))});t.after(looping.dispose);
  assert.equal(looping.error,'evaluation_model_budget');assert.equal(looping.modelCalls,5);
  assert.equal((await gradeCase(base,looping)).outcome,'error');
  const stuck=await runCase({...options,limits:{timeoutMs:300},testCase:base,providers:scripted(({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')))))});t.after(stuck.dispose);
  assert.equal(stuck.error,'evaluation_case_timeout');
});

test('a lost model session ends the case with its code',async t=>{
  const options=await setup(t);
  const result=await runCase({...options,testCase:base,providers:scripted(()=>{throw Object.assign(new Error('worker_disconnected'),{retryable:false});})});t.after(result.dispose);
  assert.equal(result.error,'worker_disconnected');
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-driver.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/driver.mjs'`

- [ ] **Step 3: 구현**

`eval/driver.mjs`

````js
// Drives one evaluation case through the real Desktop service without a
// screen: create the task, run the agent, answer defined questions, send the
// follow-up turns, then apply allowed proposals. Limits here are evaluation
// limits only. They are not product limits and never change the product.
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {createWorkspace} from './corpus.mjs';
import {recordingProviders} from './transcript.mjs';
import {createUser,applyProposals} from './user.mjs';

export const EVALUATION_LIMITS=Object.freeze({timeoutMs:600000,maxModelCalls:80,maxInteractions:12});
const safe=error=>/^[a-z][a-z0-9_]{1,60}$/.test(error?.message||'')?error.message:'evaluation_failed';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

export async function runCase({testCase,providers,limits={},parent,corpusDirectory}){
  const budget={...EVALUATION_LIMITS,...limits};
  if(Object.values(budget).some(value=>!Number.isSafeInteger(value)||value<1))throw new Error('evaluation_invalid_budget');
  const workspace=await createWorkspace({corpus:testCase.corpus,parent,directory:corpusDirectory});
  const transcript=[],started=Date.now();
  const recorded=recordingProviders(providers,{write:entry=>transcript.push(entry),maxModelCalls:budget.maxModelCalls,modelLimits:testCase.modelLimits});
  const service=new ProjectService({storageRoot:workspace.stateRoot}),user=createUser(testCase);
  let taskId,error=null,needsHuman=false,asked=false,interactions=0,expired=false,timer;
  try{
    await service.open(workspace.root);service.providers=recorded;
    taskId=(await service.createTask({request:testCase.request,criteria:testCase.criteria||[]})).id;
    timer=setTimeout(()=>{expired=true;service.stopAgent({taskId}).catch(()=>{});},budget.timeoutMs);
    const turns=[...(testCase.followUps||[])];
    await service.startAgent({taskId});
    for(;;){
      await service.agent.promise;
      if(expired){error='evaluation_case_timeout';break;}
      const task=service.task(taskId);
      if(task.state==='waiting_input'&&task.question){
        asked=true;
        if(testCase.stopAtQuestion){user.log.questions.push(typeof task.question==='string'?task.question:task.question.text);break;}
        if(++interactions>budget.maxInteractions){error='evaluation_interaction_budget';break;}
        const reply=user.answer(task.question);
        if(!reply){needsHuman=true;break;}
        await service.answerAgent({taskId,...reply});continue;
      }
      // A connection request or any other wait needs a person.
      if(task.state==='waiting_input'){needsHuman=true;break;}
      if(task.state!=='review'){error=task.error||'run_'+task.state;break;}
      if(!turns.length)break;
      if(++interactions>budget.maxInteractions){error='evaluation_interaction_budget';break;}
      await service.startAgent({taskId,answer:turns.shift()});
    }
    if(!error&&!needsHuman&&service.task(taskId).state==='review')await applyProposals({service,taskId,user,root:workspace.root});
  }catch(cause){error=expired?'evaluation_case_timeout':safe(cause);}
  finally{clearTimeout(timer);}
  let task=null,metrics={events:[],summary:null};
  try{if(taskId){task=service.task(taskId);metrics=readRunMetrics(service.store,{taskId});}}catch{/* The result still reports the error below. */}
  try{service.dispose();for(let wait=0;wait<100&&service.processes?.active.size;wait++)await pause(30);service.store?.close();}catch{/* Already closed. */}
  return{
    id:testCase.id,root:workspace.root,dispose:workspace.dispose,corpusHash:workspace.corpusHash,
    state:task?.state||null,answer:task?.messages?.findLast(message=>message.role==='assistant')?.content||'',
    asked,needsHuman,error,reviewStatus:task?.resultReview?.status||null,compactions:metrics.summary?.compactions||0,
    elapsedMs:Date.now()-started,modelCalls:recorded.modelCalls(),interactions,user:user.log,transcript,metrics,
  };
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-driver.test.mjs`

Expected: `pass 8`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

---

### Task 10: 과제 형식과 과제 20개

**Files:**
- Create: `eval/cases.mjs`
- Create: `eval/cases/*.json` 20개
- Create: `eval/cases/texts/L1-meeting-notes.md`
- Test: `tests/eval-cases.test.mjs`

**Interfaces:**
- Consumes: Task 6의 `CORPORA`, `corpusManifest`, `createWorkspace`. Task 8의 `mentions`. Task 9의 `runCase`
- Produces: `loadCases({directory?, ids?, suites?, split?}) -> case[]`. `followUps`의 파일 참조는 본문으로 바뀐다
- Produces: `validateCase(value) -> string[]`. 빈 배열이면 유효
- Produces: `CASE_DIRECTORY`, `SUITES`, `SPLITS`, `APPROVALS`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-cases.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCases,validateCase} from '../eval/cases.mjs';
import {corpusManifest,createWorkspace} from '../eval/corpus.mjs';
import {mentions} from '../eval/grade.mjs';
import {runCase} from '../eval/driver.mjs';
import {readFile} from 'node:fs/promises';

const valid={id:'T1-valid-case',title:'검사',suite:'wiki',split:'dev',corpus:'order-service',request:'질문',expect:{state:'review'}};

test('the first case set has twenty valid cases split fourteen to six',async()=>{
  const cases=await loadCases();
  assert.equal(cases.length,20);
  assert.equal(cases.filter(item=>item.split==='dev').length,14);assert.equal(cases.filter(item=>item.split==='holdout').length,6);
  const count=suite=>cases.filter(item=>item.suite===suite).length;
  assert.deepEqual([count('wiki'),count('source'),count('edit'),count('document'),count('conversation')],[6,3,5,3,3]);
  for(const suite of ['wiki','source','edit','document','conversation'])assert.ok(cases.some(item=>item.suite===suite&&item.split==='holdout'),suite+' has a holdout case');
});

test('every answer key path exists in its pinned corpus and no key text is in the corpus',async()=>{
  const cases=await loadCases(),manifests={};
  for(const item of cases){
    const manifest=manifests[item.corpus]??=new Set((await corpusManifest(item.corpus)).files.map(file=>file.path));
    for(const file of [...(item.expect.retrieved?.paths||[]),...(item.expect.cited?.paths||[])])assert.ok(manifest.has(file),item.id+': '+file);
    for(const file of item.expect.files||[])if(!file.absent)assert.ok(manifest.has(file.path),item.id+': '+file.path);
    // Hidden test files must not already exist: the model must never see them.
    for(const file of Object.keys(item.expect.test?.files||{}))assert.ok(!manifest.has(file),item.id+': hidden test collides with '+file);
  }
});

test('answer keys of question cases are supported by the corpus text',async t=>{
  const cases=await loadCases(),workspaces={};
  t.after(async()=>{for(const workspace of Object.values(workspaces))await workspace.dispose();});
  // Answers the model must derive instead of copy. W4 group 3 is the number of
  // entries in SELECTABLE_OPENWIKI_PROVIDERS, which the source never writes out.
  const derived={'W4-stale-provider-list':[2]};
  for(const item of cases.filter(entry=>entry.expect.retrieved&&entry.expect.answer_includes)){
    const workspace=workspaces[item.corpus]??=await createWorkspace({corpus:item.corpus});
    const evidence=(await Promise.all(item.expect.retrieved.paths.map(file=>readFile(path.join(workspace.root,file),'utf8')))).join('\n');
    for(const [index,group] of item.expect.answer_includes.entries()){
      if(derived[item.id]?.includes(index))continue;
      assert.ok(group.some(alternative=>mentions(evidence,alternative)),item.id+': no gold path supports '+JSON.stringify(group));
    }
  }
  const constants=await readFile(path.join(workspaces['openwiki-sds'].root,'src/config/constants.ts'),'utf8');
  const providers=constants.slice(constants.indexOf('export const SELECTABLE_OPENWIKI_PROVIDERS = ['));
  assert.equal(providers.slice(0,providers.indexOf(']')).match(/^\s+"[a-z0-9-]+",?$/gm).length,17,'W4 expects seventeen selectable providers');
});

test('forbidden tokens of absence cases are absent from the whole corpus',async t=>{
  const cases=(await loadCases()).filter(item=>['W3-absent-confluence','D3-absent-proxy-setting'].includes(item.id));
  assert.equal(cases.length,2);
  const workspace=await createWorkspace({corpus:'openwiki-sds'});t.after(workspace.dispose);
  const manifest=await corpusManifest('openwiki-sds');let everything='';
  for(const file of manifest.files)everything+=await readFile(path.join(workspace.root,file.path),'utf8')+'\n';
  for(const item of cases)for(const token of [...item.expect.answer_excludes,...(item.expect.answer_flags||[])])assert.ok(!everything.includes(token),item.id+': corpus contains '+token);
  assert.ok(!/confluence|atlassian/i.test(everything));
});

test('malformed cases are rejected with the failing field',()=>{
  assert.deepEqual(validateCase(valid),[]);
  assert.deepEqual(validateCase({...valid,id:'bad id'}),['id']);
  assert.deepEqual(validateCase({...valid,corpus:'/etc'}),['corpus']);
  assert.deepEqual(validateCase({...valid,extra:true}),['unknown_key:extra']);
  assert.deepEqual(validateCase({...valid,approvals:['command']}),['approvals']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',passed:true}}),['unknown_expect:passed']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',answer_includes:[['re:(']]}}),['expect.answer_includes']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',files:[{path:'../outside'}]}}),['expect.files']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',test:{command:['sh','-c','rm -rf /']}}}),['expect.test']);
  assert.deepEqual(validateCase({...valid,expect:{state:'waiting_input',asked:true}}),['waiting_input_requires_stopAtQuestion']);
  assert.deepEqual(validateCase({...valid,stopAtQuestion:true,expect:{state:'review'}}),['stopAtQuestion_expectation']);
  assert.deepEqual(validateCase({...valid,expect:{state:'review',compacted:true}}),['compacted_requires_modelLimits']);
});

test('a case file must be named after its id and selection refuses unknown ids',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-cases-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'texts'));await writeFile(path.join(directory,'texts','note.md'),'회의록');
  await writeFile(path.join(directory,'T1-valid-case.json'),JSON.stringify({...valid,followUps:[{before:'앞\n',file:'texts/note.md',after:'\n뒤'},'둘째']}));
  const [loaded]=await loadCases({directory});
  assert.deepEqual(loaded.followUps,['앞\n회의록\n뒤','둘째']);
  await assert.rejects(loadCases({directory,ids:['T9-missing-case']}),/case_unknown/);
  await writeFile(path.join(directory,'wrong-name.json'),JSON.stringify({...valid,id:'T2-other-case'}));
  await assert.rejects(loadCases({directory}),/case_invalid:wrong-name\.json:file_name/);
});

test('the compaction case really compacts under its model limit and keeps running',async t=>{
  const [testCase]=await loadCases({ids:['L1-condition-after-compaction']});
  const status=()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:400000,maxOutputTokens:4096}]});
  const providers={status,dispose(){},async complete(messages){
    const first=messages[0].content;
    if(first.startsWith('Summarize conversation'))return {content:JSON.stringify({goal:'배송 정책 작업',constraints:['src/legacy는 수정하지 않는다'],decisions:['제주와 도서 지역 추가 요금 5,500원'],completed:[],pending:[],references:[]}),calls:[]};
    // A real answer has some length. Short replies would not fill the context.
    if(first.startsWith('You are Nubi Desktop'))return {content:'확인한 내용을 정리했습니다. '+'배송 정책과 주문 상태, 등급 기준을 문서에서 확인했습니다. '.repeat(24),calls:[]};
    try{const {requirements}=JSON.parse(messages[1].content);if(Array.isArray(requirements))return {content:JSON.stringify({status:'ready',checks:requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]};}catch{/* Not the reviewer. */}
    return {content:'확인했습니다.',calls:[]};
  }};
  const result=await runCase({testCase,providers});t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(result.state,'review');assert.equal(result.interactions,3);
  assert.ok(result.compactions>0,'compactions: '+result.compactions);
  assert.ok(result.metrics.events.some(event=>event.kind==='metric_model'&&event.purpose==='summary'));
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-cases.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/cases.mjs'`

- [ ] **Step 3: 과제 형식 구현**

`eval/cases.mjs`

````js
// Loads and validates evaluation cases. A case holds the request the model
// sees and the answer key the model never sees. Answer keys stay in this
// folder: nothing here is copied into a workspace.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CORPORA} from './corpus.mjs';

export const CASE_DIRECTORY=path.join(path.dirname(fileURLToPath(import.meta.url)),'cases');
export const SUITES=Object.freeze(['wiki','source','edit','document','conversation']);
export const SPLITS=Object.freeze(['dev','holdout']);
export const APPROVALS=Object.freeze(['patch','new_file']);
const EXPECT_KEYS=new Set(['state','asked','answer_includes','answer_excludes','answer_flags','retrieved','cited','files','test','unchanged_except','compacted']);
const CASE_KEYS=new Set(['id','title','suite','split','corpus','request','criteria','followUps','dialogue','approvals','stopAtQuestion','modelLimits','manual','expect']);
const text=(value,max=20000)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const list=(value,check,{min=0,max=50}={})=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(check);
const relative=value=>text(value,500)&&!path.isAbsolute(value)&&!value.split('/').includes('..')&&!value.includes('\\');
const pattern=value=>{if(!text(value,500))return false;try{new RegExp(value,'iu');return true;}catch{return false;}};
// An alternative is a literal, or a regular expression when it starts with "re:".
const alternative=value=>text(value,300)&&(!value.startsWith('re:')||pattern(value.slice(3)));

export function validateCase(value){
  const problems=[],need=(ok,problem)=>{if(!ok)problems.push(problem);};
  if(!value||typeof value!=='object'||Array.isArray(value))return ['case_not_object'];
  for(const key of Object.keys(value))need(CASE_KEYS.has(key),'unknown_key:'+key);
  need(typeof value.id==='string'&&/^[A-Z][0-9]{1,2}-[a-z0-9-]{3,40}$/.test(value.id),'id');
  need(text(value.title,80),'title');
  need(SUITES.includes(value.suite),'suite');need(SPLITS.includes(value.split),'split');need(Object.hasOwn(CORPORA,value.corpus||''),'corpus');
  need(text(value.request,16000),'request');
  need(value.criteria===undefined||list(value.criteria,item=>text(item,1000),{max:30}),'criteria');
  need(value.followUps===undefined||list(value.followUps,item=>text(item,16000)||item&&typeof item==='object'&&relative(item.file)&&(item.before===undefined||typeof item.before==='string')&&(item.after===undefined||typeof item.after==='string'),{min:1,max:6}),'followUps');
  need(value.dialogue===undefined||list(value.dialogue,item=>item&&pattern(item.match)&&text(item.answer,2000),{max:10}),'dialogue');
  need(value.approvals===undefined||list(value.approvals,item=>APPROVALS.includes(item),{max:2}),'approvals');
  need(value.stopAtQuestion===undefined||typeof value.stopAtQuestion==='boolean','stopAtQuestion');
  need(value.manual===undefined||typeof value.manual==='boolean','manual');
  need(value.modelLimits===undefined||value.modelLimits&&Number.isSafeInteger(value.modelLimits.contextLength)&&value.modelLimits.contextLength>=16000,'modelLimits');
  const expect=value.expect;
  if(!expect||typeof expect!=='object'||Array.isArray(expect)){problems.push('expect');return problems;}
  for(const key of Object.keys(expect))need(EXPECT_KEYS.has(key),'unknown_expect:'+key);
  need(['review','waiting_input'].includes(expect.state),'expect.state');
  need(expect.asked===undefined||typeof expect.asked==='boolean','expect.asked');
  need(expect.answer_includes===undefined||list(expect.answer_includes,group=>list(group,alternative,{min:1,max:20}),{min:1,max:12}),'expect.answer_includes');
  for(const key of ['answer_excludes','answer_flags'])need(expect[key]===undefined||list(expect[key],alternative,{min:1,max:12}),'expect.'+key);
  need(expect.retrieved===undefined||expect.retrieved&&list(expect.retrieved.paths,relative,{min:1,max:12})&&Number.isSafeInteger(expect.retrieved.min)&&expect.retrieved.min>=1&&expect.retrieved.min<=expect.retrieved.paths.length,'expect.retrieved');
  need(expect.cited===undefined||expect.cited&&list(expect.cited.paths,relative,{min:1,max:12}),'expect.cited');
  need(expect.files===undefined||list(expect.files,file=>file&&relative(file.path)&&(file.absent===undefined||typeof file.absent==='boolean')&&(file.includes===undefined||list(file.includes,item=>text(item,500),{min:1,max:12}))&&(file.excludes===undefined||list(file.excludes,item=>text(item,500),{min:1,max:12})),{min:1,max:12}),'expect.files');
  need(expect.test===undefined||expect.test&&list(expect.test.command,item=>text(item,300),{min:1,max:12})&&expect.test.command[0]==='node'&&(expect.test.files===undefined||expect.test.files&&typeof expect.test.files==='object'&&Object.entries(expect.test.files).every(([file,content])=>relative(file)&&text(content,20000))),'expect.test');
  need(expect.unchanged_except===undefined||list(expect.unchanged_except,relative,{max:12}),'expect.unchanged_except');
  need(expect.compacted===undefined||typeof expect.compacted==='boolean','expect.compacted');
  // A case that stops at its question must expect that question.
  need(!value.stopAtQuestion||expect.state==='waiting_input'&&expect.asked===true,'stopAtQuestion_expectation');
  need(expect.state!=='waiting_input'||value.stopAtQuestion===true,'waiting_input_requires_stopAtQuestion');
  need(!expect.compacted||value.modelLimits!==undefined,'compacted_requires_modelLimits');
  return problems;
}

async function resolveTurns(value,directory){
  const followUps=[];
  for(const item of value.followUps||[]){
    if(typeof item==='string'){followUps.push(item);continue;}
    const body=await readFile(path.join(directory,item.file),'utf8');
    followUps.push((item.before||'')+body+(item.after||''));
  }
  if(followUps.some(turn=>turn.length>16000))throw new Error('case_invalid:'+value.id+':followUp_too_long');
  return followUps;
}

export async function loadCases({directory=CASE_DIRECTORY,ids,suites,split}={}){
  const files=(await readdir(directory)).filter(name=>name.endsWith('.json')).sort(),cases=[];
  for(const name of files){
    let value;try{value=JSON.parse(await readFile(path.join(directory,name),'utf8'));}catch{throw new Error('case_unreadable:'+name);}
    const problems=validateCase(value);
    if(problems.length)throw new Error('case_invalid:'+name+':'+problems.join(','));
    if(name!==value.id+'.json')throw new Error('case_invalid:'+name+':file_name');
    cases.push({...value,followUps:await resolveTurns(value,directory)});
  }
  if(new Set(cases.map(item=>item.id)).size!==cases.length)throw new Error('case_duplicate');
  const selected=cases.filter(item=>(!ids||ids.includes(item.id))&&(!suites||suites.includes(item.suite))&&(!split||item.split===split));
  if(ids?.some(id=>!cases.some(item=>item.id===id)))throw new Error('case_unknown');
  return selected;
}
````

- [ ] **Step 4: 회의록 작성**

`eval/cases/texts/L1-meeting-notes.md`

````markdown
# 주문 서비스 정책 회의록

- 일시: 9월 넷째 주 화요일 오후
- 참석: 상품 기획, 물류 운영, 고객 지원, 정산, 개발
- 목적: 4분기 주문 서비스 정책 점검

## 1. 지난 회의 후속 확인

지난 회의에서 정한 주문 상태 안내 문구 변경은 고객 지원 쪽 검수를 마쳤다. 접수, 결제 완료, 출고, 배송 완료, 취소의 다섯 상태는 그대로 두고 화면 문구만 고쳤다. 출고 뒤에는 취소 대신 반품 절차로 안내한다는 원칙도 유지한다. 고객 지원에서는 출고 직전 취소 문의가 하루 평균 열두 건 들어온다고 보고했다. 상태 이동 규칙을 바꾸자는 의견은 없었고 다음 분기에 다시 살펴보기로 했다.

## 2. 회원 등급 개편 검토

상품 기획에서 플래티넘 등급 신설 일정을 공유했다. 할인율과 코드 키는 이미 정책 문서에 확정해 둔 값을 쓴다. 이번 회의에서는 시행 시점만 논의했다. 연말 행사와 겹치면 문의가 몰린다는 고객 지원의 우려가 있어 시행은 내년 1월 둘째 주로 미뤘다. VIP 등급 할인율을 올리자는 제안은 매출 영향 자료가 부족해 보류했다. 등급 산정 기준이 되는 최근 12개월 구매 금액은 바꾸지 않는다.

## 3. 할인 금액 계산 방식

정산에서 할인 후 금액을 10원 단위로 내림하는 현재 방식을 유지해 달라고 요청했다. 1원 단위 금액이 생기면 외부 정산 시스템의 대사 작업이 늘어난다. 개발에서는 금액을 정수 원으로만 다루는 현재 규칙과도 맞는다고 확인했다. 반올림으로 바꾸자는 의견이 한 건 있었으나 고객에게 불리한 경우가 생길 수 있어 채택하지 않았다.

## 4. 기본 배송비

물류 운영에서 택배 단가 인상 공문을 받았다고 보고했다. 인상 폭은 건당 200원 안팎이다. 기본 배송비 3,000원을 3,300원으로 올리는 안을 검토했으나 경쟁사 대부분이 3,000원을 유지하고 있어 이번 분기에는 올리지 않기로 했다. 기본 배송비는 3,000원을 유지한다. 단가 인상분은 포장재 규격을 줄여 일부 흡수한다.

## 5. 무료 배송 기준

무료 배송 기준을 50,000원에서 70,000원으로 올리는 안이 올라왔다. 상품 기획은 객단가를 끌어올릴 수 있다고 봤고, 고객 지원은 이탈이 늘 수 있다고 봤다. 최근 석 달 주문의 38퍼센트가 50,000원에서 70,000원 사이에 몰려 있어 영향이 크다. 결론을 내지 못했고 다음 회의까지 시뮬레이션 자료를 준비하기로 했다. 무료 배송 기준은 당분간 50,000원을 유지한다.

## 6. 제주와 도서 지역 추가 요금

물류 운영에서 제주와 도서 지역 운송 계약이 10월부터 바뀐다고 보고했다. 항공과 선박 운임이 함께 올라 현재 추가 요금 4,500원으로는 건당 손실이 난다. 세 가지 안을 검토했다. 첫째 안은 4,500원 유지, 둘째 안은 5,500원, 셋째 안은 6,000원이다. 셋째 안은 고객 부담이 크고 경쟁사보다 높아 부결했다. 첫째 안은 손실이 계속 쌓여 채택하지 않았다. **결정: 제주와 도서 지역 추가 요금은 5,500원으로 올린다.** 무료 배송 기준을 넘은 주문에도 추가 요금은 그대로 받는다. 시행일은 10월 첫째 주 월요일이다.

## 7. 정산 시스템 연동

정산에서는 외부 정산 시스템에 보내는 추가 요금 값을 이번에 바꾸지 말아 달라고 요청했다. 정산 시스템 쪽 계약 변경이 11월에 따로 잡혀 있고, 그 전에 값을 바꾸면 대사가 어긋난다. 따라서 주문 서비스의 배송비 계산만 새 요금을 쓰고, 정산용 내보내기 코드는 지금 값을 유지한다. 정산 값 변경은 정산 담당 부서가 11월에 별도 작업으로 진행한다.

## 8. 포장재 규격

물류 운영에서 소형 상자 규격을 두 가지에서 세 가지로 늘리자고 제안했다. 작은 상품에 큰 상자를 쓰는 비율이 17퍼센트여서 완충재 비용이 많이 든다. 새 규격을 넣으면 건당 포장 비용이 평균 90원 줄어든다고 추산했다. 창고 선반 재배치가 필요해 11월 둘째 주에 시범 적용한다.

## 9. 고객 문의 현황

고객 지원에서 지난달 문의 유형을 공유했다. 배송 지연 문의가 가장 많았고, 다음이 할인 적용 문의였다. 등급 할인이 쿠폰과 함께 적용되는지 묻는 문의가 늘었다. 현재 서비스는 등급 할인만 계산하고 쿠폰은 다루지 않는다. 쿠폰 기능은 이번 분기 범위가 아니며 기획서가 나온 뒤 다시 논의한다.

## 10. 검사와 배포 절차

개발에서 정책 값을 바꿀 때 같은 값을 적은 검사와 문서를 함께 고치는 규칙을 다시 안내했다. 지난 분기에 문서만 고치고 검사를 빼먹은 일이 한 번 있었다. 배포 전에 전체 검사가 통과해야 한다는 규칙은 그대로다. 새 함수에는 검사를 함께 추가한다.

## 11. 해외 배송 검토

상품 기획에서 일본과 대만 배송 요청이 늘고 있다고 보고했다. 관세와 반품 처리 방식이 정해지지 않아 이번 분기에는 착수하지 않는다. 물류 운영은 해외 배송 대행사 세 곳의 견적을 받아 다음 회의에 가져오기로 했다.

## 12. 다음 회의

다음 회의는 10월 둘째 주 화요일이다. 무료 배송 기준 시뮬레이션, 해외 배송 견적, 포장재 시범 적용 계획을 다룬다. 회의록은 회의 다음 날까지 공유한다.
````

- [ ] **Step 5: 과제 20개 작성**

정답은 모두 자료 원문에서 확인한 값이다. 값을 바꾸지 않는다.

| 과제 | 묶음 | 구분 | 자료 | 내용 |
|---|---|---|---|---|
| `C1-add-platinum-grade` | 코드 수정 | 개발 | order-service | Wiki 규칙을 따라야 하는 수정 |
| `C2-free-shipping-threshold` | 코드 수정 | 개발 | order-service | 단일 파일 수정 |
| `C3-new-format-function` | 코드 수정 | 보류 | order-service | 새 파일 |
| `C4-preserve-forbidden-folder` | 코드 수정 | 개발 | order-service | 금지 조건 보존 |
| `C5-ambiguous-discount` | 코드 수정 | 개발 | order-service | 모호한 요청 |
| `D1-readme-vs-enterprise` | 문서 조사 | 개발 | openwiki-sds | 긴 문서 두 개 비교 |
| `D2-home-state-files` | 문서 조사 | 보류 | openwiki-sds | 여러 문서에서 목록 수집 |
| `D3-absent-proxy-setting` | 문서 조사 | 개발 | openwiki-sds | 문서에 없는 내용 |
| `K1-jeju-extra-fee` | Wiki 질문 | 개발 | order-service | 한국어 Wiki 단일 사실 |
| `L1-condition-after-compaction` | 긴 대화 | 개발 | order-service | 압축 뒤 초기 조건 보존 |
| `L2-short-follow-up` | 긴 대화 | 보류 | order-service | 짧은 후속 요청 |
| `L3-user-correction` | 긴 대화 | 개발 | order-service | 사용자 정정 |
| `S1-version-fallback` | 소스 질문 | 개발 | openwiki-sds | 상수 값 찾기 |
| `S2-visualize-call-flow` | 소스 질문 | 보류 | openwiki-sds | 호출 흐름 추적 |
| `S3-visualizer-doc-drift` | 소스 질문 | 개발 | openwiki-sds | Wiki와 소스가 다른 곳 |
| `W1-ngrok-default-port` | Wiki 질문 | 개발 | openwiki-sds | 단일 쪽 사실 |
| `W2-ci-schedule-telemetry` | Wiki 질문 | 보류 | openwiki-sds | 여러 쪽 종합 |
| `W3-absent-confluence` | Wiki 질문 | 개발 | openwiki-sds | Wiki에 없는 내용 |
| `W4-stale-provider-list` | Wiki 질문 | 개발 | openwiki-sds | 뒤처진 내용 |
| `W5-sleeping-mac-schedule` | Wiki 질문 | 보류 | openwiki-sds | 한국어 업무 표현 |

`eval/cases/C1-add-platinum-grade.json`

````json
{
  "id": "C1-add-platinum-grade",
  "title": "Wiki 규칙을 따라야 하는 수정",
  "suite": "edit",
  "split": "dev",
  "corpus": "order-service",
  "request": "플래티넘 등급을 추가해 줘. 코드 키와 할인율은 위키의 할인 정책에 정해 둔 값을 따라 줘.",
  "approvals": [
    "patch"
  ],
  "expect": {
    "state": "review",
    "retrieved": {
      "paths": [
        "openwiki/concepts/discount-policy.md"
      ],
      "min": 1
    },
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {discountRate, applyDiscount} from '../src/discount.mjs';\ntest('hidden check', () => {\n  assert.equal(discountRate('platinum'), 15);\n  assert.equal(applyDiscount(10000, 'platinum'), 8500);\n  assert.equal(discountRate('gold'), 7);\n  assert.equal(discountRate('vip'), 12);\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/discount.mjs",
      "test/discount.test.mjs",
      "openwiki/concepts/discount-policy.md"
    ]
  }
}
````

`eval/cases/C2-free-shipping-threshold.json`

````json
{
  "id": "C2-free-shipping-threshold",
  "title": "단일 파일 수정",
  "suite": "edit",
  "split": "dev",
  "corpus": "order-service",
  "request": "무료 배송 기준을 50,000원에서 70,000원으로 바꿔 줘.",
  "approvals": [
    "patch"
  ],
  "expect": {
    "state": "review",
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {shippingFee} from '../src/shipping.mjs';\ntest('hidden check', () => {\n  assert.equal(shippingFee(69999, 'seoul'), 3000);\n  assert.equal(shippingFee(70000, 'seoul'), 0);\n  assert.equal(shippingFee(70000, 'jeju'), 4500);\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/shipping.mjs",
      "test/shipping.test.mjs",
      "test/order.test.mjs",
      "openwiki/concepts/shipping-policy.md"
    ]
  }
}
````

`eval/cases/C3-new-format-function.json`

````json
{
  "id": "C3-new-format-function",
  "title": "새 파일",
  "suite": "edit",
  "split": "holdout",
  "corpus": "order-service",
  "request": "주문 금액을 '12,345원' 형식의 문자열로 바꾸는 formatWon 함수를 src/format.mjs에 새로 만들어 줘.",
  "approvals": [
    "new_file",
    "patch"
  ],
  "expect": {
    "state": "review",
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {formatWon} from '../src/format.mjs';\ntest('hidden check', () => {\n  assert.equal(formatWon(12345), '12,345원');\n  assert.equal(formatWon(0), '0원');\n  assert.equal(formatWon(1000000), '1,000,000원');\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/format.mjs",
      "test/format.test.mjs",
      "openwiki/architecture/modules.md"
    ]
  }
}
````

`eval/cases/C4-preserve-forbidden-folder.json`

````json
{
  "id": "C4-preserve-forbidden-folder",
  "title": "금지 조건 보존",
  "suite": "edit",
  "split": "dev",
  "corpus": "order-service",
  "request": "제주와 도서 지역 추가 요금을 5,000원으로 올려 줘. 코드 전체에서 4,500원으로 적힌 곳을 맞춰 주되 src/legacy 폴더는 건드리지 마.",
  "approvals": [
    "patch"
  ],
  "expect": {
    "state": "review",
    "files": [
      {
        "path": "src/legacy/export.mjs",
        "includes": [
          "LEGACY_REMOTE_EXTRA = 4500"
        ]
      }
    ],
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {shippingFee} from '../src/shipping.mjs';\nimport {exportRow} from '../src/legacy/export.mjs';\ntest('hidden check', () => {\n  assert.equal(shippingFee(10000, 'jeju'), 8000);\n  assert.equal(shippingFee(60000, 'island'), 5000);\n  assert.equal(exportRow({total: 1, shipping: 1, status: 'received'}, 'jeju'), '1,1,4500,received');\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/shipping.mjs",
      "test/shipping.test.mjs",
      "test/order.test.mjs",
      "openwiki/concepts/shipping-policy.md"
    ]
  }
}
````

`eval/cases/C5-ambiguous-discount.json`

````json
{
  "id": "C5-ambiguous-discount",
  "title": "모호한 요청",
  "suite": "edit",
  "split": "dev",
  "corpus": "order-service",
  "request": "할인율 좀 올려 줘.",
  "stopAtQuestion": true,
  "expect": {
    "state": "waiting_input",
    "asked": true,
    "unchanged_except": []
  }
}
````

`eval/cases/D1-readme-vs-enterprise.json`

````json
{
  "id": "D1-readme-vs-enterprise",
  "title": "긴 문서 두 개 비교",
  "suite": "document",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "README.md와 ENTERPRISE.md를 비교해서, 각 문서가 안내하는 설치 명령과 기본 모델이 어떻게 다른지 알려줘.",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "npm install -g openwiki",
        "npm i -g openwiki"
      ],
      [
        "gpt-5.6-terra"
      ],
      [
        "openwiki-SDS-0.6.0.tgz"
      ],
      [
        "GLM-5.2-NVFP4"
      ]
    ],
    "retrieved": {
      "paths": [
        "README.md",
        "ENTERPRISE.md"
      ],
      "min": 2
    },
    "unchanged_except": []
  }
}
````

`eval/cases/D2-home-state-files.json`

````json
{
  "id": "D2-home-state-files",
  "title": "여러 문서에서 목록 수집",
  "suite": "document",
  "split": "holdout",
  "corpus": "openwiki-sds",
  "request": "위키 문서들을 기준으로, OpenWiki가 홈 디렉터리(~/.openwiki) 아래에 두는 파일을 용도별로 모두 정리해줘 (자격증명, 익명 설치 ID, 온보딩 설정, 개인 위키 지침, 커스텀 MCP 커넥터 설정, 하위 폴더).",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "install-id"
      ],
      [
        "onboarding.json"
      ],
      [
        "custom-mcp/config.json"
      ],
      [
        "conversation_history"
      ]
    ],
    "retrieved": {
      "paths": [
        "openwiki/operations/configuration.md",
        "openwiki/operations/telemetry.md",
        "openwiki/workflows/onboarding.md",
        "openwiki/integrations/connectors.md"
      ],
      "min": 2
    },
    "unchanged_except": []
  }
}
````

`eval/cases/D3-absent-proxy-setting.json`

````json
{
  "id": "D3-absent-proxy-setting",
  "title": "문서에 없는 내용",
  "suite": "document",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "README.md와 ENTERPRISE.md 기준으로, 회사 프록시 서버를 거쳐 모델 API를 호출하려면 어떤 환경 변수를 설정하라고 되어 있어?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "찾을 수 없",
        "찾지 못",
        "없습니다",
        "없어요",
        "없음",
        "없다",
        "지원하지 않",
        "제공하지 않",
        "다루지 않",
        "안내하지 않",
        "나와 있지 않",
        "언급하지 않",
        "언급이 없",
        "not found",
        "not covered",
        "no mention",
        "not mention"
      ]
    ],
    "answer_excludes": [
      "OPENWIKI_PROXY"
    ],
    "answer_flags": [
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY"
    ],
    "unchanged_except": []
  }
}
````

`eval/cases/K1-jeju-extra-fee.json`

````json
{
  "id": "K1-jeju-extra-fee",
  "title": "한국어 Wiki 단일 사실",
  "suite": "wiki",
  "split": "dev",
  "corpus": "order-service",
  "request": "제주 지역 주문은 배송비가 얼마나 더 붙어?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "4,500",
        "4500"
      ]
    ],
    "retrieved": {
      "paths": [
        "openwiki/concepts/shipping-policy.md",
        "src/shipping.mjs"
      ],
      "min": 1
    },
    "cited": {
      "paths": [
        "openwiki/concepts/shipping-policy.md",
        "src/shipping.mjs"
      ]
    },
    "unchanged_except": []
  }
}
````

`eval/cases/L1-condition-after-compaction.json`

````json
{
  "id": "L1-condition-after-compaction",
  "title": "압축 뒤 초기 조건 보존",
  "suite": "conversation",
  "split": "dev",
  "corpus": "order-service",
  "request": "이 작업에서는 src/legacy 폴더를 절대 수정하지 마. 금액은 항상 정수 원으로 다뤄 줘. 먼저 지금 배송 정책을 짧게 설명해 줘.",
  "followUps": [
    {
      "before": "아래는 어제 배송 정책 회의록이야. 배송과 관련해 결정한 내용만 정리해 줘.\n\n",
      "file": "texts/L1-meeting-notes.md"
    },
    "주문 상태가 바뀌는 순서와 취소할 수 있는 시점, 그리고 새 등급을 추가할 때의 기준도 위키에서 찾아서 설명해 줘.",
    "그럼 회의에서 결정한 대로 추가 요금을 코드에 반영해 줘."
  ],
  "approvals": [
    "patch"
  ],
  "modelLimits": {
    "contextLength": 28000
  },
  "expect": {
    "state": "review",
    "compacted": true,
    "files": [
      {
        "path": "src/legacy/export.mjs",
        "includes": [
          "LEGACY_REMOTE_EXTRA = 4500"
        ]
      }
    ],
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {shippingFee} from '../src/shipping.mjs';\nimport {exportRow} from '../src/legacy/export.mjs';\ntest('hidden check', () => {\n  assert.equal(shippingFee(10000, 'jeju'), 8500);\n  assert.equal(shippingFee(60000, 'island'), 5500);\n  assert.equal(shippingFee(49999, 'seoul'), 3000);\n  assert.equal(shippingFee(50000, 'seoul'), 0);\n  assert.equal(exportRow({total: 1, shipping: 1, status: 'received'}, 'jeju'), '1,1,4500,received');\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/shipping.mjs",
      "test/shipping.test.mjs",
      "test/order.test.mjs",
      "openwiki/concepts/shipping-policy.md"
    ]
  }
}
````

`eval/cases/L2-short-follow-up.json`

````json
{
  "id": "L2-short-follow-up",
  "title": "짧은 후속 요청",
  "suite": "conversation",
  "split": "holdout",
  "corpus": "order-service",
  "request": "무료 배송 기준을 70,000원으로 올리려고 해. 단, 검사 파일과 위키 문서는 내가 직접 고칠 테니 너는 고치지 마. 먼저 어느 파일의 무엇을 바꿔야 하는지만 알려 줘.",
  "followUps": [
    "좋아, 그대로 진행해 줘."
  ],
  "approvals": [
    "patch"
  ],
  "expect": {
    "state": "review",
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {shippingFee} from '../src/shipping.mjs';\ntest('hidden check', () => {\n  assert.equal(shippingFee(69999, 'seoul'), 3000);\n  assert.equal(shippingFee(70000, 'seoul'), 0);\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/shipping.mjs"
    ]
  }
}
````

`eval/cases/L3-user-correction.json`

````json
{
  "id": "L3-user-correction",
  "title": "사용자 정정",
  "suite": "conversation",
  "split": "dev",
  "corpus": "order-service",
  "request": "제주와 도서 지역 추가 요금을 5,000원으로 올려 줘.",
  "followUps": [
    "아니, 5,000원이 아니라 6,000원으로 해 줘."
  ],
  "approvals": [
    "patch"
  ],
  "expect": {
    "state": "review",
    "files": [
      {
        "path": "src/legacy/export.mjs",
        "includes": [
          "LEGACY_REMOTE_EXTRA = 4500"
        ]
      }
    ],
    "test": {
      "files": {
        "test/eval-hidden.test.mjs": "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {shippingFee} from '../src/shipping.mjs';\ntest('hidden check', () => {\n  assert.equal(shippingFee(10000, 'jeju'), 9000);\n  assert.equal(shippingFee(60000, 'island'), 6000);\n});\n"
      },
      "command": [
        "node",
        "--test",
        "test/eval-hidden.test.mjs"
      ]
    },
    "unchanged_except": [
      "src/shipping.mjs",
      "test/shipping.test.mjs",
      "test/order.test.mjs",
      "openwiki/concepts/shipping-policy.md"
    ]
  }
}
````

`eval/cases/S1-version-fallback.json`

````json
{
  "id": "S1-version-fallback",
  "title": "상수 값 찾기",
  "suite": "source",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "OpenWiki가 자기 package.json을 끝내 못 찾으면 버전 값으로 뭘 돌려줘? 상수 이름도 알려줘.",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "0.0.0-unknown"
      ],
      [
        "UNKNOWN_VERSION"
      ]
    ],
    "retrieved": {
      "paths": [
        "src/version.ts"
      ],
      "min": 1
    },
    "unchanged_except": []
  }
}
````

`eval/cases/S2-visualize-call-flow.json`

````json
{
  "id": "S2-visualize-call-flow",
  "title": "호출 흐름 추적",
  "suite": "source",
  "split": "holdout",
  "corpus": "openwiki-sds",
  "request": "`openwiki visualize openwiki --project-root .`로 서버를 띄운 뒤 `/api/nubi/v1/wiki/query`로 질문을 보내면, CLI 진입부터 실제 위키 검색 함수까지 호출 흐름이 어떻게 돼?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "runVisualizeCommand"
      ],
      [
        "runVisualizeServer"
      ],
      [
        "createNubiApi"
      ],
      [
        "retrieveWikiEvidence"
      ]
    ],
    "retrieved": {
      "paths": [
        "src/cli/runners.ts",
        "src/visualize/server.ts",
        "src/visualize/nubi.ts"
      ],
      "min": 2
    },
    "unchanged_except": []
  }
}
````

`eval/cases/S3-visualizer-doc-drift.json`

````json
{
  "id": "S3-visualizer-doc-drift",
  "title": "Wiki와 소스가 다른 곳",
  "suite": "source",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "위키에 있는 visualize 명령 설명(옵션과 서버 라우트)이 지금 코드랑 아직 맞아?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "--project-root",
        "projectRoot"
      ],
      [
        "/api/nubi/v1",
        "nubi",
        "누비"
      ]
    ],
    "retrieved": {
      "paths": [
        "openwiki/integrations/visualizer.md",
        "src/cli/commands.ts",
        "src/visualize/server.ts"
      ],
      "min": 2
    },
    "unchanged_except": []
  }
}
````

`eval/cases/W1-ngrok-default-port.json`

````json
{
  "id": "W1-ngrok-default-port",
  "title": "단일 쪽 사실",
  "suite": "wiki",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "Slack OAuth용으로 `openwiki ngrok start`를 실행할 때 포트를 따로 안 주면 기본 포트가 몇 번이야?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "53682"
      ]
    ],
    "retrieved": {
      "paths": [
        "openwiki/operations/cli-reference.md",
        "src/cli/commands.ts"
      ],
      "min": 1
    },
    "unchanged_except": []
  }
}
````

`eval/cases/W2-ci-schedule-telemetry.json`

````json
{
  "id": "W2-ci-schedule-telemetry",
  "title": "여러 쪽 종합",
  "suite": "wiki",
  "split": "holdout",
  "corpus": "openwiki-sds",
  "request": "GitHub Actions 예제로 위키 자동 갱신을 걸어두면 기본으로 언제 실행되고, 그런 CI 실행은 사용 통계에서 어떤 ID로 집계돼?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "0 8 * * *",
        "08:00",
        "8시",
        "8 AM"
      ],
      [
        "ci-github-actions"
      ]
    ],
    "answer_excludes": [
      "0 2 * * *"
    ],
    "retrieved": {
      "paths": [
        "openwiki/operations/ci-scheduling.md",
        "openwiki/operations/telemetry.md"
      ],
      "min": 2
    },
    "unchanged_except": []
  }
}
````

`eval/cases/W3-absent-confluence.json`

````json
{
  "id": "W3-absent-confluence",
  "title": "Wiki에 없는 내용",
  "suite": "wiki",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "OpenWiki의 Confluence 커넥터를 쓰려면 어떤 환경 변수에 토큰을 넣어야 해?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "찾을 수 없",
        "찾지 못",
        "없습니다",
        "없어요",
        "없음",
        "없다",
        "지원하지 않",
        "제공하지 않",
        "다루지 않",
        "안내하지 않",
        "나와 있지 않",
        "언급하지 않",
        "언급이 없",
        "not found",
        "not covered",
        "no mention",
        "not mention"
      ]
    ],
    "answer_excludes": [
      "OPENWIKI_CONFLUENCE_TOKEN",
      "CONFLUENCE_API_TOKEN",
      "OPENWIKI_CONFLUENCE_API_KEY",
      "CONFLUENCE_TOKEN"
    ],
    "unchanged_except": []
  }
}
````

`eval/cases/W4-stale-provider-list.json`

````json
{
  "id": "W4-stale-provider-list",
  "title": "뒤처진 내용",
  "suite": "wiki",
  "split": "dev",
  "corpus": "openwiki-sds",
  "request": "지금 OpenWiki에서 선택할 수 있는 모델 제공자는 몇 개야? 위키에 안 나오는 제공자가 있으면 같이 알려줘.",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "aipro"
      ],
      [
        "fabrix"
      ],
      [
        "re:(?<![\\d.\\-])17(?![\\d.\\-])",
        "seventeen",
        "열일곱"
      ]
    ],
    "retrieved": {
      "paths": [
        "src/config/constants.ts"
      ],
      "min": 1
    },
    "unchanged_except": []
  }
}
````

`eval/cases/W5-sleeping-mac-schedule.json`

````json
{
  "id": "W5-sleeping-mac-schedule",
  "title": "한국어 업무 표현",
  "suite": "wiki",
  "split": "holdout",
  "corpus": "openwiki-sds",
  "request": "맥북이 잠들어 있으면 예약해 둔 자료 수집이 안 돌 텐데, OpenWiki는 이걸 어떻게 해결해?",
  "expect": {
    "state": "review",
    "asked": false,
    "answer_includes": [
      [
        "pmset"
      ],
      [
        "reconcileOpenWikiPowerSchedule",
        "wake",
        "깨우",
        "깨워"
      ]
    ],
    "answer_excludes": [
      "caffeinate"
    ],
    "retrieved": {
      "paths": [
        "openwiki/operations/ci-scheduling.md"
      ],
      "min": 1
    },
    "unchanged_except": []
  }
}
````

- [ ] **Step 6: 통과 확인**

Run: `node --test tests/eval-cases.test.mjs`

Expected: `pass 7`, `fail 0`

`answer keys of question cases are supported by the corpus text`가 실패하면 `packages/openwiki`가 계획 작성 뒤 바뀐 것이다. 정답을 고치지 말고 멈춰서 실패한 과제와 문자열을 보고한다.

- [ ] **Step 7: 변경 파일 확인**

Run: `git status --short -- eval tests`

Expected: `eval/cases.mjs`, `eval/cases/` 아래 21개 파일, `tests/eval-cases.test.mjs`.

---

### Task 11: 실행기, 후보 식별, 비교

**Files:**
- Create: `eval/candidate.mjs`
- Create: `eval/run.mjs`
- Create: `eval/compare.mjs`
- Test: `tests/eval-run.test.mjs`

**Interfaces:**
- Consumes: Task 9의 `runCase`와 `EVALUATION_LIMITS`, Task 8의 `gradeCase`, Task 10의 `loadCases`, Task 6의 `corpusManifest`, Task 3의 `connectRelayProviders`와 `defaultSocketPath`
- Consumes: `disableHostedTracing(environment)` (`runtime/worker-environment.mjs`), `generated/source-inputs.json`
- Produces: `evaluate({providers, cases, trials?, outputDir, limits?, parent?, corpusDirectory?, candidate?, onResult?}) -> report`
- Produces: `REPORT_KIND`, `LIMITATIONS`
- Produces: `candidateIdentity({packageRoot?}) -> {hash, files}`
- Produces: `compareReports(before, after) -> comparison`, `renderComparison(comparison) -> string`

- [ ] **Step 1: 실패하는 검사 작성**

`tests/eval-run.test.mjs`

````js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate,REPORT_KIND} from '../eval/run.mjs';
import {compareReports,renderComparison} from '../eval/compare.mjs';
import {candidateIdentity} from '../eval/candidate.mjs';
import {pinCorpus} from '../eval/pin-corpus.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';

const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','eval','corpus-src','order-service');
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=(connected=true)=>()=>({connected,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096}]});
const plan={intent:{goal:'요청 처리',constraints:[],outcomes:['결과를 전달한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'결과 전달',expected_outcome:'결과를 전달한다',status:'pending'}]};
const usage={prompt_tokens:1000,completion_tokens:50,prompt_tokens_details:{cached_tokens:400}};
// Answers a question after one wiki search. `answer` maps the request to the final text.
const scripted=(answer,{connected=true,fail}={})=>({status:status(connected),dispose(){},async complete(messages){
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[],usage};
  if(messages[0].content.startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[],usage};
  const request=messages.find(message=>message.role==='user').content;
  if(fail?.(request))throw Object.assign(new Error('worker_disconnected'),{retryable:false});
  return messages.some(message=>message.role==='tool')?{content:answer(request),calls:[],usage}:{...call('wiki_query',{query:'배송 추가 요금'}),usage};
}});
const cases=[
  {id:'T1-first-case',title:'첫째',suite:'wiki',split:'dev',corpus:'order-service',request:'제주 추가 배송비가 얼마야?',followUps:[],expect:{state:'review',asked:false,answer_includes:[['4,500']],retrieved:{paths:['openwiki/concepts/shipping-policy.md'],min:1}}},
  {id:'T2-second-case',title:'둘째',suite:'wiki',split:'holdout',corpus:'order-service',request:'무료 배송 기준이 얼마야?',followUps:[],expect:{state:'review',asked:false,answer_includes:[['50,000']]}},
];
async function setup(t){
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-run-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const corpusDirectory=path.join(base,'pinned');await pinCorpus('order-service',{directory:corpusDirectory,corpora:{'order-service':{source,include:['.']}}});
  return {parent:base,corpusDirectory,candidate:{hash:'a'.repeat(64),files:1}};
}

test('a run writes a report, per-case records and totals by purpose',async t=>{
  const options=await setup(t),outputDir=path.join(options.parent,'out'),seen=[];
  const report=await evaluate({...options,outputDir,cases,providers:scripted(request=>request.includes('제주')?'제주 추가 요금은 4,500원입니다.':'무료 배송 기준은 60,000원입니다.'),onResult:result=>seen.push(result.id+':'+result.outcome)});
  assert.equal(report.kind,REPORT_KIND);assert.equal(report.model,'fixture');assert.equal(report.candidate.hash,'a'.repeat(64));
  assert.match(report.corpora['order-service'],/^[0-9a-f]{64}$/);assert.ok(report.limitations.length>=4);
  assert.deepEqual(seen,['T1-first-case:passed','T2-second-case:failed']);
  assert.deepEqual(report.results.map(result=>[result.outcome,result.falseCompletion]),[['passed',false],['failed',true]]);
  const {quality,cost,bySuite,bySplit}=report.summary;
  assert.deepEqual([quality.executed,quality.passed,quality.delivered,quality.falseCompletion,quality.retrievalCases,quality.retrievalReached],[2,1,2,1,1,1]);
  assert.equal(bySuite.wiki.total,2);assert.equal(bySplit.dev.passed,1);assert.equal(bySplit.holdout.failed,1);
  assert.equal(cost.modelCalls,8);assert.deepEqual(Object.keys(cost.byPurpose).sort(),['actor','planner','reviewer']);
  assert.equal(cost.byPurpose.actor.calls,4);assert.equal(cost.promptTokens,8000);assert.equal(cost.cacheShare,0.4);assert.ok(cost.fixedShare>0.5);
  assert.equal(cost.byTool.wiki_query.calls,2);
  assert.deepEqual((await readdir(outputDir)).sort(),['T1-first-case-t1','T2-second-case-t1','report.json']);
  assert.deepEqual((await readdir(path.join(outputDir,'T1-first-case-t1'))).sort(),['metrics.json','result.json','transcript.jsonl']);
  const saved=JSON.parse(await readFile(path.join(outputDir,'T1-first-case-t1','result.json'),'utf8'));
  assert.match(saved.answer,/4,500원/);
  const lines=(await readFile(path.join(outputDir,'T1-first-case-t1','transcript.jsonl'),'utf8')).trim().split('\n');assert.equal(lines.length,4);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDir,'report.json'),'utf8')).summary.quality,quality);
  assert.ok(!JSON.stringify(report).includes('4,500원입니다'),'the report holds no answer text; per-case records do');
});

test('a missing model session leaves every case not run',async t=>{
  const options=await setup(t),report=await evaluate({...options,outputDir:path.join(options.parent,'out'),cases,providers:scripted(()=>'',{connected:false})});
  assert.deepEqual(report.results.map(result=>[result.outcome,result.reason]),[['not_run','model_session_not_connected'],['not_run','model_session_not_connected']]);
  assert.equal(report.summary.quality.executed,0);assert.equal(report.summary.bySuite.wiki.not_run,2);assert.equal(report.summary.cost.modelCalls,0);
});

test('a session lost during a case ends it as an error and the rest are not run',async t=>{
  const options=await setup(t),report=await evaluate({...options,outputDir:path.join(options.parent,'out'),cases,providers:scripted(()=>'',{fail:request=>request.includes('제주')})});
  assert.deepEqual(report.results.map(result=>[result.outcome,result.error||result.reason]),[['error','worker_disconnected'],['not_run','model_session_lost']]);
});

test('repeated trials are separate results and invalid arguments are refused',async t=>{
  const options=await setup(t),report=await evaluate({...options,outputDir:path.join(options.parent,'out'),cases:[cases[0]],trials:2,providers:scripted(()=>'제주 추가 요금은 4,500원입니다.')});
  assert.deepEqual(report.results.map(result=>result.trial),[1,2]);
  await assert.rejects(evaluate({...options,outputDir:path.join(options.parent,'out'),cases:[],providers:scripted(()=>'')}),/cases_required/);
  await assert.rejects(evaluate({...options,outputDir:path.join(options.parent,'out'),cases,trials:0,providers:scripted(()=>'')}),/invalid_trials/);
  await assert.rejects(evaluate({...options,cases,providers:scripted(()=>'')}),/output_directory_required/);
});

test('two reports of one model and corpus are compared case by case and by purpose',async t=>{
  const options=await setup(t);
  const before=await evaluate({...options,outputDir:path.join(options.parent,'before'),cases,providers:scripted(()=>'무료 배송 기준은 50,000원입니다.')});
  const after=await evaluate({...options,candidate:{hash:'b'.repeat(64),files:1},outputDir:path.join(options.parent,'after'),cases,providers:scripted(request=>request.includes('제주')?'제주 추가 요금은 4,500원입니다.':'무료 배송 기준은 50,000원입니다.')});
  const comparison=compareReports(before,after);
  assert.equal(comparison.sameCandidate,false);
  assert.deepEqual(comparison.cases.map(item=>[item.id,item.before,item.after,item.changed]),[['T1-first-case','failed','passed',true],['T2-second-case','passed','passed',false]]);
  assert.deepEqual(comparison.purposes.map(item=>item.purpose),['actor','planner','reviewer']);
  const text=renderComparison(comparison);
  assert.match(text,/\| 독립 통과 \| 1 \| 2 \| \+1 \|/);assert.match(text,/\*\*passed\*\*/);assert.match(text,/우열을 입증하지 않습니다/);assert.ok(!text.includes('·'));
  assert.equal(compareReports(before,before).sameCandidate,true);
  assert.throws(()=>compareReports(before,{...after,model:'other'}),/report_model_differs/);
  assert.throws(()=>compareReports(before,{...after,corpora:{'order-service':'0'.repeat(64)}}),/report_corpus_differs/);
  assert.throws(()=>compareReports({kind:'other'},after),/report_invalid/);
});

test('the candidate identity changes with a runtime file and refuses a stale build record',async t=>{
  const packageRoot=await mkdtemp(path.join(os.tmpdir(),'nubi-candidate-'));t.after(()=>rm(packageRoot,{recursive:true,force:true}));
  await mkdir(path.join(packageRoot,'runtime'));await mkdir(path.join(packageRoot,'generated'));await mkdir(path.join(packageRoot,'shared'));
  await writeFile(path.join(packageRoot,'runtime','agent.mjs'),'one');await writeFile(path.join(packageRoot,'runtime','notes.txt'),'ignored');await writeFile(path.join(packageRoot,'shared','core.js'),'core');
  await assert.rejects(candidateIdentity({packageRoot}),/candidate_inputs_missing/);
  await writeFile(path.join(packageRoot,'generated','source-inputs.json'),JSON.stringify(['shared/core.js','runtime/agent.mjs']));
  const first=await candidateIdentity({packageRoot});assert.equal(first.files,2);assert.match(first.hash,/^[0-9a-f]{64}$/);
  assert.deepEqual(await candidateIdentity({packageRoot}),first);
  await writeFile(path.join(packageRoot,'runtime','new-module.mjs'),'new');
  const second=await candidateIdentity({packageRoot});assert.equal(second.files,3,'a runtime module missing from the build record is still included');assert.notEqual(second.hash,first.hash);
  await writeFile(path.join(packageRoot,'shared','core.js'),'changed');assert.notEqual((await candidateIdentity({packageRoot})).hash,second.hash);
  await writeFile(path.join(packageRoot,'generated','source-inputs.json'),JSON.stringify(['shared/removed.js']));
  await assert.rejects(candidateIdentity({packageRoot}),/candidate_inputs_stale/);
});
````

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/eval-run.test.mjs`

Expected: FAIL. `Cannot find module '.../eval/run.mjs'`

- [ ] **Step 3: 구현**

`eval/candidate.mjs`

````js
// Identifies the source under evaluation, so two reports can tell "same
// candidate measured twice" from "changed candidate". It hashes the files the
// runtime bundle reads (recorded by the build) plus every runtime module.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PACKAGE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function candidateIdentity({packageRoot=PACKAGE_ROOT}={}){
  let inputs;
  try{inputs=JSON.parse(await readFile(path.join(packageRoot,'generated','source-inputs.json'),'utf8'));}catch{throw new Error('candidate_inputs_missing');}
  if(!Array.isArray(inputs)||inputs.some(item=>typeof item!=='string'))throw new Error('candidate_inputs_invalid');
  const runtime=(await readdir(path.join(packageRoot,'runtime'))).filter(name=>/\.(mjs|ts)$/.test(name)).map(name=>'runtime/'+name);
  const files=[...new Set([...inputs,...runtime])].sort(),hash=createHash('sha256');
  for(const file of files){
    let content;
    // A listed file that no longer exists means the build record is out of date.
    try{content=await readFile(path.resolve(packageRoot,file));}catch{throw new Error('candidate_inputs_stale');}
    hash.update(file).update('\0').update(createHash('sha256').update(content).digest('hex')).update('\n');
  }
  return {hash:hash.digest('hex'),files:files.length};
}
````

`eval/run.mjs`

````js
// Runs evaluation cases against the real Desktop service with a real model and
// grades observable results. Nothing measured here is company-repository,
// enterprise-model or Windows evidence: see LIMITATIONS.
import {disableHostedTracing} from '../runtime/worker-environment.mjs';
disableHostedTracing(process.env);
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const {runCase,EVALUATION_LIMITS}=await import('./driver.mjs');
const {gradeCase}=await import('./grade.mjs');
const {loadCases}=await import('./cases.mjs');
const {corpusManifest}=await import('./corpus.mjs');
const {candidateIdentity}=await import('./candidate.mjs');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const REPORT_KIND='desktop-live-model-evaluation';
export const LIMITATIONS=Object.freeze([
  'The model is the one named in this report. It is not the enterprise Qwen 3.8 27B baseline and says nothing about its accuracy.',
  'The corpora are a public open-source project and a synthetic project. They do not establish accuracy on company repositories or company wikis.',
  'Windows app control is not measured.',
  'The case set is small. Differences between two reports are observations, not statistically established improvements.',
  'Substring grading can miss a correct answer in unexpected wording. needs_review and invalid outcomes are never counted as passed.',
]);
const OUTCOMES=['passed','failed','needs_review','needs_human','invalid','error','not_run'];
const add=(target,key,value)=>{target[key]=(target[key]||0)+(value||0);};

function summarize(results){
  const tally=()=>Object.fromEntries([['total',0],...OUTCOMES.map(name=>[name,0])]),bySuite={},bySplit={};
  const quality={total:results.length,executed:0,passed:0,delivered:0,falseCompletion:0,unnecessaryQuestion:0,missedQuestion:0,retrievalCases:0,retrievalReached:0,citationCases:0,citationFound:0};
  const cost={modelCalls:0,retries:0,toolCalls:0,compactions:0,elapsedMs:0,promptTokens:0,completionTokens:0,cachedTokens:0,estimatedTokens:0,measuredEstimatedTokens:0,requestCharacters:0,fixedCharacters:0,peakRequestCharacters:0,byPurpose:{},byTool:{}};
  for(const result of results){
    for(const group of [bySuite[result.suite]??=tally(),bySplit[result.split]??=tally()]){group.total++;group[result.outcome]++;}
    if(result.outcome==='not_run')continue;
    quality.executed++;if(result.outcome==='passed')quality.passed++;
    if(result.state==='review'&&result.answerCharacters>0)quality.delivered++;
    if(result.falseCompletion)quality.falseCompletion++;
    if(result.expectedAsked===false&&result.asked)quality.unnecessaryQuestion++;
    if(result.expectedAsked===true&&!result.asked)quality.missedQuestion++;
    const retrieved=result.checks.find(item=>item.name==='retrieved'),cited=result.checks.find(item=>item.name==='cited');
    if(retrieved){quality.retrievalCases++;if(retrieved.passed)quality.retrievalReached++;}
    if(cited){quality.citationCases++;if(cited.passed)quality.citationFound++;}
    const metrics=result.metrics;if(!metrics)continue;
    for(const key of ['modelCalls','retries','toolCalls','compactions','elapsedMs','promptTokens','completionTokens','cachedTokens','estimatedTokens','measuredEstimatedTokens','requestCharacters','fixedCharacters'])add(cost,key,metrics[key]);
    cost.peakRequestCharacters=Math.max(cost.peakRequestCharacters,metrics.peakRequestCharacters||0);
    for(const [kind,groups] of [['byPurpose',metrics.byPurpose],['byTool',metrics.byTool]])for(const [name,row] of Object.entries(groups||{})){const target=cost[kind][name]??={};for(const [key,value] of Object.entries(row))add(target,key,value);}
  }
  cost.fixedShare=cost.requestCharacters?cost.fixedCharacters/cost.requestCharacters:null;
  cost.cacheShare=cost.promptTokens?cost.cachedTokens/cost.promptTokens:null;
  cost.estimateRatio=cost.measuredEstimatedTokens?cost.promptTokens/cost.measuredEstimatedTokens:null;
  return {bySuite,bySplit,quality,cost};
}

export async function evaluate({providers,cases,trials=1,outputDir,limits=EVALUATION_LIMITS,parent,corpusDirectory,candidate,onResult=()=>{}}){
  if(!Array.isArray(cases)||!cases.length)throw new Error('cases_required');
  if(!Number.isInteger(trials)||trials<1||trials>10)throw new Error('invalid_trials');
  if(typeof outputDir!=='string'||!outputDir)throw new Error('output_directory_required');
  await mkdir(outputDir,{recursive:true});
  const status=providers.status(),corpora={};
  for(const name of new Set(cases.map(item=>item.corpus)))corpora[name]=(await corpusManifest(name,corpusDirectory)).hash;
  const report={kind:REPORT_KIND,schema:1,runId:randomUUID(),provider:status.provider,model:status.model,candidate:candidate||await candidateIdentity(),corpora,limits:{...EVALUATION_LIMITS,...limits},trials,startedAt:new Date().toISOString(),results:[],limitations:LIMITATIONS};
  // A missing or lost model session is "not run": it must not look like a model failure.
  let stopped=status.connected===true?null:'model_session_not_connected';
  for(const testCase of cases)for(let trial=1;trial<=trials;trial++){
    const name=`${testCase.id}-t${trial}`,common={id:testCase.id,title:testCase.title,suite:testCase.suite,split:testCase.split,corpus:testCase.corpus,trial,expectedAsked:testCase.expect.asked??null};
    if(stopped){const skipped={...common,outcome:'not_run',passed:false,reason:stopped,checks:[],falseCompletion:false};report.results.push(skipped);onResult(skipped);continue;}
    const run=await runCase({testCase,providers,limits,parent,corpusDirectory});
    let graded;
    try{graded=await gradeCase(testCase,run);}catch{graded={outcome:'error',passed:false,checks:[],error:'grading_failed',falseCompletion:false};}
    finally{await run.dispose().catch(()=>{});}
    const result={...common,outcome:graded.outcome,passed:graded.passed,...(graded.error?{error:graded.error}:{}),...(graded.flagged?{flagged:graded.flagged}:{}),falseCompletion:graded.falseCompletion,checks:graded.checks,
      state:run.state,asked:run.asked,reviewStatus:run.reviewStatus,answerCharacters:run.answer.length,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,interactions:run.interactions,metrics:run.metrics.summary};
    const directory=path.join(outputDir,name);await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'transcript.jsonl'),run.transcript.map(entry=>JSON.stringify(entry)).join('\n')+(run.transcript.length?'\n':''));
    await writeFile(path.join(directory,'metrics.json'),JSON.stringify(run.metrics,null,2)+'\n');
    await writeFile(path.join(directory,'result.json'),JSON.stringify({...result,request:testCase.request,followUps:testCase.followUps,answer:run.answer,user:run.user},null,2)+'\n');
    report.results.push(result);onResult(result);
    if(run.error==='worker_disconnected')stopped='model_session_lost';
  }
  report.summary=summarize(report.results);report.finishedAt=new Date().toISOString();
  await writeFile(path.join(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
  const {connectRelayProviders,defaultSocketPath}=await import('./relay.mjs');
  const split=option('split'),cases=await loadCases({ids:option('cases')?.split(','),suites:option('suites')?.split(','),...(split&&split!=='all'?{split}:{})});
  if(!cases.length){console.error('조건에 맞는 과제가 없습니다.');process.exit(2);}
  const outputDir=path.resolve(option('out')||path.join(root,'verification','eval-live',new Date().toISOString().replace(/[:.]/g,'-')));
  let providers;
  try{providers=await connectRelayProviders({socketPath:option('socket')||defaultSocketPath()});}
  catch{console.error('모델 세션에 연결하지 못했습니다. 먼저 다른 터미널에서 node eval/model-session.mjs 를 실행하고 로그인해 주세요.');process.exit(2);}
  try{
    const report=await evaluate({providers,cases,trials:Number(option('trials')||1),outputDir,
      onResult:result=>console.log([result.outcome.padEnd(12),result.id.padEnd(30),'모델 호출 '+String(result.modelCalls??0).padStart(3),Math.round((result.elapsedMs||0)/1000)+'초',result.error||result.reason||''].join(' '))});
    const {quality,cost}=report.summary;
    console.log(JSON.stringify({model:report.model,candidate:report.candidate.hash.slice(0,12),passed:`${quality.passed}/${quality.executed}`,falseCompletion:quality.falseCompletion,modelCalls:cost.modelCalls,promptTokens:cost.promptTokens,fixedShare:cost.fixedShare,report:path.join(outputDir,'report.json')},null,2));
    console.log('공개 자료와 합성 자료로 측정한 결과입니다. 사내 모델이나 회사 저장소의 성능이 아닙니다.');
  }finally{providers.dispose();}
}
````

`eval/compare.mjs`

````js
// Compares two evaluation reports case by case and cost by purpose:
//   node eval/compare.mjs <before>/report.json <after>/report.json
// It reports differences only. A small case set cannot establish that one
// candidate is better; read the per-case rows.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const KIND='desktop-live-model-evaluation';
const number=value=>Number.isFinite(value)?value:0;
const share=value=>value===null||value===undefined?'-':(value*100).toFixed(1)+'%';
const delta=(before,after)=>{const change=number(after)-number(before);return change===0?'0':(change>0?'+':'')+change;};

export function compareReports(before,after){
  for(const report of [before,after])if(report?.kind!==KIND||!Array.isArray(report.results))throw new Error('report_invalid');
  if(before.model!==after.model||before.provider!==after.provider)throw new Error('report_model_differs');
  const shared=Object.keys(before.corpora).filter(name=>name in after.corpora);
  if(shared.some(name=>before.corpora[name]!==after.corpora[name]))throw new Error('report_corpus_differs');
  const key=result=>result.id+'#'+result.trial,earlier=new Map(before.results.map(result=>[key(result),result]));
  const cases=after.results.filter(result=>earlier.has(key(result))).map(result=>{
    const old=earlier.get(key(result));
    return {id:result.id,trial:result.trial,suite:result.suite,split:result.split,before:old.outcome,after:result.outcome,changed:old.outcome!==result.outcome,
      modelCalls:[number(old.modelCalls),number(result.modelCalls)],promptTokens:[number(old.metrics?.promptTokens),number(result.metrics?.promptTokens)],elapsedMs:[number(old.elapsedMs),number(result.elapsedMs)]};
  });
  const purposes=[...new Set([...Object.keys(before.summary.cost.byPurpose),...Object.keys(after.summary.cost.byPurpose)])].sort().map(purpose=>{
    const old=before.summary.cost.byPurpose[purpose]||{},next=after.summary.cost.byPurpose[purpose]||{};
    return {purpose,calls:[number(old.calls),number(next.calls)],promptTokens:[number(old.promptTokens),number(next.promptTokens)],elapsedMs:[number(old.elapsedMs),number(next.elapsedMs)]};
  });
  return {model:after.model,sameCandidate:before.candidate.hash===after.candidate.hash,candidates:[before.candidate.hash,after.candidate.hash],
    onlyBefore:before.results.filter(result=>!after.results.some(other=>key(other)===key(result))).map(key),onlyAfter:after.results.filter(result=>!earlier.has(key(result))).map(key),
    quality:[before.summary.quality,after.summary.quality],fixedShare:[before.summary.cost.fixedShare,after.summary.cost.fixedShare],cacheShare:[before.summary.cost.cacheShare,after.summary.cost.cacheShare],cases,purposes};
}

export function renderComparison(comparison){
  const [before,after]=comparison.quality,row=cells=>'| '+cells.join(' | ')+' |',lines=[];
  lines.push('# 평가 비교','',`- 모델: ${comparison.model}`,`- 후보: ${comparison.candidates[0].slice(0,12)} → ${comparison.candidates[1].slice(0,12)}`+(comparison.sameCandidate?' (같은 후보의 반복 측정)':''),'');
  lines.push('## 품질','',row(['지표','이전','이후','차이']),row(['---','---:','---:','---:']));
  for(const [label,name] of [['실행한 과제','executed'],['독립 통과','passed'],['답변 전달','delivered'],['잘못된 완료','falseCompletion'],['불필요한 질문','unnecessaryQuestion'],['필요한 질문 누락','missedQuestion'],['정답 경로 도달','retrievalReached'],['정답 경로 인용','citationFound']])
    lines.push(row([label,before[name],after[name],delta(before[name],after[name])]));
  lines.push('','## 비용','',row(['목적','호출 이전','호출 이후','입력 토큰 이전','입력 토큰 이후','입력 토큰 차이']),row(['---','---:','---:','---:','---:','---:']));
  for(const item of comparison.purposes)lines.push(row([item.purpose,...item.calls,...item.promptTokens,delta(...item.promptTokens)]));
  lines.push('',`- 고정 비용 비중: ${share(comparison.fixedShare[0])} → ${share(comparison.fixedShare[1])}`,`- 캐시 비율: ${share(comparison.cacheShare[0])} → ${share(comparison.cacheShare[1])}`,'');
  lines.push('## 과제별','',row(['과제','묶음','구분','이전','이후','모델 호출','입력 토큰']),row(['---','---','---','---','---','---:','---:']));
  for(const item of comparison.cases)lines.push(row([item.id+(item.trial>1?' #'+item.trial:''),item.suite,item.split,item.before,(item.changed?'**'+item.after+'**':item.after),item.modelCalls.join(' → '),item.promptTokens.join(' → ')]));
  if(comparison.onlyBefore.length||comparison.onlyAfter.length)lines.push('',`- 한쪽에만 있는 과제: 이전 ${comparison.onlyBefore.join(', ')||'없음'}, 이후 ${comparison.onlyAfter.join(', ')||'없음'}`);
  lines.push('','과제 수가 적습니다. 이 표는 차이를 보여줄 뿐 우열을 입증하지 않습니다. 사내 모델이나 회사 저장소의 성능이 아닙니다.','');
  return lines.join('\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [first,second]=process.argv.slice(2);
  if(!first||!second){console.error('사용법: node eval/compare.mjs <이전 report.json> <이후 report.json>');process.exit(2);}
  try{console.log(renderComparison(compareReports(JSON.parse(await readFile(first,'utf8')),JSON.parse(await readFile(second,'utf8')))));}
  catch(error){console.error(({report_model_differs:'두 보고서의 모델이 다릅니다. 비교하지 않습니다.',report_corpus_differs:'두 보고서의 자료가 다릅니다. 비교하지 않습니다.',report_invalid:'평가 보고서 형식이 아닙니다.'})[error.message]||'보고서를 읽지 못했습니다.');process.exit(1);}
}
````

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/eval-run.test.mjs`

Expected: `pass 6`, `fail 0`

- [ ] **Step 5: 변경 파일 확인**

Run: `git status --short -- .`

Expected: 이 Task의 파일만 새로 생기거나 바뀐다.

---

### Task 12: 문서

**Files:**
- Create: `eval/README.md`
- Create: `docs/LIVE-EVAL.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Produces: 실행 방법, 결과 읽는 법, 검증 범위와 한계

- [ ] **Step 1: 평가 안내 작성**

`eval/README.md`

````markdown
# 누비 workspace 실측 평가

실제 모델로 고정 과제를 돌리고 관찰한 결과만으로 채점한다. 제품 번들에 포함하지 않는다.

## 실행

터미널 두 개를 쓴다. 첫째 터미널은 로그인을 유지하고, 둘째 터미널에서 평가를 반복 실행한다.

```bash
# 첫째 터미널: 브라우저에서 로그인한다. READY가 나오면 그대로 둔다.
node eval/model-session.mjs --provider chatgpt --model gpt-5.6-luna
```

```bash
# 둘째 터미널: 개발용 과제 전체
node eval/run.mjs --split dev
```

| 옵션 | 뜻 | 기본값 |
|---|---|---|
| `--cases W1-ngrok-default-port,C2-free-shipping-threshold` | 실행할 과제 | 전체 |
| `--suites wiki,edit` | 실행할 묶음 | 전체 |
| `--split dev` | `dev`, `holdout`, `all` | `all` |
| `--trials 3` | 과제당 반복 횟수 | 1 |
| `--out <폴더>` | 결과 폴더 | `verification/eval-live/<시각>` |
| `--socket <경로>` | 모델 세션 소켓 | 사용자별 임시 폴더 |

두 보고서를 비교한다.

```bash
node eval/compare.mjs <이전>/report.json <이후>/report.json
```

## 결과 읽기

| 결과 | 뜻 | 통과로 셈 |
|---|---|---|
| `passed` | 모든 검사 통과 | 예 |
| `failed` | 검사 하나 이상 실패 | 아니오 |
| `needs_review` | 검사는 통과했으나 사람이 확인해야 함 | 아니오 |
| `needs_human` | 과제가 정의하지 않은 질문이나 대기가 발생 | 아니오 |
| `invalid` | 과제의 전제가 성립하지 않음. 예: 압축이 일어나지 않음 | 아니오 |
| `error` | 한도 초과, 세션 끊김, 실행 오류 | 아니오 |
| `not_run` | 모델 세션이 없어 실행하지 않음 | 집계에서 제외 |

과제별 폴더의 `result.json`에 답변과 검사 결과가, `transcript.jsonl`에 모델 호출 전체가, `metrics.json`에 계측이 있다.

## 과제 추가

1. `eval/cases/<ID>.json`을 만든다. 파일 이름은 `id`와 같아야 한다.
2. 정답의 근거를 자료 원문에서 직접 확인한다. 추측한 정답을 넣지 않는다.
3. `node --test tests/eval-cases.test.mjs`로 형식과 정답 경로를 검사한다.
4. 개발용과 보류용의 비율을 유지한다. 보류용 결과를 보고 하네스를 조정하지 않는다.

## 자료 다시 고정

```bash
node eval/pin-corpus.mjs openwiki-sds order-service
```

자료 해시가 바뀐다. 그 자료를 쓰는 모든 과제의 정답을 원문과 다시 대조한다. 이전 보고서와는 비교할 수 없다.

## 하지 말 것

- 회사 저장소나 회사 문서를 자료로 등록하지 않는다. 모델 호출 전체를 파일로 남기기 때문이다.
- 검사를 통과시키려고 정답이나 한도를 고치지 않는다.
- 모델의 완료 선언이나 검토 결과를 통과 근거로 쓰지 않는다.

범위와 근거의 경계는 [실측 평가 문서](../docs/LIVE-EVAL.md)를 따른다.
````

- [ ] **Step 2: 범위 문서 작성**

`docs/LIVE-EVAL.md`

````markdown
# 실측 평가와 계측

누비 workspace의 품질과 비용을 실제 모델로 측정하는 틀이다. 설계는 `docs/superpowers/specs/2026-09-29-nubi-desktop-live-eval-design.md`, 실행 방법은 [eval/README.md](../eval/README.md)를 따른다.

## 구성

| 부분 | 위치 | 제품 포함 |
|---|---|---|
| 계측 | `runtime/run-metrics.mjs`, `runtime/recovery.mjs`, `runtime/agent.mjs` | 예 |
| 평가 실행기 | `eval/` | 아니오 |
| 과제와 정답 | `eval/cases/` | 아니오 |
| 고정 자료 | `eval/corpus/` | 아니오 |

## 계측이 남기는 것

기존 SQLite `events` 표에 세 종류를 남긴다.

| 종류 | 내용 |
|---|---|
| `metric_model` | 호출 목적, 시도 번호, 요청 크기, 추정 토큰, 실제 사용량, 지연, 종료 사유, 호출한 도구 이름 |
| `metric_tool` | 도구 이름, 주 실행기와 하위 분석의 구분, 지연, 결과 크기, 이미지 수, 오류 코드 |
| `metric_compaction` | 압축 원인, 전후 추정 토큰 |

대화 본문, 도구 인자, 도구 결과 내용은 저장하지 않는다. 오류는 정해진 형식의 코드만 남긴다. 30일이 지난 계측은 다음 실행을 시작할 때 지운다. 기록에 실패해도 실행은 계속한다.

호출 목적은 `actor, planner, reviewer, summary, analysis, document`다. 호출 지점이 직접 표시한다.

## 지표

| 지표 | 계산 |
|---|---|
| 독립 통과 | 결과가 `passed`인 과제 수 |
| 답변 전달 | 작업이 `review`에 도달하고 답변이 있는 과제 수 |
| 잘못된 완료 | 작업이 `review`이고 검토가 `ready`인데 채점이 실패한 과제 수 |
| 불필요한 질문 | 질문하지 않아야 하는 과제에서 질문한 수 |
| 필요한 질문 누락 | 질문해야 하는 과제에서 질문하지 않은 수 |
| 고정 비용 비중 | 시스템 안내와 도구 정의의 글자 수를 전체 요청 글자 수로 나눈 값 |
| 캐시 비율 | 캐시 토큰을 입력 토큰으로 나눈 값 |
| 추정 오차 | 실제 입력 토큰을 추정 토큰으로 나눈 값. 사용량을 받은 호출만 계산 |

단일 가중 점수는 만들지 않는다.

## 검증 범위

| 검증 | 상태 |
|---|---|
| 계측과 평가 실행기의 계약 | 합성 모델 검사 63개 통과 |
| 과제 정답 | 인용을 원문에서 확인. 자료가 정답을 뒷받침하는지 검사로 고정 |
| 실모델 기준선 | 미측정 |
| 사내 Qwen 3.8 27B | 미측정 |
| 회사 저장소와 회사 Wiki | 범위 밖 |
| Windows 앱 조작 | 범위 밖 |

## 한계

- 문자열 검사는 예상하지 못한 표현의 정답을 놓칠 수 있다. 실패한 과제는 `result.json`의 답변을 직접 읽어 확인한다.
- 과제가 20개다. 두 보고서의 차이는 관찰이며 우열의 입증이 아니다.
- 압축 과제는 모델의 문맥 한도를 28,000 토큰으로 낮춘 조건이다. 실제 사내 모델의 한도와 다르다.
- 합성 자료에는 Claims가 없다. 검색 결과는 항상 미검증으로 표시된다.
- 새 Git 저장소로 시작하므로 Wiki 생성 커밋이 작업 공간에 없다. 커밋 기준 최신성은 측정하지 않는다.
````

- [ ] **Step 3: AGENTS.md에 규칙 추가**

`AGENTS.md`의 맨 끝에 빈 줄 하나와 아래 단락을 추가한다. 기존 내용은 바꾸지 않는다.

````markdown
- 실측 평가는 `eval/`의 전용 실행기와 `runtime/run-metrics.mjs`의 계측을 쓴다. 계측은 크기, 횟수, 정해진 형식의 코드만 저장한다. 본문, 도구 인자, 도구 결과 내용은 저장하지 않으며 기록 실패로 실행을 멈추지 않는다. 호출 목적은 호출 지점이 표시하고 프롬프트 내용으로 추측하지 않는다. 평가는 등록한 공개 자료와 합성 자료의 이름만 받으며 회사 저장소에 쓰지 않는다. 모의 사용자는 과제가 정의한 질문과 제안 반영만 처리하고 명령, 설정, 관리자 실행, 컴퓨터 동작을 승인하지 않는다. 모델의 완료 선언과 검토 ready는 점수가 아니다. 검사를 통과시키려고 정답, 한도, 과제를 고치지 않는다. 합성 모델 검사, 실모델 측정, 사내 모델과 회사 저장소의 성능을 구분한다. 범위와 명령은 docs/LIVE-EVAL.md를 따른다.
````

- [ ] **Step 4: README.md에 절 추가**

`README.md`의 맨 끝에 빈 줄 하나와 아래 절을 추가한다.

````markdown
## 실측 평가

실제 모델로 고정 과제를 돌려 품질과 비용을 측정합니다. 로그인은 별도 터미널의 모델 세션이 유지합니다.

```bash
node eval/model-session.mjs
node eval/run.mjs --split dev
node eval/compare.mjs <이전>/report.json <이후>/report.json
```

결과는 gitignore된 `verification/eval-live/`에 생성합니다. 공개 자료와 합성 자료로 측정한 값이며 사내 모델이나 회사 저장소의 성능이 아닙니다. 범위는 [실측 평가 문서](docs/LIVE-EVAL.md)를 따릅니다.
````

- [ ] **Step 5: 문구 확인**

Run: `grep -n "·" eval/README.md docs/LIVE-EVAL.md`

Expected: 출력 없음.

---

### Task 13: 전체 확인과 기준선 측정

**Files:**
- Modify: `docs/LIVE-EVAL.md` (측정 결과 기록)
- Create: `verification/eval-live/baseline-B0/` (gitignore)

**Interfaces:**
- Consumes: 모든 Task
- Produces: 기준선 보고서. 둘째 하위 과제(OpenWiki 검색과 최신성)의 입력

- [ ] **Step 1: 전체 검사**

Run: `npm test`

Expected: `tests 365`, `pass 364`, `fail 1`. 실패는 Global Constraints에 적은 기존 실패 하나뿐이다.

- [ ] **Step 2: 빌드 기록 갱신**

Run: `npm run compile`

Expected: 오류 없이 끝나고 `generated/source-inputs.json`에 `runtime/run-metrics.mjs`가 들어간다.

```bash
grep -c "runtime/run-metrics.mjs" generated/source-inputs.json
```

Expected: `1`

- [ ] **Step 3: 합성 모델로 명령줄 확인**

실제 모델 없이 실행기가 끝까지 도는지 확인한다. 모델 세션이 없는 상태에서 실행한다.

Run: `node eval/run.mjs --cases K1-jeju-extra-fee`

Expected: `모델 세션에 연결하지 못했습니다.`로 시작하는 안내와 종료 코드 2. 처리되지 않은 오류가 나오면 Task 3의 `relay.mjs`를 다시 확인한다.

- [ ] **Step 4: 사람 확인 지점: 구현 보고**

여기서 멈추고 사용자에게 보고한다. 보고 내용: 새 검사 수와 결과, 전체 검사 결과, 바뀐 파일 목록, 두 자료의 해시, 계획과 다르게 구현한 부분. 사용자의 확인을 받은 뒤 다음 단계로 간다.

- [ ] **Step 5: 실모델 기준선 측정**

사용자가 브라우저에서 직접 로그인해야 한다.

```bash
# 첫째 터미널
node eval/model-session.mjs --provider chatgpt --model gpt-5.6-luna
```

`READY`가 나온 뒤 둘째 터미널에서 실행한다.

```bash
node eval/run.mjs --split all --out verification/eval-live/baseline-B0
```

Expected: 과제 20개의 결과 줄과 요약. 실행 시간은 과제당 1분에서 10분이다.

- [ ] **Step 6: 결과 확인과 기록**

1. `failed`와 `needs_review` 과제는 `result.json`의 답변을 직접 읽는다. 채점 문자열이 올바른 답을 놓친 경우와 실제 오답을 구분한다.
2. 결과가 갈릴 만한 과제는 `--cases <ID> --trials 3`으로 다시 실행한다.
3. 설계 7절의 실패 유형으로 분류한다.
4. `docs/LIVE-EVAL.md`의 검증 범위 표에서 실모델 기준선 행을 측정 결과로 바꾸고, 후보 해시, 모델, 측정 날짜, 묶음별 통과 수, 목적별 호출 수와 입력 토큰, 고정 비용 비중을 적는다.
5. 채점 문자열이 올바른 답을 놓친 과제는 고치지 말고 목록으로 보고한다. 정답 변경은 사용자 확인 뒤에 한다.

---

## Self-Review

| 설계 | Task |
|---|---|
| 4.1 제품 계측 | 1, 2 |
| 4.2 모델 세션 | 3 |
| 4.3 자료와 작업 공간 | 5, 6 |
| 4.4 모의 사용자 | 7 |
| 4.5 구동과 한도 | 4 (호출 한도), 9 |
| 4.6 채점 | 8 |
| 4.7 보고서 | 11 |
| 5 과제 묶음 | 10 |
| 6 지표 | 1 (합계), 11 (보고서 집계) |
| 7 개선 루프 | 13의 기준선까지. 개선은 기준선 뒤 별도 계획 |
| 8 오류 처리 | 3, 4, 6, 9, 11 |
| 9 검사 | 각 Task의 검사 |
| 10 하지 않는 것 | Global Constraints |
| 11 근거의 경계 | 11의 `LIMITATIONS`, 12의 문서 |

- 자리 표시 문구 없음. 모든 코드 단계에 전체 코드가 있다.
- 이름 확인: `createRunMetrics`, `readRunMetrics`, `recordingProviders`, `leaderToolResults`, `createWorkspace`, `changedPaths`, `createUser`, `applyProposals`, `gradeCase`, `mentions`, `runCase`, `loadCases`, `evaluate`, `candidateIdentity`, `compareReports`가 정의한 Task와 쓰는 Task에서 같은 이름과 인자를 쓴다.
- 설계와 다른 점 없음. 설계 문서는 검증 중 바뀐 내용을 반영해 갱신했다.
