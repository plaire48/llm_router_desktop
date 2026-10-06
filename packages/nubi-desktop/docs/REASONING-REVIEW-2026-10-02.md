# 추론 설정 전달 점검

2026-10-02 사용자 요청에 따라 UI 선택 → provider 상태 → 최종 SDK payload 경로를 확인했다. 테스트 모음과 별도 실모델 시험은 실행하지 않았다.

| 제공자 | 화면 단계 | 요청 계약 |
|---|---|---|
| AI Pro | Low, Medium, Extra high | Low/Medium은 reasoning_effort: low/medium, Extra high는 해당 필드 생략 |
| ChatGPT | 계정 모델이 지원하는 단계 | Responses reasoning.effort. Light는 low, Ultra는 max. 계정 카탈로그의 허용 단계만 선택 |
| FabriX | 표시하지 않음 | 추론 옵션을 보내지 않음 |

ChatGPT의 reasoning.summary는 기존 Pi 공개 onPayload 훅에서 제거한다. 추론 강도와 요약 표시 요청을 혼동하지 않는다. Pi 기본 모델 템플릿의 minimal/off alias가 계정 카탈로그와 다를 수 있어, 계정이 명시적으로 허용한 단계는 payload에서 그대로 유지하도록 보완했다. 번들 의존성은 수정하지 않았다.

실행 중인 호스트에서 읽기 전용으로 확인한 상태는 ChatGPT gpt-5.6-luna, low, 허용 단계 low/medium/high/xhigh/max이며 최근 completionDiagnostic은 HTTP 200이었다. 이 이전 기록에는 전송 effort가 없으므로 최근 응답의 서버 적용 강도를 입증하지 않는다. AI Pro/FabriX의 실계정 응답과 수정 이후 wire 전송은 아직 별도 확인하지 않았다.

추론 UI는 파란 단계명, 점과 드래그 가능한 슬라이더를 유지한다. X 추가 후 헤더가 두 줄로 흐르던 원인을 같은 행의 세 열로 정리했다. 성공 토스트와 번개, 모델명, 아래 단계 설명은 추가하지 않는다.

npm run build:electron은 완료했고 소유한 Electron 실행판을 재시작했다. 테스트 모음은 실행하지 않았다. 재시작으로 메모리 인증은 해제되므로 다음 실계정 요청은 사용자의 재연결 후 진행한다.
