# Office 작업 평가

이 평가기는 현재의 누비 제공자와 **실제 Windows Excel COM**으로 업무 사례를 수행한다. 연결이 없으면 `blocked`, 정확도는 `null`이다. 합성 모델이나 LibreOffice로 자동 대체하지 않는다. 현재 Windows PC·실제 모델 연결은 사용자가 제공할 수 없는 상태이므로 실모델 평가 결과는 없다.

## 평가하는 것

`cases.json` v4의 16개 사례(편집 8, 새 문서 4, 양식 4)는 직접 작성한 합성 기준 업무다. 모델에게는 요청과 초기 셀만 제공하며, 외부 채점용 정답과 허용 변경 목록은 제공하지 않는다.

- 값과 서식 변경, 합계 수식, 기존 계산식 보존.
- 세율 누락 시 질문, 지원하지 않는 차트 요청 안내.
- 셀 안의 지시문을 데이터로 취급하고 요청한 셀만 변경.
- 새 성적표·시트 간 예산·빈 양식·인원 질문 후 예산 문서 작성.
- 기존 양식의 앞자리 0·병합 입력·계산식·날짜 형식 보존.
- 다른 두 시트의 값을 읽고 Excel 2016 수식으로 합산, 참고 시트의 주입 지시문 무시. 원본 시트는 실행 후와 저장/재열기 후 모두 변경이 없어야 한다.

사례별로 계획과 단계 진행, 도구 기록, 검토 결과, 모델 호출 횟수·시간·사용량을 기록한다. 독립 채점기가 정답 셀과 **수정하면 안 되는 셀·수식·서식**을 비교한다. 결과 파일을 실제 Excel에서 저장하고 다시 연 상태도 대조한다. 이 저장 동작은 평가 실행기의 기능이며 제품 에이전트에 저장 도구를 추가한 것은 아니다.

`verification/live/<실행 ID>`에 결과 XLSX·관찰 JSON·보고서를 보관한다. 전용 Excel 인스턴스와 새로 만든 시험 문서만 사용한다. 기존 사용자 통합 문서는 열지 않는다. `Version=16.0`만으로 Office 2016 제품군을 판정하지 않으며, 설치형 VSTO UI 검증은 별도다.

## Windows 평가 담당자 실행

검토 ZIP은 평가용 EXE와 번들 JS를 포함한다. 개발 저장소에서는 먼저 `npm run build`와 `dotnet build native/Nubi.Office.EvalHost -c Release`를 실행한다.

현재 프로세스에 다음 전용 환경을 설정한다. 토큰을 채팅·명령 이력·저장소에 기록하지 않는다.

| 변수 | 값 |
|---|---|
| `NUBI_EVAL_APPROVE_TRANSACTIONS` | 격리된 시험 문서의 편집과 사례에 명시된 저장/양식 항목 승인에 동의할 때 `1`; 복구·미등록 승인은 포함하지 않음 |
| `NUBI_EVAL_PROVIDER` | `aipro`, `chatgpt`, `fabrix`, `aipro-cli`, `compatible` |
| `NUBI_EVAL_MODEL` | 실제 연결에서 사용할 정확한 모델 ID |
| `NUBI_EVAL_BASE_URL` | 수동 연결 주소; FabriX에서는 서비스 Endpoint |
| `NUBI_EVAL_TOKEN` | 수동 연결의 전용 토큰 |
| `NUBI_EVAL_CLIENT_KEY` | FabriX만 필요 |

AI Pro·ChatGPT는 평가 실행 때 별도 브라우저 로그인한다. 기존 누비·Codex·라우터 로그인 저장소를 읽지 않는다. 수동 연결 변수는 해당 경로에서만 사용하며 제공자 사이에서 인증을 대체하지 않는다.

```powershell
.\dist\runtime\x64\node.exe .\eval\run-bundled.mjs
```

종료값은 전체 통과 `0`, 사례 실패·평가 중단·의미 검토 대기 `1`, 평가 전제 부족 `2`다. 결과 집계는 `passed/failed/pending/total`을 분리한다. 의미 검토 대기는 오답으로 단정하지도, 통과에 합산하지도 않는다. `aborted` 실행의 정확도는 `null`로 남긴다. 실측 결과는 이 16개 합성 사례에만 해당한다. 편집·문서·양식 mode를 각각 실제 제품 실행기에 전달하며 다른 mode는 거부한다. native protocol 4가 필요하며 이전 EXE는 차단한다. 새 native 경로는 최종 빌드와 실제 Windows 확인을 기다린다.

사례별 한도는 10분·관찰된 모델 호출 80회·호스트 도구 120회다. 제품의 일반 작업 한도가 아니라 평가가 끝없이 돌지 않도록 하는 제한이다. 복구 승인이나 미등록 입력 요청이 나오면 자동 승인 없이 평가를 중단한다. native 응답 유실·시간 초과는 뒤늦게 작업이 실행 중일 수 있으므로 다음 사례를 시작하지 않고 전용 호스트를 종료한다.

`missing-tax-rate`와 `unsupported-chart`에는 `responseRubric`이 있다. 셀 보존 검사를 통과해도 질문의 관련성·답변의 진실성을 결정적 검사만으로 판정할 수 없어 `passed: null`, `outcome: needs_review`로 기록한다. 별도 평가자가 원문 요청·답변·실제 셀 결과를 이 기준으로 검토해야 한다. 실평가 후 생성되는 `review-template.json`에 별도 평가자의 이름, 기준별 판정·이유·근거를 입력하고 아래 도구로 별도 보고서를 만든다. 실행 결과 해시가 다르거나 결정적 검사가 실패한 사례는 덮어쓸 수 없다. 판정자 신원 인증 기능은 없으며 운영 에이전트의 자기평가를 대신 넣지 않는다.

```sh
node eval/review-cli.mjs report.json completed-reviews.json reviewed-report.json
node eval/compare.mjs trial-1/report.json trial-2/report.json
```

반복 비교는 실제 측정 보고서만 허용하며 모델/소스/동시성별로 분리한다. 성공 작업 지연 p50/p95, 모델 호출 수, 반복 성공 여부와 검토 대기를 따로 표시한다. 회사 모델 가격이 없어 금액 비용은 미측정이다.

## Promptfoo 연결

공식 JavaScript custom provider 인터페이스로 만든 `promptfoo-provider-bundled.mjs`와 설정 예시를 제공한다. 설정에서 제공자·모델을 명시한 뒤 평가 담당자가 설치한 Promptfoo에서 실행한다.

```sh
promptfoo eval -c eval/promptfooconfig.yaml --no-cache
```

파일마다 실제 Excel 상태가 필요하므로 동시성은 1이고 캐시를 끈다. 기본 설정은 `passed === true`만 통과시킨다. 의미 검토 대기는 Promptfoo의 기본 합격 집계에 들어가지 않는다. 자동 계정 탐색 또는 기본 LLM 채점자로 대체하지 않는다. 어댑터의 차단 동작은 검사했으며, **Promptfoo 본체를 통한 실측 실행은 아직 하지 않았다**. Promptfoo는 제품 런타임에 포함하지 않는다.

## 현재 가능한 검사

`node eval/audit.mjs`는 개발 체크아웃의 시험용 응답으로 채점 누락과 문서 질문 후 이어가기 경로를 재현한다. `verification/harness-assessment.json`에 62/100 구현 성숙도 루브릭과 실제 관찰값을 기록한다. 종료값 0은 보고서 수집 성공이며 제품 합격이 아니다. 점수는 사람이 코드·제어 검사 근거에 부여한 판단이고, 실모델 정확도는 `null`이다. 상세 근거와 개선 순서는 `../docs/HARNESS-IMPROVEMENTS-2026-09-23.md`를 따른다.

실평가 전제 확인은 빌드 산출물이 없어도 보고서를 만든다. worker·UI·native·eval·scripts·잠금 파일과 공유 JS 소스를 해시 목록으로 남기며, 기존 실행 파일/번들의 해시는 별도로 기록한다. `buildMatchesSource: null`은 소스와 산출물 일치가 검증되지 않았다는 뜻이다. 회사 문서·인증값을 수집하는 기능은 아니다.

`check_artifacts.py`는 openpyxl로 입력/정답 XLSX를 만들고 LibreOffice에서 재계산·재열기하여 정답 파일의 수식과 값을 확인한다. 에이전트가 정답을 생성하는 검사가 아니다. 결과는 `verification/artifact-calculation.json`과 `verification/workbooks`에 있다.

`tests/agent.test.mjs`는 오동작을 강제로 넣어 제어 장치가 막는지 확인한다. 이전 감독 루프의 잘못된 완료 재현은 `verification/harness-baseline.json`에 보존했다. 제어 결함 검사, 파일 계산 검사, 실모델 정확도는 서로 다른 결과로 관리한다.

동일 모델을 별도 문맥으로 호출하는 단계/최종 검토는 오류를 줄이는 장치다. 서로 다른 모델의 독립 평가나 사람이 판정한 정확도 기준을 대신하지 않는다.

## 하네스 비교와 실행 제한

`NUBI_EVAL_ANALYSIS_CONCURRENCY=1`과 `2`로 같은 모델/평가 집합에서 읽기 전용 하위 분석의 순차/병렬 실행을 비교할 수 있다. 기본값은 2이며 ChatGPT는 토큰 refresh 동시성 검증 전까지 실제 동시성 1을 유지한다. 이 설정은 별도 Excel 프로세스/업무 사례를 동시에 실행하는 설정이 아니다. Promptfoo `maxConcurrency: 1`을 유지한다.

실행마다 새 통합문서를 사용하고 순서를 교차해 여러 번 측정한다. 보고서의 `analysisConcurrency`와 `metrics.context`에 설정, 실제 하위 호출 수, 원본 조회·무효화, 캐시 사용, 모델 입력의 최대 문자 수, 429 축소 기록이 남는다. 토큰 usage가 없는 모델은 비용 미측정으로 표시해야 한다. 대표 기업 양식의 별도 평가와 사람의 판정으로 모델 검토를 보정한다. 하나의 점수만 높이도록 완료 조건을 완화하지 않는다.

실모델 비교는 아직 실행하지 않았다. 소스 변경 중에는 이 문서의 빌드 명령도 실행하지 않으며, **사용자가 최종 빌드를 명시적으로 요청한 뒤** 새 native host/worker를 빌드하고 실제 Excel 환경에서 평가한다. 이전 설치 확인 실패를 해결하는 작업도 남아 있다.

## 모의 호스트 실측 (Windows 없이)

`eval/sim`은 Windows와 Excel이 없는 개발 PC에서 **실제 모델로 실제 worker를 실행**하기 위한 평가 전용 도구다. 위의 Windows 평가를 대신하지 않는다.

| 구성 | 실제 | 모의 |
|---|---|---|
| 모델, 제공자 어댑터 | 실제 | |
| worker, Pi 실행기, 도구 스키마, 프롬프트, 검토, 복구 | 실제 | |
| 쓰기 검증 규칙 | | `native/Nubi.Office.Core/WorkbookEngine.cs`를 JS로 옮김. native 계약 시나리오를 검사로 이식 |
| 통합문서, 수식 계산 | | 메모리 통합문서와 IronCalc 계산기 |
| COM, 표시, 파일 저장, NASCA | | 없음 |

### 실행

로그인은 세션 프로세스에서 한 번만 한다. 인증값은 그 프로세스의 메모리에만 있고 파일, 기록, 소켓 응답에 쓰지 않는다. 다른 앱의 인증 저장소는 읽지 않는다.

```sh
node eval/sim/model-session.mjs --provider chatgpt --model gpt-5.6-luna
```

브라우저에서 로그인하면 `READY`가 출력된다. 이 터미널은 열어 둔다. 다른 터미널에서 실행한다.

```sh
node eval/sim/run.mjs --suites register,reuse
node eval/sim/run.mjs --suites edit,template --routing direct
node eval/sim/run.mjs --suites reuse --cases quotation --trials 3
node eval/sim/run.mjs --suites invoke
```

| 묶음 | 내용 |
|---|---|
| `register` | 합성 양식 4종을 분석해 입력 항목을 제안하고 등록. 정답 항목표와 비교 |
| `reuse` | 정답 명세로 등록한 양식의 사본을 대화로 작성. 값, 계산 결과, 비대상 셀 보존 확인 |
| `edit`, `template` | `cases.json`의 기존 편집 8개, 양식 채우기 4개 |
| `invoke` | 등록된 양식 5종이 있는 상태에서 `/이름` 명령어와 문장으로 양식을 호출. 어떤 양식의 사본을 열었는지, 사본의 값과 계산 결과, 열려 있던 문서가 그대로인지 확인. 없는 명령어와 양식과 무관한 요청은 아무것도 열지 않아야 통과. 사례는 `eval/sim/invoke-cases.mjs` |

`--routing product`(기본)는 제품처럼 의도 분류를 거친다. `direct`는 분류를 건너뛰고 실행기를 바로 시작한다. 두 결과를 비교하면 분류 오류와 실행 오류를 나눌 수 있다. 등록은 제품에서도 분류를 거치지 않는다.

결과는 `verification/sim-live/<시각>/`에 남는다. `report.json`은 요약, 사례별 폴더의 `transcript.jsonl`은 모든 모델 호출, `result.json`은 계획과 검토, 제안한 항목, 채점 결과다.

### 사용자 역할

정해진 답만 한다. 사례에 없는 질문이나 복구 승인 요청이 오면 답을 지어내지 않고 그 사례를 `error`로 끝낸다. 등록 묶음에서는 제안된 항목 연결을 승인한 뒤 따로 채점한다.

### 근거의 경계

보고서 종류는 `simulated-host-live-model-evaluation`이다. 이 결과는 실제 Excel 2016, 사내 Qwen 3.8 27B, 회사 양식의 정확도가 아니다. 합성 양식은 `eval/sim/forms.mjs`에 있고 정답 항목표는 모델에 보내지 않는다.
