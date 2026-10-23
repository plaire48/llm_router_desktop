# Windows Office 첨부 읽기

**2026-10-23 사용자 결정(이전 parser-first 규칙을 대체):** Windows의 Word/Excel/PowerPoint 첨부는 일반 파일도 Office COM으로 바로 연다. COM 실패를 내장 파서 성공으로 바꾸지 않는다. PDF/텍스트/일정 등은 기존 내장 worker로 읽으며, 이미지는 기존 연결 모델을 사용한다. macOS의 Office 파일은 기존 내장 파서를 사용하며 COM 실행으로 표시하지 않는다. Windows Office 파일의 과거 파서 캐시는 COM 근거로 사용하지 않고 다시 읽는다. 원본을 보관하지 않았던 추출 전용 자료는 원본 미보관 사실을 보존한다. 대화 위키 생성은 아직 읽지 않은 첨부를 순차적으로 읽고 원문과 파일 해시를 재확인한 뒤 근거에 포함한다. 읽지 못하거나 생성 예산에서 잘린 부분은 명시적인 부분 확인으로 남긴다.


사용자 결정: 회사 NASCA 문서는 Office 2016에서 열어 읽는다. 2026-10-05 사용자가 `Office로 자동 열어 읽기`를 선택했다. 직접 바이너리/ZIP 파싱을 NASCA 지원으로 표시하지 않는다.

## 실제 연결

Windows의 자동 첨부 읽기와 수동 미리보기는 같은 `PersonalMail.extractAttachment`를 사용한다. Word/Excel/PowerPoint 확장자와 알려진 MIME은 `office-document.mjs`의 Office 경로로 연결한다. Office 실패 후 일반 파서로 재시도하지 않는다. PDF/UTF-8 텍스트는 기존 제한된 별도 worker를 유지하며 macOS의 일반 OOXML 파서는 NASCA 지원이 아니다.

호스트는 이미 수신한 개인 원본 디렉터리에 무작위 읽기 디렉터리를 만들고 사용자 전용 ACL을 확인한다. 원본 바이트를 확장자가 있는 파일로 그대로 복사하고 SHA-256을 확인한다. 복호화, ZIP 재저장, Office Save/SaveAs나 형식 변환은 호출하지 않는다. 원본 메일과 파일 해시는 읽기 전후 다시 확인한다.

`office-document.ps1`은 Windows PowerShell의 STA COM 호출로 Office의 Open을 실행한다. 응답은 UTF-8 JSON이며 별도 파일에 추출 본문을 쓰지 않는다. 회사 PowerShell 정책과 Office 보호 보기/접근 권한을 우회하지 않는다. 실행 정책/레지스트리/신뢰 센터 변경과 보안 경고 확인 동작은 없다.

| 앱 | 읽기 범위 | 미확인 범위 |
| --- | --- | --- |
| Word | ReadOnly 본문 Range의 글과 표 | 머리말/꼬리말, 이미지, 서식과 정확한 페이지 |
| Excel | ReadOnly 워크북의 모든 Worksheet UsedRange, OS/Office의 셀 표시 텍스트 | 이미지/숨겨진 개체, 독립 재계산 검증, `####` 등의 표시 잘림 |
| PowerPoint | ReadOnly 슬라이드의 텍스트, 그룹 내 텍스트와 표 | 발표자 노트, 이미지, 서식 |

Office 버전 16.x COM을 사용하므로 Office 2016 호환 구현이다. 버전 번호만으로 설치 제품이 Office 2016임을 증명하지 않는다. 원본/열린 문서 FullName, 실제 ReadOnly 상태를 확인한다. 현재는 128MiB 입력/8,000,000자 출력, 200개 시트/1,000개 슬라이드와 출력 바이트 제한을 유지하며, Excel은 최대 2,048셀 블록으로 확인한다. 이전 20,000셀/일괄 60초 제한은 제거했고 실제 진행 미확인 120초/전체 15분 한도를 적용한다. 한도 초과를 전체 읽기 성공으로 기록하지 않는다. COM 읽기는 호스트 내에서 순차 진행한다. [2026-10-24 후속 기록](OFFICE-READ-PROGRESS-2026-10-24.md)의 구현과 실환경 검증 경계를 따른다.

AutomationSecurity ForceDisable을 사용하고 Excel EnableEvents를 중지하며 외부 링크 갱신을 0으로 지정한다. 기존 앱 설정은 복구한다. Excel 4.0 매크로는 이 속성만으로 차단되지 않아 Office 자체 보안 질문이 나타날 수 있다. 누비는 그 질문을 자동 확인하지 않는다. 닫기는 이번 Open이 반환한 문서만 대상으로 하며 사용자 문서를 열거/닫거나 Office 프로세스를 강제 종료하지 않는다. 제한 시간을 넘으면 보류로 남기고 Office에서 열린 문서와 읽기용 사본 정리 상태를 확인해야 한다.

완료 기록은 `reader: office_com`, 실제 Office 버전과 읽은 범위를 보존한다. Windows의 기존 파서 캐시는 Office 성공으로 취급하지 않고 한 번 다시 읽도록 큐에 넣는다. Office 읽기는 한 번에 하나씩 실행하며 문서가 한도를 넘으면 전체 읽기 성공으로 기록하지 않는다. 기존 사용자 위키와 이미 저장한 정리는 자동 덮어쓰지 않는다. 자동 정리 OFF/앱 종료는 활성 읽기 요청을 취소하며 새 Office 읽기를 시작하지 않는다. 메일 Agent는 검증된 첨부 본문/개인 위키의 출처 계약을 계속 사용한다.

수동 미리보기의 직접 파서 호출도 제거했다. 동일 해시의 검증된 캐시를 사용하거나 자동 수집과 같은 worker/Office 제한을 적용한다. 호스트 메인 프로세스에서 Office/PDF/OOXML 파서를 직접 실행하지 않는다.

## 방법론 선택

[Word Documents.Open](https://learn.microsoft.com/en-us/office/vba/api/word.documents.open), [Excel Workbooks.Open](https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.open), [PowerPoint Presentations.Open](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentations.open)의 ReadOnly 계약을 적용했다. [Excel AutomationSecurity](https://learn.microsoft.com/en-us/office/vba/api/excel.application.automationsecurity)의 VBA 매크로와 Excel 4.0 예외를 구분한다. 기존 누비 Office의 COM 관찰/읽기 전용 원본/독립 저장 검증 원칙을 참고했다. 별도 VSTO DLL이나 A2A 실행기를 불러온 구현은 아니다.

MIT `word-extractor`, SheetJS의 구형 Excel 해석, Tesseract.js OCR을 검토했지만 NASCA 원본을 Office에서 열어야 하는 요구를 해결하지 않아 이번 경로에 추가하지 않았다. 새 외부 의존성은 없다. 스캔 PDF OCR은 후속 범위다.

## 확인 경계

이번 환경은 macOS다. Electron JavaScript/백엔드 빌드에 이 경로와 PS1 자산을 포함했다. Windows PowerShell 파서, Office COM, 실제 NASCA 암복호화와 회사 정책/보안 프롬프트 동작은 실행하지 않았다. 따라서 실제 읽기 성공/호환성/성능을 아직 보장하지 않는다. Native Office/설치 빌드, 실제 모델 호출과 자동 테스트를 실행하지 않았다.

실환경에서 확인해야 하는 항목은 보호 DOC/DOCX/XLS/XLSX/PPT/PPTX의 원문 대조, 한국어/표/날짜/슬라이드, 열기 전후 원본 해시, 기존 편집 중인 Office 문서 보존, OFF/시간 초과/보안 질문 시 보류/취소, 파일 잠금 해제와 읽기용 사본 제거다. 쓰기와 편집은 기존 누비 Office의 승인/문서 바인딩/저장/readback 실행기를 사용하며 이번 Desktop 읽기를 편집 연동으로 확대하지 않는다.

## 2026-10-16 읽기 실패 후속

현재 소스의 PowerShell 본문 조합에 누락된 중괄호를 복구하고, 빌드/Windows 패키징의 실제 PowerShell 구문 검사와 안전한 실패 단계/HRESULT 보존을 추가했다. 재현/수정 및 macOS 검사와 실제 Windows Office/NASCA의 경계는 [후속 기록](OFFICE-READ-FAILURE-2026-10-16.md)을 따른다.

## 2026-10-23 검증 범위

로컬 검사에서 Windows Office 형식의 COM 직접 선택, COM 실패 뒤 파서 미호출, 과거 파서 캐시 거부, 다른 형식의 실제 내장 worker 읽기, 첨부 내용이 생성 모델/독립 검토 근거에 전달되고 파일 해시와 함께 위키에 저장되는 경로를 확인했다. COM 호출 선택 검사는 주입된 읽기 함수이며 실제 Windows PowerShell/Office/NASCA 실행은 미검증이다. macOS 빌드의 PS1 정적 검사도 실제 COM 검증을 대체하지 않는다.
