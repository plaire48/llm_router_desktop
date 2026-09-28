# 자동 요약과 오류 후 작업 연속성

2026-09-23. 기준선 `638d47f`. Qwen 3.8 27B를 기준으로 하며 실제 선택된 provider/model을 그대로 사용한다. 새 설치 파일은 빌드하지 않았다.

## 실제 적용

### 과거 대화 자동 요약

원문 대화가 24,000자 이상이면 Excel 셀/양식, 새 통합문서, Word, PowerPoint의 실제 실행기에서 요약을 한 번 요청한다. 라우팅과 실행기 양쪽에서 중복 요약하지 않는다. MiniSearch로 선택한 최대 24,000 JSON자 원문 조각을 전달한다. 요약에는 목표/제약/결정/미확인 질문/배경과 원문 `sourceId`, 조각 시작 위치, 정확한 인용문을 요구한다.

- 최대 8개 항목, 요약/인용 각각 240자, 반환 6,000자, 대기 20초. 별도 도구나 쓰기 권한 없음.
- 실제 제공한 조각과 인용문의 일치를 검사하고 원문 역할/순서/오프셋을 호스트가 부착한다. assistant의 주장을 사용자 결정으로 승격하거나 `completed` 항목을 반환하면 거절한다.
- 요약은 일부 원문을 가리키는 참고다. 추론의 의미적 정확성이나 전 대화 포함을 증명하지 않는다. 원문과 검색 도구는 그대로 유지한다.
- 유효한 요약이 있으면 actor의 요약+원문 창을 12,000자로 제한한다. 기존 원문 창은 16,000자다. 최근 조건 수정과 명시적 재조회 조각을 우선한다. 계획/제안/최종 검토에 고정하는 사용자 원문 조건, 현재 요청과 같은 실행의 HITL 답변은 별개로 유지한다.
- 형식 오류/잘못된 인용/시간 초과 등 요약 실패는 원문 경로로 대체한다. 같은 실행에서 보조 요약을 반복 호출하지 않는다. 429의 Retry-After는 지킨다. 인증/모델/인증서 설정 오류는 중단한다. 사용자 취소 후 늦게 온 요약은 적용하지 않는다.

요약 호출 자체의 비용은 발생한다. 12,000/24,000은 문자 기반 운영 예산이며 Qwen 토큰 수나 실측 비용 절감을 뜻하지 않는다. 원문 전체를 삭제하거나 검토 조건을 요약으로 대체해 예산을 맞추지 않는다.

### 실행 상태로 문맥 재구성

`run-continuity.mjs`는 LLM이 아니라 호스트 상태에서 현재 단계, 완료 상태, 실제 작업 건수, 문서/범위 fingerprint, 답변 수, 미해결 오류 정보를 구성한다. 정확한 사용자 답변, 셀 원문, 수식, 초안, 적용 검사와 receipt는 각 실행기의 기존 저장소에서 유지한다.

- Excel은 누적 도구 결과/8회 결정 이후 새로운 문맥으로 넘어갈 때 정상 문맥 정리와 오류 복구를 구분한다. 원본을 다시 읽어 fingerprint를 비교한 뒤 미완료 단계부터 계속한다. 이전 오류 기록과 실제 적용 검사도 함께 전달한다.
- 새 통합문서는 작성 중인 초안과 확정한 시트를 유지한다. 정상 문맥 전환이 `lastError`를 가짜 compaction 오류로 덮어쓰지 않는다. 부분 초안의 실제 내용으로 진전을 판단하므로 동일 개수의 셀을 수정한 경우도 인식한다.
- Word/PPT는 기존 한 도구 단위 문맥 재구성에 현재 단계/작업/오류 상태를 함께 전달한다.
- 정상 문맥 정리는 retry 횟수나 복구 HITL을 늘리지 않는다. 문맥 정리 뒤에도 실제 작업 상태가 같으면 `agent_stalled`로 기존 진전 없음 정책을 적용한다. 오류 횟수만 늘어난 것은 진전이 아니다.
- 쓰기 응답이 불확실한 경우의 조회/재확인 정책과 저장 승인, 사용자 취소는 유지한다. 요약이 편집 승인이나 성공 증거가 될 수 없다.

이 구현은 **현재 worker 프로세스 안의 연속성**이다. 앱 종료/PC 재시작 이후 durable resume는 구현하지 않았다. NASCA 기업 문서를 평문 JSON/SQLite/sidecar로 저장하지 않는다. 원본 재바인딩, 회사 승인 보호 저장소, 작업 ID/불확실한 쓰기의 조정까지 함께 구현해야 재시작 복구라고 부를 수 있다.

## BP와 오픈소스 검토

| 공식 자료 | 적용과 선택 |
|---|---|
| [Anthropic effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 요약만으로 충분하다고 보지 않고 단계별 진행 상태와 검증 기준을 별도로 유지. 예제의 git/progress 파일을 기업 문서 평문 저장 경로로 복사하지 않음 |
| [Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) / MIT | 최근 맥락 유지, 경계에서 문맥 갱신, 원본과 요약 구분을 참고. 기존 Pi agent-core 0.86.1을 실제 재사용하며 파일/CLI 세션 의존성이 있는 coding-agent 전체를 추가하지 않음 |
| [LangChain summarization middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#summarization) | trigger/keep과 선택적 문맥 요약 패턴 적용. 지정한 사내 모델을 유지하고 정확한 인용 검사를 추가. LangChain 런타임은 설치하지 않음 |
| [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | checkpoint와 task side effect를 구분하는 설계 참고. 기존 Office receipt와 불확실 쓰기 확인을 유지. 현재 회사 보호 저장소가 없는 상태에서 메모리/디스크 체크포인터를 durable 복구 완료로 표현하지 않음 |
| MiniSearch 7.2.0 / MIT | 기존 실제 의존성으로 요약 입력 선택과 원문 재조회 수행 |
| p-retry 8.0.1 / MIT | 기존 실제 의존성으로 주 실행기의 일시적 추론/읽기 오류 복구 유지. 요약에 무한 재시도 루프를 중첩하지 않음 |

신규 의존성은 추가하지 않았다. 프레임워크 설치가 필요한 구조 전환 대신 기존 Pi/MiniSearch/p-retry와 Office 상태 계약에 작은 어댑터를 연결했다.

## 검증 범위

- `tests/context-summary.test.mjs`: 유효한 인용/역할/오프셋, 불법 완료 주장·없는 출처·assistant 권한 승격 거절, 원문 보존, 짧은 대화 무호출, 실패 시 1회 대체, 취소/늦은 응답, 429 대기, 설정 오류, 실제 Pi 셀 실행 연결.
- `tests/document.test.mjs`: 두 시트의 실제 초안 chunk를 4회 이상 문맥 전환하며 작성. 처음 도구 실패 후 정상 chunk를 계속 반영하고, 오류 기록과 모든 셀을 유지하며 복구 대기/HITL 없이 완료.
- `tests/content-agent.test.mjs`: Word/PPT에서 요약 실패 후 도구 오류를 고쳐 같은 실행으로 계속하고 사용자 원문 조건을 최종 검토까지 유지.
- 전체 결과와 소스 해시는 `verification/auto-summary-review.json`에 기록한다. 모델 응답/Office 읽기는 제어 fixture이며 실제 Qwen 판단 정확도·속도·토큰 비용 및 Windows Office/NASCA 검증은 미실시다.
