# 기존 native DLL을 사용하는 Word 읽기 검사

상태: 2026-10-15 소스 준비. 사용자가 현재 Windows 환경이 없다고 확인해 실제 PowerShell/native/Word 실행은 하지 못했다. 현재 환경에는 PowerShell도 없어 이 스크립트의 PowerShell 파서 검사까지 수행한 것으로 표시하지 않는다.

후속 쓰기 연결과 세 앱의 빈 테스트 문서용 실행 도구는 [Windows Office 쓰기](WINDOWS-OFFICE-WRITE.md)를 따른다. 기존 읽기 어댑터는 계속 읽기 전용이며 쓰기 권한을 추가하지 않는다.

## 연결 방식

```text
Windows PowerShell 5.1 (-STA)
  → 이미 실행 중인 Word.Application에 연결
  → 기존 OfficeX.ExcelHost.OfficeAutomationPort / OfficeX.Core.OfficeAutomationSession 생성
  ↔ 자식 Node read-word-native.mjs (기존 tool / tool_result 계약)
  → 문서 모듈의 읽기 어댑터로 두 번 관찰
  → 본문 없는 검사 결과
```

COM 접근은 PowerShell의 같은 STA 스레드에서 순서대로 실행한다. 기존 native의 `CheckSource`, 읽기 전용 `Inspect`, `Members`, 해제 코드를 재사용한다. 문서 모듈로 COM 객체를 넘기지 않는다. 이는 이미 실행 중인 VSTO 프로세스에 붙는 기능이나 제품 애드온 설치가 아니라, 기존 DLL의 동일 클래스를 사용하는 개발용 호스트다.

## 필요한 환경

- Windows에 설치된 Word와 Windows PowerShell 5.1. 실행할 문서를 사용자가 Word에서 직접 열어 둔다.
- 기존 Office X 실행판의 `OfficeX.ExcelHost.dll`, `OfficeX.Core.dll`, `Newtonsoft.Json.dll`이 같은 디렉터리에 있어야 한다. 이 검사는 DLL/설치 파일을 빌드하거나 다운로드하지 않는다.
- 기존 번들 또는 개발용 Node 22.19 이상. 사용자 제품에 별도 Node 설치를 요구하는 설계가 아니다.
- `npm ci --ignore-scripts`와 `npm run build`로 준비한 이 패키지의 소스와 `dist/index.js`. 이 명령은 TypeScript 번들이며 Office Windows 설치 빌드가 아니다.

기존 native DLL이 없는 경우나 회사 정책에서 외부 COM 연결을 막는 경우는 별도 선행 조건이다. 설치/보안 정책을 변경하거나 암호화 파일을 외부 파서로 읽어 대체하지 않는다.

## 실행

1. Word에서 읽을 문서를 연다. 처음에는 일반 테스트 문서에서 제목과 본문, 굵은 글자 등이 섞인 작은 범위를 사용한다.
2. 읽을 본문을 1~512 UTF-16 단위로 선택한다. 표/필드/인라인 개체/콘텐츠 컨트롤, 머리글/바닥글은 첫 검사 범위에서 지원하지 않는다. 다른 문서나 창으로 전환하지 않는다.
3. 문서 이름과 기존 DLL/Node 위치를 실제 값으로 바꿔 실행한다.

```powershell
powershell.exe -NoProfile -STA -File .\scripts\Read-WordNative.ps1 `
  -NativeDirectory 'C:\OfficeX\native' `
  -NodePath 'C:\OfficeX\runtime\node.exe' `
  -ExpectedDocumentName 'meeting.docx' `
  -ReportPath '.\word-read-01.json'
```

위 경로는 예시다. 회사의 기존 실행 정책을 따르며 실행 정책 변경 옵션은 사용하지 않는다. `ExpectedDocumentName`은 Word의 실제 `Document.Name`과 정확히 같아야 한다. 이름이 다르면 본문을 읽지 않는다. 여러 Word 인스턴스 중 ROT에서 얻은 인스턴스가 대상과 다르면 자동 전환/활성화하지 않고 중단한다.

저장된 문서인지와 관계없이 이미 열린 문서를 관찰한다. Office의 문서 열기, 편집, 저장, 닫기나 Word 종료를 실행하지 않는다. 종료 때 자신이 획득한 COM 참조와 자식 프로세스만 정리한다. 실행 중 문서를 편집하거나 저장하지 않는다.

## 출력과 판정

성공 시 프로세스 종료 코드는 0이다. `status: read`, `actualWordRead: true`, native 호출 수, DLL 해시, Word/Node 버전과 선택 범위가 기록된다. `observation`에는 본문 해시, 문자/문단/서식 구간 수, 두 관찰의 일치 근거가 포함된다. 원문, 글꼴 이름, 문서 이름/경로와 인증값은 결과에 넣지 않는다. 읽기 처리 중 원문은 두 프로세스의 메모리와 상속된 로컬 파이프를 통과한다.

`ReportPath`를 생략하면 콘솔에 결과만 출력한다. 지정한 파일이 이미 있으면 덮어쓰지 않는다. 보고서는 본문이 없는 진단 자료이며 문서 자체의 보존/암호화 증명이 아니다. 본문 해시도 자료의 메타데이터이므로 회사 정책에 맞게 취급한다.

실패 시 종료 코드는 1이며 원인 코드만 반환한다. 주요 원인은 다음과 같다.

| 원인 | 다음 확인 |
| --- | --- |
| `windows_required` / `windows_powershell_5_required` / `sta_required` | Windows PowerShell 5.1을 `-STA`로 실행 |
| `native_dependency_missing` / `reader_build_required` | 기존 DLL과 Node 번들 파일 위치 확인 |
| `expected_document_mismatch` / `selection_document_mismatch` | 대상 문서 이름과 현재 Word 선택 확인 |
| `select_main_body_1_to_512_required` | 본문에서 짧은 범위 선택 |
| `activate_source_window` / `native_source_changed` | 원래 창을 유지하고 같은 범위를 새로 읽기 |
| `native_scope_unsupported` / `native_style_incomplete` | 지원 범위/서식과 실제 getter 결과 확인 |
| `native_connection_closed` / `reader_exit_unconfirmed` | 자식 프로세스와 기존 native 의존성 확인 |

COM 호출 자체가 멈춘 경우는 이 동기식 개발 호스트가 즉시 중단시킬 수 있다고 보장하지 않는다. 취소 뒤 늦은 Node 응답을 사용하지 않는 것과 이미 진입한 COM 호출의 강제 중단은 다른 문제다. 강제 정리도 사용자 Word 프로세스를 종료하는 방식으로 처리하지 않는다.

## 실제 검증에서 남길 근거

1. 일반 테스트 문서에서 실제 Word 본문/서식 읽기 성공과 대상 선택/다른 창/변경 감지 반례.
2. Office 2016 제품/비트 수 확인. `Version: 16.0`만으로 Office 2016과 Microsoft 365를 구분하지 않으므로 `office2016Verified`는 자동으로 true가 되지 않는다.
3. NASCA 문서를 사용자가 Word에서 연 상태의 같은 읽기 검사. 일반 DOCX 성공만으로 NASCA 성공을 표시하지 않으며 `nascaVerified`도 자동으로 true가 되지 않는다.
4. 원문/비대상 구조와 저장 상태 보존의 독립 확인. 읽은 서식 속성 밖의 전체 레이아웃이나 쓰기/저장/재열기는 이 검사 결과에 포함하지 않는다.

현재는 위 실제 근거가 없다. macOS의 Node 프로세스 검사는 stdio와 모듈 흐름의 증거이며 PowerShell 파서, DLL 로드나 Word COM의 성공 증거가 아니다.
