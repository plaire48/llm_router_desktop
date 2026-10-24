# 프로젝트 이동과 실행 수명 분리 — 2026-10-24

서버가 실행 중이어도 다른 프로젝트나 개인 공간을 바로 선택한다. 화면 선택과 실행 중지는 별개다. 원래 프로젝트로 돌아오면 같은 프로세스와 터미널 출력, 대화와 미전송 초안을 이어서 본다. 이 사용자 결정은 같은 날 앞서 적용한 기본 이동 시 자동 종료 정책을 대체한다.

## 원인과 반영

`main.cjs`의 `openProject`가 기본 `stopCurrent=true`여서 이동마다 모든 실행 중지와 PTY 종료를 기다렸다. 종료 확인이 늦으면 이동도 보류됐다. 기존 `ProjectServices`는 프로젝트마다 root/store/agent/process를 소유하므로 이를 파괴할 필요가 없다.

- 정상 이동의 기본값을 `stopCurrent=false`로 바꿨다. 기존 서비스의 root/store를 바꾸거나 재생성하지 않고 선택한 서비스만 바꾼다. 명시적 중지와 종료 미확정 보호 경로는 유지한다.
- 기존 프로젝트별 파일/터미널 탭 보관을 재사용하고 마지막 터미널 화면도 복원한다. 화면에서 빠질 때 PTY는 detach하며 출력은 기존 256 KiB replay 한도 안에 보관한다. 재진입은 같은 sessionId로 연결한다. 새 프로젝트에 이전 터미널을 붙이지 않는다.
- backgroundProjects에 실제 실행 중/시작 중인 명령 수와 해당 프로젝트의 열린/준비 중인 PTY 수를 표시한다. AI 실행, 확인 대기, 명령 실행과 터미널 열림을 기존 상태 아이콘으로 구분한다. 서버만 실행 중이라는 이유로 모델 선택을 잠그지 않는다.
- 백그라운드 명령/터미널이 있는 프로젝트의 목록 제거는 UI와 호스트에서 차단한다. 앱 업데이트, 실행 중지/정리, 출력/세션 한도와 인증 변경 보호를 유지한다.
- 저장하지 않은 파일과 Wiki 초안의 기존 보호를 유지한다. 같은 프로젝트 선택, 선택창 취소와 없는 대상은 기존 실행에 영향을 주지 않는다.

## 참고한 방법론

[Codex App Server](https://learn.chatgpt.com/docs/app-server)는 thread의 background terminal 목록/개별 terminate와 turn interrupt를 별도 동작으로 제공한다. [공개 UnifiedExec process manager](https://github.com/openai/codex/blob/main/codex-rs/core/src/unified_exec/process_manager.rs)는 살아 있는 프로세스 ID로 후속 출력/입력을 연결한다.

[Claude Desktop 세션](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions)은 독립 문맥/프로젝트에서 여러 세션을 진행한다. [background Bash](https://code.claude.com/docs/en/interactive-mode#background-bash-commands)는 명령 ID와 출력을 추적하면서 다음 요청을 처리한다.

이 실행 소유권과 화면 선택 분리 원칙을 기존 누비 구조에 적용했다. 다른 제품의 비공개 Desktop 소스나 엔진을 복사한 변경은 아니다. 외부 앱/Office/SSO의 동시 조작 품질을 이 검사로 인증하지 않는다.

## 검증

수정 전 실제 Electron에서 이동이 `stopping`을 거쳐 모델 HTTP 연결과 PTY 서버를 종료하는 것을 재현했다. Node 검사에서도 백그라운드 명령 수가 상태에 나타나지 않았다.

후속 집중 검사 63개가 통과했다. 실제 HTTP 서버의 프로젝트 소유권, B에서 A의 processId 조회 거절, 재진입과 명시적 stop, 동시 AI와 독립 store/답변, 계정 변경 차단과 명시적 종료/미확정 계약을 확인했다.

`check-project-background-sessions.mjs`의 실제 macOS Electron/PTY 검사는 격리된 프로젝트와 의도적으로 열린 합성 모델 연결을 사용한다. 선택창 취소, A의 실제 HTTP 서버/모델을 유지한 B 이동, B의 별도 cwd/터미널, A 재진입의 동일 PID/출력/초안, 명시적 Ctrl+C/대화 Stop, 프로젝트 제거 차단과 원본 파일 보존의 7개 흐름을 통과했다. `check-navigation-stop.mjs`의 예전 실행 이름도 최신 정책 검사로 연결한다.

자료는 무시된 `verification/project-background-sessions-2026-10-24/`에 보관한다. 로컬 이동 시간은 Windows 성능 수치가 아니다. 소스 main, CI, 설치판 배포와 실제 Windows/회사 계정/실모델 품질은 별도다. 앱 종료나 비정상 실행기 재시작 뒤의 프로세스 생존을 약속하는 변경도 아니다.
