# 브라우저 실행기 재사용과 Desktop 보완

누비 브라우저 확장 `extensions/aipro-chat`의 현재 소스와 개선 기록을 기준으로 Desktop의 누락된 계획 지침과 검토 복구를 연결했다. 별도 프레임워크나 제공자 로그인 경로를 추가하지 않았다. Desktop의 파일, 명령과 앱 조작 승인은 기존 호스트가 계속 담당한다.

## 연결한 실행 흐름

| 단계 | 이미 재사용하던 계약 | 이번 보완 |
| --- | --- | --- |
| 요청 해석 | 임시 intent, 실제 지원 workflow/skill 조회, 기존 질문 폼 | 대체 계획 생성에 최초 요청과 후속 사용자 발화를 원문으로 별도 전달한다. 요약이나 과거 모델 답변은 요청을 대체하지 않는다. |
| 계획 | 공통 TaskPlan, 한 개의 진행 단계, 관찰 가능한 expected_outcome | 직접 update_plan 설명과 대체 계획 생성에 같은 PLANNING_OUTCOME_GUIDE를 사용한다. 모델이 없던 제약이나 페이지 사실을 만들지 않도록 같은 규칙을 적용한다. |
| 관찰과 실행 | Pi 순환, 현재 실행의 소스/Wiki 근거, 한 단계 실행 후 실제 결과, 격리된 읽기 전용 분석 | 기존 파일 해시, 미저장 편집 충돌, 승인, 실제 readback과 Computer Use 관찰 경계를 유지한다. |
| 문맥 관리 | 브라우저의 모델별 contextBudget와 공통 압축, 최초 요청과 최신 발화 보호 | 대체 계획과 최종 검토의 사용자 원문은 압축된 실행 history에서 가져오지 않는다. 한도를 넘으면 원문을 조용히 잘라내는 대신 기존 문맥 오류로 처리한다. |
| 독립 결과 검토 | 요구사항 ID, 실제 host receipt, 근거 ID, 절단/실패 근거 제외 | 정상 JSON은 기존 한 번의 검토로 처리한다. 형식 오류의 두 번째 시도에 공통 reviewEnvelope와 Desktop 전용 report_desktop_review 스키마를 사용한다. 동일한 요청, 후보 답변과 근거를 유지하며 결과 보고 도구를 실행 권한으로 취급하지 않는다. |
| 검토 오류 복구 | 공통 반복 실패 감지, 미확정 동작 재전송 금지, 사용자 판단 대기 | 공통 reviewCanRecover와 REVIEW_RECOVERY_GUIDANCE를 연결했다. 허용되는 검토 오류 뒤 현재 근거와 저장된 영수증을 읽는 복구를 같은 사용자 턴에 한 번만 수행한 후 다시 독립 검토한다. 반복 실패는 기존 paused 경로로 보낸다. |
| 기록과 정리 | 실제 도구/검토 시작과 종료, SQLite 실행 기록 | 검토 복구 기록은 taskId/runId에 연결한다. 대화 삭제 시 기존 검토와 복구 기록도 제거한다. |

## 검토 복구의 실행 제한

`runtime/review-recovery.mjs`는 Desktop의 명시적 허용 목록을 관리한다. 프로젝트/문서/메일/Wiki 읽기, 실제 상태 관찰과 검증, 이미 존재하는 실행 결과 조회, 계획 메타데이터와 사용자 질문만 허용한다. 이 단계는 검토 응답의 실패를 기존 동작의 실패로 간주하지 않는다.

모델에 노출하는 도구와 문맥 예산을 같은 허용 목록으로 제한하고, 호스트 operation 진입에서도 다시 검사한다. 수정안 준비, 설치/실행 명령 제안, 명령 복구, 앱 실행, 입력/클릭과 배치는 차단하며 차단 결과에 actionIssued=false를 반환한다. 도구 탐색과 스킬의 내용은 이 권한을 확대하지 못한다. 새 분석 위임과 별도 Wiki 에이전트 호출도 이 복구에서 열지 않는다.

복구는 새 실행이나 새 승인을 만들지 않는다. 취소, 미확정 실행과 기존 승인 경계는 유지한다. 다시 받은 검토의 revise는 기존 후속 흐름으로 처리하지만 검토 통과를 작업 성공, 테스트 통과나 파일 반영으로 바꾸지 않는다. 기존 네 번의 결과 검토 한계와 새 근거 없이 반복되는 검토의 대기 처리는 유지한다.

## 방법론과 선택 근거

적용 근거는 [브라우저 하네스 품질 BP](../../../docs/research/2026-10-01-nubi-browser-harness-quality-bp.md), [공통 실행 방법](../../../extensions/aipro-chat/docs/HARNESS-METHODS-2026-10-01.md), [일곱 단계 계약](../../../extensions/aipro-chat/docs/BROWSER-HARNESS-SEVEN-STAGES.md)과 현재 소스다. 한 단계씩 진행하고 다음 실행이 이어받을 상태를 남기는 방식은 [Anthropic의 장기 실행 하네스 설명](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)을 참고했다. 모델의 완료 선언과 독립적으로 확인한 환경 결과를 구분하는 기준은 [에이전트 평가 방법](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)을 참고했다.

Pi, MiniSearch, 기존 모델 전송/재시도와 공통 순수 함수를 유지해 의존성 추가와 정상 경로의 호출 증가를 피했다. 브라우저의 verify_page, 탭/문서 ID와 DOM 입력 계약을 Desktop 도구로 가장하지 않는다. 공유 runAgent의 브라우저 전용 harness 플래그를 켜는 대신 Desktop의 소스/명령/앱 영수증과 독립 결과 검토를 유지한다. A2A나 별도 에이전트 런타임을 추가하지 않는다.

## 확인 범위

소스 연결과 권한 경계를 검토했고 `npm run build:electron`이 완료됐다. 사용자 결정에 따라 테스트와 실모델 평가는 실행하지 않았다. 브라우저 확장의 과거 통과 수치나 방법론 도입을 Desktop의 품질 점수로 옮기지 않는다. Windows 설치판, 실계정 모델 성능, 실제 파일/앱 동작의 성공 여부는 이번 변경에서 측정하지 않았다.
