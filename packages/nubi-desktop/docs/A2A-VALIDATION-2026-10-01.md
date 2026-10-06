# A2A 현재 상태와 검증

Workspace/Chrome 작업 교환과 Office 초안 수신을 활성화했다. **실제 로컬 SDK HTTP와 앱 실행 바인딩은 검사했으며, 메일 첨부 전문 분석은 아직 미구현이다.** 공식 프로토콜 적합성 인증이나 실서비스 성공을 주장하지 않는다.

| 검사 | 현재 결과 | 증거 범위 |
| --- | --- | --- |
| 공통 A2A | 13/13 | Task/Artifact, 수신자 격리, 단일 사용 초대, 출처 변경, 중복/미확정 복구, 취소/거절과 포트 재연결 |
| Desktop 실제 호스트 | 8/8 | 물리 SQLite/SDK, 동시 초기화 단일 listener, 수락 중복 방지, 새 읽기 전용 대화/명시적 시작, 현재 source와 검토한 실제 답변만 회신, 취소한 작업 재개 차단 |
| Workspace/Chrome | 4/4 | 실제 확장 UI와 Desktop ProjectService/SDK 왕복. 합성 모델의 정상 Pi 조회 실행. 모델 인증과 실제 기업 업무 정확도는 별도 |
| Desktop 연결 화면 | 4/4 | 공통 React/CX와 실제 SQLite/SDK, 360px/1100px, 현재 초안 수락 뒤 검토 대기, 실제 Nubi 이미지/스타일 확인. 2026-10-01 연결 주소와 받은 요청을 머리글 ‘에이전트 연결’로 옮긴 뒤 다시 통과(`verification/a2a-header-2026-10-01/`) |
| VS Code 주 제품 | 14/14 | 실제 VS Code 1.140 확장 호스트, 웹뷰와 내장 Node 실행기. 머리글에서 연결, 받은 요청 수 표시와 수락, 실제 호스트로 보낸 작업의 출처 있는 결과 수신. 이전에는 호스트 허용 목록과 웹뷰 빌드 검사가 A2A를 막아 주 제품에서 동작하지 않았음(`packages/nubi-vscode/verification/a2a-2026-10-01/`). 같은 검사를 현재 원본에서 내보낸 포크 입력(763개 파일)으로 빌드해서도 통과(`fork-input/`). Windows와 실계정 모델은 미검증 |
| Workspace 에이전트 위임 | 5/5 + 결과 기록 1 | `delegate_to_browser`는 브라우저 연결 중에만, 받은 요청에는 주지 않음. 맡긴 실행은 검토 없이 ‘브라우저 응답 대기’로 끝나고 같은 실행의 다른 도구는 막음. 결과와 거절은 같은 대화를 한 번 이어 실행(실행 기록 `peerTasks`, 출처 유지), 사용자가 취소하면 모델 호출 없이 대기만 해제, 대기 중 새 질문은 정상 실행. 합성 모델(`tests/agent-delegation.test.mjs`, `tests/agent-connections.test.mjs`) |
| Workspace 사실 전달 | 4/4 | 브라우저 세션의 실제 확장 왕복(4/4, `extensions/aipro-chat/verification/a2a-tasks-2026-10-01/roundtrip.json`) 뒤 제안을 반영. 받은 요청의 실행에만 `report_source_facts`를 주고, 사실마다 파일 경로와 원문 인용을 받아 그 실행에서 읽은 내용에 인용이 있을 때만 확인으로 본다. 전달 때 파일 해시를 붙이고 그 사이 바뀐 파일은 보내지 않는다. 최종 검토 통과와 모든 사실 확인일 때만 `host_checked`. 공용 실행기가 `report_facts`를 웹 페이지 기준으로 처리해 이름을 따로 둠. 합성 모델(`tests/peer-facts.test.mjs`). 브라우저 세션이 실제 Chrome 확장으로 다시 왕복해 4/4 통과(10:45): 브라우저가 받은 결과에 경로, 인용, 해시가 있는 사실과 `host_checked`가 들어 있었고, 허브는 47821이 쓰이고 있어 47822에서 열렸다(`roundtrip.json`의 `sourceFactVerification`) |
| 실제 Theia 작업 화면 | 43/43 | 기존 수정/승인/질문/복구/화면 재진입 회귀와 A2A 명시적 전송 버튼. 실계정 모델은 사용하지 않음 |
| Office 소스 receiver | 4/4 | Excel/Word/PPT 메모리 연결, 기존 초안 보존, 임의 답변/실행 ID 차단, 모의 Excel Pi 실행과 승인/readback/최종 검토 뒤 회신 |
| Office 회귀와 디자인 | 16/16, preview/design 통과 | 기존 intent/공통 UI, 실제 공유 모달 320/380/1100px. Windows native 빌드/COM/NASCA는 미검증 |
| 메일 첨부 전송/분석 | 미구현 | authenticated bytes, document-analysis-v1, native reader coverage와 Wiki 결과 연결은 필수 후속 범위 |

## 증거와 재현

```sh
npm test --prefix packages/nubi-a2a
node --test packages/nubi-desktop/tests/collaboration.test.mjs
node --test packages/nubi-office/tests/a2a.test.mjs
npm run test:collaboration-ui --prefix packages/nubi-desktop
npm run test:ui --prefix packages/nubi-desktop
```

로그는 `packages/nubi-a2a/verification/2026-10-01-final-protocol.log`, Desktop의 `verification/a2a-enabled-2026-10-01/`, Office의 같은 검증 폴더, Chrome의 `verification/finish-improvements-2026-10-01/workspace-chrome-first.log`다. Office native/installer 최종 빌드는 수행하지 않았다.

초기 비활성 guard 검사는 역사 자료로 보존한다. 새 검사는 guard 기대값을 단순 변경하지 않고 실제 host/server/receiver와 Pi 실행 바인딩을 확인한다. 첫 Desktop 무제한 병렬 전체 검사에서는 CPU 경합으로 parser worker의 5초 제한과 agent 테스트 시간 제한이 실패했다. 제품 제한을 완화하지 않고 검사 동시성을 2로 제한한 661/661 결과를 보존했다. 이후 663개 검사에서 동시성 2는 CPU 경합 아래 2건이 실패했다. 해당 18검사 파일의 단독 통과를 확인했고 기본 동시성을 1로 제한한 현재 전체 **663/663**이 통과했다. `final-unit-all-serial.log`와 실패 로그를 모두 보존한다. 제품의 5초 parser/도구 제한과 검증 조건은 완화하지 않았다.

[메일 첨부 협업](MAIL-DOCUMENT-COLLABORATION.md)은 여전히 필수 범위다. 앱 조회/초안 연결 성공으로 첨부 처리, Windows 설치, Office 저장이나 실모델 정확도를 완료로 표시하지 않는다. 스킬 패키지의 실행 권한과 A2A Agent Card skill ID도 구분한다.
