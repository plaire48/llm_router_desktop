# 누비 Workspace 1.3.0 릴리스 계획 (범위 고정, 시험은 GitHub Actions로)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지금까지 계획된 구현(2차 Claude Desktop 벤치마크 + 워크플로우 1단계 Task 1~16)에 화면 최적화(프리징과 버벅임 제거)와 모션 품질(Apple iOS 벤치마크, 부드러운 전환, "모찌" 같은 누름 느낌)을 더해 1.3.0으로 고정해 배포한다. 긴 검사 묶음은 Claude의 로컬 배치 대신 GitHub Actions가 돌린다(2026-10-19 사용자 지시).

**Architecture:** 릴리스 절차는 기존과 같다(`plaire48/llm_router_desktop`에 `codex/nubi-desktop-windows-release-1.3.0` 브랜치 → `.github/workflows/nubi-desktop-windows.yml` → 초안 릴리스 `nubi-desktop-v1.3.0-run-<id>` → 사용자 지시 뒤 공개). 새로 하는 일은 둘이다. ① `npm run test:gates`를 Actions 작업으로 옮긴다(main 푸시마다 빠른 게이트, 릴리스 브랜치에서 전체 게이트). ② 남은 구현 Task 15, 16, 8, 9, 11, 12, 13을 끝내고 Task 10을 릴리스 준비로 바꾼다.

**Tech Stack:** 기존 그대로. GitHub Actions(windows-latest, ubuntu-latest), Playwright(Chrome channel), Electron 42, node:test.

**Spec:** `docs/superpowers/specs/2026-10-16-nubi-claude-desktop-wave2-design.md`, `docs/superpowers/specs/2026-10-18-nubi-workflow-agent-design.md`(§3.12 화면 규칙 포함), 절차 메모 `nubi-desktop-release-procedure`(1.1.0, 1.2.x에서 부딪힌 문제 목록)

## 범위

| 포함(1.3.0) | 상태 |
|---|---|
| 2차 Claude Desktop 벤치마크 Task 2~12, 결함 F1~F16, Playwright 도구 18개와 안전 규칙 | main에 있음(1.2.9 뒤 올라감) |
| 워크플로우 1단계 Task 1~7, 14, Q5 근거 영수증, MCP 도구 단계, W1~W11 | main e8623314 |
| Task 15 실행 화면, Task 16 디자인 정합 | Codex 완료/진행, 업로드 대기 |
| Task 8 시범 패키지와 Electron 감독 실행 검사 | 미착수 |
| Task 9 루틴 = 일정 + 할 일(워크플로우 루틴, 등록 제안, 감독 통과 전 무인 실행 금지) | 미착수 |
| Task 11~13 양식 지도 추출, 채움표와 검토 카드, `office.apply_form`(OOXML 대체 경로는 CI 검증, Windows COM은 사용자 실측) | 미착수 |
| Task P1 프리징과 버벅임 제거(6장면 측정, 50ms 초과 작업 0, 200ms 프리징 0) | QA89 후 보완 완료. 전체 test:gates exit 0, Chrome/Electron 각 12/12. Claude QA90와 캡처 승인 대기 |
| Task P2 모션 품질(iOS 벤치마크, 토큰 한 곳, 누름 spring "모찌" 느낌, 모션 감소) | QA91 실패 뒤 보완, qa91-22 전체 게이트 exit0/양쪽12장면 통과. Claude 캡처/QA/업로드 대기 |
| OpenWiki 보강 W0(작업 내구성: 페이지 단위 실패 격리, 긴 재시도, output_limit 이어 쓰기, 자동 재개, 절전과 오프라인, 부분 게시, 진행 화면), W1(큰 저장소: ignore 먼저, 폴더 집계, 핵심 폴더 우선), W3(생성 동시성과 모델/effort 설정), W4(커버리지 감사와 초기화 보고서), S1(검색 정답셋과 지표, 색인 전체화, 문맥 청크, 근거 표시) | 미착수(2026-10-19 사용자 결정 "개선사항에 포함", 계획 `2026-10-19-nubi-openwiki-reinforcement.md`) |
| OpenWiki 보강 후반 W2(Office/PDF 입력), S2(임베딩 없이 의미 검색: doc2query 확장, 한국어 토크나이즈, 용어집, 질문 재작성, LLM 리랭크), W6 린트, W7 코드 지도, W10 질문 로그 환류, W8 drift 보고서, W9 다이어그램 검증, W11 엔터티 페이지, W12 시간 있는 Claims | 미착수(2026-10-20 사용자 결정 "이후 것도 모두 1.3.0에") |
| 워크플로우 2단계 저작 UI Task 1~6(숙성 표시기, 오류 배지, YAML 탭, 저작 대화, dry-run 재생, 웹 동일 화면) | 미착수(2026-10-20 사용자 결정, 계획 `2026-10-19-nubi-workflow-agent-phase2-authoring-ui.md`) |
| L1 라이브 뷰(브라우저 CDP 스트리밍, 인앱 브라우저, 오피스 변경 피드와 Windows 창 캡처, 화면), L2 자동 캡처 규칙과 답변 증거 카드 | 미착수(2026-10-20 사용자 승인, Claude Code 벤치마킹) |
| 3차 묶음(2차 Task 14~34와 6), 자기 보강 루프(RS0 설계 → RS1~RS6), 워크플로우 3단계(F1 드래그 편집, F2 시연, F3 대화 기록, F4 메일/A2A 트리거, F5 대시보드) | 미착수(2026-10-20 "다 넣으세요 모두") |
| Buzz 벤치마크 묶음 B1~B16(ACP 어댑터, 도구 계약, 감사 해시체인, 활동 분류, 수명 규칙, 품질 관행, 스킬 트리거와 팀, 행위자 출처와 승인 토큰, 행동 필요 인박스, 자문 훅, 개발 역할 템플릿, 페어링 SAS, 키링과 egress, 스냅숏과 아카이브, 청중 라벨, 러너 trace 재생) | 미착수(2026-10-20 "Buzz 모든 기능 최대한 벤치마킹", 본문 `docs/BUZZ-BENCHMARK-2026-10-20.md` §6, §7) |
| Task 10 → 릴리스 준비(문서, 버전, 릴리스 노트) | 미착수 |

| 제외(1.3.x 또는 1.4.0) |
|---|
| (없음. 2026-10-20 사용자 지시로 전부 1.3.0에 포함. 아래 "전부 포함 과제 묶음") |

**진행 순서(2026-10-20 사용자 지시 "시나리오는 치우고 개발 우선, 최대한 1.3.0으로 개발해 배포"):** P2 마무리 → R1(Q2 포함) → W0(Q1 포함) → 8 → W1 → W3 → W4 → S1 → Q3 → Q6 → Q7 → Q8 → 9 → 11 → 12 → 13 → Q4 → Q5 → rc1 → L1(라이브 뷰) → L2(자동 캡처와 증거 카드) → [후반] W2 → S2 → W6 → W7 → W10 → W8 → W9 → W11 → W12 → 저작 UI 1 → 2 → 3 → 4 → 5 → 6 → B3 → B8 → B13 → 3차 묶음(14, 26, 18+B10, 20, 21, 15, 16 → B11, 17, 22+B1, 19+B7, 23+B11메모, 24, 25, 27, 28, 29, 30, 31, 33, 6+B9, 32, 34) → RS0~RS6 → F1~F5(F4+B12, B15) → B14 → B16 → 10(릴리스 준비) → R2 → 공개(사용자 지시). rc 릴리스는 "릴리스 리듬" 절. 2026-10-20 사용자 결정으로 1.3.1 이후로 미뤘던 것을 모두 1.3.0에 넣는다. 후반 과제는 핵심(13까지)이 끝난 뒤 순서대로 하고, 핵심이 끝난 시점에 중간 초안 릴리스(1.3.0-rc)를 한 번 만들어 Windows 실측을 시작한다. 1.3.1 이후 논의는 멈추고 문서는 Task마다 보고서 한 장만. Claude 업로드 게이트는 R1 전까지 단위 + design + 해당 Task 화면 검사 + Codex 전체 게이트 결과로 줄이고, R1 뒤에는 Actions 결과로 판정한다. P1, P2를 새 화면(8, 9, 11~13)보다 먼저 해서 토큰과 패턴 위에 새 화면을 만든다. R1은 Task 8 뒤 언제든 먼저 해도 된다. 업로드는 Claude가 하되, 로컬 전체 배치 대신 **집중 시험 + 캡처 검수 + Actions 결과**로 판정한다.

## Global Constraints

> 최신 P2 재검증(2026-10-20): 사용자 QA91 실패/편집 재개 지시 뒤 qa91-22 전체 게이트 exit0을 확인했다. [단일 P2 보고서](../../MOTION-1.3.0-QA91.md)에 모든 실패와 최종 증거를 기록했고 편집을 멈춘다. 다음은 Claude 업로드 뒤 R1이며 기존 후속 세 항목을 R1에 함께 처리한다. 아래 미판정/편집 금지 통보는 그 이전 기록이다.

> 2026-10-20 사용자 통보: QA91은 29개 통과, 프리징 장면 검사는 시스템 프로세스 부하 5.2로 미판정이다. Claude가 조용해진 뒤 재실행하고 업로드한다. **업로드 완료 통보 전 제품/검사 편집 금지**를 유지한다. 업로드 뒤 먼저 장면 중 환경 부하 표본과 미판정, 토큰 밖 모션 다섯 영역, 설정 모달 뒤 1280 사이드바 글자 겹침을 작게 보완한다. 상세 초안: [QA91 후속](../../QA91-POSTUPLOAD-FOLLOWUP-2026-10-20.md). 그다음 순서는 8 → W1 → W3 → W4 → S1 → 9 → 11 → 12 → 13 → R1 → 10이다. OpenWiki W6 이후는 1.3.1부터이며 임베딩/리랭커는 이번 조사와 적용에서 제외한다.

- 1단계 계획과 2차 계획의 Global Constraints 그대로(웹 호환, iOS 모션과 성능, 오픈소스 먼저, 한국어, 가운뎃점 금지, 승인 모델, 비밀, 사내 데이터 fixture 금지).
- 설계 §3.12 디자인 규칙: 새 화면과 고친 화면은 주변 UI 양식을 재사용하고, 보고에 1280/440 캡처 경로를 적는다. Claude가 캡처를 본 뒤 업로드한다.
- 시험, 한도, 정답을 통과 목적으로 바꾸지 않는다. 의도한 동작이 바뀐 경우에만 검사를 고치고 사유를 적는다.
- Codex는 push와 릴리스를 하지 않는다. 브랜치 푸시, 초안 릴리스 확인, 공개는 Claude가 사용자 지시에 따라 한다.
- Actions 아티팩트 한도: 설치 파일은 아티팩트가 아니라 초안 릴리스 자산으로 보존(기존 단계 유지). 게이트 작업은 캡처를 아티팩트로 올리되 7일 보존.

---

## Task P1: 프리징과 버벅임 제거 (2026-10-19 사용자 추가 범위)

**Files:**
- Create: `scripts/check-freeze-scenes.mjs`(6개 장면 측정), `docs/PERF-1.3.0.md`(기준선과 수정 뒤 수치)
- Modify: 측정에서 나온 상위 원인 파일(예상: `ui/Workbench.jsx` 대화 렌더, `ui/MailHistory.jsx` 목록, `ui/WikiBrowser.jsx` 지도와 문서, `ui/WorkflowRunView.jsx` 폴링, 명령 출력 뷰, `runtime/project-service.mjs`의 큰 투영), `scripts/check-motion-performance.mjs`, `scripts/check-ui-responsiveness.mjs`(장면 추가)

**Interfaces:**
- 장면 6개(합성 자료): (a) 500메시지 대화 스크롤과 스트리밍 응답 중 입력, (b) 위키 관계 지도 150노드와 문서 열기, (c) 메일 목록 1,000건 스크롤과 필터, (d) 워크플로우 1000단계 실행 화면 폴링 60초, (e) 명령 터미널 출력 5,000줄 스트리밍, (f) 화면 전환(대화 ↔ 위키 ↔ 메일 ↔ 워크플로우) 10회와 프로젝트 전환.
- 지표: 메인 스레드 50ms 초과 작업 수와 최대 길이(`PerformanceObserver longtask`), 프레임 p95(`requestAnimationFrame` 간격), 입력 지연(pointerdown → 다음 paint), JS 힙. 기준(설계 §8 답 8로 재정의, 2026-10-19): 첫 그리기 뒤 50ms 초과 작업 0, 200ms 초과 작업은 어떤 장면에서도 0(프리징 정의), 프레임은 빈 셸 rAF 간격 중앙값 `d`를 기록하고 `1.5d` 초과 간격 비율 1% 이하와 최대 간격 100ms 이하(p95/d는 기록만), 입력 지연 `max(50ms, 2d + 10ms)`. 판정 환경은 Chrome headless(프레임 포함)와 격리 Electron(작업, 프리징, 입력. 프레임은 `d`로 정규화해 기록). 첫 표시 분할은 동기 레이아웃 읽기 제거 뒤에도 50ms를 넘을 때만, §8 답 8의 계약(첫 프레임 = 머리글 + 현재 질문 + 작성기 + 보이는 메시지, 나머지 40개는 300ms 안에 앵커 고정 앞붙이기, 키 안정, 초안 보존)대로.

- [x] **Step 1: 기준선 측정** — 6장면을 지금 코드로 돌려 `PERF-1.3.0.md`에 표로 기록(수치, CPU 프로파일 상위 5개 함수). 고치기 전 숫자를 남긴다.
- [x] **Step 2: 상위 원인 수정** — 프로파일 순서대로. 도구는 기존 것 우선: 긴 목록은 `useConversationWindow` 같은 창 렌더링과 `content-visibility:auto`, 무거운 변환(마크다운, 하이라이트, diff, 큰 JSON)은 worker 또는 `frameCoalescer`로 프레임당 한 번, 폴링은 변경 없으면 setState 생략(W11 방식), 읽기와 쓰기 레이아웃 분리, 이미지 `decoding="async"`, 렌더 중 동기 IPC 금지. 새 의존성 없음(TanStack Virtual은 OSS 표에 "보류"로 이미 기록).
- [x] **Step 3: 검사로 고정** — `check-freeze-scenes.mjs`가 6장면 기준을 단언한다. 현재 `test:freeze-scenes:browser`와 `test:freeze-scenes:electron`을 기존 `test:gates` 뒤에 연결했다. fast/electron 분리는 기존 합의대로 R1에서 한다. 수정 뒤 수치를 `PERF-1.3.0.md`에 나란히 기록하고 보고 뒤 멈춤.

**P1 최종 인계(2026-10-19, Q9):** `q9-final-2`에서 참조 소스 투영/수정본 × Chrome/격리 Electron × 1280/440의 48행 수집 완료. 네 실행 모두 exit 0이며 제품/검사 입력 1,433개 해시가 불변이다. 수정본 Chrome 12/12, Electron 12/12. >50ms 작업은 Chrome 51→0, Electron 5→0이고 >200ms 작업은 양쪽 0→0. 입력 최대는 Chrome 43.4ms, Electron 44.8ms다. 첫 표시 4행, 실제 Workbench 4→40 최대 251.8ms, 훅 앵커 이동 0px을 확인했다. 집중 단위 47/47, 화면/디자인 14개와 실제 Electron 빌드 exit 0. 전체 로컬 `test:gates`는 미실행이며 QA89/R1의 범위와 구분한다. 캡처와 원본은 `docs/PERF-1.3.0.md` 참조.

**검수에 남긴 관찰:** Electron 위키 1280의 최대 프레임 간격 560.9ms는 원본에 보존했다. Q8/Q9에서 Electron 프레임은 기록 대상이므로 통과하지만 이 끊김까지 제거했다는 뜻은 아니다. 원인은 미확정이다. P1 로컬 완료 뒤 편집을 멈추고 Claude QA89와 캡처 검수를 기다린다. P2, R1, 업로드와 릴리스는 시작하지 않았다.


**P1 중간 인계(2026-10-19, Codex):** 원본/수정본 × Chrome/격리 Electron × 1280/440의 48행 수집 완료. 입력 24개 해시 불변. 집중 22/22와 design:check 통과, scroll/history/send/workflow/motion/responsiveness 회귀 확인. 성능 수정본은 양쪽 exit 1이며 Chrome long task 55→4, Electron 6→4. 수정 후 200ms 초과 0이나 대화/전환과 프레임/일부 입력 기준 실패가 남았다. P1 Step 2/3은 미완료. docs/PERF-1.3.0.md와 CPU 표, 설계 §8 질문 8로 인계 후 정지. P2와 R1, 업로드 미착수.

---

> QA89 결과(2026-10-19 14:15, Claude): 단위 2,305개 통과(실패 0), 화면 검사 26개 중 24개 통과. 실패 2건. ① `check-wave2-ui` 52행: 챕터 이동 뒤 `.message` 87개 기대, 85개(조용한 기계에서 재실행해도 동일). P1 첫 표시 분할(점진 admission) 때문에 검사가 세는 순간 채움이 끝나지 않은 것. 고침: 대화 목록에 채움 완료 신호(§8 답 7/8 계약의 `aria-busy`가 false, 또는 `data-admission="complete"`)를 두고 검사가 그것을 기다린 뒤 센다. 기다려도 87이 안 되면 이전 내역 표시의 제품 회귀이므로 제품을 고친다. ② `check-freeze-scenes`(Chrome) 화면 전환 440 `missed_frames`: 실행 중 macOS 미디어 분석과 색인이 CPU 85%+27%를 쓰던 환경 잡음 가능성. 고침: 빈 셸 측정에서 놓친 프레임이 이미 한도를 넘으면 통과도 실패도 아닌 `environment_unstable`로 구분해 종료 코드 2와 부하 수치(loadavg, 상위 프로세스)를 기록하고, 실행자가 재실행한다. 판정 완화 아님. 14:13 조용한 상태(loadavg 4.4)에서 `check-freeze-scenes` 단독 재실행은 12장면 모두 통과(위반 0)라 ②는 환경 잡음으로 확인됐고, ①은 재실행에서도 85로 동일했다. P1은 ①을 고치고 ②의 환경 구분을 넣은 뒤 전체 `test:gates`를 돌려 통과로 본다. **P1 완료(2026-10-19 17:30):** QA90 30개 통과(단위 2,311개 중 2,111 통과, 실패 0), main 70742a64 업로드(72 파일). 남은 관찰: Electron 위키 1280 최대 프레임 간격 560.9ms(기록 항목)는 P2와 R1 CI에서 재확인.

### QA89 보완 후 최종 로컬 재검사(2026-10-19, Codex)

- `qa90-4`: 전체 `npm run test:gates` 25분 30초, exit 0. 상위 명령 30개를 끝까지 실행했다. 총 2,311개 단위 시험 중 2,111 통과, 200 건너뜀, 실패 0.
- Chrome 12/12, 격리 Electron 12/12. 양쪽 >50ms 작업과 >200ms 작업 0. 입력 최대 45.3/46.9ms, 최대 프레임 간격 66.6/80ms. 매 장면 d와 표본 600개 이상 보존. 실제 첫 4행→40 최대 229ms.
- 채움 완료 신호 후 87개 검사(기대값 유지), 빈 셸 환경 불안정의 exit 2와 부하 기록, 이미 관측한 제품 실패를 exit 2로 덮지 않는 보호를 반영했다. 초기/동일 대화의 불필요한 캡처를 제거하고 실제 다른 대화/사이드바 모션은 유지했다. 지도와 작성기 검사에 비동기 완료 대기를 추가했다. 기준/기대값을 줄이지 않았다.
- 최종 실행 중 소스/검사 입력 1,434개 해시 불변. 앞선 세 전체 실행의 실패와 수정 이유를 원장에 보존했다. 캡처 1280/440 8장을 직접 확인했으며 합성 fixture의 확인이다.
- 최신 결과/파일 목록/캡처는 `docs/PERF-1.3.0-QA90.md`와 `docs/PERF-1.3.0.md`. Claude QA90와 캡처 승인 뒤 업로드한다. 보고 뒤 편집 정지. P2/R1/릴리스/업로드 미착수.


## Task P2: 모션 품질 — Apple iOS 벤치마크, 부드러운 전환, "모찌" 같은 누름 느낌 (2026-10-19 사용자 추가 범위)

**Files:**
- Create: `design/workspace-motion.css`(모션 토큰과 공통 키프레임 한 곳), `scripts/check-motion-quality.mjs`, `docs/MOTION-1.3.0.md`(토큰 표, 곡선 그림, HIG 대응)
- Modify: `ui/viewTransition.js`, `ui/modalMotion.js`(토큰 사용), 하드코딩된 240ms/900ms/800ms 전환(`design/workspace-identity.css`, `workspace-density.css`, `workspace-typography.css`)을 토큰으로, 버튼/행/카드 누름 피드백(`@e2e/cx-design-system` 버튼은 클래스만 추가, 시스템 소스는 바꾸지 않음)

**Interfaces:**
- 토큰: `--nubi-motion-enter: 280ms`, `--nubi-motion-exit: 180ms`, `--nubi-motion-press: 120ms`, `--nubi-motion-state: 180ms`; 곡선 `--nubi-ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`(iOS 표준 감속), `--nubi-ease-exit: cubic-bezier(0.4, 0, 1, 1)`, `--nubi-ease-spring: linear(...)`(CSS `linear()`로 만든 스프링, 강성 300 감쇠 26 질량 1, 오버슈트 3% 이하. 생성 스크립트와 값은 `MOTION-1.3.0.md`에. 새 의존성 없음. Framer Motion 스프링 기본값은 패턴 참고만).
- 패턴: (a) 화면 전환: 크로스페이드 + 12px 슬라이드, enter/exit 토큰, `viewTransition.js`. (b) 모달과 시트: 넓은 창은 scale 0.96 → 1 + fade(spring), 좁은 창은 아래에서 올라오는 시트, 배경 흐림 없음, `modalMotion.js`. (c) 누름("모찌"): 버튼, 목록 행, 카드, 노드 카드에 press scale 0.98(120ms, ease-out) → 해제 때 spring 복귀. 호버는 색만. (d) 목록 항목 추가/제거: height + opacity 180ms. (e) 상태 변화: 색 크로스페이드 180ms. (f) 내용 로드: 스켈레톤 대신 레이아웃 즉시 + 내용 fade 120ms. (g) 스크롤: 네이티브 관성 그대로, JS 스크롤 애니메이션 금지, 최신 따라가기는 즉시 이동 + 작은 fade. (h) 모션 감소: 전부 크로스페이드 120ms.
- 금지: 300ms 초과 전환, 한 화면에서 동시에 3개 초과 요소 애니메이션, transform/opacity 외 속성 애니메이션(목록 항목 height 예외), `transition: all`, 브랜드 시작 애니메이션 외의 800ms급 모션.
- 긴 목록 첫 표시 분할(설계 §8 답 8과 11, 2026-10-20): 대화와 메일 100행은 공통 훅(`useProgressiveList`)으로 보이는 행 먼저, 나머지 300ms 안, 위치 이동 0px, `data-admission` 신호. 결과 교체 커밋의 전체 Layout도 함께 줄인다(고정 행 높이, `table-layout: fixed`, 행 묶음 `content-visibility`). 성능 검사는 두 환경을 모두 끝까지 돌려 보고한다.
- 상시 모션 예외(설계 §8 답 10, 2026-10-19): 중앙 새의 비행과 표정, 느린 파스텔 배경, 불확정 진행 표시는 `workspace-motion.css`의 예외 표(이름, 주기, 속성, 정지 조건)로 관리한다. 300ms/동시 3개 제한은 상호작용 전환에만 적용하고, 상시 모션은 transform/opacity만 쓰며 화면 전환과 모달 모션 중, 창 숨김, 모션 감소에서 정지한다. 성능 판정(50ms 작업, 프리징, 입력, 프레임)은 상시 모션이 켜진 상태에서 예외 없이 그대로다. 검사는 두 범위를 따로 센다.

- [x] **Step 1: 실패하는 검사** — `check-motion-quality.mjs`: 전환 속성이 토큰 값인지(하드코딩 duration 0건), `transition: all` 0건, transform/opacity 외 애니메이션 0건(예외 목록 명시), 주요 컨트롤(버튼, 목록 행, 카드, 노드)에 press 피드백 존재, `prefers-reduced-motion: reduce`에서 모든 duration 120ms 이하, 전환 중 50ms 초과 작업 0, 모달 열기/닫기 실측 280/180ms ±20.
> P2 초기 점검(2026-10-19, Codex): 시작 가림 종료/브랜드 이미지 로드 뒤 실제 Workbench 1280/440 각각 실행 중 CSS 애니메이션 15개. 일반 모달 280/180ms, 모션 감소 페이드 없음. 초기 `check-motion-quality.mjs` exit 1. 기존 새/배경 유지와 동시 3개/긴 모션 금지의 범위를 설계 §8 질문 10에 기록하고 중단. Step 1의 나머지 검사와 제품 구현, 전체 게이트는 미완료. 캡처/근거는 `docs/MOTION-1.3.0.md`.

- [x] **Step 2: 토큰과 패턴 적용** — `workspace-motion.css` → viewTransition/modalMotion → 누름 피드백 → 목록/상태/로드 → 하드코딩 치환. 화면마다 1280/440 캡처와 전환 중 프레임 수치를 `MOTION-1.3.0.md`에.
- [x] **Step 3: 검사 통과와 보고** — `check-motion-quality.mjs`, `check-motion-performance.mjs`, `check-freeze-scenes.mjs` 통과. 보고 뒤 멈춤(Claude가 캡처와 수치 검수). QA91 프리징 실패로 재개했다. 세 차례 P1/P2 교대 비교와 최신 검증은 [QA91 재검증](../../MOTION-1.3.0-QA91.md)에 기록한다.

---

> P2 인계(2026-10-19): 구현과 집중 검사/qa91-11 부분 모션157개/1280·440 캡처는 완료. Step3 전체 게이트는 미완료다. qa91-12는 단위2134통과/200제외/실패1 및 병행 모달 작업의 입력7개 변경을 기록했다. 같은 파일의 후속 대화 아이콘 작업이 진행 중이므로 변경을 보존하고 검증을 멈췄다. 안정된 합친 소스로 전체 test:gates와24장면 재검증 및 새 캡처가 필요하다. 상세는 docs/MOTION-1.3.0.md. Task8/업로드는 시작하지 않았다.

 > P2 재개 기록(2026-10-20): qa91-17 전체exit1/입력1449변경0. 단위2135통과/200제외/실패0, 모션157/화면117/개발8/MCP통과 뒤 Chrome메일2장면 입력실패. 후속 불필요한 스크롤 쓰기와 중복렌더를 고쳤지만 입력은 미통과다. 사용자 추가 정렬(파일변경/날짜)은 실제Electron1280/440 완료. §8질문11에 메일100행 분할 계약을 기록하고 중단. Step3와Task8은 미완료, 업로드없음. 현재 소스의 전체 게이트는 다시 필요하다.

> QA91 결과(2026-10-20 06:50, Claude): 배치 29개 통과(단위 2,341개 중 2,141 통과, 실패 0), `check-freeze-scenes`만 3회 연속 실패. 조용한 상태(부하 2.65)의 재실행에서도 Chrome 화면 전환 장면 1280/440의 놓친 프레임 비율이 약 1.5%(한도 1%)이고 50ms 초과 작업은 0이다. 같은 장면이 P1 소스(QA89 재실행, 부하 4.4)에서는 0.49%였고 Codex의 P2 실행(qa91-19)에서는 0.49%였다. 환경 잡음만으로 보기 어려워 P2 전환 변경(상시 모션 22개의 정지와 재개 토글, 12px 슬라이드, 가시성 이벤트)이 전환 중 프레임을 떨어뜨리는지 A/B로 가린다. 고침 전 업로드하지 않는다.

> **P2 완료(2026-10-20 09:05):** Codex 전체 게이트 qa91-22 통과(24장면, 단위 2,142 통과)와 P1 대비 교대 A/B 동일(전환 놓친 프레임 중앙값 0.65%대, 최종 0.820%/0.655%). Claude 축소 게이트 QA92 10개 통과(단위 2,342개 중 2,142 통과). 프리징 장면 검사는 시스템 색인 부하(fseventsd 80%, mds 71%)에서 전환 장면만 1.1~1.3%로 Claude 환경에서 미판정, 50ms 작업 0. main aa9bb29f 업로드(77 파일). 최종 판정은 R1 Actions. 교훈: 이 Mac의 프레임 비율 지표는 색인 부하에 민감해 단독 실패는 교대 A/B로 판정.

## Task L1: 라이브 뷰 창 — 브라우저, 오피스, 화면을 실시간으로 (2026-10-20 사용자 승인, Claude Code 벤치마킹)

**Claude Code에서 가져오는 것:**
| Claude Code 장치 | 누비 반영 |
|---|---|
| 시뮬레이터 패널은 "사용자의 눈", 검증 스크린샷은 헤드리스로 따로 | 라이브 뷰는 사용자용 스트림이고, 에이전트 검증은 별도 캡처와 구조 읽기로 한다. 라이브 프레임을 모델에 넣지 않는다 |
| 내장 브라우저 패널과 탭, 사용자가 같은 창을 보고 넘겨받을 수 있음 | 오른쪽 라이브 뷰에 탭 셋(브라우저, 오피스, 화면). 사용자가 언제든 직접 조작으로 넘어가고 에이전트는 멈춘다 |
| 읽기는 `read_page`와 `get_page_text`, 보기는 스크린샷, 작은 UI는 `zoom` | 에이전트는 구조(snapshot, find)로 읽고, 캡처는 증거용. 셀 값 같은 작은 영역은 확대 캡처 |
| 동작마다 `action_summary` | 라이브 프레임과 증거 카드에 동작 요약을 자막으로 |
| 앱별 접근 등급(read, click, full)과 연결한 창만 | 연결한 창과 탭만 캡처. 전체 화면 캡처 없음. 캡처 중 표시와 일시 정지 |
| 콘솔과 네트워크 읽기 | 개발 서버 작업에서는 라이브 뷰에 콘솔 탭 |

**Files:**
- Create: `ui/LiveView.jsx`, `ui/live-view.css`, `runtime/live-view.mjs`(프레임 버스: 소스별 구독과 fps 상한, 숨김 때 중단), `scripts/check-live-view-ui.mjs`, `tests/live-view.test.mjs`
- Modify: `electron-app/lib/browser-connector/background.js`(기존 debugger 권한으로 `Page.startScreencast` 프레임을 기존 WebSocket으로 중계, 2~5fps, JPEG 품질 60, 탭이 비활성이면 중단), `runtime/browser-agent-host.mjs`(인앱 Playwright 동작마다 프레임), `runtime/native-office-host.mjs`(Windows: Office 창을 창 단위로 캡처 2~3fps, 권한 없으면 변경 피드만. Word는 COM으로 변경 내용 추적 켜기), `electron-app/main.cjs`(창 캡처 권한과 소스 선택, 연결한 창만), `ui/Workbench.jsx`(오른쪽 패널에 라이브 뷰, 미니 지도와 같은 자리 규칙, 440px 접힘), `ui/motion-policy.mjs`(라이브 뷰 전환은 토큰)

**Interfaces:**
- `liveView.subscribe(source)` → 프레임 `{source:'browser-external'|'browser-internal'|'office'|'computer', at, jpeg, width, height, caption}`; 소스당 fps 상한 5, 창 숨김과 사용자 일시 정지에서 0. 변경 피드 `{at, summary}`는 오피스 장부(compare_document_values, form-ledger)에서.
- 사용자가 라이브 뷰 안을 클릭하면 에이전트 동작을 멈추고 "직접 조작 중" 표시(기존 승인 모델의 중단 경로).

- [ ] **Step 1: 실패하는 검사** — 합성 소스로 라이브 뷰 탭 셋 렌더, 프레임 5fps 상한, 숨김과 일시 정지에서 프레임 0, 자막 표시, 440px 접힘, 메인 스레드 50ms 작업 0(디코드는 `createImageBitmap`을 작업자에서), 디자인 토큰만.
- [ ] **Step 2: 구현** — 프레임 버스 → 외부 브라우저 중계 → 인앱 브라우저 → 오피스 변경 피드(Mac에서 검증 가능) → 창 캡처(Windows 실측 항목) → 패널.
- [ ] **Step 3: 검사와 보고** — `check-live-view-ui`, `check-motion-performance`, 전체 게이트. 캡처 1280/440. Windows 창 캡처는 릴리스 노트의 실측 항목.

---

## Task L2: 자동 캡처 규칙과 답변 증거 카드 (2026-10-20 사용자 승인, Claude Code 벤치마킹)

**Claude Code에서 가져오는 것:**
| Claude Code 장치 | 누비 반영 |
|---|---|
| `SendUserFile`은 산출물이 생길 때 바로, 자막과 함께, 인라인 렌더 | 증거 카드는 작업 끝에 몰아 보내지 않고 생기는 즉시 타임라인에 붙인다 |
| 컴퓨터 도구는 동작 전 관찰, 동작 후 재관찰 | 캡처 규칙: 동작 도구 뒤 한 장, 검증 단계 전후 한 쌍, 오류 때 한 장. 호스트가 정하고 모델은 고르지 않는다 |
| "보기 전에 단정하지 않는다" | 답에 결과를 주장하면 그 장면의 증거 카드가 붙는다. 없으면 "확인 못 함" |
| `gif_creator`로 흐름 녹화 | "이번 작업 녹화" 선택지: 라이브 프레임을 짧은 webm으로 묶어 보고서에(업로드 제외 규칙 유지) |
| `zoom` 영역 캡처 | 값 확인은 영역 확대 카드(셀, 입력칸, 버튼) |

**Files:**
- Create: `runtime/capture-policy.mjs`(언제 찍는지), `runtime/evidence-cards.mjs`(전후 쌍과 검증 장면 선별, 상한, 자막), `tests/capture-policy.test.mjs`, `tests/evidence-cards.test.mjs`
- Modify: `runtime/captures.mjs`(지각 해시 중복 제거, 1280px webp, 작업자 인코딩, 로그인 화면 캡처 생략), `runtime/agent.mjs`(동작 도구 뒤 캡처 훅, trace의 `captures`에 연결, 증거 카드를 산출물 카드로 발행), `runtime/workflow-runner.mjs`(워크플로우 단계도 같은 규칙), `ui/WorkspaceActivity.jsx`와 `ui/WorkflowTimeline.jsx`(증거 카드 표시, 답변당 6장 상한과 "더 보기"), `runtime/tool-rules.mjs`(모델 규칙 한 줄: 캡처는 호스트가 붙이니 모델은 설명만. 도구 예산 시험 유지)

**Interfaces:**
- `capturePolicy(event)` → `'after_action'|'verify_pair'|'on_error'|null`; `evidenceCards(trace)` → `[{kind:'before_after'|'verify'|'error', frames, caption, stepId}]`; 산출물 카드 `kind:'evidence'`.
- 상한: 답변당 6장, 작업당 200장 보관, 7일 뒤 정리. 캡처는 작업별 폴더, 업로드 제외.

- [ ] **Step 1: 실패하는 시험** — 합성 실행에서 동작 3개와 검증 1개가 캡처 5장(전후 쌍 포함)을 만들고 중복 1장이 제거되며, 답변에 증거 카드 3장과 "더 보기"가 붙고, 로그인 화면은 캡처되지 않는다. 도구 예산과 압축 시험 유지.
- [ ] **Step 2: 구현** → **Step 3: 전체 게이트와 캡처 보고**.

---

## 전부 포함 과제 묶음 (2026-10-20 사용자 지시 "다 넣으세요 모두")

아래는 그동안 "뒤로" 두었던 것을 모두 1.3.0에 넣은 목록이다. 핵심과 후반이 끝난 뒤 이 순서대로 한다. 본문은 각 원 계획을 따른다.

### 3차 묶음(2차 계획 `2026-10-16-nubi-claude-desktop-wave2.md` Task 14~34와 Task 6)
- 순서: 14 주장 대조 → 26 관찰 내용의 지시문 경계 → 18 프로젝트 훅 → 20 wait_for_output → 21 read_process_output 범위 확인 → 15 검토 확신도 → 16 개발 변경 검토 2통로 → 17 탐색만 모드 → 22 하위 에이전트 유형 → 19 작업 방식 스킬 4개 → 23 기억 종류 → 24 임시 파일 규칙 → 25 편집 전 자동 재읽기 → 27 도구 카탈로그 지연 로딩 → 28 접두 패턴 허용 → 29 경량 모델 라우팅 → 30 교정을 평가 후보로 → 31 경로:줄 링크 → 33 프로젝트 횡단 검색과 자동 제목 → 6 A6 진행 상태 한 줄 → 32 도구 선택과 스킬 발동 평가 → 34 3차 실측과 문서.
- 안전과 품질에 직접 닿는 것(14, 26, 18, 20, 21)을 앞에 둔다. 각 Task의 Files와 Steps는 2차 계획 본문 그대로. 공용 런타임 변경이 필요한 항목은 §8 질문 12의 "좁은 선택적 인터페이스, 기본 동작 보존" 원칙으로만.

### 자기 보강 루프(경계 있는 RSI)
- Task RS0 설계 문서(Claude): `docs/superpowers/specs/2026-10-2x-nubi-self-improvement-design.md`. 신호(실패 과제, 답 못 한 질문, 반복 승인, 반복 루틴) → 제안 객체(초안, 근거, 시험, 상태) → 제작과 자체 검증(프로젝트 범위 스킬, 스크립트, 위키 페이지, 워크플로우만) → 적합도(평가 하네스, 위키 점수판, S1 정답셋, 회귀 집합) → 사람 승인(점선 → 실선) → 기록과 재사용 → 밤 라운드 루틴. 경계: 런타임 자기 수정 금지, 외부 반영과 비밀은 루프 밖, 예산 상한, 회귀 시 자동 폐기. 벤치마크: Voyager 스킬 라이브러리, Claude Code 스킬과 플러그인 평가, Agent Workflow Memory, Reflexion, 도구 생성 에이전트, Darwin Gödel Machine의 경험적 선별.
- Task RS1 제안 객체와 격리 작업 공간, RS2 스킬과 스크립트 제작기(시험 포함), RS3 위키와 워크플로우 제작기(W10 환류와 §3.5 가져오기 입구 재사용), RS4 적합도 러너와 회귀 집합, RS5 밤 라운드 루틴(Task 9 루틴 재사용), RS6 벤치마크(도구 부재 과제 30개 전후 성공률, 질문 실패율 추세, 회귀 20개). 계획은 RS0 뒤 Claude가 쓴다.

### 워크플로우 3단계(2단계 계획 "이 계획 밖" 항목)
- Task F1 드래그 편집(노드 추가와 연결, xyflow 쓰기 모드, YAML 왕복), F2 시연에서 만들기(내장 브라우저 화면 배우기 → web 단계), F3 대화 기록에서 만들기(성공한 대화 → 초안), F4 메일 트리거와 A2A 트리거(수락 뒤 실행, §3.7 승인 모델), F5 대시보드(실행 수, 성공률, 평균 시간, 개입 수). 각 Task는 설계 §3.5와 §3.8 문장을 근거로 하며 Files와 Steps는 착수 직전에 Claude가 보강한다.

### Buzz 벤치마크 묶음(2026-10-20)
- 본문과 매핑은 `docs/BUZZ-BENCHMARK-2026-10-20.md` §6(전수 매핑)과 §7(B1~B16). 흡수형(B2, B4, B5, B6, B10, B15)은 해당 과제에 문장으로 들어가고, 독립형은 아래 자리에서 한다.
- 배치: B3 감사 해시체인과 B8 행위자 출처는 Q6 뒤. B9 행동 필요 인박스는 3차 Task 6(A6)과 함께. B1 ACP 어댑터와 B7 스킬 트리거와 팀은 3차 Task 22(하위 에이전트 유형)와 Task 19(작업 방식 스킬)와 함께. B11 개발 역할 템플릿은 Task 16 뒤. B12 페어링 SAS는 F4와 함께. B13 키링과 egress는 Q6 뒤 보안 과제로. B14 스냅숏과 아카이브는 후반. B16 러너 trace 재생은 가장 뒤.
- 제외(이유): Nostr 릴레이, 멀티테넌트, 서버 운영 콘솔, 자체 git 호스팅, 허들 음성, 모바일과 푸시, 모더레이션, 공유 컴퓨트, 원격 k8s, 팀 UI(채널, 포럼, 이모지, GIF), TLA+와 Tamarin. 단일 사용자 Electron 범위 밖이거나 과하다.

### 기능 공백 G0~G5(2026-10-21, Claude 설계 `docs/superpowers/specs/2026-10-21-nubi-feature-gaps-design.md`)
- 사용자 지시 "기능 중심으로 부족한 부분을 찾아 설계"에 따라 여정 열 단계를 대조해 찾은 공백. G0 워크플로우 루틴 화면 연결(Task 9 UI, 승격 제안 소비처)과 G1 행동 필요 목록(Buzz B9를 3차 Task 6에서 떼어 앞당김)은 P0로 핵심 13 → rc1 사이에. G2 메일 도착 트리거는 L2 뒤(F4 앞), G3 워크플로우 공유와 버전은 저작 UI 6 뒤, G4 절전/오프라인 일반화는 Q8 뒤, G5 접근성 최소 규칙은 Q7 안. 새 의존성 없음.
- Task 9 런타임은 Claude가 2026-10-21에 구현했다(루틴 kind workflow, definitionHash(일정 제외, README 포함), 감독 통과 전 무인 시작 금지와 알림 한 번, 제안 레코드, 일정 되쓰기, 승격 제안 한 번; 시험 (a)~(f)). 기존 러너 시험의 감독 통과 키 심기는 패키지 해시 → 정의 해시로 옮겼다. 화면 연결(G0)은 Codex.

### 위키 규모와 품질 M1~M6, C1~C7(2026-10-21, 사용자 질문 "수십만 통 메일과 큰 저장소", 설계 `docs/superpowers/specs/2026-10-21-nubi-wiki-scale-quality-design.md`)
- 지금 메일은 `store.list('mail:')` 전체 스캔, MiniSearch 메모리 색인, 메일당 모델 요약이라 수천 통 전제다. 코드 위키는 파일 상한 20만, 1MiB 제외, 대표 파일 표본 계획이라 깊이를 모델 판단에 기댄다. 설계: 결정적인 것은 호스트(SQLite FTS5, 스레드 묶기, 심벌 지도와 PageRank 중요도), 모델은 상위 묶음 요약과 답변만, 증분만, 메모리 상한(메일 500MB, 코드 1GB).
- 배치: rc2 전에 M6 합성 30만 통 생성기와 측정, M1 저장/색인, M2 모델 없는 파이프라인, C1 코드 지도(W7 대체), C2 큰 파일 정책, C7 공개 OSS 세 크기 기준선.
- C1 진행(2026-10-21, Claude): 코드 지도 모듈과 폴더 계획 연결, 시험 5개, OSS 두 저장소 측정 완료(보강 계획 W7 메모). C7 기준선의 결정적 부분(목록, 폴더 계획, 지도 소요)은 express와 undici로 잡았고 모델이 드는 부분(초기화, 질문 200개)은 사용자 계정 실행이 필요하다. 후반에 M3 두 계층 메일 위키, M4 검색, M5 보관, C3 깊이, C5 린트(W6 대체)와 정답셋, C4 증분, C6 파일 단위 건너뛰기. §8 질문 22(색인 암호화), 23(보관 기본값), 24(tree-sitter) 답 대기. 새 의존성 없음.
- 위키 품질 루프 1차(2026-10-21 01:00~02:00, Claude): 점검판 실행기 `eval/wiki-quality/run.mjs`로 express(공개 OSS 213파일, claude-sonnet-5-5) 기준선을 세 번 돌렸다. 1차는 의미 검토의 빈 review_page가 Zod 예외로 러너를 멈춰 22페이지 중 0 게시(wiki_failed, 147회, 728만 토큰, 캐시 3%). 설계 §8 답 26을 OpenWiki 코어(`repository-semantic-review.ts` 스키마 피드백 2회, `repository-runner.ts` 모델 측 검토 실패는 페이지 skipped, 기반 장애만 fatal)와 Desktop(`desktop-features.mjs` wikiFailureChain 진단 사슬)에 구현했다. OpenWiki 75/75와 전체 3,564 통과, Desktop 위키 68 통과. 2차(답 26만)는 13분에 1페이지 게시, 치명 실패 없음이지만 160회 815만 토큰이라 멈췄다. 호출 분석으로 토큰의 84%가 작성 단계(호출당 평균 8.7만~9.7만 자 재전송, 캐시 3%)임을 확인해 설계 C8 대화 접기(`extensions/aipro-chat/openwiki-agent.js` foldWikiWire: 같은 인자의 읽기가 되풀이되면 옛 사본을 접고, 120,000자를 넘으면 최신 8개를 남기고 오래된 읽기 전용 결과를 접음, 영수증 보존, 시험 5개. 첫 판 48,000자/최신 3개는 3차에서 읽기 반복을 불러 버림)와 C10 제출 결과 분포(`runtime/run-metrics.mjs` lastTool, submissions 합산, 시험 1개)를 넣고 3차를 돌리는 중이다. C9(CLI 세션 유지로 캐시)는 설계만. 사용자 결정 없이 진행한 코어 변경은 답 26 범위뿐이며 거부권은 사용자에게 있다.

### 문서 쓰기 품질 D1~D8(2026-10-21, 사용자 요청 "Claude Code 문서 스킬 벤치마크", 설계 `docs/superpowers/specs/2026-10-21-nubi-document-writing-quality-design.md`)
- Claude Code의 docx/pptx/xlsx 스킬 관행(제자리 XML 편집과 원본 기준선 검증, 추적 변경 제안, 수식 우선과 재계산 오류 0, 구조화 덱, 양식 칸 ≠ 자료 규칙, 렌더 그림 확인)을 누비 문서 경로(document-agent, nubi-office, Task 11~13)에 적용한다. D1 OOXML 검증기, D2 제자리 편집, D3 양식 지도 세 앱, D4 채움 값 출처와 질문 묶음은 Task 11~13 안에서, D5 Word 추적 변경, D6 Excel 수식/재계산, D7 PPT 구조화 덱, D8 렌더 확인은 그 뒤. 벤치마크 30과제(앱별 10, 새로 만들기/양식 채우기/기존 수정)를 코드로 채점하고 Windows 실기기에서 재계산과 렌더를 판정한다. §8 질문 25(렌더 환경) 답(사용자 승인: Mac LibreOffice는 시험 전용, 릴리스 판정은 Windows Office 2016). 새 의존성 없음. 착수는 위키 트랙 뒤(사용자 지시 "하나씩").

### 릴리스 리듬
- 핵심 13 끝 → 1.3.0-rc1, L2 끝 → rc2, 후반 끝 → rc3, 3차 묶음 끝 → rc4, 자기 보강 루프와 워크플로우 3단계 끝 → 1.3.0 최종. rc마다 Q1의20회 측정(`node scripts/measure-wiki-durability.mjs --output verification/wiki-durability/q1-<rc>.json`), Actions 전체 게이트와 Windows 실측 항목 갱신.

> **R1, Task 8, W1 업로드(2026-10-20 10:35):** main 510b40af(60 파일). Claude 축소 게이트 QA93 9개 통과(단위 2,369개 중 2,169 통과, 실패 0). 새 워크플로 파일은 업로드 스크립트 범위에 없어 510b40af에서 빠졌고, 범위에 추가해 ebf1f014로 올렸다. Actions 게이트 정착 기록: 실행 1 설치 실패(nubi-document-agent 부재) → 2 compile 실패(nubi-browser-agent 부재) → 3 단위 실패(generated/openwiki.mjs, compile 단계 추가) → 4 단위 10건(W0 RED 시험 8건이 CI 수정 업로드에 쓸려 들어감 → main에서 제거, 업로드 스크립트 ONLY_PATHS 모드; exceljs 부재 → nubi-office 설치 추가) → 6(39356806537) 단위 1건만 실패: tests/wiki-folder-plan.test.mjs "30k repository…"가 Linux 러너에서 stage snapshot_git, gitStep history, ENOENT→wiki_git_required(macOS 통과). 체인이 npm test에서 멈춰 design과 화면 검사는 아직 러너에서 미실행. 이 1건은 Codex가 진단 경로 기록과 함께 고친다. W1 범위 시트 캡처 검수 통과. 다음: Linux 1건 → W0 → W3 → W4 → S1.

> **시간 한도 검사의 CI 판정 규칙(2026-10-20 15:20, Claude, Actions 8차 39372603559 근거):** 우분투 러너의 기준 작업 비율이 2.34배(35.8ms 대 Mac 15.3ms)로 측정돼 admission 보정이 environment_unstable(exit 2)을 냈고 체인이 멈췄다. 규칙: ① 시간 한도(300ms 채움, 프레임 비율, 입력 지연)의 **판정 환경은 목표 하드웨어에 가까운 곳**(로컬 Mac, Windows 실기기, 가능하면 Windows gates-full)이다. ② 공용 러너에서는 기능 단언(행 수, 앵커 0px, 키 안정, 초안 보존)은 그대로 판정하고 시간 한도는 비율과 함께 **기록만** 한다(verdict: unjudged, exit 0, 마커 파일과 job summary에 "미판정 N건" 표시). ③ 2배 상한과 300ms 계약은 바꾸지 않는다. ④ 러너 비율이 2배 안이면 지금처럼 판정한다. 이 규칙은 check-freeze-scenes의 environment_unstable에도 같게 적용한다(exit 2 → 기록, 기능 단언은 유지). 구현은 Codex(세 admission 검사 + calibration 모듈 + freeze 검사 + gates 워크플로 summary), Claude 지정 파일 업로드.

> **Actions 9차 결과와 셀렉터 경쟁 조건(2026-10-20 15:15, Claude, 39376995329):** 미판정 규칙은 그대로 작동했다. 보정 장면은 비율 3.46(53ms 대 15.3ms)을 기록만 했고 메일 440 수락 검사는 functionalPassed true, verdict unjudged로 지나갔다. 체인은 그 뒤 check-motion-performance의 Playwright strict mode violation에서 멈췄다. 폴더 찾기에 synthetic-999를 넣은 직후 `locator('input[type=checkbox]').check()`가 아직 걸러지지 않은 60개 행에 걸렸다. 2코어 러너에서는 점진 표시가 필터보다 늦게 반영되므로 셀렉터가 암묵적 시간 가정을 깔고 있던 것이다. 수정: 걸러진 행의 접근성 이름(`getByRole('checkbox',{name:'synthetic-999 파일 40개'})`)으로 고르게 바꿔 자동 대기가 필터 반영을 기다리게 했다. 같은 패턴의 check-ui-responsiveness(이번에는 운 좋게 통과)와 check-wiki-scope-ui(synthetic-0999)도 함께 바꿨다. 시간 한도와 기대값은 바꾸지 않았다. 로컬 세 검사 exit 0 확인 뒤 세 파일만 지정 업로드(04a7ff16) → Actions 10차 39379057057. Q2의 연속 3회 녹색은 10차부터 센다. 교훈: 공용 러너용 검사에서는 집합 셀렉터 위에 단일 동작을 걸지 않고, 걸러진 결과의 접근성 이름이나 상태 속성을 기다린다.

> **Actions 10차 결과와 미판정 규칙의 구멍(2026-10-20 15:35, Claude, 39379057057):** 셀렉터 수정은 효과가 있었고 모션 검사를 지나 메일 수락 검사까지 갔다. 그런데 all100이 334ms로 한도 309.5ms를 넘어 판정 실패했다. 보정 장면의 비율이 1.03(안정)이어서 구현이 시간 한도를 판정했기 때문이다. 구현은 "비율이 2배를 넘을 때만 미판정"으로 좁게 되어 있었는데, 보정은 한 순간의 표본이고 그 뒤 장면의 경쟁은 다를 수 있다. R1 메모의 규칙 ②(공용 러너에서는 시간 한도를 기록만)대로 `timingVerdict`를 공용 러너면 항상 unjudged로 고쳤고, 기록 사유를 reference_ratio_exceeded와 shared_runner로 구분했다. 로컬과 Windows의 판정은 그대로다. 단위 시험 `tests/admission-timing-verdict.test.mjs` 추가. 같은 업로드에 설계 §8 답 15(프리징 장면 부하 가드는 위반을 면책할 뿐 깨끗한 통과를 무효로 만들지 않음)의 검사 변경을 함께 넣는다.

> **Actions 11차 결과(2026-10-20 16:00, Claude, 39381824821, W0 포함 7a809f9d):** Linux 공용 러너에서 단위 시험 2,409개(실패 0, 건너뜀 199)가 통과해 W0의 앱 재시작/절전 주입 시험도 Linux에서 문제없다. 메일 수락 검사는 미판정 2건으로 기록되고 지나갔다. 체인은 check-motion-performance의 원시 시간 단언 `1000-folder scope has no50ms main-thread tasks`에서 멈췄다(보존된 측정값: 59ms, 53ms 두 건). 이 스크립트의 50ms 메인 스레드 단언 세 건(폴더 범위 시트, 워크플로우 mount/unmount, 실행 상태 갱신)은 `assertAdmissionTiming`을 거치지 않아 공용 러너에서도 판정됐다. 수정: 공용 러너면 세 측정을 unjudged로 기록하고 판정하지 않는다(로컬과 Windows는 그대로 판정). 전수 조사 결과 다른 fast 게이트 스크립트의 나머지 단언은 CSS 지속 시간 토큰과 기능 단언뿐이다.

> **Actions 12차 결과(2026-10-20 16:40, Claude, 39385119972):** 모션 검사는 미판정 12건으로 기록되고 지나갔다(총 미판정 14건). 체인은 wave2-ui의 check-vscode-capabilities에서 esbuild가 `../nubi-vscode/tests/host-capabilities-fixture.jsx`를 찾지 못해 멈췄다. 업로드 범위에 packages/nubi-vscode가 없어 main의 사본이 오래된 24파일이었다(빠진 17파일, 내용이 다른 13파일). 범위에 추가하고 gitignore 기준 41파일로 맞춰 올렸다. 제품 코드 변경 없음. 같은 종류의 빈틈(문서 에이전트, 브라우저 에이전트, 생성 번들, Office 의존성)이 1~4차에서도 있었으므로, 범위 밖 패키지를 참조하는 검사가 새로 생기면 업로드 범위부터 확인한다.

> **Actions 13차 첫 녹색(2026-10-20 16:50, Claude, 39387314601, main 63784e52):** gates-fast 성공, 소요 14분 54초(20분 상한 안). 미판정 16건(메일 수락 2, 모션 12, 대화 수락 2)은 summary에 기록됐고 기능 단언은 모두 판정 통과다. Q2(연속 3회 녹색)는 13차를 1회로 센다. 같은 커밋을 다시 돌려 횟수를 채우지 않고, 다음 업로드(W3 이후)의 자연스러운 실행으로 센다. 9차~13차의 교훈: 공용 러너 빈틈은 네 종류였다. ① 업로드 범위 밖 패키지(문서/브라우저 에이전트, 생성 번들, Office 의존성, nubi-vscode) ② 시간 한도의 판정(보정 비율 조건부 → 항상 미판정) ③ 원시 시간 단언(모션 50ms) ④ 집합 셀렉터 위 단일 동작(strict mode). 새 검사를 추가할 때 이 네 가지를 먼저 본다.

> **Actions 14차(2026-10-20 17:30, Claude, 39390196350, W3 31파일 081fbdcf):** gates-fast 성공, 그러나 소요 21분 37초로 **20분 상한을 넘었다**(13차 14분 54초). 미판정 16건은 같다. 늘어난 곳은 단위 시험 한 단계(506초 → 817초)이고 나머지 검사도 러너 편차로 10~20% 느렸다. 판정: 녹색이지만 Q2의 시간 조건을 못 채워 Q2 횟수에 넣지 않는다(1/3 유지). 조치: fast 게이트를 두 작업(단위 시험, UI 검사)으로 나눠 병렬로 돌린다. 한 작업의 시간이 줄어도 검사 내용과 순서, 미판정 규칙은 그대로다.

> **fast 게이트 2분할(2026-10-20 17:50, Claude, main a86a04c7, Actions 15차 39393371187):** `scripts/run-gate-part.mjs`가 check-gate-coverage와 같은 문법으로 package.json의 test:gates:fast를 펼쳐 unit(npm test)과 ui(pretest 빌드 뒤 나머지 검사를 체인 순서대로)로 나눈다. 워크플로는 matrix part [unit, ui] 두 작업을 병렬로 돌리고 Chrome 설치는 ui에만, 미판정 요약과 아티팩트는 작업별로 남긴다. package.json과 게이트 집합 검사, 체인 순서는 바꾸지 않았다. 단위 시험 `tests/run-gate-part.test.mjs`가 두 부분의 합이 체인과 같음을 고정한다. Q2의 20분 상한은 워크플로 전체 소요(두 작업 중 긴 쪽)로 잰다. 15차가 녹색이고 20분 안이면 Q2 2/3로 센다.

> **Actions 15차(2026-10-20 18:00, Claude, 39393371187, a86a04c7):** 워크플로 15분 17초. ui 작업 7분 14초 녹색(미판정 16건). unit 작업은 단위 시험 2,423개 중 1건 실패: `tests/desktop-gates-workflow.test.mjs`가 단일 작업의 `npm run test:gates:fast` 단계를 찾도록 고정돼 있었다. 시험을 분할 설계에 맞춰 갱신했다(matrix part, fail-fast false, 두 작업이 run-gate-part.mjs를 20분 안에, 단일 체인 미실행, 기존 읽기 전용/20분/7일 보존 단언 유지). 16차로 재확인한다. 교훈: 워크플로를 바꿀 때 워크플로 고정 시험을 같은 업로드에서 함께 고친다.

> **Actions 16차 녹색(2026-10-20 18:15, Claude, 39395380501, main 9cbdff66):** 워크플로 15분 28초(20분 안). unit 15분 19초, ui 6분 12초(미판정 16건). 분할 뒤 첫 완전 녹색이다. **Q2 2/3**(13차, 16차. 14차는 시간 초과로 제외, 15차는 실패). 다음 녹색은 W3-UI 후속 업로드의 실행으로 센다. unit 작업이 이제 임계 경로(약 15분)이므로, 단위 시험이 더 늘면 unit을 다시 둘로 나누거나 느린 네이티브 시험을 Windows gates-full로 옮기는 것을 검토한다.

> **Actions 17차 녹색(2026-10-20 20:35, Claude, 39413484715, W3-UI/W4/S1 59파일 aefa2e13):** 워크플로 16분 24초(20분 안). unit 16분 19초(미판정 0), ui 6분 50초(미판정 16건). **Q2 충족: 연속 3회 녹색(13차, 16차, 17차)이며 모두 20분 안.** 14차는 시간 초과로 제외, 15차는 실패였다. 남은 주의: unit 작업이 15분 19초 → 16분 19초로 늘어 여유가 약 3.5분이다. 단위 시험이 더 늘기 전에 unit을 다시 둘로 나누거나(예: wiki-* 시험과 나머지), 네이티브 실행 시험을 Windows gates-full로 옮기는 결정을 Q8(터미널 힙)과 함께 다룬다. 공용 러너에서 unit이 20분을 넘기면 그 실행은 Q2 재판정 대상이 아니라 분할 과제의 신호로 본다.

> **사용량 초기화 업로드와 Q3 실제 연결 결과(2026-10-20 21:30, Claude, main d0643712, Actions 18차 39425332493):** 사용량 초기화 9파일과 설계 §8 답 17을 올렸다(Claude 검토: 집중 4개, 화면 검사 1280/440/360, 게이트 집합 ok). **Q3는 보류**다. Claude 업로더에 `check-release-inputs.mjs`를 실제로 연결해 후보 트리(main 기준 임시 트리)로 돌리자 22건이 나왔고 세 종류 모두 검사기의 모델이 실제 후보 트리와 다른 데서 온다. ① `eval/hard-10/run.mjs`의 `../candidate.mjs` 같은 상대 import를 파일 위치가 아니라 패키지 루트 기준으로 풀어 `packages/candidate.mjs/package.json` 같은 형제 패키지로 오인(8건)과 `packages/hard-10/fixtures.mjs` 같은 참조 누락(2건). ② `generated/*.mjs` 6건은 gitignore된 빌드 산출물로 CI가 compile과 pretest로 다시 만드는데 검사기가 트리 안 존재를 요구. ③ `node_modules/...` 참조 4건은 CI가 npm ci로 설치하는 의존성인데 파일 존재를 요구. Codex의 로컬 통과는 작업 폴더 바이트로 만든 임시 트리(generated와 node_modules 포함)여서 통과한 것이다. 조치: 업로더 게이트는 `RELEASE_INPUTS_GATE=1`일 때만 돌도록 두고(기본 꺼짐), Windows workflow 단계 추가도 검사기 v2가 실제 후보(main)에서 exit 0을 낼 때까지 미룬다. 기대 동작: 상대 import는 파일 디렉터리 기준으로 풀고 형제 패키지는 file: 의존성과 패키지 루트 밖으로 나가는 경로만, generated는 산출물이 아니라 빌드 입력(entryPoints와 import 그래프)을 요구, node_modules는 package.json 의존성과 lockfile 존재로 확인, 회귀 시험은 node_modules와 generated가 없는 후보 트리로.

> **Actions 18차 녹색(2026-10-20 22:10, Claude, 39425332493, d0643712):** 워크플로 16분 16초(20분 안). unit 16분 12초(미판정 0), ui 8분 07초(미판정 16건). 16차, 17차, 18차 연속 녹색으로 Q2는 계속 충족. ui 작업이 6분 50초 → 8분 07초로 늘었다(사용량 초기화 화면 검사는 fast 체인에 없으므로 러너 편차). unit 여유 약 3.5분 그대로.

> **Actions 19차 녹색(2026-10-21, Claude, 39450133722, Task 9 런타임 756ab00d):** 워크플로 10분 39초(빠른 러너). unit 10분 34초(미판정 0), ui 7분 32초(미판정 16건). 16~19차 연속 녹색.

> **Actions 20차 녹색(2026-10-21, Claude, 39452814020, C1 코드 지도 a837ad61):** 워크플로 11분 54초. unit 11분 50초, ui 7분 02초. 16~20차 연속 녹색.

> **Actions 21차 녹색(2026-10-21 01:44~02:00, Claude 업로드, 39460122787, Codex Q3 v2/Q6/Q7+G5/Q8 93파일 adc04f4c):** 워크플로 15분 35초. unit 15분 35초(새 안전 회귀 107개, 힙 측정, 디자인 규칙 시험 포함), ui 9분 24초. 16~21차 연속 녹색. Codex의 입력 검사가 막혔던 병행 위키 5파일은 다음 업로드(위키 품질 루프 1차)에 포함한다.

## Task R1: 게이트를 GitHub Actions로

> 로컬 구현/보고 완료: [R1 보고서](../../R1-1.3.0.md). fast14분1초/집중33/모션161/실제Electron8, 장면부하양쪽exit2. 최종 Actions 실행은 Claude 업로드 뒤 기록한다.

**Files:**
- Create: `.github/workflows/nubi-desktop-gates.yml`
- Modify: `.github/workflows/nubi-desktop-windows.yml`(`gates-full` 작업 추가, 패키징과 병렬), `packages/nubi-desktop/package.json`(`test:gates:fast`, `test:gates:electron` 분리 스크립트), `packages/nubi-desktop/docs/CI-GATES.md`(어떤 검사가 어디서 도는지 표)

**Interfaces:**
- Produces: `npm run test:gates:fast` = `npm test` + `design:check` + Electron이 필요 없는 화면 검사(forms, mail, modals, responsiveness, shared, workflow-ui, motion-performance, wave2-ui, workspace-ui, icons-ui, chat-ui, irreversible-ui, community-wiki-ui, profile-wiki-ui, activity-readability, review-failure-ui). `npm run test:gates:electron` = `build:electron` + Electron 검사(ui, skills-ui, agent-ui, live-web, lifecycle, all-surfaces, output-cards, development-execution, mcp-approval, Task 8의 `check-electron-workflow`). 기존 `test:gates`는 둘을 이어 부르는 별칭으로 남긴다.
- `nubi-desktop-gates.yml`: `push: branches: [main]`, `pull_request`, `workflow_dispatch`. ubuntu-latest에서 `test:gates:fast`(Playwright Chrome channel, `npx playwright install chrome` 또는 러너 기본 Chrome). 실패 시 `verification/**/*.png` 아티팩트 7일. 목표 20분 이내.
- `nubi-desktop-windows.yml`: `gates-full` 작업(windows-latest)이 `test:gates:fast` + `test:gates:electron`을 돌린다. 패키징 작업은 `needs: [windows-shell-probe]` 그대로, 초안 릴리스 저장 단계만 `needs`에 `gates-full`을 더해 게이트 실패 시 설치 파일을 초안으로 남기지 않는다.

- [x] **Step 1: 분리 스크립트와 로컬 확인** — 두 스크립트가 기존 `test:gates`와 같은 검사 집합을 빠짐없이 나눠 갖는지 `scripts/check-gate-coverage.mjs`(package.json을 읽어 집합 비교)로 확인. 실패하는 상태에서 시작해 통과시킨다.
- [x] **Step 2: 워크플로 파일 작성** — 위 인터페이스대로. Chrome channel이 ubuntu 러너에 없으면 `npx playwright install chrome`을 넣고, 캡처 아티팩트 보존 7일, `concurrency`로 같은 브랜치 중복 실행 취소.
- [ ] **Step 3: Actions 최초 결과 기록** — 최신 사용자 지시로 로컬 보고 뒤 멈추지 않고 Task 8부터 계속한다. Claude가 main에 올리면 `nubi-desktop-gates.yml`이 처음 돈다. 실패하면 로그를 보고 고친다(검사 자체를 약화하지 않는다). 통과 기준: fast 20분 이내, Actions 결과를 `docs/CI-GATES.md`에 run id와 함께 기록.

---

## Task 10(바뀜): 릴리스 준비 — 문서, 버전, 릴리스 노트

**Files:**
- Create: `packages/nubi-desktop/docs/HOTFIX-1.3.0.md`(릴리스 노트: 2차 벤치마크, 워크플로우 1단계, 양식, 알려진 한계), `packages/nubi-desktop/docs/INSTALL-AND-UPDATE-1.3.0.md`(1.2.9 문서와 같은 절 구성), `packages/nubi-desktop/docs/WORKFLOW-AGENT-2026-10.md` 보강(형식 표, 템플릿 문법, 어댑터 표, dry-run과 감독 실행, 루틴 연결, 양식, 한계)
- Modify: 버전 1.2.10 → 1.3.0(패키지 네 곳, 잠금 파일 일곱 줄, 앱 이름 두 곳, 작업 탭 설명, README/AGENTS/브랜드 문서. `grep -rn "1\.2\.10"`으로 남은 곳 0 확인), `AGENTS.md`에 "워크플로우 순서는 호스트가 강제, 단계 출력은 스키마" 한 줄

- [ ] **Step 1: 버전과 문서** — 위 파일. 릴리스 노트는 사용자 관점 문장(한국어, 가운뎃점 금지)과 "알려진 한계"(Windows Office COM 실측 전, 저작 UI는 다음 버전, 루틴 무인 실행은 감독 통과 뒤).
- [ ] **Step 2: 확인** — `node scripts/check-release-flow-ui.mjs`, `npm run test:gates:fast`, 버전 grep 0건. 보고 뒤 멈춤(Claude 업로드).

---

## Task R2: 릴리스 브랜치와 CI (Claude 수행)

- [ ] **Step 1: 번들 입력 대조** — 먼저 `node packages/nubi-desktop/scripts/check-release-inputs.mjs --repo <후보 Git 저장소> --ref <commit/tree> --source-root <작업 폴더> --output <검증 JSON>` exit0을 확인한다.  `generated/source-inputs.json`의 모든 파일(누비 Office worker 네 개 포함)을 릴리스 커밋과 해시 비교. 다르면 커밋을 다시 만든다.
- [ ] **Step 2: 브랜치 푸시** — 이전 릴리스 커밋을 부모로 임시 인덱스와 `commit-tree`로 커밋을 만들고 `codex/nubi-desktop-windows-release-1.3.0`으로 푸시(`"${C}:refs/heads/..."`). 업그레이드 기준은 1.2.9 검증본(run 38856253676)의 SHA-256.
- [ ] **Step 3: CI 확인** — `gates-full`, 설치, 업그레이드, 재설치, 제거 통과. 실패하면 원인을 Codex에 넘기고 고친 뒤 다시 푸시. 통과하면 초안 릴리스 `nubi-desktop-v1.3.0-run-<id>`와 설치 파일 SHA-256을 기록.
- [ ] **Step 4: 공개(사용자 지시 뒤)** — 초안을 사전 배포 릴리스로 공개, 릴리스 노트는 `HOTFIX-1.3.0.md`. 사용자가 원하면 `plaire48/ai_workspace` 카탈로그 게시(소스 묶음 `source-export`, 검증 기록, 태그).

## 완료 기준

- main에 Task 1~16과 R1이 있고 `nubi-desktop-gates.yml`이 main에서 통과한다.
- 릴리스 브랜치 CI가 `gates-full`까지 통과하고 초안 릴리스가 있다.
- 1.3.0 릴리스 노트에 포함 범위와 알려진 한계가 적혀 있다.
- 사용자 실측 항목(Windows 11 Office COM, 실모델 sol/luna)은 릴리스 노트의 "실측 전" 목록에 남기고 공개 여부는 사용자가 정한다.

## 수용 기준 달성 과제 Q1~Q8 (2026-10-20 사용자 지시 "배포 전에 반드시 해결, 벤치마킹")

수용 기준을 사람의 기억이 아니라 검사와 절차로 만든다. 벤치마크는 각 항목에 적는다.

### Task Q1: 위키 내구성 수치 (= W0 완료 조건)
- 벤치마크: Temporal의 재시도 정책과 heartbeat, Sidekiq의 지수 백오프, Chrome 이어받기.
- 산출: `scripts/measure-wiki-durability.mjs`(합성 11소스 코퍼스, 중단 주입 무작위 20회, "사람 없이 완료율", 평균 재개 횟수, partial 게시 횟수)와 `docs/OPENWIKI-REINFORCEMENT-2026-10.md`의 표. 기준 90% 이상. 게이트에는 8종 시험만 넣고 20회 측정은 rc마다 돌린다.
- [x] 측정기와 네이티브8종 및 경계/음성 시험 구현. 완료 상태라도 Claims/원문 검증 실패와 사람 재시도는 완료율에서 제외하며, 관측 누락은0으로 만들지 않는다. 기존 고정20회는 일반 게이트에서 분리했다.
- [x] 최종35파일 시점의 무작위20회 측정: 시드3799100702,20/20=100%, 평균 체크포인트 재개0.45, partial 게시0. 합성 모델/가상 백오프, 실제 Desktop와 native 러너/Claims/Git/SQLite/게시/자기 호스트 재시작 경계다. 물리적 절전/회사 모델/Windows 성적이 아니다. [W0/Q1 보고](../../OPENWIKI-W0-2026-10-20.md).
- [x] W0 최종 전체 게이트와 보고 판정. 사용자수용(2026-10-20): main7a809f9d, Claude코어100/Desktop위키252(2제외), 독립Q1같은시드20/20, 답15 적용 w0-claude-2-20261020 양쪽exit0, 위반0. 다음은 수용 전 기록:  이전 `w0-q1-release-gates.log`는 CI 지정 보정으로 중단했다. fresh 집중31개/디자인/1280 및440 화면 통과. `w0-final-freeze.log`는 부하3.75에서 시작했으나 장면 중4.0 초과, Chrome12/Electron12 모두 성능 위반0, 양쪽exit2다. W0 로컬 판정은 미완료, W3 미착수다. 이전 환경 미판정(exit2)을 통과로 합산하지 않는다.


### Task Q2: CI 녹색 기준과 보호 (= R1 완료 조건)
- 벤치마크: GitHub Actions 권장(required status checks, concurrency 취소, 실패 아티팩트), Claude Code 플러그인 평가의 "통과율을 재서 유지".
- 산출: main 보호 규칙에 `Nubi Desktop gates` 필수 체크(설정은 사용자, Claude가 안내), `docs/CI-GATES.md`에 실행 이력(run id, 원인, 수정)과 "연속 3회 녹색" 기록, fast 게이트 20분 이내 유지(초과하면 검사 분할).

Q2 수용(2026-10-20 사용자 확정): Actions13/16/17차3/3, 모두20분 이내.17차39413484715는 전체16:24, unit16:19(미판정0), ui6:50(미판정16)다. main 보호 설정과 Windows gates-full/실기기 수용은 별도다. 상세는 CI-GATES.md.

### Task Q3: 릴리스 입력 검사 스크립트 (= R2 Step 1 자동화)
- 벤치마크: 재현 가능한 빌드(소스 묶음 해시 대조, 1.1.0 때 절차), Debian/Nix식 입력 고정.
- 산출: `scripts/check-release-inputs.mjs`: 릴리스 커밋(또는 트리)에 데스크톱이 참조하는 형제 패키지 전부(스크립트와 런타임의 `../<pkg>` 참조를 스캔해 자동 목록화), `generated/source-inputs.json`의 파일 전부, 두 워크플로 파일, HOTFIX와 INSTALL 문서가 있는지 단언. 업로드 스크립트와 릴리스 브랜치 생성 절차가 이 검사를 먼저 돈다. 1.2.9에 nubi-document-agent가 빠졌던 재발 방지.

Q3 로컬 구현(2026-10-20): 검사기/Windows compile 뒤 preflight/AGENTS 업로드 전 강제 절차를 구현했다. 독립 검토 Important 1건(사전 번들 결과가 원본 누락을 가림)을 실패 시험 뒤 고쳤다. 새12개/관련16개, wall0.419초 통과. 현재 번들 입력971개와 사전 번들 원본/전이 import까지1,215개를 복사한 임시 Git 트리의 SHA 전부 일치, 형제6패키지 자동 발견, document-agent package.json 누락 주입은 exit1. 원격 업로더의 실제 호출/후보 릴리스 트리 검사는 Claude가 수행해야 하며, main에 자동 푸시하거나 아직 릴리스한 것으로 표시하지 않는다. [한 쪽 보고](../../RELEASE-INPUTS-Q3-2026-10-20.md). Windows 실행 자체와 Q2 main 보호 설정은 별도다.

Q3 v2 후속(2026-10-20 Codex): v1 로컬 후보 통과는 실제 업로더 후보 통과가 아니었다. 실패22건을 보존하고 파일 기준 상대 import, 생성기/entryPoints 그래프, package/lock 검사로 수정했다. 생성기/잠금/원본 누락과 verification 입력 회귀를 포함해집중24/24, wall0.445초. 실제 Claude 업로더를RELEASE_INPUTS_GATE=1/--push없음으로 돌려main d0643712 기준8파일 및Windows단계포함9파일 후보각exit0. 최종원본/SHA/스냅숏은Q3 v2 보고서에. 업로더 기본 켬/실제업로드는Claude, Windows실행은미검증.

### Task Q4: 실모델 실측 과제 확장 (= 수용 기준 4)
- 벤치마크: SWE-bench식 "전에 못 풀던 과제"와 "회귀 과제" 분리, 두 모델 비교로 하네스 결함 가르기(기존 sol/luna 절차).
- 산출: `eval/cases`에 W-01(공개 저장소 위키 초기화: 커버리지 비율, 완료율, 소요), F-01(시범 워크플로우 감독 실행: 단계 완료, 승인 카드, 보고서), 기존 20과제와 함께 `docs/LIVE-EVAL.md` 절차 갱신. 실행은 사용자(회사 계정), 채점은 하네스. 잘못된 완료 0이 기준.

### Task Q5: Windows 실기기 체크리스트와 자동화 가능한 부분
- 벤치마크: 기존 Windows 워크플로의 UIA 검증(nubi-desktop-uia.yml)과 설치/업그레이드/제거 검사, Playwright Trace Viewer식 단계별 증거.
- 산출: `docs/WINDOWS-CHECKLIST-1.3.0.md`(Office COM 적용과 검증, CMD와 PowerShell, VS Code 호스트 가림, 외부 브라우저 페어링과 라이브 뷰, 위키 초기화 중 절전과 재개, 프록시와 사내 CA, VPN 재연결, 큰 저장소 범위 시트) 각 항목에 "자동(CI 어느 단계)"과 "수동(사용자, 증거 캡처 경로)" 표시. 자동화 가능한 것(절전 모사, 큰 저장소 범위)은 Windows 워크플로 단계로 추가.

### Task Q6: 안전 회귀 묶음 하나로
- 벤치마크: Claude Code의 지시문 경계와 권한 모델, OWASP의 "로그와 캡처에 비밀 금지" 원칙.
- 산출: `npm run test:safety` = 도구 규칙 크기와 압축 시험, 되돌리기 어려운 작업 분류, MCP 승인과 항상 허용 제한, 워크플로우 externalWrite never, 캡처의 로그인 화면 생략(L2 뒤), 업로드 제외 규칙 검사(`scripts/check-upload-exclusions.mjs`: 트리에 .har, .webm, .env, 개인정보, verification 없음), 사내 데이터 fixture 금지 검사(합성 접두 규칙). fast 게이트에 포함.

Q6 착수(2026-10-20): 설계§8 답17 승인에 따라 증분/전체 두 범위와127자료 내용 검토/선언을 구현한다. 기존789 verification 파일은 보존하며 릴리스 번들에서만 제외한다. 새 자료는synthetic-/합성- 접두를 쓴다. 과거 질문17 대기는 해소됐다.


Q6 검사 결과(2026-10-20 Codex):127자료 전체 내용/패턴 검토에서122통과/5파일 전화번호·사번 형식 차단. 합성 양성 평가 자료지만 답17의 기준선 없는 원칙 때문에 안전 선언/예외를 만들지 않았다. 설계§8 질문18에 실행 시 합성 값 생성 방식의 좁은 평가 로더 보강을 질문했다. 사용자 답18로 자리표시자 저장/실행 시 동일 합성 값 복원 보강이 승인돼 Q6를 재개한다. 검토/패턴 예외 없이 기존 입력/정답 동등성을 시험한다. Q3 v2인계는완료한다.

Q6 전체 검사 미결(2026-10-20): 답18 적용으로127/127패턴 통과,5코퍼스 전체 SHA 동등성 유지. 실제 후보 범위1은0건. Git전체 범위2는6,202파일/789증거제외 후84형식61파일이 남아 공개 라이선스/C2PA연락처와 비배포 테스트 양성 자료의 판정/실제 payload 범위를 설계§8 질문19에 기록했다. 사용자 답19 승인으로 실제payload전체 차단/전체소스감사/공개귀속연락처 기록·보존을 구분해 Q6를 재개한다. 자격값/사용자 개인정보는 예외 없이 차단한다.

### Task Q7: 디자인 규칙 검사 공통화
- 벤치마크: Claude Code의 디자인 시스템 토큰 규칙("hex 금지, 토큰만"), 기존 `design:check`.
- 산출: `scripts/design-rules.mjs`(원시 코드 0, 채움 버튼 1개 이하, 제목 중복 0, 색 배경 중첩 0, 토큰만, 모션 토큰과 모션 감소 ≤120ms)를 모든 화면 검사가 공유해 호출. 지금은 워크플로우 검사에만 있다. 모달 열린 사이드바 글자 겹침과 토큰 밖 duration 5곳도 이 과제에서 닫는다.

### Task Q8: 메모리 누수 측정과 상한
- 벤치마크: Chromium의 힙 스냅숏 비교(두 번 수행 뒤 증가분), Electron의 `process.memoryUsage`와 `--expose-gc` 시험 관행.
- 산출: `check-freeze-scenes`에 장면 반복 2회 뒤 명시적 GC 후 힙 증가분을 기록하고, 기준선 측정 뒤 상한(예: 반복당 증가 10% 이하)을 둔다. P1 보고서의 명령 출력 440 장면 66→132MiB 표본을 먼저 재현한다. 누수가 확인되면 원인(출력 투영 캐시, 캡처 보관)을 고친다.

- Q8 보고 필수(2026-10-20 사용자 지시):17차 unit16:19로20분까지 여유3:41이다. 추가 단위/네이티브 시험의 집중 wall과 실제 CI 소요를 기록하고, ① unit을 균형 있게 재분할하는 안 ② 실제 네이티브 실행 시험을 Windows gates-full로 옮기는 안을 비교한다. 기존 검사를 빠짐없이 보존하는 목록, Linux/Windows별 실행 책임, 예상이 아닌 측정 소요, 설치/릴리스 차단 유지 여부와 권장안을 보고한다. 이번 기록으로 이관/분할을 먼저 구현하지 않는다.

**순서 배치:** Q3, Q6, Q7, Q8은 작고 재발 방지 효과가 커서 S1 뒤 바로(S1 → Q3 → Q6 → Q7 → Q8 → 9 → 11 → 12 → 13). Q1은 W0 완료 조건, Q2는 R1 완료 조건. Q4와 Q5는 rc1 직전(13 뒤). 사용자 실측은 rc1 뒤.

## 릴리스 수용 기준 보강 (2026-10-20, Claude: "반드시 고칠 것"과 "반드시 확인할 것")

**차단(이것이 안 되면 1.3.0 공개 금지)**

이 절이 이전의 "실측 전 목록을 남기고 공개 여부는 사용자가 정한다" 및 알려진 한계 문구보다 우선한다. 비공개 초안/rc 설치판으로 실측하는 절차와 최종 공개를 구분하며, 실측 전 목록이 남아 있으면 최종1.3.0은 공개하지 않는다.
1. 위키 내구성: 중단 주입 8종 시험 통과, 합성 코퍼스 20회 "사람 없이 완료율" 90% 이상, partial 게시와 재개 확인(W0).
2. CI: `nubi-desktop-gates.yml`이 main에서 연속 3회 녹색(단위, design, 화면 검사가 러너에서 실제로 실행), 릴리스 브랜치의 `gates-full`과 설치/업그레이드/제거 통과(R1, R2).
3. 릴리스 커밋에 데스크톱이 참조하는 형제 패키지 전부 포함(nubi-office worker, openwiki, nubi-vscode, nubi-document-agent, nubi-browser-agent)과 `generated/source-inputs.json` 해시 대조. 1.2.9에 nubi-document-agent가 없던 전례.
4. 실모델 실측: `docs/LIVE-EVAL.md` 과제 20개에 워크플로우 시범(감독 실행 1회)과 실제 공개 저장소 위키 초기화 1회를 더해 sol과 luna로 측정. 잘못된 완료 0.
5. Windows 11 실기기: Office COM 적용과 검증(Task 13), 터미널 CMD와 PowerShell, VS Code 호스트 능력 가림, 외부 브라우저 연결기 페어링과 라이브 뷰, 위키 초기화 중 절전과 재개. 릴리스 노트의 "실측 전" 목록은 비어 있어야 공개.
6. 안전: 도구 규칙 크기와 압축 시험 유지, 되돌리기 어려운 작업과 외부 반영은 모든 모드에서 승인, 캡처에 로그인 화면 없음, 업로드 제외 규칙(.har, .webm, .env, 개인정보, verification)과 사내 데이터 fixture 금지 유지.
7. 화면: 새 화면과 고친 화면이 §3.12 디자인 규칙(주변 UI 양식, 원시 코드 0, 채움 버튼 1개)과 모션 규칙(토큰, 180ms 상태, 모션 감소)을 통과하고 1280/440 캡처가 보고에 있음.

**Claude Code 대비 반드시 채울 것(3차 묶음 앞머리, 순서 고정)**
- 14 주장 대조(완료 문장과 영수증: 거짓 완료 억제), 26 관찰 내용의 지시문 경계(안전), 18 프로젝트 훅(편집 전후 검사), 20 `wait_for_output`과 21 범위 읽기(긴 작업 안정), 17 탐색만 모드, 22 하위 에이전트 유형, 31 `경로:줄` 링크, 27 도구 카탈로그 지연 로딩. 나머지 3차 항목은 그 뒤.

**실측으로만 확인되는 것(공개 전 사용자 체크리스트)**
- 회사 프록시와 사내 CA에서 모델 연결과 재연결, VPN 끊김 뒤 위키 재개, Office 2016과 NASCA 환경의 COM, 큰 사내 저장소(2만 파일 초과)의 초기화 시간과 범위 시트.

**알려진 위험(추적 중)**
- 명령 출력 5,000줄 장면에서 JS 힙이 66→132MiB로 늘어난 표본(메모리 누수 가능성, P1 보고서). 측정 뒤 상한을 정한다.
- 프레임 비율 지표는 개발 Mac에서 색인 부하에 민감. CI 전용 러너의 수치로 판정.

## 위험

- windows-latest에서 `test:gates:electron` 시간(로컬 45분)이 길어 CI가 2시간에 가까워질 수 있다 → 패키징과 병렬 작업으로 두고, 느린 검사는 run 시간을 `CI-GATES.md`에 기록해 다음 버전에서 나눈다.
- Office가 없는 러너에서는 `office.apply_form` COM 경로를 검증하지 못한다 → OOXML 대체 경로만 CI, COM은 사용자 실측 체크리스트.
- 아티팩트 한도 → 게이트 캡처는 실패 시에만, 7일 보존.

### P1 재측정 인계(2026-10-19, Q9 대기)

현재 소스 고정 1,051개 해시로 q8-recheck 48행 완료. Chrome10/12(exit1), Electron9/12(exit1), 회귀9개 묶음 통과(집중 단위28 포함). 첫 표시4행, 최근/이전40개 300ms와 위치 이동0px 유지. PERF/CPU 문서를 현재48행으로 갱신했다. 네이티브 첫 입력 초기화의 호스트 준비 범위가 필요해 설계 §8 질문9를 추가했다. 원인 미확정 나머지 실패도 유지하며 P1 Step2/3, P2, QA89와 업로드는 미완료다. 답변 전에 준비 순서나 판정 경계를 변경하지 않는다.

> P2 최종 로컬 완료(2026-10-20, Codex): Q11 공통 훅, 메일 100행과 중복 프레임 대기 수정을 포함한다. qa91-19 전체 test:gates exit 0, 검사 입력 1,455개 변경 0. 단위 2,141개 통과 / 기존 제외 200개 / 실패 0개. 모션 157개, 전체 화면 117개, Electron 개발 흐름 8개와 MCP 승인, Chrome 12장면과 Electron 12장면 모두 통과했다. 1280/440 모달, 날짜, 파일 변경 카드와 전환 프레임은 docs/MOTION-1.3.0.md 최종 절에 있다. 보고 뒤 멈춤. Task 8, R1, 업로드와 릴리스는 시작하지 않았다.

Q6 답19 구현 결과(2026-10-20): 실제 Mac arm64 electron-builder --dir payload의17,699검사 단위(ASAR 내부16,784개)에서 공개 귀속110발견을 기록·보존했다. 정해진 OpenSSH 알고리즘 문자열 오인식은 회귀로 정정했으나 이메일573/전화번호6형식이 남아 실제 차단은 유지된다. Windows 판정으로 표시하지 않는다. §8 질문20에 공개 의존성의 발견별 출처/SHA/유형 검토 절차를 질문했고, 답 전 Q6 완료 표시/범위 변경과Q7 이후는 중단한다. 실제 값은 로그에 쓰지 않는다. Q3 v2 frozen9파일의 독립 인계는 가능하다.

Q6 질문20 사용자 답: 발견별 공개 근거 검토 적용 승인. 정확한 파일 SHA/발견 지문/종류/공개 출처를 묶고 변경/미확인 항목은 계속 차단한다. 전체 파일 검사는 유지하며 Q6 재개 가능.

Q6 로컬 완료(2026-10-20): 답17~20 구현. 127선언 통과, 원래5코퍼스 전체 SHA 동등, 실제 Mac payload17,699검사/ASAR16,784에서 차단0(exit0), 공개 귀속110/개별 검토579 분리 보존. 공식 캐시 원본의 무결성과251파일/269고유 값579발견 대조0실패. 별도 Q6 한 쪽 본문/127행 부록과 지정 업로드 SHA 명세에 인계한다. Windows/Actions 판정은 별도이고 새 발견은 차단한다. Q7 재개 가능.

Q7 진행/설계 질문21(2026-10-20): 공통 규칙 모듈/단위5개/브라우저 계약7개 통과, 릴리스 검사35곳에 공유 캡처 검사 연결. 모션 alias5곳을 기존 workspace-motion.css 토큰으로 교체했다. 복합 대화의 수정 반영/실행 승인/작성기 전송이 동시에 있는 check-shared-ui 명령 장면은 primary3으로 실패했다. 독립 작업 영역별1개의 정의를 §8 질문21에 올렸으며 답 전 한도/제품 행동을 임의로 바꾸지 않고Q7/Q8을 중단한다. Q6 frozen 명세는 별도 인계 가능하다.

Q7 질문21 사용자 승인: 독립 작업 영역별1개. 최상위 모달은 전체1개, 기존 카드/폼/작성기는 각 활성 주 동작1개이며 비활성은 선택 수에서만 제외한다. 같은 영역 복수 강조와 다른 디자인 위반은 계속 차단한다. Q7 재개 가능.

Q7 로컬 완료(2026-10-21): 답21 적용, 공통 규칙/성공 캡처35곳 연결. 위키 설정의 중복 강조는 기록 버튼을 기본 테두리로 수정하고 회귀를 추가했다. Node16/16, 새 브라우저 계약12, 모달40, 공유 대화38, 메일11, Electron117, 모션161, design/게이트 집합 통과. 1280/440 설정/위키 설정을 직접 확인했다. 48파일 SHA/frozen과 한 쪽 보고서 docs/DESIGN-Q7-2026-10-20.md로 인계한다. 전체Actions/Windows는 별도. Q8 진행 가능.

Q7 최종 인계(2026-10-21): 실제 모션 감소 sidebar CSS 회귀를 더해 브라우저 계약13개/1.31초. 기존 animation:none 우선으로 이동0을 확인했고 제품 모션 추가 수정은 없다. 최종48파일은 q7-final-upload-inputs.json/q7-final-frozen이며 이전q7-upload-inputs.json은 대체됐다. Q8 변경이 들어간 현재 check-freeze-scenes를 Q7 묶음에 섞지 않고 Q7 원래 바이트를 고정했다.

Q8 구현/집중 인계(2026-10-21): renderer GC+동일 장면2반복/반복당10% 한도, 첫24장면72GC표본 모두상한안. 첫전체명령은 위키observer오류와Electron69ms/메일60.8ms 때문에실패였고 통과로소급하지 않는다. 제거후observer수정/회귀3개, 접힌미니지도JS요청지연/재펼침동일DOM을고쳤다. 수정뒤위키4/전환4/440워크플로우2환경별exit0, Node35/35/design/게이트집합/모션성능통과. 메일은부하4.17~7.35에서3회시간미판정(exit2)이며50ms한도불변. 전체최종소스Actions/Windows/메일시간판정은남긴다. docs/MEMORY-Q8-2026-10-21.md와12파일SHA로인계, CI구성은바꾸지않고실측비교만보고한다. Claude의main756ab00d Task9런타임과G0/G5설계를보존한다.

Q3~Q8 후보 재대조(2026-10-21): 비공개main a837ad61(Task9런타임/C1 보존) 위 지정91파일의 실제Claude업로더 dry-run이exit0였다. 빌드입력973/전체입력1095, 금지경로0. 최종후보/SHA는 q3-q8-combined-upload-inputs.json에 고정하고 원래d064기준 Q3/Q6/기존Q7단독명세와 구분한다. 업로드/릴리스는Claude. Q8 메일시간미판정과 새G5/Task9 UI는완료로소급하지 않는다.

Q7 G5/Q8 재개(2026-10-21): 기존 공통38개 흐름/39캡처에 접근성 이름, 실제 모달 양방향Tab, 본문4.5/공통muted3 대비를 연결했다. 글자675개/모달11회, 위반0/미측정0/선언예외0. 브라우저 계약31개1.88초, 공유화면46.75초(감사1.019초), 새Node/네이티브단위0. Q8 남은메일1280 격리Electron은 입력41ms/50ms, 작업/프리징/힙위반0, exit0으로 판정됐다. 원래미판정3회/첫전체실패는 보존하며 전체최종소스Actions/Windows는후속이다. 최신SHA/frozen은 q3-q8-g5-upload-inputs.json이며 기존91파일명세를덮어쓰지않는다. 업로드는Claude.

지정 후보 차단(2026-10-21): G5 포함93파일의 첫 실제Claude업로더 대조에서 `release_input_changed`4건이 나왔다. 병행 작업이 이어져 다음 대조에는 `runtime/openwiki-source.ts`까지5건이었다. 정확한 후보별 수치/경로는 최신 SHA명세와 입력 검사 JSON을 따른다. main a837ad61에 없는 병행 위키 문맥 접기/검토 복구 변경(`extensions/aipro-chat/openwiki-agent.js`, `packages/nubi-desktop/runtime/desktop-features.mjs`, `packages/openwiki/src/agent/repository-runner.ts`, `packages/openwiki/src/agent/repository-semantic-review.ts`)이 현재 compile 입력에 포함된 원인이다. 이 병행 파일들을 임의로 업로드 목록에 넣거나 비교에서 빼지 않았다. 최신93파일 명세는 **로컬 검토용, 후보 입력 게이트 차단** 상태다. 이전91파일 실제후보 exit0는 이전소스 증거로만 유지한다. Claude가 병행 변경을 검토해 같은 후보에 정합시킨 뒤 실제 입력 게이트를 다시 돌려야 한다. 상세 SHA는 `.superpowers/sdd/2026-10-20-release-acceptance/q3-q8-g5-parallel-inputs.json`.
