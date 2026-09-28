# 대화 자동 압축 재검토

2026-09-23. Windows Office 2016과 사용자가 선택한 Qwen 모델을 기준으로 기존 공통 문맥 모듈을 개선했다. 이번 변경은 소스와 로컬 제어 검증이며 설치 파일을 빌드하지 않는다.

## 재현한 문제와 반영

1. 긴 대화에 과거 요약과 조회 결과가 있을 때, `두 번째로 해줘`는 남지만 바로 앞 선택 질문이 사라졌다. 최신 사용자 원문 다음에 그 앞의 assistant 질문 원문을 먼저 배치한다. 질문이 길면 처음과 끝부터 보존하고 `recentExchange`의 원문 ID와 포함 범위를 표시한다. 불완전하면 기존 `recall_context`로 조회하며 질문을 승인이나 사용자 지시로 승격하지 않는다.
2. 도구 결과의 반복 서식이 손실 없이 작아져도 압축 전 크기로 문맥 재구성을 시작했다. 실제 전송과 동일한 `compactMessages` 결과에 도구 명세까지 더해 판단한다. 원본 관찰값은 변경하지 않고 사전 검사에서 요청 횟수나 사용량을 중복 집계하지 않는다. 기존 8회 결정 이후 상태 재구성 및 무진전 보호는 유지한다.

과거 대화가 24,000자 이상이면 같은 선택 모델로 한 실행에 한 번 보조 요약을 시도하는 기존 경로를 유지한다. 검증한 원문 인용만 받아들이며 요약 실패/시간 초과는 원문 조회로 이어간다. 원래 요구사항, 현재 요청, HITL 답변, native 영수증과 미확정 쓰기는 별도로 유지한다. 요약은 완료나 승인의 근거가 아니다. 이 변경은 채팅 기록을 삭제하거나 디스크에 평문 요약을 저장하지 않는다.

## 방법론과 오픈소스 선택

| 근거 | 검토와 적용 | 채택하지 않은 부분 |
|---|---|---|
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) | 과거 요약과 최근 원문을 분리하고 필요한 원문을 다시 조회하는 패턴 | Claude 전용 서버 compaction API를 Qwen/AI Pro 공통 API로 가정하지 않음 |
| [Codex compact.rs](https://github.com/openai/codex/blob/40eac3ce8a0c10cbcb9db910d529355eb2f8fc09/codex-rs/core/src/compact.rs), Apache-2.0 | 실제 공개 소스의 최신 사용자 문맥 우선 및 기본 문맥 재주입을 설계 참고. 최근 질문/답변을 원문으로 유지하도록 Office 어댑터 수정 | Rust 런타임 이식, 사용자 조건의 조용한 절단, Codex 로그인/인증 재사용 없음 |
| [Pi compaction](https://github.com/earendil-works/pi/blob/b313731b80ff0b8616e327fdeb114f25addb91fc/packages/coding-agent/docs/compaction.md), MIT | 설치된 SDK 0.86.1의 실제 compaction 소스와 최근 문맥 보존 방식을 검토. 기존 Pi 실행기와 호스트 상태 재구성을 재사용 | `estimateTokens`의 chars/4를 한국어 Qwen의 실측치로 도입하지 않음. CLI 전체 세션 재작성은 native 영수증/승인 계약과 맞지 않음 |
| MiniSearch 7.2.0, MIT | 기존 실행별 원문 인덱스와 정확한 sourceId/offset 페이지 조회를 그대로 사용. 최근 질문의 생략 범위도 이 경로로 복원 | 원문을 외부 임베딩 서비스에 보내거나 새 벡터 DB를 도입하지 않음 |

새 의존성은 추가하지 않았다. 이미 채택한 OSS로 원문 조회와 실행을 유지하고 Office 특유의 보존 우선순위만 수정한다. 추가 프레임워크는 설치 크기와 상태 관리 주체를 늘리며 이 두 결함을 해결하는 데 필요하지 않다.

## 검증과 제한

`tests/auto-compaction.test.mjs`에서 질문 누락, 긴 질문의 부분 범위, 불필요한 체크포인트를 변경 전에 재현했다. 관련 문맥/요약/손실 없는 변환 검사 31개가 통과했다. 게시용 소스에서 `npm test` 전체 443개도 통과했다(실패/취소/건너뜀 0). 취소 후 늦은 요약 무시, 요약 실패 fallback, Retry-After, 원래 조건과 쓰기 승인 보존 검사도 포함한다.

이는 합성 입력의 제어/보존 검증이다. 실제 Qwen의 이해 정확도, 토큰 한도, 지연/비용 향상, Office 2016 COM과 NASCA 실행을 입증하지 않는다. 최근 질문 전체가 예산에 들어가지 않는 경우 원문 조회 또는 사용자 확인이 필요하다. 한 실행당 한 번의 과거 요약과 작업 중 호스트 상태 재구성은 별도이며, 재시작 후 자동 복원은 이 변경의 범위가 아니다.
