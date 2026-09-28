# task JSON 저작 계약

전면 재설계나 직접 수정이 필요한 경우에만 읽는다. 평상시에는 변환기·질문지·적용기가 이
계약을 구현한다.

## 루트와 공통 필드

- 신규로 직접 저작하는 task의 `schema_version`은 `2.2`다.
- 루트에는 `activity`, `task_id`, `task_name`, `author`, `created_at`, `source_yaml`,
  `source_yaml_sha256`, `source_task_id`, `max_auto_steps_per_pump`,
  `structure_confirmed`, `inputs_from`, `nodes`가 있다.
- 일반 노드는 고유한 소문자/숫자/밑줄 id, 사람이 읽는 name, `action_type`, `inputs`,
  `outputs`, `io_confirmed`를 가진다.
- 새 구조의 사실값은 `__미정__`으로 두되 참조 source에는 마커를 넣지 않는다.
- `inputs_from`은 시작 시 사용자에게 받을 값이거나 이전 task의 출력이다. 이전 task 값은
  `from_task`, `from_node`, `from_field`를 모두 쓴다. 건ID 자체는 `$.key`를 쓴다.

## 입력과 출력

```json
{"field":"소비자가 부르는 이름","source":"$.nodes.read.output.output_1"}
```

출력은 `{ "id": "output_1", "name": "사람이 보는 이름" }`이다. 연결은 이름이 아니라
source의 node id와 output id로 식별한다. 한 출력을 여러 이름의 입력으로 소비해도 된다.

## 시스템 조회·실행

`method`는 `api`, `command`, `mcp`, `manual` 중 하나다.
시스템 조회(`system_read`)와 파일 조회(`file_read`)에는 결과를 전달할 `outputs`가 최소
1개 필요하다. 시스템 실행(`system_write`)은 완료 확인만 필요하면 출력이 없어도 된다.

- API: `integration.endpoint`, `http_method`, 선택적 `auth`, `request`,
  `response_fields`. endpoint는 HTTP(S) URL이다. auth에는 secret 값이 아니라
  `{ "kind": "env|credman", "name": "참조 이름" }`만 둔다.
- command: `command_spec.program`, `args`, `timeout_seconds`. 셸 문자열이나 `&&` 대신
  프로그램과 인자를 분리해 `shell=False`로 실행한다.
- MCP: `mcp_server`, `mcp_instruction`. 입력값 자리는 `{필드명}`이다.
- manual: `manual_guide` 필수, `manual_url` 선택. URL은 HTTP(S)만 허용하며 입력값
  자리는 MCP 지시문과 똑같이 `{필드명}`으로 쓴다. Runner는 모든 지원 schema에서
  실행 시 해석된 노드 입력값으로 치환한다. 입력이 없는 참조나 null 값이면 실행을
  중단하며, `{}`가 없는 기존 고정 URL은 그대로 연다.
- manual 시스템 조회는 `manual_copy_automation: true`를 선택적으로 쓸 수 있다.
  이 설정은 `action_type: system_read`, `method: manual`, 유효한 `manual_url`이 모두
  있을 때만 허용한다. Runner는 기존 Edge 로그인 세션으로 페이지를 조회하고
  한 번 복사한 전체 내용을 선언된 `outputs`에 맞게 추출한다. 필드가 없거나
  `false`면 기존 수동 조회를 그대로 사용한다.
- 시스템이 여러 개면 설정을 `systems` 배열에 둔다. 한 시스템 이름 힌트만 있는 단일
  노드는 별도 배열 없이 노드 자체에 설정한다.
- schema 2.1과 2.2의 자동 system_write와 notify_send는 기본 `approval_required: true`다.
  해제하려면 `approval_bypass_reason`이 필요하다.

API의 `response_fields`는 응답 JSON에서 선언된 출력을 결정적으로 뽑는다. 페이지 전체
내용을 의미적으로 해석해 값을 찾는 일은 수동/MCP 조회 결과를 decision 입력으로 넘겨
처리한다.

## 파일

file_read는 아래 네 방식 중 정확히 하나다.

1. `path`: 고정 파일 경로
2. `path_input`: 실행 시 받을 경로 필드. 같은 이름의 node input과 `inputs_from` 선언 필요
3. `directory` + `file_hint`: 에이전트가 실제 파일 후보를 찾은 뒤 엔진이 읽음
4. `method: manual` + `manual_guide`: 사용자가 내용 전체를 붙여넣음. 경로 input은 제거

file_write는 `path`와 `template` 또는 `generation_prompt`를 쓴다.

## 판단과 분기

- 신규 decision은 `prompt_file`을 사용하고 그 폴더를 `references`에 연결한다.
- 분기 판단형은 `labels`와 뒤의 If를 가진다. If는 `type: if`, `source_node`, `cases`를
  가지며 labels 집합과 cases value 집합이 일치해야 한다.
- 산출형 판단은 labels와 If 없이 outputs로 결과를 넘긴다. outputs가 필수다.
- 날짜·기한 출력은 입력/참고 자료의 근거로만 추출하거나 산정한다. 근거가 없으면 null이다.

### schema 2.2 분기 합류

- 일반 실행 노드의 의도된 다음 노드가 JSON 배열의 바로 다음 노드와 다르면 `next`에 대상 `nodes[].id`를 저장한다.
- 의도된 다음 노드가 배열의 바로 다음 노드면 `next`를 생략한다. 해당 노드에서 끝나야 하면 `"next": null`을 저장한다.
- 여러 케이스가 같은 노드로 합류하고 같은 입력 필드에 각 케이스 결과를 전달하면 입력마다 `when`을 저장한다.

```json
{
  "field": "처리 결과",
  "source": "$.nodes.case_1.output.result",
  "when": {"if_node": "route", "value": "케이스 1"}
}
```

- 같은 합류 입력 필드에는 합류 가능한 모든 케이스가 정확히 한 번씩 연결되어야 한다. 일부 케이스가 빠졌거나, 한 케이스가 중복되거나, 서로 다른 분기의 입력을 섞은 경우 Creator는 추측해서 저장하지 않는다.

## 기타 타입

- notify_send: `channel`, `recipient`, `message`
- notify_receive: `guide`
- consult: `topic`
- file/system/decision의 JSON 어휘로 표현하기 어려운 반복·계산·변환만 `custom_logic`을 쓴다.

구조 수정 후에는 끊긴 source, If 라벨 집합, response mapping, 고아 inputs_from을 함께
정리하고 Validator를 실행한다.
