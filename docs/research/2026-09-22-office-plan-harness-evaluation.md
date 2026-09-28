# 누비 Office: 계획·단계 실행·결과 평가

검토일 2026-09-22. 구현은 `packages/nubi-office` 0.3.0. 사용자가 요구한 흐름은 **계획을 채팅에 먼저 표시 → 각 단계에 맞는 도구 호출 → 실제 결과 확인 → 단계 AI 재검토 → 다음 단계 → 원래 요청 전체 검토**다.

## 확인한 결함과 변경

기존 Office 코드는 Pi 도구 루프를 사용했지만, `verify_selection` 호출 사실을 완료 근거로 삼았다. A1을 42로 바꾸라는 요청에서 실제 관찰이 1인 상황을 넣어도 `done`이 나오는 감독 결함을 재현했다. 실제 모델의 오답률을 측정한 결과는 아니다. 재현 입력과 이전 소스 해시는 패키지의 `verification/harness-baseline.json`에 있다.

새 감독기는 요청을 완료 조건과 3~6단계 계획으로 구조화한다. UI가 계획을 표시한 뒤 실행을 시작하며 별도 승인 버튼은 요구하지 않는다. 현재 단계에 속하지 않는 변경은 거부한다. 값·수식·서식은 실제 readback과 비교하고, 편집 단계의 조건이 충족되면 별도 문맥의 AI가 결과를 검토한 뒤 다음 단계로 넘어간다. 단계 표시를 LLM의 자기 선언으로 갱신하는 도구는 없다.

수정 제안 사전 검토, 단계 결과 검토, 최종 목표 검토를 구분한다. 누락된 조건은 최대 두 번 추가 보완하고, 전체 5분·모델 호출 24회·도구 실행 24회로 제한한다. 일부 쓰기·불확실한 결과·사용자 동시 수정은 재실행하지 않는다. 전체 범위 검증은 요청하지 않은 상수·수식·서식 변경과 새 계산 오류도 검사한다. 복구는 기존 충돌 검사와 변경 이력을 따른다.

UI는 사용자 요청 아래에 계획 카드를 표시한다. `2/4 완료`와 단계별 대기·진행 중·완료·답변 대기·확인 필요·중지를 보여준다. 현재 단계만 기본으로 펼치고, 단계 아래에 도구/검토 내역을 묶는다. 검토 전 작성된 모델의 완료 문장은 최종 답변으로 노출하지 않는다.

## 오픈소스와 BP 적용 판단

| 근거 | 가져온 내용 | 반영 형태·범위 |
|---|---|---|
| [Deep Agents task planning](https://docs.langchain.com/oss/javascript/deepagents/overview), [소스](https://github.com/langchain-ai/deepagentsjs), [MIT](https://github.com/langchain-ai/deepagentsjs/blob/main/LICENSE) | 구조화한 할 일 목록과 단계 상태를 사용자에게 노출 | BP 적용. 실행기는 기존 Pi를 유지하고 Office 단계 상태를 별도 구현. Deep Agents 런타임을 중복 설치하지 않음. |
| [LangGraph plan-and-execute](https://www.langchain.com/blog/planning-agents) | 계획과 실행 분리, 결과를 반영한 다음 작업 선택 | BP 적용. 첫 미완료 단계만 수정하고 도구 결과에 현재 계획 상태를 돌려줌. 계획 밖으로 임의 확장하지 않음. |
| [LangGraph evaluator-optimizer](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents) | 실행 결과 평가 후 제한된 보완 반복 | BP 적용. 결정적 셀 검사에 통과해야 AI 검토로 진행하며 검토가 수치/수식 불일치를 덮어쓰지 못함. |
| [Microsoft UFO](https://github.com/microsoft/UFO) (MIT) | Windows 앱의 실제 상태를 관찰하고 API/GUI 동작 결과를 확인 | BP 참고. 기존 Excel COM 관찰을 강화. UFO 런타임·GUI 자동화는 포함하지 않음. |
| [Promptfoo custom provider](https://www.promptfoo.dev/docs/providers/custom-api/), [MIT](https://raw.githubusercontent.com/promptfoo/promptfoo/main/LICENSE) | 동일 사례의 제공자별 반복 평가, 독립 assertion | custom provider 어댑터와 설정 작성. 실제 Windows 실행기에 연결. Promptfoo 본체 실측은 미실행. |
| [SpreadsheetBench-2](https://github.com/RUCKBReasoning/SpreadsheetBench-2/blob/main/README.md) | 결과 파일 재계산, 정답/산출물 대조 | 평가 방법 참고. 외부 데이터/코드는 포함하지 않음. 해당 데이터/코드의 배포 조건은 이 검토에서 확정하지 않음. 자체 업무 사례 6개 작성. |
| 누비 `agent-runtime.js`, `goal-review.js` | Pi 실행기, 엄격한 증거 ID·상태 검증 | 공유 소스를 실제 번들에 포함. 브라우저 전용 `verify_page` 전제를 Office에 강제로 적용하지 않고 Excel 감독기를 분리. |

이 표의 선택은 현재 코드와 설치 요구를 기준으로 한 구현 판단이다. 프레임워크의 존재가 Excel 2016 호환성이나 모델 정확도의 증거는 아니다.

## 검증 경계와 남은 작업

- 제어 회귀 검사: 값 불일치의 거짓 완료 차단, 단계 순서 위반 차단, 계획 표시 전 실행 차단, 단계 검토 거절 시 정지, 누락 서식 보완, 수식 보존, 수정 충돌, 허위 저장 주장 보완.
- 실제 프런트엔드·Pi·C# 엔진 통합: 계획 카드, 단계별 진행, 변경/복구, 질문 후 이어가기. 이 경로의 Excel COM과 LLM 응답은 합성이다.
- 실제 XLSX 12개: LibreOffice로 정답 파일 재계산·재열기. 모델 수행 결과가 아니다.
- 실제 Windows 평가 실행기: 생산 코드의 ExcelPort/WorkbookEngine을 사용하는 .NET Framework STA 실행기를 교차 컴파일. 저장 후 재열기 및 변경하면 안 되는 셀의 독립 검사 포함. 현재 연결 가능한 Windows·모델이 없어 실측 정확도는 미측정.
- 회사 SSO, Windows Excel 2016 32/64비트, VSTO 설치·서명 배포, 기업 양식별 업무 정확도는 아직 검증하지 못함.

기업 양식 카탈로그·필드 매핑·반복 테이블·양식 버전은 [별도 명세](../superpowers/specs/2026-09-22-nubi-office-template-workflows.md) 상태다. 0.3.0의 단계 실행기가 해당 기능 전부를 구현한 것은 아니다. 이후 실제 사례가 확보되면 모델별 실패를 요구 분석·실행·검증·환경 문제로 나누고, 변경 전후를 같은 입력 및 보류 사례로 비교한다.
