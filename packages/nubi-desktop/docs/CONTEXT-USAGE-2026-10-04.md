# 컨텍스트 사용량 표시 개선

2026-10-04

사용량이 있어도 추정 안내가 나오는 조건을 수정한다. 화면 문구를 숨기는 대신 응답에서 받은 수치와 추정 이유를 함께 보존한다.

## 확인한 문제

- 일반 Agent와 다시 응답 받기는 `prompt_tokens`와 `total_tokens`가 모두 있어야 실측으로 저장했다. 공통 정규화기가 인정한 총 토큰 수만 있는 응답도 버리고 추정했다.
- 요약 직후 컨텍스트 추정과 특정 응답의 사용량 누락 모두에 “이 모델은 사용량을 알려 주지 않아”라는 문구를 썼다. 이 상태로는 모델 전체의 지원 여부를 판단할 수 없다.
- 입력/출력 세부 값이 없는 경우에도 상세 행을 표시해 `— 토큰`이 나왔다.

## 적용

`context-usage.mjs`에서 일반 Agent와 재응답의 저장 계약을 공유한다. 유효한 응답 총 토큰 수가 있으면 실측으로 저장하며 없는 입력/출력 값은 만들지 않는다. 일부 카운터만 있으면 상세에 그 수치를 남기고 전체 사용량은 추정으로 구분한다. 숫자 0도 실제 보고된 값으로 유지한다.

요약 후에는 새 컨텍스트 추정치와 `compaction` 사유를 저장한다. 이전 요청의 실측을 새 요약의 실측으로 재사용하지 않는다. 다음 actor 응답이 사용량을 보고하면 갱신한다. planner, reviewer, 메일, 위키와 계정 전체 사용량을 대화 도넛에 섞지 않는다.

기존 저장 기록은 실측으로 저장된 카운터를 같은 정규화기로 읽는다. 단순 `used`, 모델 최대 용량 또는 다른 모델의 기록을 실측으로 승격하지 않는다. 이미 버린 과거 응답의 총 토큰 수는 추측해서 복원하지 않는다.

화면은 실측, 이번 응답 누락, 부분 제공, 요약 후 추정을 구분한다. 실제 세부 카운터가 있을 때만 입력/출력을 표시한다. 전체 모델 컨텍스트와 자동 요약 75% 행은 별도 유지하며 더 낮은 실제 입력 제한과 응답 예약 보호도 유지한다.

## 방법론과 재사용

[OpenAI의 요청별 사용량 안내](https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs)는 Chat Completions의 prompt/completion/total과 Responses의 input/output/total을 구분하고, 스트리밍 마지막 사용량 프레임이 누락될 수 있다고 설명한다. 기존 `normalizeUsage`, `normalizeResponsesUsage`, `readCompletion`, `observeResponsesUsage`를 유지한다. SDK 기본 0이나 누적 대시보드를 실제 응답 카운터로 대체하지 않는다.

[OpenAI의 대화 상태 안내](https://developers.openai.com/api/docs/guides/conversation-state)는 컨텍스트가 입력과 출력을 포함한다고 설명한다. 도넛의 분모는 실제 모델 카탈로그의 최대 용량을 유지한다. 새 패키지 없이 기존 공통 파서와 ContextMeter를 사용한다.

## 확인 범위

- Electron 빌드만 수행한다. 자동 테스트와 실제 모델 요청은 실행하지 않는다.
- `preview/bridge.js`의 `?conversation&usage=measured|total|partial|missing|compacted`는 명시적인 예시 데이터 화면 확인용이다. 실제 계정 성공이나 사용량 수집의 증거로 사용하지 않는다.
- `npm run build:electron` 완료(exit 0). 예시 화면에서 총량만 있는 응답 23,223의 실측 표시, 전체 카운터 23,175/48/추론 30, 요약 후 추정 8,000과 다른 안내 문구를 확인했다. 262,144 모델의 자동 요약은 196,608(75%)이고 예시 화면의 콘솔 오류는 없었다. `evidence/context-total-report-2026-10-04.png`, `context-measured-report-2026-10-04.png`, `context-compacted-estimate-2026-10-04.png`에 기록했다. 부분 제공/누락의 런타임 동작은 자동 검사하거나 실제 모델로 검증하지 않았다.
- 실행 중인 Electron의 재로드/재시작은 메모리 인증과 미저장 상태 보존을 위해 승인 대기 중이다. 현재 실행판에 새 백엔드가 반영됐다고 표시하지 않는다.
