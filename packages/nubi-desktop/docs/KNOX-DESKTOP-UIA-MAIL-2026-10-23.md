# Knox Desktop UIA 메일과 관측 원문 보관

2026-10-23 사용자 재지시를 반영했다. Knox Desktop 방식은 DRM이 걸린 메일 파일을 직접 파싱하는 대신 실행 중인 Desktop의 UI Automation으로 메일을 읽는다. POP3와 외부 브라우저 포털은 별도 연결 방식이다.

공유한 `server.py`의 `Knox._connect()`, `snapshot()`, `Node`는 창에 연결한 뒤 Name/ControlType/AutomationId/ClassName의 RawView Subtree 캐시를 만들고 트리를 조회한다. 이 구조를 PowerShell STA + .NET UIAutomationClient로 옮겨 추가 Python 설치 없이 실행한다. 공유한 `apps.py`의 기존 메일은 `.mysingle` 파일을 파싱하므로 그 부분을 UIA라고 부르거나 새 수집기의 실행 경로로 사용하지 않는다. 메일 전용 헤더/본문 해석은 새로 작성한 어댑터다.

Microsoft의 [UIA 캐시 설명](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/caching-in-ui-automation-clients), [DocumentRange 설명](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.textpattern.documentrange?view=windowsdesktop-10.0)을 참고했다. 실제 대상이 필요한 패턴을 제공하는지는 Windows Knox에서 확인해야 한다.

## 수집 범위

현재는 선택한 창에 **열린 메일 하나**를 읽는다. 제목, 보낸 사람, 받는 사람, 참조, 날짜와 읽기 전용 본문을 관측한다. 제목/발신자/본문이 없거나 본문 후보가 여러 개, 읽는 도중 값이 변하거나 제한을 넘으면 저장하지 않는다. 본문 안의 인용된 Subject/From은 현재 메일의 헤더로 해석하지 않는다. 전체 메일함 순회나 첨부 파일 획득을 구현한 것으로 표시하지 않는다.

프로세스 ID/창 핸들/시작 시각/프로세스 이름으로 연결을 고정한다. 여러 후보이면 창을 직접 선택한다. 창이 사라지거나 프로세스가 교체되면 다른 창을 자동 선택하지 않는다. 암호, 숨겨진 컨트롤과 편집 중인 입력은 제외한다. 클릭/스크롤/선택/클립보드나 메일 파일 파싱으로 대체하지 않는다. 자동 정리가 켜졌을 때 확인 주기는 5분이다.

## 원문과 경로

`status.rawRoot/<id>/uia.json.enc`에 관측한 메일의 UIA 헤더·본문·트리 경로와 읽은 시각/창 바인딩/수집 범위를 저장한다. 관련 없는 사이드바와 상위 문서의 전체 텍스트는 보관하지 않는다. `manifest.json.enc`는 해시와 정규화된 본문을 보관한다. 기존 AES-GCM과 OS 키 보관소를 사용하며 키를 사용할 수 없을 때 평문으로 저장하지 않는다. 기본 경로는 개인 메일 데이터 폴더의 `raw`이고 설정의 **원문 저장 위치**에서 확인/변경한다. 이동은 기존 원문도 복사하고 해시를 확인한 뒤 새 위치를 적용한다.

다시 열기와 내보내기는 보관한 JSON을 복호화해 원문 해시를 확인한다. JSON 내보내기는 `*-uia.json`이며 `.eml`이나 원본 MIME으로 꾸미지 않는다. 같은 헤더/본문을 다시 읽으면 중복하지 않고 바뀐 본문은 별도 기록으로 남긴다. 기존 파일 수집 기록의 호환 읽기는 남지만 새 Desktop 연결이 파일 스캔을 재개하지 않는다.

원문에는 `coverage = {scope:'open_message', completeMailbox:false, originalMimeAvailable:false, attachmentsRead:false, mailboxKnown:false}`가 있다. 원본 메일함을 모르는 UIA 기록은 `other`로 분류하고 **별도 보관**에서 연다. UI에는 관측 시각과 MIME/첨부/전체 메일함 미확인 범위를 함께 표시한다. 첨부 목록이 비었다고 첨부가 없는 메일이라고 단정할 수 없다.

## 확인 경계

Node 합성 UIA 검사는 암호화/재읽기/JSON 내보내기/이동/변조/창 선택/취소/시간 초과를 확인한다. Chrome 설정 화면 검사는 합성 호스트 응답을 사용한다. PowerShell Parser.ParseFile은 macOS의 구문 검사다. 이 결과는 실제 Windows Knox Desktop, 사내 DRM UIA 노출, 설치/재실행 또는 전체 메일함/첨부 수집 검증을 대신하지 않는다.
