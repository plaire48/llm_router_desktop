# 문서 작성 코드의 즉시 문법 진단

2026-09-23. 기준 게시 소스 `54287b91ed7f653c06a6eec927ee66f0004c32f2`. Windows Office 2016과 사내 Qwen 3.8 27B를 기준으로 기존 제공자와 모델 선택을 유지한다. 설치 빌드는 실행하지 않았다.

## 부족했던 흐름과 실제 개선

기존 Pi write/edit는 초안을 변경하고 diff를 반환했지만 문법 오류는 run_script 실행 때야 확인할 수 있었다. 계산 코드를 수정하는 모델이 실행 전 오류를 확인하고 다음 수정을 결정할 수 있도록 같은 도구 결과에 진단을 연결했다.

`스킬/원문 조회 → 메모리 초안 작성/수정 → 실행 없는 문법 진단 → 오류 수정 → 명시적 run_script → 결과 확인 → 기존 Office 승인/반영/readback`으로 이어진다. Excel/Word/PowerPoint가 사용하는 공통 작업공간에 반영했으며 추가 사용자 모드나 설치 단계는 없다.

- JavaScript는 기존 QuickJS 0.32.0의 `compileOnly`를 실제 호출한다. 스크립트 본문, transform 함수, 무한 루프, top-level throw/Promise를 실행하지 않는다. 별도 worker의 기존 WASM 메모리/CPU/watchdog/취소 경계를 사용한다.
- 일반 JSON 초안은 JSON.parse로 문법을 검사한다. 메시지에 잘못된 JSON의 값이나 내용 조각을 복사하지 않는다. 현재 Excel 시트에 바인딩된 JSON의 기존 schema 검증은 그대로 먼저 적용된다.
- 결과는 `valid`, `invalid`, `unsupported`, `unavailable`, 검사 중 `pending`, 취소 후 `cancelled`를 구분한다. JavaScript 오류에는 얻을 수 있는 경우 줄 번호를 전달한다. Python 등 검사기가 없는 형식은 성공으로 표시하지 않는다.
- **초안 변경은 committed, 문법 진단은 별도 결과**다. 진단이 실패해도 이미 작성된 메모리 초안을 거절/원상복구했다고 말하지 않는다. 오류를 보고 새로운 edit로 고친다. 결과가 불확실한 Office 쓰기를 자동 재전송하는 경로는 추가하지 않는다.
- 진단은 원문 SHA-256에 연결하고 현재 초안과 달라지면 current:false로 표시한다. 실행 문맥이 다시 구성돼도 최신 진단을 유지하며 늦게 끝난 검사가 새 진단을 덮어쓰지 않는다. 실행별 최대 8개 초안의 현재 진단만 유지한다.
- 문법 통과는 타입 검사, transform 진입점 확인, 계산값/업무 규칙 충족 또는 문서 완료가 아니다. run_script와 실제 Office 검토는 계속 필요하다. 코드 길이 한도 등 검사 불가 상태도 통과로 바꾸지 않는다.

문법 검사마다 JS worker 초기화 비용이 추가된다. 기존 3초 watchdog과 32,000자 코드 한도를 재사용하며 자동 검사 재시도나 별도 언어 서버는 추가하지 않았다. 실제 Windows 지연/토큰/정확도 개선은 미측정이다.

## BP와 오픈소스 선택

| 후보와 근거 | 채택/비채택 판단 |
|---|---|
| [OpenCode edit 소스](https://github.com/anomalyco/opencode/blob/18ef3cc7c5a25b82114c953a80ccc09f4988f74e/packages/opencode/src/tool/edit.ts), MIT | 수정된 코드의 진단을 결과에 포함해 후속 수정을 유도하는 패턴 참고. 소스 복사나 OpenCode 서버/Effect/LSP 도입은 하지 않았다. 현재 Pi 인증/도구/Office 승인과 중복된 런타임을 추가하지 않는다. |
| [QuickJS Emscripten](https://github.com/justjake/quickjs-emscripten/blob/main/packages/quickjs-emscripten-core/src/types.ts), MIT | 기존 0.32.0에 존재하는 compileOnly 기능을 실제 재사용. 실행 엔진과 같은 문법으로 검사하며 별도 parser 의존성이 없다. 전체 언어 서버의 타입 진단을 제공한다고 표현하지 않는다. |
| [Anthropic long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 작은 변경 후 관찰 가능한 검사 결과를 다음 행동으로 연결하고, 부분 성공과 최종 완료를 분리하는 원칙 적용. Claude 계정/SDK 의존성이나 영구 세션 복구를 추가한 것은 아니다. |
| Pi Coding Agent 0.86.1 / 기존 테스트 도구 | 기존 write/edit, diff, 실행 루프를 그대로 호출한다. QuickJS release/debug의 실제 메모리 해제 검사도 재사용한다. 새 패키지/라이선스 변경 없음. |

OpenCode 참고 소스 커밋은 `18ef3cc7c5a25b82114c953a80ccc09f4988f74e`이며 파일 해시를 검사 기록에 남겼다. 후보 이름만으로 채택하지 않고 현재 구조와 추가 설치/의존성 비용을 비교했다.

## 검증

- 개선 전 새 회귀 검사 4개가 모두 실패. 개선 후 개발 작업폴더의 관련 검사 43/43 통과.
- 게시 작업폴더 전체 소스 검사 393/393 통과. 디자인 정적 검사 0건, 기존 공유 UI 24파일 일치.
- 실제 QuickJS compile-only로 잘못된 구문/줄 번호, 실행하지 않는 무한 루프/top-level throw/Promise, 이후 정상 계산, 검사 취소, release/debug 해제 검사를 수행했다.
- 실제 Pi actor에서 잘못된 코드 작성 → 진단 수신 → edit → 문법 통과 → 12+30 실행 → A1 반영 승인 대기를 확인했다. 승인 전 native 쓰기는 0회, 승인 후 fixture 쓰기는 1회다. 모델 결정과 Office 응답은 합성 fixture이며 Qwen/COM 성공 증거가 아니다.
- 기존 결과/범위/HITL/계산/복구 회귀 검사를 유지했다. 소스 기록은 [검증 JSON](../verification/workspace-diagnostics-review.json)을 따른다.

## 아직 남은 우선순위

1. 실제 Qwen과 Windows Office 2016에서 오류 수정 성공률, 저장 후 재열기, 수식/서식/SSO/NASCA 검증. 현재 연결 환경이 없어 미측정.
2. 긴 단일 항목의 숨겨진 원문 조회와 180,000자 초과 전체 근거의 계층 검토. 직전 수정의 불완전 근거 차단은 유지.
3. 보호 저장소 기반 재시작 복구와 불확실한 쓰기 조정. 현재 진단과 실행 상태는 메모리뿐.
4. 기업 저장소/격리/산출물 검증을 갖춘 Python 및 외부 스킬 의존성 설치. 이번 JavaScript 문법 검사가 해당 기능을 대체하지 않음.
5. 복잡한 Word 입력칸, PPT 혼합 서식/표/차트 편집 및 시각적 결과 검증.

위 항목은 전체 개발 완료로 처리하지 않았다. 개발 작업폴더의 별도 공유 UI 기준 차이 7파일도 이번 게시 범위에 포함하지 않았다.
