# Office 함수 목록을 개발과 검사에 활용하기

최신 기준은 [GenOffice 전체 작업/Office 2016 명세](../../docs/superpowers/specs/2026-10-16-document-agent-genoffice-parity-office2016.md)다. 공식 Excel 계산 함수 521개(2016 이전 후보 472개), Word/Excel/PPT 공식 VBA 문서 식별자 인덱스와 GenOffice 전체 172개 작업을 확보했다. 최신 문서 행 수는 Office 2016 함수 수가 아니다. 아래는 초기 조사/실행 이력이다.

2026-10-16 후속: 기존 GenOffice 작업 Word 45개, Excel 55개, PPT 62개를 수집했다. [기능 범위와 검증 공백](CAPABILITY-COVERAGE.md)에 새 모듈 연결, 계산 함수, 기존 문서 보존과 실제 실행을 나눠 기록했다. 이 수는 Office 전체 API 수나 검증된 기능 수가 아니다. 현재 앱별 고정 생성 과제 1종으로 일반 품질을 판정하지 않는다.

그 뒤 [파일 작업 연결](FILE-OPERATIONS.md)에 43개를 연결했고 서로 다른 입력 3회씩 최종 129개 실제 합성 파일 검사를 수행했다. 13개 계산 함수의 45개 로컬 계산과 실제 모델 복합 과제는 별도 기록이다. 나머지 119개는 최신 연결 표에 미연결로 남긴다. COM 함수 실행 성공과 혼동하지 않는다.

상태: 2026-10-15 공식 객체 모델과 기존 native 조회 소스를 대조하고 Word 읽기 어댑터를 구현했다. 기존 native 호출 계약을 사용하는 소스와 모의 프로토콜 연결 검사까지 완료했다. 설치된 Office 함수 목록 수집과 실제 COM 실행은 미검증이다.

## 세 가지 목록의 용도

| 목록 | 개발에서의 용도 | 확인할 수 없는 것 |
| --- | --- | --- |
| 공식 Office Object Model | 메서드/속성, 인자, 반환값과 읽기/쓰기 의미 확인 | 설치된 Office의 실제 지원과 회사 문서 접근 |
| 설치 Office의 COM type info/멤버 조회 | 실제 객체의 함수명, get/set/call 구분과 서명 확인 | 그 함수를 현재 문서에서 성공적으로 실행할 수 있는지 |
| 누비 지원 도구 계약 | 바인딩, 승인, 변경과 검증을 포함한 작업으로 제공 | Office 전체 기능 지원과 실제 작성 품질 |

## 첫 Word 부분 수정에 대응하는 API

| 목적 | 실제 객체 모델 | 적용 기준 |
| --- | --- | --- |
| 대상 구간 확보 | [Document.Range(Start, End)](https://learn.microsoft.com/en-us/office/vba/api/word.document.range) | 관찰한 문서와 실제 위치를 사용. 오래된 위치를 재사용하지 않음 |
| 텍스트 읽기/수정 | [Range.Text](https://learn.microsoft.com/en-us/office/vba/api/word.range.text) | 전체 문단 대신 가장 작은 관찰 구간을 변경. 문단/표 끝 마커를 보존 |
| 문자 서식 관찰 | [Range.Font](https://learn.microsoft.com/en-us/office/vba/api/word.range.font) | 새 문자열뿐 아니라 대상과 비대상 서식도 실제 readback |

`Range.Text`는 서식 없는 문자열을 반환한다. 따라서 텍스트 비교 하나로 서식 보존을 확인할 수 없다. 모듈의 `Run`은 관찰된 동일 서식 구간을 표현하는 DTO이며 Word COM에 같은 이름의 객체가 있다고 가정하지 않는다. Native 어댑터가 실제 Range/문자 서식을 읽어 이 구조를 만들고, 검증 때 다시 관찰해야 한다.

## 후속 앱의 대표 API

2026-10-16 신규 생성 범위: 선택 `./excel`, `./powerpoint`에 메모리 초안 생성과 평문 출력 구조 검사를 추가했다. 아래 COM API의 실제 실행 성공을 뜻하지 않는다. Excel은 내부 셀 참조/사칙 연산/비교/SUM/IF를 직렬화하며 PPT는 native text/table/notes를 생성한다. [생성 API와 제한](EXCEL-POWERPOINT-CREATION.md)을 따른다.

- Excel은 Range의 값/수식/서식을 분리한다. [Range.Formula](https://learn.microsoft.com/en-us/office/vba/api/excel.range.formula)로 실제 수식을 다루고 계산과 결과 값은 별도로 확인한다. 최신 Formula2 등은 설치된 Office 버전의 지원을 확인한다.
- PowerPoint의 부분 문구 수정은 [TextRange.Characters(Start, Length)](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.textrange.characters)로 작은 구간을 잡는 방식을 검토한다. 슬라이드 전체 재생성보다 수정 범위와 비대상 보존을 명확히 할 수 있다.

## 기존 구현에서 바로 재사용할 자산

`office_x/runtime-src/office-skill.ts`는 `inspect_office_members`와 `inspect_office`, `execute_office_operations`를 제공한다. `native/OfficeX.ExcelHost/OfficeMembers.cs`는 실제 COM `ITypeInfo/GetFuncDesc`에서 이름, get/set/call과 인자 정보를 조회하고 `live_office_type_info`로 표시한다. 영문 LCID 조회 뒤 기본 LCID로 재시도하고 native 노출 정책을 적용한다.

이 native 파일들을 복사하거나 수정하지 않고 [native-word.ts](src/native-word.ts)에서 조회/읽기 프로토콜을 재사용했다. 호스트가 바인딩한 `call`을 주입하면 `inspect_office_members`로 실제 서명을 조회하고 `inspect_office`로 작은 Word 본문 범위의 getter를 호출한다. `execute_office_operations`와 저장은 이 어댑터에 노출하지 않는다. [Windows 개발용 호스트](WINDOWS-WORD-READ.md)와 stdio 호출자도 소스로 준비했다. DLL/Word 실행과 설치된 VSTO/Workspace 연결은 미검증이다.

type library 조회 실패와 멤버 미존재는 같은 상태가 아니다. 메타데이터를 조회할 수 없어도 허용된 getter 결과로 읽기를 시도하고, 해당 getter도 실패하면 값을 만들어내지 않고 중단한다. 응답 잘림, 범위 불일치와 두 관찰 사이의 변경도 중단한다. 관찰된 글꼴 여섯 속성과 문단 다섯 속성 외의 전체 서식/레이아웃은 검증하지 않는다. [검증 기록](../../docs/research/2026-10-15-document-agent-native-word-read.md)에 현재 범위와 소스 대응을 남겼다.

## 검사 방식

먼저 필요한 멤버만 객체별로 조회한다. 읽기/쓰기를 구분하고 인자와 enum, 인덱스 기준을 명시한다. 예를 들어 Word의 `Range(Start, End)`와 PPT의 `Characters(Start, Length)`는 두 번째 인자의 의미가 다르다.

조회 결과를 호스트/Office 세션에 묶어 지원 작업을 결정한다. 문서 닫힘/재열기와 버전 변경 시 재확인한다. 반환값, 인덱스 오류, 미지원, 읽기 전용, 변경 뒤 실제 값/서식, 사용자 동시 편집과 응답 유실을 고정 과제로 검사한다.

함수 목록의 각 이름을 호출했다는 이유로 테스트를 통과시키지 않는다. `Delete`, `Save`, 매크로/외부 링크 등 부작용이 있는 기능은 자동 순회 호출하지 않는다. 합성 문서에서 정확한 입력/기대 결과와 승인/복구 범위를 정한 과제만 수행한다.
