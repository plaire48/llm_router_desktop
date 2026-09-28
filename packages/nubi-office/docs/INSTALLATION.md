# 누비 Office 설치

Windows Office 2016용 추가 기능입니다. 하나의 EXE에서 Excel, Word, PowerPoint를 선택합니다.

1. [다운로드 페이지](https://github.com/plaire48/ai_workspace/releases/tag/nubi-office-v0.8.4)에서 **Nubi-Office-0.8.4-Setup.exe**를 받습니다. 저장소 접근 권한이 있는 GitHub 계정으로 로그인해야 합니다.
2. Office 앱을 모두 닫고 받은 파일을 실행합니다. 사용할 앱을 선택하고 **설치**를 누릅니다.
3. 완료되면 선택한 Office 2016 앱에서 문서를 열고 **누비 → 누비 열기**를 누릅니다.
4. 오른쪽 작업창에서 AI Pro 로그인 또는 기존 누비 연결 방식을 선택합니다. 모델 목록에서 실제 제공되는 Qwen 3.8 27B 모델을 선택하고 작업을 요청합니다.

ZIP 압축 해제, 명령어 실행, 개발 도구 설치, XML 수동 등록은 사용자 설치 절차에 포함되지 않습니다.

0.8.4는 Windows 설치 검사를 완료한 사전 배포판입니다. 로컬 Python 스킬은 처음 사용할 때 환경 설치를 승인하면 Python 3.12와 고정 패키지를 누비가 준비합니다. 코드 실행과 문서 반영/저장 승인은 별도입니다. Python 환경은 사용자 권한으로 실행되며 OS 샌드박스가 아닙니다. 최초 준비에는 다운로드 연결이 필요합니다.

## PC 조건

- Windows 10/11, 사용할 Office 2016 앱 32비트 또는 64비트, .NET Framework 4.7.2 이상.
- 설치 시 관리자 권한이 필요합니다. 회사에서 설치 권한을 제한하면 IT 담당자가 배포해야 합니다.
- Node 실행 파일은 포함됩니다. VSTO Runtime은 필요할 때 동봉한 Microsoft 설치 파일로 설치합니다. WebView2가 없으면 동봉한 Microsoft bootstrapper가 다운로드하므로 인터넷 연결이 필요합니다.
- 사전 배포판 EXE에는 공인 배포자 코드 서명이 없습니다. 회사 정책에서 차단되면 보안 정책을 해제하지 말고 담당자에게 전달합니다.

## 누비 메뉴가 보이지 않으면

사용할 Office 앱을 다시 시작합니다. **파일 → 옵션 → 추가 기능 → 관리: COM 추가 기능 → 이동**에서 **Nubi Office**가 있는지 확인합니다. 등록이 없거나 로드 오류가 있으면 설치 파일 버전과 오류 화면의 문구를 확인합니다. Office 보안 설정이나 다른 추가 기능을 해제하지 않습니다.

## 제거

Windows **설정 → 앱 → Nubi Office → 제거**를 사용합니다. 작성한 문서와 사용자 데이터는 삭제하지 않습니다. 공유 Microsoft 실행 구성요소는 다른 프로그램에서도 사용하므로 제거하지 않습니다.

## 검증 범위

릴리스의 `installer-verification.json`은 Windows Server 2022 빌드 환경에서 실제 EXE 설치, 파일 해시, Excel/Word/PowerPoint 선택 설치와 레지스트리 등록, x86/x64 번들 worker, 재설치와 제거를 확인한 기록입니다. **Office 2016 프로그램을 실행한 검증이나 실제 회사 로그인/모델 정확도 검증은 아닙니다.** Windows 11 PC에서 직접 설치한 검사, Office 2016 실행과 회사 연결 검증은 남아 있습니다.

## 배포 구조와 근거

Inno Setup이 관리자 권한으로 Program Files에 배치하고 선택한 Office 앱의 32/64비트 등록 위치에 VSTO manifest를 연결합니다. VSTO bootstrap 코드는 기존 Office AI Agent에서 가져왔고 Nubi 호스트·UI·agent는 그대로 사용합니다. 인증서 신뢰 저장소나 Office 정책을 변경하지 않습니다. 미리보기 manifest의 자체 서명은 파일 무결성용이며 공인 배포자 인증을 의미하지 않습니다.

- [Microsoft: VSTO 배포 구성요소와 등록](https://learn.microsoft.com/en-us/visualstudio/vsto/deploying-a-vsto-solution-by-using-windows-installer)
- [Microsoft: VSTO 신뢰와 Program Files](https://learn.microsoft.com/en-us/visualstudio/vsto/trusting-office-solutions-by-using-inclusion-lists)
- [Microsoft: WebView2 배포와 설치 확인](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Inno Setup: 레지스트리 등록](https://jrsoftware.org/ishelp/topic_registrysection.htm)

작업 위치는 실제 문서 선택/스크롤로 표시합니다. 채팅의 **작업 위치와 화면 → 화면 보기**에서 현재 실행이 남긴 캡처를 볼 수 있습니다. 캡처와 읽기 전용 검토는 보이는 화면에 한정하며 저장/암호화 검증을 대신하지 않습니다. `installer-view.json`은 실제 Windows WinForms 창 관찰 검사이며 Office COM 검사와 다릅니다.

AI 커서는 사용자 마우스와 별도로 표시됩니다. 실제 클릭/선택/스크롤은 Office API와 지원되는 UI Automation 패턴으로 실행합니다. 드래그, 물리 호버 메뉴, 범용 키보드 입력은 지원하지 않습니다. Office의 문서 선택과 스크롤 상태는 사용자와 공유합니다.
