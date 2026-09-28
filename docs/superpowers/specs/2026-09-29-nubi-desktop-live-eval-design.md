# 누비 Desktop 실측 루프와 계측

- 날짜: 2026-09-29
- 상태: 사용자 승인된 설계. 구현 계획은 `docs/superpowers/plans/2026-09-29-nubi-desktop-live-eval.md`. 2026-09-29에 사용자 요청으로 `packages/nubi-desktop`에 반영했다. 실제 패키지에서 365개 중 364개 검사가 통과했고 실패 1개는 반영 전부터 있던 것이다. 앱 번들 빌드와 실모델 측정은 아직 하지 않았다. 빌드는 계측과 무관한 디자인 검사에서 멈춘다(`packages/nubi-desktop/docs/LIVE-EVAL.md`의 빌드 상태).
- 대상: `packages/nubi-desktop` (제품명 누비 workspace)
- 위치: 누비 Desktop 품질 개선의 첫 하위 과제. 사용자가 승인한 순서는 실측 루프와 계측, OpenWiki 검색과 최신성, 문맥 비용, 컴퓨터 유즈, 멀티 에이전트다.
- 환경: macOS 개발 PC, Node 24 이상. 회사 PC와 Windows는 이번 범위가 아니다.

## 1. 목적

누비 Desktop은 승인, 해시 검사, 미확정 실행 보호 같은 제어 장치를 촘촘히 갖췄다. 그러나 실제 모델로 문제를 얼마나 푸는지, 호출마다 문맥을 얼마나 쓰는지 측정한 기록이 없다. 이 과제는 다음 두 가지를 만든다.

1. **제품 계측**: 모델 호출과 도구 호출의 목적, 크기, 사용량, 지연을 실행별로 남긴다.
2. **평가 실행기**: 고정한 과제를 실제 모델로 돌리고 모델의 완료 선언과 무관하게 채점한다.

이후 하위 과제는 이 틀로 변경 전후를 비교한다. 이 과제 자체는 에이전트의 동작을 바꾸지 않는다.

## 2. 조사로 확인한 사실

| 항목 | 확인 내용 | 근거 |
|---|---|---|
| 실모델 실행 | 없음. 모든 검사가 `service.providers.complete`를 대역으로 교체 | `tests/fixtures.mjs:29-37` |
| 검토 대역 | 항상 `ready`, 모든 확인 항목 `unknown` 반환 | `tests/fixtures.mjs:12-16` |
| 계측 | `agent_round`, `agent_stopped` 이벤트와 최근 80개 trace뿐. 토큰, 지연, 도구 결과 크기 없음 | `runtime/agent.mjs:256,273,279` |
| 모델 호출 통로 | 실행, 계획, 요약, 검토, 하위 분석, 문서 조사가 모두 `modelTransport` 하나를 지남 | `runtime/recovery.mjs:15-21`, `runtime/agent.mjs:101-122,174,255,270` |
| 제공자 | Office와 같은 `createProviders` 사용 | `runtime/agent.mjs:18,33` |
| 무인 실행 | `createTask`, `startAgent`, `agent.promise`, `answerAgent`로 화면 없이 구동 가능 | `runtime/agent.mjs:281-296`, `tests/agent-reuse.test.mjs:41` |
| 제안 반영 | 편집기가 파일을 쓰고 `confirmProposal`이 해시를 확인 | `runtime/project-service.mjs:177-194` |
| 사용량 형식 | `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens` | `extensions/aipro-chat/usage.js:9-21` |
| 실행 입력 목록 | 번들이 실제로 읽는 소스 목록이 빌드 때 기록됨 | `generated/source-inputs.json` |
| 선례 | Office의 모델 중계 세션, 기록기, 실행기 | `packages/nubi-office/eval/sim/` |
| 평가 자료 | 실제 OpenWiki 30쪽(약 46만 자), Claims 22개, 생성 기록. 영어 | `packages/openwiki/openwiki/` |
| 실제 뒤처짐 | Wiki는 2026-09-17 커밋 `db1c0f0` 기준. 이후 `src` 파일 24개가 변경됨 | `openwiki/.last-update.json`, 파일 수정 시각 |
| 모델 대기 규칙 | 진행 신호 없이 120초가 지나면 시간 초과로 재시도 | `extensions/aipro-chat/model-recovery.js:6` |

### 합성 모델로 실제 실행기를 돌려 측정한 값

2026-09-29에 실제 `ProjectService`와 공유 실행기에 미리 짠 모델 응답을 연결해 측정했다. 실모델 품질이 아니라 요청 크기와 호출 구조의 측정이다.

| 항목 | 값 |
|---|---|
| 한 줄 질문 하나의 모델 호출 | 4회 (실행, 계획, 실행, 검토) |
| 실행 호출의 도구 정의 | 41개, 39,542자 |
| 실행 호출의 시스템 안내 | 첫 호출 11,963자, 둘째 호출 14,200자 |
| 실행 호출의 추정 입력 토큰 | 첫 호출 14,095 |
| 짧은 과제의 고정 비용 비중 | 약 87% |
| 기존 검사 | 302개 중 301개 통과. 입력 한도 14,000 토큰을 가정한 문맥 예산 검사 1개가 `context_input_too_large`로 실패 |

마지막 행은 이 과제의 변경과 무관한 기존 상태다. 고정 비용만으로 14,000 토큰을 넘기 때문이며 문맥 비용 과제에서 다룬다.

### 브라우저 누비의 교훈

2026-09-28 실측에서 검토 지침을 추가한 후보는 독립 통과가 3/5에서 2/5로 내려갔고 호출과 시간이 늘었다(`docs/plans/2026-09-28-nubi-browser-first-principles-audit.md`). 계층을 추가하기 전에 측정하고, 한 번에 한 원인만 바꾼다.

## 3. 접근안과 선택

| 안 | 내용 | 판단 |
|---|---|---|
| **A. 제품 계측과 전용 실행기** | 호스트가 SQLite에 계측을 남기고, 평가 실행기는 계측과 전체 대화 기록을 함께 수집 | **채택** |
| B. 평가 전용 감싸기 | 제품은 그대로 두고 제공자 호출만 밖에서 기록 | 탈락. 도구 결과 크기, 압축 시점, 호출 목적을 알 수 없다 |
| C. 외부 평가 프레임워크 | promptfoo 등 | 탈락. 질문과 승인이 있는 상태형 실행과 맞지 않는다. Office도 전용 실행기를 만들었다 |

## 4. 구성

```
packages/nubi-desktop/
  runtime/run-metrics.mjs     제품 계측 (신규)
  runtime/recovery.mjs        modelTransport에 목적 인자 추가 (수정)
  runtime/agent.mjs           호출 지점에 목적 표시, 도구 계측 연결 (수정)
  eval/
    relay.mjs                 모델 호출 중계 서버와 연결
    model-session.mjs         로그인 유지
    transcript.mjs            모델 호출 전체 기록과 호출 한도
    corpus.mjs                자료 스냅샷 검증과 작업 공간 생성
    pin-corpus.mjs            자료 스냅샷과 해시 목록 생성
    corpus-src/order-service/ 합성 자료의 원본
    cases.mjs                 과제 읽기와 형식 검사
    user.mjs                  모의 사용자
    driver.mjs                과제 구동과 한도
    grade.mjs                 채점
    candidate.mjs             실행 후보 식별
    run.mjs                   실측 실행기
    compare.mjs               보고서 비교
    cases/*.json              과제 정의와 정답
    corpus/                   자료 스냅샷과 해시 목록
```

`eval/`은 제품 번들에 넣지 않는다. `scripts/build-runtime.mjs`의 진입점은 바꾸지 않는다.

### 4.1 제품 계측

`createRunMetrics({store, taskId, runId})`가 세 종류의 이벤트를 기존 `events` 표에 남긴다.

| 종류 | 필드 |
|---|---|
| `metric_model` | `taskId, runId, sequence, purpose, attempt, model, messageCharacters, systemCharacters, toolCharacters, imageCount, estimatedTokens, usage, elapsedMs, finishReason, calls, error` |
| `metric_tool` | `taskId, runId, sequence, tool, scope, elapsedMs, resultCharacters, imageCount, error` |
| `metric_compaction` | `taskId, runId, trigger, beforeTokens, afterTokens` |

규칙은 다음과 같다.

- `purpose`는 `actor, planner, reviewer, summary, analysis, document` 중 하나다. **호출 지점이 직접 표시한다.** 프롬프트 내용으로 추측하지 않는다.
- `modelTransport`가 돌려주는 함수는 넷째 인자로 `purpose`를 받는다. 재시도마다 `attempt`를 올려 따로 기록한다.
- `calls`는 도구 이름 배열이다. 인자는 기록하지 않는다.
- `usage`는 제공자가 준 값만 쓴다. 없으면 `null`이다.
- `estimatedTokens`는 기존 `contextTokens`로 계산한다. 실제 값과의 차이를 보기 위한 값이다.
- `error`는 `/^[a-z_]{1,64}$/`에 맞는 코드만 남긴다. 그 밖은 `unknown`이다.
- `resultCharacters`는 모델에 돌려주는 결과의 JSON 길이다. 이미지 자료는 길이에서 빼고 `imageCount`로 센다.
- `trigger`는 `history, threshold, overflow` 중 하나다.
- `scope`는 `leader` 또는 `child`다. 하위 분석이 호출한 도구는 `child`다.
- **본문, 인자, 경로 밖의 파일 내용은 저장하지 않는다.**
- **기록 실패는 실행을 멈추지 않는다.** 모든 기록 호출은 예외를 삼킨다.
- 실행을 시작할 때 30일이 지난 `metric_*` 이벤트를 지운다.

`readRunMetrics(store, {taskId, runId})`는 이벤트를 순서대로 읽어 목적별, 도구별 합계를 돌려준다. 공유 실행기의 `onDiagnostic`은 연결하지 않는다. 필요한 값은 호스트의 호출 지점에서 모두 얻는다.

### 4.2 모델 세션

코드를 고칠 때마다 로그인하지 않도록 로그인 보유 프로세스와 실행 프로세스를 나눈다. Office의 설계를 따른다.

- `eval/model-session.mjs`가 `createProviders().login()`을 호출한다. 사용자가 브라우저에서 직접 로그인한다.
- 인증값은 세션 프로세스 메모리에만 둔다. 파일, 로그, 기록, 소켓 응답에 쓰지 않는다.
- 실행 프로세스는 권한 `0700` 디렉터리의 유닉스 소켓으로 `status`, `complete`, `cancel`만 요청한다.
- 중계는 Desktop 전용 `eval/relay.mjs`를 쓴다. Office의 중계와 다른 점은 셋이다.
  - `status`의 모델 항목에 `contextLength, maxInputTokens, maxOutputTokens, supportsImages`를 포함한다. Desktop의 문맥 예산이 이 값을 읽는다(`runtime/agent.mjs:116`).
  - 모델의 진행 신호를 내용 없이 전달한다. 전달하지 않으면 120초 넘는 응답이 시간 초과로 끊긴다.
  - 소켓 경로가 100바이트를 넘으면 `socket_path_too_long`으로 거부하고, 소켓 오류가 프로세스를 끝내지 않게 처리한다.
- 기본 제공자는 `chatgpt`, 기본 모델은 `gpt-5.6-luna`다.

### 4.3 자료와 작업 공간

| 자료 | 성격 | 용도 |
|---|---|---|
| `openwiki-sds` | `packages/openwiki`의 `src`, `openwiki`, 최상위 문서. 공개 소스, 영어, 실제 뒤처짐 포함 | Wiki 질문, 소스 질문, 문서 조사 |
| `order-service` | 의존성 없는 작은 Node 프로젝트와 한국어 Wiki 6쪽. 합성 | 코드 수정, 긴 대화, 한국어 Wiki 질문 |

- 각 자료는 `eval/corpus/<이름>.tar.gz`와 파일별 SHA-256 목록으로 고정한다. 원본 폴더가 바뀌어도 과제와 정답은 유효하다.
- `pin-corpus.mjs`가 스냅샷과 목록을 만든다. 다시 만들면 해당 자료를 쓰는 과제의 정답을 다시 검토해야 한다.
- 시도마다 임시 폴더에 스냅샷을 풀고 새 Git 저장소로 커밋한다. 상태 DB도 시도마다 새로 만든다.
- 실행기는 풀어낸 파일을 목록과 대조한다. 다르면 `corpus_changed`로 실행을 거부한다.
- **과제 정의와 정답은 작업 공간에 넣지 않는다.** 모델에게 보내는 것은 과제의 요청과 모의 사용자의 답뿐이다.
- 작업 공간을 만드는 함수는 자료 이름만 받는다. 경로를 받는 인자가 없다. 전체 대화를 기록하므로 회사 저장소에 쓰면 안 된다.
- 과제는 선택한 모델의 문맥 한도를 낮춰 지정할 수 있다. 높일 수는 없다. 압축 과제가 쓴다.

새 Git 저장소에는 Wiki 생성 당시의 커밋 `db1c0f0`이 없다. 커밋 기준 최신성 비교에 필요한 이력 구성은 둘째 하위 과제에서 정한다.

### 4.4 모의 사용자

- 질문: 과제의 `dialogue` 항목 중 정규식이 맞는 것이 정확히 하나일 때만 답한다. 항목은 한 번만 쓴다. 맞는 것이 없거나 여럿이면 `needs_human`으로 끝낸다.
- 제안 반영: 과제의 `approvals`에 `patch` 또는 `new_file`이 있을 때만 반영한다. 편집기와 같은 순서로 `prepareProposal`, 파일 쓰기, `confirmProposal`을 호출한다. 새 파일은 `applyNewFile`을 쓴다.
- 반영 시점: 마지막 발화가 끝난 뒤 한 번. 같은 경로에 제안이 여럿이면 가장 최근 것만 반영한다.
- 후속 발화: 과제의 `followUps`를 순서대로 보낸다.
- 질문이 기대 결과인 과제는 `stopAtQuestion`으로 표시하고 질문에서 멈춘다.
- **승인하지 않는 것**: 명령 실행, 환경 설정, 관리자 실행, 명령 수정안, 컴퓨터 동작, 앱 연결. 1차 과제는 이를 요구하지 않는다.

### 4.5 구동과 한도

| 한도 | 값 | 초과 시 |
|---|---|---|
| 과제 시간 | 10분 | `stopAgent` 후 `error: evaluation_case_timeout` |
| 모델 호출 | 80회 | `error: evaluation_model_budget` |
| 사용자 상호작용 | 12회 | `error: evaluation_interaction_budget` |

한도는 평가 전용이다. 제품의 실행 제한을 바꾸지 않는다.

### 4.6 채점

| 검사 | 통과 조건 |
|---|---|
| `answer_includes` | 묶음마다 대안 중 하나가 최종 답변에 있음. 공백, 대소문자, 유니코드 형태를 정규화. `re:`로 시작하는 대안은 정규식 |
| `answer_excludes` | 금지한 주장이 최종 답변에 없음 |
| `answer_flags` | 해당 문자열이 답변에 있으면 통과 대신 `needs_review` |
| `retrieved` | 주 실행기가 받은 도구 결과에 정답 경로가 최소 개수 이상 포함. 하위 분석의 조회는 세지 않음 |
| `cited` | 최종 답변이 정답 경로나 그 파일 이름을 언급 |
| `files` | 반영 후 파일 내용이 기대한 문자열을 포함하거나 포함하지 않음 |
| `test` | 채점기가 숨긴 검사 파일을 작업 공간에 넣고 직접 실행한 종료 코드. 에이전트의 실행 결과를 쓰지 않음 |
| `unchanged_except` | Git 상태의 변경이 허용 경로 안에만 있음. 숨긴 검사 파일은 제외 |
| `asked` | 질문 여부가 기대와 일치 |
| `state` | 최종 작업 상태가 기대와 일치 |
| `compacted` | 압축이 한 번 이상 일어남. 일어나지 않으면 과제가 성립하지 않으므로 `invalid` |

결과는 `passed, failed, needs_review, needs_human, invalid, error, not_run` 중 하나다. 의미 판단이 필요한 과제는 `manual: true`로 표시하고 `needs_review`로 둔다. 통과로 세는 것은 `passed`뿐이다. **모델의 완료 선언과 검토기의 `ready`는 점수에 넣지 않는다.**

숨긴 검사 파일은 자료에 없는 경로를 쓴다. 명령은 `node`로 시작하는 것만 허용한다.

### 4.7 보고서

- 위치: `verification/eval-live/<실행 ID>/`. `verification/`은 Git에서 제외되어 있다.
- `report.json`: `kind: 'desktop-live-model-evaluation'`, 제공자, 모델, 후보 해시, 자료 해시, 한도, 과제별 결과, 묶음별 집계, 목적별 계측 합계, 근거의 경계.
- 과제별 폴더: `transcript.jsonl`, `metrics.json`, `result.json`.
- 후보 해시는 `generated/source-inputs.json`에 적힌 파일과 `runtime/`의 모든 모듈의 현재 내용으로 계산한다. 목록에 적힌 파일이 없으면 `candidate_inputs_stale`로 멈춘다. 그때는 `npm run compile`로 목록을 갱신한다.
- `report.json`에는 답변 본문을 넣지 않는다. 본문은 과제별 폴더에만 둔다.
- `compare.mjs`는 두 보고서를 받아 과제별 결과와 목적별 비용의 차이를 표로 낸다. 모델이나 자료 해시가 다르면 비교를 거부한다. 후보 해시가 같으면 같은 후보의 반복 측정으로 표시한다.

## 5. 과제 묶음 1차

20개다. 14개는 개발용, 6개는 보류용이다. 개선은 개발용 결과만 보고 조정한다. 보류용은 전후 보고에만 쓴다.

| 묶음 | 자료 | 수 | 과제 |
|---|---|---:|---|
| Wiki 질문 | openwiki-sds | 5 | 단일 쪽 사실, 여러 쪽 종합, Wiki에 없는 내용, 뒤처진 내용, 한국어 업무 표현으로 묻기 |
| Wiki 질문 | order-service | 1 | 한국어 Wiki 단일 사실 |
| 소스 질문 | openwiki-sds | 3 | 상수 값 찾기, 호출 흐름 추적, Wiki와 소스가 다른 곳 찾기 |
| 코드 수정 | order-service | 5 | Wiki 규칙을 따라야 하는 수정, 단일 파일 수정, 새 파일, 금지 조건 보존, 모호한 요청 |
| 문서 조사 | openwiki-sds | 3 | 긴 문서 두 개 비교, 여러 문서에서 목록 수집, 문서에 없는 내용 |
| 긴 대화 | order-service | 3 | 압축 뒤 초기 조건 보존, 짧은 후속 요청, 사용자 정정 |

핵심 과제의 기대 동작은 다음과 같다.

| 과제 | 통과 기준 |
|---|---|
| Wiki에 없는 내용 | 답을 지어내지 않고 확인하지 못했다고 밝힘 |
| 뒤처진 내용 | Wiki의 옛 설명과 현재 소스가 다름을 밝히고 현재 소스 기준으로 답함 |
| 금지 조건 보존 | 요청한 수정은 하고 금지한 파일은 바꾸지 않음 |
| 모호한 요청 | 추측해서 수정하지 않고 질문함 |
| 압축 뒤 조건 보존 | 첫 발화의 조건이 마지막 수정에 반영됨 |

압축 과제는 네 번의 발화로 구성하고 모델의 문맥 한도를 28,000 토큰으로 낮춘다. 고정 비용이 약 14,000 토큰이므로 더 낮추면 매 호출마다 압축이 일어나 측정이 왜곡된다.

과제 정의 형식과 각 과제의 정답은 구현 계획에 적는다. 정답의 인용은 모두 원문에서 다시 확인했고, 정답이 자료의 실제 문장으로 뒷받침되는지 검사로 고정한다.

## 6. 지표

단일 가중 점수는 만들지 않는다.

| 분류 | 지표 |
|---|---|
| 품질 | 독립 통과, 답변 전달, 잘못된 완료, 불필요한 질문, 필요한 질문 누락 |
| 검색 | 정답 경로 도달, 정답 경로 인용 |
| 호출 | 목적별 모델 호출 수, 재시도 수, 도구별 호출 수 |
| 문맥 | 목적별 입력 토큰, 최대 요청 크기, 고정 비용 비중, 도구별 결과 크기, 압축 횟수 |
| 캐시 | 캐시 토큰 비율 |
| 시간 | 목적별 지연, 과제 전체 시간 |
| 추정 오차 | 추정 토큰과 실제 입력 토큰의 비 |

- **잘못된 완료**: 작업이 `review`에 도달하고 검토 결과가 `ready`인데 채점이 실패한 경우.
- **고정 비용 비중**: `(systemCharacters + toolCharacters) / 전체 요청 크기`.

## 7. 개선 루프

1. 후보 B0 고정: 현재 소스의 후보 해시를 기록한다.
2. 기준선 실측: 과제당 1회. 결과가 갈리는 과제는 3회.
3. 실패 분류: 아래 표의 유형으로 나눈다.
4. 한 원인씩 재현 검사를 먼저 쓰고 수정한다.
5. 같은 과제를 다시 실측해 전후를 비교한다.
6. 결과와 근거의 경계를 `packages/nubi-desktop/docs/`에 기록한다.

| 실패 유형 | 관찰 지점 |
|---|---|
| 검색 실패 | `retrieved` 실패. 정답 경로에 도달하지 못함 |
| 근거 무시 | `retrieved` 통과, `answer_includes` 실패 |
| 지어낸 답 | `answer_excludes` 실패 또는 Wiki에 없는 내용 과제 실패 |
| 조건 누락 | `unchanged_except` 실패 또는 금지 조건 과제 실패 |
| 질문 오판 | `asked` 불일치 |
| 검토 오판 | 잘못된 완료, 또는 채점은 통과인데 검토가 막음 |
| 무진전 반복 | 같은 도구 결과 반복으로 질문 전환 |
| 과다 호출 | 모델 호출 한도 초과 또는 목적별 호출 수 급증 |
| 도구 형식 오류 | `metric_tool`의 인자 오류 코드 |

## 8. 오류 처리

| 상황 | 처리 |
|---|---|
| 모델 세션 없음 또는 로그인 실패 | 과제를 실행하지 않고 `not_run`. 실패로 세지 않음 |
| 실행 중 세션 끊김 | 현재 과제는 `error: worker_disconnected`. 남은 과제는 `not_run` |
| 자료 해시 불일치 | 실행 거부 |
| 한도 초과 | 해당 과제만 `error`. 다음 과제로 진행 |
| 계측 기록 실패 | 무시. 실행과 채점은 계속 |
| 채점기의 검사 명령 실패 | 해당 검사 실패로 기록. 과제는 `failed` |

## 9. 검사

모두 미리 짠 모델 응답을 쓰는 단위 검사다. 실모델 품질의 증거가 아니다.

| 파일 | 수 | 확인 |
|---|---:|---|
| `tests/run-metrics.test.mjs` | 5 | 크기 계산, 본문 미저장, 중복 기록 방지, 기록 실패 무시, 30일 정리 |
| `tests/run-metrics-wiring.test.mjs` | 3 | 호출 지점별 목적, 재시도별 기록, 압축 원인 |
| `tests/eval-relay.test.mjs` | 8 | 상태에 인증값 없음, 모델 한도 포함, 진행 신호 전달, 취소 전달, 세션 끊김, 소켓 권한과 경로 길이 |
| `tests/eval-transcript.test.mjs` | 6 | 전체 기록, 호출 한도, 문맥 한도 낮추기, 주 실행기 결과만 수집 |
| `tests/eval-corpus.test.mjs` | 6 | 해시 불일치 거부, 등록하지 않은 이름 거부, 링크 거부, 변경 목록 |
| `tests/eval-user.test.mjs` | 6 | 정의한 질문만 답함, 정의한 승인만 허용, 경로별 최신 제안만 반영 |
| `tests/eval-grade.test.mjs` | 8 | 검사 종류별 통과와 실패, 완료 선언을 점수에 넣지 않음, 다시 채점해도 같은 결과 |
| `tests/eval-driver.test.mjs` | 8 | 질문과 답, 제안 반영, 후속 발화, 세 한도, 세션 끊김 |
| `tests/eval-run.test.mjs` | 6 | 보고서 형식, 목적별 합계, `not_run` 분리, 비교, 후보 식별 |
| `tests/eval-cases.test.mjs` | 7 | 과제 20개의 형식과 분할, 정답 경로 존재, 정답이 자료로 뒷받침됨, 압축 과제가 실제로 압축됨 |

새 검사는 63개다. 복제 환경에서 전체 365개 중 364개가 통과했고, 실패 1개는 2절의 기존 실패다.

기존 검사는 모두 그대로 통과해야 한다.

## 10. 하지 않는 것

- `extensions/aipro-chat` 수정. 다른 작업이 진행 중이므로 읽기만 한다.
- 에이전트 동작, 프롬프트, 도구 정의 변경.
- 컴퓨터 유즈 과제. 모의 UIA 호스트가 필요하며 넷째 하위 과제에서 추가한다.
- 회사 PC용 화면 요약. 파일을 반출할 수 없는 환경은 별도로 설계한다.
- 계측 화면. 값은 SQLite와 보고서로만 본다.
- 설치 파일과 Windows 빌드.

## 11. 근거의 경계

이 과제의 실측 결과는 **`gpt-5.6-luna`, macOS, 공개 자료와 합성 자료** 기준이다.

- 사내 Qwen 3.8 27B의 성능이 아니다. 더 강한 모델이므로 약한 모델에서만 나타나는 실패는 드러나지 않을 수 있다.
- 회사 저장소와 회사 Wiki의 정확도가 아니다.
- Windows 앱 조작은 측정하지 않는다.
- 과제 20개는 작은 표본이다. 통계적 우월성으로 표현하지 않는다.

보고서와 문서에 이 구분을 항상 함께 적는다.

## 12. 후속 하위 과제의 후보

조사에서 코드로 확인한 빈틈이다. 실제 영향은 기준선 실측으로 확인한 뒤 각 과제의 설계에서 확정한다.

### OpenWiki 검색과 최신성

| 빈틈 | 근거 | 후보 |
|---|---|---|
| Claim 문장을 모델에 주지 않음 | `runtime/wiki-evidence.mjs`는 버전만 대조 | 발췌에 해당 Claim 문장과 소스 위치를 함께 반환 |
| 생성 커밋을 읽지 않음 | `.page-manifest.json`, `.last-update.json` 미사용 | 현재 HEAD와 비교해 뒤처진 정도 표시 |
| Wiki 지도 미사용 | `quickstart.md`, 설명, 태그, 링크 그래프 미사용 | 실행 시작 때 짧은 지도 제공 |
| 질의마다 인덱스 재생성 | 문서 400개를 매번 다시 읽음 | 파일 해시 기준 캐시 |
| 전체 Wiki 질문 미사용 | `runWikiQuestion`은 선택한 파일에만 실행 | 넓은 질문을 Wiki 조사 하위 에이전트에 위임 |
| 자체 기록이 검색에 섞임 | `nubi-evidence`, `nubi-map`이 항상 미검증으로 검색됨 | 프로젝트 지식과 작업 이력 분리 |
| Wiki 갱신을 시작할 수 없음 | 생성과 갱신 호출 없음 | 뒤처짐 감지 시 기존 명령 승인 흐름으로 제안 |

### 문맥 비용

| 빈틈 | 근거 | 후보 |
|---|---|---|
| 화면 관찰이 줄지 않음 | 공통 축소기는 `frames`가 있는 결과만 인식 | 새 관찰이 오면 이전 관찰을 요약으로 교체 |
| 도구 약 40개 상시 전송 | `runtime/agent.mjs:63-100`, `extensions/aipro-chat/analysis-agents.js:65-72` | 의도별 도구 묶음 |
| 시스템 메시지가 매 턴 바뀜 | `extensions/aipro-chat/agent-runtime.js:797-820` | 바뀌는 상태를 뒤쪽 메시지로 옮겨 앞부분 캐시 활용. 공유 소스 수정 필요 |
| 실행 간 근거 재사용 없음 | 근거 저장소는 실행 끝에 비움 | 해시가 같은 근거는 요약으로 이어받기 |
| 고정 비용이 작은 모델의 한도를 넘음 | 입력 한도 14,000 토큰 검사가 현재 실패 | 도구 묶음 축소가 먼저. 검사를 통과시키려고 한도를 올리지 않는다 |
| 긴 현재 발화가 요약으로 대체됨 | 문맥 한도 32,000에서 6,000자 발화를 붙이면 실행 호출에 발화 본문이 없었음. 합성 모델 탐침 | 현재 발화는 원문을 유지하고 넘치면 사용자에게 알림 |
| 같은 구간을 다시 요약할 가능성 | 위 탐침에서 같은 크기의 요약 호출이 두 턴 연속 발생. 원인 미확인 | 실측 기록으로 확인 후 저장한 요약 경계 재사용 점검 |

### 컴퓨터 유즈

| 빈틈 | 근거 | 후보 |
|---|---|---|
| 평면 목록, 부모 정보 없음 | `runtime/computer-use.mjs:37` | 부모 경로를 포함한 한 줄 표현 |
| 화면 밖 요소 포함 | 표시만 하고 거르지 않음 | 관찰 단계에서 제외 |
| 동작 후 변화분 미제공 | 요소 해시는 반복 감지에만 사용 | 추가, 삭제, 변경 요소만 전달 |
| 안정 대기 없음 | 동작 직후 바로 재조회 | 요소 해시가 안정될 때까지 제한된 대기 |
| 스크롤 없음 | 지원 동작 목록에 없음 | UIA Scroll 패턴 |
| 이미지 지원 미검사 | 안내 문구에만 의존 | 모델의 `supportsImages`로 코드에서 검사 |
| 동작마다 새 실행 | 계획과 재관찰 반복 | 묶음 승인. 승인 규칙 변경이므로 사용자 결정 필요 |

### 멀티 에이전트

| 빈틈 | 근거 | 후보 |
|---|---|---|
| 검토기의 오판율 미측정 | 검사 대역이 항상 `ready` | 알려진 오답을 넣어 놓침과 오거절을 측정 |
| 하위 실행 사용량 미저장 | 주 실행기에만 반환 | 이 과제의 `analysis` 계측으로 해결 |
| 검토 재실행 때 안내 중복 가능성 | `lastWire`에서 재시작. 추정이며 미검증 | 실측 기록으로 확인 |

### Office 평가 중계에 알릴 사항

Desktop 중계를 만들며 확인했다. Office의 `eval/sim` 중계는 이 과제에서 수정하지 않는다.

| 사항 | 근거 |
|---|---|
| 진행 신호를 전달하지 않아 120초 넘는 응답이 시간 초과로 끊길 수 있음 | `packages/nubi-office/eval/sim/model-session.mjs:42` |
| Node 25에서 소켓 연결 실패가 처리되지 않은 오류로 프로세스를 끝냄 | readline이 소켓 오류를 다시 발생시킴. Desktop 중계에서 재현 |

### 사용자 결정이 필요한 사항

| 사항 | 필요한 시점 |
|---|---|
| 공유 소스 `extensions/aipro-chat` 수정 허용 | 문맥 비용 과제 시작 전 |
| 컴퓨터 동작 묶음 승인 도입 | 컴퓨터 유즈 과제 시작 전 |
