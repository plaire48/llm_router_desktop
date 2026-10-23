# Workspace 품질 감사 후속과 브라우저/모달 개선

기준: `/Users/ganadi/Documents/llm_router`, 2026-10-23. 사용자의 직접 수정 요청을 반영했다. 기존 변경은 유지했으며 원격 업로드, 설치판 배포와 Windows 실행은 하지 않았다.

후속 실시간 작업과 검토 문구 수정은 [Codex 흐름 대조와 반영 기록](2026-10-23-codex-progress-review-benchmark.md)에 정리했다. 폼 제출 직후 처리, 공개 초안과 출력 갱신, 가벼운 스트림 조회와 구체적인 미확인 항목 표시를 포함한다. 전체 기반 회귀 2,409 통과/기능 비활성 생략 200과 최종 집중 검사 13개 및 실제 Electron 결과를 구분한다.

## 판단

공식 OpenCode 1.18.18 바이너리는 실제 사용한다. 그러나 Workspace의 주 실행기는 기존 Pi이며, 라우터의 도구 왕복, 대화 변환과 제품 UI는 누비가 소유한다. 이번 결함 수정과 회귀 통과를 OpenCode 전체 코딩 품질, 실모델 비교나 Windows 제품 품질 동등성으로 표시하지 않는다. 원래 실패와 바이너리 동일성 근거는 [최초 감사](2026-10-23-opencode-inheritance-audit.md)에 보존했다.

## OpenCode 감사의 다섯 결함

| 항목 | 반영 내용 | 현재 근거 |
| --- | --- | --- |
| F1 도구 재개 조건 누락 | 최초 모델/시스템 지시/함수/출력 조건과 재개 조건을 비교한다. 변경은 409로 거절하고 결과를 발행하지 않는다. 병렬/필수 도구 검사도 재개에 적용한다. | 실제 공식 바이너리에서 변경 거절, 미발행과 동일 조건 재개를 확인 |
| F2 이력의 시스템 지시 승격 | 과거 user/assistant/tool 메시지를 역할이 있는 JSON 자료로 전달하고 system/developer 지시와 분리한다. | 제공자에게 전달된 system에 과거 사용자 문자열이 없는 것을 확인. native 역할 완전 복제는 아님 |
| F3 다른 작업을 끊는 프로필 재시작 | 활성 요청/대기 도구가 있으면 변경과 로그인 재시작을 거절한다. 프로필/비밀 저장도 같은 구성 잠금 안에서 보호한다. | 대기 도구/일반 요청 보존과 거절 시 프로필 및 비밀 파일 바이트 보존 검사 |
| F4 내부 서버 무인증 | 관리형 서버마다 임의 비밀번호를 생성하고 내부 호출에 인증한다. | 실제 바이너리에서 무인증 health와 session 생성 모두 401 |
| F5 만료 및 등록 누적 | 백그라운드 TTL 정리, 최대 32개 MCP 슬롯과 미확정 정리 슬롯 격리. 중복 결과 발행도 거절한다. | 단위 만료/중복/실패 검사와 실제 바이너리의 순차 두 작업 뒤 등록 수 1 |

`tests/test_opencode_safety.py`, 일반 `pytest`, `tools/check_opencode_inheritance.py`와 새 `opencode-inheritance.yml`이 회귀 기준이다. 새 GitHub workflow는 이 작업에서 원격 실행하지 않았다. 바이너리 검사는 로컬 가상 제공자를 사용했으며 실모델 호출이 아니다. 버퍼링 SSE와 내장 도구 제한은 기존 계약으로 유지한다.

## 확장 없는 삼성브라우저 연결

Windows에서는 실행 중인 Samsung 제품의 실행 파일 메타데이터와 Samsung UserDataDir 정책 또는 제한된 Samsung 디렉터리의 DevToolsActivePort만 탐색한다. 기존 Chromium CDP/WebSocket과 기존 탭 중계기를 직접 연결하며 확장을 설치하지 않는다. 쿠키/프로필을 가져오거나 브라우저를 강제 종료하거나 정책을 바꾸지 않는다.

사용자 흐름은 연결 버튼 → 브라우저의 연결 허용 → 업무 탭 선택이다. 탭이 하나일 때만 자동 선택하며 창 가져오기 경로는 하나여도 탭 선택을 유지한다. 후보 목록 갱신, 연결 취소와 재진입을 제공한다. 연결 해제는 원래 탭을 닫지 않고 키/마우스 눌림과 크기 변경을 해제한 다음 세션을 분리한다. 모델/캡처의 인증 화면 보호는 유지한다.

Samsung의 공식 [RemoteDebuggingAllowed 정책](https://developer.samsung.com/browser/policy/remote-debugging-allowed.html)은 CDP 실행 허용/차단을 설명한다. Chrome의 [기존 세션 연결 설명](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)은 연결 허용을 사용자에게 맡긴다. Samsung의 같은 허용 UI 제공 여부와 회사 정책은 실제 Windows에서 아직 확인하지 못했다. Chromium 기반이라는 사실만으로 이 조건을 통과시키지 않는다.

검증: 실제 임시 Chromium을 확장 없이 실행해 실제 Electron 중계기에서 클릭 5회, 한글/영문/합성 IME 입력, 우클릭, 휠, 숨김/재진입, 모달 중 입력 중단, 문서 탐색과 기존 HttpOnly 세션 유지 등 14개 검사를 통과했다. 실제 빌드된 Electron의 연결 화면/좁은 창/재진입 등 4개 검사도 통과했다. 실제 회사 SSO, 포털 API, 물리 IME와 삼성 Windows 성공으로 확대하지 않는다.

## 네모 입력창

둥근 내부 입력창 위에 `border-radius: 0`인 외곽이 다시 배경과 그림자를 칠하고 있었다. 그 외곽에 기존 `--nubi-composer-radius`를 적용했다. 실제 빌드에서 외곽 24px, 내부 18px를 확인했으며 기존 색, 간격과 공통 UI를 유지했다. 채팅/빈 진입의 여러 창 크기에서도 렌더링을 확인했다.

## 모찌 효과와 모달 끊김

첨부한 두 `motion_interaction_atlas.html`을 읽고 원본 해시를 [reference-files.json](../../packages/nubi-desktop/verification/modal-stutter-2026-10-23/reference-files.json)에 기록했다. 참고의 탄성과 자연스러운 연결을 유지하고 업무 폼의 글자를 확대하지 않는다.

1. 유리 선택을 그리는 `25ms` 간격 제한이 60Hz 화면에서 매 두 번째 프레임을 버렸다. 같은 실제 Electron 검사에서 수정 전 18프레임 중 9회, 수정 후 18회 움직임 갱신을 확인했다. 제한을 제거하고 기존 180k backing pixel 상한과 정지 시 루프 종료를 유지한다.
2. 모달 ResizeObserver 뒤 다음 rAF까지 기다려 새 크기를 한 번 칠한 뒤 이전 크기로 되돌리는 경로가 있었다. 관찰 전달 안에서 모든 읽기 뒤 FLIP을 설치한다. 실제 브라우저 검사에서도 페인트 전 배경/본문 두 트랙이 모두 존재하는 것을 확인했다.
3. 모달의 WAAPI 배경/본문은 이름이 없어 공통 모션 제한에서 버튼 hover보다 낮은 순위였다. 두 트랙에 모달 ID를 부여하고 함께 우선 보존한다. 전체 3개 상한은 유지한다. 움직이는 본문의 backdrop blur도 중단하고 완료하면 원래 공통 재질로 복원한다.
4. 기존 220/25 물리 계수와 방향별 늘어남을 유지하며 적분을 같은 경과 시간에 주사율이 바뀌어도 같은 결과가 나오는 식으로 변경했다. 30/60/120Hz, 역방향 재입력과 긴 프레임 간격을 검사했다.

검증: 관련 단위 33개, 실제 Electron의 유리/정지/크기/대체 표시/모달 재진입 16개, 실제 CX 모달의 확대/축소/중단/포커스/모션 감소/좁은 창 9개가 통과했다. CPU 4배 지연의 로컬 Chrome 3회에서 프레임 간격 p95는 16.7~16.8ms, 최댓값은 50/33.4/33.4ms, 50ms 이상 main-thread long task는 0개다. 첫 회에 50ms 프레임 간격 1개는 남아 있으며 모든 프레임이 60fps였다고 표시하지 않는다.

주요 근거:
- [실제 Electron 유리 검사](../../packages/nubi-desktop/verification/liquid-glass-webgl/stutter-after-2026-10-23/result.json)
- [모달 동작 검사](../../packages/nubi-desktop/verification/modal-stutter-2026-10-23/motion-result.json)
- [CPU 지연 검사](../../packages/nubi-desktop/verification/motion-2026-10-17/mochi-final/result.json)
- [브라우저 입력/세션 검사](../../packages/nubi-desktop/verification/direct-browser-content-2026-10-23/report.json)
- [실제 제품 연결 화면과 입력창](../../packages/nubi-desktop/verification/direct-browser-shell-2026-10-23/report.json)
- [OpenCode 바이너리 회귀](../../verification/opencode-code-audit-2026-10-23/binary-gate-after.json)

## 검증 경계와 남은 확인

Python 전체는 수정 후 239개 통과, Ruff와 format 검사도 통과했다. 공통 모션 품질 검사도 145개 통과, 오류 0개다. POP3 후속 수정 직전 Desktop 전체 단위는 2,398개 통과와 의도된 비활성 200개, 실패 0개다. POP3 후속 뒤 메일 관련 회귀 317개와 실제 worker 진행 검사, 실제 제품 UI 4개를 추가 확인했다. 전체 단위 결과를 POP3 이후 전체 재실행 결과로 소급하지 않는다. 모션 재발 검사는 빌드 후 `npm run test:motion-stutter`로 실행할 수 있다.

기존 전체 Electron shell 검사에서는 오래된 1.2MB 크기 제한 및 mail/브라우저 진입 기대가 현재 UI와 달랐다. 크기 제한과 외부 브라우저 기대를 갱신한 뒤에도 현재 메일 설정의 제거된 '저장된 메일 연결' 버튼을 기다리는 단계가 실패했다. 이 전체 검사를 통과로 표시하지 않으며 수정 대상 화면의 직접 검사와 구분한다.

실제 Windows의 Samsung 연결 허용, GPU/드라이버/배율 환경, 회사 정책/SSO, 현재 설치판의 버전/해시와 새 설치/재실행은 미검증이다. Windows에서 반영이 안 보이는 원인을 구형 설치판이나 특정 GPU라고 단정할 근거는 없다. 이번 수정은 현재 소스와 로컬 Electron 빌드에 반영했다.

## POP3 대기 폼 후속

사용자의 추가 요청에 따라 저장 보호 준비와 서버 PASS 성공이 확인된 즉시 요청별 알림을 표시하고 해당 폼을 닫는다. 첫 목록/본문/위키 처리는 계속하며, 거절/취소/다른 요청과 늦은 성공은 폼을 닫거나 성공으로 표시하지 않는다. 상세와 실제 UI 증거는 [POP3 후속](../../packages/nubi-desktop/docs/POP3-CONNECTION-READY-2026-10-23.md)에 기록했다.
