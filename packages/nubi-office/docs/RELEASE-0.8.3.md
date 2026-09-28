# Nubi Office 0.8.3 검증 기록

검사일: 2026-09-23. [Windows 전체 검사](https://github.com/plaire48/ai_workspace/actions/runs/35848755521) 통과.

검증하고 빌드한 소스: `893517c4f2fa10833a8f8a9721e009aa1482fb1a`.

## 변경과 실제 검증

- 사용자 ZIP/폴더 스킬 등록, Pi 기반 탐색/활성화/필요 파일 조회, 하위 분석의 요구사항/확정 답변 보존과 취소 후 늦은 결과 차단을 포함합니다.
- 스타일 검사가 찾은 스킬 질문의 직접 색상/간격 값을 공통 디자인 토큰으로 수정했습니다. UI 원본 24개 파일 일치와 디자인 검사 0건을 확인했습니다.
- JavaScript/React/하네스 소스 검사 490개 통과. C# 계약 시나리오 34개 통과(COM 대역).
- .NET Framework 4.7.2 Host와 스킬 검사 프로젝트를 컴파일하고, Windows 32/64비트 프로세스에서 실제 폴더/ZIP/하위 파일을 읽었습니다. 경로 거절, 해시 변조, UTF-8 페이지, revision과 앱 격리, DPAPI 저장/재읽기를 검사했습니다.
- Windows에서 실제 Python 3.12 준비, 실패 코드 수정, 입력 변경, 취소/시간 초과와 제한을 검사했습니다. 모델과 Office COM은 사용하지 않았습니다.
- 브라우저 통합은 실제 React/Pi/AI Pro 파서/C# 엔진을 사용했습니다. 320/380/600/1100 너비, 계획 후 실행, 승인, 쓰기/readback, 복원과 취소를 확인했습니다. SSO/모델 판단/COM은 대역입니다.
- 단일 EXE의 Word 단독, PowerPoint 단독, 세 앱 선택 설치와 같은 버전 재설치/제거를 통과했습니다. 설치 파일 28,591개의 SHA256을 비교하고 32/64비트 호스트, worker, uv 실행을 확인했습니다. 제거 후 사용자 데이터 보존을 확인했습니다.
- Windows UIA/화면 캡처/가상 포인터 검사는 WinForms 시험 창에서 수행했습니다. 사용자 커서 위치와 클릭 통과를 확인했습니다.
- 검증 당시 `npm audit --omit=dev`에 보고된 알려진 취약점은 0건입니다.

초기 두 Windows 실행은 새 PowerShell 검사 어댑터의 인자 변환에서 실패했습니다. 검사를 형식이 고정된 C# 실행기로 옮긴 뒤 위 전체 실행이 통과했습니다. 실패한 실행의 설치 파일은 배포하지 않았습니다.

## BP와 오픈소스 선택

[Anthropic 에이전트 평가 방법](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)에 따라 도구 성공 응답만 세지 않고 실제 저장 결과를 확인하는 Windows 검사를 추가했습니다. [Microsoft VSTO 등록 문서](https://learn.microsoft.com/en-us/visualstudio/vsto/registry-entries-for-vsto-add-ins?view=visualstudio)를 기준으로 기존 manifest/32비트/64비트 등록과 설치 검사를 유지했습니다.

기존 Pi, p-map, MiniSearch와 .NET ZipArchive/DPAPI를 재사용했습니다. 제품 런타임 의존성을 추가하지 않았습니다. 모델 판단, 통신, native 저장과 실제 Office 결과를 분리해서 검증하며 새 프레임워크 도입만으로 품질 향상을 주장하지 않습니다.

## 배포 파일

[0.8.3 사전 배포판](https://github.com/plaire48/ai_workspace/releases/tag/nubi-office-v0.8.3)의 설치 파일과 `installer-*.json`이 실행 근거입니다.

`Nubi-Office-0.8.3-Setup.exe` SHA256:

```
8c75b87d7962c829b3aa027778ada4f9e7079ae63f01941cd804ed7c6c70239a
```

## 남은 검증과 범위

실제 Office 2016 내부 VSTO 로드/COM 편집/저장 후 재열기, 사내 Qwen 3.8 27B의 요구사항 충족 정확도와 로그인, NASCA, native 파일 선택창 직접 조작은 미검증입니다. Windows runner에는 Office가 없으며 이 결과를 실환경 성공으로 표현하지 않습니다. 실제 사용자 PC의 0.8.2에서 업그레이드하는 검사는 별도입니다.

EXE에는 공인 배포자 서명이 없습니다. preview manifest 자체 서명은 신뢰된 배포자 서명이 아니며 설치 프로그램은 인증서 신뢰 저장소나 Office 보안 정책을 바꾸지 않습니다. 재시작 후 영구 작업 복원, 회사 공용 양식 배포, 복잡한 Word 필드와 PPT rich text/표/차트 편집은 지원 완료 항목이 아닙니다. 모든 오류가 없다는 보증이 아닌, 위 검사 범위를 통과한 사전 배포판입니다.
