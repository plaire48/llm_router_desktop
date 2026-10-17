# Office 첨부 읽기 실패 보완

사용자 환경은 Windows 11과 Office 2016이며, 같은 첨부를 Office에서 직접 열면 본문이 정상으로 보인다. 실행 중인 Windows 설치판의 버전과 실제 HRESULT는 아직 받지 않았다. 다음은 현재 소스에서 재현한 결함과 수정 범위다.

## 확인한 결함

`runtime/office-document.ps1`의 추출문 조합 구간에서 `ForEach-Object`의 닫는 중괄호가 빠져 있었다. 이 문장은 Word/Excel/PowerPoint가 읽은 텍스트를 하나의 본문으로 합친다. PowerShell은 스크립트 실행 전 구문을 분석하므로 이 오류가 있으면 Office의 Open까지 도달하지 못한다. try/catch에서도 JSON 오류 응답을 만들 수 없다.

macOS의 공식 PowerShell 7.4.6에서 수정 전 해당 구문이 남은 스크립트를 실행해 parser rejection, 종료 코드 1, stdout 없음, 누비 파서의 `document_office_read_failed` 변환을 재현했다. 사용자가 본 `Office에서 첨부를 읽지 못했어요`와 같은 코드 경로다. 캡처한 실패 스크립트는 진단 패치가 적용된 뒤, 기존 본문 조합 구문의 괄호를 고치기 전 버전이다. 진단 패치 전의 파일 전체와 동일한 스냅샷으로 표시하지 않는다.

닫는 중괄호를 복구했다. 실제 PowerShell 파서와 해당 본문 조합 AST를 실행해 시트명/슬라이드 번호/한글 본문/구분 줄을 확인했다. 전체 Office COM 실행을 통과한 것으로 확대하지 않는다.

## 재발 방지와 복구 정보

`npm run check:office-reader`와 Windows 패키징 시작에 PowerShell 검사를 연결했다. 검사는 전체 생산 스크립트를 UTF-8로 파싱하고 진단 함수 및 본문 조합만 실행한다. Word/Excel/PowerPoint를 실행하거나 사용자 문서를 열지 않는다. Windows에서는 `powershell.exe`가 필수이며 검사 실패 시 빌드/패키징을 중단한다. macOS에 `pwsh`가 없으면 건너뜀을 명시한다. 이번 검증에는 해시를 확인한 공식 portable PowerShell을 임시 디렉터리에서 사용했다. 제품에 새 PowerShell이나 외부 파서를 번들하지 않는다.

Office 내부 실패는 허용된 단계, 앱, 버전과 HRESULT만 보존한다. 원본 경로, 본문, 예외 메시지와 stack은 표시 데이터에 포함하지 않는다. `Office 실행`, `읽기 설정`, `파일 열기`, `본문 읽기`, `결과 확인`, `닫기/설정 복구/연결 정리`를 구분한다. 알려진 RPC 거절/대기 번호는 일반 파일 오류와 구분하고 수동 확인 후 다시 읽기를 안내한다. 번호의 의미는 [Microsoft COM 오류 정의](https://learn.microsoft.com/en-us/windows/win32/com/com-error-codes-3)를 따른다. 특정 번호만으로 NASCA나 회사 정책이 원인이라고 단정하지 않는다.

최초 읽기 오류가 있을 때 사본 삭제나 COM 정리까지 실패하더라도 최초 단계와 번호를 덮어쓰지 않고 `cleanupFailed`를 추가한다. 읽기는 성공했지만 닫기/정리에 실패했다면 완료로 표시하지 않는다. 실패 결과를 본문 캐시나 업무 완료로 올리지 않는다.

실패 정보는 첨부 캐시와 메일 처리 상태를 거쳐 재실행 후에도 남는다. `원인과 확인 방법`을 펼치면 세부 정보와 다음 행동을 읽을 수 있다. 다시 읽기는 기존 사용자 동작을 사용하고, 이미 완료된 다른 첨부와 기존 위키를 유지한다. 자동 COM 재시도, 기존 Office 문서 닫기나 강제 종료를 추가하지 않았다.

## 검증과 남은 확인

집중 검사와 1000px/360px 실제 컴포넌트 화면에서 오류 상세/다시 읽기/가로 넘침을 확인했다. 전체 Desktop 회귀, Electron 빌드와 화면 결과, PowerShell 재현/검사 및 소스 해시는 [검증 폴더](../verification/office-read-2026-10-16/)에 보관한다.

이번 PowerShell 검증은 macOS 7.4.6 파서와 분리된 함수의 실행이다. Windows PowerShell 5.1, 실제 Office 2016 COM, NASCA 첨부와 수정된 Windows 설치판은 아직 실행하지 않았다. 다음 검증은 수정된 Windows 빌드에서 사용자가 실패했던 동일 첨부를 다시 읽고, 본문과 범위/원본 해시/기존 열린 문서 보존/사본 정리를 확인하는 것이다. 오류가 남으면 새 단계와 HRESULT로 후속 원인을 좁힌다.

최종 Desktop 전체 검사는 1,696개 중 1,500 통과, 196 건너뜀, 실패 0이다. PowerShell 직접 검사 5항목과 Electron 22개 화면 검사를 포함한 상세 범위는 검증 폴더의 `summary.json`을 따른다.
