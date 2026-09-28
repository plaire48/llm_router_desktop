# 누비 Desktop 개발 전달 프롬프트

2026-09-23. 이 문서는 구현 담당에게 넘길 작업 명세다. 현재 산출물은 조사·설계·화면 시안이며 아래 단계는 아직 구현되지 않았다.

## 전달할 요청

`docs/research/2026-09-23-nubi-ide-foundation.md`, `docs/superpowers/specs/2026-09-23-nubi-desktop-workspace.md`, `docs/research/2026-09-23-nubi-desktop-bp.md`를 읽고 Windows 네이티브 누비 개발 워크스페이스를 작은 수직 단계로 구현하라. 현재 권고는 Theia desktop에 custom extension/widget을 추가하는 방식이며 Code-OSS extension은 비교 후보, 독자 Electron shell은 fallback이다. 목표는 “요구사항 → 소스/Wiki 분석 → 수정 → 로컬 실행 → 변경 전후 비교”다. 기존 누비 브라우저 Agent의 Pi 하네스·문맥·읽기 전용 하위 분석·제공자·CX를 최대한 재사용한다. 현재 Chrome/Office 기능과 사용자 변경을 보존한다.

### 0. 기술 spike

`docs/research/2026-09-23-nubi-shell-environment.md`를 읽고 Bash 중심 CLI 실행 계층을 함께 검증하라. Git Bash/PowerShell/선택형 WSL2 profile, exec와 PTY 구분, poll/stdin/cancel, 출력 artifact, 영수증, 소유 프로세스 트리, 미저장 IDE 버퍼를 포함한다. Pi coding-agent shell 소스의 재사용 가능성을 설치 버전과 비교하라. 모든 CLI를 MCP로 감싸지 말고 ACP는 여러 IDE 연결이 필요할 때 adapter로 추가하라. shell 접근 허용을 OS sandbox와 혼동하지 마라.

새 `packages/nubi-desktop` 경계를 만들기 전에 Theia desktop extension에서 누비 React 19 화면, worker RPC, dirty buffer/version-aware edit/undo, SCM, PowerShell/ConPTY, 로컬 서버 시작/중지, preview, Playwright Chromium capture를 증명하라. 같은 최소 흐름의 VS Code extension을 비교 후보로 평가하되 전체 Code-OSS fork부터 시작하지 마라. Windows 환경이 없다면 source/type/mock 검사까지만 표시하고 통과로 보고하지 마라. renderer sandbox와 shell sandbox를 구분하라. Theia 내장 Monaco/docking/xterm을 중복 설치하지 마라.

Desktop 의존성은 공식 안정 버전과 공급 artifact를 확인한 뒤 pin하라. OpenWiki는 요구 Node 버전이 22.22.0 이상이므로 번들 runtime과 맞춰라. Electron utilityProcess의 Node API가 충분한지 확인하고, 부족하면 전용 runtime을 bundle하되 사용자에게 별도 설치시키지 마라. node-pty는 실행하는 runtime ABI와 일치하는 Windows prebuild를 검증하라.

같은 화면의 Agent 조작은 독립 spike다. WebContentsView의 탭/popup/관찰 수명과 자동화 접속을 증명하기 전에는 수동 preview와 별도 검증 Chromium을 같은 session으로 표시하지 마라.

### 1. 공유 코어와 UI

누비의 agent-runtime/harness/context/analysis/goal-review/task-plan을 조사해 Chrome global 의존성을 port 뒤로 옮겨라. 복사한 구현이 분기되지 않도록 공유 패키지에 public contract를 정의하고 기존 확장/Office를 계약 테스트로 보호하라. 전면 교체는 하지 마라. UI는 NubiSurfaces·DeckSurfaces·Welcome·MessageBody·QuestionForm 및 CX를 공유하며 새 결과물 워크스페이스만 추가하라.

Pi가 주 실행기이고 OpenWiki의 내부 DeepAgents는 Wiki 생성 작업에만 남긴다. 새 Agent framework를 중복 도입하지 마라. AI Pro·ChatGPT·FabriX의 transport 계약과 모델 선택을 유지하되 Desktop 전용 auth/storage adapter를 만들고 다른 앱의 인증값을 가져오지 마라.

### 2. 읽기와 요구사항

프로젝트 열기, 기존 OpenWiki pairing/읽기, source search, 요구사항 ID·AC, 관련 코드와 근거 화면을 연결하라. 파일/줄/hash와 graph freshness를 보존하라. 그래프에는 static candidate와 runtime observed를 별도로 표시하라. trace-mcp는 실제 대상 저장소 정답으로 평가 후 선택하라.

### 3. 작업 격리와 변경

먼저 [프로젝트 지식·전달 명세](../superpowers/specs/2026-09-23-nubi-project-hub.md)와 [OSS 검토](../research/2026-09-23-nubi-project-knowledge-bp.md)를 읽어라. 기존 OpenWiki의 generation lifecycle/Claims/no-op을 재사용하고, OpenSpec 방식의 요구사항 변경 문서는 기존 경로와 매핑하라. 사람 지식과 생성 문서의 소유권, base/ours/theirs 병합, Claims 재검증, 단일 Wiki writer와 branch별 stale 처리를 구현하라. 사용자 문서와 설정을 upstream 업데이트로 덮어쓰지 마라. docs/design/nubi-project-hub의 schema/fixture는 설계 자료이며 인증·영속 작업 수신 기능이 아니다.

Git 기준 commit과 dirty/untracked manifest를 고정하고 사용자 checkout을 변경하지 않는 worktree를 만들라. patch는 expected hash와 operation ID를 검사하고 적용 후 readback하라. 취소/부분 실행/응답 유실은 자동 재전송하지 마라. 자식 Agent는 읽기 전용 최대 2개이며 실제 읽은 근거만 보고한다.

### 4. 실행과 비교

command/args/cwd/readiness/port를 갖는 서버 profile을 만들고 앱 소유 프로세스만 관리하라. baseline/candidate의 포트와 테스트 데이터는 분리하라. 동일 시나리오에서 코드 diff·DOM 검사·screenshot·trace·AC 판정을 저장하라. 시각 차이를 기능 통과로 치환하지 마라. unmanaged server는 소스 연결을 입증하지 못하면 별도 상태로 둬라.

### 5. 복구와 평가

SQLite EventStore와 evidence 파일 저장소로 task/run/step/receipt/revision을 보존하라. 재시작은 기록 복원→실제 상태 관찰→미완료 재계획이며 blind write replay가 아니다. 사용자의 중지는 유지한다. Qwen 실제 과제로 성공률·거짓 완료·수정 오류·중복 실행·지연·총 usage를 측정하고 mock 회귀와 별도 보고하라.

### 6. Windows 배포

웹·Office 연계는 읽기 공유 → capability handshake/수신함/receipt → 검증/보고서 초안 순서로 추가하라. 기존 OpenWiki 읽기 token에 쓰기 권한을 덧붙이지 마라. Office의 현재 메모리 runLookup을 durable 복구로 표시하지 말고 응답 유실은 상태 조회부터 수행하라. 불명확한 쓰기를 다시 시작하지 마라. 같은 요구·소스 snapshot·실행 근거를 전달하되 실제 tab/document 바인딩과 저장 승인은 소유 호스트에 둬라. 기존 단독 사용과 NASCA Office open/save 계약을 보존하라.

수직 시나리오와 복구를 검증한 뒤 별도 최종 빌드 단계에서 설치 패키지를 생성하라. Windows signing, 업데이트 출처와 해시, 회사 CA/proxy, 한글·공백 경로, 비관리자 설치, 제거/재설치, 세션 데이터 보존을 검사하라. 저장소 전체의 일반 테스트를 반복하는 대신 변경한 계약과 위험에 맞는 검증을 수행하라.

## 매 단계 제출할 것

구현 범위, 실제 재사용/참고/미도입 목록, 선택 근거, 실제 입력과 결과, 실패와 미검증, 다음 단계의 조건을 짧게 남겨라. “화면 동작”, “합성 모델”, “실모델”, “Windows 실행”, “설치”, “배포”를 각각 구분하라. 최종 적용 승인에 필요한 diff와 실행 증거를 먼저 준비하라.
