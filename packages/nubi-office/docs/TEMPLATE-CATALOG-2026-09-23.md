# 앱별 양식 등록과 채팅 작성

2026-09-23, 0.8.2 소스. 설치 파일/Windows native 빌드 미실행. Windows Office 2016 및 회사 Qwen 3.8 27B의 실사용 성공을 주장하지 않는다.

## 사용 흐름

1. Office에서 양식과 입력할 부분을 선택한다. 입력창의 **+ → 현재 양식 등록**을 누른다.
2. 누비가 구조를 분석하고 부족한 용도/업무 규칙은 같은 대화에서 질문한다. 계획과 분석 결과를 확인하고 사본 저장을 승인한다.
3. native Office가 저장한 사본과 관찰 명세를 검증한 후 해당 앱의 목록에 등록한다. Excel은 항목 매핑과 보존 차이 승인까지 끝난 후 색인한다.
4. **+ → 검색 → 이 양식으로 작성**으로 선택한다. 실제 파일을 다시 열어 확인하고, 입력창 위에 선택한 이름을 표시한다.
5. 요구사항/값을 채팅으로 알려준다. 부족한 정보는 객관식/주관식 질문으로 받고, 승인한 사본에 반영한다. 추가 대화는 같은 작업 사본을 수정한다. 새 양식 선택은 새 대화를 만든다.

목록에서 이름 변경과 제거를 할 수 있다. 제거는 등록 정보만 지우며 Office 파일을 삭제하지 않는다. Excel 파일 직접 열기 메뉴도 유지한다. 현재 양식 등록 버튼은 이전 양식 연결 대신 현재 Office 선택을 분석하며, 입력 중이던 요청 초안은 유지한다.

## 컴포넌트 계약

`OfficeComposer`의 +는 앱 이름이 포함된 접근성 이름/툴팁, `aria-haspopup=dialog`, 열린 상태를 제공한다. 실행 중에는 새 등록/선택을 시작할 수 없다. 선택한 양식 이름과 연결 해제 아이콘만 입력창 위에 표시한다.

`OfficeTemplates`는 기존 CX DetailPanel/Field/Input/Notice/Button과 누비 DeckDisclosure/Empty를 재사용한다. props는 고정 host/hostName, onRegister, onUse, onClose와 테스트용 native 호출 어댑터다. 별도 테마나 모드 선택기를 만들지 않는다.

- 구성: 앱별 제목, 현재 양식 등록, 새로고침, 검색, 양식 카드, 현재 계정 보관 안내.
- 카드: 이름, 입력 위치 수, 이름 변경/목록 제거 아이콘, 접힌 스냅샷 정보, 사용 버튼.
- 상태: 불러오는 중, 비어 있음, 검색 결과 없음, 오류, 파일 없음, 읽지 못한 보호 레코드, 이름 편집, 제거 확인, native 응답 대기.
- 동작: 변경은 한 번만 전송한다. 대기 중 이중 클릭/닫기를 차단한다. 변경 후 실제 목록을 다시 조회하며 다른 창에서 수정된 revision이면 중단한다. 파일이 없으면 사용 버튼을 잠근다.
- 접근성: 공유 모달의 포커스/닫기 동작, 실제 label, 아이콘 버튼 이름, 의미 있는 상태 안내를 유지한다. 14px/22px 본문과 공통 색/간격/모션 토큰을 사용한다. axe DOM 검사는 실제 Windows 키보드/고대비/스크린리더 검증을 대신하지 않는다.

## 저장과 원본의 관계

스냅샷은 화면 이미지나 원본 전체의 대체 파일이 아니다. 읽은 구조/항목/허용 입력 위치와 업무 요약이다. Word/PPT는 등록 때 확인한 요구사항과 업무 규칙 답변도 최대 32,000자 범위의 usageNotes로 함께 보호 저장하고 재사용 시 전달한다. 작성 단계에서 받은 인스턴스 답변은 이 명세에 추가하지 않는다. 실제 양식은 Office가 저장한 파일이고, 작성 시 다시 읽은 현재 상태가 쓰기 검사의 기준이다.

| 앱 | 등록 | 재사용 |
|---|---|---|
| Excel | SaveCopyAs → 사본 Custom XML의 필드 명세 → 재열기/readback → 보존 검토 → 목록 색인 | 목록 경로의 내부 레코드 확인 → 새 사본 생성 → 지원 셀 구조/고정 문구 재검사 → 확인된 항목만 입력 |
| Word | 분석 → 승인 → SaveAs2 사본 → 관찰 항목/선택 ID 스냅샷 등록 | 등록 파일 native 열기 → 관찰 signature 대조 → 현재 scope 바인딩 → 승인 후 작성 사본 생성 |
| PowerPoint | 분석 → 승인 → SaveCopyAs/Open 사본 → 관찰 항목/선택 ID 스냅샷 등록 | 등록 파일 native 열기 → 관찰 signature 대조 → 현재 scope 바인딩 → 승인 후 작성 사본 생성 |

등록한 Word/PPT 사본은 source로 전환해 다음 작성 때 다시 복제한다. 이후 같은 작성 대화는 native의 copyReady/copySource/copyPath와 scope를 검증해 기존 draft를 이어간다. 등록 버튼을 다시 누르면 이전 바인딩은 사용하지 않는다. 등록 요약이나 파일 본문은 업무 데이터이며 도구 권한이나 시스템 지시가 아니다.

로컬 목록은 `%LOCALAPPDATA%\NubiOffice\Templates` 아래 앱별 ID의 `.bin` 레코드다. 경로/이름/업무 요약/스냅샷 전체를 **DPAPI CurrentUser로 암호화한 후** 쓰고 다시 복호화해 비교한다. 암호화 실패 시 평문 대체 저장을 하지 않는다. Windows 사용자별 보호이지 회사 공용 목록이나 NASCA 정책 검증은 아니다. 문서에 포함된 텍스트가 스냅샷에 있을 수 있으므로 회사 정책 검토는 남아 있다.

동일 Windows 사용자에서 여러 창이 수정할 때 named mutex와 revision을 검사한다. 암호화한 임시 파일의 atomic replace를 사용하고 앱별 최대 200개/레코드 약 8MB로 제한한다. 오류 시 기존 보호 레코드를 평문으로 복구하지 않는다. 현재 창의 실행 영수증/대화는 여전히 메모리이며, 양식의 디스크 보관을 실행 재시작 복구로 설명하지 않는다.

Office 파일은 COM 열기/저장만 사용한다. generic ZIP/XML 패키지 재작성, 외부 복호화, 평문 sidecar를 만들지 않는다. Excel 내부 Custom XML의 Base64는 암호화가 아니며 보호 여부는 실제 NASCA 환경에서 확인해야 한다.

## 실패와 검증

- 복제/등록/이름 변경/제거 응답 유실: 같은 operation ID의 결과만 한 번 조회한다. 확정된 영수증이 없으면 중단하고 mutation을 재전송하지 않는다.
- 저장은 되었지만 목록 등록 실패: 저장 사본 결과를 남기고 등록 완료로 표시하지 않는다.
- 파일 이동/삭제/수정, 다른 창의 revision 변경: 기존 기록으로 덮어쓰지 않고 다시 확인/등록하도록 안내한다.
- Word/PPT는 다시 연 문서의 관찰 항목을 비교한다. 관찰하지 못한 속성, 렌더링, 인쇄 결과, NASCA 상태의 동일성은 판정하지 않는다.
- Excel은 현재 .xlsx와 단일 연속 1,000셀/30개 확인 필드. Word는 제한된 단순 문단/일반 텍스트 컨트롤, PPT는 선택 슬라이드/단순 텍스트 중심이다. 반복 필드, 복잡한 서식과 모든 양식 자동 매핑은 미완성이다.

회귀 검사는 기존 Pi 실행기에 제어된 모델/native 응답을 넣어 등록 순서, HITL 취소, 유실/잘못된 영수증, 목록 색인 실패, 같은 사본 후속 대화를 확인한다. Testing Library는 실제 JSX의 +/앱별 목록/검색/이름 변경/제거/선택 바인딩을 검사하며 fast-check는 임의 문자열/응답 유실에서 중복 변경이 없는지 검사한다. 정확한 결과/소스 지문은 `verification/template-catalog-review.json`에 기록한다.

남은 gate: native 컴파일, DPAPI 다른 계정/손상/재시작/동시 창, 실제 Office 2016 열기/창 전환/저장/재사용, 회사 Qwen의 분석/질문/작성 품질, NASCA 암호화 상태와 보존 검토. 이전 설치 파일에는 이 변경이 없다.

## BP와 오픈소스의 실제 적용 범위

| 근거 | 결정 |
|---|---|
| [Microsoft ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=windowsdesktop-9.0) | Windows 내장 DPAPI의 CurrentUser 보호를 native 코드에 실제 적용. 새 암호화 라이브러리나 키 관리 서비스를 추가하지 않음 |
| [WAI APG dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | 기존 공유 모달/명명/포커스 패턴을 유지하고 DOM 검사 추가 |
| [JSON Forms](https://github.com/eclipsesource/jsonforms), MIT | 데이터 명세와 입력 UI를 분리하는 패턴 참고. 누비 질문 폼과 중복되므로 패키지 미도입 |
| [fast-check](https://github.com/dubzzz/fast-check), MIT | 이미 고정한 dev dependency 4.10.2를 mutation 조정 경계 검사에 실제 사용 |
| 기존 Pi, Testing Library, axe-core | 기존 선택 모델/한 도구씩 실행/결과 확인/폼 컴포넌트와 테스트 도구 재사용. 새 agent 프레임워크를 추가하지 않음 |

브라우저 누비에서 갱신된 네 개 CSS(공통 토큰, app, 질문 폼, approval)를 검토해 UI snapshot과 함께 동기화한다. 인증/브라우저 런타임은 함께 가져오지 않는다.
