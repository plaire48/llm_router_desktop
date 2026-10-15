# 1.2.8 설치와 사내 업데이트 배포

## Windows 사용자

Nubi-Workspace-beta-1.2.8-x64-Setup.exe를 실행해 설치합니다. 기존 누비 앱은 종료하고 설치하세요. 기존 설정과 프로젝트 기록은 같은 앱 저장 위치를 사용합니다.

## 사내 배포 담당자

사내 PC에서 설치파일, Publish-NubiUpdate.ps1, release-notes.txt를 같은 폴더에 저장하세요.

```powershell
gh auth login --hostname code.sdsdev.co.kr
.\Publish-NubiUpdate.ps1 -Installer .\Nubi-Workspace-beta-1.2.8-x64-Setup.exe -Version 1.2.8 -NotesFile .\release-notes.txt
```

스크립트가 Manufacturing-IT/nuri의 버전별 Release에 EXE를 올리고 해시를 검증한 뒤 latest/windows-x64.json을 갱신합니다. EXE를 latest 폴더에 직접 넣지 않습니다.

앱은 사내 GitHub 연결로 새 버전을 확인하며, 최신 버전일 때 다운로드 아이콘을 숨깁니다. 새 버전이 있으면 AI Workspace 위의 업데이트 아이콘을 눌러 다운로드/설치/재실행합니다. 진행 작업과 미저장 파일은 먼저 마무리해야 합니다.

GitHub.com 릴리즈와 사내 nuri 배포는 별개입니다. 이번 외부망 릴리즈가 nuri/latest를 자동으로 변경하지 않습니다. 자세한 내용은 WINDOWS-UPDATE-DEPLOYMENT.md를 참고하세요.

## 1.2.8 메모

- 설치 파일 크기와 SHA-256은 함께 배포하는 설치 파일 및 `.sha256` 파일에서 확인합니다.
- 1.2.7을 설치한 PC도 1.2.8로 업데이트됩니다.
- 첨부 읽기가 켜져 있어 설치판에 문서 읽기 파일(document-extract, pdf.worker, office-document.ps1)이 포함됩니다.

## 같은 1.2.8의 수정 빌드

2026-10-16 수정 빌드는 별도 GitHub Release 태그와 빌드 번호로 구분합니다. 설치파일의 제품 버전은 요청에 따라 1.2.8을 유지합니다. 이미 1.2.8을 설치한 PC에는 새 버전 아이콘이 나타나지 않으므로, 새 릴리즈의 EXE를 직접 실행해 재설치하세요. 설치 전 앱을 종료하고 파일의 SHA-256과 해당 릴리즈의 값을 확인합니다.

사내 `nuri/latest`가 아직 1.2.7 이하인 경우 위 스크립트로 1.2.8을 배포할 수 있습니다. 이미 사내에 1.2.8을 배포했다면 스크립트는 같은 버전 덮어쓰기를 거절합니다. 기존 Release 자산이나 해시를 바꾸지 말고 이번 EXE를 수동 재설치하거나 후속 버전으로 배포해야 합니다.
