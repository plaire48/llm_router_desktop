# Desktop 게이트 운영

기준은 main `aa9bb29f`의 전체 검사다. `scripts/gate-baseline.json`에 당시 39개 말단 명령과 npm pretest를 고정했다. `node scripts/check-gate-coverage.mjs`는 누락, 중복, 인자 변경과 별칭 순환을 검사한다. 새 검사를 추가할 때 고정 목록도 명시적으로 갱신한다.

| 실행 | 환경 | 내용 |
|---|---|---|
| `npm run test:gates:fast` | Ubuntu main/PR/수동 | 단위 시험, 디자인, Electron을 열지 않는 화면 검사. 실행 step 한도 20분 |
| `npm run test:gates:electron` | Windows 릴리스 또는 로컬 | Electron 빌드, native 화면/생명주기/개발/MCP/모션, Chrome과 Electron 프리징 장면 |
| `npm run test:gates` | 로컬 호환 명령 | 집합 보존 확인 뒤 fast와 electron 순차 실행 |

검사는 같은 머신에서 동시에 실행하지 않는다. main fast job은 읽기 전용이고 같은 ref의 이전 실행을 취소한다. 실패 캡처와 결과 JSON/log는 Actions artifact로 7일 보관한다. 실제 fast 실행이 20분을 넘으면 실패이며 설치를 포함한 job 종료 한도와 구분한다.

Windows의 `gates-full`은 패키징 job과 병렬이다. fast가 실패해도 Electron을 실행해 결과를 남기며 실패를 성공으로 바꾸지 않는다. 설치/업그레이드 검사와 gates-full이 둘 다 성공해야 `save-draft`가 같은 run/attempt의 후보를 내려받는다. 커밋, run, attempt와 각 파일 SHA-256을 대조하고 비공개 저장소에서만 draft/prerelease를 만든다. 기존 draft는 덮어쓰지 않는다. 게이트 실패 때 후보나 진단용 GitHub Release를 만들지 않는다.

프리징 검사의 두 환경은 앞쪽 실패에도 모두 실행된다. 장면마다 제어 프로세스가 1초 간격으로 부하와 실행 파일 이름만 수집한다. 명령 인자와 환경값은 수집하지 않는다. 장면의 1분 평균 부하가 4.0을 넘으면 성능 원본/위반을 유지한 채 종료 코드 2(`environment_unstable`)다. 내용/기능 오류, 표본 손상과 필수 표본 누락은 계속 코드 1이다. 2는 통과가 아니며 실행자가 재실행한다. 임계값과 원본 표본은 수정하지 않는다.

Windows의 Unix loadavg/ps 미지원은 `unsupported`로 기록한다. 0 배열을 실제 저부하 증거로 사용하지 않는다. Windows 성능/내용 검사는 그대로 실행하며 회사 SSO, Office COM/NASCA와 설치된 사용자 PC 실측을 대신하지 않는다.

## 실행 기록

Actions run id, URL, fast/full 시간과 artifact는 **Claude 업로드 뒤** 이 표에 기록한다. 로컬 검사나 YAML 파싱을 Actions 통과로 표시하지 않는다.

| 커밋 | run | fast 시간/결과 | full 결과 | 비고 |
|---|---|---|---|---|
| R1 업로드 전 | 미실행 | 미측정 | 미실행 | 로컬 증거와 남은 위험은 루트 `docs/R1-1.3.0.md` |

참조: [GitHub job 조건](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions), [동일 workflow의 artifact 전달과 보존](https://docs.github.com/en/actions/tutorials/store-and-share-data).

Task 8 추가: 원래39개 명령은 유지하고 `check-electron-workflow.mjs`를 명시적 additions로 추가했다. 현재 fast23개/electron17개, 합계40개다.

W1 추가: `check-wiki-scope-ui.mjs`를 fast에 추가했다. 기존39개 + Task8/W1 각1개, 현재 fast24/electron17=41개다. 새 범위 장면은 기존 motion-performance/ui-responsiveness에도 포함된다.
