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
| 3 | 너무 큰 도구 결과: 버리지 않고 앞부분과 전체 파일 경로 | tool-output.ts:13-14, 88-92 | 패턴 | 완료 1634d37a |
| 4 | 코딩 규칙과 환경 블록(OS, 셸, 날짜, git 저장소와 브랜치) | session/runner/prompt/system.txt, instructions/builtins.ts:25-44 | 패턴 | 완료 e9c8bc27 |
| 5 | 429/503 재시도 6~8회, 간격 상한 10~15초, retry-after 존중 | model-retry.ts:12-40 | 패턴 | 완료 84a72182 |
| 6 | 코드 지도를 코딩 작업 문맥에 넣기 | (누비 code-map.mjs 재사용) | - | 완료 7a6ccaf8 |
| 7 | 승인된 명령 결과(앞뒤 출력, 종료 코드)를 바로 돌려주기, 앞부분 패턴 "항상 허용" | tool/plugin/shell.ts, shell/parse.ts, permission.ts | 패턴 | 완료 0b9dbaa1 |
| 8 | 수정 뒤 타입 진단 자동 첨부(TS lib 포함) | edit.ts:205 TODO, 누비 inspect_code | - | 완료 8022a4e9 |
| 9 | 단계별 그림자 git 스냅숏과 되돌리기 | snapshot.ts, session/revert.ts | 패턴 | 완료 e8b8ec80 |
| 10 | 코딩 평가 세트 code-30과 녹화 재생 | http-recorder, TestLLM | 패턴 | 완료(이 커밋) |

## 반영 방식 (2026-10-23 사용자 지시: 최대한 그대로)

- 그대로 옮김: 수정 매칭(edit.ts), 큰 결과 자르기(tool-output.ts), 명령 접두어 표 137개와 와일드카드(parse.ts, wildcard.ts), 그림자 git 스냅숏(snapshot.ts, git.ts의 tree capture/restore), 되돌리기(revert.ts), 녹화 일치와 차이 보고(http-recorder matching.ts), 429/503 재시도 정책, 환경 블록.
- 누비 구조에 맞춘 부분: 명령은 승인 카드 뒤에 실행되므로 결과(종료 코드, 앞뒤 출력)는 이미 다음 실행의 영수증으로 자동 전달된다(7번의 앞부분). 항상 허용 접두어에는 누비의 되돌릴 수 없는 명령 검사와 삭제·권한 프로그램 제외를 더했다. 저장한 큰 결과는 새 도구 없이 read_process_output으로 읽는다(도구 스키마 예산 6000 유지). 타입 진단은 opencode v2에 아직 없어(TODO) v1의 수정 뒤 진단 형식을 TypeScript 언어 서비스로 구현했다. 녹화 재생은 HTTP가 아니라 이미 있는 모델 호출 기록(transcript.jsonl)에서 한다.
- 코드 지도는 opencode에 없다. 누비의 PageRank 지도를 코딩 작업 문맥에 넣었다.

## 가져오지 않는 것

- 실행 중 내려받기(ripgrep, 언어 서버, 포매터): 회사 PC는 공개 설치가 막혀 있다. 이미 있는 도구만 찾고 내려받지 않는다.
- Serena(본체 GPL-3.0), Roo-Code(보관 처리됨).
- codemode: 누비의 승인 카드는 동작 하나에 호출 하나가 필요하다.

## 사용법: 코딩 묶음 code-30과 녹화 재생

opencode 벤치마크(2026-10-23)로 코딩 과제 30개를 한 묶음으로 둔다. 수정 C1~C22, 명령 E1~E6, 대화 L2~L3이다(`eval/code-30/synthetic-cases.json`).
C6~C22는 새 평가 자료라 파일 이름에 synthetic- 접두어를 붙였다(업로드 안전 검사). 기준 수정(`eval/code-30/synthetic-references.json`)이 있고, `tests/code-30.test.mjs`가 숨은 검사는 원본에서 실패하고 기준 수정 뒤 통과하며 자료의 기존 테스트도 통과함을 확인한다.

```bash
node eval/run.mjs --set code-30
```

평가 결과 폴더의 `transcript.jsonl`은 모든 모델 호출의 요청과 응답이다. 하네스를 바꾼 뒤 모델 없이 같은 응답으로 다시 채점할 수 있다(opencode http-recorder 방식).
같은 호출자와 도구 목록의 녹화 중 아직 안 쓴 첫 응답을 돌려주고, 맞는 녹화가 없으면 첫 미사용 녹화와의 차이를 남기고 멈춘다. 시간, id, 해시, 임시 폴더를 맞춘 뒤에도 요청이 다르면 '차이'로 센다.

```bash
node eval/replay.mjs --from verification/eval-live/<결과 폴더>
```
