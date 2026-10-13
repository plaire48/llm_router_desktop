# 누비 Workspace Beta 1.1.3 설치와 업데이트

## 일반 사용자

1. 릴리즈의 `Nubi-Workspace-beta-1.1.3-x64-Setup.exe`를 다운로드합니다. Windows x64용입니다.
2. 누비에서 진행 중인 작업을 마치고 편집한 파일을 저장합니다.
3. EXE를 실행하여 이용 안내를 확인하고 설치합니다. Node, Python, Git을 따로 설치할 필요는 없습니다.
4. 누비가 열리면 사용할 AI에 연결하고 프로젝트를 선택합니다. Claude 연결에는 별도로 설치한 공식 Claude Code CLI가 필요합니다. 기존 npm 또는 Windows 네이티브 설치를 자동 탐색합니다.

공인 배포자 서명이 없는 Beta입니다. Windows 보안 경고나 회사 설치 정책이 차단하면 정책을 해제하지 말고 사내 관리자에게 확인하세요.

### 이후 업데이트

사내 관리자가 아래 배포를 완료하면, 사내망에서 앱의 **사내 Github SSO**로 로그인합니다. 앱은 시작할 때와 매시간 새 버전을 확인합니다. **설정 → 업데이트 확인**으로 바로 조회할 수도 있습니다.

- 새 버전: 왼쪽 **AI Workspace 바로 위의 원형 다운로드 아이콘**을 누릅니다. 다운로드 %와 파일 크기, 계산 가능한 경우 남은 시간을 표시합니다. 검증 후 자동 설치하고 재실행합니다.
- 최신 버전: 원형 다운로드 아이콘을 숨깁니다. 설정에는 **최신 버전이에요.**가 표시됩니다.
- 진행 중인 작업, 열린 터미널, 저장하지 않은 파일이 있으면 설치를 보류합니다. 작업을 마친 뒤 다시 시도합니다.
- 이 업데이트 기능이 없는 예전 설치판은 EXE로 한 번 설치해야 합니다.

## 사내 배포 담당자

사내 PC에서만 진행합니다. `Manufacturing-IT/nuri`에 Release 및 Contents 쓰기 권한이 필요하며, GitHub CLI의 사내 로그인을 사용합니다.

같은 폴더에 다음 파일을 저장합니다.

- `Nubi-Workspace-beta-1.1.3-x64-Setup.exe`
- `Publish-NubiUpdate.ps1`
- `release-notes.txt`

```powershell
gh auth login --hostname code.sdsdev.co.kr
.\Publish-NubiUpdate.ps1 -Installer .\Nubi-Workspace-beta-1.1.3-x64-Setup.exe -Version 1.1.3 -NotesFile .\release-notes.txt
```

스크립트가 EXE를 nuri의 버전별 Release에 올리고, 다시 받아 SHA-256을 검증한 후 **`latest/windows-x64.json`**을 생성하거나 갱신합니다. `assetId`, 크기, 해시는 자동으로 채워집니다. 같은 JSON이 EXE 옆에도 저장됩니다.

**`nuri/latest`에는 `windows-x64.json`만 관리합니다. EXE는 Releases에 보관합니다.** 인증값이나 프로젝트 소스를 JSON에 넣지 않습니다. 같은 버전의 EXE를 다른 내용으로 덮어쓰지 말고 수정본은 더 높은 버전으로 배포합니다.

배포 뒤 이전 버전의 사내 Windows PC에서 SSO 로그인 → 업데이트 확인 → 원형 아이콘 → 다운로드 → 재실행을 확인합니다. 같은 버전에서는 아이콘이 사라져야 합니다. 실제 사내 GHES 업로드 및 사용자 PC 업데이트는 이번 외부 Windows 빌드 검사와 별도입니다.

상세 설정과 오류 안내는 `WINDOWS-UPDATE-DEPLOYMENT.md`, 검증 범위는 `QUALITY-RELEASE-1.1.3.md`를 참고하세요.
