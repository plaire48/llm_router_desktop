# Excel 2016 / Qwen 3.8 27B harness

기준일: 2026-09-23 · 구현: 0.8.2 · 기준 모델: 회사 모델 목록의 Qwen 3.8 27B.

이번 다중 시트 도구·Anthropic 하네스/하위 분석·문맥 관리 적용은 [Excel 2016 에이전트 확장](EXCEL-2016-AGENT.md)에 기록했다. 새 소스와 실제 Windows/모델 검증을 구분하며, COM 도구는 순차 실행하고 독립된 읽기 전용 모델 분석만 제한적으로 병렬화한다.

사용자 요구사항을 이해하고 Excel 2016에서 완성된 문서를 작성하는 것이 목표다. 계획이나 도구 호출 성공만으로 완료하지 않는다. Qwen을 기준으로 오류 사례를 평가하며, 개선이 필요하면 BP와 오픈소스의 실제 적용성을 검토한다. 다른 누비 제공자와 모델은 계속 선택할 수 있다.

## 실행 계약

1. 원래 요구사항과 이전 답변을 분석한다. 모호한 내용은 근거 있는 2~4개 선택지 또는 주관식 폼으로 확인한다. 사용자가 자유롭게 답할 수 있으며, 누락된 업무 값을 만들어 넣지 않는다.
2. 채팅에 단계별 계획을 먼저 표시한다. 확인된 단계만 완료 표시하고 실제 도구 시작·결과·오류·보완을 기록한다.
3. Qwen 기준으로 시트당 작은 도구 입력을 사용한다. 셀은 최대 24개씩 초안에 반영하며 큰 응답은 12개씩 나눈다. 8번의 모델 턴마다 필요하면 초안·현재 관찰·완료한 단계를 유지하고 문맥을 재구성한다. 전체 목표의 실행 횟수 제한이 아니다.
4. Excel 2016의 값·자료형·수식·양식과 실제 계산 결과를 대조한다. 원래 요구사항에 대한 별도 모델 검토도 수행한다. 같은 모델을 별도 문맥에서 호출하므로 독립 모델 평가와 같지는 않다.
5. 기존 셀을 변경할 때 대상·변경 값/수식/서식·사전 검토를 표시하고 HITL을 받는다. 새 문서는 초안 작성과 검토 이후 최종 저장에 HITL을 받는다. 승인 이후에도 실제 셀 fingerprint를 확인하며 대상이 바뀌면 승인으로 덮어쓰지 않는다.
6. 결과가 부족하면 해당 시트를 보완하고 재검증한다. 전체 호출 수나 전체 시간만으로 목표를 중단하지 않는다. 한 번의 모델 응답은 120초 제한 후 다시 호출한다. 일시적 연결 오류는 지수 지연과 jitter로 재호출하고 지연은 최대 30초다. 실제 초안·셀 상태·완료 단계의 진전 없이 3회 실패하면 같은 실행을 보존하고 HITL에서 원인과 재시도/중지를 표시한다. 대기만 끝난 재요청을 완료로 표시하지 않는다. 사용자 중지는 즉시 존중한다.
7. 저장/편집 응답이 유실되면 실행 기록과 실제 문서를 읽어 성공 여부를 복원한다. 완료한 쓰기를 다시 보내지 않는다. 확인 가능한 셀 부분 변경은 충돌 방지 복원 후 재계획한다. 확인 불가능한 쓰기나 외부 사용자 변경은 성공으로 처리하지 않는다.

인증 거부·미지원 기능·필수 사실 누락·앱 종료·알 수 없는 native 장애를 모델이 해결했다고 주장하지 않는다. 실행 중 초안과 단계는 worker 메모리에 유지된다. Excel/worker 재시작 후 복구하는 디스크 체크포인트는 아직 없다. 끝나지 않는 연결 장애나 문서 미확정 상태는 원인을 표시하고 HITL 확인을 기다린다.

## 0.8.2 오류 사례에서 바꾼 점

- `R1`처럼 대문자 요구사항 ID가 정상 계획인데도 거절되어 계획 표시 전에 재시도만 반복되는 결함을 재현하고 수정했다. 단일 완전한 JSON을 감싼 Markdown은 허용하고, 잘린 JSON이나 여러 후보는 임의 복구하지 않는다. 검증 오류는 필드 설명과 함께 모델에 돌려준다.
- 모델 응답의 도구 배치를 한 번에 하나로 제한한다. 나머지는 실행하지 않으며 실제 결과를 포함한 다음 모델 호출에서 다시 결정한다. 도구 호출 없이 문서 완성을 주장하면 같은 모델에 한 개의 JSON 도구 요청을 사용하는 방식으로 전환한다. Pi의 인자 검사와 문서 검증은 그대로 적용한다.
- 회사 인증서 설치를 추가 사용자 절차로 만들지 않는다. 번들 Node의 `--use-system-ca`로 Windows의 기존 신뢰를 사용한다. 인증서 검증 우회는 상속하지 않는다. 인증서·DNS·접속 거부·시간 초과·서버 응답 형식 오류를 구분하고 영구적인 연결 오류를 무한 재시도하지 않는다. [Node의 회사망 연결 안내](https://nodejs.org/en/learn/http/enterprise-network-configuration)를 참고했다.
- [LangGraph 오류 처리 분류](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)의 일시적 장애/모델 수정/사용자 확인 구분을 기존 Pi 감독기에 적용했다. LangGraph 런타임을 추가한 것은 아니다.

`tests/connection-recovery.test.mjs`와 실제 제품 UI 브라우저 검사는 위 경로와 재시도 대기·명시적 재개·취소를 확인한다. 응답을 제어한 오류 재현이며 실제 Qwen 정확도나 사용자 PC의 정확한 장애 원인 증거가 아니다.

## 검토한 오픈소스와 반영 방식

| 근거 | 참고한 BP | 적용 |
|---|---|---|
| [Deep Agents](https://github.com/langchain-ai/deepagents) | 계획·도구·문맥 관리를 포함한 agent harness | 기존 Pi 위 Office 감독기에서 계획과 검증을 관리. 중복 실행 엔진을 추가하지 않음 |
| [LangGraph: Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) | 일시적 장애, 모델이 고칠 수 있는 오류, 사용자 입력이 필요한 상태를 구분 | 네트워크 재호출, 형식 오류의 모델 피드백, 질문/HITL을 분리 |
| [LangGraph: Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | 단계 상태와 중단·재개 | 작업 중 초안·완료 단계 유지에 반영. 디스크 재시작 복구는 미구현으로 명시 |
| [Microsoft UFO AppAgent states](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/app_agent/state.md) | 실행·재계획·사용자 질문·확인 상태 구분 | Excel 전용 도구와 감독기, 요구사항 폼, 저장/편집 HITL. UFO 런타임은 설치하지 않음 |
| [Tenacity](https://github.com/jd/tenacity) | 오류 분류, 지수 지연과 jitter, 취소 가능한 재시도 | Node supervisor에 원칙 적용. Python 의존성을 추가하지 않음 |
| 기존 누비 Pi runtime / QuestionForm | 실제 tool loop와 질문 UI | 직접 재사용. 새 Office Excel 도구·승인 카드 연결 |

참고 사례의 성능이 누비 Office의 성능을 입증하지는 않는다. Qwen 3.8 27B는 사용자가 지정한 사내 카탈로그 기준이며 공개 모델의 context length, benchmark, JSON 모드 지원을 추정하지 않는다. API가 반환한 원래 모델 ID로 호출하고 사용자 선택과 전체 모델 목록을 유지한다.

## 검증 기준

실제 코드의 오류 주입 검사: 연속 5회 실패 후 재개, 장문 분할/문맥 재구성, 5회 요구사항 보완, 잘못된 근거 거절, 저장 응답 유실 재조회, 사용자 중지, HITL 거절·대기, 선택형/주관식 질문, 미확정 쓰기 중복 방지. 이는 실모델 정확도 점수가 아니다.

실제 파일 예시는 입력 명세에서 XLSX를 만들고 LibreOffice로 계산한 파일이다. Windows Excel 2016 설치·COM·회사 SSO·Qwen 실제 문서 품질은 현재 연결이 없어 미검증이다. 실측에서 요구사항 충족률, 수식/값 정확도, 양식 보존, 자동 복구율, 불필요한 HITL, 사용자가 수정한 내용을 보존하는지를 별도로 평가해야 한다.

Existing-template selection and implementation: [TEMPLATE-FILLING.md](TEMPLATE-FILLING.md). References xlsx-template, JSON Forms and Anthropic context engineering; no new runtime dependency.

## 문맥·작성·수식 품질 개선

Microsoft Excel Agent의 단계적 문맥 조회와 검증 중심 생성, Anthropic의 도구 응답 크기 관리, SheetCopilot의 실행 후 피드백을 비교해 기존 Pi 감독기에 적용했습니다. 실제 채택한 수식 토크나이저와 채택하지 않은 실행 엔진, 유지보수·라이선스·검증 범위는 [AGENT-QUALITY-BP.md](AGENT-QUALITY-BP.md)에 기록했습니다.
