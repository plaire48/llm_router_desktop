# 2차 검토 후속 F12~F15 — 2026-10-18

## 상태

F13 → F14 → F12 → F15 순서로 수정했다. 집중 단위 시험 79/79, Chrome 화면 검사, 실제 macOS Electron 개발 검사 8개가 통과했다. `npm run test:gates`는 실행 중이다. 완료 판정과 계획 체크박스는 전체 게이트 종료 뒤 갱신한다. F11의 Claude 수정은 건드리지 않고 읽음 표시 회귀를 함께 통과했다. Codex는 commit, push, 릴리스 작업을 하지 않았다.

## 수정

- **F13**: 호스트가 반영 묶음의 `package.json`, npm/pnpm/yarn/bun 잠금 파일, package scripts에서 참조하는 파일을 확인하고 `manifestChanged:true`를 저장한다. 이 카드에는 `reason:check` 자동 승인을 허용하지 않는다. 정확히 등록한 `commandAllowed` 예외는 유지한다. 같은 작업 경로의 이전 대기 카드와 다음 편집 묶음도 승인 필요 상태를 유지해 새 묶음으로 우회하지 못하게 한다. 사용자가 검사 설정을 다시 저장하면 이후 묶음의 기준을 새로 시작하되 이미 대기 중인 카드의 표시를 해제하지 않는다. 승인 조회가 파일 읽기로 대기하는 중 새 반영이 끝나도 저장된 최신 카드의 표시를 다시 확인한다. 카드에는 확인이 필요한 이유 한 줄을 기존 본문 토큰으로 표시한다.
- **F14**: 새 곁가지 대화에 `origin:{kind:'side_task',taskId,sideTaskId,runId}`를 저장하고 탐색 목록에도 보존한다. 처음의 제안 요청은 기억 추출에서 제외하며 사용자가 직접 쓴 후속 요청은 추출할 수 있다. 최초 요청을 `task.request`에 별도 보관하는 실제 저장 형식과 첫 user 메시지로 보관하는 형식을 모두 처리한다. Markdown의 첫 요청 제목과 파일명에 에이전트 제안을 표시한다. 사이드바의 작은 ‘제안’ 배지는 기존 글꼴, 크기, 색을 재사용하고 접근성 이름을 둔다.
- **F12**: `cleanModelText`를 챕터 제목/요약, 제안 제목/요약/prompt, 산출물 캡션에 재사용한다. C0/C1 제어 문자, 폭 없는 문자, bidi 제어를 제거하고 공백을 정리한다. 정리 후 빈 필수 값과 보이지 않는 문자만 준 선택 설명은 해당 `*_invalid`로 거부한다. 원래 생략할 수 있던 요약과 캡션은 계속 생략 가능하다. 정리된 제안 prompt가 `/`로 시작하면 거부한다.
- **F15**: `secretLike`를 공통 모듈로 옮기고 기존 memory 공개 export를 유지한다. 내보내기의 모든 텍스트 투영은 기존 인증값 검사와 이 탐지를 함께 적용한다. 한국어 접속키와 `ghp_` 형태도 탐지한다. 저장된 원래 대화는 변경하지 않는다.

## 검증 근거

실행 로그: `.superpowers/sdd/2026-10-16-nubi-claude-desktop-wave2/claude-qa-followup/`

| 구분 | 결과와 파일 |
| --- | --- |
| F13 최초 실패 | `f13-red.log`: package.json과 검사 파일 자동 승인 재현. 잠금 파일 사례는 시험 JSON 형식 오류였고 이를 고친 뒤 통과 |
| F13 추가 실패 | `f13-batch-red.log`, `f13-race-red.log`: 다음 묶음/기존 카드와 비동기 승인 조회 우회 재현 후 보완 |
| F14 실패 | `f14-red-corrected.log`: 출처, 기억 추출, 내보내기, bidi 네 실패 확인. 첫 시도는 시험의 기억 기능 활성화 및 후속 요청 인자를 보정 |
| F12 실패 | `f12-red.log`, `f12-summary-red.log`: 챕터, 칩, 캡션과 보이지 않는 요약 실패 확인 |
| F15 실패 | `f15-red.log`: 내보내기와 공통 비밀 탐지 실패 확인 |
| 최종 집중 단위 | `focused.log`: 79 통과, 실패 0, 건너뜀 0 |
| Chrome 화면 | `wave2-ui.log`, `packages/nubi-desktop/verification/wave2/result.json`: 1280/440 제안 배지와 기존 챕터/보관/카드/모달 검증 |
| 실제 Electron | `development-electron-final.log`: 8개 통과. 변경된 manifest의 자동 승인 없음, 새 process 없음, 1280/440 카드와 가림 없음 확인 |
| 소스 고정 | `files-before-gates.json`: runtime/UI/design/scripts/tests 1,179개 해시. 게이트 후 대조 예정 |
| 전체 게이트 | `gates.log`: 실행 중 |

Electron 첫 시도의 `project_changed`는 시험이 overview 대신 state에서 프로젝트 ID를 읽어 발생했으며 시험을 수정했다. 중간 440px 캡처에는 열린 터미널이 앞에 있어, 보조 터미널을 닫고 카드 중앙이 다른 요소에 가리지 않는 검사도 추가한 뒤 최종 캡처를 확인했다. 초기 실패 로그를 보존했다.

이는 로컬 단위, 합성 Chrome 화면과 실제 macOS Electron 실행 근거다. 실모델, 회사 PC, SSO, Windows Office, 설치판 검증으로 확대하지 않는다.

## 사용자 추가 요청

- 기본 명령과 수정 명령의 ‘실행 승인’ 버튼을 ‘승인’으로 줄였다. 관리자 권한과 입력 승인은 의미를 유지한다. 해당 버튼을 찾는 기존 화면 검사도 같은 문구로 맞췄다.
- 코드 변경 목록의 두 파일에 표시된 ‘확인 필요’를 조사했다. 당시 반영 해시는 맞았으나 macOS 저장 경로의 `/var`와 `/private/var` 별칭을 다른 경로로 판단해 비교 스냅샷을 거부했다. 신뢰하는 저장 부모 경로만 정규화하고 하위/파일 symlink 거부를 유지했다. 저장소 별칭에서 실제 제안과 반영을 거친 실패 시험을 만든 뒤 수정했다. 관련 단위 5/5 및 실제 Electron의 합계 추가 2줄/삭제 2줄을 확인한다.
- 최초 전체 게이트는 이 추가 요청을 최종 소스에 반영하기 위해 소유 프로세스 트리만 중단했다. `gates-before-user-ui-followup.log`에 남겼으며 통과 결과로 세지 않는다. 제품 수정 후 전체 게이트를 새로 실행한다.

## 검사 종료 복구

추가 요청을 반영한 첫 전체 게이트는 단위 1,859 통과/0 실패/200 건너뜀과 Wave2 화면의 모든 단언을 통과한 뒤 `browser.close()`에서 종료되지 않았다. Chrome 자식은 사라졌으나 검사 HTTP 서버가 열린 채 남은 것을 프로세스와 열린 파일 목록으로 확인했다. 빌드 서비스만 중지해도 해소되지 않아 해당 게이트 트리만 종료했다. `gates-browser-cleanup-stalled.log`는 전체 통과로 세지 않는다. Wave2 검사 종료에 15초 제한을 넣고 성공/실패와 무관하게 HTTP 연결 및 esbuild 서비스를 정리한다. 이 최종 스크립트의 단독 실행은 모든 화면 단언 후 종료 코드 0이었다(`wave2-ui-cleanup.log`). 전체 게이트는 이 소스로 다시 실행한다.

## 변경 파일

- `packages/nubi-desktop/runtime/after-edit-check.mjs`
- `packages/nubi-desktop/runtime/approval-policy.mjs`
- `packages/nubi-desktop/runtime/model-text.mjs`
- `packages/nubi-desktop/runtime/side-tasks.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/memory.mjs`
- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/runtime/store.mjs`
- `packages/nubi-desktop/runtime/conversation-export.mjs`
- `packages/nubi-desktop/runtime/chapters.mjs`
- `packages/nubi-desktop/runtime/output-files.mjs`
- `packages/nubi-desktop/runtime/secret-like.mjs`
- `packages/nubi-desktop/ui/SetupActions.jsx`
- `packages/nubi-desktop/ui/SessionSidebar.jsx`
- `packages/nubi-desktop/tests/after-edit-check.test.mjs`
- `packages/nubi-desktop/tests/side-tasks.test.mjs`
- `packages/nubi-desktop/tests/conversation-export.test.mjs`
- `packages/nubi-desktop/tests/chapters.test.mjs`
- `packages/nubi-desktop/tests/output-files.test.mjs`
- `packages/nubi-desktop/tests/memory.test.mjs`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/scripts/check-development-execution-electron.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/runtime/applied-file-summary.mjs`
- `packages/nubi-desktop/tests/applied-file-summary.test.mjs`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/scripts/check-external-ai-policy.mjs`
- `packages/nubi-desktop/scripts/check-conversation-captures.mjs`
- `packages/nubi-desktop/scripts/check-decision-flow.mjs`
- `packages/nubi-desktop/scripts/check-progress-display.mjs`
- `packages/nubi-desktop/scripts/check-shared-ui.mjs`
- `packages/nubi-desktop/scripts/check-command-terminal.mjs`

이 보고서와 계획/진행 원장의 검증 기록은 별도 문서 변경이다. 기존 변경 파일 전체를 이 수정 묶음으로 표시하지 않는다.
