# AI Pro 브라우저 작업 재사용과 공유

조사일: 2026-09-20. 공식 문서, 공개 저장소와 현재 프로젝트 코드를 확인한 설계 제안이다. 외부 솔루션 설치나 회사망 AI Pro 연동 시험은 하지 않았다.

## 목표와 추천

사용자가 원하는 흐름은 화면에서 입력란과 선택지를 파악하고, AI Pro가 값을 제안하고, 브라우저 도구가 적용한 뒤 결과를 확인하는 것이다. 이 과정을 이름 있는 작업으로 저장하고 다른 사용자가 자기 로그인과 입력값으로 실행할 수 있어야 한다. SKILL.md는 지침 형식으로 받을 수 있지만 공유 단위는 작업 정의다.

사용자의 추가 설명에 따라 우선순위를 **브라우저 상태와 동작을 도구로 제공하는 확장 전용 에이전트**로 정한다. 현재 탭의 태그, 입력 상태와 사이트 저장소를 읽고 AI Pro가 필요한 다음 도구를 선택하게 한다. LangGraph.js는 단계, 조건 분기와 일시 중단이 복잡해질 때 검토할 실행 라이브러리다. 프레임워크 도입을 브라우저 기능 확장의 선행 조건으로 두지 않는다. 파일 공유/가져오기, 버전 관리, 실행 UI와 브라우저 재시작 후 상태 복원은 제품에서 구현해야 한다.

별도 실행 환경을 허용한다면 **Mastra**가 워크플로우, MCP와 브라우저 연동을 함께 구성하는 대안이다. **OpenCode + Playwright MCP**는 파일/스크립트/개발 작업까지 넓히는 선택지다. 두 방식 모두 서버나 실행 프로세스를 확장 안에 그대로 넣는 구조는 아니다.

## 후보 비교

| 후보 | AI Pro 연결 판단 | 작업 흐름과 MCP | 브라우저 실행과 설치 조건 | 이번 용도 |
|---|---|---|---|---|
| LangGraph.js | 그래프 노드에서 현재 fetch 호출을 재사용 가능 | 분기, 중단/재개, 체크포인트 지원. MCP는 클라이언트/어댑터 연결 | 브라우저용 export 존재. 현재 확장 도구와 결합하며 브라우저 번들 검증 필요 | 복잡한 작업 흐름을 관리할 선택 라이브러리 |
| Mastra | 사용자 모델/AI SDK 연동 지점 확인 필요. 사내 SSO 전달은 제품에서 연결 | 워크플로우, 에이전트, MCPClient, Studio 제공 | Stagehand 등 Browser 통합 제공. Node/서버 실행 환경을 기본 검토 | 서버 허용 시 통합 후보 |
| OpenCode + Playwright MCP | custom OpenAI-compatible provider 지원. 현재 라우터에도 관련 구현 존재 | SKILL.md 탐색, 로컬/원격 MCP, HTTP server API 지원 | OpenCode 실행기와 Playwright MCP 프로세스 필요. 공식 연결 확장으로 기존 Chrome 세션 사용 가능 | 범용 개발/스크립트 작업에 적합 |
| Browser Use | ChatOpenAI의 base_url와 api_key 지원. 구조화 응답과 모델 호환성은 별도 확인 | 브라우저 에이전트와 로컬 MCP server 제공. 공유 작업 라이브러리는 별도 | Python/브라우저 실행 환경 필요 | 브라우저 자율 작업의 비교 후보 |
| Stagehand | v4 문서는 사용자 LLM callback을 제공. custom baseURL 설정과 혼동 금지 | act/observe/extract와 MCP 연동 경로. 범용 워크플로우 엔진과 결합 | 로컬 또는 호스팅 브라우저 실행 환경 필요 | 정해진 브라우저 단계를 구성하는 도구 후보 |
| Nanobrowser | custom OpenAI-compatible provider 지원 | 현재 확인한 배포 소스에서 범용 MCP/공유 워크플로우 완제품 지원을 확정하지 못함 | Chrome 확장. Puppeteer 및 debugger 권한 사용 | 확장 자동화 구조 참고용 |
| BrowserOS | 브라우저/에이전트/MCP가 결합된 별도 제품으로 검토 가능 | MCP 도구와 agent loop 구성 존재 | Chromium 기반 브라우저 및 서버 구성. 기존 확장에 넣는 라이브러리가 아님 | 현재 설치 조건과 거리가 있음 |

위 연결 판단은 API 형식과 확장 지점에 대한 판단이다. 사내 GLM/Qwen 모델로 각 후보가 입력 대상을 정확히 선택하고 완료하는지는 아직 검증하지 않았다. 범용적인 연결 가능성과 실제 작업 성공률을 구분한다.

## 공개 사용 규모와 유지보수

GitHub API 조회 당시 수치다. 별 수는 관심도이며 사용자 만족도나 사내 사이트 성공률 점수가 아니다.

| 저장소 | Stars | 최근 push | API latest release |
|---|---:|---|---|
| anomalyco/opencode | 208,714 | 2026-09-20 | v1.18.31 / 2026-09-14 |
| browser-use/browser-use | 115,406 | 2026-09-18 | 0.13.10 / 2026-09-04 |
| microsoft/playwright-mcp | 37,370 | 2026-09-18 | v0.0.82 / 2026-09-18 |
| mastra-ai/mastra | 28,198 | 2026-09-20 | 이번 조사에서 릴리스 확인 생략 |
| browserbase/stagehand | 24,580 | 2026-09-20 | 3.7.3 / 2026-08-28 |
| nanobrowser/nanobrowser | 13,810 | 2026-08-18 | v0.1.13 / 2025-11-22 |
| browseros-ai/BrowserOS | 13,718 | 2026-09-18 | ext-agent/v0.0.158.0 / 2026-09-18 |
| langchain-ai/langgraphjs | 3,296 | 2026-09-19 | 이번 조사에서 릴리스 확인 생략 |

LangGraph.js 수치는 Python LangGraph 저장소와 별개다. Stagehand 기본 문서는 v4로 이동했지만 API latest release는 3.7.3이므로 구현 때 버전과 문서를 고정해야 한다. Nanobrowser는 최근 push와 마지막 정식 릴리스의 간격이 있어 즉시 제품 전체를 교체하는 후보로 추천하지 않는다.

## 권장 실행 흐름

```mermaid
flowchart LR
  A[작업 선택과 입력값] --> B[화면 구조 읽기]
  B --> C[AI Pro가 필드와 값 결정]
  C --> D[입력 내용 확인]
  D --> E[브라우저에 적용]
  E --> F[결과 다시 읽고 확인]
```

확장 실행 루프가 도구 결과를 AI Pro에 돌려주고 다음 행동을 이어간다. 어떤 필드에 어떤 값을 넣을지는 LLM이 실제 DOM의 라벨, 역할과 선택지를 근거로 결정한다. 화면의 DOM을 보는 것이며 React/Vue 원본 컴포넌트 접근을 전제하지 않는다. 스크린샷 입력은 선택한 모델의 이미지 지원을 확인한 후 추가한다. 실패 분기와 장기 상태 복원이 복잡해질 때 LangGraph.js를 같은 도구 인터페이스에 연결할 수 있다.

## 브라우저 상태와 도구의 구체적 범위

아래는 사용자 설명을 반영한 목표 기능이며 0.4.4에 모두 구현됐다는 뜻은 아니다.

| 정보/행동 | 목표 기능 | 실행 위치 |
|---|---|---|
| 페이지 구조 | 태그, 접근성 역할, 라벨, 선택지, 필수/비활성 상태, 표, 화면 오류를 구조화 | 해당 문서의 content script |
| 폼 상태 | 작업과 관련된 일반 입력값과 선택 상태 확인, 값 제안, 적용 후 재확인 | content script와 모델 도구 호출 |
| 사이트 저장소 | localStorage/sessionStorage 키와 자료형 확인 후 필요한 업무 데이터만 선택 조회 | 대상 사이트 origin의 content script |
| 브라우저 문맥 | 선택한 탭의 URL/제목, 이동과 로딩 상태, 작업 중 새로 열린 탭 파악 | service worker의 Chrome API |
| 페이지 동작 | 입력, 선택, 클릭, 스크롤, 요소 대기, 결과 검증 | 안정적인 요소 참조를 받는 고정 도구 |
| 확장 가능한 정보 | IndexedDB, 네트워크 상태, 다운로드 등은 실제 필요 작업에 맞춘 별도 도구 | 기능별 권한과 어댑터 검토 |

chrome.storage는 확장 설정/작업 저장소이며 사이트 localStorage와 다르다. 사이트 저장소에 접근하려면 대상 문서의 실행 환경을 사용한다. 서비스 워커에서 localStorage를 직접 읽을 수 있다고 가정하지 않는다. IndexedDB의 데이터베이스/스키마는 사이트별로 달라 별도 조회 어댑터가 필요하다. 페이지 전역 JS 변수도 ISOLATED world에서 그대로 보이지 않는다. 필요성이 확인된 사이트에 한해서 범위가 정해진 MAIN world bridge를 검토한다.

처음 요청과 각 행동 뒤에 현재 문서를 확인하고 필요한 상태를 수집한다. 사이트 이동 후에는 요소 참조를 다시 발급한다. 저장소와 모든 탭을 상시 전송하는 방식으로 구현하지 않는다. 저장소의 업무 설정/필터/초안과 인증정보를 구분하고 JWT, 세션 키와 비밀번호를 LLM 문맥이나 공유 파일에 넣지 않는다. 현재 도구의 입력값 전체 제외 정책을 바꾸는 경우 해당 도구의 데이터 범위를 명시적으로 갱신한다.

예를 들어 사이트에 저장된 departmentCode와 화면의 부서 선택지를 읽어 일치하는 항목을 선택하고, 사용자의 요청에서 신청 사유를 작성한 뒤 입력 결과를 다시 확인하는 작업을 제공할 수 있다. 업무 데이터를 읽었다는 사실과 사이트의 저장/제출이 완료됐다는 사실은 각각의 결과로 확인한다.

공유 작업에는 목표, 조회할 업무 데이터의 이름, 실행할 도구와 완료 조건을 담는다. 실행할 때 각 사용자의 현재 페이지와 저장소에서 다시 해석한다. DOM 도구를 나중에 MCP 형식으로 노출할 수 있지만 현재 탭 조작을 위해 MCP 서버부터 설치하도록 만들 필요는 없다. Nanobrowser의 확장 구조는 참고 대상으로 두고 기존 AI Pro SSO와 CX UI를 유지한다.

예: 사용자가 `교육 신청서 작성`을 저장한다. 동료는 작업 파일을 가져와 신청 목적과 날짜를 입력하고 실행한다. 확장이 현재 사이트의 이름/부서/교육일 입력란을 읽고 AI Pro가 값을 매칭한다. 사용자가 확인하면 입력하고 적용 결과를 다시 읽는다. 서버 제출이나 저장은 별도 단계와 실제 결과 확인을 가진다.

## 공유 단위

공유 파일에는 이름, 설명, 버전, 지원 사이트, 입력 변수 스키마, 노드 종류와 연결, 각 단계의 지침, 필요한 도구 이름, 성공 조건을 담는다. 기존 SKILL.md는 지침 노드로 가져온다. 반복 작업은 실행 가능한 작업 템플릿으로 저장한다.

JWT, 쿠키, 사용자별 입력값과 과거 페이지 원문은 공유 정의에 넣지 않는다. 가져온 사용자 자신의 로그인과 권한으로 실행한다. 페이지에서 임시 발급한 field_id/documentId도 저장해 재사용하지 않고 실행 시 다시 찾는다. 파일 내보내기/가져오기를 먼저 제공하고 팀 라이브러리는 같은 정의의 배포 채널로 확장할 수 있다.

## MCP와 Playwright의 범위

HTTP MCP는 확장 내 클라이언트로 연결하는 경로를 검토할 수 있다. 현재 manifest의 connect-src는 AI Pro만 허용하므로 MCP 주소 설정과 네트워크 권한 처리가 추가로 필요하다. Node 의존성이 포함된 MCP 어댑터를 통째로 브라우저 번들에 넣지 말고 HTTP transport의 브라우저 호환성을 확인해야 한다.

stdio MCP는 자식 프로세스를 실행하므로 확장만으로 시작할 수 없다. 공식 Playwright MCP의 기존 Chrome 연결도 Node MCP 프로세스와 공식 연결 확장이 필요하다. 원격 브라우저를 사용한다면 사용자가 현재 열어 둔 사내 탭의 로그인 세션과 동일하지 않다. 기본 페이지 읽기/입력은 기존 확장 도구로 유지하고 Playwright는 실행 환경이 마련된 선택 기능으로 둔다.

## 현재 코드와 구현 간격

- extensions/aipro-chat/src/api.js:101은 AI Pro Bearer 호출과 tools/tool_calls/tool 결과 반복을 이미 처리한다. 신규 LLM 인증 체계를 다시 만들 필요는 없다.
- extensions/aipro-chat/skills.js:8은 지침과 입력 허용 여부를 저장한다. 작업 그래프, 공유 파일과 실행 상태 복원은 아직 없다.
- 현재 브라우저 도구는 read_page, inspect_dom, fill_form이다. 복합 선택창, iframe/shadow DOM, 파일 업로드, 제출/저장 검증까지 구현돼 있다고 표시하지 않는다.
- src/llm_router/opencode_runtime.py에는 OpenAI-compatible AI Pro provider 구성이 있고 opencode_tool_bridge.py에는 호출자 도구용 MCP bridge가 있다. 이는 Chrome 확장의 범용 MCP 연결이나 Playwright 실행 완료를 뜻하지 않는다. 라우터의 auth별 헤더를 복사하지 않고 사용자 확인 계약인 Bearer JWT를 확장 경로에서 유지한다.

첫 통합 검증은 한 웹 폼에서 화면 읽기 → 값 매칭 → 확인 → 입력 → 결과 검증을 수행하고, 내보낸 작업을 다른 확장 프로필에서 가져와 다시 실행하는 것이다. LangGraph browser bundle, 화면 이동 후 요소 재탐색, 중단/재개 시 입력 중복 방지, 실제 AI Pro 도구 응답을 이 범위에서 함께 확인한다.

## 근거

- [LangGraph.js](https://github.com/langchain-ai/langgraphjs), [browser export](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/package.json), [작업 단계와 중단/재개](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [LangChain MCP transport](https://docs.langchain.com/oss/javascript/langchain/mcp)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview), [MCP](https://mastra.ai/docs/connections/mcp), [Browser](https://mastra.ai/docs/browser), [Stagehand 통합](https://mastra.ai/integrations/browsers/stagehand), [Models](https://mastra.ai/models)
- [OpenCode provider](https://opencode.ai/docs/providers/), [Skills](https://opencode.ai/docs/skills/), [MCP](https://opencode.ai/docs/mcp-servers/), [HTTP server](https://opencode.ai/docs/server/)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp), [공식 브라우저 연결 확장](https://github.com/microsoft/playwright/tree/main/packages/extension)
- [Browser Use](https://github.com/browser-use/browser-use), [OpenAI wrapper](https://github.com/browser-use/browser-use/blob/main/browser_use/llm/openai/chat.py), [로컬 MCP server](https://docs.browser-use.com/open-source/customize/integrations/mcp-server)
- [Stagehand](https://github.com/browserbase/stagehand), [v4 모델 연동](https://docs.stagehand.dev/v4/configuration/models)
- [Nanobrowser](https://github.com/nanobrowser/nanobrowser), [manifest](https://github.com/nanobrowser/nanobrowser/blob/master/chrome-extension/manifest.js)
- [BrowserOS](https://github.com/browseros-ai/BrowserOS)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [사이트 저장소와 확장 저장소](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
