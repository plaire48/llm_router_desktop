# K3 대화 양식과 명령 기록 갱신 — 2026-10-21

기준: 사용자 전달 main `48491284`. Codex 로컬 변경이며 push/릴리스 없음. 인계 명세: `.superpowers/sdd/2026-10-21-chat-form-command-status/files.json`, 같은 폴더 `SHA256SUMS.txt`와 `frozen/`. 이전 `2026-10-21-word-form-polish` 6파일 묶음은 폐기하고 업로드하지 않는다.

## 결과와 결정

- K3 완료: 파일 미리보기의 ‘양식으로 등록/작성’ 진입과 전용 카드/질문 폼/스타일/헬퍼를 제거했다. 일반 대화 질문과 답변을 쓰며 기존 파일 미리보기, NativeDocumentPreview 음영, 원본 잠깐 보기, 머리글/바닥글과 삭제 내역은 보존했다. `ui/`, `electron-app/`의 `documentForm` 호출은 0개다. 서버 K4는 Claude가 진행한다. `fill_document_form` 런타임은 변경하지 않았다.
- 명령 기록: 활성 에이전트/선택 프로세스와 별개로 현재 대화의 프로세스와 setupAction.resultProcessId가 가리키는 프로세스 중 checking/running/stopping이 있으면 기존 1초 snapshot 갱신을 이어간다. 종료 후 폴링을 멈추며 탐색 후 늦은 응답 차단과 action.id별 펼침 상태를 유지한다. 명령 재실행과 대기 시간 연장 없음.
- 게이트 교체: 사라진 폼 전용 검사를 `check-document-chat-ui.mjs`로 교체하고 `test:forms-ui`와 baseline을 함께 갱신했다. UI는 합성 호스트이며 일반 대화 응답도 fixture다. 실제 파일 작성은 기존 도구 단위 시험으로 따로 확인했다.

## 재현과 검증

| 검사 | 결과 |
|---|---|
| 수정 전 명령 재현 | 턴 최종 답변 도착 뒤 process 완료를 갱신하지 못해 기존 4초 단언 실패. 출력/exit 상태를 기다리는 시간은 수정 전후 동일 |
| 수정 전 폼 제거 검사 | 문서에 양식 진입 버튼 2개가 남아 0개 단언 실패 |
| 집중 Node 시험 | 18/18, 실패 0, 1.303초. document-form-tool 3, command-record-status 1, native-document-preview 8, gate-coverage 6 |
| 새 unit 비용 | 새 Node 시험 0개. 없어진 폼 헬퍼 시험 7개 제거. 새 UI 검사는 일반 대화/문서 1280/440과 명령 종료 6장면 |
| `npm run test:forms-ui` | 공통 디자인 규칙/폼 명료성/대화 문서 화면 전부 exit 0 |
| `node scripts/check-wave2-ui.mjs` | 30장면 통과. 새 상태 3종 × 너비 2종, 종료 갱신/출력/exit 0/중지 버튼 제거/펼침 유지/최종 폴링 중단 포함 |
| `npm run build:electron`, `check-command-terminal.mjs` | exit 0, Mac 실제 Electron + bash PTY 8흐름 통과. 모델 응답은 스크립트 fixture |
| `npm run design:check`, `check-gate-coverage.mjs` | exit 0, missing/extra/duplicates 모두 0 |

전체 `test:gates`와 Windows 설치판은 이번 로컬 검증에서 실행하지 않았다. Windows Office/사내 문서/설치판 o 재현 해소와 실모델 성적을 이 결과로 확대하지 않는다. 빌드의 기존 windows-bash-process import.meta/CJS 경고는 남아 있으며 해당 소스는 수정하지 않았다.

## 캡처와 원본

모든 경로는 저장소 루트 기준이다. 1280/440을 같은 이름의 너비 접미사로 보관했다.

- `packages/nubi-desktop/verification/document-chat/chat-question-{1280,440}.png`, `chat-result-{1280,440}.png`: 기존 Workbench 일반 질문/답변.
- 같은 폴더 `preview-{1280,440}.png`, `changes-{1280,440}.png`: 폼 진입 없음, 기존 비교기 변경 음영과 머리글/바닥글. `result.json`에 UI 범위와 소요 기록.
- `packages/nubi-desktop/verification/wave2/command-status-{1280,440}-{checking,running,stopping}.png`, `result.json`.
- `packages/nubi-desktop/verification/command-terminal-2026-10-15/result.json`: Electron/PTY 8흐름 결과.
- 인계 폴더 `evidence/`: 수정 전 실패 로그와 이번 검증 로그/JSON. 캡처는 로컬 검토 산출물이며 Git 업로드 목록에 포함하지 않았다.

## 지정 업로드 파일

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

삭제(9파일, 복구/대조용 기존 main SHA는 files.json에 기록):

- `packages/nubi-desktop/ui/FormRegisterCard.jsx`
- `packages/nubi-desktop/ui/FormFillCard.jsx`
- `packages/nubi-desktop/ui/DocumentFormControl.jsx`
- `packages/nubi-desktop/ui/FormQuestionField.jsx`
- `packages/nubi-desktop/ui/form-cards.css`
- `packages/nubi-desktop/ui/form-cards-view.mjs`
- `packages/nubi-desktop/tests/form-cards-view.test.mjs`
- `packages/nubi-desktop/tests/form-cards-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-form-cards-ui.mjs`
