# CI unit 분할 보고

결과: 이름순 두 부분211/210파일과 ui32명령으로 나눴다. 중복/누락 없이 기존 Node 옵션과 각 작업 pretest를 유지한다. 실패 시험 먼저 확인 후 관련6시험 통과(149.8ms, 후속522.0ms). gate coverage ok. 신규네이티브시험0, 기존2개 partition 시험을3개로 보강했다. 전체unit을 로컬에서 중복 실행하지 않았고 다음 Actions 시간은 미측정이다. 기존27차 unit17분19초는 사용자 전달 기준이다.

결정: package.json/Windows 전체 게이트는 변경하지 않는다. 세 job의 실패 아티팩트7일/20분 게이트 제한/미판정 요약 유지. 이름순 분할은 시간 균형을 보장하지 않으므로 다음 Actions 세 작업 시간을 함께 기록한다. UI 변경 없음으로 캡처 해당 없음. 업로드는 Claude.

파일: `.github/workflows/nubi-desktop-gates.yml`, `packages/nubi-desktop/scripts/run-gate-part.mjs`, `packages/nubi-desktop/tests/run-gate-part.test.mjs`, `packages/nubi-desktop/tests/desktop-gates-workflow.test.mjs`, `docs/CI-GATES.md`, 이 보고서.

SHA 명세와 동결본: `.superpowers/sdd/2026-10-21-ci-unit-split/upload-inputs.json`. 최종 명세의 파일 수와 해시가 우선한다.

최종 분할 집중6시험은163.4ms, 실패0이다. 기존149.8/522.0ms는 중간 실행 이력으로 보존한다.


33차 이후 재인계(2026-10-21): 현재 작업 폴더427개 단위 파일을214/213으로 나누며 ui는 준비 포함33명령이다. T8 연결 검사 6.678초가 fast ui에 추가됐고 T8 연결 자체의 새 단위/네이티브 시험은0이다. 별도 M1/G0 묶음은 main 대비 신규30개이며 기존 reset4개를 포함한34개 집중1.383초다. 지정 후보의 파일 수는 실제 후보에서 다시 계산한다. 분할/워크플로 고정 집중6시험634.6ms, 실패0. 분할 자체의 Actions 소요는 아직 미측정이다. main7765864c의33차 ui 고정 대화 중복 실패와 재실행 녹색은 사용자 전달이며, 이번에 Actions를 새 조회한 결과가 아니다. 최종 SHA는 `.superpowers/sdd/2026-10-21-m1a-teach-handoff/upload-inputs.json` ci 그룹을 따른다. 이전 파일 수/소요는 당시 기록이다.
