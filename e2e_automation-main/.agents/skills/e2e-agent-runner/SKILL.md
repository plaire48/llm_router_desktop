---
name: e2e-agent-runner
description: >-
  운영업무 task를 실행하거나 이어서 진행한다. workflows/ 폴더의 task JSON을 엔진으로
  실행하고, 사람이 필요한 지점에서 사용자에게 질문한다. "OO task 실행해줘",
  "어제 하던 거 이어서 진행해줘", "변경관리 task 돌려줘", "Runner 대시보드 열어줘",
  "Runner 대쉬보드 실행해줘" 같은 요청에 사용한다.
---

# e2e-agent-runner

task JSON을 끝까지 실행한다. 엔진이 맡은 자동 단계와 에이전트가 맡은 판단은 스스로
처리하고, 실제로 사람의 입력·선택·승인이 필요한 지점만 사용자에게 묻는다.

선택 도구는 현재 호스트가 지원하는 2~4개의 짧은 객관식에만 사용한다. 출력에
`choice_tool_allowed: false`가 있거나 선택지가 한도를 넘으면 채팅 번호 목록을 사용한다.

## 대시보드 사전 로드 전용 상태

`e2e-agent-creator`가 Creator 대시보드를 시작하기 전에 이 스킬을 사전 로드한 경우에는
Runner 화면을 열거나 Standalone Runner 명령을 실행하지 않는다. 이 스킬의 Runner 작업
처리 규칙만 같은 Code Assistant 턴에 유지하고, 통합 watch가 실제 Runner 작업을 반환했을
때에만 해당 규칙으로 처리한다.

## 실행 방식

사용자가 **대시보드**, **대쉬보드**, **웹 대시보드**, **Runner 대시보드**를 명시적으로 요청한 경우에만 프로젝트
통합 대시보드의 Runner 탭을 연다. 아래 Dashboard 명령을 실행하기 전에
`e2e-agent-creator` 스킬의 `SKILL.md` 전체를 사전 로드 전용 상태로 읽어, 같은 Code Assistant
턴에서 이후 Creator 작업을 바로 처리할 수 있게 한다. 사전 로드된 Creator 스킬이 Creator
화면이나 Standalone Creator 명령을 따로 실행하게 하지 않는다.

```text
python -m ops_runtime.dashboard_app start --project-root . --tab runner
```

대시보드는 선택 기능이다. 구체적인 task 실행·재개 요청에는 아래 교육된 Standalone Runner
흐름을 그대로 사용하며 자동으로 대시보드로 바꾸지 않는다.
Standalone Runner 흐름에서는 bounded wait를 자동으로 시작하지 않는다. 사용자가 대시보드를
명시했거나 대시보드 화면의 요청문을 전달한 경우에만 아래 대시보드 대기 규칙과 상대 스킬
사전 로드를 사용한다.
대시보드를 연 직후에는 진행 중 run이나 AI 작업이 아직 없어도 **대시보드 통합 연결 유지**를
바로 시작한다.

항상 프로젝트의 Standalone local Runner를 사용한다. `runner_app`의 각 명령은 프로젝트
전용 loopback 서버가 없으면 현재 Python으로 자동 실행하고, 결정적 처리를 다음 실제
`agent`·`user`·`done`·`error` 경계까지 진행한 결과를 같은 명령의 JSON 응답으로 돌려준다.
별도 설치·MCP 등록·호스트 재시작은 필요 없다.

모든 명령은 현재 에이전트가 실행한다. 사용자에게 Python 명령, 서버 상태, 내부
`run_ref`·`job_id`·`revision`을 실행하거나 관리하게 하지 않는다. 사용자에게는 기존과
같이 업무 Key, 사람이 읽는 노드 이름, 필요한 입력·선택·승인과 최종 결과만 보여준다.
task JSON과 run JSON은 직접 수정하지 않는다. 서버가 유휴 종료되어도 다음 명령이 자동으로
다시 실행하므로 직접 서버를 띄우거나 폴백 경로로 전환하지 않는다.

schema 2.2의 분기 합류에서는 Runner가 If에서 실제로 선택된 케이스의 조건부 입력만 읽는다.
선택되지 않은 케이스의 출력은 요구하지 않으며, 현재 분기 이전 반복에서 만들어진 오래된
출력도 재사용하지 않는다. schema 2.0과 2.1 입력은 기존과 동일하게 모두 일반 입력으로 읽는다.

## 시작과 재개

1. 사용자가 준 task 경로를 쓰거나 `workflows/*/*.json`의 파일명과 `task_name`으로 찾는다.
   여러 후보면 채팅 번호 목록으로 선택받는다.
2. 기존 건을 확인한다.

```text
python -m ops_runtime.runner_app runs --project-root . --task-ref <task.json>
```

`selection.choices`의 `display` 값을 채팅에 전부 보여주고 답을 기다린다. 내부
`run_ref`·`revision`은 보여주지 않는다. 개수가 동적이므로 선택 도구는 사용하지 않는다.
진행 중 건은 Key·완료 수·현재 단계를 함께 표시한다. 마지막 항목은 항상 신규 작업이며
사용자가 `<마지막 번호>. <새 Key>` 형식으로 Key를 직접 입력해야 한다.
`next_key`는 추천 표시일 뿐 자동 적용하지 않는다. 답을 받으면 다음 명령으로 결정적으로
해석한다.

```text
python -m ops_runtime.runner_app choose-run --project-root . --task-ref <task.json> --selection "<사용자 답>"
```

3. 결과의 `start_command`만 그대로 실행한다. 신규 건은 목록을 다시 확인한 현재
`task_fingerprint`와 사용자가 고른 Key로 시작하고, 기존 건은 사용자가 고른 정확한
`run_ref`와 `revision`으로 재개한다. 이전 task와 이어지는 업무는 같은 Key를 사용해야
결과가 자동 전달된다.

4. 대화가 다시 시작됐고 `run_ref`를 보존하고 있다면 먼저 현재 경계를 조회할 수 있다.

```text
python -m ops_runtime.runner_app status --project-root . --run-ref <run_ref>
```

응답이 이미 `paused` 또는 `done`이면 그대로 처리한다. 복구 조회가 `running`을 반환한
경우에만 직전 `revision`으로 `runner_app next`를 호출한다. 보통 `start`와 작업 제출
명령이 다음 경계까지 동기로 기다리므로 별도 polling이나 반복 `next` 호출은 필요 없다.
run·payload는 `.ops/` 아래에 있어 업무 산출물 폴더를 어지럽히지 않는다.

## Runner 출력 처리

- 매 응답의 `progress.presentation`을 그대로 짧게 알려준다.
- `executed`는 이미 자동 수행된 단계다. 다시 확인받지 말고 한 줄로 요약한다. 특히
  file_read가 파일을 읽었다면 그 내용으로 진행할지 재확인하지 않는다.
- `paused`이고 `actor: agent`면 prompt·해석된 입력·참고자료 manifest·허용 라벨·
  결과/근거 스키마대로 현재 에이전트가 수행한다.
- `paused`이고 `actor: user`면 실제 사용자 입력·선택·승인을 받은 뒤에만 처리한다.
- Dashboard 통합 watch가 반환한 `kind: run_pause`는 실제 판단·파일 탐색·문서 생성을
  시작하기 직전에 해당 작업의 `claim_command`를 한 번 실행한다. 여러 작업을 받았어도
  전부 미리 claim하지 않고 지금 처리할 작업 하나만 claim한다. 응답이 `status: ok`이고
  `claimed: true`일 때만 작업을 수행한다. 이 claim이 현재 Dashboard 실행 모달에 표시할
  Agent 메시지의 `run_ref`와 `job_id`를 정한다.
- 작업 결과를 출력의 `payload_file`에 쓰고 `resume_command`를 그대로 실행한다. 이
  명령은 일반 실행에서 현재 job의 actor에 맞는 `runner_app agent-submit` 또는
  `human-submit`이며, 제출 뒤 다음 실제 경계까지 처리한 결과를 같은 응답으로 반환한다.
  Dashboard `kind: run_pause`는 다음 사용자 경계를 채팅에 노출하지 않는 전용 제출
  명령을 사용한다. 또한
  `kind: user_input_parse`의 `resume_command`는 Runner를 진행하지 않고 대시보드의
  항목별 입력 화면에 검토용 초안만 저장한다.
- `done`이면 `result_summary`를 사용해 주요 노드 결과와 생성 파일을 요약한다.
- `rejected`는 payload를 고쳐 재개한다. `error`는 reason과 복구 방법을 보고한다.

`requires_user_input: false` 또는 `actor: agent`인 `llm_decision`,
`llm_decision_output`, `llm_generate`, `llm_find_file`, `mcp_call`은 사용자에게 묻지 않고
에이전트가 수행한다. `ask_user`, `ask_user_deferrable`, `ask_dependency_dummy`, `choose_system`,
`confirm`만 사람이 소유한다.

## 대시보드의 Runner AI 작업 처리

사용자가 대시보드 화면의 안내에 따라 **Runner AI 작업 처리**를 요청하면 아래
**대시보드 통합 연결 유지**의 watch를 먼저 시작한다. 이미 대기 중인 Runner 작업이 있으면
watch가 `agent_work_available`로 즉시 반환하며, 응답의 Runner `actor: agent` 작업을
순서대로 처리한다. 별도 조회로 watch claim을 우회하지 않는다.

반환된 각 작업은 위 **Runner 출력 처리** 규칙으로 처리하고 `payload_file`과
`resume_command`를 사용해 제출한다. Runner 작업 처리 절차에서 Creator 결과를 직접
제출하지 않는다. 통합 대기 응답에 Creator 초안이나 노드 테스트가 함께 있으면
`e2e-agent-creator` 스킬로 처리한다. 감시만 통합된 것이며 두 큐의 저장소·잠금·제출 경계는
계속 분리돼 있다.

- Dashboard `kind: run_pause`의 제출 결과는 `status: ok`인 Dashboard 인계 확인이다.
  `outcome: dashboard_user_input_ready`면 사용자 입력·선택·확인 화면이 Dashboard에
  준비된 것이다. Code Assistant 채팅에서 질문하거나 객관식 선택 도구를 호출하거나
  `human-submit`을 실행하지 말고 같은 Dashboard 연결 대기로 돌아간다.
- Dashboard 실행의 `ask_user`, `ask_user_deferrable`, `choose_system`, `confirm` 등 모든
  `actor: user` 경계는 Dashboard만 소유한다. 이 규칙은 일반 Standalone Runner에는
  적용하지 않는다.

`kind: user_input_parse`는 사용자가 대시보드의 **내용 전체 붙여넣기**에 입력한 원문을
현재 사용자 pause의 `result_schema`에 맞는 **검토용 초안**으로 정리하는 작업이다.
`job.raw_input`의 내용과 사용자의 요청을 반영한다. 사용자가 테스트용·임의·적절한 값
생성을 요청했다면 해당 의도에 맞는 초안 값을 생성할 수 있다.

```json
{
  "output": {
    "필드ID": "초안 값"
  }
}
```

- 확인하거나 작성할 수 있는 필드만 `output`에 넣고 나머지는 생략해도 된다.
- 결과 JSON을 `payload_file`에 저장하고 `resume_command`를 실행해 작업을 반드시 종결한다.
- 이 명령은 Runner의 user pause를 완료하지 않는다. 대시보드는 **항목별로 직접 입력**
  탭을 열고 초안 값을 해당 필드에 채운다.
- 사용자가 화면에서 값을 검토·수정한 뒤 기존 **결과 반영**, **미진행**, **다음에 재진행**
  버튼 중 하나를 직접 선택한다.
- `reject_command`는 결과 파일 자체를 만들 수 없는 비정상 상황의 호환 경로일 뿐,
  일부 필드가 비었다는 이유로 사용하지 않는다.

### 대시보드 통합 연결 유지

대시보드를 연 직후 또는 대시보드의 `Code Assistant 요청문 복사`로 다시 호출된 직후에는
현재 작업 수와 무관하게 다음 통합 watch를 시작한다. 사용자가 Runner 입력 화면에서 오래
머물더라도 다음 AI 노드가 생기는 순간 같은 Code Assistant 턴이 이어져야 하므로 진행 중
run이 없는 `idle` 상태도 즉시 종료 조건으로 사용하지 않는다.

```text
python -m ops_runtime.agent_jobs wait --project-root . --domain all --timeout-seconds 540 --watch-window-seconds 540 --dashboard-watch
```

- 이 명령은 호스트 실행 도구의 제한 시간을 600초 이상으로 지정해 포그라운드에서 한 번만
  시작한다. 호스트가 실행 세션을 반환하면 새 Python 명령을 만들지 말고 같은 프로세스의
  완료를 계속 기다린다.
- 최초 호출은 `--watcher-id`를 생략한다. Python 호출 하나가 AI 작업이 생기거나 540초의
  연결 유지 시간이 끝날 때까지 직접 기다린다. AI 작업 처리 뒤 다시 기다릴 때는 응답의
  `watcher_id`를 `--watcher-id`로 전달한다. Runner 작업이 정상 제출되면 런타임이 대기
  예산을 초기화하므로 다음 대기는 새 540초 구간으로 시작한다. 제출하지 못했거나 제출이
  거부된 작업은 대기 예산을 초기화하지 않는다.
- `agent_work_available`이면 Runner 작업은 이 스킬의 규칙으로 처리하고, Creator 작업은
  `e2e-agent-creator` 스킬로 처리한다. Runner 작업은 하나씩 `claim_command`를 실행하고
  처리·제출한 다음 다음 Runner 작업을 claim한다. 두 도메인의 현재 작업을 모두 제출한 뒤
  같은 `watcher_id`로 다시 기다린다.
- 정보 부족으로 제출하지 못한 작업이 있어도 같은 `watcher_id`로 다시 기다린다. 동일 작업은
  즉시 반복 반환되지 않지만 처리 확인 없이 약 10분이 지나면 장애 복구를 위해 같은 revision도
  다시 반환될 수 있다. 같은 미완료 작업을 반복 보고하거나 이 때문에 watch를 임의로 끝내지 않는다.
- 작업 없는 `state_changed`는 Python이 같은 540초 대기 안에서 새 기준으로 흡수하므로
  종료 조건으로 세지 않는다.
- 위에서 별도로 설명하지 않은 정상 응답은 응답의 `next_action`을 따른다. `wait_again`이면
  사용자에게 오류를 보고하지 않고 같은 `watcher_id`로 다시 기다린다.
- 사용자가 새 연결을 요청한 최초 호출은 이전 watch 기록이나 다른 Code Assistant 턴의
  존재와 관계없이 `--watcher-id`를 생략한다. 런타임이 새 `watch_epoch`을 발급하고 새
  호출이 즉시 감시를 인계한다.
  `watch_replaced`는 이 응답을 받은 옛 wait가 더 최신 wait로 교체되었다는 뜻이므로 그 옛
  wait만 조용히 끝낸다. `watch_already_active`는 같은 watcher의 대기나 현재 claim한 Runner
  작업이 이미 진행 중이라는 뜻이므로 기존 epoch을 교체하지 말고 이 중복 wait만 조용히
  끝낸다. 사용자가 새 연결을 요청하면 평소처럼 `--watcher-id` 없이 새 watch를 시작한다.
  `watch_stopped`도 해당 epoch의 wait만 끝낸다.
- Dashboard watch가 반환한 `claim_token`은 작업의 `claim_command`·`submit_command`·
  `resume_command`·`reject_command`에 자동 포함되어 있다. 제공된 명령을 그대로 사용하고
  token을 사용자에게 보여주거나 입력·승인·설정을 요구하지 않는다. 교체된 옛 작업의 제출이
  `superseded_claim`으로 끝나면 오류로 보고하지 말고 새 watch가 돌려주는 최신 작업만 처리한다.
- 정상적인 빈 대기는 약 9분 뒤 `watch_window_expired`를 반환한다. 대시보드 연결 유지가
  계속 필요한 동안에는 같은 `watcher_id`로 다시 기다린다. 런타임은 소진된 동일 소유자의
  대기 예산을 새 540초 구간으로 자동 갱신한다. 더 짧은 호스트 제한으로 `timeout`이 반환된
  경우에도 같은 `watcher_id`로 현재 구간의 남은 예산을 이어 쓴다.
- watch가 살아 있는 동안 대시보드는 AI 작업이 생겨도 요청문 복사 버튼을 숨기고 자동 처리
  상태를 표시한다. watch가 없을 때 AI 작업이 생기면 파란 요청문 복사 버튼으로 재연결한다.
- 기다리는 동안 Python 명령, `watcher_id`, signature, 내부 식별자, timeout 횟수나 남은
  시간을 사용자에게 보여주지 않는다. 시작할 때 `Dashboard에서 입력을 계속하면 다음 AI
  작업이 자동으로 이어집니다.`라고 한 번만 안내한다.
- 이 통합 watch는 대시보드에서만 사용한다. Standalone Runner의 task 실행·재개·사용자
  입력 흐름에는 자동으로 적용하지 않는다.

## Creator 노드 부분 테스트

Creator 질문지에서 만든 부분 테스트가 `actor: agent` 경계에 도달하면 사용자가
“N번 노드 테스트 진행”이라고 Code Assistant에 알려 준다. 이 작업은 정상 업무 run이
아니므로 `runner_app runs/start/next`를 호출하지 않는다. 같은 Creator `launch_id`의
`creator_app node-test-jobs`로 작업을 받고, 위 **Runner 출력 처리**의 agent pause 규칙으로
판단·파일 탐색·문서 생성을 수행한 뒤 작업이 제공한 `submit_command`로 결과를 제출한다.

- 임시 입력과 이전 노드의 테스트 결과는 해당 Creator 세션에만 유효하다.
- 결과는 `allowed_labels`, 출력 필드, evidence 요구를 정상 Runner와 똑같이 지킨다.
- **이 노드 테스트**를 누른 것은 실제 테스트 실행 요청이다. 조회뿐 아니라 시스템 쓰기,
  알림 전송, 파일 쓰기, 커스텀 로직, command, API, MCP도 정상 Runner와 같은 핸들러로
  실행하며 외부 시스템이나 파일에 실제 변경이 생길 수 있다.
- 제출 완료 뒤 정상 업무 run을 시작하거나 결과를 task JSON에 복사하지 않는다.

## 브라우저 작업 인계

manual 시스템 노드에 URL이 있으면 pause의 `handoff`를 따른다.
`manual_url`에 `{입력 필드명}`이 있으면 엔진이 현재 노드의 해석된 입력값으로 치환한
최종 URL을 `handoff`로 제공한다. 별도 치환은 하지 말고 제공된 URL을 그대로 사용한다.

1. 먼저 `prompt`를 사용자에게 보여주며 “약 2초 뒤 작업 페이지를 열겠습니다”라고 알린다.
2. 그 다음에만 `handoff.open_command`를 그대로 실행한다.
3. 열기 명령이 돌려준 새 `paused` 응답을 현재 경계로 교체한다. URL 열기 기록으로
   revision이 갱신되므로 이후에는 새 `payload_file`과 `resume_command`를 사용한다.
4. 엔진이 `opened: true`로 기록하면 같은 URL을 다시 열지 않는다. 자동 열기가 실패하면
   표시한 URL을 직접 열도록 안내하며 기존 제출 계약을 그대로 사용한다.
5. 사용자가 작업을 마친 뒤 manual system_write는 한 번만 완료 확인하고 재개한다.

페이지를 먼저 열고 뒤늦게 설명하거나, 이미 열린 페이지를 재개할 때마다 다시 띄우지 않는다.

## 주요 pause 처리

- `ask_user`: 화면/문서 전체를 한 번에 붙여넣게 하고 에이전트가 fields에 맞춰 추출한다.
  못 찾은 필드만 되묻는다.
- `ask_user_deferrable`: 지금 입력 / 다음에 재진행 / 미진행을 선택받는다. 미진행은 명시적
  선택일 때만 모든 output을 null로 보낸다.
- `ask_dependency_dummy`: 같은 업무 Key의 이전 Task 실행 결과가 없는 상태다. Runner는 첫 노드를
  실행하기 전에 현재 Task의 모든 노드를 확인하고 필요한 이전 Task 출력을 한 번에 받는다. 같은
  이전 출력이 여러 노드에 쓰이면 한 번만 받는다. 사용자에게는 Task JSON에 선언된 이전 Task
  이름, 이전 Node 이름, output 이름과 이 값을 사용하는 현재 Node 이름만 표시하고 내부 id는
  노출하지 않는다. 모든 값은 일반 텍스트로 받는다. 실제 선행 run 출력이 입력 전후에 생기면
  언제나 실제값을 우선한다.
- Dashboard 실행의 `ask_dependency_dummy`: 입력 화면은 대시보드가 소유한다. 사용자가 화면에서
  직접 입력하거나 **AI로 예시 데이터 채우기**를 요청하게 한다. `kind: dependency_dummy_draft`는
  입력란에 검토용 예시만 채우며 Runner에 자동 제출하지 않는다. Code Assistant 채팅에서 값을
  질문하거나 입력받지 않고, `human-submit`을 실행하거나 우회하지 않는다. Dashboard 서버가 살아
  있는 동안 같은 Workflow와 같은 선행 출력은 기존처럼 자동 재사용한다.
- Standalone Runner의 `ask_dependency_dummy`: 출력의 `mode: standalone_local_runner`를 확인하고
  `job.fields`의 사람이 읽는 이름으로 필요한 값을 채팅에서 한 번에 받는다. 사용자가 직접 준
  값도 제출 전에 다시 보여주고 명시적으로 확인받은 뒤 `dependency_dummy_origin: manual`로 쓴다.
  사용자가 예시 생성을 요청하면 예시를 채팅에
  먼저 보여주고 명시적으로 확인받은 뒤에만 `dependency_dummy_origin: ai`로 쓴다. 확인 전에는
  자동 제출하지 않는다. 확인된 값을 내부 field id에 맞춰 `payload_file`에 저장하고, 출력에
  제공된 `resume_command`를 그대로 실행한다. 이 명령은 `human-submit`이며 직접 재구성하지 않는다.
- `llm_decision`: prompt와 references를 읽고 선언된 label 및 output을 낸다.
- `llm_decision_output`: label 없이 output만 낸다.
- `llm_generate`: prompt에 맞는 content를 생성한다.
- `llm_find_file`: directory에서 실존 파일을 찾는다. 후보가 모호할 때만 사용자에게 묻는다.
- `choose_system`: 시스템을 선택받는다.
- `confirm`: 실제 실행·완료·중복 실행 보호를 확인한다. suggested 값은 사용자가
  “그대로”라고 확인한 뒤에만 쓴다.
- `mcp_call`: 지정된 MCP 서버 도구를 호출하고 실제 결과만 output으로 제출한다.

payload는 출력의 `payload_file`에 UTF-8 JSON으로 저장한다. `.ops/payloads`의 정상 소비
파일은 Runner가 자동 삭제한다. 값 추정이나 빈 문자열 채우기는 금지하며, 사용자가 없다고
확인한 값만 null로 보낸다. 단, Dashboard `user_input_parse`의 검토용 초안은 사용자가
값 생성을 요청한 경우 생성할 수 있으며, 사용자가 **결과 반영**을 누르기 전까지 Runner
결과가 아니다.

상세 payload 모양, 오류·중복 실행 복구가 필요할 때만
[references/pause-protocol.md](references/pause-protocol.md)를 읽는다.
