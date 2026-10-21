# M1-a 답31 재인계와 루틴 연결

기준 main `7765864c`. 로컬 메일 회귀와 같은 합성 30만 통 수용을 통과했다. main 후보 트리 검증과 업로드는 Claude 담당이다.

## 결과와 결정

- 기존 easy80/hard10/hard40/medium40 네 평가 파일의 단언은 main과 바이트 단위 동일하다. 메모리 Store에 디스크 경로가 없어 SQLite worker 생성이 실패했다. 디스크 경로가 없는 기존 호스트 어댑터는 기존 MailSearch를 질의 때 지연 생성하도록 복구했다. 제품 Store의 답31 한도(20,000통 또는 추정 200MiB), 목록 메타 전용, 큰 메일함 메타 검색은 유지한다.
- 네 평가 묶음 **16/16, 19.630초**. 메일/Store/루틴/T8 호스트 및 뷰 집중 **292/292, 46.950초**, 실패0. 새 단위 시험 추가0개. 앞선 M1 순수 Node21개의 833ms는 이전 집중25개 실행이며 이번 292개와 합산하지 않는다. 기존 평가에는 명령 실행이 있으나 새 네이티브 시험은 없다.
- `test:mail-ui` 네 스크립트 exit0. 100행 표시 1280/440=159.6/197.6ms, 선택/키/초안/앵커/재진입 통과. 기존 `check-wave2-ui`도 단언 수정 없이 exit0. design:check, 실제 renderer 빌드, 게이트 집합 검사 통과. 전체 gates는 분할 Actions 담당이며 이번에 전체 실행했다고 표시하지 않는다.

| 같은 M6 입력, 최종 v5 | 측정 | 기준 |
|---|---:|---:|
| 첫50통 | 200.33ms | ≤1,000ms |
| 검색 p95(35질의) | 737.87ms | ≤1,000ms |
| 최대 RSS | 167.69MiB | ≤300MiB |

메타 수집106.70초는 별도다. 원본 `packages/nubi-desktop/verification/mail-list-m1a-20261021-v5/result.json`, 런타임10개 SHA 일치. 말뭉치 SHA `2f358cbab1d9ff257bcd0aa3c0ad5b69606229342432282ef413390fc85ed1ab`는 v4와 동일하다. 환경 부하를 원본에 보존했다. v4의711ms/406ms와 다른 시점이므로 개선율이나 반복 성공률로 묶지 않는다.

## 미업로드 루틴 경로와 지정 파일

`project-service.mjs`의 차이는 listRoutines 인자 전달, listRoutineWorkflows/catalog, resolveRoutinePromotion, 허용 목록 두 항목이다. main의 browserTeach 등록은 보존했다. main에는 그 호출 대상도 없으므로 기존 G0의 `runtime/routines.mjs`, `runtime/routine-ui.mjs`와 `tests/routine-ui.test.mjs`, 그 시험이 사용하는 `ui/routine-inputs.mjs`를 함께 명세에 넣었다. 이 다섯 파일은 이번에 재작성하지 않았다. main 대비 신규 단위는 M1 21개(새 세 파일19개와 기존 reset 추가2개), G0 9개로30개다. 모두 순수 Node이며 새 네이티브 실행은0이다. 이30개와 기존 reset4개를 합친 집중34개는 34/34, 실패0, 1.383초이며 별도 원본 `verification/m1a-teach-handoff/new-unit-cost.log`에 보존했다. G0 화면 전체를 새로 수용한 것은 아니며 기존 보고서는 `WORKFLOW-ROUTINE-G0-2026-10-21.md`다.

전체 파일/SHA/고정 사본: `.superpowers/sdd/2026-10-21-m1a-teach-handoff/upload-inputs.json`의 mail 및 routineBridge 그룹. package.json과 gate-baseline은 T8 연결 검사도 등록하므로 teach 그룹과 같은 업로드에 포함한다. CI 분할 그룹도 같은 명세로 검토할 수 있다. 과거 M1-a 명세는 이 명세로 대체한다.

캡처: `packages/nubi-desktop/verification/mail-thread-card/thread-{1280,440}.png`, `verification/mail-admission/mail-{1280,440}.png`(모두 Desktop 아래). 미검증: 실제 사내 메일/Windows/전체 앱 시작과 레거시 마이그레이션, 본문 FTS 및 암호화 결정 Q22. 원본/실패 측정은 삭제하지 않았다.
