# M1과 T8 게이트 분리 재인계

**결과:** 41차 `fb3022a865f68b239ee000b3258f5fc524714ca7`의 package.json/gate-baseline.json에서 지정 사본을 다시 만들었다. 40차의 check-form-cards-ui 등록과 Claude의 후속 코드는 보존한다. 작업 트리의 두 게이트를 그대로 함께 올리지 않는다.

| 지정 묶음 | 포함 내용 | 공유 파일 적용 |
|---|---|---|
| `.superpowers/sdd/2026-10-21-m1-gate/` | 기존 M1 메일 코드/fixture/시험/보고, 요청받은 루틴 연결 5파일, check-mail-thread-card | 41차 + thread-card만 |
| `.superpowers/sdd/2026-10-21-t8-gate/` | 기존 T8 화면 연결/UX/고정 경합/fixture/시험/보고, check-browser-teach-connection | **M1 묶음 다음**. 두 검사를 함께 유지 |
| `.superpowers/sdd/2026-10-21-ci-split-handoff/` | 기존 unit-a/unit-b 분할, 워크플로와 고정 시험, CI 문서 | 위 두 묶음과 별도 업로드 가능 |

각 폴더의 `upload-inputs.json`에 모든 파일과 SHA, frozen 위치가 있다. 패키지/게이트 두 파일은 후보용 투영이며 작업 트리에 덮어쓰지 않는다. M1을 먼저 적용하고 T8을 적용한다. T8만 먼저 올리거나 그 사이 main이 바뀌면 공유 파일은 최신 main에서 다시 합치고 SHA를 재발급해야 한다. 루틴 project-service 사본은 현재 파일의 main 대비 차이가 요청받은 listRoutines 인자/목록/승격 연결뿐임을 다시 확인했다. Claude의 documentForm/browserTeach 등록을 보존했다.

재검사: 메일/가르치기/Office/양식 집중 302/302, 28.60초. 루틴/워크플로/CI 분할 집중 22/22, 2.37초. T8 연결 8장면, 스레드 카드 2장면, 기존 strict check-wave2-ui 모두 통과. 각 후보 게이트 집합과 합쳐진 게이트 집합 검사 통과. 첫 집중 실행의 localhost EPERM은 포트 허용 후 재실행해 해소했다. 원래 메일 4개 평가 단언은 바꾸지 않았다. **이번은 지정 파일/게이트 검증이며, 실제 main 전체 후보 트리 입력 검사와 Actions 통과를 뜻하지 않는다.**

새 기능/새 단위 시험을 이 재인계에서 추가하지 않았다. 기존 M1/G0와 T8 시험 소요/30만 통 실측은 기존 보고서에 남긴다(이번에 30만 통 재측정 안 함). 현재 로컬 단위 파일 436개를 218/218로 나누지만 지정 후보의 실제 파일 수와 시간은 Actions에서 다시 잰다. Windows full 게이트와 전체 npm test는 바꾸지 않았다. 업로드/릴리스는 Claude 담당이다.

캡처: `packages/nubi-desktop/verification/browser-teach-connection/`의 내부/외부 1280/440 및 `verification/mail-thread-card/thread-{1280,440}.png`. 실제 외부 브라우저/사내 페이지 왕복 성적은 포함하지 않는다. CI 분할은 화면 변경 없음. 새 머리글/POP3 및 Task H는 별도 SHA 묶음이다.
