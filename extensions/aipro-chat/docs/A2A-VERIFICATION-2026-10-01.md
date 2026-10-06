# A2A 동작 확인

2026-10-01. 검사 시작 시 브라우저 후보와 Desktop 경로는 A2A를 비활성화한 상태였다. 공통 패키지의 로컬 프로토콜 왕복은 동작하지만 실제 앱 간 협업이 활성화됐다는 뜻은 아니다. 내부 Pi 하위 분석은 A2A와 별도다.

검사 도중 공유 작업 폴더에서 별도 대화의 사용자 추가 요청에 따른 브라우저 연결 복구가 시작됐다. 03:49 KST 소스에 App/설정, background RPC와 패키징이 추가됐고 03:50 이후 dist도 바뀌었다. 아래 Chrome 비활성화 통과는 앞서 고정한 후보 `71b7d65b51176afeb6c03e795a255b5bd768f4aee7429c92c85e2f77113185fa` 범위이며 이 새 빌드의 결과로 재사용하지 않는다. 새 빌드를 별도 복사해 실제 연결 실패를 재현하고 서비스 워커 import를 수정했다. 수정한 background.js를 적용한 격리 후보에서 연결/가져오기/재조회/취소를 확인했다. 전체 Desktop 앱과의 E2E는 별도 확인이 필요하다.

## 범위와 결과

| 항목 | 확인 결과 | 판단 |
| --- | --- | --- |
| 공식 SDK 1.2.0과 A2A 1.0 JSON-RPC | 로컬 서버와 클라이언트의 요청, 조회, 수신, 취소 통과 | 검증한 프로토콜 흐름 정상 |
| 중복 요청과 재시작 | 메시지 ID 충돌 차단, 결과 재조회, 재시작한 서버에서 기존 작업/인증 조회 | 공통 패키지 검사 통과. 저장소 fixture이므로 실제 앱 재시작 검증과 구분 |
| 권한과 근거 | 수신자 격리, 잘못된 출처 버전 거부, 취소 뒤 결과 거부 | 합성 입력 범위 통과 |
| 직접 HTTP 오류 응답 | 표준 오류 코드 3종 누락 재현 후 수정 | 전 3종 실패 → 후 3종 통과 |
| 브라우저 기존 후보 연결 | 실제 Chrome 320/1100px 설정에 연결 UI 없음. 과거 session/RPC도 연결하지 않음 | 검사 시작 시 후보의 비활성 상태 확인. 새 복구 소스는 별도 |
| Desktop 제품 연결 | collaboration 호출은 a2a_not_enabled. 서버/전송 기록 생성 없음 | 비활성 상태 확인 |
| 복구 중인 Chrome 연결 | 동적 import로 연결 실패 재현 → 정적 import 후 실제 설정 화면의 연결/요청 가져오기/새로고침 유지/취소 조회 통과 | 실제 Chrome + 로컬 SDK 서버. Desktop 앱과 모델은 사용하지 않음 |
| Chrome 요청→누비 실행→결과 반환 | 기존 초안 보호, 명시적 전송, 실제 실행 ID 연결, 새로고침 유지, 호스트 답변만 반환, 인증 비노출/연결 해제까지 6개 검사 통과 | 실제 Chrome + SDK HTTP + 합성 모델. 실제 모델 정확도와 Desktop 앱 검증은 아님 |
| 실제 모델과 앱 간 업무 | 이번 검증에서 실행하지 않음 | 미측정 |

공통 패키지는 **중**으로 판단한다. 지원하는 정상 흐름과 오류 응답은 확인했지만 외부 에이전트 상호운용, 전체 표준 적합성, 실계정 업무 성공은 검증하지 않았다. 제품 연결은 복구 중이며 이 기록의 기존 후보 검사를 새 구현의 점수로 환산하지 않는다.

## 수정과 전후 근거

누비 client/SDK 직렬화 코드를 사용하지 않는 독립 fetch 검사에서 Agent Card와 SendMessage/GetTask/ListTasks/CancelTask, 중복 요청은 정상 동작했다. 반면 서버의 SDK 앞단 검사가 미지원 버전, 알 수 없는 메서드, 잘못된 JSON에 단순 `{error: string}`을 반환했다.

[A2A 1.0 명세의 오류 매핑과 JSON-RPC 오류 구조](https://a2a-protocol.org/v1.0.0/specification/#95-error-handling)에 맞춰 각각 `-32009`, `-32601`, `-32700`을 반환하고 요청 ID를 보존했다. 잘못된 요청 객체는 `-32600`, 허용되지 않은 tenant는 `-32602`로 처리한다. 두 엔드포인트 모두 적용한다. 인증과 제품 비활성화 상태는 유지한다.

기존 공식 SDK(Apache-2.0)를 유지하며 라이브러리를 추가하지 않았다. SDK 앞단에서 생긴 호환성 문제여서 해당 경계만 수정했다. 공통 README에도 실험 코드와 현재 제품 상태를 구분했다.

추가로 실제 Chrome 연결 실패 원인은 서비스 워커의 `import()`였다. [Chrome 공식 문서](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics#import_scripts)에서 미지원임을 확인하고 `public/background.js`의 수신기와 오류 상수 import를 정적으로 바꿨다. 읽지 않은 결과를 전송할 수 있는 상태로 만드는 우회는 하지 않았다. 요청을 가져온 뒤 `canSend=false`를 확인했다.

- [수정 전 직접 HTTP 결과](../verification/a2a-check-2026-10-01/wire-before.json)
- [수정 후 직접 HTTP 결과](../verification/a2a-check-2026-10-01/wire-result.json)
- [공통 패키지 13개 통과](../verification/a2a-check-2026-10-01/protocol-after.log)
- [Desktop 비활성화 2개 통과](../verification/a2a-check-2026-10-01/desktop.log)
- [실제 Chrome 비활성화 검사 통과](../verification/a2a-check-2026-10-01/browser.log)
- [새 Chrome 연결 실패 원인](../verification/a2a-check-2026-10-01/browser-worker-probe.json), [수정 후 실제 연결 결과](../verification/a2a-check-2026-10-01/browser-connect-result.json)
- [Chrome 실행과 결과 반환 최종 로그](../verification/a2a-check-2026-10-01/browser-roundtrip-final.log), [재현 스크립트](../verification/a2a-check-2026-10-01/browser-roundtrip-debug.mjs)
- 재현: `npm test --prefix packages/nubi-a2a`, `node extensions/aipro-chat/verification/a2a-check-2026-10-01/wire-check.mjs`.

## 남은 적용 순서

제품 A2A를 다시 도입할 때는 브라우저↔Desktop 수신, 같은 채팅에서 사용자 수락, 실제 도구 실행, 호스트 근거가 있는 결과 수신 순서로 연결한다. 일반 DataPart의 verification 필드는 송신자 선언이므로 수신자가 실제 근거를 확인하기 전 업무 성공으로 올리지 않는다. 통신 완료와 실제 사실/페이지 상태 정답을 따로 평가한다. Office 연결과 배포는 이번 범위에 포함하지 않는다.

Chrome 결과 반환 검사는 고정한 복구 빌드에 현재 background.js를 적용해 수행했다. 테스트 사본에만 사이트 읽기 권한을 미리 부여했고 모델 목록 선택, SSE 응답과 completion-intent 검토 형식을 합성 제공자 계약에 맞췄다. 잘못된 초기 fixture의 실패 로그도 보존했다. 초기 소스의 바인딩 변수 범위 오류는 동시 복구 작업에서 수정된 `userInput` 경로를 재검증했다. 소스 변경으로 거절된 같은 message ID를 다시 보내면 이전 거절 영수증을 유지한다. 이는 새 작업을 요청하라는 제품 계약이며 자동 재전송으로 해제하지 않는다. stale 거부는 공통 패키지 검사로, 정상 결과 반환은 Chrome의 별도 실행으로 확인했다.

새 빌드 전체 회귀, 실제 Desktop↔Chrome, 첨부/PDF/Office, 실계정 모델은 남은 검증이다. 앞서 별도로 진행한 하네스 H-07 전후 실측은 [1단계 결과](HARNESS-PHASE1-2026-10-01.md)에 기록했다. A2A 통신 성공으로 모델 품질 점수를 올리지 않는다.
