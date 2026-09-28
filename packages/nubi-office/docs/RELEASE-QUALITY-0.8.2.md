# 0.8.2 설치 배포 검증

사용자가 2026-09-23에 최종 빌드와 배포를 요청했다. 기존 빌드 보류 조건은 이번 배포에 대해 해제되었다.

## 확인하고 수정한 항목

- 보류 기간의 native 소스를 실제 컴파일해 nullable 검사, JSON/XML Formatting 이름 충돌, Excel 이름 정의의 COM object 변환 오류 12건을 수정했다. 경고를 끄지 않고 입력 타입 검사를 유지했다. 로컬 net472 교차 컴파일 오류/경고 0개.
- C# 병합 셀 테스트의 빈 value와 기존 displayText가 불일치했다. 실제 빈 셀에 맞게 테스트 자료만 수정한 뒤 기존 전체 보존 비교를 유지했다. 34/34 계약 검사 통과, Excel COM은 모의 구현.
- Windows Git 체크아웃의 CRLF 변환으로 공유 UI 24개 해시가 달라졌다. 패키지 .gitattributes의 eol=lf로 원본 바이트를 유지했다. 해시 검사를 느슨하게 하거나 기준을 다시 생성하지 않았다. Windows autocrlf 필터를 적용한 로컬 Git 검사도 24개 일치.
- Windows PowerShell의 Newtonsoft JToken 멤버 해석을 피하도록 설치 검사 응답을 ConvertFrom-Json으로 읽고, 시간 초과/모델 제공자 ID/Office host를 각각 검증한다.
- 이전 browser.mjs는 삭제된 연결/작업 모드 UI를 전제로 한 과거 갤러리다. 기본 test:browser는 현재 화면을 검증하는 browser-release.mjs로 연결한다. 세 제공자 표시, 선택 수식 조회, 자동 실행 경로, 계획, 승인, 순차 편집, 잘못된 서식 복구, readback, 되돌리기, 취소, 320/380/600/1100px 검사를 통과했다. SSO/모델/COM은 픽스처이고 React/제공자 어댑터/Pi/C# 엔진은 실제 코드다.
- 브라우저 검사용 정적 서버의 경로 경계가 Unix 슬래시만 사용해 Windows에서 404를 반환했다. Node path.sep으로 운영체제별 경계를 검사하도록 수정했으며 디렉터리 밖 접근 차단은 유지한다.
- Windows 배포 workflow에 C# 계약 검사, 현재 브라우저 통합 검사와 디자인 검사를 추가했다. 실패하면 설치 배포를 진행하지 않는다.

## BP와 오픈소스 판단

[Git 공식 속성 문서](https://git-scm.com/docs/gitattributes)의 텍스트/eol 계약을 적용해 체크아웃 재현성을 확보했다. 기존 Git, Playwright, C# 테스트 실행기, Newtonsoft.Json, GitHub Actions와 Inno Setup을 재사용했다. 새 테스트 프레임워크나 외부 서비스를 도입할 필요가 없었다. 런타임 의존성 npm audit 결과 알려진 취약점 0건이며, 이것은 모든 취약점 부재의 증명이 아니다.

[GitHub의 배포 출처 문서](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)를 참고해 배포 태그를 실제 빌드 커밋에 연결하고 EXE SHA-256 및 빌드/설치 검증 JSON을 함께 제공한다. 이번 작업이 저장소의 immutable release 설정이나 Sigstore 증명 기능을 활성화했다는 의미는 아니다.

[Microsoft VSTO 신뢰 문서](https://learn.microsoft.com/en-us/visualstudio/vsto/granting-trust-to-office-solutions?view=visualstudio)에 따라 자체 서명 manifest를 공인 배포자 서명으로 표시하지 않는다. 신뢰 저장소나 Office 보안 정책은 변경하지 않는다.

## 남은 경계

Windows Actions의 설치/재설치/제거 결과와 artifact 해시는 릴리스에 첨부한다. 그 검사도 실제 Excel/Word/PowerPoint 2016 COM, 회사 SSO, Qwen 정확도, NASCA 검증은 아니다. 따라서 사전 배포판으로 제공한다. 긴 native Word 항목의 추가 읽기, 대용량 최종 검토, 보호된 재시작 복구, 보호된 원본을 대상으로 한 실환경 검증은 여전히 별도 과제다.

## Python 포함 결정

사용자가 배포를 미루고 로컬 Python까지 포함하기로 선택했다. [Python 스킬 하네스](PYTHON-SKILLS.md)를 공통 Office 실행기에 연결했다. 로컬 회귀 424개, 실제 uv/Python/Jinja2 설치와 세 앱 작업공간의 데이터 생성/오류 수정/취소를 확인했다. Windows 프로세스 제한과 번들 Python→UI 승인→C# 셀 반영 검사는 Windows workflow의 별도 필수 단계다. 최종 결과는 릴리스 JSON을 따른다.
