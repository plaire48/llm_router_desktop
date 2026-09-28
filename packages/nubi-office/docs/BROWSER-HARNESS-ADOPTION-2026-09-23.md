# 브라우저 누비에서 Office 하네스로 가져온 개선

2026-09-23. 소스 기준선 `9f5d3f1`. Windows Office 2016과 사내 Qwen 3.8 27B를 기준으로 설계했으며, 실제 카탈로그 ID와 사용자가 선택한 모델을 그대로 사용한다. **소스/제어 흐름 검증이며 실제 Office, Qwen 품질 또는 NASCA 검증이 아니다. 빌드하지 않았다.**

## 비교와 선택

브라우저의 `analysis-agents.js`, `context-evidence.js`, `context-state.js`, `evidence-search.js`, `agent-runtime.js`와 `ROLE-AGENTS-IMPLEMENTATION.md`, `HARNESS-CONTEXT-QUALITY.md`를 Office 실행 경로와 비교했다.

| 브라우저에서 확인한 패턴 | Office 적용 |
|---|---|
| 좁은 역할/목표/제약/완료 조건과 지정된 근거만 전달 | Excel `analyze_ranges`에 role/constraints/doneWhen 추가. Word/PPT `analyze_document`도 같은 계약 사용 |
| 독립된 분석 문맥, 같은 선택 모델, 제한된 동시 실행 | 공통 `analysis-jobs.mjs`에서 최대 2개 모델 호출. ChatGPT는 세션 갱신 제약으로 1개. Office COM 읽기/쓰기와 승인은 주 실행기에서 직렬 처리 |
| 실제 읽은 근거만 반환, 보고서는 편집/완료 권한이 아님 | Excel은 관찰한 snapshot/cell 범위 검사 및 인용 보존. Word/PPT는 지정 item/field의 인용문이 원문 부분 문자열인지 검사하고 호스트가 scope/document/fingerprint/offset을 부착 |
| 역할/목표/근거가 같은 작업의 결과 재사용 | brief 전체, 선택 provider/model, 정렬된 source ID와 실제 내용/버전에 캐시 바인딩. 성공한 분기 유지, 실패한 분기 재호출. 캐시 조회는 진행으로 계산하지 않음 |
| 결과 수집과 취소를 명확히 분리 | 분석 중 시작/완료/실패 활동 표시, 취소/timeout 후 늦은 결과는 보관하지 않음. 문서 생성/수정 후 이전 분석 캐시 제거 |
| 조건은 오래된 관찰보다 우선 | 라우팅/계획/제안/단계/최종 검토에 원래 user 메시지를 순서대로 전달. actor는 기존 MiniSearch 창/정확한 재조회 유지. 동일 실행의 답변은 별도 유지 |

Office 분석 분기는 현재 **지정된 원문을 받는 1회 읽기 전용 모델 호출**이다. 내부에 별도 도구 루프나 COM 접근 권한은 없다. 결과가 부족하면 주 실행기가 필요한 원문을 더 읽거나 질문하고 다음 분석을 요청한다. 브라우저의 비동기 start/collect 전체, 페이지/탭 도구 또는 agent 파일 저장소를 통째로 가져오지 않았다. 간단한 작업마다 다중 분석을 강제하지 않는다.

분석 보고서 캐시는 실행 중 메모리에만 보관한다. 최대 16개이며 결정 문맥에는 최근 최대 4개/16,000자 이내의 완전한 보고서만 넣는다. 요약만 남기며 근거를 떼어내지 않는다. 원문 저장소와 native 최종 근거는 별개다. 분석의 인용 위치가 맞는다는 것은 추론의 정확성, 전 문서 확인, 시각적 동일성 또는 편집 성공의 증거가 아니다.

## BP 및 오픈소스 선택

| 공식 근거 | 채택/보류와 이유 |
|---|---|
| [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) | 목표/출력/근거/완료 경계가 명시된 독립 분석과 주 실행기의 종합 패턴 적용. 의존된 편집 작업의 병렬화나 해당 논문의 성능 수치를 Office에 이식하지 않음 |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 원문은 보존하고 필요한 근거만 호출에 전달. 사용자 조건/수정과 기계적 완료 사실을 요약으로 대체하지 않음 |
| [DeepAgents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents) | 격리 문맥, 제한된 도구, 구조화된 반환이라는 방법을 참고. 런타임 미설치: 기존 Pi와 실행 상태/재시도/승인 체계를 이중화하지 않기 위해 패턴만 적용 |
| [Pi](https://github.com/earendil-works/pi) / MIT | 기존 0.86.1 실행 루프 실제 재사용 유지. 브라우저의 역할 작업 코디네이터는 브라우저 도구/프로젝트 저장소에 의존하므로 Office 전용 어댑터로 구현 |
| MiniSearch 7.2.0 / MIT | 기존 실제 의존성 유지. 원문 역할/순서/정확한 오프셋 검색 담당. 임베딩 서버나 외부 전송 없음 |
| p-retry 8.0.1 / MIT | 기존 실제 의존성 유지. 상위 복구 담당은 그대로 두고 하위 분석에 중첩 자동 재시도 루프를 추가하지 않음 |
| [p-limit](https://github.com/sindresorhus/p-limit) / MIT | 검토 후 신규 도입 안 함. 동시 실행 수만으로 취소/timeout/429 배치 중단/결과 캐시를 해결하지 못함. 기존 작은 작업 큐를 공통화하고 AbortSignal과 응답 검증 유지 |

새 런타임 의존성 추가나 라이브러리 버전 변경은 없다. 라이브러리 수를 늘리는 대신 이미 사용 중인 Pi/MiniSearch/p-retry와 Office 전용 가드를 유지했다. 참고 프레임워크를 설치한 것처럼 표현하지 않는다.

## 발견한 오류와 복구

이전 Excel 분석 경로의 `status:'failed', ...faultFacts` 순서는 HTTP `status:429`가 작업 상태를 덮어쓸 수 있었다. 두 분기 중 하나만 실패하고 다른 분기가 성공한 경우 `status === 'failed'` 검사를 통과하지 않아 실패가 정상 완료처럼 취급될 여지가 있었다. 공통 실행기에서 HTTP 상태를 `httpStatus`, 작업 상태를 `status`로 구분했다.

Word/PPT 분석 실패는 상위 복구로 전달한다. 성공한 분기는 캐시에 남기고, 실패한 결과와 Retry-After를 보존하여 재요청한다. 동일 상태에서 세 번 진전이 없으면 기존 같은 실행의 재시도/취소 HITL에 머문다. 인증/인증서 등 영구 오류는 재시도하지 않는다. 어떤 분석 경로도 쓰기를 자동 재실행하지 않는다.

## 검증과 남은 한계

- 개발/배포 소스의 전체 제어 테스트 결과는 `verification/browser-harness-review.json`에 기록한다.
- 새 검사는 두 앱의 실제 Pi 실행 연결, 같은 모델/좁은 brief, 최대 동시 2개, 근거 위조/잘못된 인용, 미관찰 ID, 원본 버전/범위 혼합, 조건/모델 변경 시 재분석, 성공 분기 재사용, 429 대기, 취소/timeout 후 늦은 결과, 과거 사용자 조건 보존을 다룬다.
- 모델 응답은 고정 fixture다. LLM 정확도/토큰 비용/속도 향상은 측정하지 않았다. 한 인용문이 결론을 논리적으로 뒷받침하는지는 별도 모델/사람 평가가 필요하다.
- 사용자 원문 조건 패킷은 100,000 JSON자 한도다. 초과하면 조건을 버리는 대신 `input_context_limit`로 중단한다. 전체 messages+tools 240,000자 예산도 유지한다. 문자 수는 Qwen 토큰 수가 아니다.
- 매우 긴 문서의 180,000자 최종 근거 한도, 조건과 근거가 합쳐져 전체 예산을 초과하는 경우, 보호된 재시작 체크포인트, Word/PPT 사본 우선 양식 작성은 여전히 별도 개선 항목이다.
- 설치 파일은 다시 만들지 않았다. 실제 Windows Office 2016, 사내 모델/SSO, NASCA 저장/재열기 검증은 미실시다.
