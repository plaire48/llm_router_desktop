# 요청부터 검증까지 이어지는 Desktop 하네스

대상은 Electron Desktop의 기존 Pi 실행기다. OpenAI, Claude, OpenCode를 별도 주 실행기로 추가하지 않는다. 계획과 검색 범위, 승인, 실행 기록, 최종 검토를 유지하면서 실제로 재현된 결함을 보강한다.

## 공식 근거와 선택

| 근거 | 누비에 적용한 판단 |
| --- | --- |
| [OpenAI: 전체 워크플로 평가](https://developers.openai.com/cookbook/examples/agent_optimization/optimizing_agents_for_cost_and_quality#track-the-complete-support-workflow) | 최종 문장과 실제 해결을 구분한다. 도구 실행과 그 결과, 검토, 재시도 전체를 기록하고 반복 과제의 결과와 p50/p95 시간을 함께 측정한다. 모델의 ready는 통과 점수가 아니다. |
| [Claude Code: 검증 가능한 결과](https://code.claude.com/docs/en/best-practices) | 실행 → 결과 읽기 → 확인 → 필요한 다음 행동을 유지한다. 잘린 자료나 실패한 읽기만으로 답변을 통과시키던 경로를 닫고, 유효한 근거 확인 또는 정직한 제한 설명으로 이어간다. |
| [Anthropic: 에이전트 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 고정 과제와 독립 결과 검사를 사용한다. 같은 과제를 여러 번 실행해 모두 성공했는지를 기록한다. 관측된 반복 일관성을 모집단 성공 확률로 표현하지 않는다. 미실행과 실패도 계획된 반복 수에 남긴다. |
| [OpenCode: 반복 호출 감지와 권한](https://opencode.ai/docs/permissions/) 및 [구현](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts) | 같은 호출의 반복을 진전으로 보지 않는 원칙을 적용한다. 누비의 기존 결과 기반 반복 감지와 A→B→A 검사를 유지하며, 무효 Wiki를 진전에서 제외하고 다른 메일 식별자를 구분한다. 반복 횟수만으로 권한을 넓히거나 미확정 명령을 다시 실행하지 않는다. |
| [Claude CLI](https://code.claude.com/docs/en/cli-reference), [구조화된 출력](https://code.claude.com/docs/en/headless#get-structured-output) | CLI는 한 번의 모델 응답을 담당한다. JSON 제안은 누비가 검증하고 실행한다. 도구 없는 CLI 내부에서 호스트 도구를 직접 호출하려는 오류를 회수하며, 내부 반복은 3턴으로 제한한다. 누비 전체 작업의 실행 횟수 제한이 아니다. |

새 프레임워크나 의존성을 도입하지 않았다. 문서의 설계 원칙을 기존 Pi, Ajv, Claude CLI와 평가 실행기에 적용했으며 외부 구현 코드를 복사하지 않았다. 전면 교체는 기존 승인과 복구 계약을 다시 검증해야 하는 비용에 비해 근거 있는 이점이 없다.

## 재현한 문제와 변경

1. 검토 모델이 실패/잘림/현재 페이지 불일치 자료를 유일한 근거로 `supported`를 반환하면, 호스트는 `unknown`으로 낮추면서도 `ready`를 유지했다. 이제 원래 사용자 요구에 대한 유일한 근거를 잃으면 같은 작업의 답변 검토를 계속한다. 처음부터 정확하게 설명한 미확인은 그대로 전달할 수 있다. 모델이 추가한 `intent:*`만 미확인인 경우는 전달을 막지 않는다.
2. 검토 반복 검사에서 모든 `id`를 지워, 같은 제목/본문의 서로 다른 메일도 같은 자료로 보았다. 원본 메일과 중첩 자료/작업 식별자를 보존하며 일치하지 않는 Wiki는 새 근거로 세지 않는다. 시간/조회 ID 변경은 진전이 아니다.
3. Claude의 실제 E1 과제에서 CLI 내부의 호스트 도구 호출이 `No such tool available`로 반복됐고, 누비에는 제안이 도착하지 않았다. 직렬화된 대화와 `hostActionCatalog`를 명확히 분리했다. 모델이 여전히 native `tool_use` 형식으로 내보내면 광고한 호스트 이름의 객체 인자만 제안으로 회수하고 내부 CLI 루프를 중단한다. 알 수 없는 도구는 거부하며 사용자 취소가 우선한다. `--tools ""`, 빈 MCP, safe mode를 유지한다. 호스트 입력 검증과 승인을 생략하지 않는다.
4. 검토 프롬프트는 기존 계약을 유지하며 4,682자에서 3,502자로 줄였다. 중복 문장을 줄였고 최신 질문, 원문, 실제 승인 대기, 하위 분석의 한계와 메일/Wiki 범위는 남겼다.
5. 평가 보고서에 계획된 반복 수, 과제별 전체 반복 성공 여부, 실행 수, p50/p95를 추가했다. 1회 실행에는 반복 성공률을 표시하지 않으며 축소 문맥 진단은 분리한다. 중복 trial, falseCompletion, 미실행을 성공으로 세지 않는다.

## 평가 방법

- 자동 검사: 관련 84개 통과. 최초 근거/진전 회귀에서 3개 실패를 재현한 뒤 수정했고, 최종 신규 연속 실행 검사의 fixture 오류를 수정해 해당 파일 18개를 다시 통과했다. 로컬 소켓/localhost 검사 16개는 샌드박스 EPERM을 분리해 실제 로컬 실행 권한으로 통과했다. 프롬프트 길이 제한 검사는 기준을 완화하지 않고 중복 지침을 줄여 통과했다.
- 로컬 `npm run build:electron` 통과. Windows 설치 파일 생성과 배포는 수행하지 않았다.
- 회귀: 근거 폐기 뒤 실제 답변 교체, 정확한 미확인 전달, 취소, 권한 경계, 잘못된 형식, 다른 메일과 교대 반복을 고정 입력으로 검사한다.
- 실제 모델: 동일한 격리 corpus와 과제, 현재 모델/문맥 한도, 동일 승인 정책에서 실행한다. E1은 실패하는 테스트를 실행하고 소스에서 원인을 읽되 코드를 바꾸면 실패한다. K1은 Wiki/소스에서 배송비를 찾고 출처를 제시해야 한다.
- 합격 기준: 독립 검사 통과와 원본 보존. 응답 전달, 검토 ready, 모델이 말한 완료는 각각 다른 사실이다. 반복 일관성은 3회 모두 통과를 별도로 본다.
- 초기 실패 기록: `verification/eval-live/harness-methods-20261012/report.json`. 도구 전달 오류를 발견해 전용 세션을 중단했다. 첫 E1 실패, 다음 E1 중단 오류, 남은 4회 미실행을 보존했다. 중단 오류를 자연 발생 모델 실패와 섞어 우열 비교하지 않는다.
- 수정 후 Sonnet: `verification/eval-live/harness-methods-v2-20261012/`. E1 실행/실패 원인 보고 3회 모두 통과했다. 이후 사용자의 Opus 5.5 전환 요청으로 K1 진행을 중단했으며, 해당 중단/미실행을 자연 발생 실패나 전체 품질 점수로 섞지 않는다.
- 사용자 선택에 따른 현재 기준은 정확한 `claude-opus-5-5`, 요청 effort `medium`이다. CLI 2.1.296의 실제 응답에서 모델 ID와 1M 문맥 한도를 확인한 뒤 새 평가를 시작했다. 실제 적용 effort는 CLI가 확인해 주지 않으므로 `appliedEffort:null`로 남긴다.

실행 명령:

```sh
node eval/model-session.mjs --provider claude --model claude-opus-5-5 --effort medium
node eval/run.mjs --cases K1-jeju-extra-fee,E1-run-tests-report --trials 3 --out verification/eval-live/harness-opus55-medium-20261012
```

Claude 인증은 기존 CLI가 관리한다. 평가 세션은 전용 로컬 소켓만 열며 인증정보를 응답/보고서로 넘기지 않는다. 로컬 합성 과제와 실제 모델의 결과는 Windows 설치판, AI Pro/사내망, 회사 저장소 및 개인 메일에서의 성능을 증명하지 않는다. Windows 설치/배포 빌드는 이번 범위에 없다.

## 최종 확인

- Opus 5.5 요청 effort medium: E1 실행/실패 원인 보고 3/3, K1 Wiki/소스 검색 3/3. 계획한 6회 모두 독립 검사 통과, falseCompletion 0. K1은 매회 실제 읽기 전용 하위 분석 호출도 사용했다.
- 6회 경과 시간 p50 99.6초, p95 167.5초. 작은 두 과제의 관측값이며 전반적 제품 품질 점수가 아니다. 보고서는 `verification/eval-live/harness-opus55-medium-20261012/report.json`이다.
- 후속 Claude/선택기/근거 검토/반복성 회귀 36개 통과. 평가 실행/로컬 relay 포함 묶음 32개도 통과했으며 두 묶음의 중복 수를 합산하지 않는다.
- 공통 추론 슬라이더와 첫 로그인 모션, 좁은 창, 재시작 후 모델/effort 유지의 실제 Electron 검사 14개 통과. 최종 Electron 빌드 및 디자인 검사 통과. Windows와 실회사 자료/메일은 이번 검사에 포함하지 않았다.
