# opencode 벤치마크: 코딩 하네스

2026-10-23. 사용자 요청 "opencode를 그대로 벤치마킹해도 돼, 아예 그대로 가져와도 되니까 코딩 수준 품질 높여".
대상은 opencode(MIT, https://github.com/anomalyco/opencode, 커밋 d93568f3, 2026-10-22)다. 코드는 읽기만 했고 그 저장소의
설치나 스크립트는 실행하지 않았다. 가져온 코드는 THIRD-PARTY-NOTICES.md에 출처와 MIT 전문을 적는다.

## 결론

누비가 앞선 것: 수정 전 해시와 읽은 범위 검사, 같은 실패 반복 막기, 수정 뒤 문법 검사(새로 생긴 오류만 막음),
PageRank 코드 지도, 실모델 평가(eval/, 숨은 시험과 반복 신뢰도). opencode v2는 아직 LSP 실행부가 없다(TODO).

누비가 뒤진 것과 반영 순서(효과 큰 순):

| 순서 | 항목 | opencode 근거 | 방식 | 상태 |
|---|---|---|---|---|
| 1 | 수정 원문 맞추기: 정확, 따옴표/대시/특수 공백 정규화, 줄 끝 공백 무시, CRLF 보존, replaceAll, 실패 때 개수/줄 번호/가장 비슷한 줄 | core/src/tool/plugin/edit.ts:49-200, 286-291 | 코드 이식 | 완료 755dcc9e |
| 2 | 소스 찾기 정규식과 include 글롭 | tool/plugin/grep.ts, ripgrep.ts | 패턴 | 완료 fdc56ded |
| 3 | 너무 큰 도구 결과: 버리지 않고 앞부분과 전체 파일 경로 | tool-output.ts:13-14, 88-92 | 패턴 | 진행 |
| 4 | 코딩 규칙과 환경 블록(OS, 셸, 날짜, git 저장소와 브랜치) | session/runner/prompt/system.txt, instructions/builtins.ts:25-44 | 패턴 | 진행 |
| 5 | 429/503 재시도 6~8회, 간격 상한 10~15초, retry-after 존중 | model-retry.ts:12-40 | 패턴 | 진행 |
| 6 | 코드 지도를 코딩 작업 문맥에 넣기 | (누비 code-map.mjs 재사용) | - | 진행 |
| 7 | 승인된 명령 결과(앞뒤 출력, 종료 코드)를 바로 돌려주기, 앞부분 패턴 "항상 허용" | tool/plugin/shell.ts, shell/parse.ts, permission.ts | 패턴 | 다음 |
| 8 | 수정 뒤 타입 진단 자동 첨부(TS lib 포함) | edit.ts:205 TODO, 누비 inspect_code | - | 다음 |
| 9 | 단계별 그림자 git 스냅숏과 되돌리기 | snapshot.ts, session/revert.ts | 패턴 | 다음 |
| 10 | 코딩 평가 세트 code-30과 녹화 재생 | http-recorder, TestLLM | 패턴 | 다음 |

## 가져오지 않는 것

- 실행 중 내려받기(ripgrep, 언어 서버, 포매터): 회사 PC는 공개 설치가 막혀 있다. 이미 있는 도구만 찾고 내려받지 않는다.
- Serena(본체 GPL-3.0), Roo-Code(보관 처리됨).
- codemode: 누비의 승인 카드는 동작 하나에 호출 하나가 필요하다.
