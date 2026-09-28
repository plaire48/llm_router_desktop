# 누비 Office 톤과 실행 상태 개선

2026-09-23 / 0.8.2 소스. 참조 HTML의 시각 언어와 Office의 계획 → 도구 → 관찰 → 검토 흐름을 함께 점검했다. Qwen 기준, 실제 회사 카탈로그의 모델 ID, 기존 Office 승인/보존 계약을 유지한다.

## UI에 적용한 내용

- `agentfactorysdkdeck.html`의 연한 그라데이션, 흰 카드, 파란 강조색, 파스텔 아이콘 타일, 부드러운 그림자와 둥근 모서리를 기존 Nubi/CX 토큰으로 공유한다. 별도 색상/폰트 체계를 만들지 않았다. 발표용 대형 제목은 Office 작업창의 본문 14/22px, 제목 16/24px로 조정한다. 글꼴은 오프라인 번들 Noto Sans KR을 사용한다.
- 양식 목록은 파일 카드로 정리했다. 검색과 등록 + / 새로고침을 한 줄에 놓고, 이름과 입력 위치 수만 기본 표시한다. 스냅샷 정보는 눈 아이콘으로 펼치며, 이름 변경/제거는 아이콘이다. 파일 제거와 목록 제거를 구별하는 문구는 실제 제거 확인에서 보여준다.
- 작성, 저장, 반영, 복구 결정에는 짧은 문구를 남긴다. 등록/새로고침/정보/편집/제거/연결 해제/결과 열기는 공유 `ActionButton`의 접근성 이름, 마우스 제목, 키보드 툴팁을 사용한다. 아이콘만 보고 의미를 추측해야 하는 승인 UI는 만들지 않는다.
- 환영 화면의 마스코트, 앱별 소개, 보조 문장, “누비에게 무엇을 맡길까요?”를 유지한다. 입력창은 요청, +, 모델, 전송/중지로 구성한다. 모든 제공 모델 노출 계약도 그대로 유지한다.
- 양식 목록과 문서 결과는 400ms 단회 진입 애니메이션을 사용한다. 개별 카드에 반복 지연을 걸지 않으며 같은 목록의 재조회 동안 카드 DOM을 유지한다. reduced-motion에서는 애니메이션과 추가 hover transition을 끈다.

## 검토한 BP와 오픈소스

| 근거 | 적합성 판단 | 이번 적용 또는 기존 채택 |
|---|---|---|
| [OpenCode](https://github.com/anomalyco/opencode), MIT / [상태 소스](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/status.ts), [재시도 소스](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/retry.ts) | 실행 상태와 재시도 예약을 구분하는 방법은 Office에도 적합. 코드 편집용 전체 런타임을 중첩하면 현재 receipt/COM 계약과 중복됨 | **방법론 적용**: 최종 run 상태가 남아 있는 도구 이벤트의 표시를 제한. 종료된 작업의 회전/경과시간을 계속 늘리거나 성공으로 바꾸지 않음. 코드를 복사하거나 OpenCode 런타임을 새로 설치하지 않음. 기존 p-retry/Retry-After/무진전 HITL은 유지 |
| [Anthropic long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 작은 단위의 개선, 확인 가능한 진행과 실제 결과 검토. 글은 방법론이며 오픈소스 라이브러리의 설치 증거가 아님 | **방법론 적용**: 불확실한 tool receipt는 “결과 미확인”으로 남기고, 실패/복구 대기 기록은 기본 펼침. 이번 수정도 기능 검사 → 렌더링 확인 → 수정 → 재검사로 진행. 기존 단계/최종 검토를 대체하지 않음 |
| [Codex harness engineering](https://openai.com/index/harness-engineering/) / [Codex CLI](https://github.com/openai/codex), Apache-2.0 | UI와 검증 증거를 에이전트가 직접 읽고 수정하는 개발 피드백에 적합. Qwen과 회사 인증을 다른 런타임으로 교체하는 근거는 아님 | **개발 방법 적용**: 실제 JSX의 미리보기, 화면 치수/모션, 소스 상태 전이, 공유 UI 해시를 저장. Codex CLI를 제품 의존성으로 추가하지 않음 |
| [Pi](https://github.com/earendil-works/pi), MIT | 현 Node worker와 제공자 어댑터, 작은 Office 도구 호출에 이미 맞춰져 있음 | **기존 실제 런타임 유지**: `@earendil-works/pi-agent-core` 0.86.1. 새 agent 엔진을 병렬로 추가하지 않음 |
| [DeepAgents](https://github.com/langchain-ai/deepagents), [LangGraph](https://github.com/langchain-ai/langgraph) | 계획, 격리 분석, 체크포인트는 참고 가치가 있음. 범용 파일 저장이나 새 실행 그래프를 연결하려면 NASCA 보호/응답 유실/승인 복원을 별도로 설계해야 함 | **비교/기존 패턴 참고**: [브라우저 하네스 적용](BROWSER-HARNESS-ADOPTION-2026-09-23.md)과 [문맥 관리](CONTEXT-MANAGEMENT-2026-09-23.md). 이번에는 추가 설치/코드 이식 없음 |
| [Playwright](https://playwright.dev/docs/test-assertions), Apache-2.0 / React Testing Library, MIT / axe-core, MPL-2.0 | 현재 React 작업창의 화면과 접근성/동작 검증에 적합. Windows COM을 대신 검증하지 못함 | **기존 개발 라이브러리 실제 사용 확대**: 8개 상태를 360/480px로 렌더링. 검색 지우기, 접기/펼치기, 편집 취소/포커스, 명시적 결정과 미완료 표시를 검사 |
| [fast-check](https://github.com/dubzzz/fast-check), MIT | 고정 예시가 놓치는 상태 순서에 적합. Qwen 의미 정확도 평가와 별개 | **기존 4.10.2 실제 사용 확대**: seed 230926, 150개 생성 상태열에서 종료 후 실행 표시 금지, 완료 수/기존 receipt 불변 검증 |

별도 의존성을 늘리는 대신 이미 설치된 Pi, CX, Playwright, Testing Library, axe, fast-check를 실제 개선에 사용했다. p-retry 8.0.1과 MiniSearch 7.2.0은 기존 복구/문맥 용도로 유지한다. 저장된 토큰이나 브라우저 인증을 가져오지 않았다.

## 실행 상태의 구체적 수정

`activityView`는 저장된 이벤트를 변경하지 않는 UI 투영이다. run이 실패/취소/완료/미지원으로 종료되었는데 도구 이벤트가 `running` 또는 `waiting`이면 결과 receipt를 만들어내지 않고 “결과 미확인”으로 표시한다. 종료 시간이 없는 이벤트의 경과시간도 더 이상 증가시키지 않는다. 이미 `done`/`error`인 도구 결과와 계획의 확인된 완료 개수는 유지한다.

실패와 복구 대기는 실행 기록을 기본 펼치고, 사용자가 직접 접은 상태는 존중한다. 취소된 기록은 성공 체크 대신 중지 아이콘을 사용한다. 질문/승인 대기에서 회전 아이콘을 멈추는 기존 동작도 유지한다. 이것은 표시의 정합성 수정이며 worker 재시도 정책, 쓰기 재실행, 종료 후 자동 재개를 추가한 것이 아니다.

## 검증과 남은 범위

- 소스 검사 298개 통과. 상태 생성 검사 150회 포함.
- 실제 JSX에서 생성한 정적 Chrome 화면 8개 × 2개 폭에서 가로 넘침 없음. 양식 대화상자는 동일한 두 항목 기준 718px → 418px, 카드 높이 108px. 창 크기에 따라 내부 스크롤을 사용한다.
- 일반 모션은 단회 0.4초, reduced-motion의 목록 animation은 `none`. 소스 DOM axe 검사에서는 canvas 의존 색상 대비 검사를 제외했다. 자동 검사 0건이 모든 시각/접근성 품질을 보증하지 않는다.
- 참고 HTML은 수정/배포하지 않는다. 소스 미리보기의 회사 모델명/문서 데이터는 fixture이며 사내 호출 결과가 아니다.
- **제품 번들, native, 설치파일 빌드를 실행하지 않았다. 실제 Office 2016, WebView2, NASCA, 사내 인증, Qwen 문서 정확도와 성능은 미검증이다.**
- [검사 기록](../verification/office-tone-review.json), [미리보기 생성기](../verification/office-tone-preview.mjs), [상태 반영표](IMPROVEMENT-STATUS.md).
