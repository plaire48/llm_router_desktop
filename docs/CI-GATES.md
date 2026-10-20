# CI 실행 확인

실행 계약과 게이트 분리는 [Desktop CI-GATES](../packages/nubi-desktop/docs/CI-GATES.md)를 따른다.

| 통보 기준 커밋 | run id | 상태 | 확인 경계 |
|---|---|---|---|
| `aab27988` | [39354229033](https://github.com/plaire48/llm_router_desktop/actions/runs/39354229033) | failure | fast의 pretest 빌드에서 `../nubi-browser-agent/src/index.ts` 미포함. 최초 404는 예전 저장소 `nubi-workspace-private-builds`를 조회했기 때문이었다. 실제 저장소는 `plaire48/llm_router_desktop`으로 확인 |
| `3c268aa9` | [39356806537](https://github.com/plaire48/llm_router_desktop/actions/runs/39356806537) | failure | fast 단위 시험의 30k 초기화가 snapshot_git/history에서 ENOENT로 attention. Git 자동 정리와 사본 복사의 경쟁을 재현하고 수정. 아래 보고서와 지정 파일 참조 |
| `d46cc371` | [39359581822](https://github.com/plaire48/llm_router_desktop/actions/runs/39359581822) | failure, Claude 통보 기준 | Linux 단위 전체와 design/forms 통과. mail-ui의 all100 within300ms 실패. 제품 300ms는 유지하고 아래 러너 보정을 적용 |

CI 실패가 확인되면 이 문서에 실패 job/step, 원인, 수정과 재실행 id를 적는다. 접근 실패를 CI 원인으로 대신 쓰지 않는다.

## 30k Linux 실패 수정 인계

[보고서](LINUX-30K-FIX-2026-10-20.md). 업로드할 제품/시험 파일은 `packages/nubi-desktop/runtime/wiki-folder-history.mjs`와 `packages/nubi-desktop/tests/wiki-git-preparation.test.mjs` 두 개다. 문서는 이 파일과 보고서를 포함할 수 있다. W0의 미완료 `wiki-durability.test.mjs`와 다른 작업 파일은 이 수정에 포함하지 않는다. 수정 후 Linux Actions 결과는 아직 없으며 새 run id와 판정은 업로드 뒤 기록한다.

후속 확인: 위 수정은 d46cc371로 업로드됐고 run 39359581822에서 Linux 단위 전체가 통과했다고 Claude가 통보했다. 아래 admission 문제와 구분한다.

## Admission 러너 보정 (2026-10-20 사용자 결정)

제품의 300ms와 16ms 묶음, 행 수, 초안/선택/키/앵커 계약은 변경하지 않는다. 검사에서만 빈 셸에 합성 100행 700셀 표를 한 번 렌더하고, layout부터 다음 presentation 기회까지의 시간을 잰다. Mac에서 고정한 동일 작업의 기준 시간과 비율을 구한다. 표본을 재시도하거나 버리지 않는다. CI 자신의 측정값으로 기준선을 갱신하지 않는다.

```text
ratio = runnerReferenceMs / fixedMacReferenceMs
budgetMs = 300 * max(1, min(2, ratio))
ratio > 2 => environment_unstable, exit 2
invalid/missing reference or functional assertion => exit 1
```

Mac 기준은 arm64, Chrome 155.0.8059.85, 2026-10-20T02:57:27.712Z 실측이다. 1280은 34.700ms(layout 30.100), 440은 15.300ms(layout 13.500)이며 첫 렌더의 차이도 원본 그대로 보존했다. 기존 메일 157ms를 기준 작업의 시간으로 대신 쓰지 않았다. 버전 1 기준값과 원본 메타데이터는 공통 모듈 안에 고정한다.

아래 표는 최초 별도 검사의 측정값이다. 원본은 `.superpowers/sdd/2026-10-19-nubi-openwiki-reinforcement/admission-measurements.json`과 각 `admission-*-after*.log`에 보존한다. `verification/`의 JSON은 후속 전체 게이트가 최신 측정으로 갱신하므로 값이 달라질 수 있다.

| 검사 | 너비 | 기준 작업 ms | Mac 기준 ms | 실제 비율 | 적용 예산 ms | 실제 admission ms |
|---|---:|---:|---:|---:|---:|---:|
| mail | 1280 | 15.500 | 34.700 | 0.4467 | 300.000 | 167.700 |
| mail | 440 | 16.400 | 15.300 | 1.0719 | 321.569 | 160.800 |
| conversation 최근 40 | 1280 | 16.900 | 34.700 | 0.4870 | 300.000 | 182.100 |
| conversation 최근 40 | 440 | 16.500 | 15.300 | 1.0784 | 323.529 | 180.000 |
| chat-history 최근 40 | 440 | 18.700 | 15.300 | 1.2222 | 366.667 | 174.700 |

세 검사 모두 로컬 Chrome exit 0. 경계 시험 3개도 통과했다(1.5배=450ms, 2배=600ms, 2배 초과 exit 2, 잘못된 기준은 오류, 기능 실패를 환경 오류로 삼키지 않음). conversation의 이전 40개 검사에도 동일 예산을 적용했다. chat-history는 기존에 300ms 수치 단언이 없어 실제 DOM admission 관찰과 300ms 기반 검사를 추가했고, 기존 이력 보존 검사는 유지했다.

원본 결과 JSON:

- `packages/nubi-desktop/verification/mail-admission/calibration-{1280,440}.json`, `timing-{1280,440}.json`
- `packages/nubi-desktop/verification/conversation-admission/initial-{1280,440}.json`, `previous-{1280,440}.json`, `calibration-{1280,440}.json`
- `packages/nubi-desktop/verification/chat-cold-open-2026-10-15/admission-440.json`, `regression.json`, `calibration-440.json`

지정 파일은 `packages/nubi-desktop/scripts/` 아래 `admission-calibration.mjs`, `check-mail-admission.mjs`, `check-conversation-admission.mjs`, `check-chat-history-window.mjs`다. 메일만 보정하면 앞의 두 파일이지만 세 검사에 함께 적용하려면 **4개 모두** 필요하다. 이번 검증은 이 네 파일과 이 문서만 인계하며 W0의 runtime/ui/core/tests 변경은 섞지 않는다.

지정 파일 패치와 SHA는 `.superpowers/sdd/2026-10-19-nubi-openwiki-reinforcement/admission-calibration-fix.patch`, `admission-fix-inputs.json`에 있다. 원본 Mac 기준과 검사 로그, 3개 경계 시험도 같은 폴더에 보존했다. 수정 후 Ubuntu 결과와 전체 게이트 통과는 아직 주장하지 않는다. 다음 Actions가 실제 러너 비율과 exit 0/1/2를 판정한다.


## Actions 8차: 공용 러너의 시간 미판정 기록

Claude 통보: run `39372603559`에서 35.8ms / 15.3ms = 2.34배로 environment_unstable(exit 2)이 나와 체인이 멈췄다. 릴리스 계획 R1 앞의 15:20 결정대로 수정했다. 위의 exit 2 설명은 최초 보정판의 이력이며, 아래 규칙이 최신이다.

- Ubuntu gates-fast만 `NUBI_SHARED_RUNNER=1`을 명시한다. 2배 이내면 기존 시간 판정을 유지한다. 초과하면 보정은 종료하지 않고 세 admission 검사의 기능 단언을 끝까지 수행한다. 300ms 계약과 2배 상한(600ms)은 바꾸지 않는다.
- 시간 수치와 비율은 기존 JSON에 보존한다. 미판정이면 `verdict: unjudged`이며 시간 초과를 통과로 표시하지 않는다. 정상 행 수, 첫 표시 범위, DOM 키, 선택, 초안과 스크롤 앵커는 계속 판정한다. 잘못되거나 누락된 시간 표본도 오류다.
- freeze는 공용 러너의 빈 셸 불안정에서도 실제 장면을 실행한다. 부하 또는 빈 셸로 미판정인 행의 알려진 시간 한도만 판정에서 제외하며 원본 위반과 모든 표본을 보존한다. 샘플 누락, 가상화, 네이티브 입력 준비, 행 수, 페이지 오류 등은 실패다. 안정된 장면의 시간 위반은 여전히 실패다.
- 기능 검사를 모두 마친 미판정 항목만 `verification/unjudged.json`에 모은다. 같은 실행에서 중복은 교체하고 새 Actions run/attempt와 섞지 않는다. workflow의 always summary가 `미판정 N건`을 쓰고 실패 또는 미판정 때 캡처/JSON을 7일 보관한다. 로컬과 Windows에는 이 opt-in을 켜지 않아 기존 exit 2가 유지된다.

로컬 검증: 경계와 freeze 회귀 25/25. 실제 Chrome의 mail, conversation, chat-history 세 검사 exit 0. 별도의 화면 전환 장면 1280/440은 기능을 모두 수행한 뒤 부하로 시간 미판정 2건, exit 0. 이 결과는 시간 기준 통과나 Ubuntu Actions 9차 성공이 아니다. 실제 workflow YAML을 읽어 summary shell을 실행해 미판정 0건/2건 표시와 손상 마커 실패도 확인했다.

지정 업로드는 스크립트 5개와 `.github/workflows/nubi-desktop-gates.yml` 총 6개다. SHA와 로그는 `.superpowers/sdd/2026-10-19-nubi-openwiki-reinforcement/shared-runner-upload-inputs.json`, `shared-runner-*.log`, `shared-mail.log`, `shared-conversation.log`, `shared-history.log`, `shared-freeze.log`에 있다. W0 제품 변경은 이 지정 업로드에 포함하지 않는다. R1/Q2의 연속 3회 녹색과 20분 상한은 아직 확인 전이다.

전체 단위 후보는 2,405개 중 2,204 통과, 200 건너뜀, 1 실패(전체 실행 약 9분)였다. 실패는 수정 전 읽힌 workflow의 아티팩트 조건이었다. 기능 단언 실패가 아니며 YAML을 수정한 뒤 해당 workflow 시험 2/2와 새 경계 시험 8/8을 다시 통과했다(`shared-workflow-green.log`, `shared-runner-final-targeted.log`). 전체 후보 원본 실패는 `shared-runner-unit.log`에 그대로 남겼다. 전체 test:gates의 최종 통과로 표시하지 않는다.


## Actions 9~13차와 main63784e52

Claude의 통보와 로컬 반영 코드를 대조했다. 업로드와 Actions 결과 전달은 Claude가 맡는다.

| 차수 | run id | 결과 | 원인과 후속 |
|---|---|---|---|
| 9 | 39376995329 | 실패 | check-motion-performance: 필터 직후 집합 selector가 여러 행과 일치해 strict mode violation. Claude가 걸러진 행의 접근성 이름으로 수정. check-ui-responsiveness, check-wiki-scope-ui도 같은 기준 정리 |
| 10 | 39379057057 | 실패 | check-mail-admission all100 334ms. 기준 작업 비율1.03이라 시간 판정됐으나 이후 경합은 보장되지 않음. 공용 러너 시간은 보정 비율과 무관하게 항상 unjudged로 기록하도록 Claude가 변경 |
| 11 | 39381824821 | 실패 | Linux 단위 2,409개 실패 0(W0 포함), 메일 수락 시간 미판정 2건으로 기능 검사 통과. check-motion-performance의 폴더 범위 시트 원시 50ms 단언에서 59ms/53ms로 실패. Claude가 세 시간 단언을 judgeMainThread로 통일해 공용 러너에서는 unjudged로 기록하도록 수정하고 main81618746에 업로드 |
| 12 | 39385119972 | 실패 | 모션 시간 미판정 12건(당시 총14건)으로 진행. check-vscode-capabilities가 참조하는 nubi-vscode 시험 fixture가 업로드 범위에서 빠져 esbuild 실패. Claude가 릴리스 계획에 기록한 대로 41파일 업로드 범위를 복구, 제품 코드는 변경하지 않음 |
| 13 | 39387314601 | 녹색(첫 성공) | main63784e52, 14분54초로20분 상한 충족. 기능 단언 통과, 시간 미판정16건(메일2, 모션12, 대화2)은 summary에 기록. Q2 연속 녹색1회로 계수 |

**현재 규칙:** 공유 러너의 시간 한도는 항상 unjudged, 기능과 잘못된/누락된 표본은 계속 판정한다. 공용 러너용 검사의 시간 단언은 `assertAdmissionTiming`이나 `judgeMainThread` 같은 판정 도우미를 거친다. 원시 `assert`로 시간을 판정하지 않는다. 미판정 원본 시간과 사유는 결과 JSON과 `verification/unjudged.json`에 남긴다. 300ms 계약, 보정2배 상한, SCENE_LOAD_LIMIT4와 모든 성능 한도는 불변이다. 로컬 장면 부하 가드는 시간 위반을 미판정으로 분류하는 데만 쓰고, 위반0인 장면의 통과를 무효로 만들지 않는다(설계§8답15). 고부하 통과는 loadedScenes로 기록한다. 이전 차수의 조건부 시간 판정 설명은 당시 이력이다.

W0는 main7a809f9d로 수용됐다. 로컬에서 Claude독립Q1의20/20과 w0-claude-2-20261020의Chrome/Electron각12장면exit0/위반0, 관련코드와 시험을 확인했다. **Q2 연속3회녹색은 13차부터 센다. 현재1/3회이며 Q2는 미완료다.** 첫 성공은14분54초로20분 상한 안이다. 다음 성공은 W3 지정 업로드로 발생하는 자연스러운 Actions 실행으로 이어 센다. 같은 커밋 재실행으로 횟수를 채우지 않으며, 시간 미판정16건을 목표 하드웨어 성능 통과로 합산하지 않는다. 이후 실패하면 연속 성공 수를 다시 센다.
