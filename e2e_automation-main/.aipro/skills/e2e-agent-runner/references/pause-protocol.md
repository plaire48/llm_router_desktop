# pause payload와 복구 계약

## payload 모양

- ask_user / decision output / MCP 조회:
  `{"output":{"output_1":"값","output_2":null}}`
- 이전 Task 더미 입력:
  `{"output":{"input_from_id":"SAMPLE 더미"},"dependency_dummy_origin":"manual|ai|reuse"}`
  - Standalone에서 사용자가 직접 준 값은 `manual`, AI가 만든 예시를 사용자가 확인한 값은 `ai`다.
  - `reuse`는 Dashboard의 같은 Workflow 캐시가 적용한 값에만 사용한다.
- 분기 판단: `{"label":"선언된 라벨","output":{...}}`
- 산출형 판단: `{"output":{...}}` — label 금지
- 생성: `{"content":"생성 내용"}`
- 파일 탐색: `{"path":"실존 파일의 경로"}`
- 시스템 선택: `{"system":"선언된 이름"}`
- 확인: `{"confirmed":true}`

엔진 출력의 `payload_file`에 쓰고 `resume_command`를 그대로 실행한다. 정상 소비 후 payload는
삭제되며 rejected/error payload는 원인 확인을 위해 남는다.

## 사용자 대화

- 자유 입력과 긴 복붙은 채팅으로 받는다.
- 객관식 도구는 2~4개의 짧은 선택에만 쓴다. 5개 이상은 채팅 번호 목록이다.
- 노드는 `node_label`로 부르고 내부 id를 노출하지 않는다.
- 한 대화에서는 한 건ID만 진행한다.
- `note`는 전달하고, `executed`는 “자동 수행됨”으로 간단히 알린다.

## 오류와 중복 보호

- `missing_upstream_output`: 현재 task의 생산 노드/출력 계약 오류다. 사용자에게 값을
  만들어 달라고 하지 말고 task 저작을 수정한다.
- `missing_dependency_output`: 같은 업무 Key의 이전 Task 결과가 없으면 오류 종료 대신
  `ask_dependency_dummy` 사용자 pause가 된다. Runner는 현재 Task의 모든 노드를 실행 전에 훑어
  필요한 이전 Task 출력을 한 번에 모은다. 같은 출력은 한 번만 입력받고 Task JSON의
  Task·Node·output 표시 이름과 사용하는 현재 Node 이름만 보여 준다. 입력은 일반 텍스트로
  유지한다. Dashboard에서는 입력 화면과 검토용 AI 초안을 사용하고 Code Assistant가
  `human-submit`으로 우회하지 않는다. Standalone에서는 채팅으로 값을 받은 뒤 사용자의 확인을
  거쳐 제공된 `payload_file`과 `resume_command`로 `human-submit`한다. AI 예시도 확인 전에는
  제출하지 않는다. 실제 선행 run 결과가 입력 전후에 생기면 예시 데이터보다 우선한다. 같은
  Task 내부 `missing_upstream_output`에는 이 대체 경로를 적용하지 않는다.
- 자동 조회의 일시 오류는 엔진 재시도 뒤에도 실패한 경우다. 같은 start로 이어갈 수 있다.
- 쓰기 시도가 기록되지 않은 상태에서는 대상 시스템 반영 여부를 먼저 확인한다. 미반영일
  때만 다시 실행하고, 이미 반영됐거나 판단 불가면 중단한다.
- MCP 미연결·호출 실패를 임의 값이나 수동 조사로 대체하지 않는다.
- custom_logic 오류는 LOGIC.md, run.py, stdout JSON 계약과 승인 상태를 creator로 점검한다.

## 전체 문서에서 output 추출

manual 또는 MCP 조회가 페이지 전체 내용을 output으로 냈다면 그대로 run payload에 저장된다.
후속 decision 노드는 그 source를 입력으로 받아 프롬프트에 따라 필요한 필드를 의미적으로
추출한다. API 방식은 `response_fields` JSONPath로 미리 선언한 값을 결정적으로 추출한다.
