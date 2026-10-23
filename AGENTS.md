# AGENTS.md

## Main 반영 기준 (사용자 결정 2026-10-23)

- 개발과 해당 변경의 검증이 끝나면 MUST 완료한 변경을 해당 제품 저장소의 `main`에 커밋하고 원격 `main`까지 바로 반영한다. 이 지시는 매번의 정상적인 main 반영을 승인한 것이므로 같은 승인을 다시 묻지 않는다.
- 누비 Desktop 소스의 대상은 `plaire48/llm_router_desktop`의 `main`이다. 현재 폴더의 라우터 `origin`과 혼동하지 않는다. 기존 main의 변경을 보존하며 강제 푸시, reset, clean, 자동 stash나 다른 미완료 작업의 일괄 커밋은 하지 않는다.
- 소스 입력과 업로드 안전 검사를 유지하고 실제 원격 SHA를 확인한다. 소스 main 반영, CI 통과, 설치판 배포와 Windows 실기기 검증은 각각 구분해 보고한다. 기존 업로더 담당자 제한은 사용자가 명시한 이 main 반영 범위에서 대체한다.

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

- OpenCode 감사 후속 2026-10-23: 관리형 서버는 인스턴스별 인증을 유지하고 진행 요청/대기 도구를 끊는 프로필 변경과 로그인 재시작을 거절한다. 도구 결과 재개는 최초 모델/지시/함수/출력 조건을 대조하고 불일치 때 결과를 발행하지 않는다. 과거 메시지는 역할을 표시한 자료로 전달하며 native 역할 완전 호환이라고 표시하지 않는다. 만료 정리와 최대 32개 MCP 슬롯, 미확정 정리 슬롯 격리를 유지한다. `tests/test_opencode_safety.py`와 `tools/check_opencode_inheritance.py`는 회귀 기준이며 실제 모델/Windows/제품 전체 품질과 구분한다.

## 프로젝트

LLM Router — OpenAI 브라우저 로그인과 사내 LLM을 하나의 localhost OpenAI 호환 Endpoint로 여는 로컬 게이트웨이. Codex 구독 OAuth는 정책상 비활성이다.

- OpenAI: wheel에 포함된 OpenCode로 ChatGPT 브라우저 로그인과 추론을 실행한다.
- 그 외 제공자: API key를 추가해서 열고 관리한다.
- OpenCrew 호환이 목표: OpenCrew(PyPI `opencrew`, Letta 기반 로컬 에이전트 런타임, Python 3.11+)는 Anthropic/OpenAI API key와 `provider/model` 표기로 LLM을 소비한다. 이 라우터가 발급한 로컬 key·엔드포인트를 OpenCrew에 그대로 꽂아 쓸 수 있어야 한다.
- API key는 .env로 관리하고, LLM은 프로필 형태로 관리할 수 있어야 한다.

## 역할 분담 (MUST)

- Codex(Codex)는 계획·설계·명세·리뷰를 담당한다. 구현 코드를 직접 작성하지 않는다 (사용자가 명시적으로 요청한 경우만 예외).
- 구현(개발)은 Codex가 담당한다. 구현이 필요하면 Codex에 넘길 명세/프롬프트를 산출물로 만든다.

## 커뮤니케이션

- 대화와 설명은 한국어로 한다. 코드, 식별자, 커밋 메시지는 영어로 쓴다.
- 사용자 설명과 화면 문구는 핵심 결과와 다음 행동부터 짧은 문장으로 쓴다. 판단에 필요한 세부 정보는 남기고 반복 설명은 뺀다. 중간점을 사용하지 않는다. 화면은 주요 동작을 먼저 보여주고 보조 설명은 필요할 때 펼친다.

## 작업 방법 (MUST)

- 모든 작업에서 관련 방법론·개선 방법·BP·오픈소스의 활용 가능성을 MUST 검토한다. 장애가 생겼을 때만이 아니라 요구사항 분석·설계·구현·UI/UX·하네스·오류 복구·검증·배포의 각 판단에 적용한다. 기존 구현과 검토 기록을 먼저 확인하고, 도입 판단에 필요한 내용은 최신 공식 문서와 실제 소스로 검증한다.
- 사용자 목표, 실행 환경, 정확도와 복구 능력, 라이선스, 유지보수, 의존성과 비용을 비교해 효과가 있는 방식을 적용한다. 패키지 도입뿐 아니라 검증된 설계 패턴과 기존 라이브러리 개선도 선택지다. 후보를 찾았다는 이유만으로 채택하지 않으며, 기존 검토는 전제가 유효하면 재사용한다.
- 작은 단계로 실행하고 실제 입력과 결과를 확인한 뒤 다음 행동을 정한다. 반복 실패하거나 진전이 없으면 원인을 분리하고 방법론·도구·대안을 다시 검토한다. 같은 요청의 반복을 개선으로 간주하지 않고 완료한 변경을 무조건 재실행하지 않는다. 필요한 정보는 질문하고 최종 반영 승인은 기존 HITL을 따른다.
- 선택·비선택 근거, 실제 반영한 내용과 검증 범위를 짧게 남긴다. 단순 참고와 실제 도입, 합성 검사와 실제 모델 성능·실서비스 성공을 구분한다. 이 검토 규칙은 사용자가 정한 빌드·배포 시점이나 승인 조건을 변경하지 않는다.

## 명령어

- 설치: `python3 -m pip install -e '.[dev]'`
- 로컬 실행: `llm-router serve --profiles profiles.yaml`
- 전체 테스트: `python3 -m pytest`
- 단일 테스트: `python3 -m pytest tests/test_server.py -v`
- 린트: `ruff check src tests`
- 포맷 확인: `ruff format --check src tests`

## 아키텍처

승인된 설계 스펙: `docs/superpowers/specs/2026-08-12-llm-router-design.md` — 작업 전 반드시 읽는다.

- 스택: Python 3.11+ / FastAPI / httpx / Pydantic / typer.
- 형태: OpenAI 호환 표면(chat/completions·models·health) + 마스터 키 인증 + model명→프로필 라우팅 + provider 어댑터. Anthropic은 OAuth/API key 겸용·포맷 변환. OpenAI는 OAuth(구독)/API key 겸용 — 구독 OAuth가 여는 API 형태는 스파이크(스펙 §7B)가 확정하며 chat↔Responses 변환이 필요할 수 있음. OpenAI호환은 패스스루.
- Anthropic 구독 OAuth는 정책 준수를 위해 MUST 비활성화한다. 로그인·OAuth 프로필 생성·모델 노출·추론을 거부하며, 기존 토큰은 자동 삭제하지 않되 NEVER 사용한다. 정식 API-key 어댑터의 내부 계약 테스트와 과거 사용량 데이터는 유지한다.
- OpenAI 브라우저 로그인은 내부 OpenCode의 `/provider/openai/oauth/authorize|callback` API를 사용한다. localhost callback·토큰 교환·저장·refresh와 추론을 모두 OpenCode에 맡기며 별도 Codex 계정 런타임을 시작하지 않는다.
- OpenAI OAuth 토큰은 `~/.llm-router/opencode/data/opencode/auth.json`의 격리된 OpenCode 저장소에만 둔다. Codex CLI/IDE 세션을 공유하거나 수정하지 않는다.
- 사용량 대시보드: `usage/` 모듈이 모든 호출을 SQLite(`~/.llm-router/usage.db`)에 기록하고 `/dashboard`에서 웹으로 본다. 본문은 `LLM_ROUTER_LOG_BODIES=true`일 때만 저장한다. 데스크톱 앱이 아니라 라우터가 직접 서빙하는 웹 UI다.
- UI는 `연결 / LLM 서빙 / 대시보드` 메뉴를 갖는 흰색 데스크톱 콘솔이다. 프로필은 UI에서 추가·편집·삭제하며, 단일 Gateway가 요청의 `model` 값으로 프로필을 선택한다. 계정 한도는 읽기 전용이다.
- Agent Factory SDK는 수정하지 않는다. 기존 OpenAI 호환 HTTP LLM 프로필이 `http://127.0.0.1:8787/v1/chat/completions`와 라우터 프로필 이름을 사용하도록 llm-router 쪽에서 계약을 맞춘다.
- OpenAI OAuth 로그인·추론 경로는 `client -> llm-router -> OpenCode headless server -> OpenAI`다. 라우터가 격리된 앱 디렉터리에서 OpenCode를 지연 시작하고, 요청마다 임시 session/message를 사용해 Chat Completions로 변환한다. 프로젝트 config·외부 plugin·도구 권한·공유는 비활성화한다. OpenAI 요청의 `User-Agent`와 `originator`는 OpenCode 공식 내장 플러그인이 생성하며 라우터가 덮어쓰지 않는다. 부모 환경의 OpenAI endpoint/key 및 Bun/OpenCode 플러그인 override는 내부 런타임에 전달하지 않는다. OpenCode session API가 호출자 정의 tools를 투명하게 전달하지 못하므로 tools 요청은 명시적으로 거부하고, streaming은 완료 응답을 SSE로 버퍼링한다.
- AI Pro는 API key 프로필로 연결하되 직접 Python HTTP 어댑터로 호출하지 않는다. 격리된 번들 OpenCode에 `@ai-sdk/openai-compatible` custom provider를 구성하고 Endpoint·모델·API key 환경변수 참조만 넘긴다. `User-Agent`를 수동 설정하거나 위장하지 않으며 OpenCode가 자연스럽게 생성한 요청을 사용한다.
- Chrome 채팅 확장은 MUST 라우터·Python·OpenCode·Native Messaging 호스트 설치 없이 동작하는 별도 클라이언트로 설계한다. AI Pro localhost 콜백의 확장 연계와 정상 Chrome 직접 호출은 실서비스 검증 대상이며, 기존 라우터의 OpenCode 경로는 유지한다. 설계 초안: `docs/superpowers/specs/2026-09-18-aipro-chrome-chat-proposal.md`.
- 확장 테스트판은 `extensions/aipro-chat`에서 `npm test`, `npm run design:check`, `npm run build`로 검증·패키징한다. AI Pro는 DNR 세션 규칙으로 로그인 탭·포트의 GET /auth 콜백을 확장 페이지로 전환하며 debugger를 사용하지 않는다. nonce/탭/문서/최상위 frame을 검사하고 인증값은 trusted session, 대화·설정은 local 저장소에 둔다. 대기 중 규칙은 worker 휴면을 견디며 종료 시 제거한다. 인증 진단은 단계와 교환 HTTP 상태만 기록한다. ChatGPT와 브라우저 자동화 debugger 경로는 분리한다. SSO code는 POST /auth/exchange에 URL-encoded code 필드로 한 번 보내고 JSON token의 JWT를 사용한다. 확장의 GET /api/models와 채팅 POST /api/v1/chat/completions는 Authorization: Bearer <token>을 사용한다. code는 저장하지 않으며 취소/만료/worker 재시작 후 교환을 재시도하지 않는다. 합성 Chrome 검증과 실제 AI Pro 로그인·직접 호출 성공은 구분한다.
- 확장 브라우저 에이전트는 Pi agent core를 번들에 포함한다. 기존 AI Pro Bearer/SSE 계약과 CX UI는 유지하고 페이지 읽기/입력은 확장 도구로 실행한다. Pi CLI나 외부 런타임 설치를 요구하지 않는다. 선택 근거와 실모델 평가 기준은 `docs/research/2026-09-21-aipro-agent-harness-bp.md`를 따른다.
- `packages/office-copilot-aipro`는 기존 Excel Copilot 대화 안에서 AI Pro를 호출하는 미리보기 스킬·원격 MCP 검증 패키지다. 별도 채팅창이나 기본 Copilot LLM 교체로 바꾸지 않는다. AI Pro는 범위가 검증된 변경 제안만 반환하고 실제 편집·readback은 Copilot의 Excel 도구가 담당한다. 단일 Entra 사용자와 전용 AI Pro 인증을 연결하며 기존 인증 저장소를 가져오지 않는다. 로컬 MCP 테스트·패키징과 실제 테넌트 설치·AI Pro·Excel 편집 성공을 MUST 구분한다. 배포 전제와 제한은 해당 README를 따른다.
- `packages/nubi-office`는 Windows Office 2016 Excel/Word/PowerPoint용 누비의 VSTO+WebView2 구현이다. Apache-2.0 Office AI Agent 호스트를 고정 소스로 포함하고, 누비의 Pi 실행기·응답 파서·AI Pro/ChatGPT/FabriX 어댑터·브랜드를 재사용한다. 작업창은 React 19에서 누비의 NubiSurfaces·Welcome·ChatControls·MessageBody·ConversationHistory·QuestionForm·DeckSurfaces 및 전체 CSS를 직접 재사용하고, Excel RPC와 상태만 별도 연결한다. 공통 껍데기를 Office 전용 복사본으로 분기하지 않는다. 사용자 결정에 따라 화면 연결은 AI Pro, ChatGPT, FabriX 3개만 표시하며 각 제공자의 모델 목록과 명시적 선택을 보존한다. 기존 추가 어댑터를 화면에 노출하지 않는다. 숨겨진 번들 Node worker와 stdin/stdout JSON RPC를 사용하며 사용자에게 Node·Python·라우터·Chrome 확장 설치를 요구하지 않는다. 인증은 Office 전용 메모리에만 두고 기존 저장소를 읽지 않는다. COM은 UI/STA에서 실행하며 문서/범위 바인딩·충돌 확인·readback·작업 ID 중복 방지·변경 복구를 수행한다. 부분/미확정 쓰기는 NEVER 자동 재전송한다. 값의 자료형·문서 날짜 체계와 서식을 함께 검증하며 기준 셀 서식 복사는 현재 선택 범위의 지원 속성에 한정한다. 값/수식과 표시 텍스트를 구분하고 입력 제한 위반·예상 밖의 양식 구조 변경을 성공/자동 복원 가능으로 표시하지 않는다. Office 하네스는 작업 계획을 채팅에 표시한 뒤 단계별 실행→실제 셀 비교→단계 결과 AI 검토→다음 단계로 진행하며 완료 상태를 모델의 선언으로 바꾸지 않는다. 누비 goal-review 파서를 재사용하고 최종 요청 검토를 별도로 수행한다. 실모델 평가는 전용 Windows Excel COM 실행기와 독립 정답/저장 후 재열기 검사로 수행하며 연결이 없으면 정확도는 미측정으로 둔다. 교차 컴파일·합성 테스트·브라우저 통합 성공과 실제 Windows VSTO 설치·Excel COM·각 제공자 실계정 성공을 MUST 구분한다. 원본 라이선스·커밋과 Windows 빌드 경계는 해당 README와 THIRD-PARTY-NOTICES를 따른다.
- 누비 Office의 기본 목적은 요구사항에서 완성된 Excel 문서를 만드는 것이다. 선택 셀 편집만으로 이 목표를 충족했다고 표시하지 않는다. 사용자가 작업 모드를 고르지 않고 요청하면 같은 모델의 읽기 전용 의도 분류가 기존 문서/셀/양식 실행기로 연결한다. 모호한 대상은 객관식/주관식 HITL로 묻고 같은 실행과 답변을 유지하며, 승인/쓰기 경계는 각 실행기가 유지한다. 새 문서 작성은 요구사항→시트 구성→Pi 기반 본문/표/수식/양식 작성→ExcelJS XLSX 생성→전용 Windows Excel 초안 읽기/계산→전체 요구사항 검토와 보완→고유 파일 저장으로 진행한다. 기존 셀 도구의 범위를 확대해 우회하지 않으며 생성한 초안만 DocumentPort가 관리한다. 사용자가 직접 바꾼 초안은 덮어쓰거나 닫지 않는다. 기업 공용 양식 카탈로그·차트 생성은 미구현 경계를 유지하며 Word/PPT는 별도의 native 실행기와 지원 범위를 따른다. 지정 명세 기반 파일 생성/LibreOffice 계산 검사는 실모델 문서 품질·Excel 2016 COM 검증의 증거가 아니다.
- 누비 Office의 채팅 진행 기록은 worker의 실제 도구·검토 호출 시작과 결과에 연결한다. 시간에 따라 가상 단계를 완료시키거나 모델의 비공개 추론을 표시하지 않는다. 위로 스크롤한 사용자의 위치를 유지하고 최신 작업으로 복귀할 수 있게 한다.
- 누비 Office의 기준은 MUST Windows Office 2016과 사내 Qwen 3.8 27B다. 실제 카탈로그 ID를 우선 선택하되 전체 모델 목록과 사용자 선택을 보존한다. 장애/품질 개선은 BP·오픈소스의 실제 적용성을 검토해 반영한다. 복구는 연결 재호출과 모델의 오류 수정·재검증으로 분리하며 횟수/전체 시간만으로 중단하지 않는다. 실제 작업 진전 없이 3회 실패하면 원인과 보존된 작업을 표시하고 같은 실행의 재시도/중지 HITL을 기다린다. 도구는 1개 실행 후 결과를 포함한 다음 모델 호출로 이어가며 재시도 자체를 완료로 표시하지 않는다. 독립된 읽기 전용 하위 분석은 제한된 병렬 호출을 허용하되 COM 읽기/쓰기는 UI/STA에서 순차 처리하고 기존 편집 범위를 넓히지 않는다. 통합문서 조회·원본 fingerprint·문맥 격리·Anthropic 방법론 적용 범위는 packages/nubi-office/docs/EXCEL-2016-AGENT.md를 따른다. 번들 worker는 Windows의 기존 시스템 인증서 신뢰를 사용하고 TLS 검증을 해제하지 않는다. 원래 목표·범위·완료 상태를 유지하고 작은 도구 호출과 문맥 재구성으로 이어간다. 기존 셀 반영·최종 파일 저장은 HITL을 받으며 모호한 요구사항은 누비의 객관식/주관식 폼으로 확인한다. 사용자 취소는 NEVER 자동 재개한다. 쓰기 응답 유실은 실행 기록·실제 상태를 읽어 확인하고 검증된 부분 변경만 충돌 방지 복원 후 재계획한다. 미확정 쓰기는 NEVER 맹목 재전송한다. 작업 상태는 worker 메모리이며 재시작 복구/실모델 정확도는 검증 전이다. 근거는 packages/nubi-office/docs/HARNESS-BP.md를 따른다.
- 누비 Office Windows 배포는 `native/Nubi.Office.AddIn`의 최소 VSTO 진입점과 기존 Nubi 호스트를 Inno Setup으로 묶는다. `scripts/Build-Installer.ps1`과 GitHub Windows workflow로 EXE를 생성하고 실제 설치·파일 해시·32/64비트 등록/연결 DLL·재설치·제거를 검사한다. 사전 배포판 자체 서명은 공인 배포자 서명이 아니며 인증서 신뢰 저장소나 Office 보안 정책을 NEVER 변경한다. Windows 설치 검사와 실제 Excel 2016 실행/실모델 평가는 MUST 구분한다.
- `packages/office-legacy-aipro`는 앞서 만든 ExcelApi 1.1·ES5/localhost HTTPS 방식의 AI Pro 전용 참고 구현으로 유지한다. 기본 확장 방향은 `packages/nubi-office`이며 기존 Microsoft 365 Copilot 패키지와 혼합하지 않는다.
- `packages/nubi-office`의 기존 양식 작성은 원본 Excel·관찰한 항목 명세·입력 답변을 분리한다. 같은 실행의 HITL로 확인한 입력 항목 값만 쓰고 수식·서식·병합을 보존한다. 병합 전체가 선택 안에 있는 수식 없는 첫 셀만 값 입력을 허용한다. 공용 양식 카탈로그나 재시작 복원으로 표시하지 않는다.
- `packages/openwiki`는 OpenWiki 0.5.2 고정 소스에 AI Pro 브라우저 SSO, AI Pro CLI와 FabriX 제공자를 추가한 독립 Node CLI 패키지다. 기존 OpenAI/ChatGPT 연결을 유지하며 라우터나 Chrome 확장을 요구하지 않는다. 확장의 인증값을 가져오지 않고 OpenWiki 자체 로그인/키 입력과 전용 환경 파일을 사용한다. 배포명은 `openwiki-SDS`(npm 식별자 `openwiki-sds`), 실행 명령은 `openwiki`다. 제공자는 `AI Pro (Browser SSO)`와 `AI Pro CLI`로 구분한다. Browser SSO는 `/auth/cli/login?port=...`을 열고, 토큰 교환·검증이 성공한 뒤 아이콘·모션·내장 폰트를 갖춘 자체 HTML/CSS/SVG openwiki-SDS 인증 완료 화면을 표시한다. 인증 완료 화면에 AI Pro 로고·제공받은 이미지 자산은 사용하지 않는다. CLI는 Base URL·토큰·Model ID를 직접 입력하고 `AIPRO_CLI_BASE_URL`과 `AIPRO_CLI_TOKEN`을 SSO의 `AIPRO_ACCESS_TOKEN`과 분리 저장한다. 일반 OpenAI-compatible 요청 경로에 `User-Agent: AIPROCLI`만 추가하며 고정 AI Pro 주소·모델 목록 조회·SSO를 사용하지 않는다. 배포 버전에는 enterprise 접미사를 붙이지 않는다. 일반 AI Pro와 라우터 경로는 유지한다. FabriX 도구 응답은 nonce와 JSON 스키마를 검증한다. 전체 JSON 코드 블록은 허용하고 형식 재요청은 한 번만 수행하며, 최종 형식 오류는 SDK 재시도 없이 원인 코드를 표시한다. 빌드·설치 및 실서비스 검증 범위는 `packages/openwiki/ENTERPRISE.md`를 따른다.
- 배포 wheel은 플랫폼별 공식 OpenCode 바이너리를 SHA-256 검증 후 포함하고 런타임에서 PATH보다 우선한다. macOS/Linux/Windows와 arm64/x64 wheel을 대상 플랫폼별로 빌드하며 x64는 baseline 바이너리를 사용한다. 절대 경로 `LLM_ROUTER_OPENCODE_BINARY`는 명시적 override다.
- Codex 계정 사용량은 현재 브라우저 OAuth 계정의 `GET /api/oauth/usage`만 읽고 5분 캐시한다. Admin key나 조직 구성원 API를 사용하지 않는다.
- OpenCode가 계정 한도 API를 공개하지 않는 동안 OpenAI 개인 계정 한도 카드는 미구성으로 표시하며, 이를 위해 별도 Codex 런타임으로 우회하지 않는다. 라우터를 통과한 토큰 사용량 집계는 유지한다.
- 로깅 실패는 추론 요청을 MUST 깨뜨리지 않는다. 사용량 기록 경로의 예외는 전부 삼킨다.
- Python HTTPS 요청은 기본 공개 CA에 `NODE_EXTRA_CA_CERTS`를 추가해 사내 TLS 검사 환경을 지원하며, 인증서 검증을 NEVER 비활성화한다.
- 구현이 진행되면 "여러 파일을 읽어야 보이는 큰 그림"만 여기에 갱신한다. 파일 트리 나열은 하지 않는다.

## 이 파일의 유지 규칙

- 누비 Office의 모든 컴포넌트와 모달은 기준 HTML과 공통 Nubi/CX 토큰을 MUST 유지한다. 본문은 핵심과 판단에 필요한 디테일만 보여주고 보조 근거는 접는다. 익숙한 보조 동작은 접근성 이름과 툴팁을 갖춘 아이콘으로 표시하며, 모호한 동작과 반영 승인에는 짧은 이름을 남긴다. 정확한 반영 대상과 핵심 결과만 볼드와 의미 있는 색상으로 강조하고, 색만으로 상태를 전달하지 않는다. 이미지와 아이콘은 의미 전달이 더 명확해질 때 우선 활용한다. `packages/nubi-office/docs/UI-IDENTITY-CONTRACT.md`의 디자인 검사와 실제 화면 검토를 따른다.

이 파일은 모든 세션의 컨텍스트에 로드된다. 짧을수록 좋다.

- 코드를 읽으면 알 수 있는 내용은 쓰지 않는다. 명령어, 결정사항, 제약, 함정만 기록한다.
- 일반적인 개발 조언("테스트를 작성하라" 류)은 쓰지 않는다.
- 스택 선택·컨벤션·아키텍처 결정이 내려지면 그 턴에서 바로 이 파일을 갱신한다.
- 절대 규칙은 MUST/NEVER로 쓰고, 선호 사항은 "선호:"로 구분한다.

- 누비 Office Windows 설치 빌드·설치 파일 생성은 사용자가 명시적으로 최종 빌드를 요청한 경우에만 수행한다. 반복 수정 중에는 소스 변경과 가벼운 검사까지만 진행한다.

- Nubi Office 양식은 Excel이 복제·저장한 `.xlsx` 내부 Custom XML 명세를 재사용한다. NASCA 자동 암복호화 환경은 Excel 경로를 유지하며 평문 명세 sidecar/외부 ZIP 재저장을 NEVER 사용한다. 실제 셀 비교·차이·미확인을 구분해 사용자에게 보여주고, XML 명세 재열기 성공을 전체 양식 동일성이나 암호화 검증으로 표현하지 않는다.

- 누비 Desktop의 설계 근거는 `docs/superpowers/specs/2026-09-23-nubi-desktop-workspace.md` 및 `2026-09-23-nubi-project-hub.md`다. 실행 가능한 첫 구현은 `packages/nubi-desktop`에 있으며, 자동 Wiki 갱신과 Office 작업 수신은 후속 범위다. 사용자 지식과 생성 Wiki의 편집·버전을 보존하고 프로젝트 근거만 범위에 맞게 공유하며 인증·실행·승인 권한은 각 호스트에 둔다. 기존 웹/Office 단독 사용과 읽기 전용 OpenWiki API를 MUST 유지한다.

- 누비 Word/PPT는 native 진입점으로 worker host를 고정하고 앱별 COM 도구를 사용한다. Excel 실행기와 섞지 않으며 UI/STA, 문서 바인딩, 변경 전 fingerprint, HITL과 실행 영수증을 유지한다. 하나의 설치 파일에서 Excel/Word/PowerPoint를 선택하고 공통 런타임을 공유한다. Word Open XML SDK 검증은 메모리 XML 요소에 한정하며 NASCA 문서를 ZIP 재저장하지 않는다. 지원 범위와 실제 도입/참고 구분은 packages/nubi-office/docs/OFFICE-2016-SPECIALIZATION.md, 개선 상태와 남은 검증은 packages/nubi-office/docs/IMPROVEMENT-STATUS.md를 따른다. Word 입력칸의 값/주변 XML 보존과 PPT 서식 run 관찰을 구분하며, 단계 검토와 최종 요구사항 검토는 다른 계약을 사용한다. 사용자가 최종 빌드를 요청하기 전 native/installer 빌드는 MUST 실행하지 않는다.

- Office 컨텍스트 관리는 `packages/nubi-office/docs/CONTEXT-MANAGEMENT-2026-09-23.md`를 따른다. 실행별 MiniSearch 원문 조회와 현재 문맥을 분리하고, 답변·native 근거·receipt는 압축으로 대체하지 않는다. 전체 요청 문자 예산은 실제 Qwen 토큰 한도 검증이 아니다.

- `packages/nubi-desktop`는 Theia 1.75/React 19의 누비 IDE 구현이다. 브라우저 검증과 Electron 호스트를 같은 확장으로 구성하고 기존 누비 CX/캐릭터/애니메이션·Pi·문맥 관리·제공자 및 OpenWiki 검색/읽기 전용 페어링을 소스 재사용한다. 로그인·연결·인사말·모델 선택·대화는 누비 웹 확장 컴포넌트를 직접 재사용하며 작업 화면만 소스·Wiki·실행·비교에 맞게 확장한다. 사용자 기준은 `agentfactorysdkdeck.html`의 단순한 화면이다. 변경안은 Monaco dirty/version·내용 해시와 실제 저장 readback으로 보호하며 HEAD worktree가 OS sandbox라고 표시하지 않는다. SQLite 작업/실행/비교 영수증과 실제 localhost 캡처를 보존하고 미확정 실행은 자동 재전송하지 않는다. 로컬·합성 모델·Electron 성공과 Windows 배포·실계정 모델·Office 수신/저장 성공을 구분한다. 상세 범위와 명령은 해당 README를 따른다. 병렬 분석·문맥 관리는 기존 누비 Pi 공통 하네스를 재사용하고, 하위 조회를 주 실행기의 코드 수정 관찰로 인정하지 않는다. 질문 시 하위 호출을 중단하고 요약 뒤 모든 원래 AC와 사용자 답변을 보존한다.

- 누비 Desktop은 현재 실행에서 읽은 소스 범위만 부분 수정하고 전체 교체는 전체 읽기를 요구한다. 작업 근거는 열린 작업공간의 `openwiki/nubi-evidence/`에 덮어쓰지 않는 Markdown 버전으로 남기며 실제 파일 해시와 문서 편집 여부를 재확인한다. 같은 로컬 상태 DB의 실행 소유권은 별도 SQLite 트랜잭션으로 보호하며 기기 간 협업 잠금으로 표시하지 않는다. 의존성 override·선택 근거·남은 경고는 `packages/nubi-desktop/docs/IMPROVEMENTS.md`를 따른다.

- 누비 Desktop의 프로젝트 지식은 Git `.nubi/knowledge.yaml`의 개념·코드·Wiki 관계와 DB 메타데이터를 출처별로 구분한다. Knex/Schema Inspector의 다중 DB 어댑터·SQLite 읽기 전용 수집·외부 메타데이터 계약을 사용하며, 원격 실접속/복합 FK/실행 lineage 검증은 별도다. DB 인증값은 호스트 메모리에만 보관한다. 모델 수정은 현재 실행에서 관찰한 파일·원래 AC·검증 방법을 연결한 변경 계획을 요구하고, 공통 Nubi 객관식/주관식 질문의 초안·답변·동일 작업 재개를 유지한다. 계획·정적 연결·DB 스키마만으로 완료를 판정하지 않는다.
- 누비 Desktop 복구는 공통 p-retry 추론 복구와 SQLite 도구/프로세스 기록을 사용한다. 실패한 명령은 AI가 실제 출력·소스를 확인해 수정안을 준비하고, 기존 사용자 실행 뒤 결과를 재검토한다. 재시작/응답 유실의 미확정 명령과 사용자 취소를 NEVER 자동 재실행한다. 미완료 기록 도구는 중복 실행을 차단하고 재개 전 실제 파일과 기록을 대조한다. `packages/nubi-desktop/docs/RECOVERY-HARNESS.md`의 제한을 유지한다.

- 누비 Desktop의 OpenWiki 연계는 기존 검색과 Claims resolver를 읽기 전용으로 재사용한다. 업무 별칭과 선언 관계를 검색에 결합하며, 현재 실행에서 조회한 Wiki 근거를 요구사항에 연결하고 계획과 변경 제안 전에 문서와 출처 버전을 재확인한다. Windows 동작에 인용한 근거는 승인과 가상 포인터/문서 확인 뒤 native 입력 직전에 재확인하며, winapp 자식 프로세스에는 제한된 Windows 환경과 누비 workflow ID만 전달한다. 버전 일치를 사실 검증이나 수정 권한으로 취급하지 않는다. 방법론과 범위는 packages/nubi-desktop/docs/OPENWIKI-EVIDENCE.md를 따른다.

- 누비 Desktop의 수정안은 TypeScript/JSONC/YAML 문법 검사 후 제안하고 반영 전에 재검사한다. 새 오류는 모델에 돌려주며 기존 오류와 미지원 언어를 구분한다. ripgrep 검색과 AST 구조는 수정 관찰 권한이 아니며 문법 성공은 타입 검사나 실행 테스트 성공이 아니다. 범위는 `packages/nubi-desktop/docs/CODING-AGENT-QUALITY.md`를 따른다.

- 누비 앱 간 작업 전달은 `packages/nubi-a2a`의 공식 A2A 1.0 SDK 전송과 수신자별 로컬 연결을 재사용한다. Desktop은 SQLite 작업/근거 조정 서버이며 Chrome/Office는 수신 클라이언트다. 가져온 요청은 기존 채팅에서 명시적으로 전송하고 기존 HITL을 유지한다. 소스/Wiki 버전이 바뀐 결과는 받지 않으며 A2A 완료를 실제 테스트 통과나 Office 저장 성공으로 취급하지 않는다. 미확정 결과는 Task/영수증을 조회하고 실행을 맹목 재전송하지 않는다. 인증은 모델에 전달하지 않는다. 상세 범위는 `packages/nubi-a2a/README.md`와 `packages/nubi-desktop/docs/A2A-COLLABORATION.md`를 따른다.

- 누비 Office의 Python 스킬은 공통 Pi 하네스 안에서 번들 uv와 누비 전용 Python 3.12 가상환경을 사용한다. 설치와 매 코드/입력 실행에 HITL을 적용하고 오류를 모델에 반환해 수정한다. 가상환경은 OS 보안 샌드박스가 아니며 로컬 사용자 권한을 고지한다. 원본 NASCA 파일을 Python으로 열지 않고 JSON 결과만 기존 Office 반영/검토/저장 경로로 전달한다. 고정 wheel 의존성, 해시, 설치 잠금, 시간/프로세스 제한과 취소를 유지하며 미확정 실행은 자동 재전송하지 않는다. 범위와 검증은 `packages/nubi-office/docs/PYTHON-SKILLS.md`를 따른다.

- 누비 Office 작업 위치는 검증된 쓰기 뒤 실제 COM 선택/스크롤로 표시한다. 별도 UIA 프로세스는 바인딩한 전면 Office 창만 관찰하며 메모리 캡처는 2분 후 만료하고 Nubi 창을 제외한다. 이미지 입력이 명시된 모델에만 별도 읽기 전용 검토로 전달하며 Qwen의 이미지 지원을 추정하지 않는다. 캡처 실패로 완료한 쓰기를 재실행하지 않는다. AI 커서는 사용자 포인터와 독립된 no-activate/click-through 가상 표시다. 검은 면과 흰 테두리의 둥근 화살촉을 관찰한 위치 사이로만 이동하며 도착 후 실제 동작을 호출한다. Windows 모션 설정을 따르고 애니메이션을 완료 근거로 쓰지 않는다. 사용자 커서 이동과 합성 마우스/키보드 입력은 MUST NOT 사용한다. 실제 GUI 조작은 지원되는 UIA Invoke/SelectionItem/Scroll 패턴과 기존 HITL을 사용하며 미지원 동작에 물리 입력 fallback을 두지 않는다. 미확정 동작은 영수증을 조회하고 작업을 중지한다. hover는 위치 표시만 하며 물리 호버 메뉴를 발생시키지 않는다. 범용 PC 마우스/키보드 자동화와 전체 문서 시각 검증으로 표시하지 않는다. 근거는 packages/nubi-office/docs/OFFICE-VIEW-HARNESS.md를 따른다.

- 누비 Office A2A는 향후 가능성만 고려한다. 사용자의 새로운 명시 요청 전까지 프로토콜/엔드포인트/발견/외부 에이전트 위임/인증을 구현하지 않는다. 기존 실행 내 읽기 전용 하위 분석과 화면 검토는 A2A 지원이 아니다.

- 누비 Office 사용자 작성 스킬은 채팅 +에서 ZIP/폴더로 등록하고 Windows DPAPI로 보관한다. 기존 규칙형 스킬도 입력 폼 설정을 요구하지 않는다. 질문 목록은 필요한 정보의 기준이며 선행 설문이 아니다. 에이전트는 요청과 문서를 먼저 확인하고 필수 정보가 부족하거나 모호하면 MUST 같은 실행의 객관식/주관식 폼으로 묻는다. Pi SKILL.md 조회를 재사용하고 규칙과 이전 명시적 답변은 요약 밖에 보존한다. 합성 스킬 문맥을 새 사용자 발언으로 만들거나 과거 답변/모델 추정을 현재 사실이나 승인으로 간주하지 않는다. 버전/내용 재확인과 문서 반영/저장 HITL을 유지한다. 범위와 검증은 packages/nubi-office/docs/USER-DOCUMENT-SKILLS.md를 따른다.

- `packages/nubi-vscode`는 누비 Desktop의 동일한 Workbench와 실행기를 사용하는 VS Code 호스트다. 로컬의 신뢰한 작업 공간만 지원하며 SSH/WSL/웹/가상 루트는 거부한다. VSIX에 검증된 Node와 Windows 드라이버를 포함하고 상태는 확장 전용 globalStorage를 사용한다. 파일 반영은 VS Code dirty/version/hash, undo와 저장 후 readback을 유지한다. A2A는 연결하지 않는다. 개발 호스트 검사, 실제 VSIX 설치, Windows 11 앱 조작과 실계정 모델 검증을 구분한다.

- 브라우저 누비는 packages/openwiki의 읽기 전용 DeepAgents 조회 코어를 확장에 번들한다. 내장 위키와 등록한 외부 위키는 각각 독립 문맥/출처로 실행하며 현재 누비 제공자와 모델 연결만 공유한다. 선택 서버는 인증된 wiki_snapshot으로 문서를 전달하고 모델을 실행하지 않는다. 긴 문서의 하위 조회와 부분 실패/미열람 구간을 유지한다. 계층적 합성은 해당 분기의 원래 하위 결론/미해결 항목을 실행 내 MiniSearch로 재검색하고 인용 원문을 읽을 수 있다. 분할 읽기는 같은 스냅샷의 제목/표 머리글만 제한된 별도 인용 근거로 보완하며 이를 본문 전체 열람으로 계산하지 않는다. 외부 CLI 인증/셸이나 추가 필수 로컬 실행기를 도입하지 않는다. 범위와 검증은 extensions/aipro-chat/docs/OPENWIKI-AGENT-DELEGATION.md를 따른다.

- 브라우저 누비의 미확정 쓰기는 시도 전 탭·최상위 문서·대상 프레임과 검증 결과의 문서 ID가 일치할 때만 해소한다. 실행 당시 식별 근거나 영수증이 없으면 같은 URL/값으로 추정하거나 자동 재전송하지 않는다. 캡처의 DOM·이미지는 한 전체 기한 안에서 수집하고 늦은 이미지에 클릭 ID를 부여하지 않는다. 근거와 검증 경계는 `extensions/aipro-chat/docs/CLAUDE-BROWSER-RECHECK-2026-09-25.md`를 따른다.
- 브라우저 누비의 읽기 전용 비교는 서로 다른 실제 출처 둘을 캡처한 경우에만 고정 근거별 quick 워커 둘을 한 번 자동 실행한다. 열린 문서의 본문은 문서 ID와 대조해 제한된 구간만 자동 확보하며 URL 쿼리별 해시로 출처를 구분한다. 단계 검토는 해당 단계 조건, 최종 검토는 전체 요구사항을 평가한다. 워커는 새 페이지를 탐색하거나 쓰지 않으며 사용자 수정·취소 때 중단한다. 단순 탭·URL·실제 링크 이동은 새 화면 관찰로 확인하고, 사이트 데이터 쓰기·토글은 `verify_page` 검증을 유지한다. DOM 가시성·조상 컨텍스트 캐시는 한 스냅샷 안에서만 재사용한다. 적용 근거와 실모델 미검증 경계는 `extensions/aipro-chat/docs/PAGE-READING-MULTIAGENT-BP.md` 및 `RESEARCH-COMPLETION-2026-09-26.md`를 따른다.
- 브라우저 누비의 녹화는 시작→사이트 작업→기록 확인→저장 흐름으로 안내한다. 진행 중 상태와 종료를 누비 화면에 보이고, 미저장 초안은 ID가 일치하는 명시적 교체 전까지 MUST 보존한다. 긴 기록은 축약 표시하되 전체 단계는 열람 가능하게 한다. 범위는 `extensions/aipro-chat/docs/RECORDING-FLOW-2026-09-25.md`를 따른다.

- 누비 Desktop 대용량 문서 조사는 OpenWiki-SDS의 DeepAgents 읽기 전용 코어를 재사용한다. 고정한 Workspace 텍스트를 분할 조사하고 실제 워커/누락 보완/합성 이벤트를 작업 화면과 SQLite에 남긴다. 선택 파일 범위와 의미 검증, 실제 Windows 업무 완료를 구분한다. 조사 결과는 수정 관찰이나 앱 입력 권한이 아니며 `packages/nubi-desktop/docs/DOCUMENT-MULTI-AGENT.md`의 원문 재검증과 인증/취소 경계를 유지한다.

- 누비 브라우저의 `ask_documents`는 일반 첨부를 현재 모델과 공통 OpenWiki 읽기 전용 조사 코어에 위임한다. 첨부 원문 종류/소유권/해시와 Wiki 범위를 구분하고 최종 원문 재확인, 제한된 병렬 조사와 계층 합성을 유지한다. Desktop의 `analyze_documents`와 혼합하지 않는다. 대형 원문 저장과 모델 문맥 예산을 분리하며 실제 진행 이벤트/이미지 수신 상태를 표시한다. 상세 범위는 `extensions/aipro-chat/docs/MULTIAGENT-IMPLEMENTATION-2026-09-25.md`를 따른다.

- Office 읽기 전용 하위 작업은 활성 작성 스킬의 원문/버전/해시를 전달하고 스킬 변경 시 캐시와 진행 중 결과를 재검증한다. 과거 답변과 현재 사실을 구분하며 스킬을 권한으로 취급하지 않는다. 위임 문맥 한도 초과는 규칙을 자르지 않고 부모 도구 진행으로 전환한다. 근거: packages/nubi-office/docs/DELEGATED-SKILL-BENCHMARK-2026-09-25.md.
