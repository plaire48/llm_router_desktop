# 누비의 기반을 오픈소스 IDE로 잡는 방향

2026-09-23. **권고: Eclipse Theia 기반 Windows 제품을 첫 기술 검증 대상으로 삼는다.** Code-OSS 기반은 기존 VS Code 환경과의 호환성이 더 중요한 경우의 대안이다. 아직 어떤 IDE도 설치·채택·통합한 상태는 아니다.

사용자가 소스 코드의 지속적인 관리·연계를 강조했으므로, 별도 Electron shell을 우선하던 초안을 **IDE 플랫폼 우선 검증**으로 수정한다. 하네스·근거·작업 격리·전후 비교 계약은 유지한다. Theia도 Electron desktop을 만들 수 있으므로 Windows 런타임 논의 자체를 버리는 것은 아니다.

## 1. 생각: 소스가 기준인 Agent 워크스페이스

IDE를 기반으로 하는 편이 이 목표에 더 적합하다. 코드 편집창 하나가 아니라 파일 탐색·전역 검색·심볼·진단·Git·diff·미저장 버퍼·undo·터미널·언어 서버를 함께 얻기 때문이다. 이 요소를 독자 앱에서 다시 구현하는 것보다 누비의 분석/실행과 OpenWiki의 지식을 연결하는 데 집중할 수 있다.

그러나 IDE의 기본 화면을 그대로 유지하고 채팅 패널만 붙이는 데서 끝내면 요구사항·시각화·실행 비교가 다시 여러 도구로 흩어진다. 코드와 같은 중앙 영역에 **요구사항, Wiki, 영향 지도, 브라우저, 전후 비교를 모두 열 수 있는 결과물**로 취급하는 것이 제품의 차별점이다.

| 작업 | 중앙 영역 | 오른쪽 누비 | 왼쪽 탐색 |
|---|---|---|---|
| 요구 이해 | 요구사항·AC·관련 Wiki | 모호한 점 질문·분석 | 프로젝트·요구 목록 |
| 구조 이해 | 파일/심볼/라우트 연결 지도 | 근거와 설명 | 소스·Wiki |
| 구현 | 코드·diff·진단 | 계획·실행·수정 제안 | 파일·변경 목록 |
| 검증 | 실행 화면·전후 비교 | 확인한 조건·미확인 | 시나리오·증거 |

개발 관점은 `왼쪽 소스 / 중앙 코드 / 오른쪽 누비 / 아래 터미널`, 검토 관점은 `왼쪽 작업 / 중앙 전후 비교 / 오른쪽 접은 누비`다. 작업 모드를 강제하는 별도 Agent가 아니라 같은 작업의 레이아웃 preset으로 제공한다. Theia의 [Perspectives](https://theia-ide.org/docs/perspectives/)와 widget 확장 방식을 첫 후보로 검토한다.

## 2. 기반 비교

| 기반 | 잘 맞는 이유 | 비용/제약 | 판단 |
|---|---|---|---|
| **Eclipse Theia** | 자체 IDE 제품을 만드는 모듈형 플랫폼. custom widget/editor, 파일·Git·터미널·Monaco, Electron/web 구조 | VS Code API 호환은 전부가 아님. 필수 확장·언어별 검증과 EPL 고지/수정 배포 검토 필요 | **누비 전용 Windows 제품의 1차 권고** |
| **Code-OSS + 누비 extension** | 개발자에게 익숙한 편집/검색/디버깅/SCM. Extension API로 옆 패널, TreeView, Webview, CustomEditor 연결 | workbench 내부 배치는 extension API 범위를 넘으면 fork patch 필요. upstream 병합과 배포 유지 부담 | 기존 VS Code 작업 방식/확장 호환이 최우선일 때 |
| **OpenSumi** | React/TypeScript의 제품형 IDE 프레임워크, MIT, AI/MCP 지향 | 현재 core-browser는 React 18.2 계열이며 누비 React 19와 직접 공유 경계 검증 필요. 사용하는 확장·Windows 배포·문서 검증 필요 | 유력한 비교 후보 |
| 독자 Electron + Monaco | 누비 화면과 빠른 미리보기를 자유롭게 구성 | Monaco만으로 IDE가 되지 않음. 파일 버퍼·언어 서버·진단·Git·터미널·undo를 조립/유지 | 위 플랫폼이 실제 요구를 막을 때 fallback |
| Void | VS Code fork 사례 | 공식 deprecated 및 archive | 신규 기반 제외 |

Theia는 이름에 AI가 있어서 고른 것이 아니다. [architecture](https://theia-ide.org/docs/architecture/), [extension authoring](https://theia-ide.org/docs/authoring_extensions/), 실제 `ApplicationShell`·`MonacoWorkspace` 구현에서 기존 IDE 서비스에 누비를 결합할 수 있음을 확인했다. 성능·업그레이드 비용은 아직 측정하지 않았다.

공개 라이선스는 Theia core package의 `EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0`, OpenSumi/Code-OSS는 MIT로 확인했다. 이는 제품에 포함할 모든 확장·바이너리의 조건이 같다는 뜻은 아니다. [Microsoft FAQ](https://code.visualstudio.com/docs/supporting/faq)에 따라 Code-OSS 소스와 Microsoft VS Code 배포판·Marketplace를 구분한다. 필수 확장은 Open VSX 또는 권리가 확인된 VSIX로 별도 목록화한다.

## 3. Codex와 Claude에서 가져올 BP

| 관찰한 제품/문서 | 푸는 방식 | 누비 적용 |
|---|---|---|
| [Codex IDE](https://learn.chatgpt.com/docs/codex/ide) | 열려 있는 파일·선택 코드와 대화를 연결하고 편집기 옆에서 변경 검토 | 현재 selection, 진단, 파일 revision을 좁은 ContextPacket으로 전달 |
| [Codex app](https://openai.com/index/introducing-the-codex-app/) | 프로젝트별 작업과 격리된 worktree, 작업 안에서 diff 검토 | 장기 작업 목록과 작업별 변경/근거를 유지. 사용자의 현재 checkout과 작업 격리 |
| [Claude Code VS Code](https://code.claude.com/docs/en/vs-code) | IDE diff로 제안을 검토하고 사람이 제안 내용을 수정한 사실을 Agent에 알림 | 사람과 Agent가 같은 문서를 편집하는 상태를 동기화. 오래된 제안 덮어쓰기 차단 |
| [Claude Desktop](https://code.claude.com/docs/en/desktop) | preview 서버, Browser pane, 로그, 작업 격리 | 분석·수정 뒤 바로 실행 화면과 검증으로 이동 |
| [Claude 실행 원리](https://code.claude.com/docs/en/how-claude-code-works) | 문맥 수집→행동→검증의 반복 | 누비의 기존 inspect→act→verify 및 최종 요구 검토를 유지 |

**내 해석:** 양쪽 모두 “소스 편집에 가까운 작업”과 “여러 작업을 맡기고 결과를 검토하는 작업”에 맞는 표면을 제공한다. 따라서 누비도 IDE 편집과 Agent 작업 관리를 같은 런타임 위의 두 레이아웃으로 설계하는 것이 타당하다. 특정 제품의 비공개 내부 구조를 동일하다고 단정하는 것은 아니다.

Codex의 공개 [app-server 소스](https://github.com/openai/codex/tree/main/codex-rs/app-server)는 클라이언트와 실행 세션의 분리를 참고할 수 있다. 공개 저장소가 Codex 데스크톱 UI 전체의 소스를 제공한다는 뜻은 아니다. Claude 문서 역시 행동/확장 계약의 참고이며 내부 구현 소스를 확인한 것은 아니다.

## 4. OpenWiki는 저장소와 함께 관리

OpenWiki를 옆에 띄운 웹페이지로만 끝내지 않는다. 같은 workspace의 **버전이 붙은 지식과 근거**로 취급한다.

```text
사용자 요구 ── AC ── 설계 결정
                 │
openwiki/ 문서 ── 소스 파일·심볼 ── 코드 변경
                 │                    │
             메뉴·URL 후보 ── 실행 시나리오 ── 검증 근거
```

권고 방법론은 **docs-as-code + 요구사항 추적 + 점진적 색인 + 실제 실행 검증**이다. 문서와 코드가 서로의 최신 상태를 자동 보증한다고 가정하지 않는다.

1. `openwiki/`는 현재 OpenWiki 형식을 유지하고, 새 요구/결정 문서는 `docs/requirements/`, `docs/decisions/`처럼 사람이 리뷰할 수 있는 Markdown으로 관리한다. 팀의 기존 경로가 있으면 우선한다.
2. source ref는 줄 번호만 저장하지 않고 symbol/path/hash/revision을 보관한다. 리팩터링으로 줄이 바뀌면 symbol을 재해결하고, 실패하면 오래된 근거로 표시한다.
3. IDE에서 선택한 함수에 “관련 요구/Wiki/실행 결과”를 열고, Wiki의 근거를 누르면 정확한 파일·줄로 이동한다. 문서와 코드의 양방향 탐색이 기본이다.
4. 저장/rename/Git 변경에서 영향을 받은 파일·의존 문서만 무효화한다. 매 저장마다 전체 Wiki를 다시 생성하거나 모델에 저장소 전체를 보내지 않는다.
5. 중요한 코드 변경 후 Wiki 업데이트를 **diff 제안**으로 만들고 코드와 함께 검토한다. 사람이 적은 의도/제약/결정을 생성 문서가 덮어쓰지 않는다.
6. 로컬 실행 캡처·세션·토큰·큰 trace는 Git에 자동 추가하지 않는다. 선택한 검증 요약만 문서에 참조하고 로컬 evidence는 별도 저장한다.
7. OpenWiki 검색→필요한 코드/AST/LSP→실제 실행 순으로 근거를 보강한다. LSP/정적 관계와 런타임 관찰 관계를 나누어 표시한다.

기존 누비/OpenWiki read-only API는 활용 가능하다. IDE 버퍼와 파일 쓰기를 이 API에 억지로 추가하지 않고 WorkspacePort로 분리한다.

## 5. IDE 기반이면 반드시 추가되는 계약

**디스크만 읽고 patch하는 방식으로는 부족하다.** 편집기에 저장하지 않은 내용이 있을 수 있다. Theia `MonacoWorkspace` 소스에서도 dirty model 보존과 bulk edit/save 처리를 확인했다.

- 읽기 문맥에 `uri, editorVersion, dirty, diskHash`를 포함한다. 사용자가 선택한 미저장 코드와 저장된 코드를 구분한다.
- 열린 파일은 IDE의 문서 편집/bulk edit/undo 경로로 변경하고 expected editorVersion을 검사한다. worker가 파일에 직접 써서 사용자의 버퍼를 우회하지 않는다.
- 파일의 미저장 내용과 worktree 기준이 다르면 충돌을 표시한다. baseline capture는 정확히 어떤 저장 상태를 실행했는지 고정한다.
- Agent 수정 중 사용자가 편집하면 해당 proposal은 stale 처리하고 새 version으로 다시 계산한다. undo와 사용자 수정도 상태 이벤트로 누비에 전달한다.
- 에디터를 닫거나 대화 패널을 접어도 실행 소유자는 worker다. 창 닫기/앱 종료 시 동작은 명시적으로 정하고 종료 복구를 시험한다.

## 6. 최대한 가져오되 중복시키지 않을 것

| 역할 | 가져올 것 | 새로 만들 것 |
|---|---|---|
| IDE 기반 | Theia shell, 편집기, workspace, SCM, terminal, 검색, 언어 지원 | 누비 브랜드와 필요한 contribution |
| Agent | 기존 Pi 하네스/문맥/검토/분석/질문 폼 | IDE version-aware WorkspacePort와 ProcessPort |
| 지식 | OpenWiki 문서/Claims/검색·소스 읽기 | IDE 근거 링크, 변경 시 무효화, 요구사항 연결 |
| 시각화 | React Flow·Mermaid | 요구→소스→화면→검증 관계 모델 |
| 비교 | IDE diff + Playwright 결과 | baseline/candidate 관리, AC별 증거 연결 |

Theia 기반에서는 별도 Dockview·Monaco·xterm 관리 계층을 추가하지 않고 플랫폼 것을 우선한다. Theia AI의 [Change Sets](https://theia-ide.org/docs/theia_ai/#change-sets)는 제안/검토 UI 패턴과 연결 가능성을 검토하되, 주 실행기를 Theia Coder와 Pi 두 개로 겹쳐 돌리지 않는다. 기존 누비 UI를 ReactWidget에 연결하는 방식과 Change Set adapter부터 검증한다.

## 7. 결정 전에 할 짧은 검증

동일한 React/TypeScript 예제와 요구를 두 후보에 넣는다. **Theia custom extension**과 **VS Code extension**으로 파일 선택→Wiki 근거→수정 제안→IDE diff→로컬 실행→비교를 만든다. 독립 제품 목표상 Theia를 우선하며 Code-OSS 전체 fork는 이 검증 전에는 시작하지 않는다.

승패는 인기나 화면 유사도가 아니라 (1) Windows 설치/실행, (2) dirty buffer·undo 보존, (3) 필요한 언어/확장, (4) 누비 UI·Pi 연결, (5) preview 수명, (6) upstream 무수정 범위, (7) cold start·idle memory·번들 크기·수정 비용으로 결정한다. 검증 결과가 나오기 전에는 소요 기간·성능 점수를 만들어 내지 않는다.

최소 성공 시나리오는 “빈 검색 결과 화면 변경” 하나다. 두 후보에 대한 구현 비교는 아직 수행하지 않았다. 실제 Windows spike 결과에 따라 기반 선택을 확정한다.

## 8. 실제 소스 확인점

- Theia `258d11e3e42d4527e85bd480fce9b22f72d4ab7c`: [core package](https://github.com/eclipse-theia/theia/blob/258d11e3e42d4527e85bd480fce9b22f72d4ab7c/packages/core/package.json)는 React 19 peer와 라이선스 표현을 명시. [application-shell](https://github.com/eclipse-theia/theia/blob/258d11e3e42d4527e85bd480fce9b22f72d4ab7c/packages/core/src/browser/shell/application-shell.ts)은 Lumino DockPanel 기반. [monaco-workspace](https://github.com/eclipse-theia/theia/blob/258d11e3e42d4527e85bd480fce9b22f72d4ab7c/packages/monaco/src/browser/monaco-workspace.ts)는 dirty model과 bulk edit/save 처리.
- OpenSumi `9fee6aa38f96f85ac686f25c2522910067324c1d`: [core-browser package](https://github.com/opensumi/core/blob/9fee6aa38f96f85ac686f25c2522910067324c1d/packages/core-browser/package.json)의 React 18.2 및 patched Monaco 의존성 확인.
- Code-OSS `066953e45f645f85d2d33bab8470121d40dfc217`, Codex `506a328dab110591d3c1449a15217596e7e9cd61`: 공개 저장소 메타데이터/라이선스 확인. Codex app-server 문서 확인. 전체 코드를 감사한 것은 아니다.

앞선 [BP 보고서](2026-09-23-nubi-desktop-bp.md)의 개별 라이브러리 후보는 독자 shell 대안의 목록으로 읽는다. 현재 권고는 이 문서이며, [화면 명세](../superpowers/specs/2026-09-23-nubi-desktop-workspace.md)와 [개발 전달서](../plans/2026-09-23-nubi-desktop-implementation.md)도 IDE 기반으로 갱신했다.
