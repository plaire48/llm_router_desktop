# 누비 Workspace 워크플로우 에이전트 설계 (업무 흐름을 미니 에이전트로)

작성 2026-10-18. 사용자 결정: 누비 Workspace의 도구 활용, 코드 작성, 문서 작성, 웹 자동화 능력 위에 **사람이 적거나 그린 업무 워크플로우를 미니 에이전트로 실행**하는 계층을 만든다. 품질 좋은 오픈소스를 쓰되 누비의 기존 구조(Pi 루프, 승인, 영수증, 위키, 루틴)에 맞춘다. 코드보다 큰 그림과 아키텍처가 먼저다(이 문서). 대상 코드: `packages/nubi-desktop`.

## 0. 한 문장 정의

미니 에이전트란 "사람 단계, 에이전트 단계, 도구 단계가 정해진 순서로 이어지고, 단계마다 완료 조건과 영수증이 있으며, 승인 게이트를 지키고, 중단 뒤 재개되고, 반복 실행할 수 있는 단위"다. 모델의 자유 추론은 **단계 안**에서만 쓰고, 단계의 순서와 완료 조건은 사람이 정한 대로 **호스트가 강제**한다.

## 1. 재사용하는 자산

| 계층 | 이미 있음 |
|---|---|
| 능력 | 웹(내장 Playwright, 사용자 브라우저 확장 페어링, 화면 위키 학습), 오피스(COM 네이티브, Windows), 터미널(PTY, 승인), 문서(읽기, 비교, 내보내기, 편집기 연결), 메일과 포털, OpenWiki와 DB 스키마, MCP, VS Code 호스트 |
| 하네스 | Pi 루프, `update_plan`, 독립 검토, 실행 예산, 도구 실패 복구, 압축, 조사 하위 에이전트, 챕터 |
| 거버넌스 | 승인 모드 3단계와 항상 허용, 되돌리기 어려운 작업 규칙, 영수증(SQLite), 비밀 금고, 내보내기 가림, 본문은 데이터 규칙 |
| 운영 | 루틴(`runtime/routines.mjs`: 예약, 중복 실행 방지), Windows 알림, A2A, 스킬(`.nubi/skill`), AI Workspace 공유 |
| 저작 씨앗 | 상위 e2e 프로젝트의 `e2e-agent-creator / validator / runner` 스킬(워크플로우 YAML → task JSON → 질문하며 실행) |
| 라이브러리 | `yaml@2.9`, `ajv@8`(이미 의존성), React 18, 위키 관계 지도(`WikiNetwork.jsx`) |

없는 것은 넷: 워크플로우 **정의 형식**, **결정적 러너**, **저작 화면(캔버스와 대화)**, **단계별 검증 계약**.

## 2. 접근안과 선택

| 안 | 내용 | 판단 |
|---|---|---|
| **A. 자체 경량 오케스트레이터** | `.nubi/workflows/<이름>/workflow.yaml` + 호스트 러너. 에이전트 단계는 기존 Pi 루프, 사람 단계는 기존 질문/승인 카드, 체크포인트는 기존 SQLite | **채택.** 새 인프라 없음, 승인과 영수증 규칙 그대로, 데스크톱 1인 환경과 Windows 설치판에 맞음 |
| B. 외부 엔진 내장(n8n 207.8k fair-code, Activepieces 25.1k, Windmill 18.2k) | 로컬 서버로 띄우고 누비는 노드로 참여 | 보류. 서버와 DB 상주, 승인 체계 이중화, 사내 보안 정책 부담. 5단계(조직 공유)에서 HTTP 트리거로 연결만 검토 |
| C. 코드형 에이전트 프레임워크(LangGraph.js 3.4k, Mastra 28.9k) | 그래프 런타임 도입 | 보류. Pi와 별개의 두 번째 루프, Mastra는 비OSI. 패턴만 빌림 |

빌리는 오픈소스와 방법론(스타는 2026-10-18 GitHub 기준):
- **xyflow(React Flow) 38.7k, MIT** — 캔버스 편집기. 의존성으로 추가한다(유일한 새 UI 의존성).
- **Kestra 29.8k, Apache-2.0** — 선언형 YAML 문법(tasks, inputs, conditions, retry, subflow)의 **설계 참고**. 의존하지 않는다.
- **LangGraph 43.4k, MIT** — 상태 그래프, `interrupt`(사람 개입 지점), checkpoint의 **의미론 참고**.
- **Temporal 23.8k, MIT** — "결정적 오케스트레이션 + 비결정적 활동 + 멱등 키 + 재생" 원칙 참고.
- **BPMN(bpmn-js 9.7k)** — 사용자 과업과 게이트웨이 개념만 노드 다섯 종류로 녹인다. 전체 표기법은 쓰지 않는다.
- **Anthropic "Building effective agents"** — 체이닝, 라우팅, 병렬, 오케스트레이터-워커, 평가자-최적화 패턴을 노드 조합으로 표현한다.
- **Claude Code** — 스킬(SKILL.md 트리거)과 Workflow 스크립트(agent/parallel/pipeline, 재개)의 경험을 저작 스킬과 러너에 반영.
- **Mermaid(MIT)** — 워크플로우를 위키와 보고서에 그림으로 내보낼 때 텍스트 다이어그램으로 쓴다.
- 검증은 `ajv`(JSON Schema), 파싱은 `yaml`. 둘 다 이미 있다.

## 3. 아키텍처

```
사람 ─ 저작 입구 4개 ─▶ 워크플로우 정의(YAML 한 벌) ─ dry-run ─▶ 게시(.nubi/workflows, AI Workspace)
                                                   │
트리거(수동, 루틴 예약, 메일 도착, A2A 요청) ──▶ 러너(결정적) ──▶ 단계 실행
                                                   ├─ 사람 단계: 질문/승인/입력 카드(일시정지와 재개)
                                                   ├─ 에이전트 단계: Pi 루프(목표, 허용 도구, 완료 조건, 예산)
                                                   └─ 도구 단계: 어댑터의 결정적 호출(웹, 오피스, 터미널, 문서, MCP)
                             단계마다 영수증 + 체크포인트 + 검증 ──▶ 검토, 보고서, 알림, 위키 환류
```

### 3.1 정의 형식

파일: `.nubi/workflows/<slug>/workflow.yaml`(+ 선택 `README.md`, `fixtures/`). 스키마는 `runtime/workflow-schema.mjs`(JSON Schema, ajv). 요지:

```yaml
name: 변경 요청 정의서 작성
version: 3
trigger: {kind: manual}            # manual | routine(schedule) | mail(filter) | a2a
inputs:
  ticket: {type: string, required: true, description: JSM 티켓 번호}
permissions: {tools: [web, wiki, documents], externalWrite: ask}   # 기본 ask, never 가능
steps:
  - id: read-ticket
    kind: tool                      # human | agent | tool | branch | loop | parallel | subflow
    adapter: web.read               # 어댑터.동작
    args: {url: "{{ inputs.ticket | jsmUrl }}"}
    verify: {kind: text_present, value: "{{ inputs.ticket }}"}
    wiki: [{page: 운영/변경요청-절차, hash: 3f1c…}]
  - id: draft
    kind: agent
    goal: 티켓과 유사 과거 변경을 근거로 정의서 초안을 쓴다
    tools: [wiki_query, ask_openwiki, read_source, propose_new_file]
    done_when: {kind: file_exists, path: "docs/정의서/{{ inputs.ticket }}.md"}
    budget: {calls: 40, minutes: 15}
  - id: approve
    kind: human
    ask: 초안을 검토하고 승인해 주세요
    outputs: {decision: [approve, revise]}   # 선택지는 문자열 배열(W7)
  - id: publish
    kind: tool
    adapter: confluence.publish      # externalWrite → 승인 카드
    when: "{{ steps.approve.decision == 'approve' }}"
    idempotency: "{{ inputs.ticket }}:publish"
on_failure: {retry: 1, then: human}
```

규칙: 단계 종류 다섯(`human`, `agent`, `tool`, `branch`/`loop`/`parallel`, `subflow`). 공통 필드 `verify`(관찰 가능한 완료 조건), `on_failure`, `permissions`(단계가 더 좁힐 수만 있음), `timeout`, `wiki`(근거 페이지와 해시). 입력과 출력은 이름 있는 변수, 비밀은 금고 참조(`secret:이름`)만. 템플릿은 작은 표현식(`{{ }}`, 비교와 필터 몇 개)만 허용하고 임의 코드는 없다.

기존 e2e 스킬의 task JSON과는 **같은 노드 어휘**를 쓰고 변환기를 둔다(e2e task JSON → workflow.yaml). 그 프로젝트가 누비 위에서 돌 수 있게 한다.

### 3.2 러너

- `runtime/workflow-runner.mjs`. 호스트가 순서를 강제하며 모델은 순서를 바꾸지 못한다. 단계 시작과 끝에 **체크포인트**(`workflow-run:` 레코드, 단계 id, 입력/출력 해시, 영수증 id)를 쓴다.
- 앱 재시작이나 작업자 죽음 뒤에는 마지막 완료 단계 다음부터 **재개**한다. 미확정 쓰기(승인은 됐는데 결과가 불명)는 재실행하지 않고 사람 단계로 바꾼다(`mcpContinuation` 규칙을 워크플로우 단위로 확장).
- 사람 단계는 기존 질문/승인 카드와 Windows 알림으로 기다리고, 루틴 트리거 실행은 질문이 생기면 멈춰 알림(2차 Task 12 규칙).
- 에이전트 단계는 기존 `startAgent` 경로로 **하나의 대화**를 만들어 돌린다(목표, 허용 도구만 노출, `done_when`은 호스트가 영수증으로 판정, 예산은 `run-budget`에 단계 예산을 덮어씀). 단계가 끝나면 그 대화는 워크플로우 실행에 묶인 하위 대화로 보인다.
- 도구 단계는 어댑터(§3.3)를 직접 부른다. 되돌리기 어려운 작업과 외부 반영은 `permissions`와 무관하게 승인 카드.
- 실행 결과는 `complete | partial | failed | waiting`이며 호스트 증거만으로 정한다. 보고서(Markdown)는 단계별 영수증과 검증 결과를 담고 2차의 내보내기 가림을 쓴다.
- 멱등 키가 있는 도구 단계는 같은 키로 두 번 실행하지 않는다(재개와 재시도의 안전장치).

### 3.3 능력 어댑터 계약

어댑터마다 `observe`, `act`, `verify` 세 동작과 `irreversible` 분류를 가진다. 어댑터는 기존 도구를 감싸기만 하고 새 실행 경로를 만들지 않는다.

| 어댑터 | observe | act | verify | 비고 |
|---|---|---|---|---|
| web | snapshot, find, console | click, type, fill_form, navigate, 화면 절차 재생 | text_present, element_visible, url_is | 내장 또는 사용자 브라우저. 화면 위키로 선택자 복구 |
| office | 열린 문서와 범위 읽기 | 셀/문단/슬라이드 변경(COM), 사본 저장 | cell_equals, text_in_doc, file_hash | Windows 전용. NASCA 실측 뒤 기본 켬 |
| terminal | 출력 읽기, 프로세스 상태 | 명령(승인 흐름), 입력 | exit_code, output_matches | 설정 셸 우선 |
| documents | 문서 읽기와 비교 | 새 파일, 편집 제안, 내보내기 | file_exists, file_hash, numbers_match | 제안은 승인 뒤 반영 |
| forms | 양식 지도 추출, 채움표 코드 검사 | 양식 복사본에 부분 쓰기(`office.apply_form`, COM), OOXML 생성 fallback | form_checks(구조, 형식, 근거, 숫자) | §3.9. 누비 Office S1 파이프라인 재사용 |
| wiki | 페이지와 근거 조회 | 갱신안 제출 | page_hash | 환류 경로 |
| mail | 검색과 읽기 | 보내기(외부 반영, 항상 승인) | sent_receipt | 본문은 데이터 |
| mcp | 도구별 | 도구별 | 도구별 | 분류 규칙(2차 A5) 적용 |

지금 진행 중인 "4대 연계 최강 품질"(웹, 오피스, 터미널, VS Code) 작업이 이 계약의 바닥이다. 실패하면 어댑터는 사람 단계로 떨어뜨리고 이유 코드를 남긴다.

### 3.4 검증 (워크플로우도 TDD)

- **스키마 검증**: 저장 때 ajv. 알 수 없는 어댑터, 비밀 평문, 순환 참조, 외부 반영 `never` 위반은 저장 거절.
- **dry-run**: 합성 어댑터(각 동작이 고정 결과를 돌려줌)와 fixture 모델로 흐름, 분기, 템플릿을 실행한다. 사이드 이펙트 0. 저작 화면의 "검증" 단추.
- **감독 실행**: 첫 실제 실행은 모든 단계 앞에 사람 단계를 자동 삽입한 모드로 한 번 돈다.
- **단계 verify**는 실제 관찰값만(종료 코드, DOM 텍스트, 셀 값, 파일 해시). 모델의 "했다"는 증거가 아니다(주장 대조, 3차 Task 14와 같은 원칙).
- **실행 뒤 검토**: 개발 변경이 있으면 2차 검토 통로 그대로. 교정은 평가 후보로.
- **회귀**: 워크플로우마다 `fixtures/`의 dry-run 사례가 단위 시험이 된다.

### 3.5 저작 입구 4가지와 동기화

| 입구 | 동작 |
|---|---|
| 대화로 짜기 | 저작 에이전트(처음엔 Claude, 이후 누비의 "워크플로우 작성" 스킬)가 트리거, 입력, 단계, 승인 지점, 완료 조건을 묻고 **위키를 읽어** 초안을 만든다. 암묵지는 따로 기록 |
| 그려서 짜기 | 캔버스(xyflow). 노드 다섯 종류, 연결, 조건. 노드 속성 패널에서 어댑터, 인자, verify, 권한, 위키 근거 편집 |
| 시연으로 짜기 | 내장 브라우저에서 사람이 한 번 해 보이면 "화면 배우기"가 단계와 선택자를 뽑아 web 도구 단계로 만든다 |
| 가져오기 | 성공한 대화 기록("이 대화를 워크플로우로 저장"), 위키 절차 문서, 기존 e2e task JSON에서 초안 생성 |

동기화 규칙: **진실은 YAML 하나**이고 캔버스와 대화는 그 파일의 편집기다. 한쪽 변경은 다른 쪽에 즉시 반영하고 파일 해시로 충돌을 막는다. 노드에서 대화를 열 수 있고("이 단계 완료 조건을 정해 줘"), 대화에서 "3번 뒤에 승인 넣어 줘"라고 하면 노드가 생긴다. **에이전트 제안 노드는 점선**이며 사람이 확정해야 실선이 된다. 사람이 그린 순서는 에이전트가 바꾸지 못한다. 화면 배치(저작 대화, 캔버스, 속성 패널), 노드 위 오류 배지, 숙성 단계 표시기, YAML 원문 탭은 §3.12. 노드에는 위키 근거 칩(해시가 바뀌면 노란 표시), 완료 조건, 권한, 마지막 실행 상태, dry-run 결과가 보인다. 저장마다 버전이 남고 실행 기록은 버전을 가리키며 되돌릴 수 있다.

### 3.6 위키 환류

- 단계의 `wiki` 근거는 페이지 id와 해시다. 위키가 바뀌면 영향받는 워크플로우와 단계를 "확인 필요"로 표시한다(변경 계획의 소스 해시 원리).
- 실행 중 생긴 예외, 담당자가 준 암묵지, 바뀐 화면 구조는 **위키 갱신안**으로 돌려보내고 사람이 승인하면 위키에 반영한다(기존 이어쓰기 경로). 위키 → 워크플로우 → 실행 → 위키가 한 바퀴 돈다.
- 화면 위키는 web 어댑터의 선택자 복구(자가 치유)에 쓴다.

### 3.7 거버넌스

- 워크플로우별 권한 프로필(허용 어댑터와 도구, 외부 반영 `ask|never`). 단계는 더 좁힐 수만 있다.
- 역할: 작성자, 승인자(게시 승인), 실행자. 게시는 승인자 확인 뒤.
- 모든 실행에 영수증과 보고서. 비밀은 금고 참조만, 본문은 데이터, 되돌리기 어려운 작업은 모든 모드에서 확인.
- 트리거가 메일이나 A2A일 때 입력은 신뢰하지 않는 데이터로 표시하고 지시문 경계 검사를 거친다(3차 Task 26).

### 3.8 운영

- 트리거: 수동, 루틴(기존 스케줄러에 `workflow` 종류 추가), 메일 도착(기존 메일 수집 뒤 필터), A2A 요청(수락 뒤).
- 알림: 대기 중인 사람 단계, 실패, 완료. 알림 센터에서 바로 열기.
- 대시보드: 워크플로우별 실행 수, 성공률, 평균 시간, 사람 개입 수, 사용량(2차 C2 재사용).
- 공유: AI Workspace에 게시, 다른 누비에서 가져오기. 버전과 되돌리기.
- 화면: 실행 타임라인(챕터, 하위 대화 카드, 승인 카드, 보고서 카드)과 미니 지도, 대기 사유 한 문장과 1차 버튼은 §3.12.

**루틴과 워크플로우의 관계 (2026-10-19 사용자 지적: "루틴이 워크플로우도 될 수 있다")**
- 루틴은 "언제(일정) + 무엇(할 일)"이다. 할 일은 둘 중 하나다: 자유 요청(지금의 프롬프트 루틴)과 워크플로우(slug + 입력). 스케줄러, 알림, "실행 중이면 중복 시작하지 않음" 규칙은 둘이 같은 것을 쓴다.
- 진실은 YAML이다. 워크플로우에 `trigger.kind: routine`과 `schedule`이 있으면 패키지를 저장하거나 가져올 때 루틴 등록을 **제안**하고 사람이 켠다. 자동 등록은 없다. 루틴 화면에서 일정을 바꾸면 YAML의 `trigger.schedule`을 고쳐 저장한다. 숙성 단계와 `workflow-qualified` 키는 `trigger.schedule`을 뺀 정의 해시(`definitionHash`)로 계산해, 일정만 바꿔도 "검증됨"으로 되돌아가지 않게 한다. 파일 해시는 변경 감지에만 쓴다.
- 무인 실행 조건: 루틴이 워크플로우를 시작하려면 감독 통과(`workflow-qualified`)여야 한다. 아니면 시작하지 않고 "감독 실행이 필요해요" 알림만 남긴다. 무인이어도 외부 반영과 사람 단계는 승인 카드와 알림에서 멈춘다(§3.7).
- 승격: 자유 요청 루틴이 같은 요청으로 3회 이상 성공하면 "워크플로우로 만들기"를 한 번 제안한다(§3.5 가져오기 입구: 성공한 대화 기록에서 초안, 점선 제안, 사람 확정). 반대 방향으로 워크플로우 상세에 "루틴으로 등록"을 둔다.
- 화면(§3.12 디자인 규칙 적용): 루틴 설정의 "요청" 자리에 선택지(대화 요청 / 워크플로우)와 워크플로우 `inputs` 스키마에서 만든 입력 칸, 워크플로우 목록 행에 다음 예정 시각과 루틴 배지, 숙성 표시기의 "자동 가능"은 루틴 연결 + 감독 통과.

### 3.9 양식과 초안 (2026-10-19 추가, 사용자 지적)

초안은 빈 종이가 아니라 **회사 양식(Word 정의서, Excel 검수표, PPT 보고 틀)** 위에 쓴다. 양식은 기존 Office 파일에서 추출한다. 이미 있는 자산을 그대로 쓴다: 누비 Office S1 양식 작성 파이프라인(`packages/nubi-office/worker/form-map.mjs`, `form-fill.mjs`, `form-apply.mjs`, `form-checks.mjs`, `form-review.mjs`, `form-ledger.mjs`; Desktop은 이미 같은 worker 모듈을 import한다)과 Desktop의 native Office 초안(`native-office-draft.mjs`, COM).

| 동작 | 무엇 | 재사용 | 언제 |
|---|---|---|---|
| `forms.extract` | 회사 양식 파일(복사본)에서 **양식 지도**를 만든다: 입력 칸(라벨 옆 칸, 표의 항목, 계산 칸, 고정 문장), 위치(문단 id, 표 셀, 시트 범위, 슬라이드 자리표시자), 형식과 제약, 예시 값. 위치에서 유도한 **힌트**일 뿐 쓰기 권한이 아니다 | `form-map.mjs` | 저작 때 한 번. 사람이 확인 카드로 칸 대응을 확정 |
| 저장 | 워크플로우 패키지 `forms/<이름>/`에 `form-map.json` + 원본 양식 파일 해시 + 확인 기록. 위키에도 "양식" 페이지로 연결해 양식이 바뀌면 "확인 필요" 표시 | 패키지 형식(§3.1) | 저작 |
| `forms.fill` | 에이전트 단계가 양식 지도에서 유도된 **출력 스키마**(칸마다 속성)로 **채움표**를 쓴다. 칸마다 값과 근거(위키 페이지, 메일 id, 티켓 필드)를 함께 낸다. 코드가 형식과 필수 칸을 먼저 검사한다 | `form-fill.mjs`의 채움표와 코드 검사 | 실행, 에이전트 단계 |
| 검토 | 채움표 전체를 **한 장의 카드**로 사람이 승인한다(칸별 수정 가능). 승인 없이 쓰지 않는다 | 기존 승인 카드, `form-review.mjs`(인용 우선 체크리스트) | 실행, 사람 단계 |
| `office.apply_form` | 승인된 채움표를 양식 복사본에 **부분 단위로** 쓴다. 같은 표를 다시 적용하면 차이가 없어 아무것도 쓰지 않는다(멱등). 문단 장부로 위치를 따라가 양식 자체 문장은 건드리지 않는다 | `form-apply.mjs`, `form-ledger.mjs`, Windows COM(`native-office-draft.mjs`) | 실행, 도구 단계(승인 뒤) |
| `forms.verify` | 결과를 양식 지도와 대조: 구조(칸 수와 위치), 형식(날짜, 숫자, 목록 번호), 근거(값이 근거 문장에 있는가), 숫자 대조(`document-consistency.mjs`). 실패한 칸만 다시 쓰기(최대 2회) 뒤 사람에게 | `form-checks.mjs`, `form-review.mjs` | 실행, verify |

렌더링 경로의 우선순위: **① Windows에서 실제 Office(COM)**가 양식 복사본에 쓴다(서식과 NASCA 호환이 가장 좋다). ② Office가 없는 환경(개발 Mac, CI)에서는 OOXML 라이브러리로 **생성만** 지원한다: Word는 `dolanmiu/docx`(MIT, 6.0k), Excel은 이미 의존성인 Univer(Apache-2.0, 22.7k), PPT는 자리표시자 채움에 한해 `PptxGenJS`(MIT, 6.3k)로 새 파일 생성. `docxtemplater`(핵심 MIT, 3.6k)는 양식에 `{자리표시자}`를 미리 넣어야 해서 기존 회사 양식에는 맞지 않아 보류. `SheetJS`(Apache-2.0 공개판은 2024-04 이후 갱신 없음)와 `exceljs`(2025-01 이후 정지)는 보류. ②는 dry-run과 미리보기용이며 최종 산출은 ①로 만든다. Markdown 양식(Confluence 정의서 등)은 같은 양식 지도 구조에 `markdown` 종류를 둔다.

워크플로우 정의에서의 모양:

```yaml
forms:
  definition: {source: 양식/변경요청정의서.docx, map: forms/definition/form-map.json}
steps:
  - id: draft
    kind: agent
    goal: 티켓과 위키 근거로 정의서 채움표를 쓴다
    form: definition                       # 출력 스키마는 양식 지도에서 유도
    tools: [wiki_query, ask_openwiki, read_personal_mail]
  - id: review
    kind: human
    form_review: draft                     # 채움표 카드(칸별 수정, 근거 보기)
  - id: apply
    kind: tool
    adapter: office.apply_form             # Windows COM, 승인 뒤
    args: {form: definition, sheet: "{{ steps.review.output.sheet }}", output: "docs/정의서/{{ inputs.ticket }}.docx"}
    verify: {kind: form_checks, form: definition}
```

저작 흐름에 "양식 등록" 입구를 더한다: 사용자가 회사 양식 파일을 놓으면 `forms.extract`가 지도를 만들고 확인 카드로 칸 대응을 확정한 뒤 패키지에 저장한다(S1의 "칸 항목 → 부품 → 측정 묶음 → 확인 카드" 그대로).

### 3.10 웹에서의 저작과 사용 (2026-10-19 추가, 사용자 지적)

워크플로우는 Desktop 안에서만 만들고 고치는 것이 아니라 **웹에서도 보고, 고치고, 쓸 수 있어야 한다.** 세 표면을 나눈다.

| 표면 | 할 수 있는 것 | 못 하는 것(이유) |
|---|---|---|
| **AI Workspace 웹**(사내 GitHub Pages, Desktop 안에도 내장) | 워크플로우 카탈로그(팀 공유), 캔버스로 보기와 **편집**, YAML 편집, 저장 전 검증, 합성 어댑터 dry-run, 버전과 변경 이력, 실행 보고서 열람(게시된 것만), "내 누비로 가져오기", 실행 요청 보내기(A2A) | 실제 실행(로컬 어댑터와 승인 카드가 Desktop에 있다), 비밀 저장 |
| **브라우저 누비**(확장) | 웹 단계만으로 된 워크플로우의 실행(기존 공용 런타임), 현재 화면 시연으로 web 단계 만들기 | Office, 터미널, 파일 단계 |
| **Desktop 누비** | 모든 것: 실행, 승인, 양식 적용, 보고서, 게시 | |

공유 저장소: 스킬 장터와 같은 방식으로 사내 GitHub 저장소(`nubi-workflows/<팀>/<slug>/`)에 패키지를 두고 장터 목록에 올린다. 웹에서의 수정은 **PR(변경 요청)**로 들어가 승인자가 합치면 새 버전이 된다(거버넌스 §3.7의 작성자/승인자). Desktop은 "가져오기"로 패키지를 `.nubi/workflows`에 복사하고, 가져올 때 권한 프로필과 외부 반영 설정을 사용자에게 보여 확인받는다. 비밀은 패키지에 절대 들어가지 않고 각 PC의 금고 참조만 쓴다.

공용 코드: `runtime/workflow-schema.mjs`, `workflow-template.mjs`, `ui/WorkflowCanvas.jsx`는 **브라우저에서도 돌아야 한다**(Node 전용 import 금지: ajv, yaml, secret-like만). 패키지 로더와 러너는 Desktop 전용. 같은 검증 코드가 웹 편집기와 Desktop에서 같은 오류 코드를 내므로 "웹에서 통과한 것이 Desktop에서 거절"되는 일이 없다.

실행 요청: 웹에서 "실행"을 누르면 A2A 요청이 사용자의 Desktop으로 가고, Desktop이 수락한 뒤 실행한다(A2A의 수락 뒤 실행 규칙 그대로). 결과 보고서는 사용자가 게시를 선택할 때만 웹에 올라간다.

단계 배치: 1단계는 웹 호환 제약만 지킨다(이 절의 "공용 코드"). 3단계(저작)에서 AI Workspace 카탈로그와 캔버스 편집, 4단계(운영)에서 PR 승인과 실행 요청을 만든다.

### 3.11 기존 Process Activity Maker 활용 (2026-10-19 추가)

사내에 이미 **Process Activity Maker**(`~/Downloads/next_workflow_sol`, Vite + React + `@xyflow/react` + `yaml` + sql.js, GitHub Pages 배포, 전신 `agent-workflow-maker`)가 있다. 그대로 쓰지 않고 **세 가지를 활용**한다.

| 활용 대상 | 무엇 | 누비에서의 자리 |
|---|---|---|
| **업무 모델(데이터)** | Process → Activity → Task lane 계층, AS-IS/TO-BE 짝, `workloadCatalog.yaml`의 태스크별 작업량 비율, 노드 네 종류(action, branch, event, memo), `ModuleType`(agent, skill, api_mcp, human_approval, file_search, guardrail, transform, set_state, child_workflow, external_workflow), 입출력 스키마와 필드 매핑, 역할, 양식 바인딩(start/input/approval/review/report), 작업 시간 추정(workload/actual), 멱등 키와 보상 | 누비 워크플로우는 **TO-BE Activity 하나의 자동화**다. Blueprint(Activity 단위 Workflow YAML)를 누비 `workflow.yaml`로 바꾸는 변환기를 둔다(아래 대응표). 반대로 실행 결과의 실제 소요 시간(`actual_minutes`)을 Blueprint의 `work_time`으로 돌려보내 TO-BE 검증 자료로 쓴다 |
| **편집기 UX** | 태스크 레인 캔버스, 노드 카드, AS-IS/TO-BE 비교 보기, YAML 동시 편집 | 같은 React + xyflow라 Desktop 캔버스(Task 6)와 AI Workspace 편집기(§3.10)에서 **컴포넌트와 레이아웃 규칙을 가져온다**(Tauri, sql.js 저장, 자체 검증은 가져오지 않음). 가져올 때 누비 디자인 토큰과 Apple HIG 모션 규칙으로 바꾼다 |
| **비교와 지표** | AS-IS/TO-BE 비교 수치, 태스크 수준 TO-BE 개수, 작업량 비율 | 운영 대시보드(§3.8)에 "기대 작업량 대비 실제 소요"를 추가해 자동화 효과를 수치로 보인다 |

대응표(Blueprint → 누비 단계):

| Blueprint | 누비 |
|---|---|
| `action` + module `agent` | `agent` 단계(goal, tools, done_when, outputs.schema ← output_schema) |
| `action` + module `skill` | `agent` 단계 + `use_skill`(스킬 경로 ref) |
| `action` + module `api_mcp` | `tool` 단계(어댑터 `mcp.<server>.<tool>`), `effect:write`면 승인 |
| `action` + module `human_approval`, form_binding approval/review | `human` 단계(`form_review`) |
| `action` + module `file_search` | `agent` 단계(`wiki_query`, `source_search`, 문서 읽기) |
| `guardrail` | 단계 `verify` 또는 워크플로우 `hooks` |
| `transform`, `set_state` | 템플릿 출력 매핑(`outputs`, `{{ }}`) |
| `child_workflow` / `external_workflow` | `subflow` / A2A 요청 |
| `branch`(if_else, switch, loop, for_each, parallel, join) | `branch` / `loop` / `parallel`. 1단계는 if_else/switch만 변환하고 반복/병렬/join은 §8 답 6대로 미지원 노드를 모두 나열해 거절한다. 2단계 실행 설계 뒤 `loop`/`parallel`로 대응 |
| `event`(start, schedule, timer, webhook, signal, end) | 트리거(manual, routine, mail, a2a)와 종료 |
| `form_binding`(start, input, approval, review, report) | 입력 양식과 §3.9 양식 지도 |
| `work_time`, `workloadCatalog.ratio_percent` | 실행 지표(기대 대비 실제) |

변환기는 손실을 숨기지 않는다: 대응이 없는 노드는 `human` 단계로 두고 경고를 남긴다(e2e task JSON 변환기와 같은 규칙). 역변환(누비 → Blueprint)은 Activity 구조만 돌려준다.

### 3.12 화면 규칙: 설계 모드와 실행 모드 (2026-10-19 사용자 승인)

원칙: **지도는 하나, 모드는 둘.** 설계와 실행은 같은 캔버스와 같은 노드 자리를 쓴다. 설계 모드는 편집하고, 실행 모드는 그 위에 상태만 덧칠한다. 사용자가 두 화면의 구조를 따로 배우지 않는다. 패턴 참고: n8n(편집기와 실행 결과가 한 캔버스), LangGraph Studio(실행 되감기), Temporal UI(이벤트 타임라인), Kestra(토폴로지 위 상태), Claude Code(챕터 목차, 승인 카드, 산출물 카드). 채택 라이브러리는 그대로 xyflow 하나다(`docs/WORKFLOW-AGENT-OSS-2026-10-18.md`). 새 의존성은 없다.

**설계 모드: 대화가 1차, 캔버스는 확인과 미세 조정**
1. 배치: 저작 대화(왼쪽), 캔버스(가운데), 속성 패널(오른쪽). 사용자가 목표와 완료 조건을 말하면 저작 에이전트가 단계 초안을 YAML로 쓰고 캔버스가 즉시 갱신된다(§3.5 동기화). 드래그 편집은 그 뒤 단계다.
2. 캔버스는 레인(역할 또는 시스템) 세로 흐름이다. 노드 카드에는 종류 아이콘, 이름, 완료 조건 배지("결과 제출 확인", "파일 존재 확인", "파일 해시 확인"), 위키 근거 개수만 둔다. 나머지는 속성 패널이 맡는다.
3. 검증 오류(`validateWorkflow`의 `errors[].path`)는 해당 노드 위 빨간 배지로 보인다. 노드를 누르면 속성 패널 맨 위에 오류 문장과 고칠 칸이 나온다. 오류 글 목록만 따로 두지 않는다.
4. 숙성 단계 표시기(상단): 초안 → 검증됨 → 합성 통과 → 감독 통과 → 자동 가능. 근거는 차례로 저장됨, `validateWorkflow` ok, 마지막 dry-run 성공 레코드(같은 해시), `workflow-qualified:<slug>:<hash>`, 루틴 연결과 qualified 유지다. 정의 해시가 바뀌면 "검증됨"까지 되돌아간다.
5. YAML 원문 탭: 읽기와 편집, 저장 때 검증과 해시 충돌 거절. 단일 진실은 YAML이다(§3.5).
6. 합성 실행(dry-run)은 같은 지도 위에서 재생한다. 타임라인 스크럽으로 그 시점의 노드 상태를 본다. 재생 자료는 dry-run 실행 레코드의 단계 시각이다.

**실행 모드: 대화 타임라인이 본문, 지도는 곁에서 위치 표시**
1. 실행의 본문은 우산 대화의 타임라인이다. 순서대로 쌓고 지우거나 옮기지 않는다(대화 화면 원칙). 구성: 단계 시작은 챕터(목차에 들어감), 에이전트 단계는 접힌 하위 대화 카드(요약 한 줄, 펼치면 하위 대화 전체), 도구 단계는 `action_summary` 한 줄과 영수증 id, 승인은 기존 승인 카드(오른쪽), 사람 단계는 질문 카드, 산출물은 산출물 카드, 끝은 보고서 카드와 "위키에 반영할까요" 제안(§3.6).
2. 미니 지도는 오른쪽에 고정하고 좁은 창(440px 검사 기준)에서는 접힌다. 상태 색은 넷뿐이다: 현재(강조), 완료(체크), 대기(주황), 실패(빨강). 노드를 누르면 타임라인의 해당 챕터로 이동한다(기존 챕터 목차 점프 재사용).
3. 대기 상태는 "왜 기다리는지" 한 문장과 1차 행동 버튼 하나다. 종류: 승인 필요(외부 반영 또는 되돌리기 어려운 작업), 결과 확인 대기(unconfirmed), 사람 답 필요(human 단계), 감독 확인(supervised 실행의 단계 전 확인).
4. 상단 상태 줄: 워크플로우 이름, 상태 알약, 경과 시간과 원본 예상 시간(`metrics.expectedMinutes`가 있을 때), 감독 모드 표시("이번 실행은 단계마다 확인").
5. 재개와 캐시: 건너뛴 단계는 사유(캐시 적중, 조건 거짓, 멱등 키 일치)를 한 줄로 적는다.
6. 기존 `WorkflowRunView`의 단계 목록과 보고서 모달은 이 타임라인에 흡수한다. 목록 화면(`WorkflowPanel`)은 시작과 상태 요약만 맡는다.

**모션과 성능(공통)**
- 상태 변화는 색 크로스페이드 180ms, 현재 단계는 약한 펄스(모션 감소 설정이면 정지). 실행 중에는 레이아웃을 다시 계산하지 않는다. 자리는 설계 때 worker가 정한 값을 쓰고 상태만 바꾼다.
- 50노드 이상 가상화와 worker 레이아웃은 기존 것을 쓴다. 메인 스레드 50ms 규칙은 Global Constraints와 같다.
- 웹(AI Workspace)도 같은 화면 규칙을 따른다. 실행은 Desktop이 전부, 웹은 web 어댑터만(§3.10).

**디자인 규칙 (2026-10-19 사용자 지적: "디자인이 구리다, 주변 UI에 맞춰라")**

지금 워크플로우 화면은 자기만의 양식(outline 버튼을 목록 항목으로, 색을 채운 큰 노드, 파란 배너, 중첩 색 상자, 원시 오류 코드, 전체 폭 details 블록)을 쓴다. 주변 화면(대화 진행 기록, 위키, 메일 설정, 사이드바)의 양식을 그대로 가져온다. 새 스타일을 발명하지 않는다.

| 자리 | 재사용할 양식 | 금지 |
|---|---|---|
| 화면 머리글 | 위키/메일처럼 아이콘 타일(연한 파랑 둥근 네모 + outline 아이콘) + 제목 + 개수, 오른쪽은 아이콘 버튼(`WorkspaceIconAction`: 가져오기, 새로고침) | 셸 머리글에 이미 있는 제목을 본문 h1로 반복, 설명 문장 한 줄 더 |
| 목록(워크플로우, 최근 실행) | 사이드바 대화 행 `nubi-session-row` 양식: outline 아이콘 + 이름 + 보조 글(버전, 마지막 실행) + 오른쪽 상태 글자, 선택 행만 연한 파랑 둥근 배경 | `CxButton`을 목록 항목으로, 행 밖에 떠 있는 보조 글 |
| 형식 오류 항목 | 행 안에 빨간 점 + "형식 오류", 누르면 한국어 사유 문장. 코드(`workflow_schema`)는 접힌 "자세히" 안에서만 | 원시 코드를 본문 글자로 노출 |
| 탭, 필터 | 위키의 칩 탭(아이콘 + 글자, 선택은 연한 파랑 배경)과 세그먼트 컨트롤 | 테두리만 있는 칩 줄 |
| 카드, 패널, 모달 | `nubi-panel`, `deck-dialog`, 메일 설정 모달의 그룹 양식(아이콘 타일 + 제목 + 설명 + 오른쪽 컨트롤) | 상자 안 상자(색 배경 2겹 이상), 전체 폭 `details` 블록 |
| 타임라인 단계 행 | 대화 진행 기록 양식(`nubi-document-progress` 계열): outline 아이콘 18px + 제목 semibold + 오른쪽 상태 글자, 보조 글은 secondary, 행 사이 hairline, 배경색 없음. 현재 단계는 상태 글자 파랑 + `status-spinner` | 북마크 아이콘을 모든 단계 표식으로, 연한 파랑 단계 컨테이너 |
| 대기 안내 | 상태 줄 한 줄: 아이콘 + 문장 + outline 버튼 하나. 채움 버튼은 외부 반영 승인 같은 1차 행동에만, 화면당 하나 | 파란 배너, 채움 버튼 2개 이상 |
| 승인, 질문, 산출물 | 기존 `QuestionDecision`과 산출물 카드를 그대로. 승인 줄 오른쪽 정렬 규칙 적용 | 새 승인 카드 |
| 지도 노드 | Apple Shortcuts 벤치마크: 흰 표면 + hairline + `--nubi-box-radius`, 왼쪽 아이콘 타일 28px(종류 색은 타일에만: 도구 회색, 에이전트 파랑, 사람 주황, 조건 초록), 제목 1줄, 보조 1줄(완료 조건 또는 도구), 오른쪽 상태 점 + 글자(완료 초록, 대기 주황, 실패 빨강). 현재 단계는 파랑 테두리 2px | 노드 전체를 색으로 채움, 노드 안에 상태만 큰 글자로 |
| 연결선, 배경, 레인 | 연결선 1px `--deck-line`, 분기에만 라벨. 배경은 위키 관계 지도와 같은 아주 옅은 점 또는 없음. 레인은 상단 머리글(글자 + hairline)과 열 구분선만 | 화살표 머리, 큰 색 기둥 레인 |
| 미니 지도 | 같은 노드 카드의 축소형(아이콘 타일 + 제목 + 상태 점), 고정 폭 | 별도 스타일 |
| 가져오기 | 머리글 아이콘 버튼 → `deck-dialog`(파일 선택, 미리보기 지도, 거절 사유 목록, 초안 저장 버튼 하나) | 목록 위 전체 폭 details |
| 글자, 간격, 아이콘 | `--deck-type-*`, `--cx-space-*`, `--nubi-chat-reading-width`(타임라인 폭)만. 아이콘은 `Icon` outline 16/18, 단계 표식은 종류별 아이콘 | hex, px, 새 아이콘 세트 |

검사 단언(`check-workflow-ui`에 추가): 보이는 글자에 원시 코드(`/\bworkflow_[a-z_]+\b/`, 접힌 "자세히" 제외) 0건, 노드 배경이 표면 토큰, 채움 버튼 화면당 1개 이하, 셸 머리글 제목이 본문 h1에 반복되지 않음, 색 배경 중첩 0, 목록 항목이 `button.cx-button`이 아님, 디자인 토큰만. 스크린샷 1280/440을 `verification/workflow/ui/`에 남기고 보고서에 경로를 적는다. Claude가 스크린샷으로 디자인을 검수한 뒤 업로드한다.

구현 순서: 실행 모드 1~6은 1단계 Task 15(Task 8 시범 실행 전, 그 검사가 이 화면을 대상으로 하도록). 디자인 규칙은 Task 15의 새 화면에 처음부터 적용하고, 기존 화면(목록, 가져오기, 지도 노드, 레인)은 Task 16으로 맞춘다. 설계 모드 1~6은 2단계 계획 `docs/superpowers/plans/2026-10-19-nubi-workflow-agent-phase2-authoring-ui.md`.


## 4. 단계

1. **정의 형식과 러너 최소**: 스키마, 순차 + 사람 단계 + 에이전트 단계 + 도구 단계(web, terminal, documents), 체크포인트와 재개, dry-run, 보고서. 기존 e2e task JSON 변환기. 캔버스는 읽기 전용 뷰까지.
2. **어댑터 계약 확정과 실측**: web, office, terminal, VS Code의 observe/act/verify와 Windows 11 실측(지금 진행 중인 4대 연계 품질 작업과 합침).
3. **저작**: 대화 저작 스킬("워크플로우 작성"), 캔버스 편집, 시연에서 만들기, 대화 저장에서 만들기, 게시와 공유.
4. **운영**: 루틴/메일/A2A 트리거, 알림, 대시보드, 버전과 되돌리기, 위키 환류.
5. **조직 공유**: A2A로 단계 위임, 필요하면 외부 엔진(B안)과 HTTP 트리거.

## 5. 시범 과제

첫 시범은 상위 e2e 프로젝트의 **"JSM 변경 요청 → 변경 요청 정의서 → 통합 테스트 시나리오"**(그 프로젝트 `AGENTS.md`의 Agent 1, 2). 위키(코드와 git 이력), 웹(JSM과 Confluence 조회), 문서 작성(정의서), 웹 자동화(Playwright 검증), 사람 승인(외부 반영 전)이 모두 들어 있어 네 능력을 한 번에 검증한다. 대화 저작의 첫 질문은 "이 업무는 언제 시작되고, 끝났다는 건 무엇을 보면 아는가"다.

## 6. 한계와 위험

- 임의 데스크톱 앱 자동화는 범위 밖(웹, 오피스, 터미널, VS Code부터).
- "완전 무인"은 목표가 아니다. 사람 단계가 있는 반자동이 기본이고 외부 반영은 승인 뒤.
- Windows 11 + Office 2016 + NASCA + 사내 SSO 실측 전에는 office 어댑터를 기본으로 켜지 않는다.
- 화면 변경에 따른 web 단계 깨짐: 화면 위키 복구와 사람 단계 전환으로 받는다. 성공률을 대시보드로 본다.
- 승인 피로: 워크플로우별 권한 프로필과 감독 실행 1회 뒤 자동 모드 전환으로 줄인다.
- 지시문 주입: 메일/A2A 입력과 웹 본문은 데이터. 3차 Task 26과 함께 간다.

## 7. 바꾸지 않는 것

승인 모델과 되돌리기 어려운 작업 규칙, 영수증 기반 판정, 공용 런타임과 평가 채점, 비밀 금고. 새 에이전트 루프를 만들지 않는다(Pi 하나).

## 8. 미결 확인 사항

1. 시범 과제를 JSM 변경 요청 흐름으로 가도 되는가(대안: 메일 기반 주간 보고).
2. 캔버스 의존성 xyflow 추가 승인(MIT, 새 UI 의존성 하나).
3. 트리거 중 메일 도착과 A2A는 1단계에 넣지 않고 4단계로 미뤄도 되는가.

4. **작성 단계의 명시적 도구 목록과 기존 필수 선행 동작(2026-10-18, Codex → Claude 설계 확인 요청).** Task 4의 예시는 `tools: [propose_new_file]` 또는 `[read_source, propose_new_file]`만 허용하면서 실제 새 파일 작성까지 요구한다. 하지만 기존 `runtime/agent.mjs`의 새 파일 제안은 같은 실행의 `inspect_path` 관찰이 없으면 `source_read_required`, `record_change_plan`이 없으면 `change_plan_required`로 거절한다. `runtime/change-plan.mjs`의 `requirePlannedEdit`도 현재 runId와 대상/원문/규칙 해시를 검증한다. 기존 Pi는 `expectPlan:true`로 `update_plan`도 사용한다.

   현재 호스트와 합성 모델로 두 거절을 각각 재현했다. 경로 관찰을 빼면 `source_read_required`, 관찰만 하고 변경 계획을 빼면 `change_plan_required`이며 제안은 생성되지 않았다. 재현은 `.superpowers/sdd/2026-10-18-nubi-workflow-agent-phase1/task-4-prerequisite-probe.mjs`와 `.log`에 있다. 제품 코드나 공용 실행기를 바꾸지 않았다.

   **권장안:** 선행 도구도 워크플로우 작성자가 `tools`에 명시한다. 새 파일 작성 예시/합성 fixture에는 `inspect_path`, `record_change_plan`과 필요한 `read_source`를 포함하고, 기존 Pi 계획을 쓰는 단계에는 `update_plan`을 포함한다. 필요한 선행 도구가 빠진 정의는 실행 전에 `workflow_schema`로 거절한다. 모델에 보이는 목록과 실행 허용 목록은 끝까지 동일하게 유지하며, 기존 관찰/변경 계획/승인 규칙을 그대로 재사용한다. 새 도구는 단계 대화에만 노출하고 기본 도구 예산과 소형 창 시험은 그대로 돌린다.

   **대안:** 호스트가 선언한 대상에 한해 필수 관찰과 계획을 기존 API로 미리 준비한다. 이 경우 어디까지 자동으로 준비할지와 runId/관찰 바인딩 계약을 설계에 명시해야 한다. 임의의 도구 목록 확대나 관찰/계획 검사 우회는 하지 않는다.

   권장안으로 설계와 Task 4 예시를 보완할지, 호스트 준비 방식을 택할지 Claude의 답을 기다린다. **Task 4 제품 구현과 그에 의존하는 Task 5는 중단 상태다.** Task 2는 완료했고 Task 3의 이미 시작한 전체 게이트는 마무리한다. 첫 실제 실행의 감독 규칙은 기존 §3.4를 따른다.
   **답(2026-10-18, Claude)**: 권장안의 원칙(모델에 보이는 목록 = 실행 허용 목록, 관찰/계획/승인 검사 우회 없음)을 받되, **선행 도구는 작성자가 외우지 않고 호스트가 고정된 폐쇄 표로 보탠다.** 이유: 워크플로우 작성자는 업무 담당자이고 `record_change_plan` 같은 내부 게이트 도구를 알 수 없다. 호스트 준비 방식(대안)은 runId/관찰 바인딩 계약이 복잡해 채택하지 않는다.
   - `runtime/workflow-tools.mjs`에 호스트 소유 `TOOL_PREREQUISITES`(고정): `propose_new_file → inspect_path, record_change_plan`; `propose_patch`/`propose_edit` → `read_source, record_change_plan`; `propose_setup_action` → `inspect_environment, read_process_output`; `personal_mail_query → read_personal_mail`; `use_skill → discover_capabilities, read_skill`; `delegate_research → continue_research`. 모든 에이전트 단계에 `update_plan`과 `submit_step_output`을 항상 넣는다.
   - `expandStepTools(declared) -> {tools, added:[{tool, because}]}`. 검증(`validateWorkflow`)은 알 수 없는 도구 이름을 `workflow_tool_unknown`으로 거절하고, 확장 결과를 `step.resolvedTools`로 돌려준다. 캔버스와 보고서는 "작성자가 고른 도구 + 호스트가 보탠 선행 도구"를 구분해 보여 준다. 모델에 노출하는 목록과 실행 허용 목록은 둘 다 `resolvedTools`다.
   - 관찰과 계획 자체는 자동으로 만들지 않는다. 단계 대화의 모델이 `inspect_path`와 `record_change_plan`을 실제로 호출해야 하며, 기존 `source_read_required`/`change_plan_required` 거절은 그대로다. 단계 `goal` 뒤에 호스트가 한 문장을 붙인다: "새 파일은 inspect_path와 record_change_plan 뒤에 제안하고, 끝나면 submit_step_output으로 결과를 제출하라."
   - Task 4 예시와 합성 fixture는 `tools:[propose_new_file]`처럼 짧게 두고 확장 결과를 시험으로 확인한다(`resolvedTools`에 `inspect_path`, `record_change_plan`, `update_plan`, `submit_step_output` 포함). Task 4 재개 가능.

5. **파일 없는 판단과 요약 단계의 완료 조건(2026-10-19, Codex 설계 확인 요청).** Task 7은 일반 `decide_*`를 구조화 출력을 내는 `agent`로 바꾸고, Task 8의 마지막 `report`도 요약 JSON Schema를 요구한다. 그러나 승인된 Task 4~5 구현의 `agent.done_when`은 현재 `file_exists`와 `file_hash`만 실행할 수 있다. 합성 판단 단계에서 완료 조건을 생략하면 `workflow_schema`, `truthy`를 넣으면 시작 전 `workflow_verify_unsupported`가 발생한다(실행과 대화 생성 모두 0개). 근거: `.superpowers/sdd/2026-10-18-nubi-workflow-agent-phase1/task-7-output-preflight.mjs`와 `.log`, `runtime/workflow-runner.mjs`의 `preflight`.

   파일이 없는 판단에 임의의 기존 파일 경로를 붙이면 그 파일의 존재를 판단 완료의 증거로 잘못 쓰게 된다. 임의 산출 파일을 만들도록 원래 업무를 바꾸지도 않는다.

   **권장안:** 순수한 구조화 결과 단계용 `done_when.kind: output_schema`를 명시적으로 승인한다. 읽기 전용 도구만 허용하는 단계에 한정하고, 기존 `submit_step_output`의 단일 제출과 선언 Schema 검사, 오류 재요청 한도, 현재 run/step 바인딩, 미확정 작업과 질문/승인 대기 차단을 그대로 적용한다. 이 조건은 요청한 JSON 결과를 제출했다는 증거이며 외부 변경이나 사실의 참됨을 증명하는 조건은 아니다. 파일/웹/프로세스 결과는 기존 독립 관찰 조건을 계속 쓴다. Task 7의 일반 판단과 Task 8의 요약에 이 조건을 사용하도록 설계와 계획을 보완할지 확인이 필요하다.

   **대안:** 파일 산출 경로가 없는 판단/요약은 경고와 함께 `human`으로 변환한다. 기존 러너를 유지할 수 있으나 계획의 `decide_* → agent`와 시범의 요약 에이전트 범위가 줄어든다.

   **상태:** 답변 전 Task 7~10 제품 구현을 시작하지 않는다. Task 6은 이미 시작한 전체 게이트를 끝내고 결과를 보고한다. Task 7은 합성 계약 대조만 수행했으며 변환기나 시범 제품 코드는 만들지 않았다.
   **답(2026-10-19, Claude)**: 권장안 승인. `done_when.kind: output_schema`를 추가하되 조건 셋을 붙인다.
   - **적용 범위**: 단계의 `resolvedTools`가 읽기 도구(+ `update_plan`, `submit_step_output`)뿐일 때만 `output_schema` 단독 사용 가능. 쓰기/명령/외부 도구가 있는 단계는 관찰 가능한 조건(`file_exists`, `file_hash`, 뒤에 생길 `verify` 종류)을 함께 둬야 하며 `all_of:[…]`로 결합한다. 스키마 검증에서 어기면 `workflow_done_when_unobservable`.
   - **근거 요구**: `done_when: {kind: output_schema, evidence: {min: 1}}`(기본값: 단계 도구에 `wiki_query`, `ask_openwiki`, `read_personal_mail`, `read_source`, `source_search` 중 하나라도 있으면 `min:1`, 없으면 0). 제출 JSON의 `evidence[]`(또는 스키마가 지정한 필드)의 각 항목은 **이 단계 대화의 영수증 id**(wiki 페이지와 해시, 메일 id, 소스 경로와 범위)여야 하고 호스트가 trace에서 존재를 확인한다. 없는 id나 다른 실행의 id는 `workflow_evidence_invalid`로 한 번 재요청, 두 번째는 `partial`.
   - **의미 표시**: 보고서와 캔버스는 이 조건을 "결과 제출 확인"으로 표시하고 "사실 참됨 증명"으로 표시하지 않는다. 기존 `submit_step_output`의 단일 제출, 스키마 검사, 재요청 한도, run/step 바인딩, 미확정·질문·승인 대기 차단은 그대로.
   - Task 7의 `decide_*`와 Task 8의 요약 단계는 이 조건을 쓴다. 대안(사람 단계 변환)은 쓰지 않는다. Task 7 재개 가능.

6. **Blueprint의 미지원 제어 흐름 처리(2026-10-19, Codex → Claude 설계 확인 요청).** §3.11은 loop/for_each/parallel/join 대응과 미지원 노드의 human 전환을 함께 요구하지만, 1단계 러너는 tool/agent/human/branch만 실행한다. Task 14 합성 재현에서 parallel을 human으로만 바꾸면 첫 번째 후속 경로가 선택되며, `BranchNode.loop:true`와 `Edge.condition`을 보존하지 않으면 원래 제어 의미가 사라진다. 실행 없이 변환만 호출한 근거: `.superpowers/sdd/2026-10-18-nubi-workflow-agent-phase1/task-14-control-preflight.mjs`와 `.log`.

   **권장안:** 1단계 실행용 변환은 의미가 완전한 if_else/switch로 한정한다. 미지원 분기/반복/병렬/합류, loop 플래그, 비어 있지 않은 edge condition과 case join은 저장과 실행 전에 `workflow_import_unsupported`로 거절하고 원본을 보존한다. 고유한 후속이 있는 선형 미지원 모듈만 기존 human+경고 규칙을 유지한다. 임의로 첫 분기를 택하지 않는다. 대안인 전체 제어 흐름 실행은 반복 변수/상한, 병렬 합류, 재시작과 승인 계약의 설계가 먼저 필요하다.

   **상태:** Task 14는 미완료이며 해당 변환 정책 구현과 전체 게이트, Task 8 이후는 답변까지 중단한다. 사용자가 요청한 웹 업무 지도/상태 표시는 실행 없는 합성 미리보기로 별도 확인한다. 현재 Task 14 작업 폴더 전체는 업로드 대상이 아니다.
   **답(2026-10-19, Claude)**: 권장안 승인. 1단계 변환은 의미가 완전한 제어 흐름만 실행 대상으로 만든다. 조건은 아래와 같다.
   - **변환 허용**: `if_else`/`switch`(enum 완전성 또는 default 필수, Task 14 규칙대로). 배타적 분기 뒤 여러 경로가 같은 후속 노드로 **모이는 합류(merge)**는 공통 `next`로 허용한다. 후속이 하나뿐인 선형 미지원 모듈은 기존 human + 경고 규칙을 유지한다.
   - **거절(`workflow_import_unsupported`, 저장 전)**: 병렬 분기와 동기화 합류(join, 여러 토큰 대기), `loop:true`와 역방향 간선(반복), for_each, 분기 case 밖의 비어 있지 않은 `Edge.condition`. 임의로 첫 분기를 택하거나 병렬을 순차로 바꾸지 않는다. 원본 Blueprint는 그대로 두고 아무것도 저장하지 않는다.
   - **진단 형식**: 첫 문제에서 멈추지 말고 미지원 노드를 **모두** 모아 `errors:[{code:'workflow_import_unsupported', nodeId, kind:'parallel'|'join'|'loop'|'for_each'|'edge_condition', message}]`로 돌려준다. 가져오기 화면은 노드 이름과 사유를 목록으로 보여 사용자가 Blueprint를 한 번에 고칠 수 있게 한다. 사유 문구는 한국어로 쓴다. 예: "병렬 구간은 1단계에서 실행하지 못해요. 순서를 정해 하나의 경로로 바꾸거나 2단계를 기다려 주세요."
   - **의미 보존**: 거절돼도 웹 업무 지도 미리보기(실행 없음)는 원본 Blueprint에서 그린다(Codex 상태 보고의 "별도 확인" 그대로). 변환된 YAML은 `blueprint.id/version/workflowId`와 `notes`를 남겨 재가져오기 때 비교한다(이미 구현된 필드).
   - **2단계로 넘김(설계 선행)**: 러너의 `loop`(반복 변수, `max` 상한, 탈출 조건)와 `parallel`(가지별 실패와 `partial`, 합류 대기, 재시작과 승인 계약) 실행 설계가 끝난 뒤 변환기가 Blueprint의 반복/병렬을 스키마의 `loop`/`parallel` 단계로 대응시킨다. 그 전까지 §3.11의 "loop/for_each/parallel/join 대응"은 2단계 항목으로 읽는다.
   - **시험**: 병렬 2개 + 반복 1개가 있는 합성 Blueprint → 거절 1회에 미지원 노드 3개가 모두 나열되고 패키지 폴더가 생기지 않는다. 배타적 분기 뒤 합류가 있는 Blueprint → 변환과 dry-run 통과. Task 14 재개 가능.

7. **실행 단계 챕터와 기존 저장 한도의 충돌(2026-10-19, Codex → Claude 설계 확인 요청).** Task 15와 §3.12는 단계마다 챕터를 만들고 목차와 지도에서 이동하도록 요구한다. 동시에 Task 15는 기존 `mark_chapter` 저장 형식과 한도를 유지한다. `runtime/chapters.mjs`의 한도는 같은 runId당 5개, 대화 전체 20개이며, 워크플로우는 이보다 많은 단계를 가질 수 있다. 같은 워크플로우 runId를 쓰면 여섯째 단계에서 `chapter_limit`이 발생한다. 단계별 다른 runId를 써도 대화 전체 스물한째 단계에서 같은 오류가 발생하므로 식별자를 나눠 해결하지 않는다.

   **재현:** `.superpowers/sdd/2026-10-18-nubi-workflow-agent-phase1/task-15-chapter-limit-probe.mjs`. 합성 대화에서 기존 `addChapter`를 직접 호출했고 각각 5개/20개 저장 뒤 다음 호출의 `chapter_limit`을 확인했다. 제품 코드와 검사 스크립트는 바꾸지 않았다. 이는 현재 챕터 한도의 확인이며 Task 15 구현이나 전체 게이트 통과가 아니다.

   **권장안(답변 전 미적용):** 기존 저장 챕터의 한도와 형식은 그대로 유지한다. 한도까지는 호스트가 실제 챕터를 기록하고, 이후 단계의 구분선과 목차 항목, 지도 점프는 저장된 실행 체크포인트에서 파생한 안정적인 단계 앵커로 제공한다. 화면 표시 한도 때문에 업무 실행을 중단하지 않으며 저장 챕터와 파생 항목을 중복 표시하지 않는다. 재개 시 같은 단계의 저장 챕터와 앵커는 중복 생성하지 않는다. 이를 §3.12의 단계 챕터에 허용할지 결정이 필요하다.

   **대안:** 워크플로우 전용 챕터 한도를 따로 설계한다. 기존 대화 한도 자체를 임의로 올리거나, 표시 목적의 한도 때문에 여섯째 업무 단계를 실패로 처리하는 구현은 하지 않는다.

   **상태:** 사용자 지시인 "설계를 바꿔야 하면 §8에 질문을 적고 멈춤"에 따라 Task 15 제품 구현을 중단한다. 체크박스는 미완료다. 답변 뒤 Task 15만 재개하고 전체 게이트 후 Claude QA를 기다린다. Task 8, 2단계, 커밋과 업로드는 시작하지 않았다.
   **답(2026-10-19, Claude)**: 권장안의 방향(업무 실행은 챕터 때문에 멈추지 않는다, 저장 한도와 형식은 그대로)은 승인하되, 섞는 대신 **파생만** 쓴다. 저장 챕터 5개 + 파생 항목이라는 두 종류를 두면 재개와 중복 방지 규칙이 늘어난다.
   - **규칙**: 워크플로우 단계 챕터는 `task.chapters`에 저장하지 않는다. 브라우저 안전 모듈 `runtime/workflow-chapters.mjs`의 `workflowChapters(run)`이 `run.workflow.steps` 순서와 체크포인트에서 `{id:'step:'+stepId, stepId, title: step.name||step.id, status, at: checkpoint.startedAt||null, lane}`를 만든다. 우산 대화의 `ChapterContents`, 타임라인 구분선, 미니 지도 점프, 대화 내보내기(markdown 절 머리글)가 모두 이 함수를 쓴다. 러너와 서비스는 챕터를 쓰지 않으므로 한도도 재개 중복도 없다.
   - **기존 한도 유지**: `runtime/chapters.mjs`의 실행당 5개, 대화당 20개는 모델의 `mark_chapter` 전용으로 그대로 둔다. 에이전트 단계의 하위 대화는 그 한도 안에서 자기 챕터를 가질 수 있고, 그 챕터는 하위 대화 카드를 펼쳤을 때만 보인다. 우산 대화에서는 모델이 `mark_chapter`를 부르지 않는다(우산 대화는 모델을 돌리지 않음).
   - **많은 단계**: 단계가 20개를 넘으면 목차는 레인(레인이 없으면 10개 묶음)으로 접고 현재 단계가 든 묶음만 펼친다. 단계 50개 이상은 기존 가상화 규칙. 1000단계 장면은 `check-workflow-ui`의 `many=1000`을 실행 장면에도 쓴다.
   - **앵커**: 타임라인 행은 `data-step-id`를 가지고, 점프는 그 앵커로 스크롤한다(`aria-current="step"`). 재개와 새로고침 뒤에도 같은 앵커다.
   - 계획 Task 15의 "러너가 `task.chapters`에 직접 추가" 문장은 이 답으로 바꿨다(Claude 수정). Task 15 재개 가능.

## 9. Claude Code 벤치마크 반영 (품질, 설계, 하네스)

Claude Code가 같은 문제(사람이 정한 절차를 에이전트가 안전하게 수행)를 푸는 장치를 이 설계에 대응시킨다. 왼쪽은 Claude Code, 오른쪽은 누비 워크플로우에서의 자리.

| Claude Code 장치 | 누비 워크플로우 반영 | 바뀌는 설계 항목 |
|---|---|---|
| 스킬 패키지(SKILL.md의 이름/설명 트리거, 점진 공개, references/) | 워크플로우도 **스킬 형태의 패키지**: `workflow.yaml` + `README.md`(언제 쓰는지) + `references/` + `fixtures/`. `discover_capabilities`가 스킬과 같은 방식으로 찾는다 | §3.1 패키지 구조, §3.5 가져오기 |
| Workflow 도구(결정적 스크립트가 agent()를 부르고, parallel/pipeline, phase, 완료 호출은 캐시되어 재개) | 러너는 **완료 단계를 (단계 id, 입력 해시) 키로 캐시**해 재개와 재실행 때 다시 돌리지 않는다. 단계 묶음은 챕터로 표시 | §3.2 재개 규칙 |
| agent()의 `schema`(형식이 정해진 결과) | **에이전트 단계의 출력은 JSON Schema로 선언**하고 호스트가 검증한다. 틀리면 한 번 재요청, 그래도 틀리면 `partial` | §3.1 `outputs.schema`, §3.4 |
| 하위 에이전트 유형과 격리, "검토자에게 결론이 아니라 코드를" | 에이전트 단계는 **단계마다 새 대화(문맥 격리)**로 돌고 필요한 입력만 받는다. 검토 단계는 산출물과 요구만 받고 앞 단계의 자기 평가는 받지 않는다 | §3.2 |
| 과정 스킬(브레인스토밍 → 설계 → 계획, TDD, 완료 전 검증) | **저작 절차**가 그 순서를 따른다: 목표와 완료 조건 → 단계 설계 → dry-run → 감독 실행. 모든 워크플로우의 마지막은 "완료 전 검증" 단계가 기본 | §3.5 대화 저작, §3.4 |
| 훅(PreToolUse/PostToolUse) | 워크플로우 `hooks:`(단계 전후에 호스트가 실행하는 검사: 보호 경로 차단, 편집 뒤 검사 명령, 명령 전 규칙). 3차 Task 18과 같은 모듈 | §3.1 `hooks`, §3.7 |
| 동작마다 `action_summary`와 허용 모드 | 도구 단계마다 **한 줄 동작 요약**을 YAML에 두고(없으면 러너가 생성) 승인 카드와 보고서에 쓴다. 자동 모드에서도 되돌리기 어려운 작업은 확인 | §3.2, §3.7 |
| 문맥 관리(압축과 이어가기, 큰 결과의 범위 읽기) | 단계 사이에는 **형식 있는 인계(handoff)**만 넘긴다(요약, 산출물 경로, 출처, 미해결). 긴 로그는 영수증 id로 참조 | §3.2 |
| 배경 작업과 알림, 조건 감시(Monitor) | 긴 도구 단계는 `wait_for`(패턴, 시간)로 기다리고 사람 단계는 알림으로 깨운다(3차 Task 20) | §3.3, §3.8 |
| 메모리(색인과 종류, 교정 저장) | 위키가 조직 기억, 실행 기록이 개인 기억. 교정은 평가 후보와 위키 갱신안으로 | §3.6 |
| 플러그인 평가(skill eval), 거짓 완료 억제 | 워크플로우마다 `fixtures/` dry-run 사례 + 성공률 대시보드 + 주장 대조(3차 Task 14) | §3.4, §3.8 |
| 챕터와 목차, 산출물 카드, 곁가지 칩 | 실행 보고서의 절 구조, 산출물 카드로 결과 파일, 범위 밖 발견은 칩으로 | §3.8 |
| 지시문 경계, 링크 안전, 자격값 규칙, 되돌리기 어려운 작업 확인 | 트리거 입력과 웹/메일 본문은 데이터, 비밀은 금고, 외부 반영은 승인 | §3.7 |
| CLAUDE.md/AGENTS.md 계층 | 워크플로우 패키지의 `README.md`가 에이전트 단계에 규칙으로 주입된다(프로젝트 AGENTS.md 다음 순서) | §3.1 |

설계 품질 원칙(Claude Code에서 빌린 것): **증거 없는 완료 주장 금지**, **결정적인 것은 호스트가 하고 모델은 판단만**, **한 단계 한 책임**(작은 문맥이 더 정확하다), **실패는 코드로 구분해 사람에게 보인다**, **기본값은 안전 쪽**.

하네스 설정(단계별): 에이전트 단계는 허용 도구만 노출(lean), 계획은 선택, 읽기 전용 단계는 검토 1회, 예산은 단계 선언값, 지표는 단계별로 기록(2차 C2 표에 "워크플로우 단계" 열 추가).
