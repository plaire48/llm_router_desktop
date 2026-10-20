# 누비 OpenWiki 보강 계획 (큰 저장소, 커버리지, 생성 설정, 검색 품질)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 누비의 OpenWiki 초기화가 큰 저장소에서도 돌고, 중요한 파일을 빠뜨리지 않으며, 생성 설정을 풀어 더 깊은 페이지를 만들고, 검색이 모든 페이지를 보고 근거 있는 답을 내게 한다(2026-10-19 사용자 결정 "개선사항에 포함").

**Architecture:** OpenWiki 코어(`packages/openwiki`)는 바꾸지 않는다. 누비 런타임이 소스 목록, 계획 문맥(`repositoryContext`와 planningContext), 러너 옵션(`pageConcurrency`), 모델 전송, 검색 색인, 답 근거 표시를 맡는 구조 그대로다. 큰 저장소는 ignore 먼저와 폴더 집계와 핵심 폴더 우선으로, 빠짐은 호스트의 커버리지 감사와 update 모드 2차 계획으로, 검색은 정답셋과 지표를 먼저 두고 색인 전체화와 문맥 청크로 올린다. 임베딩과 리랭커는 2단계에서 같은 정답셋으로 A/B한다.

**Tech Stack:** 기존 그대로(Node 25 ESM, OpenWiki 실제 러너, MiniSearch, graphology, ClaimsStore, ripgrep, node:test, 평가 하네스 `eval/`). 새 의존성 없음. 2단계 임베딩은 사내 API 또는 로컬 ONNX 소형 모델을 실측 뒤 별도 승인.

**Spec:** 설계 근거는 이 계획의 "배경"과 `packages/nubi-desktop/docs/OPENWIKI-QUALITY-ASSESSMENT-2026-10-15.md`(P0~P1), `OPENWIKI-GAPS-2026-10-12.md`(20,000 파일 상한), `AGENTS.md`의 위키 결정(실제 러너 재사용, MiniSearch/Claims/RRF).

**진행 순서(2026-10-20 갱신):** W0(내구성)은 R1 바로 뒤, Task 8보다 먼저 한다. 그 다음 8 → W1 → W3 → W4 → S1 → 9 → 11 → 12 → 13 → 10 → R2. W2와 S2 이후도 모두 1.3.0 후반에 한다(2026-10-20).

## 배경(측정과 코드로 확인한 현재 제한)

- 엔진은 OpenWiki 실제 러너(계획 → 페이지 에이전트 → 페이지별 의미 검토와 Claims → 마무리)다. 가벼운 모드가 아니다.
- 입력: `runtime/files.mjs` `listWikiSourceFiles`가 20,000개에서 자르고 `truncated`면 `wiki_source_limit`으로 실패한다. `.openwikiignore`는 그 뒤에 적용된다. 파일당 1MB 초과와 바이너리(Office, PDF)는 건너뛴다.
- 생성: `runtime/wiki-update.mjs`가 `pageConcurrency`를 넘기지 않아 1(순차), 응답당 도구 호출 8개(`CALL_LIMIT`), 모델은 연결된 것에 effort 지정 없음. 실측 10쪽에 571~759초, 11소스 611초에 모델 호출 38회.
- 빠짐: 계획 모델의 판단만 있고 호스트 커버리지 감사가 없다. 10-15 감사에서 7쪽 중 2쪽에 사실 오류.
- 검색: `queryWiki`가 질의당 400문서 4MiB까지만 읽고 발췌 5개. 임베딩과 리랭커 없음. 검색 전용 정답셋 없음.

## Global Constraints

- 1단계 계획과 1.3.0 계획의 Global Constraints 그대로(한국어, 가운뎃점 금지, 오픈소스 먼저, iOS 모션과 성능, 사내 데이터 fixture 금지, 보고 전 전체 `test:gates`).
- `packages/openwiki` 코어는 수정하지 않는다. 옵션(`pageConcurrency`, `repositoryContext`, planningContext)과 누비 런타임만 바꾼다.
- 한도와 시험과 정답은 통과 목적으로 바꾸지 않는다. 검색 품질은 정답셋 지표로만 주장한다.
- 화면 변경은 설계 §3.12 디자인 규칙(주변 UI 양식 재사용, 캡처 1280/440)을 따른다.

---

## Task W0: 위키 작업 내구성 — 끊기지 않고 끝까지, 끊겨도 스스로 이어서 (2026-10-20 사용자 보고 "중간에 자꾸 끊기고 갑자기 멈추고 안 된다", 최우선)

**코드로 확인한 끊김 원인(현재):**
- 모델 호출 실패가 재시도 3회(2초, 4초, 8초) 뒤 `terminalModelError`가 되어 실행 전체를 끝낸다(`runtime/wiki-update.mjs` 108~155행). 시간 초과는 재시도하지 않는다(`WIKI_MODEL_WAIT_POLICY.retryTimeouts:false`). 절전, 네트워크 끊김, 한도(429) 연속, 5xx가 14초 안에 안 풀리면 전부 "실패"다.
- `finishReason==='length'`는 즉시 `output_limit`으로 실행을 끝낸다(116행). 긴 페이지 하나 때문에 전체가 멈춘다.
- 계획 응답이 두 번 비면 `wiki_plan_missing`으로 끝낸다(118행). 모델이나 연결이 바뀌면 `provider_changed`로 끝낸다.
- 앱 종료나 프로젝트 전환으로 끊기면 다음 실행 때 `running` → `attention`(`wiki_interrupted`)으로만 바뀌고, `attention`은 자동으로 이어지지 않는다(`desktop-features.mjs` 81행). 체크포인트는 있지만 사람이 "다시 시도"를 눌러야 한다.
- 실패하면 완성된 페이지도 보이지 않는다(부분 결과를 게시하지 않고 재개용으로만 보관). 사용자에게는 "다시 시도해 주세요" 한 줄만 보인다.

**벤치마킹(내구 실행 패턴):** Temporal(작업 단위 재시도 정책: 초기 1초, 2배 증가, 상한, 시간 예산 안에서 무제한, heartbeat, 충돌 뒤 이력에서 재개), Sidekiq(지수 백오프로 오래 재시도, 실패 격리), Prefect와 Kestra(실패한 작업만 재개), Chrome 이어받기 다운로드, GitHub Actions의 실패한 작업만 재실행, Claude Code 배경 작업의 자동 재시도와 이어가기, LLM "계속" 생성 패턴(출력 한도에서 이어 쓰기). 공통 원칙은 넷이다. 실패는 격리하고(페이지 하나가 전체를 못 죽임), 재시도는 길게(분 단위 백오프와 시간 예산), 중단은 상태로 보존해 사람 없이 재개하며, 부분 결과를 먼저 보여 준다.

**Files:**
- Create: `runtime/wiki-durable-policy.mjs`(위키 전용 재시도 정책과 오류 분류), `runtime/wiki-run-journal.mjs`(페이지별 상태 done/running/retrying/skipped와 다음 재시도 시각, heartbeat), `tests/wiki-durability.test.mjs`(중단 주입: 네트워크 끊김, 429 연속, 5xx, 시간 초과, output_limit, 앱 재시작, 절전, 모델 재연결)
- Modify: `runtime/wiki-update.mjs`(terminalModelError 단락 제거: 인증 401/403과 잘못된 요청 400만 종결, 나머지는 페이지 단위 재시도로. output_limit은 "계속" 이어 쓰기 1회 뒤 페이지 분할. 계획 응답 비면 재요청 상한을 올리고 실패 시 폴더 집계 기반 기본 계획으로 대체), `runtime/recovery.mjs`(위키 정책: 시간 초과 재시도, 백오프 10초 → 30초 → 1분 → 5분 상한, 시간 예산 2시간, 429는 응답의 재설정 시각까지 대기), `runtime/desktop-features.mjs`(앱 시작과 프로젝트 열기 때 `attention`이고 `canResume`이면 자동 재개 1회, 취소한 것만 제외. `provider_changed`는 종결이 아니라 일시 정지 뒤 같은 모델 재연결 시 재개, 다른 모델이면 확인 카드. 부분 결과 게시: 완성 페이지는 `partial` 상태로 바로 보이고 "생성 중" 배지), `electron-app/main.cjs`(`powerMonitor` suspend/resume과 오프라인 감지를 서비스에 전달해 일시 정지와 재개), `ui/WikiInitializationProgress.jsx`(페이지별 상태 목록, 마지막 응답 N초 전과 다음 재시도 N초 뒤, 구체적 사유: 한도 재설정 시각, 네트워크, 모델 응답 형식, 이어서 버튼 상시)

**Interfaces:**
- `wikiRetryPolicy(error)` → `{retry:boolean, waitMs, terminal:boolean, reason}`; 종결은 인증, 권한, 잘못된 요청, 사용자 취소뿐.
- `wiki-init` 상태에 `pages:{[path]:{state, attempts, nextRetryAt, error}}`, `heartbeatAt`, `partial:true`, `resumable:true`.
- 완료 정의: 모든 페이지 done 또는 skipped(사유와 함께). skipped가 있으면 상태 `partial`이고 "빠진 페이지 N개 다시 시도" 버튼.

- [ ] **Step 1: 실패하는 시험** — 중단 주입 8종에서 현재 코드는 실행이 `attention`으로 끝난다는 것을 먼저 고정한다(합성 모델과 네트워크 fixture). 그 다음 각 주입에서 사람 클릭 없이 실행이 끝까지 가거나 `partial`로 게시되고 재개되는 것을 단언한다. 페이지 하나의 반복 실패가 다른 페이지를 막지 않는다.
- [ ] **Step 2: 구현** — 정책 → 페이지 격리 → output_limit 이어 쓰기 → 자동 재개 → 절전과 오프라인 → 부분 게시 → 진행 화면. 설계 §3.12 양식(상태 줄 한 줄과 버튼 하나, 페이지 목록은 진행 기록 행 양식).
- [ ] **Step 3: 측정과 보고** — 합성 11소스 코퍼스로 중단 주입 실행 20회의 "사람 없이 완료율"과 평균 재개 횟수를 `docs/OPENWIKI-REINFORCEMENT-2026-10.md`에. 전체 `test:gates`. 캡처 1280/440(진행 화면, partial 상태).

---

W0 진행 기록(2026-10-20): 중단 주입 8종 RED 실행은 0통과/8실패(exit 1)로 현재 attention 정지를 확인했다. Step 1의 복구 통과와 Step 2/3은 미완료다. 실제 코어 재현에서 skipped 재선택과 수락 계획의 분할 연결이 없어 설계 §8 질문 13에 좁은 예외안을 기록하고 중단했다. 새 실패 시험은 업로드 후보가 아니다. [단일 보고서](../../OPENWIKI-W0-2026-10-20.md).

## Task W1: 큰 저장소 — ignore 먼저, 폴더 집계 계획 문맥, 핵심 폴더 우선과 점진 보강

**Files:**
- Create: `runtime/wiki-folder-plan.mjs`(폴더 집계와 대표 파일 선정), `ui/WikiScopeSheet.jsx`(큰 저장소 범위 시트, deck-dialog), `tests/wiki-folder-plan.test.mjs`, `tests/fixtures/big-repo/`(합성 생성기: 30,000 파일 중 ignore 대상 22,000)
- Modify: `runtime/files.mjs`(`listWikiSourceFiles`: `.openwikiignore`와 기본 제외를 목록 단계에서 먼저 적용, 상한을 적용 뒤 계수, 목록 상한 200,000과 스트리밍), `runtime/wiki-snapshot.mjs`, `runtime/desktop-features.mjs`(범위 선택과 보강 라운드, `wiki-init` 상태에 `scope`와 `rounds`), `runtime/wiki-update.mjs`(`repositoryContext`에 폴더 집계 전달), `ui/WikiInitializationProgress.jsx`(범위와 라운드 표시)

**Interfaces:**
- Produces: `folderPlan(root, files)` → `{folders:[{path, files, bytes, languages, representatives:[path]}], representatives:[path], total, excluded:{ignored, binary, large}}`. 대표 파일 = 진입점(package.json main/bin, src/index*, main.*), README/docs, 설정, import 중심성 상위(ripgrep import 스캔), 최근 30일 변경. 계획 문맥은 폴더 집계 + 대표 파일 목록(200KB 이하)이고 전체 파일 목록은 넘기지 않는다.
- 범위: 대표 파일 수가 2,000 이하면 한 번에, 넘으면 핵심 폴더 N개(집계 점수 상위, 사용자가 시트에서 조정)로 1라운드, 나머지 폴더는 보강 라운드로 update 모드 재실행(체크포인트 재개 그대로). `wiki-init.scope={mode:'all'|'folders', folders:[...], rounds:{done,total}}`.

- [x] **Step 1: 실패하는 시험** — 합성 30,000 파일 저장소에서 ignore 뒤 8,000개가 남아 `wiki_source_limit` 없이 진행, 폴더 집계가 200KB 이하, 대표 파일에 진입점과 README 포함, 범위 시트에서 폴더 2개 선택 시 1라운드가 그 폴더만, 2라운드가 나머지. 기존 작은 프로젝트 초기화 시험은 그대로 통과.
- [x] **Step 2: 실패 확인 → 구현 → 통과**. 캡처 1280/440(범위 시트, 진행 표시).
- [ ] **Step 3: 전체 게이트와 보고** — 합성 큰 저장소 실측 시간을 `docs/OPENWIKI-REINFORCEMENT-2026-10.md`에 기록.

---

W1 로컬 구현과 집중 검증 완료(2026-10-20): 224통과/2제외/실패0, 1280/440 화면, 모션3회 새 장면50ms 초과0, 입력 복원, 빌드 통과. Step3 전체 게이트는 R1 Actions 업로드 뒤 판정 대기. [단일 보고서](../../OPENWIKI-REINFORCEMENT-2026-10.md). 다음 W3은 설계§8 질문12의 공용 계약 예외 답변 뒤 진행한다.

## Task W3: 생성 설정 — 동시성, 위키 생성 모델과 effort, 호출 상한 실측

**Files:**
- Modify: `runtime/wiki-update.mjs`(`pageConcurrency` 옵션 전달 기본 3, `CALL_LIMIT` 값을 설정으로, effort 전달), `runtime/desktop-features.mjs`(`setting:wiki-generation` {model, effort, concurrency}), `runtime/project-service.mjs`(허용 목록), `ui/WikiBrowser.jsx`의 위키 설정 모달(생성 모델과 effort 선택, 기본은 연결된 것 중 가장 강한 모델과 high), `tests/wiki-update.test.mjs`

**Interfaces:**
- Produces: `setting:wiki-generation={model:'auto'|id, effort:'high'|'medium'|'low', concurrency:1..4}`; 러너 호출 `runNativeRepositoryGeneration({...,pageConcurrency})`; 전송 `invoke(..., {effort})`. 러너가 429에서 동시성을 스스로 내리는 동작은 그대로. 초기화 보고에 모델, effort, 동시성, 호출 수를 기록.

- [ ] **Step 1: 실패하는 시험** — 설정이 러너 옵션과 전송 effort에 전달되고, 기본값이 "가장 강한 연결 모델 + high + 3"이며, 동시성 3에서 합성 11소스 초기화가 순차보다 짧고 결과 페이지 수가 같다. 호출 상한 8 vs 16을 합성으로 재서 표로 남긴다(통과 조건 아님).
- [ ] **Step 2: 실패 확인 → 구현 → 통과**. 설정 모달 캡처.

---

## Task W4: 커버리지 감사와 초기화 보고서

**Files:**
- Create: `runtime/wiki-coverage.mjs`(중요 파일 산출, 페이지→파일 지도, 미커버 목록), `ui/WikiCoverageBadge.jsx`(위키 화면 상단 커버리지와 "빠진 것 추가"), `tests/wiki-coverage.test.mjs`
- Modify: `runtime/desktop-features.mjs`(초기화 뒤 감사 → 미커버 중요 파일이 있으면 update 모드 2차 실행 1회에 planningContext로 파일 이름 지정, 보고서 저장 `wiki-init.report`), `runtime/wiki-update.mjs`(planningContext 전달), `ui/WikiBrowser.jsx`(보고서 패널: 페이지 수, 다룬 파일 비율, 건너뛴 파일과 사유, 모델 호출 수, 소요 시간), `ui/WikiInitializationProgress.jsx`

**Interfaces:**
- Produces: `importantFiles(root, plan)` → W1 대표 파일 + 사용자 고정; `coverageMap(root)` → `{pages:{[page]:[files]}, files:{[file]:[pages]}, uncovered:[file], ratio}` (페이지의 seedPaths와 Claims 근거 경로에서 파생); 2차 계획은 OpenWiki 계획 프롬프트의 "planning context names files → document" 경로를 쓴다(코어 수정 없음, 최대 1회). 보고서 `wiki-init.report={pages, coveredRatio, uncovered, skipped:{large, binary, encoding}, modelCalls, durationMs, rounds}`.

- [ ] **Step 1: 실패하는 시험** — 합성 코퍼스에서 계획이 진입점 1개를 빠뜨리면 감사가 잡고 2차 실행 뒤 커버리지 비율이 오르며 2차는 한 번만 돈다. 보고서 필드가 채워지고 화면에 비율과 빠진 파일이 보인다. "빠진 것 추가"는 선택 파일을 planningContext로 update 모드를 돌린다.
- [ ] **Step 2: 실패 확인 → 구현 → 통과**. 캡처 1280/440.

---

## Task S1: 검색 품질 1단계 — 정답셋과 지표, 색인 전체화, 문맥 청크, 근거 표시

**Files:**
- Create: `eval/wiki-search/cases/*.json`(합성 코퍼스 질문 200개: 사실, 절차, 코드 위치, 복합, 답 없음. 정답 근거 span), `eval/wiki-search.mjs`(지표: 근거 Recall@5, MRR, 답 근거 지지율, 인용 정확도, 답 없음 정밀도, 지연. 두 모델 비교 출력), `runtime/wiki-chunks.mjs`(절 단위 청크 + 파일 경로와 제목 경로와 한 줄 요약 머리), `tests/wiki-chunks.test.mjs`, `tests/wiki-search-index.test.mjs`
- Modify: `runtime/wiki-search-index.mjs`(해시 기반 증분 색인으로 모든 페이지와 Claims 포함), `runtime/wiki-evidence.mjs`(`queryWiki`의 400문서/4MiB 상한 제거, 색인에서 검색 뒤 선택 발췌만 로드, 발췌 상황별 10개, RRF 가중치는 지표로 조정), `runtime/answer-sources.mjs`(미검증 주장 표시와 freshness를 검색 결과까지)

**Interfaces:**
- Produces: `eval/wiki-search.mjs --model <id>` → 표(지표별 수치)와 `output/wiki-search/<날짜>.json`; `searchIndex(root)` → 증분 갱신(소스 해시 변경분만), `query(index, text, {limit})` → `[ {page, chunk, score, sources} ]`; 청크 머리 형식 `"<파일 경로> > <제목 경로>: <한 줄 요약>"`(요약은 생성 때 모델이 붙이고 없으면 생략).
- 통과 기준(합성 정답셋): 색인 전체화 뒤 근거 Recall@5가 기준선 대비 하락 없음, 문맥 청크 뒤 Recall@5 상승, 답 없음 정밀도 하락 없음, 질의 지연 p95 이전 대비 증가 없음. 수치는 측정 뒤 기록하고 목표값은 기준선을 본 뒤 정한다(통과 목적 조정 금지).

- [ ] **Step 1: 정답셋과 기준선** — 사례 200개와 지표 계산기, 현재 코드로 기준선 표(두 모델).
- [ ] **Step 2: 색인 전체화** — 실패하는 시험(401번째 문서의 근거가 검색되지 않음) → 구현 → 통과 → 지표 재측정.
- [ ] **Step 3: 문맥 청크** — 실패하는 시험(제목 경로로만 찾을 수 있는 질문) → 구현 → 통과 → 지표 재측정.
- [ ] **Step 4: 근거 표시** — 미검증 주장과 갱신 전 표시가 답과 검색 결과에 나타남. 전체 게이트. 보고서에 전후 표.

---

## 후반 과제(2026-10-20 사용자 결정: 모두 1.3.0에 포함, 핵심 과제 뒤 순서대로)

### Task W2: Office와 PDF 입력
- `runtime/document-extract.mjs`로 docx/xlsx/pptx/pdf를 텍스트화해 해시와 함께 소스로 넣는다. 1MB 초과는 머리와 구조 요약. 변환기 결정(Docling 보류 유지, 기존 추출기 우선)과 Windows 실측 뒤.

### Task S2: 검색 품질 2단계 — 임베딩 모델 없이 의미 검색 (2026-10-20 사용자 제약: 임베딩 API와 외부 모델 반입 불가)
- 원칙: 의미 확장은 색인 시점에 글로 만들어 두고 검색은 기존 어휘 검색(MiniSearch)과 RRF가 한다. 연결된 대화 모델만 쓴다. 새 의존성과 외부 모델 다운로드 없음, Windows 오프라인 동작.
- Create: `runtime/wiki-expansion.mjs`(청크별 doc2query 확장: 답할 수 있는 질문 3~5개와 동의어/한영 표기를 모델이 생성, 청크 해시로 캐시, 증분), `runtime/wiki-tokenize.mjs`(한국어 자모 분해와 2~3그램 토큰, 영어 어간), `runtime/wiki-glossary.mjs`(위키 "용어집" 페이지의 동의어 → 대표 용어 정규화를 색인과 질문에 적용. 모델 초안, 사람 확정), `runtime/wiki-query-rewrite.mjs`(첫 검색이 약할 때만 다중 질의 재작성), `runtime/wiki-rerank.mjs`(상위 20개를 대화 모델이 재정렬, 지연 기록), 시험 각 1개.
- Modify: `runtime/wiki-search-index.mjs`(확장 텍스트와 태그 필드 색인, 가중치), `runtime/wiki-evidence.mjs`(RRF에 Claims와 관계 그래프 가중치, 재작성과 리랭크 호출 조건), `eval/wiki-search.mjs`(단계별 A/B 표).
- 순서와 판정: ① 토크나이즈 보강 → ② 문서 확장 → ③ 용어집 → ④ 실패 때 질문 재작성 → ⑤ LLM 리랭크 → ⑥ 구조 가중치. 각 단계를 S1 정답셋으로 전후 측정해 Recall@5와 MRR이 오르고 답 없음 정밀도와 지연 p95가 나빠지지 않을 때만 남긴다. 색인 시점 모델 호출 수와 비용을 보고에 기록한다.
- 보류: 위키 말뭉치로 앱 안에서 학습하는 소형 단어 벡터(fastText류)는 ①~⑥으로 지표가 부족할 때만 검토. 외부 임베딩 모델과 전용 리랭커는 쓰지 않는다.

## 2단계: 지식의 질과 유지 (2026-10-19 사용자 승인 "넣어요", 벤치마킹: Karpathy LLM 위키 패턴, DeepWiki, Aider repo map, Swimm, Graphiti/Zep, Glean, Wikipedia 거버넌스)

측정은 하나의 점수판으로 한다. 커버리지 비율, 신선도(소스보다 오래된 페이지 비율), 근거 지지율, 답 없음 비율, 린트 경고 수를 "위키 품질 점수판"으로 위키 화면 상단에 두고(설계 §3.12 양식), 개선은 이 숫자로만 주장한다. 점수판은 W4의 보고서와 S1의 지표를 그대로 쓴다.

### 후반 1(W6, W7, W10)

#### Task W6: 위키 린트
- Create: `runtime/wiki-lint.mjs`, `ui/WikiLintPanel.jsx`, `tests/wiki-lint.test.mjs`. Modify: `ui/WikiBrowser.jsx`(점수판과 린트 목록), `runtime/desktop-features.mjs`(초기화와 갱신 뒤 린트 실행, `wiki-lint` 레코드).
- 검사 항목: 끊긴 링크, 근거 span이 없는 Claims, 소스 해시가 바뀐 페이지, 같은 주어와 술어에 값이 다른 Claims(모순), 빈 절. 결과는 `{code, page, detail, suggestedUpdate}` 목록이고 "갱신 제안 만들기"가 update 모드 planningContext로 이어진다.
- [ ] Step 1: 실패하는 시험(합성 위키에 다섯 결함을 심고 모두 검출, 거짓 양성 0) → 구현 → 통과 → 캡처.

#### Task W7: 코드 지도(결정적)
- Create: `runtime/code-map.mjs`(tree-sitter 개요 `code_outline`과 import 스캔으로 모듈 그래프, 참조 순위), `tests/code-map.test.mjs`. Modify: `runtime/wiki-folder-plan.mjs`(W1 대표 파일 선정이 코드 지도 순위를 사용), `runtime/wiki-update.mjs`(개요 페이지 `openwiki/code-map.md`를 결정적으로 생성해 repositoryContext로 전달. 모델은 설명만 덧붙임).
- [ ] Step 1: 실패하는 시험(합성 저장소에서 진입점과 허브 모듈이 상위 10에 들고, 같은 입력이면 같은 지도) → 구현 → 통과.

#### Task W10: 질문 로그 환류
- Create: `runtime/wiki-question-log.mjs`(답 없음, 근거 부족, 사용자 "틀렸어요" 표시를 기록), `tests/wiki-question-log.test.mjs`. Modify: `runtime/agent.mjs`(ask_openwiki와 wiki_query 결과가 근거 부족이면 기록, 모델 호출 없음), `runtime/routines.mjs`(루틴 종류 `wiki-reinforce`: 기록을 묶어 update 모드 planningContext로 보강 라운드, 감독 통과 전에는 제안만), `ui/`의 답 카드에 "틀렸어요" 버튼(기존 산출물 카드 양식).
- [ ] Step 1: 실패하는 시험(합성 질문 3개가 기록되고 루틴 한 라운드 뒤 해당 주제 페이지 초안이 점선으로 생기며 사람 승인 전에는 실선이 되지 않음) → 구현 → 통과.

### 후반 2(W8, W9)

#### Task W8: drift 보고서
- Modify: `runtime/wiki-update.mjs`(소스 변경 감지 때 바뀐 파일의 diff 요약과 영향 페이지 목록을 `wiki-drift` 레코드로), `ui/WikiBrowser.jsx`(drift 패널: 바뀐 것, 영향 페이지, "한 번에 갱신 승인"). 기존 해시 신선도와 update 모드를 그대로 쓴다.
- [ ] Step 1: 실패하는 시험(소스 한 파일 수정 뒤 영향 페이지 2개가 정확히 나열되고 승인 한 번으로 갱신이 돈다) → 구현 → 통과.

#### Task W9: 다이어그램 검증
- Create: `runtime/wiki-diagram.mjs`(mermaid 파싱 검증. 실패하면 표로 대체), `tests/wiki-diagram.test.mjs`. Modify: 생성 뒤 처리에서 다이어그램 블록 검증. mermaid는 OSS 표에 이미 있는 후보이며 파서만 쓴다(렌더 의존성 추가 없음, 실측 뒤).
- [ ] Step 1: 실패하는 시험(깨진 mermaid 블록이 표로 바뀌고 정상 블록은 유지) → 구현 → 통과.

### 후반 3(W11, W12)

#### Task W11: 엔터티 페이지
- 사람, 시스템, 티켓 같은 엔터티를 메일 위키, 코드 위키, 문서에서 추출해 한 페이지로 묶는다(Glean식 지식 그래프). 기존 graphology 관계와 Claims를 쓰고 새 엔진은 없다. 사내 데이터는 fixture에 넣지 않는다.

#### Task W12: 시간 있는 Claims
- Claims에 유효 시작과 끝 시각과 충돌 보존을 둔다(Graphiti/Zep 패턴). 10-15 평가 P0의 메일 사실 순서 결함을 함께 푼다. OpenWiki 코어 수정 금지 원칙상 누비 런타임의 Claims 투영층에서 한다. 코어 변경이 필요하면 §8 질문으로.

## 이 계획 밖
GraphRAG식 커뮤니티 요약은 W11 뒤에 검토한다. 자기 보강 루프(스킬과 스크립트 생성, 평가로 거르기)는 1.4.0 설계 문서로 따로 쓴다.
