# 포털 웹 목록 API와 중앙 목록 / 오른쪽 상세

2026-10-23 사용자가 제공한 Node/PowerShell 예제의 메일 API 계약을 외부 브라우저 포털 연결에 반영했다.

## 읽기 경로

- 목록은 `POST /mail/rest/v1/mails/list?folderID=…&page=…&count=30`, JSON `{}`로 읽는다. `headerVOs`를 기존 수집기의 `liteHeaderVOs` 형태로 연결하며 페이지 번호를 기존 커서 수집에 맞춘다.
- EML은 기존 `POST /mail/rest/v1/mails/eml/download?folderID=…&mailSeq=…`를 그대로 사용한다. 바이트를 문자열로 재인코딩하지 않으며 누비의 기존 MIME 파서, 암호화 원본 저장, 검색, 중복 방지를 재사용한다.
- 브라우저가 원래 보유한 로그인 세션으로 고정된 동일 출처 요청을 수행한다. 북마클릿/토큰 입력창/`EP6_UTOKEN` 추출, PowerShell 프로세스나 별도 대시보드 서버는 추가하지 않았다. 기존 포털의 계정 확인/메일함 조회와 메일 읽기 허용은 계속 필요하다.
- 첫 웹 목록 요청이 404/405인 경우에만 기존 desktop 목록 API를 선택한다. 로그인 만료, 403, 네트워크 장애, 잘못된 응답에는 다른 경로를 시도하지 않는다. 선택한 API는 같은 연결에서 유지하며 연결 해제/재연결에서 초기화한다.
- 웹 목록의 상세 요약 API가 404/405이면 현재 목록 페이지의 같은 메일 메타데이터와 실제 EML을 사용한다. 요약 API의 인증/권한 오류는 숨기지 않는다. 메타데이터 캐시는 현재 페이지 최대 100행만 보관한다.

사용자가 준 예제 전체를 실행한 것이 아니며, 이 API 주소가 실제 회사 서버에서 동작했다는 검증으로 간주하지 않는다. 브라우저 네트워크 설정도 PowerShell `-NoProxy`와 동일하다고 가정하지 않는다.

## 화면 배치

**중앙: 메일 목록 / 오른쪽: 선택한 메일 상세.** `Workbench`가 중앙 `MailHistory`에 실제 shell의 `detailHost`를 전달하고, `AuxiliaryDetail`이 선택한 메일의 `MailReader`를 공통 오른쪽 `desktop-selection-detail`에 렌더링한다. 위 API 변경은 이 화면 배치를 바꾸지 않았다.

실제 React 컴포넌트와 공통 상세 host를 합성 메일로 실행해 다음을 확인했다.

- 메일 상세가 중앙 목록 내부에 중복 렌더링되지 않고 오른쪽 aside에 한 개 표시됨.
- 중앙 목록과 상세의 좌표가 나뉘며, 다음 메일 이동에도 중앙 목록 스크롤 위치 유지.
- 파일 화면으로 전환/복귀할 때 파일 초안과 목록 위치 유지.
- 상세 닫기 후 늦은 메일 응답이 상세를 다시 열지 않음.

확인 이미지: `verification/auxiliary-detail-2026-10-23/mail-wide.png`. 이 이미지는 제품 공통 컴포넌트와 합성 API 자료를 사용한 검증 화면이며 실제 회사 메일/SSO 화면은 아니다.

## 검증

- 목록 API/EML 바이트/커서 변환/중복 페이지/경로 선택/세션 변경/기존 수집 연결을 포함한 관련 Node **69개 통과**.
- 메일 진단/세션 복구/인증 수명/원문 메타데이터 회귀 **30개 통과**.
- `check-auxiliary-detail.mjs`의 중앙 목록/오른쪽 상세와 복귀/모션/초기 연결 오류 복구 **6개 확인 통과**.
- `npm run build:electron` 통과. macOS에서는 기존 Windows Office parser 검사를 PowerShell 부재로 건너뛰며, 기존 CJS/import.meta 경고는 남아 있다.

사내 SSO 실계정, 실제 kor3 응답, Windows 브라우저/설치판은 미검증이다. 공통 main, 메일 소스 선택 및 기존 메일 상세 렌더러는 이번 API 후속 작업에서 수정하지 않았다.

## 모든 지원 첨부의 같은 오른쪽 읽기 흐름

TXT 읽기는 이미 활성화되어 있었다. 실제 CP949 바이트를 UTF-8로 잘못 표시한 MIME charset에서는 기존 strict decoder가 실패하는 경우를 재현해 고쳤다. 유효한 charset은 우선 사용하고, 실패한 경우 UTF-8/CP949 strict decoder를 확인한다. BOM은 계속 우선하며 깨진 BOM/바이너리를 정상 텍스트로 표시하지 않는다. 같은 decoder를 쓰는 다른 텍스트 형식에도 적용된다. 읽지 않은 첨부에는 `눌러서 첨부 내용 읽기`, 실패한 첨부에는 직접 다시 읽을 수 있는 안내를 표시한다.

`node scripts/check-auxiliary-detail.mjs --attachments`로 **13종 실제 합성 첨부**를 기존 저장/해시 확인/worker 및 mailDocument API에 통과시키고 실제 MailReader/DocumentPreview 클릭을 확인했다. TXT(CP949/잘못된 UTF-8 표시), Markdown, UTF-16 CSV, JSON, XML, HTML, ICS, PDF, DOCX, XLSX, PPTX, PNG, EML이다. 원본 메일/첨부 해시를 검증한 요청으로만 읽고 중앙 목록은 유지하며 오른쪽에서 표시한다. 이미지 항목은 실제 이미지 픽셀 미리보기 확인이며 AI 내용 이해/OCR 성공이라는 뜻은 아니다. Office는 이 macOS의 파서 텍스트 확인이며 Windows COM/원본 서식 일치 검증은 아니다.

관련 첨부 Node **31개 통과**, 위 API/인증 회귀와 합쳐 **130개 통과**. 화면 검사에서는 13종 첨부와 기존 6개 복귀/목록/모션 흐름이 통과했다. TXT 화면은 `verification/auxiliary-detail-2026-10-23/txt-attachment-right.png`, 전체 결과는 같은 폴더 `checks.json`이다. 임의의 모든 확장자, 암호 문서, 손상 파일이나 실제 이미지 모델의 지원을 주장하지 않는다.
