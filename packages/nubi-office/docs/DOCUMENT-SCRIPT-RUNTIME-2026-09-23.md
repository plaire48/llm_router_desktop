# 문서 계산 스크립트 실행과 개선 우선순위

후속 구현: 이 문서의 Python 미지원 범위는 [PYTHON-SKILLS.md](PYTHON-SKILLS.md)의 승인 기반 로컬 Python 실행기로 확장됐다. 외부 스킬 자동 설치와 범용 파일 생성 가져오기는 별도다.

2026-09-23. 기준 소스 `b2ab0d429f2155c69477b98cf00cb7ac97c27296`는 Pi SDK로 스킬을 찾고 코드를 수정할 수 있었지만 작성한 코드를 실행할 수 없었다. 이번에는 Excel/Word/PowerPoint의 같은 actor에 제한된 JavaScript 계산 도구를 연결했다. 사용자 범위는 문서 작성용 스킬/스크립트이며 일반 프로젝트나 Office 원본 파일을 수정하는 셸을 추가하지 않는다. 기준 모델과 제공자 선택은 그대로다.

## 실제 구현

`스킬 확인 → 코드 작성 → JSON 입력 선택 → 실행 → 결과 확인 → 오류 수정 또는 Office 반영 → native 검토/승인`으로 진행한다. 코드와 입력은 메모리 작업공간에 있다. `run_script`는 `function transform(input)`를 실행하고 JSON 결과를 반환한다. JSON 문자열 대신 `inputPath`로 현재 초안 등 기존 JSON 리소스를 지정할 수 있어 같은 내용을 다시 모델이 작성할 필요가 없다. Office 원문에 있는 코드를 자동으로 실행하지 않는다.

- QuickJS의 WASM 엔진을 **실제로 호출**한다. Pi의 스킬/읽기/편집과 기존 p-map, p-retry 실행기는 유지한다. 실행 엔진, JavaScript parser 또는 별도 agent 프레임워크를 새로 만들지 않는다.
- 매 호출마다 별도의 Node worker thread에서 새 QuickJS runtime을 만들고 종료한다. 모델 코드는 QuickJS 안에서만 실행되며 Node `eval`/`vm`, shell, `require`, host filesystem, network, Office COM, 인증값이나 모듈 로더에 연결하지 않는다. thread에는 빈 환경과 코드/JSON만 전달한다. worker thread 자체가 보안 경계라는 주장이 아니라 WASM interpreter의 노출 기능을 제한하는 구조다.
- QuickJS 실행 제한은 250 ms의 시간 기준 interrupt, 16 MiB heap, 256 KiB stack이다. 별도 3초 watchdog은 초기 로딩/응답/중단을 포함한다. 코드 32,000자, JSON 입력 48,000자, 결과 24,000자/깊이 64를 허용한다. 이 수치는 Qwen 토큰 수나 Windows 실측 성능이 아니다.
- 스크립트는 동기식 JSON 변환만 한다. NaN, Infinity, undefined, 함수, Promise, Date 객체, BigInt, 순환 객체 등은 성공 결과로 묵시 변환하지 않는다. 날짜가 필요하면 사용자 규칙에 따른 명시적 문자열을 반환한다. 값의 정확도와 업무 규칙 충족은 별도 검토 대상이다.
- 성공 결과는 반환된 `resultPath`에 남는다. `draft/script-result.json`과 `draft/script-result-next.json` 두 자리를 이용해 연속 계산의 입력을 덮어쓰지 않는다. 긴 결과는 해시가 고정된 문자 페이지로 다시 읽는다. 코드/입력/결과 해시와 조회 포인터는 문맥 재구성 뒤에도 유지한다. 관련 리소스가 변경되면 `current:false`로 표시한다. 이는 현재 worker 안의 메모리이며 재시작 복구나 보호된 영구 저장이 아니다.
- 문법/입력/출력/자원 초과 오류를 모델이 보고 코드를 수정할 수 있다. 실패, 취소, 실행 중 원본 변경 시 기존 결과와 Office 초안을 보존한다. 숨은 자동 실행 재시도는 없다. 같은 결과의 반복 실행도 기존 진전 감지에 포함하고 JSON 공백/키 순서 변경으로 반복 감지를 우회하지 못하게 한다.
- 계산 성공이 Office 편집/저장/요구사항 완료를 뜻하지 않는다. 기존 승인, 범위, native 계산/readback이 적용된다. Word/PPT의 상위 진행 항목도 오류 응답을 완료로 표시하지 않는다.

## BP와 오픈소스 선택

| 근거 | 판단과 적용 |
|---|---|
| [Anthropic code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | 데이터 정리와 반복 계산을 코드로 수행하고 필요한 결과만 모델에 돌려주는 패턴을 참고했다. 이번에는 명시적 JSON/작업공간 입력만 제공하며 MCP, 외부 데이터 도구, 네트워크 자동 접근은 추가하지 않았다. 토큰 절감률이나 Qwen 정확도 개선은 측정하지 않았다. |
| [QuickJS Emscripten 공식 소스/SDK](https://github.com/justjake/quickjs-emscripten) | core와 release-sync WASM 0.32.0을 고정해 `newQuickJSWASMModuleFromVariant`, runtime의 메모리/stack/interrupt, context 실행과 handle 해제를 실제 사용한다. MIT. Windows용 native addon 또는 별도 CLI가 필요 없는 WASM 방식을 선택했지만 Windows 설치/실행은 아직 미검증이다. |
| [QuickJS 최소 패키지 구성](https://github.com/justjake/quickjs-emscripten#reducing-package-size) | 제품 실행은 전체 debug/asyncify 묶음 대신 core + release-sync만 사용한다. 후속 품질 검사에서 같은 버전 debug-sync를 개발 의존성으로만 추가했다. ffi-types를 포함해 3개 패키지, 로컬 설치 디스크 사용 약 1.6 MiB다. 설치 EXE 증가량은 빌드 전이므로 미측정이다. |
| [Node vm 공식 안내](https://nodejs.org/api/vm.html) | 보안 실행기가 아니므로 모델 코드를 Node vm으로 실행하는 방식은 채택하지 않았다. Node Worker는 응답성/종료를 담당하고 모델 코드의 실행은 QuickJS에 한정한다. |
| 기존 Pi SDK / p-retry / fast-check | Pi 코드 수정과 actor 루프, 기존 오류 감독기를 재사용한다. fast-check로 입력을 생성해 실제 WASM 계산값을 독립 정답과 비교한다. 런타임에 별도 테스트 프레임워크를 넣지 않는다. |

버전, npm integrity와 원본 라이선스를 lockfile 및 THIRD-PARTY-NOTICES에 기록했다. 최종 빌드 시 thread 번들, WASM asset, 앱별 스킬 참조 문서를 포함하도록 설정했고 설치/검토 패키지의 필수 입력 검사에 추가했다. 빌드는 실행하지 않았다.

## 확인한 결과

- 실제 QuickJS 실행으로 계산 정답, 한국어와 앞자리 0, 호출 간 격리, host API 부재, 문법/메모리/시간/출력 실패, 취소와 다음 정상 실행을 검사했다. 이는 코드로 구성한 제한 조건의 검증이며 모든 공격에 대한 보안 인증은 아니다.
- 고정 seed `2392301`, 생성 입력 20회에서 정수 합계를 독립 JS 정답과 비교했다. 업무 문서 전체의 품질 평가가 아니다.
- 실제 Pi+Office worker+WASM 흐름에서 Excel은 12+30의 실행 결과로 A1 변경을 제안하고 편집 승인을 기다린다. Word/PPT는 실패한 스크립트 수정 → 실행 결과 소비 → 문단/슬라이드 작성 요청 → 최종 저장 승인까지 이어진다. 모델 판단과 native Office 응답은 fixture다.
- 전체 소스 테스트와 변경 소스 해시는 `verification/document-script-review.json`에 기록한다. 실제 회사 Qwen, Excel/Word/PPT 2016, NASCA, Windows 설치는 여전히 미검증이다.

## 나머지 개선 우선순위

| 우선순위 | 현재 남은 부분 | 다음 적용 기준 |
|---|---|---|
| P0 / 실환경 품질 | 회사 모델과 Windows Office 연결 없음 | 같은 요청/정답으로 실제 저장 후 재열기, 수식/스타일/승인/취소/SSO/NASCA 확인. 합성 검사로 합격 처리하지 않음 |
| P1 / 긴 문서 전체 검토 | 180,000자 근거 제한, 계층 검토 미구현 | 원본 인용, 모든 요구사항의 근거 연결, 누락/모순 확인을 유지하는 분할 검토. 요약만 합쳐 완료 승인하지 않음 |
| P1 / 재시작 복구 | 현재 실행 메모리만 유지 | 기존 native receipt와 DPAPI 경로를 바탕으로 보호 저장/범위 재바인딩/불확실한 쓰기 조정. 일반 SDK 세션 파일에 회사 원문을 저장하지 않음 |
| P1 / Python과 의존성 준비 | Python 실행, 패키지 자동 설치, 외부 스킬 설치/선택 미구현 | 기존 스킬 실행 설계의 CPython/uv 후보 및 기업 저장소 정책 검증. JS 계산 지원을 Python/모든 스킬 지원으로 설명하지 않음 |
| P2 / Office 표현 기능 | 복잡한 Word 필드, PPT 혼합 run/표/차트 편집 미구현 | 실제 2016 COM/readback과 비대상 속성 보존을 먼저 확인. 일반 ZIP 편집기로 NASCA 경로를 대체하지 않음 |

이번에는 세 앱에서 공통으로 부족했던 코드 실행을 우선 구현했다. 위 항목 전체가 해결됐거나 모든 기능이 제품 설치본에 반영됐다는 의미는 아니다.

후속 재검증에서 결과 재조회/연속 계산/출력 종료/깊은 자료 정리 경로를 개선했다. [품질 검증과 남은 범위](QUALITY-REVIEW-2026-09-23.md)를 따른다.

후속 [즉시 문법 진단](WORKSPACE-DIAGNOSTICS-2026-09-23.md)에서 write/edit 결과에 실행 없는 JS/JSON 진단을 연결했다. 오류 초안은 보존하고 다음 수정으로 이어가며 문법 통과를 실행/업무 정답으로 취급하지 않는다.

후속 [계산 의존성과 결과 보존](SCRIPT-PROVENANCE-2026-09-23.md)에서 명시적 inputPath 체인의 원본/코드 변경을 추적하고 사용자 초안과 바인딩된 결과 경로의 덮어쓰기를 차단했다. 수동 복사 값이나 재시작 뒤 출처 복원은 지원하지 않는다.
