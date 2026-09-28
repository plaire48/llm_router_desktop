# Nubi Office 0.8.4 검증 기록

검사일: 2026-09-23. Windows 전체 검사를 통과했습니다.

검증 소스: `ee460cd1c5b7f5e5401682e5c3508e50912e628d`.
[Windows 검사](https://github.com/plaire48/ai_workspace/actions/runs/35853445832).

## 변경

- 사용자가 제공한 HTML을 기준으로 공통 폰트, 색상, 모달, 입력 요소와 상태 표시를 통일했습니다. 문서명과 반영 범위는 선택적으로 강조하고, 설명과 결과 경로는 필요할 때 펼칩니다.
- UI 동일성 검사를 Windows 설치 빌드의 필수 단계로 추가했습니다. 첫 실행에서 드러난 Windows 캡처 저장 경로 오류를 `fileURLToPath`로 수정했습니다. 실패한 실행은 설치 파일 생성 전에 중단됐습니다.
- 공개한 0.8.3 EXE의 SHA256을 고정해 이전 버전 업그레이드를 검사합니다. 선택 앱 변경, 재설치, 제거 후 새 설치와 사용자 데이터 시험 파일의 내용 보존을 확인합니다.
- 기존 Pi, CX, Playwright, axe-core, Inno Setup과 VSTO를 사용했습니다. 새 제품 런타임 의존성은 추가하지 않았습니다.

## 검증 결과

- 소스 테스트 **493개**, native 계약 시나리오 **34개** 통과(COM 대역).
- 화면 **99개 조합**, 브라우저의 계획/승인/도구 실행/수정/readback/취소 흐름 통과(모델과 COM은 대역).
- Windows 실제 Python 설치/실행/오류 수정/취소/시간 초과와 32/64비트 ZIP/폴더 스킬 보호 저장 통과.
- **0.8.3 → 0.8.4 업데이트**, 앱 선택 변경, 재설치, 제거 후 새 설치/제거 통과. 사용자 데이터 시험 파일의 내용 보존 확인.
- 설치된 **28,591개 파일**의 SHA256 일치와 32/64비트 호스트/실행 엔진 실행 확인.
- 알려진 배포용 npm 의존성 취약점 0건(검사 시점 기준).

설치 및 검증 보고서 `installer-*.json`을 첨부했습니다.

EXE SHA256:
```
32c5f0285aea7224b279f55b56663b15a7f90861dbdd3aca17a17cfdfaa769ac
```

[설치 EXE와 보고서](https://github.com/plaire48/ai_workspace/releases/tag/nubi-office-v0.8.4). 실행 OS는 Microsoft Windows Server 2022 Datacenter 64-bit, build 20348입니다.

## 방법론과 근거

도구의 성공 선언과 실제 결과를 분리합니다. 설치한 파일의 해시, 설치된 프로그램의 실행, 레지스트리와 제거 결과를 직접 확인하며 실행 OS를 보고서에 기록합니다. 기존 업그레이드와 새 설치를 별도로 확인합니다.

- [Microsoft VSTO 등록](https://learn.microsoft.com/en-us/visualstudio/vsto/registry-entries-for-vsto-add-ins?view=visualstudio): 32/64비트 등록과 manifest 연결 검사.
- [Node.js fileURLToPath](https://nodejs.org/api/url.html#urlfileurltopathurl-options): URL pathname을 OS 경로로 직접 쓰지 않고 Windows 드라이브, 공백과 한글 파일명을 보존합니다.
- [GitHub 호스팅 실행 환경](https://docs.github.com/en/actions/reference/runners/github-hosted-runners): `windows-2022`는 Windows Server 환경입니다. Windows 11 PC 검사로 표시하지 않습니다.
- [UI 기준과 검사](UI-IDENTITY-CONTRACT.md): 디자인 토큰과 의미 있는 아이콘, 선택적 강조, 명시적인 승인 대상을 유지합니다.

## 남은 검증

Windows 11 실제 PC 설치, 실제 Excel/Word/PowerPoint 2016 내 VSTO 로드와 문서 편집/저장 후 재열기, 사내 Qwen 3.8 27B와 로그인, NASCA 암복호화, native 파일 선택창 직접 조작은 미검증입니다. COM 계약과 브라우저 모델 흐름은 대역을 사용합니다. 사용자 데이터 보존은 시험 파일로 검사했으며 회사 문서와 전체 사용자 설정의 마이그레이션 검증을 대신하지 않습니다.

자동 접근성 위반은 발견하지 못했지만 일부 색상 대비는 자동 판정 미완료입니다. 정적 화면 검사와 브라우저 검사는 Office 내부 WebView2 전체 사용성 보증이 아닙니다.

공인 배포자 코드 서명이 없는 사전 배포판입니다. manifest 자체 서명은 신뢰된 배포자 서명이 아니며 설치 프로그램은 인증서 신뢰 저장소와 Office 보안 정책을 변경하지 않습니다. 재시작 후 영구 작업 복원, 회사 공용 양식 배포와 복잡한 Word/PPT 요소 전체 편집은 지원 완료 항목이 아닙니다.
