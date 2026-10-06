# 파일 열기 검사 시간 초과

기존 실패 로그 `/private/tmp/nubi-chat-scrollbar-identity.log`는 check-electron-shell.mjs에서 example.js 버튼을 찾는 locator.click이 10초 후 실패한 기록이다. 저장된 실패 화면에는 파일 트리의 example.js가 이미 표시되어 있다. 파일 읽기 RPC나 Monaco 편집기 시작까지 도달한 실패가 아니므로 이 기록으로 파일 읽기가 느리다고 판단하지 않는다.

기존 버튼 목록을 react-arborist 트리로 전환하면서 검사 대상이 갱신되지 않았다. 파일 트리의 treeitem을 지정하고 이후 파일 편집기 안의 Monaco 표시를 별도 기다리도록 수정했다. 중복 확장자 표기는 접근성 이름에서 제외하여 파일 이름을 정확히 지정한다. 시간 제한은 늘리지 않았다.

실제 탐색기의 활성화 처리도 일원화했다. react-arborist 기본 행의 클릭은 select 후 activate를 호출한다. 파일 열기를 select의 경로 변경 조건에만 묶으면 이미 선택한 파일을 다시 열 수 없었다. activate에서 파일/폴더를 각각 열고, 별도 select 열기를 제거해 중복 요청도 방지한다. 파일 해시, dirty buffer, undo와 project 변경 검사는 유지한다.

사용자의 빌드만 수행 지침에 따라 전체 검사와 자동 파일 열기 재검사는 실행하지 않았다. 이 수정은 A2A의 역사적 활성 검사 기대값을 바꾸거나 A2A를 활성화하지 않는다. 전체 검사 통과로 표시하지 않는다.
