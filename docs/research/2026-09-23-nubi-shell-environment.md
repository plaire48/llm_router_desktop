# 누비의 Bash 중심 실행 환경과 도구 연결

2026-09-23. 조사·설계 반영이며 Windows shell 실행기 구현/검증 결과가 아니다. [IDE 기반 선택](2026-09-23-nubi-ide-foundation.md)에 이어지는 실행 계층 명세다.

## 권고

**Bash를 적극적으로 사용하는 실행 환경을 핵심 기능으로 둔다.** 기본 Windows 제품은 Git Bash와 Windows 도구를 사용하고, Linux 프로젝트에는 WSL2 profile을 선택할 수 있게 한다. PowerShell은 Windows 전용 도구의 정상 경로로 유지한다. WSL2/Docker 설치를 앱 사용의 필수 조건으로 만들지 않는다.

가장 중요한 것은 shell 명칭보다 **누비가 명령을 실행하고, 결과를 읽고, 실패를 고치고, 다시 검증하는 루프**다. Git·rg·테스트·빌드·개발 서버를 모두 새 MCP 도구로 다시 구현하지 않고 기존 CLI를 활용한다. IDE의 미저장 버퍼 편집, 브라우저 관찰, 승인, 실행 영수증에는 구조화된 전용 계약을 유지한다.

```text
Theia IDE / 누비 UI
        ↕ 파일 선택·진단·diff·실행 이벤트
Nubi Worker (Pi / 요구·문맥·분석·검토)
        ↕ 권한·환경·취소·영수증을 갖는 Tool Broker
 ┌──────────────┬──────────────────┬─────────────────┐
 │ CLI 실행     │ IDE / Browser    │ API / MCP       │
 │ Bash / pwsh  │ 버퍼·diff·관찰   │ OpenWiki·사내도구│
 │ Git·rg·test  │ 실행 화면 검증   │ 필요한 도구만   │
 └──────────────┴──────────────────┴─────────────────┘
```

## 공식 제품과 오픈소스에서 확인한 BP

| 근거 | 확인한 방식 | 누비 적용 |
|---|---|---|
| [Claude Windows setup](https://code.claude.com/docs/en/setup#set-up-on-windows) | 네이티브 Windows와 WSL 선택. Git for Windows가 있으면 Bash, 없으면 PowerShell. 현재 문서는 Git 설치를 필수로 두지 않음 | shell을 하나로 가정하지 않고 프로젝트 profile과 실제 경로를 기록 |
| [Claude sandbox](https://code.claude.com/docs/en/sandboxing) | shell 실행과 OS 파일/네트워크 경계를 분리. WSL2 지원 조건과 native Windows 제한 명시 | “Bash가 있으니 격리됨”으로 표시하지 않음. 환경별 검증한 능력만 광고 |
| [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox) | elevated와 unelevated 실행 경로, 각각 다른 OS 권한/네트워크 경계 | 관리자 정책과 실제 보장 수준을 구분. 일반 node spawn에 동일한 보장을 주장하지 않음 |
| [VS Code terminal profiles](https://code.visualstudio.com/docs/terminal/profiles) | 사용자 터미널 profile과 tasks/debug automation profile을 나눔 | 사람이 쓰는 terminal은 유지하고 Agent용 자동화 profile은 재현 가능하게 별도 정의 |
| [Pi](https://github.com/earendil-works/pi) 실제 bash/shell 소스 | shell 탐색, spawn, AbortSignal, 프로세스 트리 종료, 제한된 출력/출력 저장 | 기존 Pi loop에 실행 port를 붙이고 출력·취소·복구 패턴을 재사용 |

따라서 “Bash를 거쳐야만 도구를 쓸 수 있음”이 아니라 “보편적인 개발 작업은 CLI를 바로 활용하고 IDE/브라우저의 상태가 중요한 일은 그 상태를 아는 도구를 사용함”을 기본으로 한다.

## 실행 profile

| profile | 쓰임 | 경로·도구·설치 판단 |
|---|---|---|
| **Windows + Git Bash** | Windows 폴더의 React/Node·Git·일반 CLI | Git for Windows의 검증된 bash.exe 경로. 제품 배포에서는 고정 portable toolchain을 묶는 방향을 우선 검증. 단일 bash.exe 복사로 끝내지 않음 |
| **Windows + PowerShell** | .NET/MSBuild, Windows 관리·네이티브 명령 | 기존 pwsh/powershell의 명시적 경로와 인자, profile 비활성 automation 설정. Bash 실패를 그대로 PowerShell에 재전송하지 않음 |
| **WSL2 + Bash** | Linux 전용 빌드, Linux CI와 같은 도구, Linux sandbox가 필요한 작업 | 사용자/회사에서 허용한 기존 distro. 새 설치/기능 활성화/재부팅은 자동 수행하지 않음. 저장소·worker·도구를 Linux 측에 같이 둠 |
| Dev Container | 팀의 toolchain 이미지가 이미 관리되는 경우 | P1 옵션. 컨테이너 엔진·라이선스·회사 정책과 리소스 비용이 추가되어 초기 필수 경로에서 제외 |

[Git for Windows](https://gitforwindows.org/)는 Bash 환경을 제공한다. 배포할 때는 shell, Git, MSYS runtime과 도구의 개별 라이선스·고지·대응 소스 제공 조건을 검토한다. 설치 파일의 다운로드/해시만 통과했다고 사내 PC에서 실행됐다고 보고하지 않는다.

[MSYS2 경로 문서](https://www.msys2.org/docs/filesystem-paths/)에 따라 `/c/...`, Windows drive path, native 프로그램 인자 변환을 구분한다. `MSYS2_ARG_CONV_EXCL` 등 override는 검증한 명령별로 좁게 적용하고 전체 프로세스에 무조건 켜지 않는다. WSL은 Windows와 Linux 경로를 별도 URI로 취급하고 문자열 치환으로 바꾸지 않는다. [Microsoft의 파일시스템 지침](https://learn.microsoft.com/en-us/windows/wsl/filesystems)에 맞춰 Linux 도구의 저장소는 Linux 파일시스템 사용을 우선 검증한다.

## 실행 도구 계약

| 기능 | 계약 |
|---|---|
| `exec` | envProfile, workspaceId, command/argv 또는 script, cwd, timeout 정책, network/filesystem policy를 받음. 호스트가 환경과 실행 가능성을 결정 |
| `poll` | running sessionId, output cursor로 이후 출력만 읽음. 원래 명령을 재실행하지 않음 |
| `stdin` | 실제 interactive session에만 입력. 읽은 prompt와 요청 범위를 확인. 비밀 입력은 진단 기록에서 제외 |
| `cancel` | 소유 세션/프로세스 트리에만 취소 전파. 부분 파일 변경은 보존하여 이후 readback |
| `read_output` | 크고 완결된 로그를 artifact ID와 검색/범위로 읽음. 원문 전체를 매 모델 호출에 넣지 않음 |

이는 새 public API 제안이다. 존재하는 도구 이름처럼 구현 코드에서 가정하지 않는다.

권고 실행 방식:

- 단발 git/rg/test는 가능한 한 실행 파일+인자 배열로 실행한다. pipeline/glob/조건 분기가 필요하면 명시적인 Bash script를 사용한다. untrusted 파일명·검색어는 별도 인자/입력으로 전달하고 shell 코드에 문자열 결합하지 않는다.
- 자동화 Bash는 환경을 통제한 `--noprofile --norc` 경로를 우선 검증하고 `BASH_ENV`, startup hook, PATH를 명시적으로 정한다. 프로젝트가 필요한 환경은 profile에 선언한다. interactive terminal은 사용자가 선택한 profile을 존중한다.
- 비대화형 실행과 interactive PTY를 분리한다. PTY가 없으면 안 되는 도구만 ConPTY를 사용한다. 실제 exit code와 signal/timeout/취소 상태를 구조화해 돌려준다.
- 각 명령은 명시적 cwd/env를 갖는다. 전역 `cd` 상태에 의존하지 않는다. 지속 세션이 필요하면 task/worktree/profile에 묶고 UI에도 동일하게 표시한다.
- 첫 출력부터 실제 진행 이벤트를 표시한다. 끝나지 않은 실행은 running으로 유지하고 pending prompt/입력 요청을 드러낸다. 모델의 완료 문구로 process 종료를 대신하지 않는다.
- 테스트와 dev server는 다르게 관리한다. dev server는 종료하지 않아도 ready일 수 있으며, port 응답+실행 소스+readiness 조건을 확인한다.
- 변경을 일으키는 실행은 한 worktree에서 직렬화한다. 독립적인 읽기만 제한적으로 병렬화한다. 하위 분석에 unrestricted Bash를 주면 읽기 전용 약속이 깨지므로 읽기 전용 데이터/도구만 제공한다.
- 출력은 head/tail 요약, 전체 artifact, truncation 이유/bytes, cursor를 함께 제공한다. stdin 비밀과 민감 env를 로그에 남기지 않는다. tool 결과는 자료이며 추가 권한을 주는 지시가 아니다.

`rg` 검색 성공, test exit 0, dev server ready, 실제 기능 검증, 사용자 최종 반영을 따로 기록한다. 테스트 실행 전에 얻은 코드 hash와 종료 후 hash가 다르면 해당 결과를 현재 코드의 검증으로 사용하지 않는다.

## IDE 편집과 Bash의 충돌 방지

미저장 버퍼가 있는 파일은 Bash의 sed/python/formatter로 우회 수정하지 않는다. 우선 IDE WorkspaceEdit 경로로 변경한다. formatter/codegen처럼 CLI가 파일을 변경해야 하면 대상 버퍼/디스크 version을 확인하고 허용된 파일을 저장하거나 충돌 해결을 받은 다음 실행한다. 종료 후 변경 목록을 재조회하고 IDE에 반영한다. 사용자의 입력을 잃지 않도록 undo와 변경 출처를 연결한다.

실행 실패 후 같은 Bash를 그대로 반복하지 않는다. 마지막 영수증, 실제 파일 diff, 프로세스 상태를 읽고 미완료만 다시 계획한다. 설치 command가 중간까지 수행되었다면 처음부터 무조건 재실행하지 않는다. 시간 제한은 한 프로세스의 자원 정책이며 원래 목표 포기를 뜻하지 않는다.

## 통신 표준과 도입 범위

| 도구 | 상태 | 판단 |
|---|---|---|
| [Pi coding-agent shell 구현](https://github.com/earendil-works/pi/blob/898ab804050730e9dcefb4443875d5a932aa6a32/packages/coding-agent/src/core/tools/bash.ts), MIT | 소스 참고·adapter 재사용 후보 | 브라우저용 pi-agent-core에는 OS shell 도구가 자동 포함되지 않음. 설치된 0.86.1과 최신 coding-agent API의 호환을 검증한 뒤 추출/의존성 판단 |
| [Git for Windows](https://github.com/git-for-windows/git) | 번들/검출 후보 | Windows Bash·Git 도구. 실제 portable 배포 구성 검증 필요 |
| [node-pty](https://github.com/microsoft/node-pty), MIT | Theia terminal 내부 구성 우선 재사용 | PTY/ConPTY 지원. native module ABI·cancel·프로세스 트리 종료 검증 |
| [ripgrep](https://github.com/BurntSushi/ripgrep), MIT/Unlicense | 재사용 권고 | gitignore를 존중하는 빠른 탐색. 전체 저장소를 모델에 싣는 방식 대체 |
| [ast-grep](https://github.com/ast-grep/ast-grep), MIT | 필요 시 추가 | 언어 구문 기반 범위 검색. LSP의 타입/참조 의미 분석을 대체하지 않음 |
| [sandbox-runtime](https://github.com/anthropics/sandbox-runtime), Apache-2.0 | WSL2/Linux 및 Windows alpha 비교 후보 | 현재 저장소는 Windows alpha와 번들 srt-win.exe를 명시. 별도 로컬 사용자/WFP/ACL 설정을 위한 최초 관리자 설치가 필요하므로 기본 앱 설치에 자동 포함하지 않음 |
| [Codex Windows sandbox](https://github.com/openai/codex), Apache-2.0 저장소 | 설계/소스 참고 | OS 수준 실행 경계 참고. Rust/native 통합·권한·정책 변경 부담이 있어 무검증 복사·자동 관리자 설정 금지 |
| [ACP](https://agentclientprotocol.com/get-started/introduction) | P1 연결 adapter 후보 | editor↔Agent 통신 표준. Theia 전용 port를 먼저 검증하고 여러 IDE 지원 시 adapter 추가. ACP가 shell sandbox나 모델 provider는 아님 |
| [MCP](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) | 기존 연결과 필요한 외부 도구에 한정 | Agent↔도구/자료. 로컬 shell/IDE 편집과 다른 책임. 모든 CLI를 MCP 서버로 감쌀 필요 없음 |

**실제 도입 상태:** 이번 턴에는 실행 환경을 설치하거나 shell/IDE 코드를 바꾸지 않았다. 위 선택과 계약을 제품 설계·개발 전달서·화면 시안의 실행 영역에 반영했다.

최신성 확인: Claude Code 제품 문서는 native Windows sandbox 미지원으로 설명하지만, 별도 sandbox-runtime 저장소에는 Windows alpha가 있다. 두 제품/출시 상태를 합쳐 표현하지 않는다. 0.0.77 package.json과 GitHub license는 Apache-2.0이다. Windows alpha의 사용자별 도구 접근, session 단위 ACL, 인증서/네트워크 제한을 시험하기 전에는 기본 배포로 채택하지 않는다. 회사 보안 정책이나 인증서 검증을 낮추는 우회책은 설계에 가져오지 않는다.

## 검증 매트릭스

첫 Windows spike는 같은 예제 프로젝트에서 Git Bash와 PowerShell을 검증한다. WSL2가 있는 별도 환경에서는 Linux profile을 비교한다.

필수 사례: 공백/한글/따옴표/달러가 든 경로, LF/CRLF, 유니코드 stdout, env 오염, shell startup script, 출력 폭주/잘림, interactive prompt, timeout과 cancel, 자식 dev server 잔류, port 충돌, 재시작, 미저장 버퍼, formatter와 사용자 편집 경합, 부분 실패 후 중복 수정 방지.

보안 검증은 지원한다고 선언한 profile에만 실시한다. project 밖 파일 쓰기, 네트워크 차단, 자식 프로세스, symlink/junction, WSL→Windows interop을 실제 시험한다. policy 검사만 있는 native profile을 OS sandbox라고 표시하지 않는다. 회사가 강한 격리를 요구하면 검증된 실행 profile이 준비될 때까지 그 권한의 자동 실행을 제공하지 않는다.

평가는 같은 과제의 도구 성공률, 거짓 완료, 복구율, 명령/파일 손상, 지연, 전체 모델 usage를 기록한다. 공개 프로젝트 인기도나 문서만으로 성능 점수를 주장하지 않는다.

## 직접 확인한 소스

Pi `898ab804050730e9dcefb4443875d5a932aa6a32`의 `packages/coding-agent/src/core/tools/bash.ts`와 `packages/coding-agent/src/utils/shell.ts`: spawn·AbortSignal·timeout·출력 제한, Windows Git Bash 경로 탐색과 PowerShell 경로 확인. 기존 누비는 pi-agent-core 0.86.1이므로 최신 코드를 호환 검증 없이 붙이지 않는다.
