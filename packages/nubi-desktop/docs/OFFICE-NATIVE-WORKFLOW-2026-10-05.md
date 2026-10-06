# NASCA 문서의 Office 작업 흐름

사용자 요구: 회사 Word, Excel, PowerPoint 2016 문서는 실제 Office가 열고 그 안에서 처리해야 한다. 자동 첨부 읽기는 이미 승인됐고, 이번 확인 질문은 수정과 저장까지 Desktop에서 연결할지에 관한 범위다.

## 현재 연결과 공백

| 동작 | 현재 상태 | 실행 주체 |
| --- | --- | --- |
| 메일 첨부 자동 읽기와 수동 미리보기 | Desktop 소스 연결과 Electron 빌드 완료. Windows Office/NASCA 실행은 미확인 | `runtime/office-document.ps1`의 읽기 전용 Office COM |
| 열린 Office 문서에서 지원 범위의 수정과 생성 | 기존 누비 Office의 앱별 native 실행기 소스가 있음. 실제 설치/회사 문서 성공과 구분 | Office 안의 누비 작업창과 `Nubi.Office.Host` |
| Desktop 대화에서 Office 편집을 요청하고 결과를 돌려받기 | 현재 활성 연결 없음 | 추가 연결 범위 확인 필요. Desktop A2A는 계속 비활성 |

읽기용 사본과 편집 대상은 구분한다. 수신 원본의 읽기 캐시를 편집하거나, 읽기 성공을 수정/저장 성공으로 표시하지 않는다. 문서 본문은 비신뢰 자료이며 자동 실행 권한을 주지 않는다.

## 편집까지 연결할 때 유지할 계약

1. 실제 Office에서 문서를 열고 그 문서와 창을 고정한다. 읽기용 백그라운드 임시 사본을 편집 실행기에 전달하지 않는다.
2. Word 문단/표, Excel 셀/수식, PowerPoint 슬라이드/도형을 각각의 기존 도구로 관찰한다. 지원하지 않는 영역과 부분 관찰을 그대로 표시한다.
3. 요청과 연결한 계획을 보여주고 작은 동작으로 진행한다. COM 호출은 해당 Office UI/STA에서 순차 실행한다.
4. 반영 전에 변경 범위와 원본 상태를 확인하고 기존 승인 절차를 따른다. 사용자가 바꾼 문서를 덮어쓰거나 미확정 쓰기를 재전송하지 않는다.
5. 저장은 Office의 native 저장 경로로 처리하고 결과를 다시 읽어 확인한다. 파일 ZIP 재작성이나 외부 복호화로 대체하지 않는다.

기존 재사용 지점은 `packages/nubi-office/native/Nubi.Office.Host/NubiPane.cs`, `ContentPort.cs`, `DocumentPort.cs`, `ExcelPort.cs`다. Word/PPT의 `office_read`, `office_apply`, `office_save`, `office_receipt`와 Excel의 문서/범위 실행 계약을 유지한다. 연결을 추가해도 Desktop에 A2A나 Computer Use를 활성화하지 않는다.

Microsoft의 [Custom task panes](https://learn.microsoft.com/en-us/visualstudio/vsto/custom-task-panes?view=vs-2022)와 [Office threading](https://learn.microsoft.com/en-us/visualstudio/vsto/threading-support-in-office?view=visualstudio)을 확인했다. 기존 VSTO/COM 실행기를 재사용하는 방향이며 새 문서 편집 라이브러리는 도입하지 않는다. 문서와 창에 묶인 작업창, STA 실행 원칙은 회사 NASCA 정책을 대신 증명하지 않는다.

이번 확인은 소스 검토와 공식 문서 확인이다. 코드, native/설치 파일, 실행 중인 Electron을 변경하지 않았으며 자동 테스트도 실행하지 않았다. 실제 회사 Windows에서 문서 열기, 접근 권한, 반영, 저장, 재열기와 원본 보존을 확인하기 전에는 NASCA 편집 연동이 완료됐다고 표시하지 않는다.
