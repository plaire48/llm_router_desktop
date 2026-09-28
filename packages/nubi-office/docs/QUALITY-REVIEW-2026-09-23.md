# Office 하네스 품질 재검증

2026-09-23. 게시 기준 `fc8dbf3d0d53884ed7495fc4b2d0e066f78ff79b`. Windows Office 2016과 사내 Qwen 3.8 27B가 목표다. 이번 검증은 실제 Pi와 QuickJS 실행 및 소스 계약에 한정한다. 회사 모델, Windows COM, NASCA, 설치 파일 검증은 아니다. 빌드와 설치 파일 생성은 실행하지 않았다.

## 발견과 반영

| 문제 | 수정 전 관찰 | 실제 수정 |
|---|---|---|
| 문맥 전환 후 계산 결과 재조회 | 500개 행의 JSON 실행은 성공하지만 줄 단위 읽기가 12 KB를 넘으면 `workspace_line_too_long`으로 막힘 | 기존 Pi 읽기는 유지하고 긴 줄에만 문자 페이지 대체 경로 제공. 페이지당 최대 4,000 Unicode code point와 UTF-8 12 KB. 다음 포인터와 전체 소스 해시를 반환하고 다음 페이지는 같은 해시를 요구. 읽는 도중 원본이 바뀌면 거절. 줄 제한으로 일부만 읽은 결과도 `truncated:true`로 표시 |
| 연속 계산의 입력 소실 | 직전 `resultPath`를 입력으로 주면 같은 파일을 덮어써 성공 직후 `current:false` | 결과 두 자리를 번갈아 사용해 이번 입력과 출력 분리. 결과 파일 수가 무한 증가하지 않음. 최신 영수증은 두 해시 모두 확인. 과거 전체 실행 기록의 영구 저장은 아님 |
| 직렬화 도중 비동기 작업 | 출력 getter에서 Promise 작업을 생성하면 기존 종료 검사를 지나 성공으로 표시 | JSON 직렬화 후에도 대기 작업 확인. 거절하면 이전 결과 보존 |
| 깊은 순환 자료 정리 | release 검사에서 오류를 반환했지만 debug variant에서는 재귀 복사 중 runtime 정리 assertion 실패 | 깊이 검사는 유지하되 JSON 검증/복사를 반복 방식으로 변경. 순환, 깊이 64/65, 실패/성공의 해제 경로를 release와 debug에서 같은 평가 함수로 확인 |
| 검사 범위의 부족 | 성공 계산과 제한 조건만으로 원문 재조회/연속 계산/VM 해제를 충분히 확인하지 못함 | 실제 저장된 메모리 결과를 끝까지 재조회해 독립 정답과 비교. 취소, 원본 변경, prototype 변조, Unicode 생성 입력 검사 추가 |

`read`의 문자 모드에서는 `charOffset`은 0부터 시작하는 code point 위치다. 반환된 `nextCharOffset`과 `sha256`을 다음 호출의 `charOffset`과 `expectedSha256`으로 넘긴다. `charOffset:0`으로 정확한 원문 문자 읽기를 직접 시작할 수도 있다. 줄의 `offset/limit`과 문자 위치를 섞으면 거절한다. 텍스트 조각은 완전한 JSON 또는 전체 읽기의 근거가 아니다. 파일은 원본 그대로 유지하며 페이지를 만들기 위해 다시 포맷하지 않는다.

후속 전체 검사에서 공통 토스트의 이름만 있고 역할이 없는 `div`가 `aria-prohibited-attr` 오류로 드러났다. 알림이 실제로 표시된 상태를 고정 검사하고 기존 컨테이너에 `role="region"`을 추가했다. CSS나 구성요소 껍데기는 바꾸지 않았다.

## BP와 실제 오픈소스 적용

- [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)의 원문 포인터를 유지하고 필요할 때 읽는 방식을 적용했다. 포인터 존재만 검사하지 않고 실제 전체 재조회까지 검증한다. 회사 원문을 별도 디스크에 쓰지 않는다.
- [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)의 최종 환경 상태 평가와 회귀 검사 구분을 적용했다. 함수가 성공했다고 표시하는지만 보지 않고 입력이 보존됐는지, 결과가 복원되는지, 취소 뒤 상태가 그대로인지 확인한다. 합성 제공자 응답은 실제 Qwen 평가로 계산하지 않는다.
- [QuickJS 공식 testing 지침](https://github.com/justjake/quickjs-emscripten#testing-your-code)에 따라 **@jitl/quickjs-wasmfile-debug-sync 0.32.0**을 개발 의존성으로 실제 추가했다. MIT, 기존 core/release와 버전을 맞췄다. 제품은 기존 release runtime만 사용하므로 새 사용자 설치 요구가 없다. 버전과 integrity는 lockfile에 고정했다.
- **Pi Coding Agent SDK 0.86.1**의 스킬 로더와 읽기/편집 실행기는 유지한다. upstream의 긴 줄 안내는 shell fallback을 전제로 하지만 Office 메모리 도구에는 shell이 없으므로 읽기 어댑터에만 제한된 문자 페이지를 추가했다. 새 에이전트 프레임워크나 문서 파일 직접 접근 도구를 도입하지 않았다.
- 기존 **fast-check 4.10.2**를 활용해 고정 seed `2392302`의 Unicode 입력 100개를 생성했다. 각 페이지의 바이트 한도, 포인터 진전, 전체 원문 재결합을 검사한다. 기존 계산 정답 생성 검사 20개도 유지한다.

- [WAI-ARIA generic 역할](https://www.w3.org/TR/wai-aria-1.2/#generic)의 이름 제한을 따라 토스트 역할을 수정했다. **patch-package 8.0.1**(MIT)을 개발 도구로 적용해 기존 CX 0.5.4의 최소 패치를 추적한다. 최초 설치와 테스트/빌드 전에 재적용하고 실패 시 중단한다. 자체 패치 실행기를 만들거나 전체 UI를 복제하지 않았다. 추가 개발 의존성 52개이며 제품 runtime 의존성에는 추가하지 않는다. 실제 수정/원본 라이선스는 patches 및 THIRD-PARTY-NOTICES에 남긴다.

QuickJS 0.32.0의 `TestQuickJSWASMModule.newRuntime`은 `ownedLifetimes` 추적 정리를 기대하지만 설치된 `QuickJSWASMModule.newRuntime`은 이를 전달하지 않는다. 해제된 runtime이 추적 Set에 남는 것을 실제 메모리 누수로 오인하지 않도록 **먼저 모든 runtime/context의 `alive === false`를 검증**하고, 그 뒤 죽은 추적 참조만 정리한 후 upstream 메모리 검사를 호출한다. 살아 있는 객체를 테스트에서 대신 해제해 통과시키지 않는다. upstream 소스나 제품 라이브러리는 패치하지 않았다. 이 검사는 해당 경로의 검증이며 보안 인증이나 모든 메모리 누수의 부재를 뜻하지 않는다.

## 검증 기록과 작업폴더 차이

- 변경 전 게시 소스의 전체 334개 검사가 통과했지만 새 경계 조건 검사는 실패했다. 따라서 기존 합격 수를 품질 완성도로 해석하지 않는다.
- 새 검사: 긴 결과 실제 재조합, 연속 5회 계산의 입력 보존과 영수증, 출력 getter의 비동기 작업 거절, 취소 후 결과 보존, 소스 버전 변경, 문자/줄 경계, prototype 변조, release/debug 수명 검사.
- 전체 검사 중 과도한 프로세스 병렬 실행이 debug VM의 250 ms 제한을 소비하는 현상을 확인해 테스트 파일을 순차 실행하도록 고정했다. 제품의 실행 제한은 늘리지 않았다. 토스트 접근성 오류는 부하 문제가 아니라 실제 역할 누락이어서 코드와 재현 검사로 수정했다.
- 게시 작업폴더 전체 **347/347** 통과, 변경된 의도 라우팅 fixture는 후속 **12/12** 통과. 고정 Nubi UI **24개 파일** 일치, 디자인 검사 오류 0건. 개발 작업폴더는 349개 중 2개 실패였고, fixture 수정 후 해당 12개 검사가 통과했다. 남은 공유 UI 기준 불일치는 다른 작업 변경으로 따로 기록한다.
- 최신 전체 검사 수와 게시 소스 해시는 `verification/quality-review.json`에 기록한다. 실제 Pi 통합의 모델 판단과 native Office 응답은 fixture다.
- 개발 작업폴더의 최초 전체 검사는 332/334였다. 게시본에 없는 협업 연동에서 테스트 제공자의 `status` 계약 오류 1개, 다른 작업에서 변경된 공유 UI 7개 파일의 기준 해시 불일치 1개다. 협업 연동 테스트의 제공자 fixture에 실제 `status()` 계약을 추가했다. 이 검사는 중복 실행 방지 목적을 유지한다. 다른 작업의 UI 변경을 덮어쓰거나 미검토 기준 해시를 갱신하지 않는다. 게시 작업폴더의 고정 UI와 Office 하네스를 기준으로 다시 전체 검사한다. 개발 작업폴더 전체가 모두 통과했다고 표시하지 않는다.

## 남은 개선 우선순위

1. P0: 회사 Qwen와 실제 Office 2016에서 작성 결과, 저장 후 재열기, 수식/서식, 오류 복구, 인증과 NASCA 검증. 현재 미측정이다.
2. P1: 180,000자 초과 최종 근거의 계층 검토. 메모리 계산 결과의 페이지 읽기 개선과 별도 과제다.
3. P1: DPAPI 기반 실행 상태의 영구 보존과 native 영수증 재조정. 현재 worker 재시작 복구는 없다.
4. P1: 기업 정책에 맞는 Python/의존성 준비 및 외부 스킬 등록. QuickJS 도입이 Python이나 임의 패키지 설치를 지원하는 것은 아니다.
5. P2: 복잡한 Word 필드와 PPT 혼합 run/표/차트. native 보존 검사를 먼저 확장해야 한다.
