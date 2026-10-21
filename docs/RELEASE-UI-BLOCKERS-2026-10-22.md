# 릴리스 UI 차단 수정 인계 — 2026-10-22

현재 작업 폴더의 검증 소스를 동결했다. 비교용 Git 기준은 `48491284`이며 최신 원격 main이라고 주장하지 않는다. 이전 K3/명령 인계도 포함하므로 이 묶음으로 대체한다. 업로드/릴리스는 Claude 담당이며 Codex는 하지 않았다.

## 결과

1. **명령 기록**: `commandRecordPending` 수정은 이전 frozen과 같은 SHA다. 현재 대화의 checking/running/stopping 명령은 에이전트 턴이 끝나고 다른 명령이 선택돼 있어도 기존 1초 폴링을 유지하고, 완료 snapshot 뒤 멈춘다. action.id별 펼침과 탐색 후 늦은 응답 차단도 유지한다. 새 경합 6장면은 checking/running/stopping × 1280/440이며 출력/exit 0/중지 버튼 제거/펼침 유지/폴링 중단을 확인한다. 설치판에도 쓰이는 `check-command-terminal`에 대화 기록 completed 및 exit 0 단언을 추가했다. 기존 대기 시간은 늘리지 않았다. 설치판 u에 이 소스가 포함됐는지/Windows에서 해결됐는지는 이번 확인 범위 밖이다.
2. **K3**: 전용 양식 버튼/카드/질문 폼 삭제를 유지한다. 렌더러 `ui/`, `electron-app/`의 documentForm 호출 0개. 일반 질문/답변과 기존 문서/변경 음영 비교는 그대로다. K4 서버 정리는 Claude 몫이며 해당 런타임을 바꾸지 않았다.
3. **막힌 프로젝트 전환**: 출처 위치로 열린 Markdown은 `sourceSelection`만으로 편집기를 보였다. 입력이 강조 범위를 지운 뒤 다음 부모 렌더에서 미리보기로 바뀌었다. `openPath`가 줄 위치를 열 때 편집 선택(`editSource`)도 유지하도록 분리했다. 미저장 전환 거절 뒤 소스 모드/입력 내용 유지, 저장, 명시적 미리보기 전환/편집 복귀와 실제 프로젝트 왕복/재시작을 확인했다.
4. **워크플로우 검사 병합**: 기존 `workflow-routine-scenes` 진입을 보존했다. 강제 종료는 공용 `killProcessTree(nativeProcess)`로, 임시 폴더 삭제는 루틴 전용/정상/실패 정리 모두 `maxRetries:20,retryDelay:250`으로 합쳤다. 공용 helper는 수정하지 않았고 dependency SHA로 고정했다. 참조 helper `workflow-routine-scenes.mjs`도 frozen에 동봉했다.

## 검증과 경계

| 검사 | 결과 |
|---|---|
| 명령 수정 전 | 이전 red 로그: 턴 최종 답 뒤 완료 상태를 못 읽어 4초 단언 실패. 이번에 동일 소스 SHA와 시험을 다시 확인 |
| 프로젝트 수정 전 | 실제 Electron에서 전환 거절 뒤 편집기 0개, ‘미리보기’ 버튼 소실로 실패. red 로그 보관 |
| `check-wave2-ui --command-record-only` | 10장면 통과(기존 펼침 4 + 종료 경합 6) |
| `check-command-terminal` | Mac Electron/실제 bash PTY 8흐름, 최종 기록 상태 단언 포함, exit 0 |
| `check-electron-projects` | 10흐름 exit 0, 미저장 내용 보존/저장/왕복/재시작 포함 |
| `check-electron-workflow` | 1280/440 12장면 exit 0, 강제 종료 후 같은 체크포인트 복구와 쓰기 중복 없음 포함 |
| `test:forms-ui` | 공통 디자인/명료성 및 채팅/문서/비교 화면 exit 0 |
| 집중 `node --test` | 기존 18/18, 실패 0, 1.951초. 새 unit 0개, 이번 추가는 UI 단언뿐 |
| build:electron, design:check, gate coverage | exit 0, 게이트 missing/extra/duplicates 0 |

수정 중 검사 보정: Monaco 표시의 NBSP는 텍스트 비교에서 일반 공백으로 정규화했다. 네이티브 최소 창 너비 620 때문에 440 캡처는 기존 워크플로우 검사와 같은 Playwright 뷰포트 방식이다. 좁은 창에서 접힌 사이드바는 후속 메뉴 검사 전에 명시적으로 펼친다. 이 세 가지 검사 설정 실패와 최종 통과를 evidence 로그에 모두 보존했다.

전체 test:gates/새 설치판/Windows Office/사내 환경은 이번 실행 범위가 아니다. 모델은 합성 fixture이며 실모델 성적으로 표시하지 않는다. 기존 windows-bash-process import.meta/CJS 빌드 경고는 남아 있다. Windows의 taskkill 및 rm 재시도 실동작은 Windows 게이트로 확인해야 한다.

## 캡처와 명세

- `packages/nubi-desktop/verification/wave2/command-status-{1280,440}-{checking,running,stopping}.png`
- `packages/nubi-desktop/verification/electron-projects-blocked-editor-{1280,440}.png`
- `packages/nubi-desktop/verification/document-chat/{chat-question,chat-result,preview,changes}-{1280,440}.png`
- `packages/nubi-desktop/verification/workflow-pilot/oct22-merged/{routines-settings,waiting,complete}-{1280,440}.png`
- `.superpowers/sdd/2026-10-22-release-ui-blockers/`: `frozen/`, `files.json`, `SHA256SUMS.txt`, `changes.patch`, `workflow-teardown-merge.patch`, `evidence/`. 현재 파일과 frozen SHA를 대조했다. `files.json`은 기존 기준 SHA와 삭제 9개를 포함한다. Claude 최신 main에서 기준 SHA가 다른 파일은 현재 변경을 보존해 합쳐야 한다.
- 공용 `scripts/electron-test-window.mjs`는 read-only dependency로 SHA만 기록했다. 이 파일을 과거 버전으로 덮어쓰지 않는다.

## 파일 목록

수정/추가 16파일(이전 인계 포함):

- `packages/nubi-desktop/electron-app/FileWorkspace.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/scripts/check-document-chat-ui.mjs`
- `packages/nubi-desktop/tests/document-chat-ui-fixture.jsx`
- `packages/nubi-desktop/package.json`
- `packages/nubi-desktop/scripts/gate-baseline.json`
- `docs/superpowers/plans/2026-10-21-nubi-document-forms.md`
- `docs/CHAT-FORM-COMMAND-STATUS-2026-10-21.md`
- `packages/nubi-desktop/electron-app/renderer.jsx`
- `packages/nubi-desktop/scripts/check-electron-projects.mjs`
- `packages/nubi-desktop/scripts/check-command-terminal.mjs`
- `packages/nubi-desktop/scripts/check-electron-workflow.mjs`
- `packages/nubi-desktop/scripts/workflow-routine-scenes.mjs`
- `docs/RELEASE-UI-BLOCKERS-2026-10-22.md`

삭제 9파일:

- `packages/nubi-desktop/ui/FormRegisterCard.jsx`
- `packages/nubi-desktop/ui/FormFillCard.jsx`
- `packages/nubi-desktop/ui/DocumentFormControl.jsx`
- `packages/nubi-desktop/ui/FormQuestionField.jsx`
- `packages/nubi-desktop/ui/form-cards.css`
- `packages/nubi-desktop/ui/form-cards-view.mjs`
- `packages/nubi-desktop/tests/form-cards-view.test.mjs`
- `packages/nubi-desktop/tests/form-cards-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-form-cards-ui.mjs`
