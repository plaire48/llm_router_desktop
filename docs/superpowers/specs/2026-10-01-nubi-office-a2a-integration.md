# 누비 Office 2016 A2A 통합

2026-10-01 사용자 요청: Office 2016 확장에도 브라우저와 같은 A2A 협업을 적용한다. Excel, Word, PowerPoint를 필수 구현 범위에 포함한다. 이 문서는 확인된 기존 연결과 추가 구현 계약이다. 구현 코드와 Windows 설치 파일은 이번 설계 작업에서 변경하지 않았다.

## 현재 확인한 범위

| 범위 | 현재 소스와 검사 | 남은 검증 |
| --- | --- | --- |
| 연결 화면 | Office App이 공통 A2AInbox를 직접 재사용한다. 더 보기 → 누비 작업 연결 | 실제 Office 2016 WebView2 |
| native 연결 | NubiPane의 두 RPC 경로에서 a2a를 worker로 전달한다 | Windows VSTO 실행 |
| 요청 가져오기 | Excel/Word/PPT worker가 공통 receiver를 사용한다. 빈 초안에만 가져오고 모델이나 COM을 시작하지 않는다 | 실제 앱 왕복 |
| 답변 회신 | 명시적으로 시작한 실행의 실제 답변만 반환한다. 호출자가 보낸 답변은 무시한다 | Word/PPT 실행 완료 회신과 실계정 모델 |
| 작업 교환 | nubi-task-v1에는 browser/desktop만 등록되어 있고 Office 인증은 거절한다 | Office 수락/진행/질문/실패/취소/완료 연결 |
| 메일 첨부 분석 | 인증된 첨부 전달과 앱별 native 분석은 기존 필수 구현 범위다 | 원본 바이트 전송, COM 읽기, coverage, Workspace 수신 |

이번 재검사: `node --test tests/a2a.test.mjs`를 packages/nubi-office에서 실행해 **4/4 통과**, `npm test --prefix packages/nubi-a2a`로 **13/13 통과**. 실제 SDK HTTP와 합성 Office 실행기 검사다. 공통 검사에는 Office 작업 교환 거절이 포함되므로 13개 통과를 Office 전체 협업 완료로 표시하지 않는다. 기존 답변 artifact의 verification은 not_run이다. Windows COM, NASCA, 실모델, 설치된 배포판은 검사하지 않았다.

## 사용 흐름과 역할

Workspace 조정 서버 → 연결한 Office 수신자 → 기존 누비 채팅에서 요청 확인/수락 → 해당 앱의 실행기 → 근거를 포함한 결과 → Workspace 원 요청.

- 사용자는 작업 모드를 고르지 않는다. native 진입점의 Excel/Word/PPT 정체성과 실제 지원 기능으로 요청을 분류한다.
- Office는 별도 Node, Python, 라우터, Chrome 확장 설치를 요구하지 않는다. 기존 숨겨진 worker와 공통 A2A SDK를 재사용한다.
- 일반 요청은 수락 전 실행하지 않는다. 메일 반복 분석은 이미 승인한 첨부 읽기 범위 안에서만 처리한다. 새 대상/모델 목적지/범위는 확인한다.
- 기존 채팅 초안, 질문, 답변과 실행을 보존한다. 수신 요청은 출처가 표시된 외부 작업이며 문서 본문을 새 사용자 지시나 승인으로 만들지 않는다.
- A2A 요청 수락은 문서 반영/저장 승인이 아니다. 기존 HITL과 native readback을 유지한다.

## 구현 계약

1. **호스트별 수신 권한**: 공통 tasks/Agent Card/인증/목록 격리에 Office를 추가한다. 연결 때 native가 고정한 host를 호스트 검증으로 바인딩하고 사용자 payload로 바꾸지 못하게 한다. 하나의 office 역할을 유지할 경우 반드시 서버가 검증한 host별 capability와 수신자 연결 ID로 Excel/Word/PPT를 구분한다. 각 앱의 동시 연결이 다른 앱 인증을 해제하지 않도록 초대/토큰의 범위를 정한다. 기존 초안 계약은 유지한다.
2. **실행 바인딩**: taskId/contextId/messageId/request fingerprint와 conversationId/runId/host/model을 호스트가 보관한다. 작업 상태는 worker의 실제 실행/질문/승인/실패/취소/완료에 연결한다. 입력 대기 상태와 같은 실행의 답변 재개를 공통 계약에 추가한다. 모델의 완료 선언은 상태 전이가 아니다. 완료 응답 유실은 GetTask와 호스트 영수증으로 대조하고 새 runStart로 대체하지 않는다.
3. **취소와 복구**: nubi-task-v1 CancelTask는 해당 바인딩 실행의 중지로 연결한다. 기존 초안 전달의 취소/연결 해제와 로컬 작업 중지는 의미가 다르므로 UI에서 구분한다. 완료한 쓰기를 취소로 되돌렸다고 표시하지 않는다. 부분/미확정 쓰기는 영수증과 실제 상태를 조회하고 자동 재전송하지 않는다. worker 메모리 바인딩은 재시작 뒤 자동 복구를 주장하지 않는다.
4. **첨부 전달과 열기**: 기존 MAIL-DOCUMENT-COLLABORATION의 attachmentId/sourceHash/MIME/크기/recipient/taskId/만료/최대 바이트에 묶인 인증 handle을 사용한다. 모델이 만든 경로나 URL을 열지 않는다. 사용자가 편집 중인 문서와 별도로 바인딩하고 Office가 원본을 열며 매크로 실행과 외부 링크 갱신을 막는다. NASCA 원본을 외부 ZIP/Python 경로로 열거나 재저장하지 않는다.
5. **앱별 읽기**: Excel은 전체 시트 목록과 실제 셀 값/수식/표시 값, Word는 지원 문단/표/story, PPT는 슬라이드/도형/노트를 기존 native 읽기 도구로 순차 관찰한다. 지원하지 않는 개체, 읽지 않은 범위, 부분 결과는 명시한다. 현재 선택만 읽고 전체 문서 분석으로 표시하지 않는다.
6. **결과 근거**: document-analysis-v1 Artifact에 원 요청/첨부/출처 해시, 호스트와 reader 버전, 모델, 총/읽음/미읽음 범위, 원문 인용, native 영수증, 미지원 항목을 포함한다. 관찰 사실/문서의 주장/모델 추론과 직접 관계/추정 관계를 구분한다. host_checked는 실제 호스트 검사 범위만 표시하며 전체 내용 정답이나 저장 성공을 뜻하지 않는다. 인증값과 불필요한 절대 경로는 전송하지 않는다.
7. **Workspace 수신**: 원본 저장 해시, native 원본 바인딩 영수증과 읽기 전후 fingerprint를 검사한다. 암호화 바이트 해시와 열린 문서 fingerprint를 같은 값으로 비교하지 않는다. 변경된 출처는 격리하며 personal Wiki의 사용자 편집과 버전을 보존한다. 호스트 오프라인은 waiting_for_host로 남기고 수집을 계속한다.

## 완료 조건

- Excel/Word/PPT 각각 실제 Workspace 요청을 수락하고 기존 실행기로 처리해 원 요청에 결과가 돌아온다.
- 서로 다른 Office 앱의 연결/목록/취소/결과가 섞이지 않는다. unsupported skill은 실행 전에 거절한다.
- 수락 전 모델/COM 실행 0회, 반영/저장 승인 전 쓰기 0회. 가져오기 시 기존 초안과 질문을 보존한다.
- 입력 대기/부분/실패/취소를 같은 task/run에 전달하고 승인과 질문 답변을 일회 사용한다.
- 중복 메시지, 응답 유실, 출처 변경, 연결 만료/재연결, worker 재시작, 오프라인에서 중복 실행과 맹목 쓰기 재전송 0회.
- 실제 Windows Office 2016에서 첨부를 읽은 범위를 독립 비교하고 기존 열린 문서/편집 상태를 보존한다. NASCA와 실제 Qwen 검사는 합성 검사와 별도 기록한다.
- 일반 답변 전달, 실제 문서 분석, 파일 저장과 전체 요구사항 충족을 별개로 판정한다.

## 방법 선택과 구현 전달

[A2A 1.0 공식 명세](https://a2a-protocol.org/v1.0.0/specification/)의 Task/Artifact, 입력 대기, 인증 및 파일 교환 계약과 설치된 @a2a-js/sdk 1.2.0 사용 소스를 확인했다. 기존 SDK(Apache-2.0), 공통 receiver/A2AInbox와 native 읽기 실행기가 있어 재사용이 적합하다. 별도 유사 프로토콜, LAN 자동 발견, 새로운 외부 런타임은 현재 목표에 추가 효과가 없으므로 채택하지 않는다. 사용자에게 필요한 차이는 작업 상태와 문서 근거이며 별도 Office 전용 UI 복사본은 만들지 않는다.

구현자는 packages/nubi-a2a/{tasks,task-agent,server,client,receiver}.mjs, packages/nubi-office/{worker/main.mjs,src/App.jsx,native/Nubi.Office.Host/NubiPane.cs}와 Workspace 송신 경로를 먼저 확인한다. 기존 초안 연결을 중복 작성하지 않고 위 1→2→3을 작은 SDK/worker 왕복으로 검증한 뒤 4→5→6→7을 연결한다. 기존 Office 거절 테스트는 실제 host 바인딩/격리 왕복 검사로 교체하며 기대값 변경만으로 활성화 성공을 만들지 않는다. UI 변경 때 공통 토큰과 디자인 검사/화면 검토를 유지한다. native/installer 빌드와 배포 파일 생성은 별도의 사용자 최종 빌드 요청 전에는 실행하지 않는다.

관련 설계: [메일 첨부 협업](../../../packages/nubi-desktop/docs/MAIL-DOCUMENT-COLLABORATION.md), [공통 A2A](../../../packages/nubi-a2a/README.md), [브라우저 A2A](2026-10-01-nubi-browser-a2a-integration.md).
