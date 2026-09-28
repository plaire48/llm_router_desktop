# Excel 2016 오류 복구: 정책, 채택 근거와 검증 범위

검토일: 2026-09-23. 기준 환경은 Windows Excel 2016, 기준 모델은 회사 카탈로그의 Qwen 3.8 27B이다. 실제 모델 ID와 사용자의 제공자 선택은 유지한다. 이번 변경은 소스 반영이며 새 설치 파일을 만들지 않았다.

## 판단 기준과 참고 사례

- [Microsoft의 일시적 오류 처리 지침](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults): 오류가 일시적인지 먼저 구분하고, 서버의 Retry-After와 지수 대기·지터를 고려한다. 동일 요청의 재시도가 문제를 해결하지 못하는 인증·설정 오류에는 반복 호출을 적용하지 않는다. 이 원칙을 Office의 HTTP 상태/원인 정책으로 구현했다.
- [AWS의 timeout/backoff/idempotency 설명](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): 호출 시간 초과는 서버에서 작업이 실행되지 않았다는 증거가 아니다. Office에서는 모델 추론, 읽기, 쓰기의 복구를 구분한다. 쓰기에는 기존 operationId/receipt/readback 경로를 유지한다.
- [LangGraph 오류 분류](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph): 일시적 실패, 모델이 고칠 오류, 사용자가 보완할 입력, 예상 밖의 오류를 각각 재시도·피드백·HITL·중단으로 분리하는 설계를 참고했다. 실행기를 LangGraph로 교체하지 않았다.
- [Microsoft Office 스레딩 지침](https://learn.microsoft.com/en-us/visualstudio/vsto/threading-support-in-office?view=visualstudio): Office COM은 STA에서 직렬 실행하며 바쁜 상태의 거절은 제한적으로 복구한다. [공식 HRESULT 목록](https://learn.microsoft.com/en-us/windows/win32/com/com-error-codes-3)의 RPC_E_CALL_REJECTED / RPC_E_SERVERCALL_RETRYLATER를 네이티브 **읽기 요청에 한해** excel_busy로 전달한다. 모든 COM 예외를 일시적 오류로 취급하지 않는다.
- [MCP 오류 결과 원칙](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md): 도구의 업무 실행 실패는 모델이 확인하고 수정할 수 있는 구조화된 결과여야 한다. 기존 Pi의 오류 결과와 Office의 복구 계획/실제 관찰을 유지한다. 새 MCP 서버나 도구 권한을 추가하지 않았다.

## 오픈소스 채택

| 후보 | 결정 | 근거와 비용 |
| --- | --- | --- |
| [p-retry 8.0.1](https://github.com/sindresorhus/p-retry), MIT | 실제 런타임 채택 | Node >=22이므로 번들 Node 22와 맞는다. 취소 신호와 영구 오류 중단, 재시도 훅을 사용한다. 정확한 버전/무결성을 lock에 고정하고 라이선스를 포함한다. 직접 의존성 1개, 전이 의존성 is-network-error 1개를 추가한다. |
| LangGraph | 오류 분류·HITL 방식 참고 | 현재 Pi 실행기와 Excel의 실행 기록을 대체하면 인증·취소·상태 복구 경로를 다시 검증해야 한다. 이번 문제는 기존 감독 계층에 적용 가능하므로 런타임은 추가하지 않는다. |
| 기존 Pi/Nubi | 계속 사용, 필요한 파서 보완 | 기존 모델/도구 계약을 유지한다. AI Pro·호환 API는 직접 fetch에 별도 재시도가 없고 ChatGPT SDK는 maxRetries:0이다. FabriX의 도구 JSON 형식 수정 1회는 별도의 제한된 프로토콜 복구이며, 최종 fabrix_tool_protocol은 다시 네트워크 재시도하지 않는다. |

p-retry를 기존 반복문 바깥에 추가하지 않고 **추론/허용된 읽기의 반복문 자체를 교체**했다. 라이브러리의 자동 대기는 0으로 두고, 하나의 Office 감독 계층이 지수 대기·지터·Retry-After·취소·진전 없는 3회 실패 HITL을 관리한다. 전체 작업 횟수는 고정하지 않지만, 진전 없는 실패 세 번 이후의 자동 진행은 금지한다. 재개는 같은 실행의 미완료 단계에서만 가능하다.

## 실제 오류별 동작

| 실패 | 복구 동작 | 완료/변경에 대한 제한 |
| --- | --- | --- |
| HTTP 408/425/429/500/502/503/504, 연결 리셋, 추론 시간 초과 | 취소 가능한 대기 후 같은 추론 재요청 | 같은 모델·원래 요구사항 유지. 모델 추론은 Excel 도구를 직접 실행하지 않는다. |
| Retry-After 초 또는 HTTP 날짜 | 서버 대기와 지수 대기 중 긴 값 사용 | HITL에서 재개를 눌러도 남은 서버 대기를 생략하지 않는다. 긴 대기는 30초 단위로 나눠 타이머 오버플로와 취소 지연을 방지한다. |
| 인증/권한, 모델 설정, TLS/인증서, DNS/접속 거절 | 원인 코드를 표시하고 중단 | 인증서 검증 해제, 다른 모델/인증으로 자동 우회하지 않는다. |
| HTTP 413 / context_overflow | 입력 범위를 줄이도록 안내 | 같은 과대 입력을 그대로 반복하지 않는다. 이 변경이 자동 의미 요약까지 구현한 것은 아니다. |
| SSE 종료 전 연결 단절 | 미완성 응답을 버리고 새 추론 | 잘린 도구 호출은 반환하지 않는다. 실패한 시도의 늦은 텍스트/진행 콜백이 다음 시도를 덮어쓰지 못한다. |
| JSON/수식/도구 인자 오류 | 기존 구조화 피드백으로 수정 요청 | 완성된 초안/관찰/사용자 답변 유지. HTML 로그인 페이지 등 잘못된 응답 형식은 별도 영구 오류다. |
| Excel 읽기 office_timeout / excel_busy | 허용 목록의 읽기만 순차 재요청 | 원래 통합문서·시트·범위 검증과 수정 전후 fingerprint 검사를 계속 적용한다. 새 도구는 기본적으로 재시도 불가다. |
| 셀 변경/저장의 응답 유실 | 실행 기록과 실제 결과 조회 | apply/restore/open/save/template 작업은 일반 재시도 함수에 넣을 수 없다. 기존 문서 복구에서 native가 not_started를 확인한 경우만 원래 작업 경로를 재개한다. |
| 병렬 분석 중 429 | 남은 대기열 중지, 다음 분석 직렬화, 대기 시간 부모에게 전달 | 성공한 분석 캐시를 보존한다. 하위 분석마다 독립적인 재시도 루프를 추가하지 않는다. |
| 화면↔worker 상태 조회/결과 전달 시간 초과 | 세 번 실패하면 재개/중지 UI | runStatus와 중복 처리 방지된 toolResult만 재전달한다. 이미 실행한 Excel 도구를 다시 실행하지 않는다. |
| 사용자 중지 | 모델 요청 취소, 대기 종료, 다음 요청 금지 | 중지를 오류로 표시하지 않는다. 이미 실행한 Excel 변경은 사라졌다고 주장하지 않는다. |

오류 복구 상태에는 원인 코드, HTTP 상태, 대기 시간, 시도 횟수만 전달한다. 인증 헤더, 원문 오류, 서버 본문, 엔드포인트, 잘린 응답은 복구 로그에 복사하지 않는다.

## 검사와 남은 경계

### 화면의 무한 재조회에 적용할 공개 사례

[Anthropic의 세션 이벤트 문서](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)는 표시용 delta와 확정 이벤트를 구분하며, 연결이 끊기면 다시 연결한 뒤 기록을 조회하도록 설명한다. 이는 Claude 내부 구현을 추측한 주장이 아니라 공개된 Managed Agents API의 계약이다. 누비에서는 같은 살아 있는 worker의 run ID로 전체 상태를 다시 받아 화면을 맞춘다. 다른 실행의 상태와 확인되지 않은 도구 결과 수신 응답은 거부한다. Excel 쓰기 자체를 다시 호출해서 화면을 복구하지 않는다.

[Anthropic 장기 작업 하네스](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)의 진행 기록/완료 기준/다음 미완료 작업 확인도 참고한다. 다만 해당 예제의 평문 진행 파일을 기업 Excel 문서에 그대로 적용하지 않는다. 현재는 실행 중 메모리에 보존된 초안·계획·실행 기록으로 재개하며, 프로세스 재시작 이후 복원은 별도 보호 저장소가 필요한 미구현 항목이다.

[TanStack Query의 재시도](https://tanstack.com/query/latest/docs/framework/react/guides/query-retries)와 [취소](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)는 UI 조회의 참고 사례다. 오류 원인에 따른 재시도, 간격 증가, 취소 신호를 사용하며 retry:true처럼 무한 재시도를 뜻하는 설정은 피한다. 이번에는 두 종류의 로컬 RPC를 위해 React Query 캐시/제공자를 추가하지 않고 작은 상태 조회 감독 함수를 적용했다. p-retry는 worker의 실제 의존성이고, TanStack Query와 Anthropic Managed Agents/SDK는 도입하지 않았다.

화면 상태는 `정상 조회 → 제한된 재조회 → 사용자 확인 대기 → 같은 실행 조회 재개`로 처리한다. 3회는 제품의 현재 운영값이며 보편적 정답이 아니다. 각 UI RPC의 35초 제한과 worker RPC의 30초 제한이 이미 있고, 화면은 연속 3회 조회 실패 뒤 자동 호출하지 않는다. HITL 응답 없이는 재개하지 않으며, 성공적으로 받아 온 상태가 이전에 확인한 작업 ID와 같아야 한다. 재시도 횟수는 완료 단계 수에 반영하지 않는다.

`tests/fault-policy.test.mjs`, `tests/worker-recovery.test.mjs`와 기존 에이전트/문서/다중 시트 검사로 실패를 주입한다. 서버 대기/취소, 영구 오류, 잘린 SSE 도구, 늦은 콜백, 읽기 복구, 쓰기 응답 유실 후 반복 조회, 조회 후 사용자 변경 감지, 전달 확인 유실과 HITL을 확인한다. 결과는 `verification/error-recovery.json`에 별도로 기록한다.

이 검사는 실제 서비스 정확도나 Excel COM 안정성 시험이 아니다. Windows Excel 2016, 회사 SSO, 라이브 Qwen, NASCA 자동 암복호화, 장시간 동작과 네이티브 HRESULT 처리는 연결 가능한 실제 환경에서 확인해야 한다. 빌드·설치 파일·네이티브 컴파일은 사용자의 최종 빌드 요청까지 실행하지 않는다.

프로세스가 죽은 뒤의 영속 실행 복원은 아직 지원하지 않는다. 최초 runStart 응답 유실은 클라이언트 requestId의 읽기 전용 runLookup으로 같은 살아 있는 실행을 찾는다. 시작 요청 자체를 재전송하지 않으며 worker_disconnected/run_expired는 중단한다. worker 상태/도구 결과 재전달의 안전성은 **같은 살아 있는 worker 실행** 안의 계약이다. NASCA 문서 내용을 평문 복구 로그로 저장하는 우회는 추가하지 않는다.
