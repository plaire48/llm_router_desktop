# 누비 Workspace의 Windows 11 앱 실행과 제어

2026-09-23. 아래는 최초 조사 기록이다. 이후 실험적 winapp 화면 제어, 로컬 EXE 실행 승인, 값 대조와 Wiki 결과 연결을 구현했다. 현재 구현과 제한은 [COMPUTER-USE.md](../../packages/nubi-desktop/docs/COMPUTER-USE.md)를 따른다. Windows 바이너리 설치와 실제 Windows 11 및 사내 프로그램 검증은 아직 수행하지 않았다.

## 최초 조사 시점의 결론과 구현

프로그램 실행, 창 선택, UI 조회, 입력과 버튼 동작, 실제 결과 확인을 누비 작업에 연결할 수 있다. 기존 Pi 실행기와 OpenWiki 근거, HITL, 실행 기록을 유지하고 Windows 도구 실행 계층을 추가하는 방향을 권장한다.

현재 `packages/nubi-desktop/runtime/processes.mjs`에는 Windows PowerShell과 설치된 Git Bash 탐색, 사용자 승인 명령 실행, 로그/중지 경로가 있다. 이는 Windows용 코드 경로이며 이 Mac에서 실제 Windows 동작을 검증한 증거는 아니다. 셸 종료 코드가 앱 창 표시나 업무 완료를 보장하지 않는다. 앱 목록, PID/창 바인딩, UI Automation 조회/입력, GUI 결과 검증은 아직 없다.

## 공식 사례에서 취할 점

- [OpenAI Computer Use](https://learn.chatgpt.com/docs/computer-use): 지원 지역의 ChatGPT Work/Codex에서 macOS와 Windows를 지원한다고 명시한다. 구조화된 연결을 우선하고 앱별 접근을 관리한다. Windows에서는 활성 데스크톱 전경 조작이므로 동일 세션에서 사용자와 동시에 작업하는 것으로 설명하지 않는다. 누비에서는 앱 사용 범위와 작업 실행 승인을 분리하는 설계에 참고한다. 이 제품의 Computer Use 구현을 누비에 재배포할 수 있는 OSS SDK라고 가정하지 않는다.
- [Anthropic 데스크톱 사례](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork): 연결 도구, 브라우저, 화면 조작 순으로 적절한 방법을 선택한다. 현재 문서는 Windows/macOS의 Claude Desktop에서 Cowork와 Claude Code의 computer use를 설명한다. 누비에서도 Excel은 Office 도구, 웹은 브라우저 도구를 먼저 사용한다.
- [Anthropic API 실행 방식](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool): 모델이 도구 동작을 요청하고 애플리케이션이 실행 결과를 돌려주는 관찰/실행 반복을 참고한다. 공개 참조 환경은 Linux Docker 예제이므로 Windows 실행기로 그대로 사용할 수 없다. 모델이 동작을 끝냈다는 선언과 업무 검증 성공은 분리한다. 공개 소스가 있다는 이유로 Claude 전용 도구 계약이 사내 모델에 그대로 작동한다고 가정하지 않는다.
- [Microsoft UFO²](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/overview.md): UIA, Win32, Office COM과 필요할 때의 시각 인식을 조합하는 구조를 참고한다. 별도 AgentOS 전체를 누비에 이중 탑재하지 않고 앱에 맞는 도구 선택과 증거 연결에 활용한다.

## 오픈소스 후보 비교

| 후보 | 라이선스 | 확인한 강점 | 누비에서의 판단 |
|---|---|---|---|
| [Microsoft winapp CLI](https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md) | MIT | UIA 조회/값 읽기, JSON 출력, 창 지정, 명시적 invoke 동작, 데스크톱 동작 조정 | 첫 Windows PoC 우선 후보. Public Preview이므로 버전과 바이너리 해시 고정 및 실제 `--help` 기능 확인 필요 |
| [FlaUI](https://github.com/FlaUI/FlaUI) | MIT | .NET의 UIA2/UIA3 접근과 프로세스 Launch/Attach | 제품용 Windows 실행기를 작게 번들할 때 후보. WinForms/WPF별 backend 적합성과 사내 컨트롤 호환성을 실측해야 함 |
| [Microsoft UFO](https://github.com/microsoft/UFO) | MIT | 앱 전용 API와 화면 제어의 결합, 업무 분해와 앱별 실행 구조 | 설계 참고. Pi와 중복되는 모델 실행/상태 관리 전체 도입 보류 |
| [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | MIT | MCP로 Windows 앱과 화면을 빠르게 연결, 소스에 argv 분리 실행 경로 존재 | 비교 PoC 후보. 전체 도구를 기본 노출하지 않음. Python 배포와 한국어 앱 탐색 검증 필요 |

Windows-MCP README는 영어 Windows 권장과 App 도구 제한을 명시한다. 실제 `tools/app.py`에는 시작 메뉴 이름 실행과 별도로 `launch_executable`이 있어 실행 파일 경로와 argv를 분리할 수 있다. 따라서 한국어 앱 실행 전체가 불가능하다고 단정하지 않는다. 이 경로의 실제 한글/공백 인수와 MSIX 앱 동작을 확인해야 한다. README의 Python 3.13+와 고정 소스 `pyproject.toml`의 3.14 이상 선언도 다르므로 배포 버전 의존성을 확정하기 전 번들하지 않는다. 기본 telemetry 설정도 패키징 시 확인 대상이다.

FlaUI의 UIA3는 모든 WinForms 컨트롤에서 UIA2보다 낫다는 보장이 없다. 대상 앱에서 정보가 누락되면 backend 비교 후 선택한다. 이름 대신 AutomationId/ControlType과 창 범위로 대상을 식별하고, 여러 항목이 일치하면 사용자 선택 또는 재조회로 좁힌다.

## 검토한 실제 소스

원문, 라이선스, GitHub 메타데이터를 `packages/nubi-desktop/verification/research-windows/`에 보존했다. 내려받은 코드를 실행하거나 제품에 포함한 것은 아니다.

| 저장소 | 고정 커밋 |
|---|---|
| microsoft/winappCli | `f047f86761d880bf850148744a1ddacecf00bc65` |
| FlaUI/FlaUI | `fd7cc64ab01908a0ae4cc7d05e704caa34f98d16` |
| microsoft/UFO | `e2a03126241c696fdaf9a669a271ca3fca6d9916` |
| CursorTouch/Windows-MCP | `787385ec5f9688b0e24f9759b3d505d7084ba80b` |

winapp의 `UiInvokeCommand.cs`, `UiGetValueCommand.cs`, `UiCoordinatedAction.cs`와 FlaUI `Application.cs`, Windows-MCP `tools/app.py`를 확인했다. 특히 winapp 기본 invoke는 패턴/상위 요소 fallback이 있을 수 있다. 누비 어댑터에서는 관찰한 대상을 다시 식별하고 명시적 `--action`을 사용해야 한다. 최신 main 문서의 기능이 특정 배포판에 포함됐다는 의미는 아니다.

## 누비 연결 제안

### 도구 선택

1. 빌드, 의존성 확인, 로컬 서버: 기존 셸 실행기.
2. Excel 문서와 셀: 기존 누비 Office의 COM 도구와 readback.
3. 웹 화면: 기존 누비 Chrome/Playwright 경로.
4. 일반 Windows 업무 앱: UIA를 통한 창/컨트롤 조회와 명시적 동작.
5. UIA로 읽을 수 없는 custom canvas: 대상 창 캡처와 시각 모델을 통한 제한된 좌표 조작.

구조화된 UI 정보는 이미지 입력이 없는 모델도 도구 호출로 사용할 수 있다. 이미지 fallback은 실제 선택 모델의 이미지 입력과 화면 위치 판단 능력을 별도로 평가한다. 사내 모델의 해당 능력을 현재 구현 사실로 가정하지 않는다.

### 실행과 기록

제안하는 최소 도구는 `list_apps`, `launch_app`, `inspect_window`, `invoke_element`, `set_value`, `verify_result`다. 아직 제품에 등록된 도구 이름은 아니다.

- 실행 파일 경로 또는 패키지 앱 ID와 분리된 argv로 시작한다. 시작 메뉴 표시 이름만으로 앱을 추측하지 않는다. 후보가 여러 개면 기존 객관식/주관식 폼으로 묻는다.
- 앱 ID, PID, 프로세스 시작 시각, HWND와 관찰 ID를 작업에 묶는다. PID/HWND가 재사용될 수 있으므로 하나의 숫자만으로 새 동작을 승인하지 않는다.
- 승인한 앱과 작업 범위 안에서 단계별로 진행한다. 매 클릭마다 질문하지 않고 새 앱/범위 변경과 외부 반영 등 필요한 지점에 기존 HITL을 연결한다.
- 관찰 → 한 동작 → 실제 값/상태 확인으로 진행한다. 시각 차이는 기능 성공을 대신하지 않는다. 창이 바뀌거나 사용자 입력이 개입하면 다시 관찰한다.
- 창 전환과 전경 입력은 하나의 실행자가 담당한다. 기존 하위 분석은 읽기 전용 분석에 사용한다. 둘 이상의 에이전트가 같은 세션의 마우스/키보드를 동시에 조작하지 않는다.
- 실행 응답이 끊기면 PID/창/파일/업무 상태를 조회한다. 앱 시작이나 제출을 맹목적으로 재전송하지 않는다. 일부 쓰기의 결과를 판단할 수 없으면 확인 필요로 보존한다.
- A2A에는 요구사항 ID, 소스/Wiki 버전, 대상 앱 정보, 검사 시나리오와 결과 근거를 연결한다. 앱 제어 권한 자체를 A2A 메시지가 부여하지 않는다. Office와 Chrome은 기존 실행기와 승인을 유지한다.

사용자 화면은 기존 채팅에 ‘대상 앱 확인 → 실행 중 → 결과 확인’만 추가하는 구성이 적합하다. 앱 선택과 필요한 승인은 기존 폼을 쓰고, 세부 창/도구 로그는 펼쳐 볼 수 있게 둔다.

## Windows 11 검증 범위

최초 검증은 일반 권한의 한국어 Windows 11에서 메모장 실행과 새 파일 저장, 계산기 값 읽기, 실제 사내 업무 앱의 조회 흐름으로 진행한다. 같은 작업을 반복해 잘못된 창 조작, 파일 덮어쓰기, 중복 실행과 요구사항 누락을 확인한다. 배포 대상 x64/ARM64, 앱 MSIX/Win32 여부, 100/150/200% DPI, 다중 모니터, 중복 창 제목, 최소화/잠금/RDP 연결 변화를 각각 기록한다.

[Windows UIPI 문서](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/desktop-flows/ui-automation/uipi-issues)가 설명하는 권한 수준 차이와 UAC는 자동 우회하지 않는다. 전경 입력의 경우 화면 잠금과 사용자 조작을 작업 조건으로 다룬다. 독립 실행이 필요하면 별도 Windows VM이 적합하다. Windows Sandbox는 앱 설치/SSO/라이선스와 지원 에디션을 확인한 후 선택하며 일반 사내 PC에서 항상 가능한 기능이라고 가정하지 않는다.

최초 조사 당시에는 문서/소스 검토와 누비 연결 설계까지 완료했다. Windows에 패키지 설치, 임의 앱 실행 또는 조작 도구 자동 활성화는 하지 않았다. 이 환경의 Mac 빌드나 합성 검사를 Windows 앱 제어 성공으로 보고하지 않는다.
