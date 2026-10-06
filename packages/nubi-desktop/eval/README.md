# 누비 workspace 실측 평가

실제 모델로 고정 과제를 돌리고 관찰한 결과만으로 채점한다. 제품 번들에 포함하지 않는다.

## 실행

터미널 두 개를 쓴다. 첫째 터미널은 로그인을 유지하고, 둘째 터미널에서 평가를 반복 실행한다.

```bash
# 첫째 터미널: 브라우저에서 로그인한다. READY가 나오면 그대로 둔다.
# Office 평가의 세션과 소켓이 다르므로 두 세션을 함께 띄울 수 있다.
node eval/model-session.mjs --provider chatgpt --model gpt-5.6-luna
```

```bash
# 둘째 터미널: 개발용 과제 전체
node eval/run.mjs --split dev
```

| 옵션 | 뜻 | 기본값 |
|---|---|---|
| `--cases W1-ngrok-default-port,C2-free-shipping-threshold` | 실행할 과제 | 전체 |
| `--suites wiki,edit` | 실행할 묶음 | 전체 |
| `--split dev` | `dev`, `holdout`, `all` | `all` |
| `--trials 3` | 과제당 반복 횟수 | 1 |
| `--out <폴더>` | 결과 폴더 | `verification/eval-live/<시각>` |
| `--socket <경로>` | 모델 세션 소켓 | 사용자별 임시 폴더 |
| `--tools lean` | 창 크기와 상관없이 핵심 도구만 먼저 보내고 나머지는 `select_tools`로 부른다. 제품은 창 크기로 정한다 | 창 크기로 정함 |

두 보고서를 비교한다.

```bash
node eval/compare.mjs <이전>/report.json <이후>/report.json
```

서로 다른 모델은 같은 후보와 조건을 기록한 실행 폴더로 비교한다. `manifest.json`, `completion.json`, `agent/report.json`, `computer/report.json`이 모두 필요하다. 일부 과제만 끝났거나 후보/자료/한도가 다르면 비교를 거부한다. 기존 `compare.mjs`는 같은 모델의 수정 전후 비교로 유지한다.

```bash
node eval/compare-models.mjs verification/eval-live/R32-catalog-comparison/luna verification/eval-live/R32-catalog-comparison/sol
```

현재 비교 과제와 한계는 [하네스 비교 기록](../docs/HARNESS-COMPARISON-2026-10-01.md)을 따른다.

## 결과 읽기

| 결과 | 뜻 | 통과로 셈 |
|---|---|---|
| `passed` | 모든 검사 통과 | 예 |
| `failed` | 검사 하나 이상 실패 | 아니오 |
| `needs_review` | 검사는 통과했으나 사람이 확인해야 함 | 아니오 |
| `needs_human` | 과제가 정의하지 않은 질문이나 대기가 발생 | 아니오 |
| `invalid` | 과제의 전제가 성립하지 않음. 예: 압축이 일어나지 않음 | 아니오 |
| `error` | 한도 초과, 세션 끊김, 실행 오류 | 아니오 |
| `not_run` | 모델 세션이 없어 실행하지 않음 | 집계에서 제외 |

과제별 폴더의 `result.json`에 답변과 검사 결과가, `transcript.jsonl`에 모델 호출 전체가, `metrics.json`에 계측이 있다.

실모델 평가는 제공자 카탈로그의 문맥 한도를 그대로 사용한다(사용자 재확인 2026-10-01). AI Pro의 모델별 256K/512K/1M 한도를 임의로 줄이지 않는다. 기본 과제 선택은 `modelLimits`가 있는 과제를 제외하고, 평가 실행기도 한도 덮어쓰기를 거부한다. 이전 L1 22K 과제와 압축 진단기는 회귀 자료로 보존하며 사용자가 별도로 요청한 진단에만 사용한다. 과거 보고서의 `quality.reducedWindow`는 실제 모델 품질 비교에서 제외한다.

X1~X3은 긴 문맥 과제다(2026-09-30). X1과 X2는 1,600~2,700줄 파일 전체에서 답을 모으고, X3는 긴 파일을 여러 번 읽는 6턴 대화 끝에 앞 내용을 다시 묻는다. 앱 조작의 A16은 요소가 약 200개인 화면에서 150번째 뒤의 항목 값을 읽는다.

## 한도

평가 한도는 제품 한도가 아니다.

| 한도 | 값 | 대상 |
|---|---:|---|
| 과제 시간 | 20분 | 과제 하나. Wiki 전체 검토 한 번이 10분을 넘는다 |
| 모델 호출 | 80회 | 주 에이전트와 그 계획, 검토, 요약 |
| 위임 호출 | 400회 | OpenWiki 에이전트. 첫 메시지가 `Plan OpenWiki research` 또는 `You are OpenWiki's`로 시작하는 호출 |
| 사용자 응답 | 12회 | 질문 답변과 이어가기 |

위임 호출을 따로 세는 이유: Wiki 질문은 OpenWiki 에이전트에 넘기고 그 방식은 바꾸지 않는다(사용자 결정 2026-09-29). Wiki 전체 검토 한 번이 약 150회 호출이다.

## 다른 평가

| 평가 | 명령 | 재는 것 |
|---|---|---|
| 압축 품질 | `node eval/compaction.mjs --socket <경로> --out <폴더>` | 압축 뒤에 남은 내용. 질문 17개 |
| 앱 조작 | `node eval/computer.mjs --socket <경로> --out <폴더>` | 가상 Windows 앱에서의 읽기, 입력, 거절, 묶음 승인. 과제 26개. A12~A15는 OpenWiki 에이전트에게 규정을 묻고 그 답과 근거로 앱을 고친다. A17~A26은 마우스와 키보드(검색 뒤 Enter, 더블 클릭, 오른쪽 클릭 메뉴, 마우스 올리기, 드래그, 화면 밖 항목, 이어 쓰기와 Ctrl+S, 시스템 키와 비밀번호 거절, 누를 수 없는 컨트롤 클릭) |
| OpenWiki 갱신 | `node eval/wiki-update.mjs --socket <경로> --out <폴더>` | 주문 서비스 자료에서 OpenWiki로 Wiki를 만든 뒤(준비) 원본 하나를 바꾸고, Desktop의 갱신 흐름(상태, 제안, 실행, 반영)을 잰다 |

압축과 앱 조작 평가는 `--only <ID 앞부분>`으로 일부만 실행한다.

압축 시나리오 P1의 창은 21,500토큰이다(2026-09-30, 이전 22,000). 에이전트에서 VOC 도구 두 개와 그 안내를 뺀 뒤(사용자 결정 2026-09-30) 고정 부분이 약 500토큰 줄어, 같은 압축 압력을 유지하도록 그만큼 줄였다.

명령 묶음(`--suites command`, E1~E6, 2026-09-30)은 에이전트가 제안한 명령을 이 PC의 Bash로 실제 실행한다. 가상 사용자는 과제의 `commands`에 적은 명령만 승인한다. 이 목록은 정답이 아니라 이 PC에서 모델 명령을 돌리기 위한 안전 울타리다. 명령 하나(끝의 `2>&1`, `| tail -n 숫자`, 작업 폴더로의 `cd ... &&`는 떼고 읽음)만 받고, 다른 셸 연산자나 관리자 권한 명령은 사람이 결정할 일로 남긴다(`needs_human`). 멈출 때마다 허용된 수정안을 먼저 반영하고 명령을 승인한 뒤, 명령이 끝나고 호스트가 결과를 읽으려고 시작한 실행이 끝날 때까지 기다린다. 수정안을 반영했는데 기다리는 명령이 없으면 편집기처럼 작업을 한 번 이어서 실행한다. 채점의 `commands`는 호스트의 실행 기록에서 실제로 시작한 명령만 세고, `lastExitCode`는 마지막으로 맞는 명령의 종료 코드를 본다. PowerShell과 CMD는 이 PC에서 재지 않는다. E5(없는 스크립트)와 E6(잘못 적은 경로)은 사용자가 적은 명령이 틀린 경우다. 실패한 뒤 고친 명령을 제안해 목표를 이루는지 본다. E5는 보류용으로 만들었다가 첫 결과(S27)를 보고 지침을 넣었으므로 개발용으로 옮겼고, 보류용은 E6이다.

앱 조작 평가의 가상 사용자는 실제 마우스나 키보드 입력을 승인할 때 카드가 묻는 동의(마우스 제어, 키보드 입력)도 함께 준다. 가상 앱은 포커스, 키, 입력한 글자, 클릭, 더블 클릭, 오른쪽 클릭, 마우스 올리기, 드래그, 스크롤에 규칙대로 답한다. 앱 조작 평가의 가상 사용자는 묶음 승인을 한 번에 결정한다. 묶음의 단계 하나라도 과제가 금지한 컨트롤을 대상으로 하면 묶음 전체를 거절한다. 보고서는 묶음 승인 수와 묶음에 든 입력 수를 따로 센다.

더 강한 모델로도 잰다. 같은 하네스에서 강한 모델도 실패하면 하네스의 결함일 가능성이 높다.

```bash
node eval/model-session.mjs --provider chatgpt --model gpt-5.6-sol
```

## 사내 모델로 재기 (회사 PC)

사내 모델(AI Pro)은 회사 PC에서만 잰다. 개발 Mac에서는 AI Pro 주소가 풀리지 않는다. 지금까지의 측정은 모두 ChatGPT의 gpt-5.6-sol, gpt-5.6-luna로 했다. 실제로 쓸 모델에서의 품질은 이 측정으로만 알 수 있다.

Windows에서 명령 묶음을 돌리면 에이전트가 제안한 명령이 PowerShell로 실제 실행된다. 그래서 PowerShell 품질도 함께 잰다. 가상 사용자는 PowerShell과 CMD로 쓴 같은 명령도 알아본다(경로의 `\`, `| Select-Object -Last 숫자`, `Set-Location . ;`). `$`, `%`, `^`, 백틱은 사람이 결정할 일로 남긴다.

```powershell
# 첫째 PowerShell 창: 브라우저에서 AI Pro에 로그인한다. READY가 나오면 그대로 둔다.
cd <llm_router 폴더>\packages\nubi-desktop
node eval\model-session.mjs --provider aipro --model qwen3.8-27b
```

```powershell
# 둘째 PowerShell 창: 소켓은 기본 경로(\\.\pipe\nubi-desktop-eval-<사용자 이름>)를 쓴다.
node eval\run.mjs --suites wiki,source,edit,document,conversation --split all --out verification\eval-live\Q1-qwen-cases
node eval\run.mjs --suites command --split all --out verification\eval-live\Q1-qwen-commands
node eval\computer.mjs --out verification\eval-live\Q1-qwen-computer
```

```powershell
# 도구 검색 비교: 같은 과제를 핵심 도구만 먼저 보내는 방식으로 한 번 더 잰다.
node eval\run.mjs --suites wiki,source,edit,document,conversation --split all --tools lean --out verification\eval-live\Q1-qwen-cases-lean
```

- 모델 이름은 AI Pro 목록의 이름 그대로 쓴다(`qwen3.8-27b`, `glm-5.2`, `gpt-oss-120b`).
- AI Pro는 요청하면 스트림 끝에 토큰 사용량을 보낸다. 보고서의 입력 토큰, 캐시 토큰, 추정 오차가 이때 처음 채워진다.
- 앱 조작 평가의 화면 그림은 `python3`로 그린다. 없으면 그림이 단순해지고 보고서의 `images`에 그렇게 적힌다. UIA 정보는 같다.
- sol과 같은 과제로 비교한다. sol은 통과하고 사내 모델만 실패한 과제가 약한 모델에 맞춰 하네스를 고칠 곳이다.
- `--tools lean`은 도구 40여 개를 한 번에 보이지 않고 필요할 때 부르게 한다. Anthropic은 도구를 늦게 불러오는 도구 검색으로 도구 정의 토큰을 최대 85% 줄이고 도구 고르기 정확도가 올랐다고 밝혔다. 약한 모델에서도 그런지는 이 비교로 확인한다.

## 과제 추가

1. `eval/cases/<ID>.json`을 만든다. 파일 이름은 `id`와 같아야 한다.
2. 정답의 근거를 자료 원문에서 직접 확인한다. 추측한 정답을 넣지 않는다.
3. `node --test tests/eval-cases.test.mjs`로 형식과 정답 경로를 검사한다.
4. 개발용과 보류용의 비율을 유지한다. 보류용 결과를 보고 하네스를 조정하지 않는다.

## 자료 다시 고정

```bash
node eval/pin-corpus.mjs openwiki-sds order-service
```

자료 해시가 바뀐다. 그 자료를 쓰는 모든 과제의 정답을 원문과 다시 대조한다. 이전 보고서와는 비교할 수 없다.

## 하지 말 것

- 회사 저장소나 회사 문서를 자료로 등록하지 않는다. 모델 호출 전체를 파일로 남기기 때문이다.
- 검사를 통과시키려고 정답이나 한도를 고치지 않는다. 맞는 답을 놓치는 정답 목록은 사용자 결정을 받아 고치고, 고친 날짜와 이유를 검사에 남긴다.
- 모델의 완료 선언이나 검토 결과를 통과 근거로 쓰지 않는다.

범위와 근거의 경계는 [실측 평가 문서](../docs/LIVE-EVAL.md)를 따른다.
