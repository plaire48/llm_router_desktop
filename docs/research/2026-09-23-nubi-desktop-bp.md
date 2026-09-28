# 누비 Windows 개발 워크스페이스: BP와 오픈소스 검토

검토일: 2026-09-23. 상태: **설계 제안과 조작 가능한 화면 시안**. Windows 실행 파일, 실제 코드 변경 Agent, 모델 연결을 구현하거나 배포한 상태가 아니다.

**현재 권고:** 후속 요구인 소스 관리·IDE 연계를 반영해 [오픈소스 IDE 기반 검토](2026-09-23-nubi-ide-foundation.md)를 우선한다. Theia 기반을 먼저 검증하고, 아래 독자 Electron 구성과 개별 IDE 부품 목록은 대안으로 유지한다. Theia에서는 내장 편집기/도킹/터미널을 중복 도입하지 않는다.

## 1. 제품 방향

사용자가 선택한 첫 버전 범위는 **요구사항 분석 → 소스 이해 → 수정 → 로컬 실행 → 변경 전후 비교**다. 누비의 대화와 브라우저 하네스를 출발점으로 삼고, OpenWiki의 코드 근거를 같은 작업에 연결한다. 가칭은 **누비 Desktop**이며 제품명 확정은 아니다.

주요 사용 장면:

> “이 화면의 검색 결과가 없을 때 안내와 초기화 버튼을 넣어줘. 기존 필터는 유지하고 변경 전후를 보여줘.”

결과물은 답변 한 개가 아니라 요구사항별 근거, 변경 파일, 실행한 화면, 통과/실패/미확인 항목이다. 화면에서 고른 요소를 관련 코드로 연결하되 위치 정보나 관찰 근거가 없으면 후보로 표시한다.

첫 구현의 기준은 Windows 11 x64 네이티브와 React/TypeScript 웹 저장소를 제안한다. Windows 10, ARM64, WSL, Java/Spring 등은 지원을 선언하기 전에 별도 검증한다. 앱 자체의 실행 환경은 번들하고, 대상 프로젝트의 JDK/Python/DB 같은 외부 개발 환경은 자동으로 모두 제공된다고 약속하지 않는다.

## 2. 기존 자산: 실제 소스에서 확인한 재사용 범위

| 자산 | 현재 확인한 구현 | 데스크톱 적용 |
|---|---|---|
| `extensions/aipro-chat/agent-runtime.js`, `agent-harness.js` | Pi 0.86.1, 도구 전후 hook, 첫 실제 결과 뒤 다음 모델 판단, 단계·최종 검토 | 실행 코어를 공유 패키지로 추출. 브라우저와 파일/프로세스 도구의 권한 집합을 분리 |
| `analysis-agents.js` | page/research/review/recovery, 최대 2개 독립 분석, 할당된 근거만 읽기, 읽은 범위와 발췌 반환 | 역할 이름보다 권한·입력·완료 조건을 재사용. 소스 조사와 요구사항 검토를 추가 |
| `context-manager.js`, `context-evidence.js` | 모델 용량 기반 예산, 요약, 호출/결과 쌍 보존, 오래된 읽기의 근거 ID 치환 | 목표·제약·실행 영수증을 보존하고 파일 해시·Git 기준점을 더함 |
| `goal-review.js`, `task-plan.js`, `agent-trace.js` | 실제 도구 이벤트로 진행 표시, 요구사항 검토 | 테스트/브라우저/파일 readback 결과를 완료 조건과 연결 |
| `project-tools.js` | `wiki_query`, `wiki_search`, `wiki_read`, `source_search`, `read_source` | 읽기 전용 ProjectKnowledgePort. 파일 변경 도구와 합치지 않음 |
| `packages/openwiki/src/visualize/nubi.ts` | `/api/nubi/v1/`, pairing, 프로젝트 읽기 범위, 파일 해시·줄 범위, 제외 경로 | 기존 API를 첫 통합점으로 재사용. 생성/갱신 작업은 별도 명시적 실행 |
| OpenWiki 0.6.0 로컬 패키지 | 원본 0.5.2 고정 소스 + 사내 제공자, Claims와 visualizer | Wiki 문서/출처를 지식 계층으로 사용. Wiki 그래프를 실제 호출 그래프로 오인하지 않음 |
| NubiSurfaces / DeckSurfaces / Welcome / MessageBody / ChatControls | React 19와 CX, 누비 로고·청록 캐릭터·로컬 Noto Sans KR | 공유 UI의 호스트 의존성을 port로 분리. 데스크톱 전용 복사본을 장기 유지하지 않음 |

**이식이 필요한 부분:** Chrome의 DNR 로그인, `chrome.storage`, 탭/창 소유권, debugger/Playwright CRX 호스트는 Electron에서 그대로 동작하지 않는다. 제공자 wire 계약은 재사용하지만 인증·저장·브라우저 실행은 Desktop adapter를 새로 둔다. 기존 확장이나 Office의 인증 저장소를 가져오지 않는다.

현재 분석 근거 저장소는 실행 중 메모리이며, 최대 48개를 보관하고 활성 분석의 근거를 보호한다. 이를 그대로 데스크톱 재시작 복구라고 부르면 안 된다. 새 EventStore와 복구 규약이 필요하다.

## 3. 제품 BP와 적용 판단

| 사례 | 공식 자료와 실제 확인 | 적용할 점 / 가져오지 않을 점 |
|---|---|---|
| [Codex app](https://openai.com/index/introducing-the-codex-app/) | 프로젝트별 작업, diff 검토, worktree 격리 | 왼쪽 작업 목록, 작업별 변경·증거, 격리된 작업 공간. 전체 IDE 기능은 첫 범위에서 제외 |
| [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | 로컬 preview 서버 설정, Browser pane, 실행 로그, worktree | 대화 안에서 서버 시작·검증·수정이 연결되는 흐름. 서버 명령/cwd/port를 재현 가능한 설정으로 저장 |
| [OpenCode](https://github.com/anomalyco/opencode) | MIT. 현재 desktop package는 Electron과 Solid, main/server/IPC 분리 | 데스크톱 main·worker·UI 분리와 서버 lifecycle 참고. React 기반 누비를 Solid 앱으로 전체 이식하지 않음 |
| [Dyad](https://github.com/dyad-sh/dyad) | Windows/macOS 로컬 앱. React·Electron·Monaco·xterm 의존성, 실제 FileDiffEditor 확인 | 대화와 결과 화면을 나란히 두고 코드/미리보기 전환. `src/pro`는 별도 FSL 조건이라 복사 대상에서 제외 |
| [Eclipse Theia](https://theia-ide.org/docs/) | 데스크톱/웹 IDE 플랫폼, EPL-2.0 | 향후 IDE·확장 호환성이 핵심이 되면 재평가. 현재는 누비 실행기와 서비스 수명 관리에 더 큰 통합 비용 |
| [Void](https://github.com/voideditor/void) | 2026-06-02 archive, README에 deprecated 명시 | diff/편집 동기화 참고만. 새 제품의 기본 fork로 채택하지 않음 |

OpenCode는 과거 Tauri 사례만 보고 판단하지 않았다. 확인한 최신 `packages/desktop/package.json`에 Electron이 명시되어 있다. Dyad는 package.json의 license 값만으로 판정하지 않는다. README와 LICENSE가 경로별 조건을 구분하므로 해당 경로의 라이선스를 우선 확인한다.

## 4. Windows 기반 비교

| 선택지 | 이 프로젝트의 이점 | 비용·확인할 항목 | 판단 |
|---|---|---|---|
| **Electron + React + TypeScript** | 누비 UI·Pi·OpenWiki의 JS 생태계 재사용. 내장 Chromium, 파일/프로세스/터미널 통합 | 번들 크기·메모리, Chromium 보안 업데이트, native 모듈 ABI, IPC 범위 검증 | **독자 shell 대안; 현재는 Theia desktop 우선 검증** |
| [Tauri 2 + Node sidecar](https://v2.tauri.app/develop/sidecar/) | WebView2와 Rust 호스트, 얇은 shell 구성 가능 | Pi/OpenWiki용 sidecar 및 별도 자동화 브라우저가 필요할 수 있어 크기 이점은 실측 필요. Rust/IPC/배포 경로 추가 | 대안 유지 |
| Theia / Code-OSS | 편집기·LSP·터미널·확장 생태계 | Theia contribution과 Code-OSS fork는 유지 방식이 다름. VS Code 바이너리·Marketplace 권리를 소스 라이선스와 혼동하지 않음 | 후속 요구 반영: **Theia 우선, Code-OSS 대안** |
| .NET + WebView2 | Windows 통합, 기존 Office 호스트 경험 | React/Node와 .NET 사이 브리지·번들·관찰 수명 관리가 추가됨 | Office 통합이 핵심인 별도 제품에 적합 |

Electron renderer의 sandbox는 실행한 프로젝트의 shell 명령을 격리하지 않는다. worktree도 보안 sandbox가 아니다. Preview는 `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, 특권 preload 없음으로 생성하고 IPC sender·경로·프로젝트를 호스트가 검사한다. 외부 웹페이지가 로컬 파일/프로세스 도구를 호출할 수 없어야 한다. [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security), [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view).

## 5. 라이브러리 선택

아래의 “권고”는 설치 완료가 아니다. 이번 시안에 실제 사용한 것은 기존 CX 토큰·폰트·누비 자산과 자체 화면 상호작용뿐이다. 버전 고정·SBOM·Windows artifact 검사는 실제 구현에서 수행한다.

| 영역 | 후보 / 라이선스 | 선택 근거와 경계 |
|---|---|---|
| 실행 루프 | [Pi](https://github.com/earendil-works/pi), MIT | **기존 재사용**. 새 Agent 프레임워크를 겹쳐 넣지 않음 |
| 지식 | [OpenWiki](https://github.com/langchain-ai/openwiki), MIT + 기존 SDS 변경 | **기존 재사용**. 기존 DeepAgents는 Wiki 생성 작업 내부로 한정하고 주 실행기는 Pi |
| 탭·분할 | [dockview-react](https://github.com/dockview/dockview/blob/master/packages/dockview-react/LICENCE.md), MIT 패키지 | **권고**. 코드/문서/브라우저 영역의 탭과 크기 복원. P0는 고정된 세 구역으로 복잡도를 제한. enterprise 패키지 불필요 |
| 코드/diff | [Monaco](https://github.com/microsoft/monaco-editor), MIT | **권고**. 동일 모델의 편집·diff 수명 관리. Monaco만으로 VS Code 확장이나 모든 언어 LSP가 제공되지는 않음 |
| 요구사항/영향 그래프 | [React Flow](https://github.com/xyflow/xyflow), MIT | **권고**. 선택 가능한 노드·근거 이동. Pro 예제는 별도. 초기에는 관련 1~2 hop만 표시 |
| 문서 도식 | [Mermaid](https://github.com/mermaid-js/mermaid), MIT | **권고**. 승인 가능한 텍스트 다이어그램. strict 설정과 안전한 렌더링 적용 |
| 터미널 | [xterm.js](https://github.com/xtermjs/xterm.js), MIT + [node-pty](https://github.com/microsoft/node-pty), MIT 고지 | **권고**. PowerShell/ConPTY, 취소와 출력 backpressure. 번들 ConPTY 등 제3자 고지 별도 확인 |
| 브라우저 검증 | [Playwright](https://github.com/microsoft/playwright), Apache-2.0 | **권고**. 독립 Chromium context에서 시나리오·DOM·스크린샷·trace. 기존 Playwright CRX는 Chrome 확장 전용 경로로 유지 |
| 이미지 차이 | [pixelmatch](https://github.com/mapbox/pixelmatch), ISC | **권고**. 픽셀 차이는 참고 지표이며 요구사항 통과 판정기가 아님 |
| 소스 검색 | [ripgrep](https://github.com/BurntSushi/ripgrep), MIT/Unlicense; [ast-grep](https://github.com/ast-grep/ast-grep), MIT | **권고**. 파일 탐색→구문 범위 검색→필요한 LSP 순. 모든 코드의 의미 그래프를 먼저 만들지 않음 |
| 프레임워크 영향도 | [trace-mcp](https://github.com/nikolai-vysotskyi/trace-mcp), MIT | **조건부 spike**. 기존 조사와 현재 문서의 get_change_impact/get_request_flow를 확인. 대상 저장소의 실제 메뉴 정답으로 정확도를 검증한 뒤 포함 |
| 레이아웃/엔진 전체 fork | OpenCode, Dyad, Theia | **참고만**. 누비의 UI·제공자·완료 계약을 대체하지 않음 |

API 비용은 주 Agent + 요약 + 독립 검토 + 하위 분석 + Wiki 생성 전체를 합산한다. 오픈소스 라이브러리가 무료여도 추론·서명·Windows CI 비용은 별도다. 초기에는 벡터 DB·외부 RAG 서비스·클라우드 브라우저를 요구하지 않고 로컬 검색/SQLite로 시작한다.

GitHub API의 `NOASSERTION`을 라이선스 없음으로 해석하지 않았다. dockview-react의 LICENCE와 node-pty LICENSE 본문을 추가 확인했다. 최근 push 시각과 archive 여부는 유지보수의 단서일 뿐 품질 보증이 아니다.

## 6. 하네스·문맥·하위 Agent의 적용 원칙

[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)의 필요한 자료만 읽기·압축·구조화된 작업 노트와 [multi-agent 연구](https://www.anthropic.com/engineering/multi-agent-research-system)의 독립 조사 분담을 현재 누비 방식에 맞춰 적용한다. 공개 벤치마크 수치를 사내 Qwen 성능으로 환산하지 않는다.

- 주 Agent가 목표·실행·HITL·최종 상태를 소유한다. 소스 조사와 독립 검토는 필요할 때만 최대 두 개로 나눈다. 단순 읽기는 주 Agent가 직접 처리한다.
- 하위 작업에는 질문, 완료 조건, 허용 도구, source revision, 근거 ID, 자원 예산만 준다. 부모 대화 전체를 복제하지 않는다. 하위 Agent는 추가 Agent를 만들거나 파일/브라우저를 쓰지 않는다.
- 위임 결과는 주장·발췌·실제 읽은 범위·미확인 항목으로 받는다. 완료 보고만으로 테스트 통과나 화면 변경을 인정하지 않는다.
- 문맥은 원래 요구/수정사항, 현재 계획, 최근 도구 결과, 실행 영수증, 근거 참조, 장기 프로젝트 메모로 나눈다. 요약 전후에 요구사항 ID와 쓰기 결과를 보존한다.
- 파일은 해시/Git revision, 화면은 URL/문서 revision/관찰 시각, Wiki는 source hash와 생성 시각을 함께 둔다. 오래된 분석은 실행 전에 다시 확인한다.
- 모델이 모르는 파일·URL·메뉴 연결을 사실로 그리지 않는다. 관계마다 `정적 후보 / 실행 확인 / 오래됨 / 미확인`을 표시한다.
- 하나의 쓰기 도구 결과를 확인한 다음 모델이 다음 행동을 정한다. 응답 유실/부분 성공은 readback과 실행 기록으로 확인하고 맹목 재시도하지 않는다.
- 같은 실패가 실질적 진전 없이 3회 반복되면 보존된 작업·원인·다른 접근을 보여주고 기존 질문 폼에서 재시도/중지를 받는다. 사용자가 취소한 작업은 자동 재개하지 않는다.

## 7. 코드와 화면을 비교하는 핵심

1. 작업 시작 시 비교 기준을 고정한다. `HEAD`와 현재 미커밋 파일은 다를 수 있으므로 기준 commit, 적용한 dirty patch, 포함한 untracked 파일 목록/해시를 기록한다. 비밀·ignored 파일을 무조건 복제하지 않는다.
2. 원본 사용자의 checkout은 보존하고 작업용 worktree에서 변경한다. 기준 worktree와 수정 worktree에 독립 포트·임시 데이터 저장소를 할당한다. [Git worktree](https://git-scm.com/docs/git-worktree).
3. 같은 route·viewport·seed·계정 권한·데이터·시간 조건으로 전후를 실행한다. 가능하면 한쪽 실행→capture→다른 쪽 실행으로 자원을 줄이고, 동시에 조작해야 할 때만 두 서버를 띄운다.
4. 코드 diff, 화면 병렬/겹침 비교, 요구사항별 검증을 따로 보여준다. 픽셀 일치는 기능 정상의 증거가 아니다. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).
5. 서버가 준비되지 않았거나 전후 데이터가 다르면 “비교 불가/조건 다름”으로 표시한다. 스크린샷이 없는 쪽을 예시 이미지로 대체하지 않는다.
6. 최종 보고에는 실제 실행한 commit/파일 해시·URL·시나리오·결과·미확인을 연결한다. 파일 반영/commit/PR/push/배포는 서로 다른 상태다.

외부에서 이미 실행 중인 로컬 서버는 연결만 할 수 있지만 해당 PID나 소스 revision을 입증하지 못하면 관리 서버와 같은 검증 배지를 주지 않는다. 소스 checkout과 다르게 실행 중인 서버를 감지하는 handshake가 필요하다.

## 8. 직접 확인한 외부 소스

- OpenCode: `2406400f0aeb07b36d0495af4e05aaca49159832`의 [desktop package](https://github.com/anomalyco/opencode/blob/2406400f0aeb07b36d0495af4e05aaca49159832/packages/desktop/package.json), [main entry](https://github.com/anomalyco/opencode/blob/2406400f0aeb07b36d0495af4e05aaca49159832/packages/desktop/src/main/index.ts). Electron, IPC, local server 수명 분리 확인.
- Dyad: `9903876a01d055855b2d1f3444c5d86b530713cc`의 [FileDiffEditor](https://github.com/dyad-sh/dyad/blob/9903876a01d055855b2d1f3444c5d86b530713cc/src/components/preview_panel/FileDiffEditor.tsx). Monaco diff와 모델 dispose 순서 확인. 코드는 복사하지 않았다.
- Dockview: `24e622438baa5a901634298f59ad24432652b6ed`의 [React adapter](https://github.com/dockview/dockview/blob/24e622438baa5a901634298f59ad24432652b6ed/packages/dockview-react/src/dockview/dockview.tsx), [LICENCE](https://github.com/dockview/dockview/blob/24e622438baa5a901634298f59ad24432652b6ed/packages/dockview-react/LICENCE.md). React portal과 panel/header 수명 분리 확인.

이번 검토는 공식 문서·공개 소스·로컬 구현 확인이다. 각 프로젝트를 Windows에서 설치하거나 성능 비교한 결과가 아니다. Python HTTPS 조회가 로컬 CA 문제로 실패한 뒤 검증을 해제하지 않고 시스템 curl로 공개 GitHub 메타데이터와 소스를 확인했다.

## 9. 산출물과 구현 순서

- [화면 및 실행 명세](../superpowers/specs/2026-09-23-nubi-desktop-workspace.md)
- [조작 가능한 화면 시안](../design/nubi-desktop/index.html): 요구사항/연결 지도/코드/미리보기/전후 비교, 근거 상세, 대화 접기, 실행 기록. 데이터와 서버 표시는 예시다.
- [개발 전달 프롬프트](../plans/2026-09-23-nubi-desktop-implementation.md)

순서는 **Windows 기술 spike → 공유 코어 추출 → 한 과제의 분석·수정·실행·비교 → 복구·실모델 평가 → 설치 패키지**다. 큰 IDE fork나 광범위한 Agent 역할 추가 전에 하나의 수직 흐름을 실제 결과로 증명한다.
