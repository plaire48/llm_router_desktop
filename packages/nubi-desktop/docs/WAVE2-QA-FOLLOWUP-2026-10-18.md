# 2차 검토 후속 F12~F15 — 2026-10-18

## 상태

F13 → F14 → F12 → F15 수정 완료. `npm run test:gates` **종료 코드 0**: 단위 1,859 통과/0 실패/200 건너뜀, 전체 화면 117종, 추가 QA 4종, 실제 macOS Electron 개발 검사 8개와 MCP 승인 6개 통과. F11의 Claude 변경은 유지하고 읽음 표시 회귀도 통과했다. 사용자 추가 요청인 ‘승인’ 버튼 문구와 변경량 표시 오류도 포함했다.

게이트 전후 소스/시험 1,179개 해시에서 제품 코드는 같았다. 실행 중 `check-wave2-ui.mjs` 하나에 추가 편집이 들어와 최종 종료 처리를 보완하고 **동일한 화면 단언 전체를 별도 재실행해 종료 코드 0**을 확인했다. 최종 게이트 로그는 해당 종료 보완 전 버전, `wave2-ui-final.log`는 최종 검사 파일의 근거다. 제품 전체 게이트를 새 종료 코드로 재실행했다고 소급하지 않는다.

계획 F12~F15 체크박스를 갱신했다. Codex는 commit, push, 릴리스를 하지 않았다. Claude의 최종 QA와 업로드 단계로 넘긴다.

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
| 소스 고정 | `files-before-gates.json`: runtime/UI/design/scripts/tests 1,179개 해시. 최종 대조: 제품 변경 없음, 화면 검사 종료 처리 한 파일은 별도 재검증 |
| 전체 게이트 | `gates.log`: 종료 코드 0. 최종 검사 종료 처리는 `wave2-ui-final.log`로 별도 통과 |

Electron 첫 시도의 `project_changed`는 시험이 overview 대신 state에서 프로젝트 ID를 읽어 발생했으며 시험을 수정했다. 중간 440px 캡처에는 열린 터미널이 앞에 있어, 보조 터미널을 닫고 카드 중앙이 다른 요소에 가리지 않는 검사도 추가한 뒤 최종 캡처를 확인했다. 초기 실패 로그를 보존했다.

이는 로컬 단위, 합성 Chrome 화면과 실제 macOS Electron 실행 근거다. 실모델, 회사 PC, SSO, Windows Office, 설치판 검증으로 확대하지 않는다.

## 사용자 추가 요청

- 기본 명령과 수정 명령의 ‘실행 승인’ 버튼을 ‘승인’으로 줄였다. 관리자 권한과 입력 승인은 의미를 유지한다. 해당 버튼을 찾는 기존 화면 검사도 같은 문구로 맞췄다.
- 코드 변경 목록의 두 파일에 표시된 ‘확인 필요’를 조사했다. 당시 반영 해시는 맞았으나 macOS 저장 경로의 `/var`와 `/private/var` 별칭을 다른 경로로 판단해 비교 스냅샷을 거부했다. 신뢰하는 저장 부모 경로만 정규화하고 하위/파일 symlink 거부를 유지했다. 저장소 별칭에서 실제 제안과 반영을 거친 실패 시험을 만든 뒤 수정했다. 관련 단위 5/5 및 실제 Electron의 합계 추가 2줄/삭제 2줄을 확인했다.
- 최초 전체 게이트는 이 추가 요청을 최종 소스에 반영하기 위해 소유 프로세스 트리만 중단했다. `gates-before-user-ui-followup.log`에 남겼으며 통과 결과로 세지 않는다. 제품 수정 후 전체 게이트를 새로 실행한다.

## 검사 종료 복구와 동시 편집

- 첫 전체 재실행은 단위와 Wave2의 화면 단언을 모두 통과한 뒤 `browser.close()`에서 멈췄다. Chrome 자식은 사라졌으나 검사 HTTP 서버와 통신 파이프가 남아 있었다. 검사 전용 빌드 서비스만 종료해도 해소되지 않아 소유 게이트 트리만 중지했다. `gates-browser-cleanup-stalled.log`는 전체 통과가 아니다.
- 제한 시간과 정리 코드를 넣은 재실행에서 전체 `test:gates`가 종료 코드 0으로 끝났다. 해시 대조 때 Wave2 스크립트에 동시 편집된 종료 코드가 확인됐다. 그 코드의 Playwright Browser에는 없는 `process()` 호출과 종료 실패 무시 처리를 제거했다.
- 단독 후속 검사에서 종료 시간 초과를 재현했고, 공식 `launchServer`/`connect`/`BrowserServer.kill`로 검사 전용 프로세스를 소유하도록 바꿨다. 이 과정의 한 차례 문법 오류도 수정했다. 최종 코드는 소유한 Chrome의 실제 exit를 확인한 뒤 상속된 통신 파이프를 닫아 Playwright의 close와 임시 폴더 정리가 끝나게 한다. 종료 15초 제한은 유지하며 화면 단언 또는 정리 실패를 통과로 바꾸지 않는다. 사용자 브라우저를 종료하지 않는다.
- 최종 전체 화면 단언과 프로세스 종료는 `wave2-ui-final.log`에서 종료 코드 0이다. `wave2-ui-final-concurrent-edit.log`, `wave2-ui-owned-server.log`, `wave2-ui-kill-timeout.log`, `wave2-ui-cleanup-syntax-error.log`에 중간 실패를 남겼다. 제품 소스는 전체 게이트 이후 바뀌지 않았다.

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
