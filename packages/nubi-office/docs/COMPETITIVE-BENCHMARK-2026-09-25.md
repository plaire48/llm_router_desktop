# Office 에이전트 소스 비교와 개선

2026-09-25. **가장 큰 공백은 실제 Office 2016과 Qwen에서 확인한 성공률, Word/PPT의 편집 범위, 긴 문서 검토, 재시작 복구다.** 이번에는 소스로 재현 가능한 오류 피드백부터 개선했다. 경쟁 제품보다 정확하다는 결론이나 종합 점수는 내리지 않는다.

후속으로 [긴 문서 분할 검토](LONG-DOCUMENT-REVIEW-2026-09-25.md)를 반영했다. 아래 표의 긴 문서 항목과 검사 수는 최초 비교 시점이며 최신 적용 범위와 검사 결과는 후속 기록을 따른다. 복잡한 Office 요소 편집, 재시작 복구와 실환경 정확도는 여전히 남아 있다.

## 비교한 자료

우리 `plaire48/ai_workspace`의 `nubi-office-v0.8.4` 소스 아카이브를 내려받아 현재 코드와 비교했다. 배포 기준 커밋은 `ee460cd1c5b7f5e5401682e5c3508e50912e628d`다. 아래 네 공개 저장소도 다운로드해 실제 소스를 읽었다. 외부 코드를 설치하거나 실행하지 않았다. Microsoft Copilot과 Claude의 비공개 제품 소스를 내려받은 것은 아니다.

| 공개 소스 / 고정 커밋 | 라이선스 | 확인한 코드와 판단 |
|---|---|---|
| [Office AI Agent](https://github.com/it235/office-ai-agent/tree/1fd78d345b9444720f6589f1264c80028729a9f0) | Apache-2.0 | `ShareRibbon/Agent/OfficeOperations/OfficeOperationValidation.vb`, `LoopEngine.Planning.vb`. 작업별 필드 오류와 결과 검토. 우리 호스트에 이미 포함된 커밋과 같으므로 신규 기능 도입으로 계산하지 않는다. |
| [Pi for Excel](https://github.com/tmustier/pi-for-excel/tree/a3cea8f7269fdc335cdc573e09497fb497c04595) | MIT | `src/context/window-budgets.ts`, `tool-disclosure.ts`, `src/tools/output-truncation.ts`. 알려진 모델 문맥 크기에 따른 출력 예산, 잘림 표시, 원문 접근. 도구 목록은 현재 캐시 안정성을 위해 전체 노출한다. 동적 도구 축소를 이미 사용하는 것으로 오해하지 않는다. Office.js 경로를 Office 2016 COM 지원으로 간주하지 않는다. |
| [OpenCode](https://github.com/anomalyco/opencode/tree/16c56fe5ecc3305028d1f0a9cff5806e51c9d480) | MIT | `packages/opencode/src/session/compaction.ts`, `processor.ts`. 최근 문맥을 보호하며 오래된 도구 결과를 정리하고 도구 실패와 제공자 재시도를 구분한다. 영구 세션 패턴은 참고하되 NASCA 문서를 일반 세션 저장소로 옮기지 않는다. |
| [Codex](https://github.com/openai/codex/tree/aa380897f67b91e1a47d530d7286d497b6726d3f) | Apache-2.0 | `codex-rs/core/src/tools/registry.rs`. 등록한 도구의 dispatch와 실행 전 hook, 알 수 없는 도구 오류를 확인했다. 범용 코딩 실행기를 Office COM 어댑터로 대체하지 않는다. |

[Anthropic의 도구 설계 방법론](https://www.anthropic.com/engineering/writing-tools-for-agents)은 모델이 다음 행동을 수정할 수 있는 오류와 평가를 강조한다. [컨텍스트 엔지니어링](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)은 필요한 근거의 조회와 압축을 구분한다. [OpenAI 하네스 엔지니어링](https://openai.com/index/harness-engineering/)은 에이전트가 읽고 검증할 수 있는 환경과 피드백을 참고했다. 방법론을 참고한 것과 해당 제품 런타임을 도입한 것은 구분한다.

## 부족한 부분과 적용 순서

Microsoft의 [Excel Copilot 안내](https://support.microsoft.com/en-us/excel/copilot/get-started-with-copilot-in-excel)와 Anthropic의 [Excel/PowerPoint 업데이트](https://claude.com/blog/claude-excel-powerpoint-updates)는 문서 편집과 스킬 활용의 제품 기준을 제공한다. 제품 설명은 동일 업무 성능 비교나 Office 2016 호환성 증거가 아니다. 아래 우선순위는 우리 소스의 지원 범위와 미검증 항목을 기준으로 정했다.

| 우선순위 | 확인한 공백 | 적용하거나 권장하는 방법 | 현재 상태 |
|---|---|---|---|
| P0 | Windows 11 + Office 2016 + Qwen + NASCA 실측 없음 | 독립 정답, 저장 후 다시 열기, 수식/구조/보존 검사, 실패 원인별 성공률. 설치 성공과 문서 완성도를 분리 | 환경 연결 필요. 모의 모델 점수를 대신 제시하지 않음 |
| P0 | 현재 공통 실행기와 UI가 배포 기준에서 달라짐 | 고정 소스별 검사와 UI 검토를 거친 버전 갱신. 해시만 새로 기록해 검사 우회 금지 | 현재 개발 전체 검사 3건 실패. 아래 구체 항목 참조 |
| P1 | Word/PPT 작업 JSON 내부 오류가 `document_schema_invalid`로만 반환됨 | 기존 TypeBox 해석기를 재사용해 필드 위치, 규칙, 올바른 스키마, 미실행 상태를 같은 모델에 전달 | **이번 반영**. 수정 후에도 원래 HITL/대상/영수증 검사 유지 |
| P1 | 긴 Word/PPT 전체 검토가 180,000자 근거 제한에 걸림 | 원문 위치와 버전에 고정한 구간별 검토, 요구사항별 coverage 집계, 누락 구간 재조회, 마지막 전체 조건 검사 | 후속 구현. 단순 요약만으로 전체 열람을 인정하지 않음 |
| P1 | Excel 차트/피벗 등의 변경, Word 복잡한 표/필드, PPT 표/차트/서식 run 편집이 제한됨 | 앱별 native 작업을 하나씩 추가하고 읽기 → 승인 → 변경 → readback → 저장 후 재열기를 검증 | 후속 구현. 범용 XML 덮어쓰기나 마우스 입력 우회는 채택하지 않음 |
| P1 | worker 재시작 뒤 실행 복원이 없음 | 내구성 실행 기록, 미확정 작업 조회, 실제 문서와 대조 후 재계획. OpenCode의 세션/실패 구분 참고 | 후속 설계. 현재 메모리 문맥 재구성을 영구 복구로 표시하지 않음 |
| P2 | 로컬 사용자 양식/스킬과 회사 공용 카탈로그의 차이 | 버전, 배포 권한, 출처, 보존 정책을 갖춘 공용 카탈로그 | 로컬 DPAPI 카탈로그는 있음. 회사 공용 배포는 별도 |

다음 구현 순서는 **배포 기준 정합성 정리 → 실환경 수용 검사 연결 → 긴 문서 검토 → Word/PPT 요소별 편집 확장 → 재시작 복구**를 권장한다. 병렬 에이전트 수부터 늘리면 native 쓰기 충돌과 평가 불확실성만 커질 수 있다. 독립된 읽기 전용 분석만 기존 제한 병렬 경로로 유지한다. Office A2A는 계속 보류한다.

## 이번 코드 반영

`worker/content-operation-validation.mjs`가 지원하는 Word/PPT 작업의 JSON 스키마를 검증한다. `content-schema.mjs`는 이를 사용하면서 기존 문서 바인딩과 편집 가능 범위 검사를 유지한다. `content-agent.mjs`는 이 오류를 기존 복구 감독기에 보내고 `operationValidationFailures`로 별도 집계한다.

예를 들어 `replace_text.text`가 숫자이면 `/text`, `type`, 문자열 스키마와 `actionIssued: false`를 반환한다. 모델은 같은 실행에서 수정안을 내지만, 실제 반영에는 기존 사용자 승인이 필요하다. 잘못된 문단 스타일, 표의 열 개수, 빈 행, 슬라이드 bullet/notes도 구체적으로 진단한다. 원래 잘못된 값과 임의 속성 이름은 피드백에 되돌려 보내지 않는다. 세 번 진전 없이 실패하면 같은 실행의 재시도/중지 질문으로 멈춘다.

신규 런타임 의존성은 없다. **기존 오픈소스 TypeBox 검증기를 중첩 작업까지 재사용**했고 기존 fast-check로 Unicode와 제어 문자 경계를 검사했다. 다른 프로젝트 코드를 복사해 새 라이선스/런타임을 추가하지 않았다. Pi for Excel의 출력 예산과 OpenCode의 영구 세션은 향후 후보이며 이번에 적용 완료한 기능이 아니다.

## 검증 결과와 한계

| 검사 | 결과 | 의미 |
|---|---|---|
| 고정된 잘못된 작업 12개를 0.8.4와 비교 | 거절 12/12 유지. 필드 위치와 기대 스키마 제공 **0/12 → 12/12** | 오류 진단 개선. 실제 모델 수정 성공률이 아님 |
| 새 관련 검사 | 21/21 통과 | Word/PPT의 native/JSON 도구 프로토콜, 수정 후 승인, 한 번만 쓰기, 반복 실패/취소, 진단값 비노출, fast-check 150회 |
| 0.8.4의 검토된 공통 소스와 고정 의존성 + 이번 변경 | 514/514 통과 | 배포 기준의 소스 회귀 검사. 임시 검사 디렉터리에서만 수행 |
| 같은 고정 소스의 디자인 검사 | 24개 기준 파일 일치, 명시적 토큰 오류 없음 | 화면 픽셀/Office WebView2 검사 대체 아님 |
| 현재 개발 폴더 전체 검사 | 515개 중 512개 통과, 3개 실패 | 현재 작업 폴더 전체가 배포 가능한 상태라는 뜻이 아님 |

현재 개발 폴더 실패는 다음과 같다.

1. 공통 Pi 실행기 식별자가 `pi-agent-core@0.86.1`에서 `pi-agent-core`로 바뀌었고 브라우저 공통 의존성은 0.87.1, Office 고정 의존성은 0.86.1이다. 문자열만 바꿔 검사를 통과시키지 않았다.
2. 공통 UI의 `HelpContent.jsx`, `QuestionForm.jsx`, `TraceSurface.jsx`, `app.css`, `surfaces.css`, `deck-surfaces.css`가 Office 검토 해시와 다르다. 화면 검토 없이 기준을 갱신하지 않았다.
3. 개발 폴더의 `tests/a2a.test.mjs`가 보류된 Office A2A 연결을 기대한다. 현재 worker의 `unknown_method`와 충돌한다. A2A 구현을 추가하거나 이 테스트를 숨기지 않았다.

고정 배포 소스에는 개발 폴더의 A2A 테스트가 없어 검사 수가 하나 적다. 두 검사 결과를 합쳐 전체 통과라고 표현하지 않는다. 현재 개발 폴더의 다른 기존 변경은 유지했다.

재현 가능한 고정 입력과 측정 스크립트는 `eval/operation-repair-cases.json`, `eval/compare-operation-diagnostics.mjs`다. [측정 JSON](BENCHMARK-OPERATION-DIAGNOSTICS-2026-09-25.json)에 입력과 소스 SHA-256을 기록했다. 비교 명령은 `node eval/compare-operation-diagnostics.mjs <신뢰한-0.8.4-content-schema.mjs>`이며, 인자로 받는 모듈은 직접 import하므로 검증된 자체 배포 소스만 사용한다.

이번에는 설치 파일을 빌드하거나 릴리즈를 갱신하지 않았다. **0.8.4 EXE에는 이번 소스 개선이 아직 포함되지 않는다.** 실제 Qwen 호출, Office COM, NASCA, Windows 11 설치와 문서 품질은 이번 검사로 검증되지 않았다.
