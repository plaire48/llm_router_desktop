# 누비 브라우저 하네스 방법론과 적용 결과

전체 요청을 보존하는 위임 계약을 기존 Pi 하네스에 적용했다. 자동 분석이 2,000자 요청을 허용하면서 실제 배정에서는 1,000자 이후를 버리는 결함을 재현했다. 뒤쪽의 휴실 예외와 회원 전용 서비스 제외 조건이 하위 입력에서 사라졌다. 이번 변경은 입력 전달과 복구의 결함 수정이며 실모델 의미 정확도의 개선 실적은 아니다.

## 선택

기준은 확장 단독 사용, 기존 AI Pro/ChatGPT/FabriX 인증과 모델 선택, 읽기 범위, HITL, 복구, 비용이다. 새 프레임워크를 추가하기 전에 현재 실패를 설명하는 계약을 보완한다.

| 후보 | 현재 근거와 라이선스 | 누비 적용 판단 |
| --- | --- | --- |
| Pi agent core | 설치된 `@earendil-works/pi-agent-core` 0.87.1, MIT. 실제 loop의 `transformContext`와 LLM 변환 경계 확인 | **유지**. 실행기 교체 없이 배정 스키마와 복구 계약 개선. upstream main을 설치 버전으로 취급하지 않음 |
| OpenAI Agents SDK | MIT. `Agent.as_tool()`의 입력 스키마 생성, `TypeAdapter.validate_python`, 중첩 호출의 별도 승인 상태 확인 | **방법 적용**. 전체 요청과 하위 목적/출처/완료 조건을 구분하고 실행 전에 입력 검증. Python SDK와 별도 런타임은 추가하지 않음 |
| Stagehand | MIT. 최신 소스의 Chrome extension 1.0.2와 `extractService.ts` 확인. 구조화 추출, DOM 상태 기반 캐시, 시각 추출의 캐시 우회 | **다음 구조화 추출 후보**. 최신 저장소에 확장 구현이 있으므로 과거의 Node 전용 설명으로 일괄 제외하지 않음. 확장 패키지는 private이며 누비의 인증/승인/출처 계약 연결 비용을 확인해야 함. 이번에는 코드 복사나 패키지 추가 없음 |
| browser-use | MIT. 현재 소스 버전 0.13.10, Python 3.11 이상. 실행 완료 후 judge 호출 및 오류/취소 기록 확인 | **평가 설계 참고**. Python 호스트를 요구하는 런타임은 확장 단독 조건과 맞지 않아 미도입. 모델의 완료 선언과 독립 결과 판정을 구분하는 누비 검증 유지 |

현재 저장소와 라이선스의 조회 원본 및 커밋은 `verification/harness-methods-2026-10-01/research-sources.json`에 고정했다. 이 목록은 도입 목록이 아니다. 코드는 검토용 파일로만 보존하고 제품 번들에 넣지 않았다.

실제 확인한 소스: [OpenAI 입력 검증](https://github.com/openai/openai-agents-python/blob/f76153c6f0b880388fd2dcc41ee99a6a9d2c3df6/src/agents/agent.py), [Stagehand 확장 추출](https://github.com/browserbase/stagehand/blob/1e3270c264b12548749ba51575de18f0eef69869/packages/extension/services/extractService.ts), [browser-use 실행/판정](https://github.com/browser-use/browser-use/blob/4cbe921673b48a488f5415d9159249afd12a625b/browser_use/agent/service.py), [Pi upstream loop](https://github.com/earendil-works/pi/blob/7a11fe1c723b942fa093edb8b00f051ddb9b6627/packages/agent/src/agent-loop.ts). Pi 설치 버전의 loop도 별도 검증 원본에 보존했다.

방법론은 [Anthropic의 조사 위임](https://www.anthropic.com/engineering/multi-agent-research-system)의 목적/출력/도구/범위 명시와 비용 대비 필요한 분업, [OpenAI agent evals](https://developers.openai.com/api/docs/guides/agent-evals)의 재현 가능한 평가를 따른다. 다른 제품의 향상 수치를 누비의 실적으로 사용하지 않는다.

## 반영

- 자동 배정의 `task`에 원래 요청 전체를 전달한다. 출처 URL은 이미 배정한 근거 메타데이터에 있으므로 요청 앞에 다시 붙이지 않는다.
- 원래 요청, 배정 스키마와 저장한 handoff의 한도를 `analysis-limits.js`의 2,000자로 일치시킨다. 2,001자 이상 요청을 축약해 자동 배정하지 않는다. 주 실행기의 전체 요청을 제한하는 값이 아니다.
- 배정의 `constraints`에 출처에 해당하는 사실 추출과 제외/예외 보존을 명시한다. 저장/재조회에서는 전체 배정이 남고 160자 표시용 이름과 구분된다.
- 기존 동시 2개/미수집 포함 6개, 버전/출처 격리, 정확한 인용 검사, 사용자 취소와 승인 경계를 유지한다. 작업 수나 호출 상한은 늘리지 않는다. 긴 요청에서는 이전에 버렸던 최대 1,000자가 하위 호출마다 추가되므로 토큰/지연은 실측해야 한다.

이 변경은 의미 정확도, 문서 전체 이해, 실제 페이지 변경 성공을 인증하지 않는다. 자동 보조 범위를 넘는 요청은 주 실행기가 처리하고 부족한 근거는 미확인으로 남긴다.

## 최신 본문 파서의 worker 복구

전체 고정 후보 검사 중 다른 작업이 `browser-content`와 outline을 변경했다. 최신 소스의 실제 Chrome 집중 검사에서 `rangeProbe`가 초기화되지 않는 실패를 확인했다. 새 Markdown 파서의 전이 의존성 `decode-named-character-reference`는 browser export가 모듈 로딩 시 `document.createElement`를 실행한다. DOM이 없는 확장 worker에는 맞지 않는다.

설치된 1.3.0의 기존 `index.js`는 `character-entities`의 표만 사용한다. `worker-markdown-build.mjs`로 browser-content 번들에 이 구현을 지정했다. DOM shim이나 별도 실행기를 넣지 않고 기존 MIT 의존성을 사용한다. `character-entities` 2.0.2의 MIT 고지도 기존 재귀 라이선스 수집으로 보존한다. 근거는 [기존 DOM 없는 구현](https://github.com/wooorm/decode-named-character-reference/blob/main/index.js)과 [DOM 구현](https://github.com/wooorm/decode-named-character-reference/blob/main/index.dom.js)이다.

새 회귀 검사는 기본 browser 번들의 DOM 없는 import가 실패하는 대조군을 확인하고, worker 설정으로 같은 Markdown을 처리해 엔티티가 있는 원문의 heading/offset/hash를 보존하는지 확인한다. 제품 검사와 별개로 라이브러리 설치 성공을 worker 실행 성공으로 판단하지 않는다.

## 검증

기준 코드의 새 반례는 실패했다. 수정 뒤 집중 검사 50개가 통과했다. 조건 누락을 다시 넣은 별도 테스트 번들은 새 반례를 실패시키는 음성 대조군이며 제품 소스를 바꾸지 않는다. 실제 Chrome fixture는 2,000자 요청이 첫 분석과 예외 후속 분석 모두에 전달되는지, 원문/인용/해시/취소 경계를 함께 검사한다.

실제 Chrome 집중 검사 3회가 모두 통과했다. 각 실행의 로그를 별도로 보존했고 마지막 실행의 JSON을 보존했다. 10개 검사는 요청 전달과 읽기/인용/버전/취소 경계를 확인한다. 전체 검사 결과는 후속 검증 기록에 연결한다. 공유 `dist`를 다른 빌드가 교체하여 발생한 ENOENT는 보존하고, 검증용 복사본과 현재 소스의 입력 해시 일치를 별도로 확인한다. 복사본은 OS 보안 샌드박스가 아니다.

실계정 모델을 이번 수정 후 호출하지 않았다. 지난 로그인 미완료 기록을 모델 실패로 세지 않으며 Qwen 사내 업무 정확도는 미측정이다.

## 다음 품질 개선 순서

1. **예외와 제외 조건**: `예약 서비스 제외`처럼 쓰기 관련 단어를 부정하는 요청도 현재 보수적인 자동 분석 필터에 걸릴 수 있다. 이를 쓰기 승인으로 해석하지 말고 의도 분류와 업무 완주를 별도 검사한다. 원래 요청의 조건마다 사실, 인용, 적용 날짜, 반례, 미확인을 연결한다. E-02/H-06의 독립 정답과 원문을 대조하고 인용 문자열 일치를 의미 정답으로 세지 않는다.
2. **조사 완주**: H-04처럼 여러 기관을 조사하는 업무에서 출처별 누락 항목과 다음 읽기를 유지한다. 독립 탭 워커는 기존 `RESEARCH-WORKERS-2026-09-30.md`의 소유권/정책/로그인/취소 설계 뒤 구현한다. 이번 하위 분석은 동결된 원문만 읽는다.
3. **실모델 검증**: 인증이 유효한 전용 평가 환경에서 같은 후보의 E-02/H-06/H-07을 먼저 독립 채점하고, 넓은 품질 주장은 고정 30개 과제로 확인한다. 답변 전달, 사실/페이지 상태 성공, 호출 수, 시간, HITL을 각각 기록한다.

현재 상중하 평가는 [기능 재평가](FEATURE-REASSESSMENT-2026-10-01.md)를 유지한다. 로컬 입력 보존 성공만으로 하 등급의 조사/예외 정확도를 올리지 않는다.

## 최종 검증 범위

초기 고정 후보는 전체 단위 1642개와 핵심 Chrome 107회, 총 110단계를 통과했다. 이후 최신 outline의 worker 초기화 문제를 수정한 고정 후보는 전체 단위 1649개, 디자인, 후보 빌드와 Chrome 9회(출처 후속 분석 3회, 본문 읽기 3회, 출처 조사/분석 보존/Wiki 각 1회)가 통과했다. 후자는 선택 검사이며 전체 핵심 gate가 아니다.

검증 중 별도 작업이 조사 실행기와 관련 화면/스크립트를 추가 변경했다. 따라서 현재 작업공간 전체의 통과나 전체 실모델 점수를 주장하지 않는다. 이번 입력 보존과 decoder 설정은 현재 파일에 남아 있다. 모든 실패와 원인 분리, 두 고정 후보의 보고서 및 해시를 [검증 기록](../verification/harness-methods-2026-10-01/result.json)에 남겼다.
