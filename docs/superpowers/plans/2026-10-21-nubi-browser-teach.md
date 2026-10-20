# 브라우저 가르치기 구현 계획

> 실행: Claude가 측정과 모듈 쪽을 직접 구현하고, 화면(카드 UI)은 Codex 몫으로 나눈다. 각 과제는 시험 먼저, 구현, 통과, 기록 순서이고 공개 10과제 점검판으로 매번 잰다.

**목표:** 사용자가 한 번 보여 준(또는 에이전트가 한 번 성공한) 브라우저 업무를 누비가 스크립트로 만들고, 모르는 것만 묻고, 사용자가 시험해 저장하면 두 번째 실행부터 모델 호출 없이 돌며, 워크플로우와 루틴에서 쓴다.

**구조(이미 있는 것 위에):** 결정적 재실행 엔진 `extensions/aipro-chat/browser-replay.js`(recordStep, replayRecord, runReplay, 값 슬롯, verify 검사)와 모듈의 절차 기억 `packages/nubi-browser-agent/src/replay-memory.ts`(카드 draft → reviewed → revalidated, capture, learn, resume)와 평가 호스트 `evaluation/procedure-host.mjs`(view 변환, buildCandidate)를 그대로 쓴다. 새로 만드는 것은 사용자 시연 녹화, 가르치기 질문(이유, 값의 출처, 번호 주석판), Workspace 저장과 README, 워크플로우 단계 종류, 카드 UI, Stagehand 기반 자기 치유다. 두 번째 재실행 엔진은 만들지 않는다.

**설계:** `docs/superpowers/specs/2026-10-21-nubi-browser-teach-design.md`. 채택 라이브러리: Stagehand 3.7.3(이미 의존성, 모델 브리지 있음), Playwright, 기존 replay. @puppeteer/replay는 단계 스키마의 이름과 셀렉터 후보 배열 개념만 빌리고 패키지는 넣지 않는다(Puppeteer 반입 불필요).

## 전역 제약

- 로그인 주소와 비밀번호 칸은 녹화와 실행 모두 제외. 자격값과 쿠키는 다루지 않는다.
- 스크립트 파일에 입력값을 저장하지 않는다. 값은 슬롯과 출처만. 실행 때 채운다.
- 자동 치유 결과는 초안이며 승인 뒤에만 카드에 반영한다.
- 공개 데모 페이지와 합성 화면으로만 측정한다.

---

### T1. 점검판에 가르치기 지표: 두 번째 실행부터 모델 0

**Files:** Modify `packages/nubi-browser-agent/eval/quality/run.mjs`(`--teach`), Create `eval/quality/teach-report.md`(결과 기록).

**Interfaces:** 과제마다 1회차는 `createProcedureHost({page, origin, allowedOrigins:task.origins, projectId:'public-quality', qualification:true})`의 memory를 켠 모델 실행, 성공하면 `learning.review()`로 reviewed 카드, 2회차는 같은 memory로 재실행. 기록: learnSuccess, draft 수, reuseSuccess, reuseModelCalls, reuseMs, replay 중단 사유.

- [x] Step 1(2026-10-21 04:15): 세 과제 모두 학습 실행이 카드가 됐고(단계 1, 1, 2) 재사용 실행도 성공했다. 그러나 모델 호출은 2, 5, 2회로 "1 이하"가 아니다. 원인: Pi 러너를 거치는 재사용은 절차를 힌트로 쓴다(절차 선택 1회 + 결과 확인 호출). 모델 0은 러너 밖에서 카드를 세션의 observe와 execute로 직접 돌리는 경로가 필요하다. 점검판에 direct 단계(memory.run을 세션 API로 호출, 모델 없음)를 넣고 재측정 중. capture는 select_option을 담도록 평가 호스트를 넓혔다(T2 일부).
- [x] Step 2(2026-10-21 04:45, 공개 과제 7개 시도): 직접 재실행(모델 0) 성공 4(숫자 입력 3.4초, 키 입력 3.7초, 드롭다운 3.4초, 링크 따라가기 4.3초). 카드가 안 되는 것 3: 체크박스와 요소 삭제는 위치로만 구분되는 컨트롤(§8 질문 30), 양식 세 칸은 아래 T2 진행 참고. 에이전트 경유 재사용은 모델 2~5회라 스크립트 실행은 반드시 직접 경로(T6 단계 종류)로 간다. 결과표는 설계 §11e.

### T2. capture 확장과 값 슬롯

**Files:** Modify `evaluation/procedure-host.mjs`(select_option, fill_form 다중 칸, navigate), 필요하면 `src/replay-memory.ts`의 capture 계약.

- [x] 드롭다운(3.4초)과 다중 칸 양식(demoqa, 4단계 10.1초)이 카드가 되고 모델 0으로 재실행된다(2026-10-21 05:05). 값은 슬롯으로 빠지고 카드에 남지 않는다. 남은 것은 §8 질문 30뿐이다.
- 진행(2026-10-21 04:40): 직접 재실행은 숫자 입력 3.4초, 키 입력 3.7초에 모델 0으로 성공. 카드가 안 만들어진 세 과제의 원인은 모듈의 카드 검증기다. ① select_option 단계 규칙이 없어 드롭다운 카드가 procedure_draft_invalid, ② 같은 모양의 컨트롤(이름 없는 체크박스 둘, 삭제 버튼 셋)은 recordTarget이 ordinal과 alike를 붙이는데 검증기가 이 둘을 금지 키로 둔다(이동성 원칙). ①은 모듈 규칙을 넓힌다. ②는 설계 결정이 필요해 §8 질문 30으로 올린다(가르치기 세션에서 사용자가 순서를 확인한 단계에 한해 허용할지).
- 진행(04:55): 양식 세 칸(demoqa)의 카드 거절 원인도 ②였다. 라벨이 input과 연결되지 않은 칸은 접근성 이름이 비어 세 칸이 같은 모양이 된다. 평가 호스트가 label[for], 감싸는 label, placeholder 순으로 이름을 채우게 고쳐 재측정 중. 제품 호스트(Desktop 관찰)는 접근성 이름을 이미 쓴다.

### T3. 사용자 시연 녹화

**Files:** Create `src/demonstration.ts`(주입 녹화기: click, input/change, select, keydown(Enter, Tab, Escape), 이동. 비밀번호와 로그인 주소 제외), `tests/demonstration.test.mjs`. 외부 브라우저는 확장의 scripting, 내부 뷰는 탭 디버거로 같은 스크립트.

**Interfaces:** `recordDemonstration(page, {view}) -> {steps:[{tool, target, values 슬롯}], captures}`; 결과는 buildCandidate와 같은 카드(draft)가 된다.

- [x] (2026-10-21 05:20) `src/demonstration.ts`: 페이지 쪽 녹화 스크립트와 createDemonstration, demonstrationCard. 점검판 `--demo`로 대본 사용자가 시연하면 카드가 reviewed로 들어가 직접 재실행된다. 결과: 숫자 입력 3.1초, 드롭다운 3.4초, 양식 세 칸 제출 8.5초(4단계), 키 입력 3.3초가 모두 시연부터 재실행까지 모델 0으로 성공. 링크 따라가기도 사후 관찰을 넘기도록 고친 뒤 4.4초 성공. 대본이 있는 5과제 모두 모델 0. 남은 것: 자식 프레임 시연, 확장(외부 브라우저) 주입 경로, 내부 뷰 주입 경로.

### T4. 가르치기 세션(계획 초안, 질문 묶음, 번호 주석판)

**Files:** Create `src/teach.ts`(`draftPlan(card) -> 단계마다 reason 추측과 valueSource 후보`, `questionsFor(plan) -> 질문 묶음`, `annotationBoard(observation) -> 번호와 표`), `tests/teach.test.mjs`. 번호 주석판의 동작 후보는 Stagehand observe를 쓴다.

- [x] (2026-10-21 05:35) `src/teach.ts`: draftPlan(카드 → 단계마다 한국어 요약, 이유 추측, 값 슬롯과 출처 후보, 제출/저장/삭제/결제 류는 guard), questionsFor(목적이 없을 때 한 번, 값 슬롯마다 출처, guard 단계마다 이유와 확인 방법), applyAnswers(답을 teach 메타데이터로, 단계는 불변, 고정값은 literal_pending으로만 표시하고 값은 카드 밖), annotationBoard(구조 관찰의 후보를 번호와 상자 좌표로). 구조 후보에 box 좌표를 더했다(`src/playwright.ts`). 5단계 견적서 카드에서 질문 3개. 시험 tests/teach.test.mjs 3개. 남은 것: Stagehand observe로 후보를 보강하는 선택 경로, 질문 카드 UI(T8).

### T5. Workspace 저장과 README, 상태 전이

**Files:** Create `packages/nubi-desktop/runtime/browser-scripts.mjs`(`browser-scripts/<이름>/{card.json, README.md, captures/, runs/}`, draft → reviewed(사용자 시험 통과) → revalidated(세 번 성공)), `tests/browser-scripts.test.mjs`.

- [ ] 저장본에 입력값이 없고(슬롯과 출처만), README가 목적과 선행 조건과 단계를 담고, 원본 상태 전이가 기존 replay-memory 규칙과 같다.

### T6. 워크플로우 단계 종류 `browser_script`와 루틴

**Files:** Modify `packages/nubi-desktop/runtime/workflow-schema.mjs`, `workflow-runner.mjs`, `workflow-adapters.mjs`; `tests/workflow-browser-script.test.mjs`.

- [ ] 단계 입력(스크립트 이름, 슬롯 바인딩), 영수증(실행 id, 단계 수, 캡처, assert 결과), 실패는 행동 필요 목록(G1). 루틴 승격은 Task 9 규칙.

### T7. 자기 치유(초안)와 Stagehand

**Files:** Modify `src/replay-memory.ts` 또는 `src/teach.ts`: 재실행 중 단계 실패 → 모듈 에이전트가 Stagehand act로 한 번 시도 → 성공하면 새 target을 초안으로 → 승인 뒤 카드 갱신.

- [ ] 변형 화면 10종에서 초안 생성 70% 이상, 카드 자동 변경 0.

### T8. 카드 UI (Codex)

**Files:** `ui/BrowserTeachPanel.jsx`(계획 초안과 질문 묶음, 번호 주석판, 시험 실행과 캡처 검수, 저장), `ui/BrowserScriptCard.jsx`(실행 결과, 초안 승인). 기존 양식 재사용: 목록 행, 진행 행, deck-dialog, 캡처 검수. 1280/440 캡처와 디자인 규칙 검사.

## 순서

T1 → T2 → T3 → T4 → T5 → T6 → T8(Codex, T4 뒤 병행) → T7. T1과 T2는 지금 이 Mac에서 바로 잰다. 회사 PC 확인(확장 정책)과 Windows 따라붙이기 실험은 별도 진행.
