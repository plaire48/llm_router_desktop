# 누비 Desktop 가벼운 흐름 계획 2a: CSS 다이어트

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화면 모양은 그대로 두고, 첫 화면에 실리는 CSS를 절반 아래로 줄이고 모든 요소가 검사해야 하는 규칙을 줄여, 화면을 처음 열 때의 스타일 계산을 조건 A에서 16ms 이하로 만든다.

**Architecture:** 먼저 CSS를 재는 보고 도구와 화면 픽셀 비교 도구를 정식으로 만든다. 그다음 효과가 큰 순서로 고친다. (1) 모든 요소가 검사하는 선택자(끝이 `:is()`, `*`, 속성뿐인 선택자)를 클래스로 추려지는 꼴로 바꾼다. (2) CX 디자인 시스템에서 Desktop이 쓰지 않는 규칙을 빌드 때 뺀다. (3) 같은 선택자에서 뒤 규칙에 덮여 죽은 선언을 지운다. (4) 화면 전용 CSS를 그 화면의 지연 묶음으로 옮긴다. 각 단계는 크기 보고, 117개 화면 픽셀 비교, 조건 A 측정으로 끝난다.

**Tech Stack:** esbuild(이미 씀, metafile), PostCSS(MIT, 빌드 때만 쓰는 개발 의존성으로 새로 추가), Playwright(Chrome headless), node:test.

**Spec:** `docs/superpowers/specs/2026-10-22-nubi-desktop-light-flow-design.md` §6(묶인 CSS 크기를 지금의 절반 아래로, 덮어쓰기 층 합치기, 스타일 계산 최대 16ms 이하, CX 패키지는 고치지 않고 Desktop 묶음에서 쓰지 않는 규칙을 뺀다). 계획 1 결과: `packages/nubi-desktop/docs/LIGHT-FLOW-BASELINE-2026-10-22.md`.

## Global Constraints

- 기준 커밋: main `44947b56`(계획 1). 별도 작업 트리에서 하고 업로드 스크립트로 올린다.
- 화면 결과는 바뀌지 않는다. 판정은 `scripts/compare-captures.mjs`(작업 0)로 한다. 잡음 기준을 넘는 차이가 하나라도 있으면 그 단계는 끝나지 않는다.
- CX 디자인 시스템 패키지(`@e2e/cx-design-system`) 파일은 고치지 않는다. 빼기는 Desktop 빌드 단계에서만 한다.
- `:has()`는 쓰지 않는다(계획 1 규칙). 새 상태가 필요하면 `ui/shell-state.mjs`를 쓴다.
- 시험, 한도, 정답을 통과용으로 고치지 않는다. 목표 수치는 설계 §6 그대로다.
- 사용자에게 보이는 글은 바뀌지 않는다(CSS 작업). 문서와 커밋은 한국어, 짧은 문장, 가운뎃점 없음.
- 새 의존성은 PostCSS 하나다. 개발 의존성으로만 두고 설치판 묶음에 들어가지 않는지 안전 회귀 검사로 확인한다.
- 공용 러너의 시간 수치는 기록만 한다. 시간 판정은 조건 A(로컬, `npm run test:light-flow`)에서 세 번 실행의 중앙값으로 한다.

## Review Focus

1. 규칙 순서가 바뀌는 단계(작업 4, 5)에서 같은 명시도의 두 규칙이 순서로 이기던 곳: 모양이 바뀐다. 픽셀 비교가 잡지 못하는 상태(hover, focus, 열린 메뉴, 오류 표시)는 상태별 캡처를 더해 본다.
2. CX 규칙 빼기(작업 3)에서 이름을 문자열로 이어 붙여 만드는 클래스(`'cx-button--'+tone` 같은 것): 쓰는 규칙이 빠져 모양이 깨진다. 접두사가 소스에 있으면 남긴다.
3. 지연 묶음으로 옮긴 CSS(작업 5): 화면을 처음 열 때 CSS가 늦게 붙어 한 번 깜박인다(스타일 없는 내용이 보임). 첫 열림 캡처를 CSS가 붙은 뒤가 아니라 첫 프레임에서 찍는다.
4. 다크 모드, 줄인 움직임, 큰 글씨(`data-large-text`) 같은 미디어와 속성 조건 아래 규칙: 기본 캡처에 안 나온다. 이 조건의 캡처를 비교 집합에 넣는다.
5. Windows의 다른 글꼴 렌더링: Mac 픽셀 비교만으로는 모른다. 설치판 후보는 Windows CI 화면 캡처와도 비교한다.

---

### Task 0: 재는 도구와 기준선

**Files:**
- Create: `scripts/css-report.mjs`, `scripts/compare-captures.mjs`, `tests/css-report.test.mjs`, `tests/compare-captures.test.mjs`
- Create: `docs/CSS-DIET-2026-10-23.md`
- Modify: `scripts/check-light-flow.mjs`(계획 1의 미룬 사소 3: 장면이 빠지면 실패, 세 번 실행 중앙값)

**Interfaces:**
- Produces: `selectorBuckets(css: string): {selectors:number, classKeyed:number, tagKeyed:number, idKeyed:number, universal:number, universalSamples:string[]}` — 선택자 목록마다 맨 끝 복합 선택자에서 의사 클래스와 괄호 안을 뺀 뒤, 클래스가 있으면 class, 태그면 tag, id면 id, 아무것도 없으면 universal로 센다. `:is(...)`, `:where(...)`, `:not(...)`만 있는 끝은 universal이다.
- Produces: `cssReport({metafile, outdir}): {mainBytes:number, chunkBytes:number, bySource:Record<string,number>, buckets:ReturnType<selectorBuckets>}` — esbuild metafile의 `outputs[*].inputs[*].bytesInOutput`으로 원본 파일별 바이트를 낸다.
- Produces: `compareCaptures(beforeDir, afterDir, {noise}): {compared:number, changed:{name:string, pixels:number}[]}` — 채널 차이 8 넘는 픽셀을 센다. `noise`는 `{default:20, animated:{'bird-hover.png':6000,'mail-flow-ai.png':6000,'mail-flow-reconnected.png':6000,'project-start-1280.png':600}}`(계획 1에서 실측한 실행 간 잡음).
- Produces: `judgeLightFlowRuns(runs: Row[][], {env, expected}): {pass, failures, unjudged?}` — 장면과 너비마다 세 실행의 중앙값으로 `judgeLightFlow`를 부른다. `expected`(장면×너비 목록, 꺼진 workflow 제외)에 빠진 행이 있으면 `'<장면>:<너비> missing'`으로 실패한다.

- [ ] **Step 1: 시험을 쓴다**

```js
test('rightmost :is(), *, attribute-only and :root are universal; a class anywhere in the last compound keys it',()=>{
 const b=selectorBuckets('.a :is(.b,.c){x:1} .a *{x:1} [role=tab]{x:1} :root{x:1} .a .b:hover{x:1} button{x:1} #i{x:1} .a > .b:is(.c){x:1}');
 assert.deepEqual([b.universal,b.classKeyed,b.tagKeyed,b.idKeyed],[4,2,1,1]);
});
test('a capture within noise passes and a real change is named',async()=>{
 // 두 폴더에 2x1 PNG를 쓴다: same.png는 같고, diff.png는 한 픽셀의 빨강 채널이 40 다르다.
 const result=await compareCaptures(before,after,{noise:{default:0,animated:{}}});
 assert.equal(result.compared,2);assert.deepEqual(result.changed,[{name:'diff.png',pixels:1}]);
 assert.deepEqual((await compareCaptures(before,after,{noise:{default:1,animated:{}}})).changed,[]);
});
test('light-flow takes the median of three runs and fails on a missing scene',()=>{
 const row=(m)=>({scene:'chat',width:1280,missedFrameRatio:m,longTasks:1,styleRecalcMaxMs:10});
 assert.equal(judgeLightFlowRuns([[row(0.02)],[row(0.09)],[row(0.03)]],{env:{},expected:['chat:1280']}).pass,true);
 assert.deepEqual(judgeLightFlowRuns([[row(0.02)]],{env:{},expected:['chat:1280','mail:1280']}).failures,['mail:1280 missing']);
});
```

- [ ] **Step 2:** Run: `node --test tests/css-report.test.mjs tests/compare-captures.test.mjs tests/light-flow.test.mjs` — Expected: FAIL(함수 없음).
- [ ] **Step 3:** 구현한다. `css-report.mjs`는 `rendererBundleOptions()`로 `metafile:true` 빌드를 하는 CLI(`node scripts/css-report.mjs --out <json>`)도 둔다. `compare-captures.mjs`는 계획 1의 일회용 비교기(Chrome 디코더로 픽셀 비교)를 정식으로 옮긴다. CLI: `node scripts/compare-captures.mjs <before> <after>`, 바뀐 것이 있으면 종료 코드 1. `check-light-flow.mjs`는 `--runs 3`(기본 3)으로 세 번 돌려 중앙값을 판정한다.
- [ ] **Step 4:** Run: 위 시험 — Expected: PASS.
- [ ] **Step 5: 기준선을 잰다.**
  - `node scripts/css-report.mjs --out verification/css-diet/baseline.json`
  - `node scripts/check-all-surfaces.mjs` 뒤 캡처를 `verification/css-diet/before/surfaces/`로 복사한다. 다크 모드, 줄인 움직임, 큰 글씨 캡처를 위해 `check-all-surfaces.mjs`에 `NUBI_SURFACE_SCHEME=dark`, `NUBI_SURFACE_REDUCED=1`, `NUBI_SURFACE_LARGE_TEXT=1` 환경 변수를 더하고(기본값은 지금과 같음) 각각 `before/dark`, `before/reduced`, `before/large`로 찍는다(Review Focus 4).
  - 상태 캡처(Review Focus 1): `check-shared-ui.mjs`가 찍는 캡처와 계획 1의 상태 왕복 캡처를 `before/states/`로 복사한다.
  - 같은 비교기로 기준선끼리 두 번 찍어 잡음이 noise 안인지 확인한다.
  - `npm run test:light-flow`(세 번) 중앙값을 기록한다.
  - `docs/CSS-DIET-2026-10-23.md`에 표로 적는다: 첫 묶음 바이트, 지연 묶음 바이트, 원본 파일별 상위 20개, 버킷 수(universal 701 기준), 조건 A 중앙값.
- [ ] **Step 6:** 커밋. `git commit -m "chore: CSS 다이어트 재는 도구와 기준선"`

### Task 1: 버킷 비용 실측과 바꾸는 꼴 정하기

**Files:**
- Create: `scripts/measure-selector-cost.mjs`
- Modify: `docs/CSS-DIET-2026-10-23.md`(결정 절)

**Interfaces:**
- Produces: 결정 한 줄 `REWRITE_FORM`을 문서에 적는다. 후보는 셋이다. A: `X :is(.a,.b)` → `X .a, X .b`(목록 인자의 명시도가 모두 같을 때만), B: `X :is(.a,.b)` → `X :is(.a,.b):is(.a,.b)` 같은 꼴은 쓰지 않는다(명시도가 바뀜), C: 그대로 둔다.

- [ ] **Step 1:** `measure-selector-cost.mjs`는 Chrome headless에서 요소 3,000개 문서를 만들고, 같은 1,000개 규칙을 (1) 끝이 `:is(.k1,.k2)`인 꼴, (2) 펼친 `.k1`, `.k2` 꼴로 넣은 두 페이지에서 클래스 하나를 바꾼 뒤의 `UpdateLayoutTree` 시간을 CPU 4배 느림으로 20번씩 잰다. 결과 중앙값을 출력한다.
- [ ] **Step 2:** Run: `node scripts/measure-selector-cost.mjs` — Expected: 두 중앙값이 출력된다.
- [ ] **Step 3:** 펼친 꼴이 20% 이상 빠르면 `REWRITE_FORM=A`, 아니면 `C`로 정하고 문서에 수치와 함께 적는다. C이면 작업 2는 `*`와 속성만 있는 끝 선택자만 다룬다.
- [ ] **Step 4:** 커밋. `git commit -m "chore: 선택자 버킷 비용 실측"`

### Task 2: 모든 요소가 검사하는 선택자 줄이기

**Files:**
- Modify: universal 선택자가 있는 앱 CSS(작업 0 보고서의 `universalSamples`와 원본 위치 목록을 따른다. 시작 시점 상위는 `design/workspace-density.css`, `design/workspace-identity.css`, `design/workspace-typography.css`, `electron-app/ios-tokens.css`)
- Modify: `scripts/design-rules.mjs`(`universal_rightmost` 규칙), `scripts/check-design-rules.mjs`(상한)
- Test: `tests/design-rules.test.mjs`

**Interfaces:**
- Consumes: `selectorBuckets`(작업 0), `REWRITE_FORM`(작업 1).
- Produces: 설계 규칙 `{rule:'universal_rightmost', file, line, selector}`(옵션 `{universal:true}`). `check-design-rules.mjs`는 앱 CSS의 universal 수가 `scripts/universal-ceiling.json`의 상한 이하인지 단언한다. 상한은 이 작업이 끝난 뒤의 실측값이고, 줄어들 때만 낮춘다.

- [ ] **Step 1:** 시험을 쓴다: `universal_rightmost`가 `.a :is(.b,.c)`, `.a *`, `[role=tab]`를 잡고 `.a .b`, `button`은 잡지 않는다. 상한 파일보다 많으면 `check-design-rules`가 실패한다.
- [ ] **Step 2:** Run: `node --test tests/design-rules.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 규칙과 상한 검사를 구현한다. 그다음 앱 CSS의 universal 선택자를 바꾼다. 원칙:
  - `REWRITE_FORM=A`이고 `:is()` 인자의 명시도가 모두 같으면 펼친다.
  - 명시도가 다른 인자 목록은 그대로 둔다.
  - `X *`, `X *::after` 꼴은 실제로 대상이 되는 요소 클래스를 찾아 좁힐 수 있을 때만 바꾼다. 찾지 못하면 그대로 둔다.
  - 속성만 있는 끝(`[role=tab]`, `[aria-pressed=true]`)은 같은 요소가 늘 가진 클래스가 있을 때만 그 클래스를 앞에 붙인다(명시도가 오르므로, 그 선택자를 이기던 규칙이 없는지 같은 파일과 뒤 파일에서 확인한다).
- [ ] **Step 4: 확인한다**
  - Run: `node --test tests/design-rules.test.mjs && npm run design:check && npm run build:electron && node scripts/check-all-surfaces.mjs && node scripts/compare-captures.mjs verification/css-diet/before/surfaces verification/all-surfaces`
  - Expected: PASS, 바뀐 캡처 0.
  - 다크, 줄인 움직임, 큰 글씨, 상태 캡처도 같은 비교로 0이어야 한다.
  - `css-report`로 universal 수를 문서에 적는다(목표: 701 → 150 이하, Claude 판단).
- [ ] **Step 5:** 커밋. `git commit -m "perf: 모든 요소가 검사하는 선택자 줄이기"`

### Task 3: CX에서 Desktop이 쓰지 않는 규칙 빼기

**Files:**
- Modify: `scripts/cx-reference-css.mjs`(지금의 좁은 정리 플러그인을 넓힌다)
- Test: `tests/cx-reference-css.test.mjs`(기존)

**Interfaces:**
- Produces: `usedClassTokens(sources: string[]): {exact:Set<string>, prefixes:Set<string>}` — JS, JSX 소스와 CX `dist/index.js`에서 `cx-`로 시작하는 문자열 조각을 모은다. `-` 또는 `--`로 끝나는 조각(이어 붙이는 접두사)은 `prefixes`에 넣는다.
- Produces: `pruneUnusedCxRules(css: string, used): {css:string, removed:number, kept:number}` — 규칙의 선택자 목록에서 모든 선택자가 "쓰지 않는 `cx-` 클래스"를 하나 이상 가질 때만 그 규칙을 지운다. 클래스가 `exact`에 있거나 `prefixes` 중 하나로 시작하면 쓰는 것으로 본다. `@keyframes`, `@font-face`, `:root` 변수 규칙은 지우지 않는다.
- 플러그인 이름 `cx-unused-reference-css`는 그대로 둔다(빌드 설정이 이름으로 찾는다).

- [ ] **Step 1:** 시험을 쓴다.

```js
test('a CX rule goes only when every selector names an unused cx- class; built names by prefix stay',()=>{
 const used={exact:new Set(['cx-button']),prefixes:new Set(['cx-button--'])};
 const out=pruneUnusedCxRules('.cx-button{a:1}.cx-button--primary{a:1}.cx-ghost{a:1}.cx-ghost,.cx-button{a:1}@keyframes cx-spin{to{a:1}}:root{--cx-x:1}',used);
 assert.equal(out.removed,1);assert.match(out.css,/\.cx-button--primary/);assert.doesNotMatch(out.css,/\.cx-ghost\{a:1\}/);assert.match(out.css,/cx-spin/);assert.match(out.css,/--cx-x/);
});
test('the plugin still refuses when CX starts shipping the flow component',async()=>{/* 기존 시험 유지 */});
```

- [ ] **Step 2:** Run: `node --test tests/cx-reference-css.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 구현한다. 규칙 단위 자르기는 PostCSS로 한다(`npm i -D postcss@<지금 최신 안정판, 정확한 버전 고정>`). 플러그인은 빌드마다 빠진 규칙 수를 metafile 옆 `verification/css-diet/cx-pruned.json`에 남긴다.
- [ ] **Step 4:** 작업 2와 같은 확인 묶음을 돈다. 바뀐 캡처 0. 안전 회귀 검사(`node scripts/check-safety-regression.mjs --repo <root> --ref <후보 트리> --delta refs/desktop/main`)에서 postcss가 설치판 묶음에 없는지 본다. 문서에 CX 바이트 전과 후를 적는다.
- [ ] **Step 5:** 커밋. `git commit -m "perf: CX에서 Desktop이 쓰지 않는 규칙을 빌드 때 뺀다"`

### Task 4: 덮어쓰기 층의 죽은 선언 지우기

**Files:**
- Create: `scripts/css-dead-declarations.mjs`, `tests/css-dead-declarations.test.mjs`
- Modify: 렌더러 전역 CSS 순서(`electron-app/renderer.jsx` 1~49행의 import 순서)에 있는 앱 CSS 파일들

**Interfaces:**
- Produces: `deadDeclarations(files: {path:string, css:string}[]): {path:string, line:number, selector:string, property:string, killedBy:string}[]` — 주어진 순서(전역 import 순서)로 읽어, 같은 미디어와 지원 조건 안에서 선택자 텍스트가 똑같은(공백 정규화) 앞 규칙의 선언이 뒤 규칙의 같은 속성 선언에 덮이면 죽은 것으로 낸다. 앞 선언이 `!important`이고 뒤가 아니면 죽지 않는다. 축약 속성과 개별 속성(`margin`과 `margin-top`)은 같은 속성으로 보지 않는다(보수적).
- Produces: CLI `node scripts/css-dead-declarations.mjs --fix` — 죽은 선언을 원본에서 지우고, 선언이 다 빠진 규칙은 규칙째 지운다.

- [ ] **Step 1:** 시험을 쓴다.

```js
test('an earlier declaration on the identical selector in the same media is dead; !important and other media are not',()=>{
 const dead=deadDeclarations([{path:'a.css',css:'.x{color:red;margin:0}@media (min-width:1px){.x{color:blue}}.y{color:red!important}'},{path:'b.css',css:'.x{color:green}.y{color:blue}'}]);
 assert.deepEqual(dead.map(d=>[d.path,d.selector,d.property]),[['a.css','.x','color']]);
});
```

- [ ] **Step 2:** Run: `node --test tests/css-dead-declarations.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 구현한다(PostCSS). `--fix`를 앱 CSS에 한 번 돌리고 결과를 커밋 대상으로 둔다. CX 파일은 고치지 않는다(읽기만, 덮는 쪽 판단에 쓴다).
- [ ] **Step 4:** 작업 2와 같은 확인 묶음. 바뀐 캡처 0. 지운 선언 수와 `workspace-identity.css`, `workspace-density.css` 바이트 전과 후를 문서에 적는다.
- [ ] **Step 5:** 커밋. `git commit -m "perf: 같은 선택자에서 덮여 죽은 선언 지우기"`

### Task 5: 화면 전용 CSS를 그 화면의 지연 묶음으로

**Files:**
- Modify: 작업 0 보고서의 `bySource` 중 첫 묶음에 있으나 한 화면에서만 쓰는 파일(시작 시점 후보: `ui/wiki-browser.css`, `ui/wiki-insights.css`, `ui/mail-table.css`, `ui/native-document-preview.css`, `ui/native-excel-preview.css`, `ui/workspace-community.css`, `ui/workflow.css`, `ui/ghes-account.css`)과 그 파일을 import하는 곳
- Test: `tests/renderer-loading.test.mjs`(기존), `tests/css-split.test.mjs`(새)

**Interfaces:**
- Consumes: `cssReport`(작업 0).
- Produces: `tests/css-split.test.mjs`가 metafile로 확인하는 계약 — 옮긴 파일은 첫 묶음 `app.css`의 입력에 없고, 그 화면 컴포넌트의 지연 묶음 CSS 입력에 있다.

- [ ] **Step 1:** 시험을 쓴다: 옮길 파일 목록 상수 `SCREEN_CSS`(파일 → 화면 컴포넌트)마다 위 계약을 단언한다.
- [ ] **Step 2:** Run: `node --test tests/css-split.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** 옮긴다. 각 파일의 선택자가 그 화면의 뿌리 클래스 아래에만 걸리는지 먼저 확인하고(아니면 옮기지 않는다), import를 지연 로드되는 화면 컴포넌트로 옮긴다. 지연 묶음 CSS가 그 화면 첫 그리기 전에 붙는지 기존 로딩 경로(`renderer-loading`)로 확인한다.
- [ ] **Step 4: 확인한다**
  - 작업 2와 같은 확인 묶음을 돈다. 바뀐 캡처 0.
  - 첫 열림 깜박임(Review Focus 3): 화면별로 지연 화면을 처음 여는 순간의 첫 프레임 캡처를 `check-all-surfaces.mjs`의 새 장면 `first-open-<화면>`으로 찍는다. 기준(옮기기 전 같은 장면)과 비교해 0이어야 한다.
- [ ] **Step 5:** 커밋. `git commit -m "perf: 화면 전용 CSS를 그 화면 묶음으로"`

### Task 6: 판정과 업로드

- [ ] **Step 1:** Run: `node scripts/css-report.mjs --out verification/css-diet/after.json` — Expected: 첫 묶음 CSS가 기준(1,388,481바이트)의 절반 이하(694,240바이트 이하). 못 미치면 남은 상위 원본 파일과 이유를 문서에 적고, 덮어쓰기 층 합치기 다음 단계를 계획 2b 앞에 더한다(목표는 낮추지 않는다).
- [ ] **Step 2:** Run: `npm run test:light-flow`(세 번 중앙값) — Expected: 스타일 계산 최대 16ms 이하. 메일과 화면 전환의 JS 긴 작업은 이 계획 범위가 아니다. 남으면 그대로 기록한다.
- [ ] **Step 3:** Run: `npm run test:gates:fast && npm run test:gates:electron` — Expected: PASS(공용 러너 시간 항목은 기록만).
- [ ] **Step 4:** 업로드 스크립트로 main에 올리고, Windows 설치판 빌드에서 화면 캡처를 직전 설치판과 비교한다(Review Focus 5). 결과 표를 사용자에게 보고한다.
