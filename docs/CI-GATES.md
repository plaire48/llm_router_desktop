# CI 실행 확인

현재 판정(2026-10-20 사용자 확정): **Q2 충족**. 수용 실행은13차39387314601,16차39395380501,17차39413484715의 연속3회이며 모두20분 이내다.17차는 워크플로16분24초, unit16분19초(미판정0), ui6분50초(미판정16). 아래 실패/진행 중/미완료 문구는 당시 이력이며 현재 판정을 뜻하지 않는다. main 보호 설정과 Windows/실기기 판정은 별도다.

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

W0는 main7a809f9d로 수용됐다. 로컬에서 Claude독립Q1의20/20과 w0-claude-2-20261020의Chrome/Electron각12장면exit0/위반0, 관련코드와 시험을 확인했다. **Q2 연속3회녹색은 13차부터 센다. 현재 기록은 아래14차 갱신을 따른다. Q2는 미완료다.** 첫 성공은14분54초로20분 상한 안이다. 다음 성공은 W3 지정 업로드로 발생하는 자연스러운 Actions 실행으로 이어 센다. 같은 커밋 재실행으로 횟수를 채우지 않으며, 시간 미판정16건을 목표 하드웨어 성능 통과로 합산하지 않는다. 이후 실패하면 연속 성공 수를 다시 센다.


## Actions 14~17차와 fast unit/ui 분할

14차는 녹색이지만 **Q2 제외**다. 전체 워크플로/작업의20분 상한을 적용하며, 내부 fast 단계19분53초만 보고 수용했던 Codex의 이전2/3 기록은 잘못이었다. 당시 Q2는1/3이었다. 원본 시각과 미판정 기록은 바꾸지 않는다. 아래 실제 상태는 GitHub API를 읽기 전용으로 확인했고 Q2 계수는 릴리스 계획의 Claude 확정 기록을 따른다.

| 차수 | run / main | 결과 | 시간과 원인 | Q2 기록 |
|---|---|---|---|---|
|14|[39390196350](https://github.com/plaire48/llm_router_desktop/actions/runs/39390196350) /081fbdcf|녹색, 수용 제외|단일 job21분37초. fast 단계19분53초. 단위 시험506→817초(Claude 통보). 준비와 전체 작업을 빼고 판정하지 않는다|1/3 유지|
|15|[39393371187](https://github.com/plaire48/llm_router_desktop/actions/runs/39393371187) /a86a04c7|실패|전체15분17초. unit job15분12초/게이트13분50초, ui job7분14초/게이트5분47초(통과). 단위 시험의 desktop-gates-workflow.test.mjs가 이전 단일 npm run test:gates:fast 단계를 찾다 assert.ok(gate) 실패. Claude가 matrix/run-gate-part 기준으로 시험을 갱신|성공 추가 없음|
|16|[39395380501](https://github.com/plaire48/llm_router_desktop/actions/runs/39395380501) /9cbdff66|녹색|전체15분28초. unit job15분19초, ui job6분12초. 분할 이후 첫 완전 녹색. ui 미판정16건은 Claude 릴리스 기록 기준|릴리스 계획에서13·16차를2/3로 확정|
|17|[39413484715](https://github.com/plaire48/llm_router_desktop/actions/runs/39413484715) /aefa2e13|녹색(API 확인)|전체16분24초(11:14:02Z~11:30:26Z), unit16분19초/ui6분50초. W3-UI/W4/S1 59파일 포함. 미판정 unit0/ui16(사용자 최종 통보)|사용자 합의대로3/3|

### 분할 규칙과 검사 추가 시 기록

- `scripts/run-gate-part.mjs`가 기존 package.json의 test:gates:fast를 펼친다. unit은 npm test 하나(기존 pretest 포함), ui는 npm run pretest 뒤 나머지 leaf 명령을 기존 순서대로 실행한다. package.json을 분할용으로 바꾸거나 검사를 빼지 않는다.
- workflow의 matrix part는 [unit, ui], fail-fast false이며 병렬 실행한다. Chrome 설치는 ui에만, 읽기 전용 권한/미판정 summary/7일 보관 아티팩트는 각 작업에 유지한다. 각 게이트 단계 timeout20분은 유지하고 Q2는 전체 워크플로 소요를 기준으로20분 이내인지 확인한다. job timeout35분을 Q2 상한으로 오인하지 않는다.
- fast 체인에 검사를 추가할 때 **unit과 ui 양쪽의 기존/추가 후 작업 소요, 해당 run id, 전체 소요와 임계 경로**를 한 묶음으로 적는다. 단위/화면 명령이 어느 쪽에 추가되는지와 pretest 중복 비용도 명시한다. ui만 약7분이라고 쓰고 unit 약14분을 생략하지 않는다. 최신 완료16차의 실제 job은 unit15분19초/ui6분12초이며 unit이 임계 경로다.17차 최종값은 unit16분19초/ui6분50초, 전체16분24초다.
- 결과 미수신/진행 중은 예상값으로 채우지 않는다. 공용 러너의 시간 미판정을 목표 환경 성능 통과로 표시하지 않는다. 검사 기능 단언과 모든 표본은 유지한다.
- 새 단위 시험을 추가할 때 보고서에 추가 건수, 집중 시험의 실제 wall time, 네이티브 실행 여부와 대기/재시도 비용, 기준17차 unit job16분19초/ui6분50초/전체16분24초와 다음 CI의 실제 unit/ui/전체 소요를 적는다. 특히 실제 네이티브 실행 시험은 임계 경로 약15분에 미치는 비용을 숨기지 않는다. 로컬 집중 시간이나 시험 내부 ms를 CI 증분으로 추정하지 않으며, 다음 실행 전에는 CI 추가 후 소요를 미측정으로 남긴다. 이번 문서 정정은 새 단위/네이티브 시험0건이다.
- workflow 변경 때 `tests/desktop-gates-workflow.test.mjs`를 같은 업로드에 포함한다. `tests/run-gate-part.test.mjs`는 두 부분의 합이 원래 체인과 같고 ui 순서가 그대로임을 검사한다. 로컬 두 시험 파일4/4 통과와 unit/ui --list 대조를 완료했다. 제품/검사 코드는 이번 문서 정정에서 변경하지 않았다.

W3-UI 후속 소스10파일의 현재 SHA-256과 main aefa2e13의 git blob SHA가 기존 명세와 전부 일치한다. 이미 업로드된 제품 소스를 재구현하거나 중복 업로드할 필요는 없다. 문서 정정은 별도 지정 업로드하며17차 최종 성공을 아래 이력에 추가했다.17차를 채우려고 재실행하지 않는다.

17차 최종 확인(2026-10-20): GitHub API completed/success, 두 작업 success. 사용자가 확정한13, 16, 17차의 수용 녹색3/3으로 Q2의 연속 성공/20분 기준을 충족했다. 미판정은 unit0/ui16이다. main 보호 필수 체크 설정과 Windows gates-full/실기기 수용을 이 결과로 대신하지 않는다. unit의 최신 임계 경로는16분19초이므로 다음 추가 시험의 보고에는16차15분19초와17차16분19초를 모두 기준 이력으로 적는다. 앞의17차 진행 중 문구는 중간 관측 이력이며 이 최종 기록이 우선한다.

2026-10-20 운영 보강: 20분 기준 unit 여유는3분41초(전체 워크플로 여유3분36초)다. 새 단위 시험, 특히 네이티브 실행 시험은 보고서에 건수/집중 wall/실제 네이티브 여부/재시도와 대기 비용/다음 CI 증분을 적는다. Q8 보고에는 unit 재분할과 실제 네이티브 시험의 Windows gates-full 이관을 비교한다. 어느 안도 검사를 생략하거나 미실행 플랫폼을 통과로 표시하지 않으며, 지금 workflow를 바꾸는 결정은 아니다.

## Actions18차와 Q3 v2

Actions 18차 `39425332493` (`main d0643712`)는 녹색이다. 사용자 전달 결과: 워크플로 **16분 16초**, unit **16분 12초 / 미판정 0건**, ui **8분 7초 / 미판정 16건**. Q2는 충족 상태를 유지한다(최초 13, 16, 17차, 후속 16, 17, 18차). 미판정 16건을 목표 PC의 성능 통과로 표시하지 않는다. Q3 v1은 업로더 실제 연결에서22건이 나와 보류됐고, v2는 generated/node_modules 없는 실제 main 기반 후보의 업로더 dry-run으로 판정한다. v1의 작업 폴더 복사 후보 통과를 실제 후보 통과로 소급하지 않는다. v2 보고와 명세를 다음 지정 업로드에 함께 싣는다.

## Q6 안전 게이트와 비용

fast ui의 test:safety는 기존 안전107시험 재사용과 고정 base→후보 증분/127개 선언 검사를 더한다. 기존107시험의 로컬 기준선은11.110초이며 새31시험/정확한 소요는 Q6 보고서에 기록한다. 다음 Actions의 unit/ui 추가 후 소요는 미측정이다. 기준18차 unit16:12/ui8:07을 로컬 시간으로 대체하지 않는다. Windows gates-full은 전체 소스 감사를 별도 아티팩트로 보존하고 실제 최종 payload를 --payload-only로 만들어 ASAR/extraResources까지 차단 검사한다. 설치판 패키징도 같은 검사를 수행하며 save-draft는 여전히 두 작업 성공 뒤에만 열린다. 공개 발견은 정확한 파일 SHA와 값 지문/출처/검토 근거를 바인딩하며 미확인/변경된 발견은 실패다. Mac payload17,699검사 통과는 Windows/설치판 통과가 아니다.

## Q8 CI 비용 분석 (2026-10-21, 구성 변경 없음)

17차 원본 로그/소스aefa2e13을 대조했다. Node wall894.456초, unit job979초, ui410초, 전체984초. 개별 시험 합545.542초를 wall이나 병렬 예상으로 쓰지 않는다. 실제 위키20k131.120초/30k47.347초, 브라우저 비교11.610초. Windows 전용 실행3개는Linux에서skip1.37ms여서 Windows 이관만으로 임계 경로를 줄인다고 주장하지 않는다. Linux unit 균형2분할을 권장하지만 이번에 workflow/이관을 구현하지 않았다. 원본398파일/현재 파일 전체와 SHA/플랫폼 책임을 .superpowers/sdd/2026-10-20-release-acceptance/q8-ci-test-inventory.json에 보존하고 누락0을 확인했다. 새 Q8 순수 단위9개 집중0.095초, 실제 네이티브 단위 추가0, 집중35개0.540초. 업로드 뒤 unit/ui/전체 증분은 아직 미측정이다. 기존 전체 집합, Windows gates-full과 릴리스 차단을 유지한다. 상세 docs/MEMORY-Q8-2026-10-21.md.

Q7 G5/Q8 후속(2026-10-21): G5는 기존 fast ui 화면38개 흐름에서 이름/대비/Tab순환을 함께 검사한다. 새 Node/네이티브 단위0. 브라우저 계약31개1.88초(기존13개1.31초), 공유 화면46.75초 중 감사1.019초는 로컬 관찰이며 CI 증분은 미측정이다. Q8 메일1280 격리Electron 재측정은 입력41ms/한도50ms, 작업/프리징/힙위반0, exit0. 높은 부하에서도 위반0은 통과하는 답15를 유지했다. 전체Actions 또는 Windows 성공으로 확대하지 않는다.

지정 후보 차단(2026-10-21): G5 포함93파일의 첫 실제Claude업로더 대조에서 `release_input_changed`4건이 나왔다. 병행 작업이 이어져 다음 대조에는 `runtime/openwiki-source.ts`까지5건이었다. 정확한 후보별 수치/경로는 최신 SHA명세와 입력 검사 JSON을 따른다. main a837ad61에 없는 병행 위키 문맥 접기/검토 복구 변경(`extensions/aipro-chat/openwiki-agent.js`, `packages/nubi-desktop/runtime/desktop-features.mjs`, `packages/openwiki/src/agent/repository-runner.ts`, `packages/openwiki/src/agent/repository-semantic-review.ts`)이 현재 compile 입력에 포함된 원인이다. 이 병행 파일들을 임의로 업로드 목록에 넣거나 비교에서 빼지 않았다. 최신93파일 명세는 **로컬 검토용, 후보 입력 게이트 차단** 상태다. 이전91파일 실제후보 exit0는 이전소스 증거로만 유지한다. Claude가 병행 변경을 검토해 같은 후보에 정합시킨 뒤 실제 입력 게이트를 다시 돌려야 한다. 상세 SHA는 `.superpowers/sdd/2026-10-20-release-acceptance/q3-q8-g5-parallel-inputs.json`.
