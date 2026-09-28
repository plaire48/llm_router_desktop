# Excel 2016 에이전트 품질 개선

검토일 2026-09-23. 기준은 회사 카탈로그의 Qwen 3.8 27B이며 실제 모델 ID, 토큰 한도, 도구 지원을 추정하지 않는다. 기존 누비 제공자와 사용자 선택을 유지한다. 소스 변경이며 설치 파일은 최종 빌드 요청 전까지 만들지 않는다.

## 채택한 방법과 실제 구현

| 출처 | 적용 | 채택 범위와 이유 |
|---|---|---|
| [Microsoft: Building Agent Mode in Excel](https://techcommunity.microsoft.com/blog/excelblog/building-agent-mode-in-excel/4457320) | 간결한 통합문서 개요 + 필요 범위 조회, 계획/실행/관찰, 검증 중심 작성 | 방법론 참고. Microsoft 365 Copilot 기능을 Excel 2016에서 실행하는 것은 아니다. 실제 Excel의 계산·readback과 요구사항 감독기를 유지한다. |
| [Anthropic: Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | 필요한 데이터만 조회하고, 도구 결과를 다음 판단에 전달하며, 오류 원인을 구체적으로 제공 | 기존 Pi에 구현. 모델 입력을 줄여도 검증용 원본을 버리지 않는다. Claude 전용 런타임이나 모델 계약은 추가하지 않는다. |
| [Pi for Excel](https://github.com/tmustier/pi-for-excel) — MIT | workbook overview와 상세 범위 읽기 분리, 셀 쓰기 후 readback | 기존 COM 도구 구조에 맞춰 참고. 최신 Office.js 실행 코드를 Excel 2016 COM에 그대로 이식하지 않는다. 기존 고정 소스 검토 기록은 THIRD-PARTY-NOTICES 참조. |
| [SheetCopilot](https://github.com/BraveGroup/SheetCopilot) — GPL-3.0 | 관찰→원자 동작→피드백→수정, Excel 실행 직렬화 | 패턴 참고만 했다. Python/pywin32 실행 환경 및 별도 도구 엔진 추가 비용, 라이선스 검토 범위를 고려해 코드와 런타임을 포함하지 않았다. |
| [excel-formula-tokenizer](https://github.com/psalaets/excel-formula-tokenizer) — MIT, 3.0.0 | 수식 문자열·함수·참조를 구분 | **실제 런타임 의존성으로 채택**. 실행 의존성 없음, npm unpacked 44,069 bytes. 작은 어휘 분석기가 현재 검증 목적에 적합하다. 마지막 npm 수정은 2022-06-17로 오래되어 완전한 Excel 문법 지원을 가정하지 않는다. 버전·무결성 고정, 원본 라이선스 보관, 아래 경계 사례를 검사한다. |
| [SpreadsheetBench](https://spreadsheetbench.github.io/) | 실제 업무 단위 결과와 여러 시트 평가 | 평가 방법 참고만 했다. 데이터셋·실행 코드를 가져오거나 벤치마크를 수행하지 않았다. 기존 Promptfoo 선택적 어댑터와 Windows 평가 실행기를 유지한다. |

### 전송 문맥

`worker/model-context.mjs`는 반복되는 서식·보호 속성·오류 그리드만 `uniform`/`sparse` 표현으로 바꾼다. 값과 수식은 그대로이며, 누락된 속성을 기본값으로 만들어 넣지 않는다. 수신 모델에 행/열 수, 0부터 시작하는 오프셋과 기본값의 의미를 안내한다. 작은 요청은 안내문 비용까지 포함해 길이가 줄 때만 변환한다.

호스트 관찰, fingerprint, 쓰기 전 충돌 검사, 양식 보존 비교의 원본은 수정하지 않는다. 실행기의 도구 결과는 압축할 수 있지만 독립 검토에 공급하는 근거는 실제 원본 관찰에서 생성한다. 이 표현은 모델이 정확히 해석하는지 실모델 평가가 필요하다. 문자 감소가 정확도 향상이나 토큰·시간 절감을 입증하지 않는다.

### 시트 작성과 부분 수정

다른 시트의 전체 셀을 매 요청에 반복하지 않고 이름/영역/항목 수/일부 미리보기로 색인을 보낸다. 미리보기의 잘림을 명시하며 `read_document_draft`로 정확한 초안 셀을 최대 100셀·16,000자씩 읽는다. 계산 전 데이터임을 응답에 표시하고, 아직 없는 시트나 범위 밖 읽기는 거절한다. 실제 Excel 최종 검토에는 전체 관찰 결과를 보낸다.

보완할 때 기존 시트 초안을 이어받아 잘못된 셀만 `write_document_chunk`로 교체할 수 있다. 완성된 시트와 다른 셀을 자동으로 초기화하지 않는다. 읽기, 사전 검사, 오류와 보완의 실제 결과를 기존 진행 기록에 표시한다.

### 수식 사전 검사와 Excel 최종 검사

토크나이저와 자체 검사는 새로 작성하는 문서에만 적용한다. 기존 회사 양식에 저장된 수식을 다시 만들거나 지원 목록 밖이라는 이유로 제거하지 않는다.

- 괄호·연산자·일부 함수의 인자 수·참조 시트·셀 한도를 검사한다. 외부/3D/구조화/동적 spill 참조와 지원 목록 밖 함수는 자동 작성하지 않는다.
- 문자열 안의 함수 이름이나 대괄호를 함수 호출·외부 참조로 오인하지 않는다. 작은따옴표가 있는 시트명과 소문자 지수 표기를 검사하되 원래 수식은 변경하지 않는다.
- `RANK`, `RANK.EQ`, `RANK.AVG`, `IFNA`, `COUNTBLANK`, `AVERAGEIFS`를 기존 작성 함수 목록에 추가했다. [RANK.EQ](https://support.microsoft.com/en-us/excel/functions/rank-eq-function)와 [IFNA](https://support.microsoft.com/en-us/excel/functions/ifna-function)의 Microsoft 문서는 Excel 2016 지원을 명시한다. 함수 지원은 수능 등급 산출 규칙의 증거가 아니다. 실제 업무 규칙·기준표는 사용자에게 확인한다.
- 전체 시트의 수식 의존성을 검사한다. 강하게 연결된 성분을 찾아 순환 참조의 원인 셀만 보완 대상으로 돌려준다. 그 수식을 참조하는 정상 시트는 불필요하게 다시 작성하지 않는다. 복잡도 한도 초과는 검증 불가로 처리한다.
- 정적 검사는 계산 엔진이 아니다. 통과 후 Excel이 계산하고 값·수식·계산 오류·레이아웃을 읽어야 한다. 독립 요구사항 검토와 최종 저장 HITL도 계속 필요하다. 조건부 분기로 실행되지 않는 순환 참조도 보수적으로 거절하며 반복 계산은 지원하지 않는다.

### 실패 후 계속하기

셀·양식 실행기가 처음부터 native 도구를 전혀 반환하지 못하면 같은 모델과 세션에서 JSON 도구 요청으로 전환한다. 한 번에 하나의 선언된 도구만 받고 Pi가 인자를 검사한다. 이미 native 도구가 동작한 실행은 일반적인 검토·수정 경로를 유지한다. JSON의 `answer`도 실제 셀과 완료 조건을 우회하지 못한다. 모델이 모든 API 형식을 지원한다고 주장하지 않는다.

공유 응답 파서의 버전이 달라도 HTML 로그인/프록시 응답은 `response_json_invalid`로 분류한다. 같은 본문을 한 번만 읽으며 비밀 응답 본문을 공개하지 않는다. 일시적 실패, 모델이 고칠 수 있는 오류, 사용자 확인이 필요한 실패를 구분하고 3회 무진전 HITL, 취소, 미확정 쓰기의 재실행 금지를 유지한다.

## 확인한 것과 확인하지 못한 것

`verification/agent-quality.json`은 정확한 검사 수와 문자 측정을 기록한다. `tests/agent-quality.test.mjs`는 실제 Pi와 제품 감독기에 응답·호스트 오류를 주입하여 부분 수정, 원본 참조, JSON 전환, 답변 유지, 미확정 쓰기 처리를 검사한다. 이는 실제 Qwen이 판단한 결과가 아니다.

`tests/model-context.test.mjs`는 압축 전후 의미와 검증 원본 보존을, `tests/formula-preflight.test.mjs`는 문법/참조/순환·대량 단일 참조를 검사한다. 기존 XLSX 직렬화 검사도 유지한다. native 컴파일, 새 번들, UI 브라우저 실행, 설치 파일과 CI 빌드는 수행하지 않았다.

실제 Windows Excel 2016·회사 NASCA·회사 모델/SSO가 연결되지 않아 실모델 정확도·지연·복구율은 **미측정**이다. 이전 Windows 설치 검사에서 native worker 세션 확인 실패가 있었으며 이번 소스 검사로 해결됐다고 표시하지 않는다.

## 실측 평가 기준

최종 빌드와 테스트 환경이 마련되면 같은 Qwen의 정확한 모델 ID, 동일 업무와 입력을 사용해 이전 소스와 개선 소스를 교차 순서로 반복 평가한다. 평가 정답은 모델 프롬프트에 넣지 않는다. 순차 COM 실행, 새 시험 문서, 회사 승인 경로, 저장 후 재열기를 유지한다.

1. 원래 요구사항별 충족률과 누락된 필수 질문, 사용자 수정량을 사람이 판정한다.
2. 실제 Excel 계산값, 수식 참조, 비대상 셀·수식·서식 보존은 결정적으로 채점한다.
3. 수능 입력 양식, 견적/예산, 여러 시트 참조, 빈 입력·동률·0·오류 데이터, 회사 병합 양식, 사용자 수동 변경을 포함한다. 반복 사용한 개발 사례 외 별도 기업 양식을 보류 평가에 사용한다.
4. 모델 호출·재시도·무진전 HITL·중복 쓰기·실제 지연을 함께 비교한다. `metrics.modelContext`는 호출 직전 JSON 문자 수, `formulaPreflight`는 검사 횟수/수식 수/남은 오류, `draftReads`는 초안 조회 횟수다. 실제 토큰 usage가 없으면 비용은 미측정으로 둔다. 도구 이력에 이미 압축된 결과가 포함될 수 있어 `modelContext`의 original/sent 차이는 전체 절감률이 아니다.
5. 정확도가 떨어지면 문맥 표현·도구 설명·과도한 제한을 사례별로 수정한다. 요약을 근거로 정답 판정을 완화하거나 AI 검토 결과만으로 실사용 통과를 선언하지 않는다.
