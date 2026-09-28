---
name: e2e-agent-creator
description: >-
  워크플로우 YAML을 task JSON으로 변환하고, 질답으로 실행 메타데이터를 채우고,
  기존 task JSON을 수정한다. "이 YAML 변환해줘", "task 만들어줘",
  "task JSON 수정하고 싶어", "노드 추가해줘", "Creator 대시보드 열어줘",
  "Creator 대쉬보드 실행해줘" 같은 요청에 사용한다.
---

# e2e-agent-creator

실행 가능한 task JSON을 만들거나 수정한다. 사용자가 확정해야 하는 의미만 대화로 받고,
배선·설정 반영·검증처럼 결정적으로 처리할 수 있는 일은 `ops_runtime`에 맡긴다.

## 대시보드 사전 로드 전용 상태

`e2e-agent-runner`가 Runner 대시보드를 시작하기 전에 이 스킬을 사전 로드한 경우에는
Creator 화면을 열거나 Standalone Creator 명령을 실행하지 않는다. 이 스킬의 Creator 작업
처리 규칙만 같은 Code Assistant 턴에 유지하고, 통합 watch가 실제 Creator 작업을 반환했을
때에만 해당 규칙으로 처리한다.

## 모드 선택

다음 순서를 반드시 지킨다.

1. 사용자가 **대시보드**, **대쉬보드**, **웹 대시보드**, **Creator 대시보드**를 명시적으로 요청한 경우에만
   프로젝트 통합 대시보드의 Creator 탭을 연다. 아래 Dashboard 명령을 실행하기 전에
   `e2e-agent-runner` 스킬의 `SKILL.md` 전체를 사전 로드 전용 상태로 읽어, 같은 Code Assistant
   턴에서 이후 Runner 작업을 바로 처리할 수 있게 한다. 사전 로드된 Runner 스킬이 Runner
   화면이나 Standalone Runner 명령을 따로 실행하게 하지 않는다.

```text
python -m ops_runtime.dashboard_app start --project-root . --tab creator
```

   대시보드는 선택 기능이다. 구체적인 YAML 변환·task 생성·기존 JSON 수정 요청에는 교육된
   기존 Creator 흐름을 그대로 사용하며 자동으로 대시보드로 바꾸지 않는다.
   Standalone Creator 흐름에서는 bounded wait를 자동으로 시작하지 않는다. 사용자가
   대시보드를 명시했거나 대시보드 화면의 요청문을 전달한 경우에만 아래 대시보드 대기
   규칙과 상대 스킬 사전 로드를 사용한다.
   대시보드를 연 직후에는 활성 Creator 세션이나 AI 작업이 아직 없어도
   **대시보드 통합 연결 유지**를 바로 시작한다.
2. 그 외 Creator 요청은 Standalone local Creator server로 바로 시작한다.
3. 사용자가 기존 task JSON의 현재 내용을 **수정**해 달라고 명시했으면 `start`가 아니라
   기존 JSON 수정 전용 `revise` 진입을 사용한다. 단순 열기·미완료 저작 이어가기는 기존
   `start` 흐름을 유지한다.
4. Standalone 서버의 `start`/`revise` 실행 또는 해당 `launch_id`의 `status` 확인 자체가 실패한
   경우에만 Legacy clipboard 모드로 폴백한다. 사용자의 입력 대기·미완료 상태는 서버
   실패가 아니므로 폴백하지 않는다.

모든 로컬 명령은 현재 에이전트가 실행한다. 사용자에게 Python 명령이나 `launch_id`를
실행·관리하게 하지 않는다.

## 대시보드의 Creator AI 작업 처리

사용자가 대시보드 화면의 안내에 따라 **Creator AI 작업 처리**를 요청하면 다음 명령으로
Creator 도메인의 대기 작업만 조회한다.

```text
python -m ops_runtime.dashboard_app creator-jobs --project-root .
```

- 사용자가 대시보드에서 **설계 확정 완료**를 알렸는데 현재 대화에 Standalone
  `launch_id`가 없으면 곧바로 “현재 실행 중인 Creator 세션이 없습니다”라고 답하지 않는다.
  먼저 `dashboard_app status`와 위 `creator-jobs`를 실행해 `active_sessions`의 대시보드
  세션을 찾는다. 대시보드 서버가 중단됐지만 활성 대시보드 세션 기록이 있으면
  `dashboard_app start --project-root . --tab creator`로 서버와 화면을 복구한다.
- 복구한 세션이 `design_gate`이면 서버 중단 전에 설계 제출이 완료되지 않은 것이므로
  같은 설계 화면을 다시 열어 확정하도록 안내한다. `awaiting_agent_drafts`이면 반환된
  초안 작업을 처리하고, `questionnaire` 또는 `ready_to_validate`이면 별도의 세션 오류를
  만들지 말고 현재 화면의 자동 전환·검증 결과를 안내한다.
- `draft`는 아래 Standalone 초안 작성 규칙과 같은 근거·본문 계약으로 작성하고, 함께
  반환된 `launch_id`, `job_id`, `revision`으로 `creator_app draft-submit`에 제출한다.
- `custom_logic`는 작업의 사용자 설명 원문, 노드 목적, 입출력·라벨·실행 계약만 근거로
  `logic_md`와 `run_py` 본문을 만든다. 작업의 `payload_file`에
  `{ "logic_md": "...", "run_py": "..." }` UTF-8 JSON을 저장하고
  `submit_command`의 idempotency placeholder만 고유한 8~200자 키로 바꿔 실행한다.
  본문을 채팅에 노출하거나 Task JSON·대상 폴더를 직접 편집하지 않는다.
- `node_test`는 아래 질문지 노드 부분 테스트 규칙으로 처리하고 작업의
  `submit_command`를 사용한다.
- Creator 작업 처리 절차에서 Runner 결과를 직접 제출하지 않는다. 통합 대기 응답에 Runner
  작업이 함께 있으면 `e2e-agent-runner` 스킬로 처리한다. 감시만 통합된 것이며 Creator와
  Runner 큐·잠금·제출 경계는 계속 분리돼 있다.
- 처리 완료 뒤 대시보드와 열린 실행 화면은 자동으로 갱신된다. 사용자에게 새로고침을
  요구하거나 내부 식별자·명령을 노출하지 않는다.

### 대시보드 통합 연결 유지

대시보드를 연 직후 또는 대시보드의 `Code Assistant 요청문 복사`로 다시 호출된 직후에는
현재 작업 수와 무관하게 다음 통합 watch를 시작한다. Creator 질문지·설계 화면에서 사용자가
오래 머물더라도 첫 AI 작업이 생기는 순간 같은 Code Assistant 턴이 이어져야 하므로 빈
프로젝트의 `idle` 상태도 즉시 종료 조건으로 사용하지 않는다.

```text
python -m ops_runtime.agent_jobs wait --project-root . --domain all --timeout-seconds 540 --watch-window-seconds 540 --dashboard-watch
```

- 이 명령은 호스트 실행 도구의 제한 시간을 600초 이상으로 지정해 포그라운드에서 한 번만
  시작한다. 호스트가 실행 세션을 반환하면 새 Python 명령을 만들지 말고 같은 프로세스의
  완료를 계속 기다린다.
- 최초 호출은 `--watcher-id`를 생략한다. Python 호출 하나가 AI 작업이 생기거나 540초의
  연결 유지 시간이 끝날 때까지 직접 기다린다. AI 작업 처리 뒤 다시 기다릴 때는 응답의
  `watcher_id`를 `--watcher-id`로 전달한다. 이 과정에서 Runner 작업이 정상 제출되면
  런타임이 대기 예산을 초기화하므로 다음 대기는 새 540초 구간으로 시작한다.
- `agent_work_available`이면 Creator 작업은 이 스킬의 규칙으로 처리하고, Runner 작업은
  `e2e-agent-runner` 스킬로 처리한다. 두 도메인의 현재 작업을 모두 제출한 뒤 같은
  `watcher_id`로 다시 기다린다.
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
- Dashboard watch가 반환한 `claim_token`은 작업의 `submit_command`·`resume_command`·
  `reject_command`에 자동 포함되어 있다. 제공된 명령을 그대로 사용하고 token을 사용자에게
  보여주거나 입력·승인·설정을 요구하지 않는다. 교체된 옛 작업의 제출이
  `superseded_claim`으로 끝나면 오류로 보고하지 말고 새 watch가 돌려주는 최신 작업만 처리한다.
- 정상적인 빈 대기는 약 9분 뒤 `watch_window_expired`를 반환한다. 대시보드 연결 유지가
  계속 필요한 동안에는 같은 `watcher_id`로 다시 기다린다. 런타임은 소진된 동일 소유자의
  대기 예산을 새 540초 구간으로 자동 갱신한다. 더 짧은 호스트 제한으로 `timeout`이 반환된
  경우에도 같은 `watcher_id`로 현재 구간의 남은 예산을 이어 쓴다.
- watch가 살아 있는 동안 대시보드는 AI 작업이 생겨도 요청문 복사 버튼을 숨기고 자동 처리
  상태를 표시한다. 설계 확정 뒤 Creator 화면도 로딩 상태로 전환해 준비 중인 초안의
  노드 이름과 완료 개수를 표시하고, 초안이 모두 준비되면 상세 설정 화면으로 자동
  전환한다. watch가 없을 때만 Code Assistant 연결이 필요하다는 안내를 표시하고
  대시보드의 파란 요청문 복사 버튼으로 재연결한다.
- 기다리는 동안 Python 명령, `watcher_id`, signature, 내부 식별자, timeout 횟수나 남은
  시간을 사용자에게 보여주지 않는다. 시작할 때 `Dashboard에서 작업을 계속하면 필요한 AI
  처리가 자동으로 이어집니다.`라고 한 번만 안내한다.
- 이 통합 watch는 대시보드에서만 사용한다. Standalone Creator의 질문지·설계 확정·노드
  테스트 흐름에는 자동으로 적용하지 않는다.

## 사용자 안내 문구

사용자에게는 완료된 결과와 바로 다음 행동만 안내한다. `Standalone`, `local server`,
`launch_id`, `status`, `stage`, 내부 명령, payload 같은 구현 용어와 명령 응답 원문은
노출하지 않는다. 정상 흐름에서는 상황에 맞는 아래 문구를 그대로 사용한다.

`expires_at`과 세션 만료 예정 시각은 내부 수명 관리 정보다. 사용자에게 “세션 만료”,
“몇 시 전까지 완료” 같은 시간 제한 안내를 하지 않는다. 실제로 세션이 만료되어 화면을
이어갈 수 없을 때만 화면을 다시 열겠다고 안내한다.

- 새 Task 초안을 만든 직후:
  `Task 초안을 만들었습니다. 이제 Action 구성과 입력·출력을 확인하고 수정할 수 있는 화면을 열겠습니다.`
- 기존 Task를 연 직후:
  `Task를 불러왔습니다. 이제 Action 구성과 입력·출력을 확인하고 수정할 수 있는 화면을 열겠습니다.`
- 브라우저 화면이 열린 뒤:
  `설계 화면을 열었습니다. 브라우저에서 Action 구성과 입력·출력을 확인한 뒤 ‘설계 확정’을 눌러 주세요. 확정 후에는 화면 안내에 따라 Code Assistant 대화로 돌아와 알려 주세요.`
- 설계 반영 후 AI 초안을 만드는 동안:
  `설계가 반영됐습니다. AI 초안을 준비하고 있습니다. 같은 화면이 자동으로 다음 단계로 바뀝니다.`
- AI 초안 확인 화면이 준비된 뒤:
  `AI 초안이 준비됐습니다. ‘이대로 사용’ 또는 ‘수정’을 선택하고 저장해 주세요.`
- 상세 설정 저장과 자동 검증이 끝난 뒤:
  대시보드에서 연 화면은 검증 통과 여부·리허설 단계 수·확인 권장 사항을 먼저 표시하고,
  확인 권장 사항의 노드는 내부 ID가 아니라 사람이 읽는 노드 이름으로 표시한다. 사람·AI
  개입을 포함한 `재작업 순환 경로` 권고는 의도된 재작업 흐름이므로 이 완료 화면에서는
  표시하거나 권장 사항 개수에 포함하지 않는다. Validator 원문과 CLI 결과는 바꾸지 않는다.
  사용자가 `대시보드로 돌아가기`를 누르면 Creator 대시보드로 복귀한다. 일반 Creator 화면은
  `상세 설정 저장과 검증이 완료되었습니다. 이 창을 닫아도 됩니다.`라고 표시한다.
  사용자에게 별도의 `확정 완료` 입력을 요구하지 않는다.

오류가 발생해도 내부 식별자나 응답 JSON을 그대로 보여주지 말고, 사용자가 이해할 수 있는
한국어 원인과 다음 행동만 안내한다.

## Standalone local Creator server

task JSON을 직접 편집하거나 clipboard payload를 만들기 전에 프로젝트의 독립 로컬 Creator
서버를 사용한다.

1. 기존 task 요청은 해당 task 경로를 사용한다. 기존 JSON을 수정하라는 명시적 요청은 YAML을
   다시 변환하지 않고 현재 JSON을 그대로 수정 대상으로 삼는다. YAML에서 새 task를 만드는
   요청은 아래 `YAML에서 새 task 만들기`의 1~2단계로 task 초안까지만 만든 뒤 즉시 이 절차로
   돌아온다.
2. task 경로가 확정되면 현재 에이전트가 서버를 바로 시작하고 응답의 `launch_id`를 보존한다.
   기존 JSON 수정 요청에는 다음 전용 진입을 사용한다.

```text
python -m ops_runtime.creator_app revise --project-root . --task-ref <task>
```

   그 외 새 task 저작·기존 미완료 저작 이어가기·일반 열기에는 기존 진입을 사용한다.

```text
python -m ops_runtime.creator_app start --project-root . --task-ref <task>
```

3. `status: open`이고 `stage`가 `design_gate`이면 브라우저의
   **설계 확정** 화면부터 진행한다. 노드 이름·종류·순서·분기와 각 노드의 입력·출력·
   값 전달 경로를 한 설계 단계에서 모두 확정한다. 이 단계가 끝나기 전에는 AI 초안을
   만들지 않는다. 사용자는 한 화면에서 모든 항목을 확인한 뒤 `설계 확정` 버튼을 한 번
   누른다. JSON 복사·채팅 붙여넣기는 하지 않는다.
4. 사용자가 설계 확정을 마쳤다고 알리면 같은 `launch_id`의 상태를 확인한다.

```text
python -m ops_runtime.creator_app status --project-root . --launch-id <id>
```

5. `status: awaiting_agent_drafts`가 된 뒤에만 먼저 다음 명령을 **한 번** 실행한다.
   이 신호가 기록된 뒤에만 Creator 화면이 준비 중 스피너를 표시한다. 사용자가
   `설계 확정 완료`를 알리기 전에는 이 명령을 실행하지 않는다.

```text
python -m ops_runtime.creator_app draft-begin --project-root . --launch-id <id>
```

   이어서 다음 명령을 **한 번** 실행해 필요한 AI 초안 job 전체를 한 배치로 받는다.
   노드마다 명령을 다시 실행하거나 새 대화 턴을 만들지 않는다.

```text
python -m ops_runtime.creator_app draft-jobs --project-root . --launch-id <id>
```

6. 응답의 `jobs` 전부를 같은 턴에서 처리한다. 판단 프롬프트 job은 `context.workflow`의
   전체 노드 구성과 `focus_node`의 위치를 보고 해당 판단 노드의 역할을 먼저 해석한다.
   각 job의 `prompt`, `context`,
   `response_schema`만 근거로 판단 기준 또는 생성 프롬프트를 Markdown 본문으로 작성한다.
   context에 없는 업무 사실을 추정하지 않고 JSON이나 코드 펜스로 감싸지 않는다.
7. 각 Markdown 본문을 다음 명령의 **표준입력**으로 직접 전달한다. job마다 고유한 8~200자
   idempotency key를 쓰고, 재시도할 때만 같은 key를 재사용한다.

```text
python -m ops_runtime.creator_app draft-submit --project-root . --launch-id <id> --job-id <job_id> --expected-revision <job.revision> --idempotency-key <key>
```

   표준입력 전달이 불가능할 때만 프로젝트 내부의 임시 Markdown 파일을 만들고 같은 명령에
   `--content-file <프로젝트 내부 파일>`을 추가한다. 초안 본문이나 명령 응답 JSON을
   사용자에게 보여주거나 복사·붙여넣게 하지 않는다.
8. 설계 제출 뒤 기존 Creator 화면에는 **판단 노드 AI 프롬프트 초안 작성 중** 상태가
   표시된다. 마지막 제출의 `remaining_drafts`가 0이면 같은 탭이 **상세 설정 및 AI 초안
   확인** 화면으로 자동 전환된다. URL이나 `launch_id`를 노출하거나 새 화면을 다시 열지
   않는다. AI 초안이 필요 없는 task는 설계 확정 뒤 이 화면으로 바로 전환될 수 있다.
   특히 `revise`는 기존 JSON이 이미 완성 상태여도 설계 확정 뒤 현재 설정이 미리 채워진
   상세 질문지를 반드시 한 번 연다. 질문지를 건너뛰고 곧바로 검증 완료로 처리하지 않는다.
9. 열린 화면에서 각 AI 초안을 `이대로 사용`하거나 `수정`한 뒤 저장하도록 안내한다.
   사용자는 JSON 복사·채팅 붙여넣기·명령 실행을 하지 않는다.
10. 상세 설정에서 커스텀 로직 생성·교체를 선택해 저장하면 같은 `launch_id`의 상태가
    `awaiting_agent_custom_logic`이 된다. 다음 명령으로 작업 전체를 받고, 각 작업의
    `prompt`, `context`, `response_schema`와
    [references/custom-logic.md](references/custom-logic.md)만 근거로 `LOGIC.md`와
    `run.py` 초안을 작성한다.

```text
python -m ops_runtime.creator_app custom-logic-jobs --project-root . --launch-id <id>
```

    결과는 작업의 `payload_file`에 `{ "logic_md": "...", "run_py": "..." }` UTF-8
    JSON으로 저장하고 `submit_command`의 idempotency placeholder만 고유 키로 바꿔
    실행한다. 런타임이 revision·경로·중복 제출을 검사하고 파일 작성, AI 초안 표시,
    `custom_logic` 연결을 원자적으로 처리한다. Task JSON이나 로직 폴더를 직접 수정하거나
    본문을 사용자에게 복사·붙여넣게 하지 않는다. 완료되면 같은 화면이 자동 갱신된다.
11. 상세 설정의 **확정**은 저장과 동시에 결정론적 Validator 및 rehearsal을 실행한다.
    검증 통과 시 일반 Creator 화면은 종료 안내를 표시하고, 대시보드에서 연 화면은
    검증 내역과 `대시보드로 돌아가기` 버튼을 표시한다. 이 단계에는 AI 판단이 없으므로 사용자에게
    `확정 완료`를 Code Assistant에 다시 입력하도록 요구하거나 Validator를 중복 실행하지 않는다.
12. 자동 검증 오류가 화면에 표시된 경우에만 사용자가 Code Assistant에 수정을 요청한다.
    이때 같은 Task를 `revise`로 다시 열어 오류를 해결한 뒤 자동 검증 결과를 다시 확인한다.
    기존 교육 흐름에 따라 사용자가 완료 사실을 채팅으로 알려 온 경우에는 같은 `launch_id`의
    상태를 읽어 결과만 보고할 수 있지만, 정상 완료를 위해 그 입력을 필수로 요구하지 않는다.

## 질문지 노드 부분 테스트

상세 설정 화면의 **이 노드 테스트**는 정본 task와 정상 업무 run을 바꾸지 않는 Creator
전용 격리 실행이다. 사용자가 화면 안내에 따라 “N번 노드 테스트 진행”이라고 말하면
현재 대화가 보존한 같은 `launch_id`로 다음 명령을 실행한다.

```text
python -m ops_runtime.creator_app node-test-jobs --project-root . --launch-id <id>
```

- `jobs`에서 사용자가 말한 번호·노드 이름과 일치하는 작업만 처리한다. 여러 작업이
  대기 중이고 어느 것인지 확정할 수 없을 때만 사람이 읽는 노드 이름으로 되묻는다.
- 각 작업의 `job`은 Runner의 agent pause와 같은 계약이다. `prompt`, 해석된 `inputs`,
  `reference_manifest`, `allowed_labels`, `result_schema`만 근거로 실제 판단·파일 탐색·
  문서 생성 작업을 수행한다.
- 임시 입력은 테스트에만 쓰이는 명시적 seed다. 정본 출력으로 추정하거나 정상 run에
  복사하지 않는다. 결과와 근거는 실제 job 스키마대로 작성한다.
- 결과 JSON을 작업의 `payload_file`에 UTF-8로 저장하고 `submit_command`의
  idempotency placeholder를 고유한 8~200자 키로 바꿔 그대로 실행한다. 재시도할 때만
  같은 키를 재사용한다.
- 성공하면 `노드 테스트가 완료됐습니다. Creator 화면에 결과가 표시됩니다.`라고
  안내한다. 내부 test/job/revision/launch 식별자나 payload를 사용자에게 노출하지 않는다.
- **이 노드 테스트**를 누른 행위가 해당 노드의 실제 실행 요청이다. 조회뿐 아니라
  시스템 쓰기, 알림 전송, 파일 쓰기, API, command, MCP, 커스텀 로직도 정상 Runner와
  같은 핸들러로 실행한다. 테스트 run 기록은 격리되지만 외부 시스템·파일에 대한 변경은
  실제 반영될 수 있다.
- MCP 작업은 `job.prompt`에 지정된 MCP 서버와 지시문대로 연결된 MCP 도구를 실제
  호출하고 결과를 제출한다. 쓰기 작업은 prompt의 중복 실행 방지 안내를 따르고,
  재제출 전에 대상 시스템에 이미 반영됐는지 확인한다.
- 작업이 없으면 새 테스트를 임의 생성하지 말고 Creator 화면에서 해당 노드의
  **이 노드 테스트**를 먼저 누르도록 안내한다.

## Legacy clipboard 모드

Standalone 서버의 `start`/`revise` 또는 `status`가 실패한 경우에만 아래 명령·clipboard 기반
절차를 따른다.

## 기본 원칙

- 셸 명령은 현재 에이전트가 실행한다. 사용자에게 Python 명령을 대신 실행시키지 않는다.
- task 산출물은 `workflows/<활동>/<task>.json`이다. UI·payload·history 같은 부산물은
  서버가 `.ops/` 아래에 자동 생성하며 커밋 대상이 아니다. 배포할 때 `.ops/`를 미리
  만들거나 복사할 필요가 없다.
- 노드는 `[파일 조회] 요구사항 조회`처럼 `node_label`로 부른다. 내부 ID는 노출하지 않는다.
- endpoint·경로·인증 이름·명령·업무 기준 같은 사실값을 추정하지 않는다.
- 기존 task JSON 수정 요청에서는 YAML 변환기를 다시 실행하거나 `structure_confirmed`를 직접
  토글해 편집 상태를 만들지 않는다. 현재 JSON은 `revise` 진입으로 연다.
- Legacy clipboard 모드에서 폼이 낸 JSON은 해석하거나 다시 쓰지 않고 그대로 적용기에
  전달한다. 같은 답을 직접 편집으로 한 번 더 반영하지 않는다.
- 목록 선택은 명령 출력의 `selection` 계약을 그대로 따른다. `choice_tool_allowed: false`면
  선택 도구를 호출하지 말고 `chat_lines` 전체를 채팅에 보여준 뒤 번호로 답을 받는다.
  `choice_tool_if_supported`도 현재 호스트의 실제 선택지 한도 안에서만 쓰고, 넘으면 채팅으로
  폴백한다.

환경 이상이 의심되면 먼저 읽기 전용 진단을 실행한다.

```text
python ops_runtime/doctor.py
```

## YAML에서 새 task 만들기

Standalone local Creator server에서는 1~2단계로 초안을 만든 뒤 서버를 시작한다.
3단계 이후의 clipboard 적용 절차는 Standalone 서버가 실패한 Legacy 모드에서만 수행한다.

1. task 목록을 출력하고 결과의 `selection` 방식으로 선택받는다.

```text
python ops_runtime/yaml_to_task.py <workflow.yaml> --list
```

출력이 `chat_numbered`이면 목록을 보여준 뒤 그 턴을 끝내고 사용자 답을 기다린다. 목록을
보여준 다음 다시 선택 도구를 호출하지 않는다.

2. 선택한 task의 초안을 쓴다.

```text
python ops_runtime/yaml_to_task.py <workflow.yaml> --task <task_id> --write
```

기존 파일 충돌 시 사용자 확인 없이 `--force`를 쓰지 않는다.

3. 구성 게이트를 생성한다.

```text
python ops_runtime/author_questions.py workflows/<활동>/<task>.json
```

- `그대로 진행`: 출력의 `next_actions.confirm.command`를 그대로 실행한다.
- `부분 수정`: `structure_form_path`를 브라우저로 연다. 사용자가 `복사`한
  `ops_structure_edit` JSON을 `.ops/payloads/`에 그대로 저장하고 아래처럼 적용한다.
- `전면 재설계`: 먼저 `engine.py runs`로 미완료 건을 확인한다. 영향 확인 후 업무 흐름을
  받아 구조만 재작성하고 `structure_confirmed: false` 상태로 게이트를 다시 연다.

```text
python ops_runtime/author_apply.py structure <task.json> <payload.json>
```

구조 편집에서 생산자가 삭제되어 끊긴 입력은 임시 외부 입력으로 보존된다. 편집기에서
장황하게 경고하지 않고, 다음 노드 질문지에서 “삭제된 노드에서 전달받던 입력 — 수정 필요”로
표시된다.

4. 구성이 확정되면 같은 `author_questions.py` 명령을 다시 실행한다. 생성된 `form_path`를
브라우저로 열고, 확정 후 결과를 채팅에 붙여넣도록 안내한다. 폼을 열 수 없거나 사용자가
명시적으로 원할 때만 `--chat`을 사용한다.

5. `ops_author_answers` JSON을 `.ops/payloads/`에 그대로 저장해 적용한다.

```text
python ops_runtime/author_apply.py answers <task.json> <payload.json>
```

성공한 `.ops/payloads` 파일은 자동 삭제된다. `stale`이면 새 폼을 만들고, `ask_back`과
`unanswered`만 사용자에게 되묻는다. `remaining`에는 notify 연결 정보나 커스텀 로직처럼
Python이 만들 수 없는 작업만 남는다. `판단 기준 입력`은 사용자가 입력한 원문 전체를
가공하거나 추천 초안에 덧붙이지 않고 `main_prompt.md`로 그대로 저장한다.

6. 최종 검증을 수행한다.

```text
python ops_runtime/validate.py <task.json>
```

오류나 `__미정__`이 남고 `next_action.type == continue_authoring`이면 현재 에이전트가
`author_questions.py`를 다시 실행해 질문을 이어간다. 사용자에게 Creator를 다시
호출시키거나 별도 "질문지 다시 열기" 동작을 요구하지 않는다.

## 기존 task 수정

사용자가 기존 task JSON의 현재 내용을 수정해 달라고 명시하면 YAML을 재변환하지 않고
`creator_app revise`로 해당 JSON을 직접 연다. `structure_confirmed`를 `false`로 바꾸는 식으로
수정 화면을 우회해서 열지 않는다. 이 명령과 내부 상태값은 사용자에게 노출하지 않고,
사용자에게는 위의 “기존 Task를 연 직후” 안내 문구만 전달한다.

단순히 기존 task를 열거나 미완료 저작을 이어가는 요청은 기존 `start` 흐름을 유지한다.
검증만 요청한 경우에도 수정 세션을 만들지 않고 기존 Validator 흐름을 유지한다.
`revise` 또는 그 `launch_id`의 `status` 확인 자체가 실패한 경우에만 아래 Legacy clipboard
직접 수정 규칙을 사용한다.

Legacy clipboard 모드에서는 먼저 task를 읽고 미완료 run을 확인한다. 구조 변경은 구성
편집기 경로를 사용하고, 설정만 바꾸는 요청은 관련 필드와 참조를 함께 수정한 뒤 검증한다.
진행 중 run과 task 지문이 달라지면 재개할 수 있으므로 구조·실행 의미가 바뀌는 수정 전에
사용자에게 영향을 알린다.

입출력 연결의 동일성은 이름이 아니라 `$.nodes.<id>.output.<field>` source로 판단한다.
생산자 출력명과 소비자 입력명이 달라도 같은 source면 정상이다. 출력 삭제·이름 변경 시
모든 소비자 source와 API response mapping을 함께 정리한다.

## 질문지에서 특히 지킬 계약

- 새 입력은 외부 입력이어도 되고 이전 노드 출력과 연결해도 된다. 출처 선택은 강제가 아니다.
- schema 2.2의 분기 합류 입력은 Creator가 선택된 케이스별 `source`와 `when`을 함께
  보존한다. 정상 설계 화면에서는 같은 입력을 `선택된 경로의 결과` 한 줄로 표시하고,
  연결이 불완전한 경우에만 케이스별 출처를 펼친다. 각 일반 노드에는 실제 대상 이름만
  `다음 단계`로 표시한다. 화면을 단순화하더라도 `next` 없음(배열상 다음 노드),
  `next: null`(종료), `next: <노드 ID>`(지정 단계)를 서로 바꾸어 저장하지 않는다.
- `inputs_from`에 `from_task/from_node/from_field`가 모두 있는 입력은 일반 외부 입력이 아니라
  "이전 task 출력 — 자동 전달"로 표시하고 기존 연결을 그대로 보존한다. 질문지는 같은
  workflow의 선행 task → 노드 → 출력 필드 계약을 탐색해 새 연결을 선택할 수 있다.
  실제 실행값은 표시하지 않으며, 사용자가 명시적으로 선택한 경우에만 기존
  `inputs_from` 형식으로 연결한다.
- `file_read`는 정확히 한 방식만 사용한다: 고정 경로, 실행 시 경로 입력(`path_input`),
  폴더+파일 힌트, 수동 내용 붙여넣기. 실행 시 경로 입력은 한 번 경로를 받은 뒤 엔진이
  파일을 직접 읽으며 내용을 다시 묻지 않는다.
- 수동 시스템 실행의 작업 URL은 선택이며 `http://` 또는 `https://`만 허용한다.
- API 조회 결과는 `response_fields`로 결정적으로 추출한다. 수동 또는 외부 도구로 페이지 전체를
  받은 경우 decision 노드가 전체 내용을 읽고 선언된 output을 추출할 수 있다.
- 판단 프롬프트는 표준 `decisions/.../main_prompt.md`에 저장한다. 기본 초안은 입력·참고자료에
  명시된 사실만 쓰며 근거가 없으면 값을 지어내지 않고 `null`로 둔다.
  task JSON에는 프로젝트 상대경로를 저장하고, 질문지에는 사용자가 파일을 찾을 수 있도록
  현재 PC의 실제 절대경로를 표시한다.
- 생성 프롬프트와 판단 기준은 큰 편집 dialog에서 수정한다.

## 필요할 때만 읽는 자료

- 전면 재설계, 수동 JSON 수정, 스키마/참조 검증 오류가 있을 때
  [references/task-schema.md](references/task-schema.md)를 읽는다.
- 사용자가 커스텀 로직을 요청했거나 `remaining.kind == custom_logic`일 때만
  [references/custom-logic.md](references/custom-logic.md)를 읽는다.

실제 사용자 시나리오를 바꿨다면 최소한 변환 → 구성 확정 → 질문 적용 → 검증 흐름과,
해당 변경의 회귀 테스트를 실행한다.
