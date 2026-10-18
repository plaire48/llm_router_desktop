# Wave 2 로컬 QA 인계

사용자가 지정한 1.2.10 현재 작업 폴더를 기준으로 한다. commit/push/릴리스는 하지 않았다. 최종 독립 리뷰의 Important 4건을 보완했고 전체 로컬 게이트가 통과했다. 원격 업로드와 실기기 검증 완료를 뜻하지 않는다.

Task0/13 실측은 사용자와 Claude가 담당한다. Task6은 보류, Task14~34는 미착수다. 명령 기록 기본 접힘은 변경하지 않았다. Windows PC가 연결되지 않아 실제 Windows/Office2016/NASCA/설치판/실모델 품질은 별도 검증이다.

## 작업별 파일 및 기록

Task1/0b는 사용자의 Claude QA79 결과 보고와 `WAVE2-IMPLEMENTATION-2026-10-17.md`를 함께 본다. 이후 단계의 전체 게이트 이력과 실패 원인은 각 문서에 보존했다. manifest 해시는 단계가 끝날 때의 버전이며 후속 단계가 동일 파일을 수정하므로 과거 해시를 최종 소스와 혼동하지 않는다.

### Task 2

기록: [WAVE2-TASK2-2026-10-18.md](WAVE2-TASK2-2026-10-18.md)

- `packages/nubi-desktop/runtime/irreversible-actions.mjs`
- `packages/nubi-desktop/runtime/approval-policy.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/runtime/tool-rules.mjs`
- `packages/nubi-desktop/ui/IrreversibleNotice.jsx`
- `packages/nubi-desktop/ui/SetupActions.jsx`
- `packages/nubi-desktop/ui/ProposalCard.jsx`
- `packages/nubi-desktop/ui/QuestionDecision.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/ui/ApprovalMode.jsx`
- `packages/nubi-desktop/tests/irreversible-actions.test.mjs`
- `packages/nubi-desktop/tests/approval-policy.test.mjs`
- `packages/nubi-desktop/tests/mcp-approval-flow.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-irreversible-ui.mjs`
- `packages/nubi-desktop/package.json`

### Task 3

기록: [WAVE2-TASK3-2026-10-18.md](WAVE2-TASK3-2026-10-18.md)

- `packages/nubi-desktop/runtime/conversation-archive.mjs`
- `packages/nubi-desktop/runtime/store.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/project-services.mjs`
- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/ui/ConversationArchiveSetting.jsx`
- `packages/nubi-desktop/ui/SessionSidebar.jsx`
- `packages/nubi-desktop/ui/session-navigation.mjs`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/ui/marks.jsx`
- `packages/nubi-desktop/tests/conversation-archive.test.mjs`
- `packages/nubi-desktop/tests/session-navigation.test.mjs`
- `packages/nubi-desktop/tests/project-services.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/scripts/check-shared-ui.mjs`
- `packages/nubi-desktop/scripts/check-electron-session-pins.mjs`

### Task 4

기록: [WAVE2-TASK4-2026-10-18.md](WAVE2-TASK4-2026-10-18.md)

- `packages/nubi-desktop/electron-app/FileWorkspace.jsx`
- `packages/nubi-desktop/electron-app/renderer.jsx`
- `packages/nubi-desktop/package.json`
- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/runtime/output-files.mjs`
- `packages/nubi-desktop/runtime/project-browser.mjs`
- `packages/nubi-desktop/runtime/tool-rules.mjs`
- `packages/nubi-desktop/scripts/check-electron-output-cards.mjs`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/tests/output-files.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/ui/OutputFileCards.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/ui/WorkspaceActivity.jsx`
- `packages/nubi-desktop/ui/output-file-cards.css`

### Task 5

기록: [WAVE2-TASK5-2026-10-18.md](WAVE2-TASK5-2026-10-18.md)

- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/side-tasks.mjs`
- `packages/nubi-desktop/runtime/tool-rules.mjs`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/tests/side-tasks.test.mjs`
- `packages/nubi-desktop/ui/SideTaskChips.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/ui/WorkspaceActivity.jsx`
- `packages/nubi-desktop/ui/marks.jsx`
- `packages/nubi-desktop/ui/side-task-chips.css`

### Task 8

기록: [WAVE2-TASK8-2026-10-18.md](WAVE2-TASK8-2026-10-18.md)

- `packages/nubi-desktop/runtime/recovery.mjs`
- `packages/nubi-desktop/tests/model-retry.test.mjs`
- `packages/nubi-desktop/tests/recovery.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/tests/mail.test.mjs`

### Task 7

기록: [WAVE2-TASK7-2026-10-18.md](WAVE2-TASK7-2026-10-18.md)

- `packages/nubi-desktop/runtime/after-edit-check.mjs`
- `packages/nubi-desktop/runtime/development-workflow.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/setup-actions.mjs`
- `packages/nubi-desktop/ui/AfterEditCheckSetting.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/tests/after-edit-check.test.mjs`
- `packages/nubi-desktop/tests/development-gate.test.mjs`
- `packages/nubi-desktop/scripts/check-development-execution-electron.mjs`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/package.json`

### Task 9

기록: [WAVE2-TASK9-2026-10-18.md](WAVE2-TASK9-2026-10-18.md)

- `extensions/aipro-chat/agent-runtime.js`
- `extensions/aipro-chat/analysis-agents.js`
- `packages/nubi-desktop/ui/AnalysisHistory.jsx`
- `packages/nubi-desktop/runtime/tool-rules.mjs`
- `packages/nubi-desktop/runtime/lean-tools.mjs`
- `packages/nubi-desktop/runtime/recovery.mjs`
- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/runtime/run-metrics.mjs`
- `packages/nubi-desktop/scripts/check-electron-agent.mjs`
- `packages/nubi-desktop/runtime/research-agent.mjs`
- `packages/nubi-desktop/tests/research-agent.test.mjs`
- `packages/nubi-desktop/tests/research-host.test.mjs`
- `packages/openwiki/src/agent/wiki-question.ts`
- `packages/nubi-desktop/runtime/workspace-documents.mjs`
- `packages/nubi-desktop/tests/workspace-documents.test.mjs`

### Task 10

기록: [WAVE2-TASK10-2026-10-18.md](WAVE2-TASK10-2026-10-18.md)

- `packages/nubi-desktop/runtime/conversation-export.mjs`
- `packages/nubi-desktop/tests/conversation-export.test.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/electron-app/main.cjs`
- `packages/nubi-desktop/ui/SessionSidebar.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/scripts/check-electron-projects.mjs`
- `packages/nubi-desktop/scripts/check-shared-ui.mjs`

### Task 11

기록: [WAVE2-TASK11-2026-10-18.md](WAVE2-TASK11-2026-10-18.md)

- `packages/nubi-desktop/runtime/run-metrics.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/ui/ConversationUsage.jsx`
- `packages/nubi-desktop/ui/conversation-usage.css`
- `packages/nubi-desktop/ui/SessionSidebar.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/tests/conversation-usage.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/scripts/check-shared-ui.mjs`

### Task 12

기록: [WAVE2-TASK12-2026-10-18.md](WAVE2-TASK12-2026-10-18.md). 공통 모달 요청과 최종 리뷰 보완을 함께 검증한다.

- `packages/nubi-desktop/design/workspace-dialogs.css`
- `packages/nubi-desktop/electron-app/decision-notices.cjs`
- `packages/nubi-desktop/electron-app/main.cjs`
- `packages/nubi-desktop/runtime/conversation-export.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/project-services.mjs`
- `packages/nubi-desktop/runtime/routines.mjs`
- `packages/nubi-desktop/runtime/service-entry.mjs`
- `packages/nubi-desktop/scripts/check-electron-lifecycle.mjs`
- `packages/nubi-desktop/scripts/check-mail-ui.mjs`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/scripts/identity-browser.mjs`
- `packages/nubi-desktop/tests/conversation-export.test.mjs`
- `packages/nubi-desktop/tests/mail-fixture.jsx`
- `packages/nubi-desktop/tests/project-services.test.mjs`
- `packages/nubi-desktop/tests/routines.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/ui/DataResetConfirmation.jsx`
- `packages/nubi-desktop/ui/RoutineSettings.jsx`
- `packages/nubi-desktop/ui/SystemDecisionNotifications.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/ui/human-decisions.mjs`
- `packages/nubi-desktop/ui/routine-settings.css`

## 공통 모달 추가 요청

[MODAL-IDENTITY-2026-10-18.md](MODAL-IDENTITY-2026-10-18.md). Task12 manifest에 함께 묶어 최종 소스 검증을 수행한다. 누비 앱 소유 모달의 공통 색/라벨/오류/링크 및 삭제 의미색을 정렬한다.

## 업로드 담당

Claude가 로컬 QA와 파일 목록을 확인한 뒤 사용자 승인된 비공개 main에 업로드한다. 공개 origin으로 보내지 않는다. 기존 `live-editor-host.mjs`, `tests/document-all-work.test.mjs`, `nubi-desktop-windows.yml` 변경은 이번 Wave2에서 만든 것이 아니라 이전 1.2.10 비공개 릴리스 snapshot과 동일한 것으로 Task1 원장에 확인되어 있다.

## 공통 모달과 최종 리뷰

[모달 적용 및 점검 범위](MODAL-IDENTITY-2026-10-18.md), [최종 리뷰 네 Important와 보완](WAVE2-FINAL-REVIEW-2026-10-18.md)를 함께 본다. 실제 호출부 56곳을 공통 스타일로 관리한다. OS 파일 선택창과 외부 앱의 콘텐츠는 누비 모달 CSS 소유가 아니다.

추가 단위 23/23 및 실제 Electron 유휴 대화/질문 알림/재시작 보존 검사를 통과했다. 최종 전체 게이트는 종료 코드 0으로 통과했다. 단위 1,827 통과/0 실패/200 건너뜀, 전체 화면 117종, 추가 QA 4종과 실제 Electron 개발 6개 경로가 통과했다. 게이트 후에도 동일한 최종 제품/시험 파일 87개 해시를 `.superpowers/sdd/2026-10-16-nubi-claude-desktop-wave2/final-files.json`에 기록했다. 단계별 manifest와 달리 이 파일이 합쳐진 현재 소스 기준이다.

리뷰 보류 minor는 없다. 사용자가 정한 실측과 Windows/Office/NASCA/SSO/설치판 검증, Task6과 3차 물결 범위는 그대로 남아 있다. 평가 과제, 명령 기록 기본 접힘, 원격 저장소에는 변경을 가하지 않았다.

## 판단 내역과 한계

순서는 구현 중 판단한 순서다.

1. Task7 기존 developmentChecks/bindDevelopmentEvidence/enforceDevelopmentEvidence를 재사용했다. 예시의 약한 판정기로 교체하지 않았다. 누락이 발견되면 해당 완료 경로의 추가 회귀가 필요하다.
2. Task7 명령 종류는 실제 계약 verify를 사용했다. 모델 근거 한도 10은 유지하며 배치 해시는 호스트 관찰만 더했다. 매우 큰 수동 배치는 별도 묶음 표시가 필요할 수 있다.
3. Task9 초기 조사 20회와 후속 두 번 각각 5회를 적용했다. 예시의 누적/단계 한도 혼동을 고쳤다. 정책이 바뀌면 총 30회 경계를 함께 조정해야 한다.
4. Task9 조사 통계는 run-metrics의 실행 계측에 추가했다. eval/grade와 평가 과제는 바꾸지 않았다. 별도 점수표를 원하면 별도 설계가 필요하다.
5. Task10 저장된 arguments.text JSON을 해석하고 path/query/script/title만 내보낸다. 입력이 없거나 해석 불가하면 생략한다. 숨긴 세부 도구 정보는 원본 앱 기록에서 확인해야 한다.
6. Task11 document/wiki_update는 analysis 행으로 묶고 research는 분리했다. 누락/부분/실제 0을 구분하며 모델 처리시간 합계와 30일 보존 한계를 표시한다. 별도 문서/위키 분석 행을 원하면 표시 계약을 바꿔야 한다.
7. Task12 검증된 프로젝트 목록에서 배경 서비스를 열고 현재 선택은 유지했다. 기존 작업 메타데이터와 결정 알림을 재사용한다. 프로젝트 식별자 체계가 바뀌면 명시적 이전 처리가 필요하다.
8. 실제 모델 품질은 Task0/13 사용자/Claude 실측으로 남긴다. 로컬 fixture로 공급자 순위를 정하지 않았다. 실제 모델 회귀는 그 실측에서 발견될 수 있다.
9. Windows/Office/NASCA/SSO/설치판 및 OS 알림 실제 전달은 대상 PC 미연결로 미검증이다. macOS Electron 성공을 대체 증거로 사용하지 않았다.
10. Task6, Task14–34 및 기존 무관한 1.2.10 변경을 새로 구현하지 않았다. 사용자가 고른 후 진행할 범위로 남는다.
11. 독립 코드 리뷰를 시각 품질 증거로 삼지 않고 실제 브라우저/Electron 검사로 확인했다. 호출부 56곳과 화면 117종은 모든 상태 조합의 전수 검사를 뜻하지 않는다.

보류한 minor 지적은 없다. 리뷰의 Important 4건은 수정하고 실패 재현/회귀로 확인한다. 사용자 결정대로 업로드는 Claude QA 뒤 수행하며 Codex는 commit/push/릴리스하지 않았다.

## 완료 및 인계

승인된 2차 구현 순서의 로컬 작업과 모달 요청을 마쳤다. Task12 Step6a를 체크했고 Step6b는 Claude QA/업로드로 남겼다. Task0/13 실측, Task6 보류와 Task14–34 사용자 선택 범위는 변경하지 않았다. 전체 게이트 원문: `.superpowers/sdd/2026-10-16-nubi-claude-desktop-wave2/task-12-tests.log`. Task별 변경 파일 목록은 위에 있으며 최종 manifest 87개 해시가 그대로임을 확인했다. 모든 변경은 기존 작업 폴더에 보존했다.
