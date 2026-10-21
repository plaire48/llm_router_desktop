# 루틴 화면 지정 업로드 인계

기준: private main `09f289ed`. 2026-10-22. 업로드와 릴리스는 Claude 담당.

## 결과와 결정

- WorkflowPanel의 `루틴으로 등록`, 다음 예정 시각과 루틴 배지, 감독 실행 필요 상태를 연결했다. RoutineSettings는 대화 요청과 워크플로우 선택, 형식별 입력, 감독 실행 열기, 승격 제안을 기존 설정 양식으로 보여 준다.
- `check-electron-workflow.mjs`에 기존 `workflow-routine-scenes.mjs`의 import, seed, 실제 장면 호출을 다시 넣은 판을 포함한다. 장면 helper와 런타임 및 Workbench 연결은 이미 main과 바이트가 같으므로 재업로드하지 않는다.
- main의 Windows 정리 변경을 보존했다. 임시 폴더 삭제는 `maxRetries:20/retryDelay:250`, 강제 종료는 종료 전 얻은 프로세스에 `killProcessTree`를 사용한다. 대기 시간이나 단언은 완화하지 않았다.
- `runtime/mail.mjs`와 `runtime/mail-directory.mjs`는 편집하지 않았으며 이 묶음에 포함하지 않는다. EPERM/icacls 조사는 Claude 담당이다.

## 지정 파일

아래 6파일과 이 보고서만 frozen에 담았다. 이전 광범위한 G0 인계 묶음을 통째로 올리지 않는다.

1. `packages/nubi-desktop/ui/RoutineSettings.jsx`
2. `packages/nubi-desktop/ui/WorkflowPanel.jsx`
3. `packages/nubi-desktop/ui/routine-settings.css`
4. `packages/nubi-desktop/ui/workflow.css`
5. `packages/nubi-desktop/tests/workflow-workbench-fixture.jsx`
6. `packages/nubi-desktop/scripts/check-electron-workflow.mjs`

명세: `.superpowers/sdd/2026-10-22-workflow-routine-main09/files.json`, `SHA256SUMS.txt`. `changes.patch`는 main `09f289ed` 대비이며 기존 main 의존성 해시도 명세에 별도로 기록했다. 공유 작업 폴더의 다른 변경은 포함하지 않는다.

## 검증

| 검사 | 이번 결과 |
|---|---|
| `node --test tests/routine-ui.test.mjs` | 9 통과, 실패 0, 226.8ms. 기존 순수 Node 시험, 새 네이티브 단위 시험 없음 |
| `npm run build:electron` | exit 0 |
| `npm run design:check` | exit 0 |
| `WORKFLOW_TAG=main09-routines node scripts/check-electron-workflow.mjs` | exit 0, 1280/440 각 6장면, 총 12 통과, page error 0 |
| `node scripts/check-wave2-ui.mjs --routines-only` | exit 0, 5장면. 기존 대화 요청 루틴 1280/440/360 및 편집 검사 실패 표시 1280/440 |

Electron은 등록, 입력값 0/false 보존, 감독 전 자동 실행 차단, 승격과 미루기, dry-run, 한 번 반영, 강제 종료 뒤 같은 체크포인트 재개, 보고서와 파일 해시, 모델 호출 전 중단을 확인했다. 루틴 장면은 이름 없는 버튼, 모달 포커스 순환과 대비 검사도 실행한다.

원본 결과: `packages/nubi-desktop/verification/workflow-pilot/main09-routines/result.json`. 로그와 결과 사본은 인계 폴더 `evidence/`에 있다. 이번에는 전체 `test:gates`를 다시 돌리지 않았다.

## 캡처와 남은 위험

실제 확인한 캡처는 `packages/nubi-desktop/verification/workflow-pilot/main09-routines/`의 `routines-catalog-1280.png`, `routines-catalog-440.png`, `routines-settings-1280.png`, `routines-settings-440.png`다. 기존 공통 모달과 입력 양식을 사용하고 좁은 화면은 스크롤로 이어진다. 입력 이름은 합성 스키마의 subject/count/ratio/include다.

검증 환경은 macOS 로컬 Electron과 합성 자료, scripted loopback 모델이다. 440px는 Playwright viewport 적용 장면이며 실제 Windows 창 검증은 아니다. 이번 검사는 공유 작업 폴더에서 실행했으며 **main에 이 7파일만 합친 후보 트리 전체의 게이트 통과를 뜻하지 않는다**. Claude가 frozen/SHA 대조 후 후보 게이트를 실행한다.

설치판 aa의 gates-full 통과와 Windows 메일 시험 재실행은 사용자 전달 상태로 구분한다. 이 루틴 묶음의 Windows 실행, 실모델 예약 실행, 설치와 재실행 수용은 별도이며 릴리스 완료로 표시하지 않는다.
