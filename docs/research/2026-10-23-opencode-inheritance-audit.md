# OpenCode 반영 범위와 코드 품질 감사

2026-10-23 후속: 이 문서는 수정 전 후보의 감사 기록입니다. 이후 사용자 결정에 따라 Workspace 프로젝트 코딩 경로에 공식 OpenCode 1.19.4 원본 실행기를 연결했습니다. 현재 도입 코드와 실제 모델/앱 검증은 [원본 코딩 실행기 도입 결과](2026-10-23-opencode-coding-adoption.md)를 따릅니다. 아래의 과거 결함과 당시 검증 범위는 이력으로 보존합니다.

> 감사 이후 직접 수정과 현재 검증은 [후속 기록](2026-10-23-workspace-quality-browser-motion-repair.md)에 분리했다. 아래의 원래 결함과 실패 결과는 감사 당시 기록이다.

2026-10-23. 대상: `/Users/ganadi/Documents/llm_router`의 현재 작업 파일. 제품 구현은 수정하지 않았다.

## 판단

**OpenCode를 반영한 것은 맞지만, OpenCode의 에이전트 품질을 온전히 그대로 받았다는 주장은 성립하지 않는다.**

- Python 라우터는 공식 OpenCode 1.18.18 바이너리를 실제로 사용한다. 현재 Mac에 설치된 arm64 바이너리는 공식 릴리스에서 새로 다운로드해 추출한 파일과 SHA-256이 같다. 인증과 제공자 추론은 실제 재사용이다.
- Electron Workspace의 주 에이전트는 **Pi 0.86.1 + 누비 자체 실행/승인/검토/문맥 관리**다. OpenCode 실행기, 편집기, LSP, 압축 구현을 통째로 이식한 구조가 아니다. 일부 설계 원칙을 참고했다.
- Python의 요청 변환과 도구 연결에는 재현 가능한 계약 및 수명 관리 결함이 있다. 원본 엔진이 같아도 최종 동작은 같지 않다.
- 현재 검사만으로 OpenCode와의 실제 모델 정확도, 복구율, 장기 작업 품질, 지연이 동등하다고 판단할 수 없다. 임의의 종합 점수나 도입률 퍼센트를 부여하지 않는다.

## 감사 범위와 원본 기준

- 저장소 HEAD: `7dbaf0f6` (`7dbaf0f6…` 전체 값은 감사 manifest에 기록).
- Git에 등록되지 않은 Workspace 소스도 현재 제품 소스로 읽었다. HEAD 하나가 전체 감사 대상의 바이트를 대표하지 않는다. 주요 파일별 SHA-256과 추적 여부를 [audit-summary.json](../../verification/opencode-code-audit-2026-10-23/audit-summary.json)에 보존했다.
- OpenCode 기준: [`v1.18.18`](https://github.com/anomalyco/opencode/releases/tag/v1.18.18), commit `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`.
- 원본의 `session/prompt.ts`, `processor.ts`, `compaction.ts`, `llm.ts`, `mcp/index.ts`, `tool/edit.ts`, `tool/read.ts`, MIT LICENSE를 읽었다. 파일 해시와 조회 실패 경로도 [upstream-source.json](../../verification/opencode-code-audit-2026-10-23/upstream-source.json)에 남겼다. 조회하지 못한 파일을 확인 근거로 삼지 않았다.
- 공식 release API의 archive digest: `7d668bf26496fec8686d4e51ebb1ac2bd2e393f0c1620aa696c4c242a9e5806a`. 현재 `opencode_build.py`의 macOS arm64 값과 일치한다.
- 공식 archive를 새로 내려받아 digest를 확인하고 내부 실행 파일을 설치본과 비교했다. 양쪽 실행 파일 SHA-256: `4f5979c2dadb06fbff1335335afaaea274e58f92e79aa43cf2ed98618d555422`. [직접 비교 결과](../../verification/opencode-code-audit-2026-10-23/binary-identity.json).
- 위 바이너리 검증은 현재 Mac의 설치본에 한정한다. 다른 플랫폼 wheel, 다른 Desktop 저장소, Windows 설치판의 동일성은 검사하지 않았다.

## 무엇을 실제로 받았는가

| 영역 | 현재 소스에서 확인한 방식 | 평가 |
| --- | --- | --- |
| Python OAuth/제공자 추론 | `opencode_build.py:16`, `opencode_runtime.py:197`, `adapters/__init__.py:46` | 공식 엔진을 실제 호출한다. 단순 이름 변경이나 헤더 위장은 아니다. |
| Python 도구 호출 | `opencode_tool_bridge.py`의 자체 MCP 서버, 디스크 교환, 메모리 호출 레지스트리 | OpenCode가 도구를 선택하지만 클라이언트 왕복 계약과 수명은 누비 코드의 책임이다. |
| Python 대화 | `adapters/opencode.py:351-376` | 과거 역할을 문자열로 합쳐 system에 넣고 마지막 메시지만 새 입력으로 전달한다. 원래 대화 구조를 보존하지 않는다. |
| Python 스트리밍 | `adapters/opencode.py:594`에서 complete를 먼저 기다림 | 완료 후 SSE 포장이다. 원본의 실시간 delta 전달 경험을 그대로 받지 않는다. README에 명시된 의도된 차이다. |
| Python 기본 에이전트 도구 | `permission: deny`, 요청별 내장 도구 비활성화 | 파일 편집, 셸, 탐색 등 원본의 기본 코딩 흐름 전체를 사용하지 않는다. 라우터 범위에 맞춘 의도된 제한이다. |
| Workspace 주 실행 | `runtime/agent.mjs:69`, `extensions/aipro-chat/agent-runtime.js:8,41,584` | Pi의 Agent를 직접 사용한다. OpenCode 주 실행기가 아니다. |
| Workspace 제공자 | `desktop-providers.mjs` → `nubi-office/worker/providers.mjs`와 Claude CLI 어댑터 | 현재 기본 연결에 Python 라우터/OpenCode를 필수 경로로 두지 않는다. 사용자가 별도 호환 endpoint를 연결한 경우는 별개다. |
| Workspace 코드 진단 | `code-quality.mjs:23`, `code-analysis-core.mjs:51`, `code-intelligence.mjs:27` | 제안의 문법 검사와 선택적 JS/TS snapshot 의미 진단이 있다. 표준 라이브러리, 설치 의존성, tsconfig, 미저장 버퍼를 포함한 프로젝트 LSP와는 다르다. |
| Workspace 압축/복구/검토 | 공용 누비 context-manager, Pi, 호스트 영수증과 독립 검토 | 자체 구현과 기존 라이브러리의 조합이다. OpenCode 원본의 동작이나 성능이 자동 승계되지 않는다. |

기존 [코딩 품질 문서](../../packages/nubi-desktop/docs/CODING-AGENT-QUALITY.md)와 [하네스 문서](../../packages/nubi-desktop/docs/HARNESS-METHODS-2026-10-12.md)도 소스 복사/전체 런타임 이식이 아니라 방법론 적용이라고 명시한다. 따라서 “OpenCode 반영”은 가능하지만 “OpenCode 전체 에이전트와 같은 품질”로 설명하면 범위를 과장한다.

## 발견 사항

P1은 실제 호출 제약, 대화 경계, 다른 작업의 보존 또는 내부 접근 경계에 영향을 주어 우선 보완할 항목이다. P2는 반복 사용 시 정리와 비용에 영향을 주는 항목이다. 이는 공개 벤치마크 점수가 아니다.

### F1. P1 — 도구 재개가 새 요청의 제약을 건너뛴다

위치: [`adapters/opencode.py:448`](../../src/llm_router/adapters/opencode.py#L448), [`:528`](../../src/llm_router/adapters/opencode.py#L528).

마지막 메시지가 `tool`이면 `to_opencode_prompt()`와 `_selected_tools()`를 거치지 않고 기존 세션을 계속한다. 최초 요청 경로에 있는 병렬 호출 수 검사와 필수 호출 검사도 재개 경로에는 없다. 새 system 지침, 도구 목록, `tool_choice`, `parallel_tool_calls`, 출력 형식 등을 현재 요청에 맞춰 반영하거나 변경을 거부하는 계약도 없다.

**실제 바이너리 재현:** 첫 lookup 결과를 반환하는 요청에 `tool_choice=none`, `parallel_tool_calls=false`를 주었다. 로컬 가상 모델이 다음 도구 2개를 제안하자 어댑터가 두 개 모두 정상 `tool_calls` 응답으로 반환했다. 제공자에게 전달된 값도 `tool_choice: auto`였다. 단순 mock 어댑터뿐 아니라 공식 바이너리를 통한 같은 현상이다.

이는 도구 호출 반환의 제약 위반이다. 외부 쓰기 2건이 실제 실행됐다는 주장은 하지 않는다. 실제 도구 실행은 여전히 호출자 책임이다.

보완 조건: 결과를 기존 실행에 전달하기 전에 현재 요청과 보관된 세션 계약을 대조해야 한다. 지원할 수 없는 변경은 명시적으로 거부하고, 지원하는 변경은 다음 모델 호출 전에 실제로 반영해야 한다. 매 단계에 동일한 도구/출력 계약 검사가 필요하다.

### F2. P1 — 과거 사용자/도구 내용을 system 채널로 합친다

위치: [`adapters/opencode.py:199`](../../src/llm_router/adapters/opencode.py#L199), [`:351`](../../src/llm_router/adapters/opencode.py#L351).

역할이 있는 과거 메시지를 `User: …`, `Assistant: …`, `Tool (id): …`로 합쳐 `body.system`에 넣는다. 역할 이름을 텍스트로 쓰는 것은 프로토콜의 역할 경계 보존과 다르다. 과거 사용자 입력에 줄바꿈과 가짜 역할 표식을 넣어도 별도 경계 인코딩이 없다.

**재현:** 과거 사용자 입력 `AUDIT_PRIOR_USER`가 실제 가상 제공자의 system 메시지에 도착했고, 본문 역할 목록은 `system,user` 두 개로 축소됐다. 별도 감사 검사도 같은 구조를 확인했다.

확정한 사실은 메시지 경계와 신뢰 채널의 변환이다. 특정 실모델에서 공격 성공이나 정답률 저하를 측정하지는 않았다. 긴 대화, 도구 결과와 정정의 의미가 원본과 동등하다고 보장할 수 없다.

보완 조건: 역할과 tool call/result 관계를 보존하는 변환이 우선이다. API상 원형 전달이 불가능하면 원본 내용이 system 지침으로 취급되지 않도록 데이터 경계를 유지하고, 지원 범위와 동일성 한계를 명시해야 한다.

### F3. P1 — 새 AI Pro 프로필이 다른 대기 작업을 지운다

위치: [`opencode_runtime.py:321`](../../src/llm_router/opencode_runtime.py#L321), [`:434`](../../src/llm_router/opencode_runtime.py#L434).

새 프로필 또는 변경된 signature를 발견하면 공유 런타임에 `close()`를 호출한다. 이 함수는 프로세스 종료뿐 아니라 모든 tool bridge context와 파일을 정리한다. 활성 요청 수나 다른 프로필에서 대기 중인 도구를 확인하는 보호가 없다.

**격리 재현:** 한 프로필의 pending tool context를 만든 뒤 다른 AI Pro 프로필을 준비했다. 기존 context가 사라졌다. 프로세스 시작만 대체하고 실제 `ensure_profile()`과 `close()`를 실행한 검사다. 실제 동시 사용자/계정 호출은 하지 않았다.

보완 조건: 실행을 설정 세대에 묶고 활성 작업을 배출하거나, 프로필별 런타임을 격리하거나, 작업 시작 전에 설정을 확정해야 한다. 무관한 실행을 즉시 종료하는 방식은 피해야 한다.

### F4. P1 — 내부 OpenCode 서버에 별도 인증이 없다

위치: [`opencode_runtime.py:539`](../../src/llm_router/opencode_runtime.py#L539), [`:553`](../../src/llm_router/opencode_runtime.py#L553).

부모의 `OPENCODE_SERVER_PASSWORD/USERNAME`을 제거한 뒤 라우터 전용 인증값을 새로 설정하지 않는다. 라우터 Master Key는 라우터 API를 보호하지만 별도 localhost OpenCode 서버까지 보호하지 않는다. 공식 서버는 [HTTP basic auth 설정](https://opencode.ai/docs/server/#authentication)을 제공한다.

**실제 바이너리 재현:** 라우터 키나 Basic Auth 없이 내부 `/session`에 POST했고 200으로 세션이 생성됐다. `/global/health`만 공개된 상황이 아니다.

이는 같은 컴퓨터의 다른 프로세스가 내부 서버에 직접 접근할 수 있는 경계 공백이다. 원격 네트워크 접근, 실제 계정 탈취, 회사 정책 우회나 셸 실행 공격을 수행하거나 입증한 것은 아니다.

보완 조건: 런타임마다 독립된 무작위 자격증명을 만들고 모든 내부 클라이언트에 일관되게 연결해야 한다. 부모의 임의 인증값을 차단하는 격리와 내부 서버 무인증은 별개 문제다.

### F5. P2 — 만료 세션과 MCP 등록이 자동으로 회수되지 않는다

위치: [`opencode_tool_bridge.py:105`](../../src/llm_router/opencode_tool_bridge.py#L105), [`:121`](../../src/llm_router/opencode_tool_bridge.py#L121), [`adapters/opencode.py:537`](../../src/llm_router/adapters/opencode.py#L537), [`:662`](../../src/llm_router/adapters/opencode.py#L662).

두 가지를 구분한다.

1. 클라이언트가 결과를 보내지 않고 떠난 context는 시간 경과만으로 제거되지 않는다. 만료 검사는 그 클라이언트가 다시 재개할 때 실행된다. `close()` 외에 만료 context, 호출 매핑과 디렉터리를 회수하는 경로가 없다. 감사 검사에서 과거 시각으로 만든 만료 context가 새 요청 이후에도 남았다. MCP 자식의 도구 대기 timeout이 부모 registry 정리를 뜻하지 않는다.
2. 정상 완료 후에도 `_cleanup_context()`는 MCP disconnect만 한다. 공식 1.18.18의 `MCP.disconnect`는 client를 닫고 status를 disabled로 바꾸며 동적으로 추가한 config를 삭제하지 않는다. 요청마다 이름이 고유하므로 등록이 누적된다. **실제 바이너리에서 정상 정리 1회 후 MCP 항목 1개, 두 번 정리 후 2개가 남았다.**

현재 확인한 것은 context/파일/등록의 잔존과 선형 누적 경로다. 메모리 부족, 프로세스 고갈이나 성능 저하가 발생하는 규모까지 부하 측정하지 않았다.

보완 조건: 만료 context에 대한 정기 회수와 런타임 시작 시 잔존 파일 정리, 총 대기 개수 제한이 필요하다. MCP는 bounded registry 또는 재사용 가능한 bridge 구조가 적합하다. 무관한 활성 작업을 지우는 전역 재시작으로 해결하면 F3를 재발시킨다.

## 의도된 차이와 현재 구현의 강점

의도된 범위를 결함 수에 합산하지 않았다.

- 응답 전체 완료 후 SSE를 내보내는 방식은 README에도 명시돼 있다. 유효한 SSE라는 사실과 실시간 응답성은 다르다. 이번 감사에서는 첫 토큰 지연을 실모델로 비교하지 않았다.
- 파일/셸/웹 기본 도구 차단과 프로젝트 설정 격리는 라우터 목표에 맞는 제한이다. 이 제한 때문에 원본 코딩 에이전트의 전체 품질이 그대로 제공되는 것은 아니다.
- 지원하지 않는 요청별 생성 옵션을 조용히 무시하지 않고 오류로 반환하는 최초 요청 경로는 좋다. 다만 F1의 재개 경로에도 같은 원칙이 필요하다.
- 공식 archive 해시 검증, MIT 고지, 번들 바이너리 우선 선택, 격리된 XDG 경로, 취소 시 abort/delete, 원본 오류 유형 변환은 실제 구현돼 있다.
- Workspace는 현재 파일 해시, 읽은 범위, 승인, 실제 실행 영수증, 반영 후 결과를 분리한다. 문법 오류를 모델에 돌려준 뒤 제안을 고치는 검사도 실제 파서를 실행한다.
- 과거 문서의 “문법 검사만 있다”는 설명을 현재 전체 기능으로 확대하지 않았다. 지금 `inspect_code`는 제한된 JS/TS 소스 snapshot에서 의미 진단과 정의/참조 조회까지 수행한다. 이번 재실행에서도 타입 오류와 다른 파일의 정의 조회 검사가 통과했다. 다만 프로젝트 설정/의존성 전체를 사용하는 OpenCode의 LSP 통합과 동일하다고 볼 수 없다. [원본 edit/LSP 연결](https://github.com/anomalyco/opencode/blob/31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d/packages/opencode/src/tool/edit.ts).

유지보수 측면에서는 `agent-runtime.js` 1,604줄 안의 `runAgent`가 계획, 검토, 복구, 도구 경계와 문맥을 큰 closure로 관리하고, Desktop `agent.mjs` 1,067줄이 여러 호스트의 파일을 직접 조합한다. 이미 분리된 승인/복구/코드 검사 모듈은 강점이다. 앞으로는 기능 개수보다 요청 계약과 실행 수명을 분리해 변경 영향과 회귀 조건을 추적하기 쉽게 만드는 것이 중요하다. 줄 수 자체를 결함이나 성능 점수로 취급하지 않는다.

## 이번에 실제 실행한 검증

| 검증 | 결과 | 의미 |
| --- | --- | --- |
| Python 기존 전체 suite | 227 통과, 0 실패 | 현재 소스를 `PYTHONPATH=src`로 지정했다. 그중 OpenCode 4개 파일의 집중 검사도 52개 통과했다. 52개는 227개에 포함된다. |
| Workspace 관련 8개 파일 | 45 통과, 0 실패 | 코드 제안, 실제 파서/ripgrep, Pi 합성 모델, 압축, 요구/근거 보존과 복구 검사. |
| Workspace 개발 흐름 3개 파일 | 38 통과, 0 실패 | 실제 로컬 PTY, 프로세스 준비, 제한된 의미 진단, 반영 후 검증 근거 검사. 위 45개와 별개다. |
| 신규 감사 contract probe | 4개 모두 기대 계약 위반 재현 | 대화 역할, 재개 제약, 버려진 만료 context, 프로필 간 보존. 기존 suite의 4개 회귀 실패라는 뜻이 아니다. |
| 공식 바이너리 + 현재 Python 소스 + 가상 제공자 | 일반 응답, 도구 선택, 결과 반환 후 최종 답변 성공 | 실제 OpenCode 프로세스 및 MCP 자식 프로세스를 실행했다. 실제 AI Pro/ChatGPT 모델 품질 시험은 아니다. |
| 동일 바이너리의 경계 검사 | 역할 축소, `none`인데 호출 2개 반환, 무인증 세션 생성, MCP 잔존 1→2 확인 | [binary-smoke.json](../../verification/opencode-code-audit-2026-10-23/binary-smoke.json). |
| 공식 릴리스 직접 다운로드 비교 | archive digest와 설치 바이너리 SHA 일치 | macOS arm64 한정. |

처음 기본 Python 실행은 기존 설치 패키지를 읽어 새 모듈 수집에 실패했다. 현재 소스 경로를 지정한 뒤 위 suite가 통과했다. 첫 바이너리 검사에서도 상대 `PYTHONPATH=src`가 자식의 임시 cwd에서 해석돼 MCP import가 실패했다. 절대 소스 경로로 고친 뒤 전체 왕복을 확인했다. 최초 기록은 `binary-smoke-relative-pythonpath.json`에 보존했으며 제품 MCP 결함으로 집계하지 않았다.

재현 명령:

```sh
PYTHONPATH=src python3 -m pytest -q
PYTHONPATH=src python3 -m pytest verification/opencode-code-audit-2026-10-23/audit_probes.py -q
PYTHONPATH="$PWD/src" python3 verification/opencode-code-audit-2026-10-23/binary_smoke.py
cd packages/nubi-desktop
node --test --test-concurrency=1 tests/agent-capabilities.test.mjs tests/coding-quality.test.mjs tests/tool-budget.test.mjs tests/compaction-observations.test.mjs tests/compaction-reads.test.mjs tests/compaction-wiki-evidence.test.mjs tests/compaction-turn.test.mjs tests/tool-recovery-loop.test.mjs
node --test --test-concurrency=1 tests/development-execution.test.mjs tests/development-workflow.test.mjs tests/development-gate.test.mjs
```

`audit_probes.py`는 감사 당시 후보에서 실패하는 계약 재현용이며 제품 suite에 자동 포함되지 않는다. `binary_smoke.py`는 설치된 llm-router wheel 안의 Mac OpenCode를 찾아 현재 소스와 연결한다. 설치 위치가 다른 환경에서는 해당 전제가 필요하다.

## 코드 수준 최종 평가와 우선순위

| 평가 축 | 판단 |
| --- | --- |
| 외부 엔진의 진짜 재사용 | Python에서는 확인. Workspace 전체 실행기의 계승으로 확대할 수 없다. |
| 기존 코드와 검증 기반 | 유효하다. 승인/관찰/결과 분리, 실제 파서와 로컬 실행 검사 등은 실질적인 강점이다. |
| 요청 의미와 기능 동등성 | 보강 필요. 역할 변환과 재개 제약 위반이 원본 엔진 앞뒤의 의미를 바꾼다. |
| 작업 수명과 격리 | 보강 필요. 프로필 변경의 전역 종료, 만료 회수, 등록 누적과 내부 인증이 남는다. |
| 실제 에이전트 성능 | 이번 감사로 동등성 판정 불가. 동일 모델과 과제의 직접 비교를 수행하지 않았다. |

먼저 F1/F2의 호출 계약과 F3/F4의 실행/접근 경계를 보완하고 F5의 누적을 막는 순서가 적절하다. 그 뒤 기능 동등성이 필요한 범위를 정해 같은 모델, 저장소, 요청, 권한과 문맥 조건으로 원본 OpenCode와 누비를 비교해야 한다. 완수율, 오완료, 비대상 변경, 미확정 작업의 중복 실행, 복구 성공, 호출/토큰, p50/p95 시간을 따로 측정한다.

Windows 설치/재실행, 사내 SSO, 실제 Office/NASCA, 실제 제공자 인증 갱신, 전체 UI, 공개 코딩 벤치마크와 장기 실모델 품질은 이번 감사 범위에 포함하지 않았다. 이 보고서는 현재 소스와 로컬 재현의 코드 품질 평가다.
