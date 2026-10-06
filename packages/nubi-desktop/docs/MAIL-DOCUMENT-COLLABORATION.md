# 메일 첨부를 누비별로 읽고 Workspace로 돌려주는 설계안

2026-10-01 사용자 명시 요청으로 A2A 검증과 누락 기능을 구현 범위에 포함했다. Workspace/Chrome peer 작업과 Office 초안 receiver는 이후 활성화하고 로컬 SDK 왕복을 검사했다. **메일 첨부의 인증된 bytes 전달과 범위별 분석 결과는 아직 미구현이다.** `packages/nubi-a2a`의 공식 SDK 기반 전송을 재사용하며 첨부 바이트/범위별 분석 영수증까지 완료해야 한다. 초안/조회 왕복을 첨부 협업 완료로 표시하지 않는다.

## 사용 흐름

1. Workspace가 POP3 메일과 첨부 원본을 private 저장소에 보관한다.
2. 사용자가 연결한 누비들의 현재 읽기 기능을 확인하고 형식별 분석 요청을 큐에 등록한다. PDF는 브라우저 누비, XLS/XLSX는 Excel 누비, DOC/DOCX는 Word 누비, PPT/PPTX는 PowerPoint 누비가 맡는다. 첫 연결에서 첨부 읽기 범위와 모델 목적지를 보여주며 이후 같은 범위의 읽기만 이어간다. 수정/저장/발송 승인은 확대하지 않는다.
3. 브라우저/Office는 Workspace의 작업을 가져와 기존 읽기와 Pi 문서 분석으로 처리하고 구조화된 결과를 반환한다. 기존 사용자 채팅을 덮어쓰거나 메일 본문을 새 사용자 요청으로 만들지 않는다.
4. Workspace는 source hash와 실제 읽기 범위, 결과 Task/Artifact를 검증해 personal Wiki에 요약, 요청, 문서 간 관계와 출처를 연결한다. 부분 결과는 보존하고 빈 범위를 따로 대기시킨다.

## 앱별 읽기와 근거

| 담당 | 기존 재사용 경로 | 반드시 반환할 근거와 미확인 범위 |
| --- | --- | --- |
| 브라우저 누비 | `parseBrowserPdf`, PDF worker, 페이지 참조 이미지, `ask_documents` | 총 페이지/읽은 페이지, 페이지별 텍스트 인용/해시, 텍스트 없는 페이지. 스캔은 이미지 지원 모델/OCR 지원을 별도 확인하며 텍스트 추출 성공으로 이미지 이해를 주장하지 않는다. |
| Excel 누비 | native `workbook_sheets`, `read_worksheet_range`, 동일 모델 read-only specialist 분석 | 전체 시트 목록과 visibility, 실제 읽은 셀 주소, 값/수식/표시 값, 수식의 시트 참조. UsedRange나 첫 시트 미리보기만으로 전체 분석을 표시하지 않는다. 시트별 순차 읽기는 atomic snapshot이 아니다. |
| Word 누비 | 문단/표/native scope와 읽기 페이지 분할 | 문단 ID/범위, 표/셀 인용, 실제 지원한 story 범위. 머리말/꼬리말, 변경 추적, 이미지, 각주/삽입 개체 등 미지원 부분을 구분한다. “뭐든 읽음”을 전제하지 않는다. |
| PPT 누비 | SlideID/Shape.ID, 도형 텍스트, 서식 run, 발표자 노트 | 전체 슬라이드 목록, 읽은 SlideID/Shape.ID/노트, 숨긴 슬라이드 여부. 차트/SmartArt/이미지/삽입 개체는 실제 지원한 metadata와 시각 분석을 구분한다. |

NASCA와 legacy Office는 실제 Office가 열고 COM으로 읽는 경로를 유지한다. Workspace나 외부 ZIP/Python parser로 복호화하거나 회사 원본을 재저장하지 않는다. 승인된 첨부를 별도 native 문서에 바인딩하고 기존 사용자가 편집 중인 문서와 섞지 않는다. 첫 열기에서 매크로, 외부 링크 업데이트와 실행을 막는 native 계약이 필요하다.

## 전송 계약

- 공식 A2A Task/Artifact로 요청, 진행 상태, 질문, 취소와 결과를 전달한다. 브라우저 MV3가 로컬 수신 서버를 열지 않고 Workspace 조정 서버를 조회하는 기존 방식이 적합하다.
- 파일은 A2A FilePart 참조 또는 호스트가 발급한 인증된 loopback 파일 handle로 전달할 수 있다. arbitrary 파일 경로/URL을 모델이 만들거나 가져오게 하지 않는다. attachmentId, 실제 source SHA-256, MIME, 크기, 특정 recipient, taskId, 만료와 최대 다운로드 바이트에 묶는다. API 인증은 모델/문서/로그로 전달하지 않는다.
- `document-analysis-v1` 결과에는 requestId/taskId, attachmentId/sourceHash, host/nativeReaderVersion, model fingerprint, expected/read/unread 범위, 인용, 사실/발신자 주장/추론 구분, limitations, relations와 증거 ID를 넣는다.
- 관계는 문서에서 관찰한 직접 관계(수식 참조, 명시된 프로젝트명 등)와 모델이 제안한 의미 관계를 구분한다. 예: PDF 계약의 납기 문장 ↔ Excel `일정!D12` ↔ PPT SlideID 24의 일정 도형. 이름 유사도만으로 확정하지 않는다.
- 저장 원본 해시와 Office 읽기 전후 문서 fingerprint가 달라지면 오래된 결과로 격리한다. NASCA 암호화 바이트 해시와 native 읽기 fingerprint는 같은 종류의 해시로 비교하지 않는다. 신뢰한 호스트가 원본/열린 문서의 바인딩 영수증을 반환해야 한다.
- idempotency는 `(attachmentId,sourceHash,readerVersion,analysisRequestHash)`로 관리한다. 응답 유실은 GetTask/영수증을 조회하며 원본 열기나 읽기 요청을 맹목 재전송하지 않는다. 사용자가 취소한 작업은 자동 재개하지 않는다.
- 앱이 없거나 꺼져 있으면 `waiting_for_host`, 지원하지 않는 내용은 `partial`, 모델/권한이 부족하면 `input_required`로 남긴다. 대기 중에도 메일 수집은 계속한다.

## 단계와 검증

1. 브라우저 누비 PDF 하나: authenticated attachment handle → 기존 PDF worker → page-cited 분석 → Workspace read-only artifact 저장. 전 페이지 coverage와 재시작/취소/파일 변경/응답 유실 검사.
2. Excel 첨부 하나: 승인된 native open → 시트 목록 → 필요한 모든 범위 순차 읽기 → 수식 참조와 실제 셀 근거 반환. 실제 Windows Office 2016/NASCA에서 독립 비교.
3. Word/PPT native 분석과 coverage, 기존 열린 문서/수정 상태 보존.
4. 메일↔여러 첨부 관계 정리와 반복 수집. 분석 결과를 재사용하되 변경된 원본은 다시 읽는다.
5. 별도 사용자 규칙을 기존 Pi 스킬/HITL 작업으로 연결. “답신”은 먼저 누비 간 분석 결과 회신이며 실제 이메일 발송은 별도 SMTP/승인 범위다.

프로토콜만 연결한 검사, synthetic 결과, 실제 원문 읽기, 실제 모델 품질과 Office 전체 문서 coverage는 각각 분리해 기록한다. 전 문서 구조를 읽었다는 것과 의미를 빠짐없이 이해했다는 것은 별도의 검증이다.

근거: [공식 A2A specification](https://a2a-protocol.org/latest/specification/), `packages/nubi-a2a/README.md`, `extensions/aipro-chat/browser-pdf-parser.js`, `packages/nubi-office/docs/OFFICE-2016-SPECIALIZATION.md`와 실제 native/worker 읽기 도구.

## 필수 구현 범위와 완료 조건

사용자 요청: “a2a프로토콜로 정상 동작하는지 확인해보자 안되어 있으면 구현범위로.” 프로토콜 검사를 완료하고, 아래 누락 항목을 필수 구현 범위로 확정했다. 이번 기록 자체로 앱의 비활성 가드를 제거하지 않는다.

- Workspace 조정 서버와 Chrome/Office 수신 연결을 각 앱의 기존 채팅과 공통 CX 모달에 연결한다. 수신자별 단일 사용 초대와 전용 인증, 만료/재연결/격리를 유지한다. 승인된 읽기 범위 밖의 자동 실행은 막는다.
- 인증된 첨부 handle 또는 A2A FilePart 전송을 구현한다. POP3에 실제 보관된 bytes/hash/MIME/크기를 확인하고 작업/수신자/만료/용량에 묶는다. 외부 주소나 모델이 만든 경로를 사용하지 않는다.
- 브라우저 PDF, Excel 전체 시트, Word 지원 story/표, PPT 전체 슬라이드/노트를 각각 기존 읽기 실행기에 연결한다. 서버 송신이나 파일 다운로드 완료를 분석 완료로 표시하지 않는다. Office 원본 열기와 native 바인딩/외부 링크/매크로 억제는 필수다.
- Task 진행과 부분/실패/질문/취소, document-analysis-v1 Artifact를 Workspace에 반환한다. 실제 읽은 범위와 총 범위, 인용/해시, 직접 관계/추정 관계, 미지원 부분을 구분한다.
- 결과 수신 전에 원본 해시와 host 문서 fingerprint를 재확인하고 personal Wiki의 기존 사용자 편집을 보존한다. 동일 분석 영수증은 재사용하고 취소/미확정 작업을 자동 재전송하지 않는다.
- E2E는 실제 호스트 수신과 분석 결과 반환, 수신자 격리, 토큰 만료, 중복 전달, 원본 변경, 미지원 파일, 호스트 오프라인과 응답 유실을 검증한다. 실제 Windows Office 2016/COM/NASCA와 실모델 검사는 별도 필수 검증이다. 이번 요청을 installer/native 최종 빌드 요청으로 해석하지 않는다.

현재 검증 결과와 증거는 [A2A 검증 기록](A2A-VALIDATION-2026-10-01.md)에 있다.
