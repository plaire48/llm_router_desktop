# 문서 작성용 Coding Agent SDK 재사용

2026-09-23. 사용자는 문서 작성용 스킬·스크립트 개선을 범위로 확정했다. 기준은 Windows Office 2016과 사내 Qwen 3.8 27B다. 현재 선택한 제공자/모델을 그대로 사용한다. 일반 프로젝트 수정, Python 실행과 의존성 설치까지 완료했다는 의미는 아니다.

후속 상태: [QuickJS 문서 계산 실행](DOCUMENT-SCRIPT-RUNTIME-2026-09-23.md)에서 제한된 JavaScript 실행과 메모리 결과를 연결했다. 아래 초기 SDK 도입의 실행 미구현 설명은 해당 변경 이전의 범위다. Python과 고정 패키지 설치는 후속 [Python 실행기](PYTHON-SKILLS.md)에 반영했다. 외부 스킬 자동 설치는 남아 있다.

## 실제 채택

| 기능 | 기존 구현 | 현재 재사용 |
|---|---|---|
| 도구 선택/실행 루프 | 이미 Pi agent core를 사용 | 기존 `@earendil-works/pi-agent-core` 0.86.1 유지 |
| 스킬 발견/프롬프트 구성 | 설계만 존재 | **Pi Coding Agent SDK 0.86.1**의 `loadSkillsFromDir`, `formatSkillsForPrompt` 직접 호출 |
| 문서 검색/읽기 | 전용 과거 대화/Office 검색만 지원 | SDK `createFindTool`, `createReadTool`을 세 앱의 actor에 실제 연결 |
| 초안/스크립트 편집 | Excel 전용 조각 작성만 지원 | SDK `createWriteTool`, `createEditTool`의 정확한 치환, 모호성 거부, 파일별 직렬화, diff 재사용 |
| 컨텍스트 | 자체 Office 상태 재구성과 원문 검색 | 스킬 이름/설명/파일 참조만 먼저 노출하고 필요할 때 본문/참조 문서를 읽음. SDK 줄 단위 읽기와 `truncateHead` 재사용. 기존 원문/승인/receipt 보존은 유지 |
| 하위 분석 병렬 실행 | 자체 cursor/worker 루프 | **p-map 7.0.4**로 동시성/대기열/취소를 처리. 원래의 작업 범위·근거 검증·429 정책은 Office 어댑터가 유지 |

라이브러리는 이름만 의존성에 추가한 것이 아니라 실행 중 해당 함수를 직접 호출한다. 스킬 parser, 일반 edit 알고리즘, 파일별 mutation queue, 병렬 map 실행기를 별도로 새로 구현하지 않는다. 자체 코드는 Office 범위, 메모리 저장소, schema/readback/HITL 계약을 연결하는 데 둔다.

## 사용자에게 연결되는 흐름

앱별 기본 스킬을 자동으로 발견한다. 모델은 필요에 따라 `find` → `read SKILL.md` → 필요한 참조 문서의 일부를 읽는다. 작업창은 실제 호출에 맞춰 문서 찾기/읽기/초안 코드 작성·수정을 표시한다. 사용자가 별도 CLI나 모드를 선택할 필요가 없다.

Excel 새 문서의 `draft/sheet.json`은 현재 시트 초안에 직접 바인딩되어 있다. SDK로 이 JSON을 수정하면 schema 검증 후 같은 시트의 보류 중인 내용/수식/서식에 반영된다. 검증 실패 시 이전 초안을 유지한다. `commit_document_sheet`, 수식 사전 검사, native 계산/readback, 요구사항 검토, 저장 승인이 계속 필요하다. SDK 도구 성공을 문서 완료로 바꾸지 않는다.

Word/PPT와 기존 Excel 편집은 참고 스킬과 메모리 초안을 사용하고 실제 변경은 기존 native 도구로 수행한다. scratch JSON을 작성했다고 Word 문단이나 PPT 슬라이드가 변경된 것으로 표시하지 않는다.

`draft/*.py`, `*.js`, `*.json`, `*.md`, `*.txt`는 문서 작성에 필요한 **실행별 메모리 초안**이다. 코드 작성/치환은 가능하지만 실행, 저장, 의존성 설치, 외부 스킬 설치 기능은 이번 범위에서 구현하지 않았다. 파일당 60,000자, 최대 8개 초안, 전체 120,000자다. 원본 Office 파일을 일반 파일 도구로 열지 않는다. NASCA 문서는 기존 native open/save를 사용한다.

## 채택 판단과 공식 근거

- [Pi SDK](https://pi.dev/docs/latest/sdk), [고정 버전 SDK 명세](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/docs/sdk.md): MIT, 기존 Pi 0.86.1 및 Node 22.19+ 기준과 맞는다. SDK 도구의 operations 인터페이스에 메모리 backend를 제공할 수 있다. 모델/인증/runtime을 별도로 만들 필요가 없다. `createAgentSession()` 기본 설정은 전역 자격증명·프로젝트 리소스·세션 파일을 발견할 수 있으므로 호출하지 않고 필요한 도구/스킬 모듈을 재사용한다.
- [OpenCode SDK](https://opencode.ai/docs/sdk/), [agents](https://opencode.ai/docs/agents/): 별도 서버의 세션/서브에이전트/권한 모델은 좋은 참고다. 현재 Office의 같은 프로세스·provider 어댑터·Pi 루프에 결합하기에는 추가 서버/바이너리·인증/상태 연결이 필요하다. 이번 기반은 Pi로 정하고 OpenCode의 권한/반복 감지 패턴은 기존 적용을 유지한다. Qwen에서 Pi가 더 빠르거나 정확하다는 실증 결과는 없다.
- [Agent Skills 단계적 로딩](https://agentskills.io/integrate-skills), [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): 검색 가능한 가벼운 참조와 필요한 시점의 원문 조회를 사용한다. 스킬 본문 전체를 매번 초기 문맥에 넣지 않는다. 정확한 사용자 조건과 native 검증 결과를 요약문으로 대체하지 않는다.
- [p-map](https://github.com/sindresorhus/p-map): MIT, 동시성 상한과 AbortSignal 지원. 취소는 Office의 `cancelled`로 정규화한다. 429 뒤 새 작업 발행 중지, Retry-After 전달, 성공한 분기 재사용, ChatGPT의 직렬 요청을 유지한다. 이미 시작한 분기는 별도 AbortController와 late-result fence를 계속 사용한다.

SDK 추가 설치에서 로컬 의존성 145개가 추가되었다. 전체 Coding SDK를 설치하므로 작은 utility 하나와 같은 비용이라고 설명하지 않는다. 버전과 integrity는 lockfile에 고정했다. Windows x86/x64 런타임/패키지 포함 검증은 최종 빌드 때 필요하다. 기본 SDK의 셸, 자동 fd 다운로드, 글로벌 스킬/확장 발견, 인증 저장소는 이번 도구 경로에 연결하지 않았다.

## 검증과 남은 단계

실제 설치한 Pi SDK를 사용해 한국어/CRLF 보존, 모호한 치환 거부, 동시 수정 직렬화, 줄별 조회, 외부 경로/읽기 전용 리소스 차단, run 간 초안 격리, 취소와 schema 실패 시 초안 보존을 검사한다. 실제 Office worker+Pi 루프에서 스킬 읽기 → 현재 시트 JSON 작성/수정 → native 초안 요청 → 별도 저장 승인까지 연결했으며, native 응답과 모델 응답은 테스트 fixture다. Word/PPT와 기존 Excel 편집의 스킬 연결도 원래 편집 승인을 유지한다.

전체 소스 검사/의존성/변경 소스 해시는 `verification/coding-sdk-review.json`에 기록한다. 설치본, 실제 회사 Qwen 성능, Office 2016 COM, NASCA 암복호화는 별도 미검증이다. 빌드 스크립트에는 SDK runtime 및 스킬 리소스 복사를 추가했지만 빌드는 실행하지 않았다.

다음 단계는 검토한 문서 스킬을 더 추가하고, 고정 의존성/격리 실행/산출물 검증을 갖춘 Python 실행을 연결하는 것이다. 현재 메모리 초안은 worker 종료 뒤 복원되지 않는다. 일반 프로젝트 파일 편집이나 임의 스크립트 실행으로 범위를 확대하지 않는다.
