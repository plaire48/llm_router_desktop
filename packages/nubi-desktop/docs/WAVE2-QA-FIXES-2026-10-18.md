# Wave 2 Claude 검토 후속 수정

대상은 계획의 F1~F10이다. 업로드하지 않는다. Claude QA 배치와 main 업로드는 사용자 지시에 따라 분리한다. 기존 Task별 통과 기록을 현재 소스의 결과로 소급하지 않는다.

## 수정

| 항목 | 반영 내용 | 확인할 근거 |
|---|---|---|
| F1 | 내장 Playwright 서버만 비가역 MCP 분류에서 제외. 원본 주석 유지. 외부 쓰기 서버는 승인 유지 | 실제 주석 모양의 browser_type 항상 허용과 저장소 재열기, 실제 Electron 검사 |
| F2 | 자동 보관을 진행 중인 상태만 차단 | started, superseded, timed_out, interrupted는 보관. running 등은 차단 |
| F3 | 경로와 exe 이름, 래퍼, PowerShell 별칭과 축약, shell payload, git 전역 옵션 분류 | 형태별 명령 분류 시험. 명령 실행 시험 아님 |
| F4 | 산출물과 곁가지 도구의 거절 코드, 미발행 표시와 복구 안내 전달 | agent 경유 output_outside, side_task_missing, side_task_invalid 결과와 trace. 카드 한도 output_card_limit |
| F5 | 자동 준비 실패의 코드와 경로 저장, 이벤트 기록. 명시 재시도는 실패를 호출자에게 전달 | 재시도 source_stale 거절, 반영된 파일 보존, 1280/440 화면의 경로와 복구 안내 및 오류 알림 |
| F6 | 조사 읽기와 모델 오류 코드 유지, 범위 경로 사전 확인과 정규화 | 없는 범위 경로 격리, ./ 경로, 프로젝트 전체 within 생략, rate_limited 모델 결과와 진행 기록 |
| F7 | complete, partial, budget_exhausted, context_limit 명시 | 예산 종료와 문맥 한도 및 잘못된 응답을 완료로 표시하지 않음 |
| F8 | MCP 이름을 camelCase 및 구분자로 나눈 행동 토큰으로 판정 | get_presets, postgres_query, gmail_search, dropdown_select 오인 제거 |
| F9 | 실제 VS Code 웹뷰의 api.capabilities에서 새 대화 도구 비활성화 | 보관, 내보내기, 대화 사용량, 곁가지 칩과 관련 설정 숨김. 고정 이전과 읽음 호출 및 점 없음. 로컬 고정 보존 |
| F10 | 조사 시작 전 큐 취소 때 미사용 admission 반환. 사용량의 분석 행 설명 보강 | 큐 취소 후 다시 입장 가능, 문서 처리와 위키 갱신 포함 표시 |

F9 웹뷰를 검사하는 과정에서 오래된 CSS import 경로를 현재 공통 workbench.css로 바꾸고 VS Code 웹뷰 빌드에 WebP loader를 추가했다. 실제 웹뷰 진입점을 합성 호스트 RPC로 검사하며 VS Code 앱 전체 패키징 성공을 뜻하지 않는다.

Electron MCP 검사는 제품의 기본 외부 브라우저 설정을 변경하지 않고, 격리된 검사 저장소에서 명시적으로 내부 모드를 선택해 기존 인앱 승인 시나리오를 검사한다. 외부 창 도킹 성공으로 해석하지 않는다.

## 검증 기록

- 최초 실패: `.superpowers/sdd/2026-10-16-nubi-claude-desktop-wave2/claude-qa-fixes/*red.log` 및 `verification/wave2/f9-red.log`.
- 관련 단위 77/77 통과. 조사 범위와 도구 예산 24/24 통과(범위 일부 중복).
- F9 최초 준비 오류: 오래된 CSS import, 합성 계정 응답의 null을 보정. 이후 실제 setPinnedTasks 및 markTaskRead 호출 실패를 확인한 뒤 능력 분기를 적용해 통과.
- F4 spawn 보완 시험의 너무 짧은 prompt는 도구 스키마에서 먼저 거절됐다. 스키마를 통과하지만 파일 경로가 없는 문장으로 바꿔 실제 호스트 거절을 검증했다.
- Wave 2 화면은 모든 assertion과 산출물 생성 후 브라우저 정리에서 멈춘 첫 실행을 보존했다. 종료 코드 0 통과로 세지 않고 해당 검사 프로세스만 종료 후 재실행한다.
- Wave 2 화면 재실행은 종료 코드 0. 1280/440 오류 안내 화면을 직접 확인했다.
- 실제 Electron MCP 첫 실행은 현재의 메타데이터 JSON + 페이지 스냅샷 텍스트 응답을 단일 JSON으로 해석해 검사 fixture가 실패했다. 현재 응답 형식으로 검사 파서를 맞춘 뒤 실제 인앱 열기, 입력, 클릭, DOM 재읽기, 화면 픽셀, 작업 기록, 재시작 뒤 무프롬프트 6개 확인이 통과했다. 승인 응답 127/117/88ms는 이 로컬 합성 모델 실행의 도구별 관찰값이며 제품 성능 목표나 실모델 벤치마크가 아니다.
- 전체 게이트 단위 2,043개 중 1,843 통과, 실패 0, 환경 조건 건너뜀 200. 디자인 검사, Wave 2/VS Code 웹뷰, Electron 빌드, 실제 에이전트/웹 호스트/수명주기와 전체 화면 검사 117개 통과. 추가 위키/프로필/활동/실패 UI, 산출물과 개발 실행, 실제 MCP 승인 검사까지 끝나 `npm run test:gates` 종료 코드 0. 마지막 MCP 검사 6개 확인이 모두 통과했고 항상 허용은 앱 재시작 뒤 유지됐다.

F11 읽음 타임스탬프 수정은 계획에 기록된 Claude 변경을 그대로 보존했다. F12는 이번 사용자 지시의 F1~F10 묶음과 구분한다. Task 0/13 실측, Windows/Office 2016/NASCA, 회사 로그인 및 설치판은 이번 로컬 검증 범위 밖이다.

## 이번 묶음의 파일 목록

이전 Task12 인계 해시와 비교한 소스/시험/빌드 파일 29개다. `conversation-archive.mjs`는 보존한 Claude F11 변경이며 나머지도 기존 작업을 덮어쓰지 않고 현재 폴더에서 합쳤다. 해시는 `.superpowers/sdd/2026-10-16-nubi-claude-desktop-wave2/claude-qa-fixes/files-before-gates.json`에 기록했다.

- `packages/nubi-desktop/package.json`
- `packages/nubi-desktop/runtime/after-edit-check.mjs`
- `packages/nubi-desktop/runtime/agent.mjs`
- `packages/nubi-desktop/runtime/conversation-archive.mjs`
- `packages/nubi-desktop/runtime/irreversible-actions.mjs`
- `packages/nubi-desktop/runtime/output-files.mjs`
- `packages/nubi-desktop/runtime/project-service.mjs`
- `packages/nubi-desktop/runtime/research-agent.mjs`
- `packages/nubi-desktop/runtime/tool-rules.mjs`
- `packages/nubi-desktop/scripts/check-electron-mcp-approval.mjs`
- `packages/nubi-desktop/scripts/check-vscode-capabilities.mjs`
- `packages/nubi-desktop/scripts/check-wave2-ui.mjs`
- `packages/nubi-desktop/tests/after-edit-check.test.mjs`
- `packages/nubi-desktop/tests/conversation-archive.test.mjs`
- `packages/nubi-desktop/tests/irreversible-actions.test.mjs`
- `packages/nubi-desktop/tests/mcp-approval-flow.test.mjs`
- `packages/nubi-desktop/tests/output-files.test.mjs`
- `packages/nubi-desktop/tests/research-agent.test.mjs`
- `packages/nubi-desktop/tests/research-host.test.mjs`
- `packages/nubi-desktop/tests/shared-ui-fixture.jsx`
- `packages/nubi-desktop/tests/side-tasks.test.mjs`
- `packages/nubi-desktop/ui/ConversationUsage.jsx`
- `packages/nubi-desktop/ui/SessionSidebar.jsx`
- `packages/nubi-desktop/ui/Workbench.jsx`
- `packages/nubi-desktop/ui/after-edit-check-message.mjs`
- `packages/nubi-vscode/scripts/build.mjs`
- `packages/nubi-vscode/src/capabilities.mjs`
- `packages/nubi-vscode/src/webview.jsx`
- `packages/nubi-vscode/tests/host-capabilities-fixture.jsx`

사용자 후속 요구인 Mac 외부 브라우저 기본 연결/자동화는 [설계 §8.12](../../../docs/superpowers/specs/2026-10-16-nubi-claude-desktop-wave2-design.md)에 기록했다. 현재 수동 확장 연결과 Windows 전용 도킹을 Mac 자동 연결 완료로 표시하지 않는다. 설계 변경 시 질문하고 멈추라는 기존 지시를 따라 이 추가 구현은 설계 확정 대기다.

사용자 후속 UI 지침은 루트 `AGENTS.md:97`과 `packages/nubi-desktop/AGENTS.md:3`에 추가했다. 모든 화면/모달/팝오버의 아이콘, 서체, 크기, 굵기, 행간, 색상과 강조, 여백 및 텍스트 시작선을 주변 UI 및 공통 토큰과 대조하도록 한다. 제공자 고유 색과 상태 의미, 실제 호스트 화면 검증 경계도 보존한다. 이 두 지침 파일은 위 제품 소스 해시 목록과 별도다.

후속 지침 보강: 의미가 충분한 동작의 아이콘 전환, 모호한 동작/승인에 짧은 이름 유지, 메인 색과 파스텔 그라데이션 및 느리고 미세한 배경 모션, 절제된 탄성 전환, 가독성/입력 반응/성능과 모션 감소 검증을 같은 두 `AGENTS.md`에 명시했다. 지침 변경이며 새 모션 구현이나 전체 UI 재검증 완료 주장은 아니다.

## 인계 상태

전체 게이트 실행 전후 소스 94개 해시가 동일하다. `claude-qa-fixes/result.json`과 `files-after-gates.json`에 결과를 남겼다. F1~F10 계획 체크박스를 갱신했다. 제품 코드 편집은 끝났으며 커밋/push/릴리스는 하지 않았다. Claude의 독립 QA 배치와 F1/F2/F4/F5 직접 확인 뒤 업로드를 진행한다. Mac 연결 새 설계와 실기기/실모델 미검증은 위 경계를 유지한다.
