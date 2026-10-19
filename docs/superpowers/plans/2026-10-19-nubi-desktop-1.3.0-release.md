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
| OpenWiki 보강 W1(큰 저장소: ignore 먼저, 폴더 집계, 핵심 폴더 우선), W3(생성 동시성과 모델/effort 설정), W4(커버리지 감사와 초기화 보고서), S1(검색 정답셋과 지표, 색인 전체화, 문맥 청크, 근거 표시) | 미착수(2026-10-19 사용자 결정 "개선사항에 포함", 계획 `2026-10-19-nubi-openwiki-reinforcement.md`) |
| Task 10 → 릴리스 준비(문서, 버전, 릴리스 노트) | 미착수 |

| 제외(1.3.x 또는 1.4.0) |
|---|
| 워크플로우 2단계 저작 UI(`2026-10-19-nubi-workflow-agent-phase2-authoring-ui.md`) |
| 2차 계획의 3차 후보 Task 14~34, 2차 Task 6 보류 항목 |
| 메일/A2A 트리거, 대시보드, 드래그 편집 |
| OpenWiki 보강 W2(Office/PDF 입력)와 S2(하이브리드 임베딩, 리랭크) → 1.3.1 |

**진행 순서(2026-10-20 사용자 지시 "시나리오는 치우고 개발 우선, 최대한 1.3.0으로 개발해 배포"):** P2 마무리 → R1(CI 게이트를 먼저 올려 로컬 전체 배치를 없앤다) → 8 → W1 → W3 → W4 → S1 → 9 → 11 → 12 → 13 → 10(릴리스 준비) → R2 → 공개(사용자 지시). 1.3.1 이후 논의는 멈추고 문서는 Task마다 보고서 한 장만. Claude 업로드 게이트는 R1 전까지 단위 + design + 해당 Task 화면 검사 + Codex 전체 게이트 결과로 줄이고, R1 뒤에는 Actions 결과로 판정한다. P1, P2를 새 화면(8, 9, 11~13)보다 먼저 해서 토큰과 패턴 위에 새 화면을 만든다. R1은 Task 8 뒤 언제든 먼저 해도 된다. 업로드는 Claude가 하되, 로컬 전체 배치 대신 **집중 시험 + 캡처 검수 + Actions 결과**로 판정한다.

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

## Task R1: 게이트를 GitHub Actions로

**Files:**
- Create: `.github/workflows/nubi-desktop-gates.yml`
- Modify: `.github/workflows/nubi-desktop-windows.yml`(`gates-full` 작업 추가, 패키징과 병렬), `packages/nubi-desktop/package.json`(`test:gates:fast`, `test:gates:electron` 분리 스크립트), `packages/nubi-desktop/docs/CI-GATES.md`(어떤 검사가 어디서 도는지 표)

**Interfaces:**
- Produces: `npm run test:gates:fast` = `npm test` + `design:check` + Electron이 필요 없는 화면 검사(forms, mail, modals, responsiveness, shared, workflow-ui, motion-performance, wave2-ui, workspace-ui, icons-ui, chat-ui, irreversible-ui, community-wiki-ui, profile-wiki-ui, activity-readability, review-failure-ui). `npm run test:gates:electron` = `build:electron` + Electron 검사(ui, skills-ui, agent-ui, live-web, lifecycle, all-surfaces, output-cards, development-execution, mcp-approval, Task 8의 `check-electron-workflow`). 기존 `test:gates`는 둘을 이어 부르는 별칭으로 남긴다.
- `nubi-desktop-gates.yml`: `push: branches: [main]`, `pull_request`, `workflow_dispatch`. ubuntu-latest에서 `test:gates:fast`(Playwright Chrome channel, `npx playwright install chrome` 또는 러너 기본 Chrome). 실패 시 `verification/**/*.png` 아티팩트 7일. 목표 20분 이내.
- `nubi-desktop-windows.yml`: `gates-full` 작업(windows-latest)이 `test:gates:fast` + `test:gates:electron`을 돌린다. 패키징 작업은 `needs: [windows-shell-probe]` 그대로, 초안 릴리스 저장 단계만 `needs`에 `gates-full`을 더해 게이트 실패 시 설치 파일을 초안으로 남기지 않는다.

- [ ] **Step 1: 분리 스크립트와 로컬 확인** — 두 스크립트가 기존 `test:gates`와 같은 검사 집합을 빠짐없이 나눠 갖는지 `scripts/check-gate-coverage.mjs`(package.json을 읽어 집합 비교)로 확인. 실패하는 상태에서 시작해 통과시킨다.
- [ ] **Step 2: 워크플로 파일 작성** — 위 인터페이스대로. Chrome channel이 ubuntu 러너에 없으면 `npx playwright install chrome`을 넣고, 캡처 아티팩트 보존 7일, `concurrency`로 같은 브랜치 중복 실행 취소.
- [ ] **Step 3: 보고 뒤 멈춤** — Claude가 main에 올리면 `nubi-desktop-gates.yml`이 처음 돈다. 실패하면 로그를 보고 고친다(검사 자체를 약화하지 않는다). 통과 기준: fast 20분 이내, Actions 결과를 `docs/CI-GATES.md`에 run id와 함께 기록.

---

## Task 10(바뀜): 릴리스 준비 — 문서, 버전, 릴리스 노트

**Files:**
- Create: `packages/nubi-desktop/docs/HOTFIX-1.3.0.md`(릴리스 노트: 2차 벤치마크, 워크플로우 1단계, 양식, 알려진 한계), `packages/nubi-desktop/docs/INSTALL-AND-UPDATE-1.3.0.md`(1.2.9 문서와 같은 절 구성), `packages/nubi-desktop/docs/WORKFLOW-AGENT-2026-10.md` 보강(형식 표, 템플릿 문법, 어댑터 표, dry-run과 감독 실행, 루틴 연결, 양식, 한계)
- Modify: 버전 1.2.10 → 1.3.0(패키지 네 곳, 잠금 파일 일곱 줄, 앱 이름 두 곳, 작업 탭 설명, README/AGENTS/브랜드 문서. `grep -rn "1\.2\.10"`으로 남은 곳 0 확인), `AGENTS.md`에 "워크플로우 순서는 호스트가 강제, 단계 출력은 스키마" 한 줄

- [ ] **Step 1: 버전과 문서** — 위 파일. 릴리스 노트는 사용자 관점 문장(한국어, 가운뎃점 금지)과 "알려진 한계"(Windows Office COM 실측 전, 저작 UI는 다음 버전, 루틴 무인 실행은 감독 통과 뒤).
- [ ] **Step 2: 확인** — `node scripts/check-release-flow-ui.mjs`, `npm run test:gates:fast`, 버전 grep 0건. 보고 뒤 멈춤(Claude 업로드).

---

## Task R2: 릴리스 브랜치와 CI (Claude 수행)

- [ ] **Step 1: 번들 입력 대조** — `generated/source-inputs.json`의 모든 파일(누비 Office worker 네 개 포함)을 릴리스 커밋과 해시 비교. 다르면 커밋을 다시 만든다.
- [ ] **Step 2: 브랜치 푸시** — 이전 릴리스 커밋을 부모로 임시 인덱스와 `commit-tree`로 커밋을 만들고 `codex/nubi-desktop-windows-release-1.3.0`으로 푸시(`"${C}:refs/heads/..."`). 업그레이드 기준은 1.2.9 검증본(run 38856253676)의 SHA-256.
- [ ] **Step 3: CI 확인** — `gates-full`, 설치, 업그레이드, 재설치, 제거 통과. 실패하면 원인을 Codex에 넘기고 고친 뒤 다시 푸시. 통과하면 초안 릴리스 `nubi-desktop-v1.3.0-run-<id>`와 설치 파일 SHA-256을 기록.
- [ ] **Step 4: 공개(사용자 지시 뒤)** — 초안을 사전 배포 릴리스로 공개, 릴리스 노트는 `HOTFIX-1.3.0.md`. 사용자가 원하면 `plaire48/ai_workspace` 카탈로그 게시(소스 묶음 `source-export`, 검증 기록, 태그).

## 완료 기준

- main에 Task 1~16과 R1이 있고 `nubi-desktop-gates.yml`이 main에서 통과한다.
- 릴리스 브랜치 CI가 `gates-full`까지 통과하고 초안 릴리스가 있다.
- 1.3.0 릴리스 노트에 포함 범위와 알려진 한계가 적혀 있다.
- 사용자 실측 항목(Windows 11 Office COM, 실모델 sol/luna)은 릴리스 노트의 "실측 전" 목록에 남기고 공개 여부는 사용자가 정한다.

## 위험

- windows-latest에서 `test:gates:electron` 시간(로컬 45분)이 길어 CI가 2시간에 가까워질 수 있다 → 패키징과 병렬 작업으로 두고, 느린 검사는 run 시간을 `CI-GATES.md`에 기록해 다음 버전에서 나눈다.
- Office가 없는 러너에서는 `office.apply_form` COM 경로를 검증하지 못한다 → OOXML 대체 경로만 CI, COM은 사용자 실측 체크리스트.
- 아티팩트 한도 → 게이트 캡처는 실패 시에만, 7일 보존.

### P1 재측정 인계(2026-10-19, Q9 대기)

현재 소스 고정 1,051개 해시로 q8-recheck 48행 완료. Chrome10/12(exit1), Electron9/12(exit1), 회귀9개 묶음 통과(집중 단위28 포함). 첫 표시4행, 최근/이전40개 300ms와 위치 이동0px 유지. PERF/CPU 문서를 현재48행으로 갱신했다. 네이티브 첫 입력 초기화의 호스트 준비 범위가 필요해 설계 §8 질문9를 추가했다. 원인 미확정 나머지 실패도 유지하며 P1 Step2/3, P2, QA89와 업로드는 미완료다. 답변 전에 준비 순서나 판정 경계를 변경하지 않는다.

> P2 최종 로컬 완료(2026-10-20, Codex): Q11 공통 훅, 메일 100행과 중복 프레임 대기 수정을 포함한다. qa91-19 전체 test:gates exit 0, 검사 입력 1,455개 변경 0. 단위 2,141개 통과 / 기존 제외 200개 / 실패 0개. 모션 157개, 전체 화면 117개, Electron 개발 흐름 8개와 MCP 승인, Chrome 12장면과 Electron 12장면 모두 통과했다. 1280/440 모달, 날짜, 파일 변경 카드와 전환 프레임은 docs/MOTION-1.3.0.md 최종 절에 있다. 보고 뒤 멈춤. Task 8, R1, 업로드와 릴리스는 시작하지 않았다.
