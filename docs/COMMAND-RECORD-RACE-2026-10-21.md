# 명령 기록 펼침 경합 수정 — 2026-10-21

## 결과와 결정

설치판 5회차 `39530678358`에서 보고된 경합을 실제 Workbench 합성 화면에서 재현했다. 명령 기록을 키보드로 펼친 직후 최종 답변을 전달하면 활동 영역의 답변 앵커가 바뀌어 기존 기록 DOM이 분리되고 새 기록이 접혔다. 제품 수정 전 `user expansion survives final-answer remount: false !== true` 실패를 확보했다. 최초 검사 진입 셀렉터의 타임아웃은 별도 준비 오류이며 제품 재현 근거에 포함하지 않았다.

Workbench가 현재 프로젝트와 대화 범위에서 `action.id`별 펼침 선택을 보관한다. 일반 대화와 워크플로우 승인 카드가 같은 보관 값을 받는다. 클릭 시 선택을 즉시 기록하고, 늦게 도착한 분리 DOM의 toggle 이벤트는 무시한다. 새 기록은 접힌 상태이며 출력은 펼칠 때만 렌더링한다. 대화/프로젝트를 바꾸면 이 임시 UI 상태는 초기화한다. 승인, 실행, 저장된 명령과 결과는 바꾸지 않는다.

## 검사

| 검사 | 결과 |
|---|---|
| 수정 전 재현 | 최종 답변 뒤 실제 DOM 재마운트 확인, 펼침 보존 단언 실패 |
| `check-wave2-ui.mjs` 전체 | 24장면 통과, 페이지 오류 0. 새 4장면은 1280/440 × 펼침/접힘, 키보드, 다른 action ID 격리, 출력 지연 렌더와 기존 터미널 연결 확인 |
| 분리한 업로드 후보 Workbench | 같은 재현 검사 4장면 통과. 해당 파일을 esbuild onLoad로 치환하고 나머지는 작업 트리 사용 |
| 집중 `node --test` | `command-record-status`, `conversation-activity`, `activity-timeline`, `setup-actions`: 31개 통과, 실패 0, 8.91초 |
| 기존 `check-command-terminal.mjs` | macOS Electron + 실제 Bash PTY 8개 흐름 통과, 페이지 오류 0. 승인 후 같은 터미널 연결, 펼침/접힘, 명령 재실행 없음, Ctrl+C, Unicode/ANSI, 크기 변경, 마지막 출력 보존. 대량 출력 201ms |
| 빌드와 디자인 | `npm run build:electron`, `npm run design:check` exit 0 |

새 Node 단위 시험이나 네이티브 검사 작업은 추가하지 않았다. 새 4장면은 기존 fast ui의 `check-wave2-ui`에서 실행된다. 기존 `check-command-terminal.mjs`는 main과 SHA가 같으며 20초 대기와 모든 단언을 유지했다. 전체 `test:gates`와 Windows 설치판 재실행은 이번 로컬 검사 범위가 아니다. Electron 검사는 현재 작업 트리에서 실행했고, 분리 후보 전체 트리의 빌드 성공으로 확대하지 않는다.

## 파일과 업로드 경계

기준 `96bf7f00`. 수정 4파일과 이 보고서만 대상으로 한다.

- `packages/nubi-desktop/ui/SetupActions.jsx`: 클릭 시 선택 기록과 재마운트 복원.
- `packages/nubi-desktop/ui/Workbench.jsx`: 대화 범위의 action ID 집합과 두 표시 경로 연결.
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`: 명령 완료 후 최종 답변을 전달하는 합성 호스트 상태.
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`: 실제 재마운트와 펼침/접힘 보존 검사. `--command-record-only`는 로컬 집중 실행용이며 기본 실행에도 포함된다.
- `docs/COMMAND-RECORD-RACE-2026-10-21.md`: 이 보고서.

명세: `.superpowers/sdd/2026-10-21-command-record-race/SHA256SUMS.txt`, `files.json`.
업로드용 파일: 같은 폴더의 `frozen/`. 제품/검사 4파일만의 패치: `command-record-race.patch`.

주의: 작업 트리 Workbench에는 기존의 `workflowTarget` 및 `WorkflowPanel initialSlug` 변경도 있다. 이를 지우지 않았으며 이번 frozen 후보에는 포함하지 않았다. Workbench는 작업 파일 전체를 복사하지 말고 frozen 또는 분리 패치를 사용한다. `files.json`에 후보 SHA와 검사한 작업 트리 SHA를 각각 기록했다. 나머지 3파일은 두 SHA가 같다. 업로드와 릴리스는 Claude가 한다.

## 근거와 남은 위험

- 실패 로그/화면: `packages/nubi-desktop/verification/command-record-race/red.log`, `before-1280.png`.
- 최종 캡처: `packages/nubi-desktop/verification/wave2/command-record-{1280,440}-{open,closed}.png`.
- 후보 캡처/결과: `packages/nubi-desktop/verification/command-record-race/candidate/`.
- 전체 화면 결과: `packages/nubi-desktop/verification/wave2/result.json`.
- Electron 결과: `packages/nubi-desktop/verification/command-terminal-2026-10-15/result.json`, `agent-execution.png`, `terminal.png`.
- 명령/검사 로그: `packages/nubi-desktop/verification/command-record-race/{unit,design,build,electron,wave2}.log`.

Windows 설치판 5회차와 동일한 환경에서의 재검증은 남아 있다. 실모델 검사는 하지 않았다. 승인 대기인 `scripts/safety-public-reviews.mjs`, `scripts/safety-public-reviews.json`, `tests/safety-public-reviews.test.mjs`는 수정하지 않았고 작업 전후 SHA 일치를 확인했다. store/WAL 변경과 안전성 검토 결정도 이번 범위 밖이다.
