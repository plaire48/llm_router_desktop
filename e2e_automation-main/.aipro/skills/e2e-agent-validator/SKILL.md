---
name: e2e-agent-validator
description: >-
  task JSON을 검증한다(스키마 + 참조 무결성 + 가짜값 + 리허설).
  "이 task 검증해줘", "실행해도 되는 상태인지 확인해줘" 요청이나, e2e-agent-creator로
  task JSON을 만들거나 수정한 직후에 사용한다.
---

# e2e-agent-validator — task JSON 검증

## 대시보드와 기존 검증 경로

통합 대시보드의 **검증** 버튼은 이 스킬과 동일한 Validator 및 `--rehearsal` 계약을 사용한다.
Connected Creator의 상세 설정 **확정**도 같은 Validator와 rehearsal을 서버에서 즉시
결정론적으로 실행한다. 검증 통과 시 일반 Creator는 완료 화면을 표시하고, 대시보드에서
연 Creator는 검증 내역을 먼저 표시한 뒤 사용자가 `대시보드로 돌아가기`를 눌러 복귀한다.
이 자동 검증에는 AI 판단이 없으므로
사용자에게 `확정 완료` 입력을 요구하거나 이 스킬로 같은 검증을 중복 실행하지 않는다.
자동 검증 오류가 표시되어 사용자가 수정을 요청한 경우에만 오류를 해석해 Creator 수정
흐름으로 연결한다.

사용자가 대시보드를 명시적으로 요청하지 않은 일반 검증 요청은 아래 기존 명령으로 계속
처리한다. Validator만 호출됐다는 이유로 대시보드나 Creator 수정 세션을 시작하지 않는다.

## 검증 실행

**현재 AI 에이전트가** 다음 명령을 셸로 직접 실행한다. 사용자에게 명령 실행을 요청하지
않고, 검증 중 task JSON을 수정하지 않는다.

```
python ops_runtime/validate.py workflows/<활동>/<task>.json --rehearsal
```

`--rehearsal`은 모의 리허설 리포트를 포함시키는 플래그다 — 실제 실행이나 API 호출은
하지 않는다(구버전 `--mock`과 동일).

출력: `{ok, errors[], warnings[], groups, next_action?, rehearsal[], task_path, task_fingerprint}`.
`groups`는 `structure`(구조·연결 오류), `incomplete`(작성 미완료),
`advisory`(권장사항) 세 그룹이며 기존 `errors[]`와 `warnings[]`는 호환성을 위해 유지한다.
오류가 있으면 `next_action.type`은 `continue_authoring`이다. `task_path`와
`task_fingerprint`는 Validator가 실제로 읽은 파일을 식별하므로 이전 task의 캐시 결과와
혼동하지 마라. schema 2.0, 2.1, 2.2를 모두 검사한다. schema 2.2의 분기 합류 입력은
`when.if_node`와 케이스 값, 케이스별 연결 완전성, 선택 경로의 출력인지까지 검사한다.
schema 2.0과 2.1에 `when`을 넣는 것은 구형 Runner의 조용한 오작동을 막기 위해 오류다.

## 결과 해석해서 보고하기

- `ok: true` → "검증 통과"라고 알리고, `rehearsal`로 **실행 시 흐름 미리보기**를
  그려라 — 노드는 `label`(사람이 읽는 표기, node id 노출 금지)로, 개입 내용은
  `detail`을 **그대로** 써라(네가 요약을 새로 쓰지 마라 — 판단 노드의 프롬프트
  파일 경로 또는 인라인 판단 기준·참고 자료 경로와 로컬 파일 개수·분기 라벨 또는
  "방침 결정(분기 없음)"/"판단 결과 산출(분기·라벨 없음)" 표기, 수동 노드의 안내문,
  MCP 노드의 서버·지시문 요약("MCP 호출(서버명) — 지시: …", 실행 때 AI가 그 MCP
  도구를 호출한다), 파일 탐색 폴더·힌트, 파일 생성 대상 경로, 커스텀 로직 노드의
  run.py 경로와 로컬 부재·AI 초안 상태 표기가 detail에 들어 있다).
  판단 노드에 참고 자료 폴더가 있으면 "실행
  전까지 그 폴더에 자료를 넣어두면 AI가 읽고 판단한다"고 덧붙여라. 커스텀 로직
  노드는 일시정지 없이 엔진이 자동 실행한다(`mode: "auto"`).
- `errors`가 있으면 각 오류를 쉬운 말로 설명하고 해결 방법을 안내하라:

| 오류 유형 | 의미와 해결 |
|---|---|
| `__미정__ 마커` | 저작 질답을 건너뛴 항목. `/e2e-agent-creator`로 마저 채워야 함 |
| placeholder (example.com 등) | 예시 값이 실값 행세 중. 실제 주소/경로를 받아야 함 |
| 참조 무결성 (존재하지 않는 노드·출력 필드 참조/라벨 불일치/If가 라벨 없는 판단을 참조) | 구조 수정 중 끊긴 연결이거나 분기 근거가 없는 판단. `/e2e-agent-creator` 수정 모드로 복구 |
| 산출형 판단에 outputs 없음 | 라벨 없는 판단은 출력 필드가 결과의 유일한 통로다. 출력 필드를 선언하거나, 분기가 필요하면 labels+If를 만들어야 함 |
| mcp 완결성 (`mcp_server`/`mcp_instruction` 부재, 지시문이 입력에 없는 `{필드}` 참조, method 오타) | MCP 방식은 서버 이름과 지시문이 둘 다 있어야 하고, 지시문의 `{필드}`는 노드 입력 필드여야 함. `/e2e-agent-creator`로 채움 |
| schema 2.1/2.2 command_spec 오류 | `program` 문자열, 문자열 `args` 배열, 1~3600초 `timeout_seconds`를 사용해야 함. 동적 입력을 셸 문자열로 합치지 않음 |
| 자동 쓰기 승인 정책 오류 | schema 2.1/2.2 자동 system_write/notify_send에는 `approval_required`가 필요하며 false이면 `approval_bypass_reason`이 필수 |
| 자동 순환 | 사용자·LLM 정지 없이 반복되는 경로다. 분기를 재배선하거나 명시적인 판단/승인/수동 입력 정지를 넣어야 함 |

- `warnings` (도달 불가 노드, 판단 프롬프트 파일·참고 자료 경로가 로컬에 없음,
  판단 폴더에 참조자료 없음, 판단 프롬프트가 JSON 인라인이라 파일 관리 권장,
  manual_url이 http(s) 주소가 아님, 커스텀 로직의 폴더·LOGIC.md·run.py가 로컬에
  없음, schema 2.0 legacy command/승인 정책 부재, 쓰기 노드의 `verifies_node` 부재,
  판단·승인·수동 입력을 거치는 재작업 순환 등)는
  실행은 가능하지만 확인을 권한다고 **그대로** 전달하라 — 특히 파일 경로 관련
  경고는 실행 PC에 그 경로가 있어야 한다는 뜻이다.
  단, Connected Creator의 저장·검증 완료 화면은 내부 노드 ID를 사람이 읽는 노드 이름으로
  바꾸고, 사람·AI 개입을 포함한 `재작업 순환 경로` 권고는 의도된 흐름이므로 숨기며 표시
  개수에서도 제외한다. 이 화면 표현 예외는 Validator의 `warnings`, `groups.advisory`와
  일반 CLI·채팅 검증 결과를 변경하지 않는다.
- **커스텀 로직의 "run.py가 AI 초안 그대로" 경고**는 강조해서 전달하라 — AI가
  작성한 코드를 사용자가 아직 검토하지 않았다는 뜻이다. "코드를 검토·수정하시면
  경고가 사라지고, 수정 없이 확정하시려면 말씀해 주세요"라고 안내하고, 사용자가
  확정하면 경고 메시지에 적힌 approve 명령을 실행한 뒤 재검증하라.

검증을 통과한 파일만 `/e2e-agent-runner`으로 실행하거나 아키텍트 팀에 제출할 수 있다.
