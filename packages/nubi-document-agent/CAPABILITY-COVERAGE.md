# 문서 기능 범위와 검증 공백

2026-10-16. 초기 목표는 **GenOffice 전체 작업 172개를 연결/검증하고 Office 2016과 대조하는 것**이다. 원본의 모델 공개 162개 외에 PPT 호스트 전용 10개, Excel 에디터 전용 8개도 분모에 남긴다. 최신 [전체 대상](eval/capabilities/genoffice-parity-target.json), [실제 실행 원장](eval/capabilities/genoffice-execution-coverage.json), [확장 결과와 최초 실패](../../docs/research/2026-10-16-document-agent-genoffice-parity-progress.md)를 따른다.

| 앱 | 전체 작업 | 실제 새 평문 파일로 3회 검증 | 실제 에디터 실행 대기 |
| --- | ---: | ---: | ---: |
| Word | 45 | 45 | 0 |
| Excel | 55 | 55 | 0 |
| PPT | 72 | 72 | 0 |
| 합계 | 172 | 172 | 0 |

직접 연결 151개, 호스트 그림 자산 6개, 호스트 payload 7개, 선택 호스트 에디터 8개다. 자산/자료/에디터 작업은 호스트가 필요한 능력을 주입할 때만 노출한다. Word 워터마크의 텍스트/그림 두 변형을 포함해 총 173개 검사 변형 × 3회 = **519/519**다. 독립 구조/값 검사, 원천 바이트 불변, 비대상 보존과 원본 엔진 재열기를 확인했다. 모든 인자 조합, 업무 모델 품질이나 실제 Office 지원률로 해석하지 않는다. GenOffice 3D는 GLB와 미리보기 그림을 넣는 구현이다.

## 목록을 분리한다

| 목록 | 현재 근거 | 의미 |
| --- | --- | --- |
| Microsoft 객체, 메서드와 속성 | [Word](https://learn.microsoft.com/en-us/office/vba/api/overview/word/object-model), [Excel](https://learn.microsoft.com/en-us/office/vba/api/overview/excel/object-model), [PowerPoint](https://learn.microsoft.com/en-us/office/vba/api/overview/powerpoint/object-model) | 업무 기능을 빠뜨리지 않기 위한 기준. 최신 문서의 모든 멤버가 Office 2016에 있다는 뜻은 아님 |
| Excel 워크시트 계산 함수 | [WorksheetFunction](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheetfunction) | SUM, 조건 집계, 검색, 날짜 등 계산 기능. 자동화 메서드 수와 합산하지 않음 |
| 설치된 Office 멤버 | 기존 Office X COM type info 조회 | Windows에서 실제 수집 필요. 현재 미수집 |
| 기존 GenOffice 작업 카탈로그 | 아래 JSON 스냅샷 | 재사용 가능한 파일 엔진 작업의 이름과 서명. Office 전체 API 목록이 아님 |
| 새 독립 모듈 지원 계약 | 현재 생성 스키마와 native 읽기 포트 | 제품에서 실제 허용한 기능. 원본 엔진에 있는 기능을 자동으로 상속하지 않음 |
| 실제 실행 결과 | 개별 과제와 산출물, 오류, readback | 해당 조건에서 확인한 동작. 목록 조회나 소스 존재로 대체하지 않음 |

## 원본 재사용과 목록의 출처

고정 GenOffice revision은 `438d9c65709952490c970beaa2599ef45e74431f`다. Word/Excel은 기존 Office X 실행기를 사용하고 PPT는 원본 CLI/atomic executor를 빌드했다. 숨겨진 PPT 복사 자료도 원본 엔진의 `copySlide`, `copyElementData`, `extractMergeSlideSource`로 추출했다. 새 합성 평문 파일만 대상으로 삼았다.

[Word 공개 목록](eval/capabilities/docs.json), [Excel 목록](eval/capabilities/sheets.json), [PPT 공개 목록](eval/capabilities/slides.json)은 출처 자료다. [coverage.json](eval/capabilities/coverage.json)의 162행은 연결 전 역사적 기준선이다. `connected-coverage.json`은 현재 172행 실행 원장을 가리킨다. 원본 카탈로그를 수집하거나 소스가 있다는 이유로 실행 성공을 세지 않는다.

GenOffice의 기존 Rust sidecar 28개 파일을 원본 해시 그대로 빌드해 IronCalc 0.7.1 계산을 연결했다. 실행 파일과 dependency closure는 호스트가 제공한다. 현재 패키지에 별도 Office 프로세스, 인증 저장소나 새 계산 런타임을 번들하지 않는다. 기존 Office X 제품 정책과 별개인 이 모듈의 호스트 자산 포트는 새로 생성한 초안 자료에만 사용한다.

## 현재 기능군과 다음 확인

| 앱 | 실제 파일로 확인한 기능군 | 남은 확인 |
| --- | --- | --- |
| Word | 본문/문자/문단/스타일/목록, 표 행열/병합/서식, 구역/용지/머리글/바닥글, 필드/목차/책갈피, 그림/텍스트 상자/차트/워터마크, 주석/변경 추적/각주/미주 | 중첩 표와 복잡한 병합, 전체 스타일 상속/표시, 다중 구역 조합, 기존 회사 양식과 실제 Office |
| Excel | 셀/범위/수식, 정렬/필터/보호, 행열/시트, 서식/병합/이름/입력 제한/조건부 서식, 표/차트/도형/그림/스파크라인/피벗 생성과 새로고침, 표 행열/삭제와 도형 편집/삭제 | 모든 함수/참조 문법/인자 계산, 복잡한 구조 변경 후 참조와 보존, 새 에디터 작업의 복합 모델/실제 Office |
| PPT | 텍스트/문단, 도형/연결선/자유 경로/그룹, 표/차트/그림/SmartArt, 슬라이드/레이아웃/테마/구역, 노트/주석/전환/애니메이션, 호스트 자료 복사/삽입 | 더 넓은 레이아웃/차트/SmartArt 조합, 전체 시각/재생 품질, 편집 가능한 native 3D, 기존 회사 마스터와 실제 Office |

Excel 공식 목록은 521개 중 Office 2016 후보 471개다. 기본 저장 검사 1,377건 중 1,372건을 통과하고 5건은 참조/경계 대기다. 기본 계약을 3회 통과한 456종 가운데 ETS 3종은 Microsoft 공개 예제에서 수치가 달라 [함수 원장](eval/capabilities/formula-execution-coverage.json)의 `cached_excel_numerical_gap`으로 보류한다. 현재 실행 상태는 검증 계약 통과 453종, ETS 수치 공백 3종, 경계 의미 대기 2종, PHONETIC 공백 1종, 실제 호스트 필요 12종이다. [후속 실행 결과](../../docs/research/2026-10-16-document-agent-missing-functions-execution.md)는 새 147건 통과와 공식 예제 3/150 통과를 구분한다. 모든 인자/CSE 배열/Office 검증은 아니다.

이전 106종 중심의 327회 계산/변환 회귀와 GenOffice/IronCalc 312/327은 별도 근거다. IronCalc의 5종 차이 15건을 새 Univer 성적으로 소급 지우지 않는다. 선택 엔진의 실제 계산 경로이며 기본 엔진의 자동 fallback은 아니다. 이름/구조화/교집합/3D 참조, CSE 배열 결과, 동적/외부/큐브 전체는 미완료다.

선택 에디터의 `refresh_pivot`, `add_table_row`, `add_table_column`, `delete_table_row`, `delete_table_column`, `delete_table`, `edit_shape`, `delete_visual`은 원본 GenOffice 편집 함수/저장기와 실제 Univer로 실행했다. [호스트 포트](FILE-OPERATIONS.md)와 [24회 파일/21회 경계 검사](../../docs/research/2026-10-16-document-agent-univer-editor-execution.md)를 따른다. 새 초안의 표/단순 도형을 private journal에 등록하며 일반 회사 파일 지원으로 확대하지 않는다. 목록/모의 호출이 아니라 저장된 파일과 실제 읽기 관찰의 ID를 검사했다.

단순 시트 복사의 인쇄 영역/반복 머리글은 복제하지만 사용자 정의 로컬 이름, 표/그림/피벗이 있는 복사까지 보장하지 않는다. Word 선언형 HTML도 제한된 정적 태그/서식만 허용한다. 자세한 인자와 크기 제한은 [호출 계약](FILE-OPERATIONS.md)과 각 실행 원장의 실제 입력을 따른다.

## 검증 과제의 구성

각 기능을 도입할 때 다음 과제를 함께 고정한다. 파일 형식 검사를 통과해도 모델이 올바른 기능을 선택했는지와 Office에서 실제 작동했는지는 각각 채점한다.

1. **직접 기능 검사**: 합성 입력으로 한 기능을 실행하고 실제 값/수식/구조/서식을 독립 도구로 읽는다. API가 예외 없이 반환됐다는 사실만으로 통과시키지 않는다.
2. **복합 업무 검사**: 필요한 기능을 요청에 직접 알려주지 않은 과제로 모델의 선택, 배치와 사실 정확성을 평가한다. 고정 주소와 수식을 알려 준 현재 Excel 보고서는 여기에 충분하지 않다.
3. **기존 문서 수정 검사**: 변경할 대상과 비대상 구조/서식/사실을 따로 비교한다. 신규 생성 결과로 기존 회사 양식 보존을 통과시키지 않는다.
4. **경계와 복구 검사**: 빈 값, 긴 문맥, 중복 대상, 미지원 기능, 보호 문서, 동시 편집과 응답 유실을 포함한다. 미확정 쓰기를 재전송하지 않는다.
5. **저장 후 재열기와 렌더**: Excel은 입력 변경 뒤 재계산, Word/PPT는 전체 페이지 표시와 편집 가능 개체를 확인한다. LibreOffice와 실제 Office 결과는 분리한다.

각 과제 기록에는 `domain`, 기능/operation 이름, 지원 버전, 생성/읽기/수정 구분, 원본/후보 해시, 모델, 반복 번호, 최초 결과, 복구 결과, 산출물/readback, 미지원/미실행 이유를 둔다. 미지원과 실패를 계획한 과제 분모에서 빼지 않는다. source/fixture/live-model/LibreOffice/Windows Office 2016/NASCA 근거를 별도 필드로 유지한다.

## 모델과 실제 환경의 별도 검증

기능을 먼저 조회하고 필요한 정확한 schema/인자를 읽는 원본 패턴을 재사용한다. 현재 앱/문서/버전과 호스트 능력에 맞는 작업만 노출한다. 파일 엔진의 편집 ID나 좌표를 Office COM 핸들로 전달하지 않는다.

요구사항에서 모델이 직접 구성을 정하는 새 복합 업무 3종 × 앱 3종 × 모델 2종 × 3회 = 54회는 [별도 비교 기록](../../docs/research/2026-10-16-document-agent-dual-business-comparison.md)에 남긴다. 최초 결과와 검증 근거에 따른 수정을 분리하고 익명 검토의 불일치도 유지한다. 작은 과제의 반복을 전체 작성 품질로 확대하지 않는다.

Windows Office 2016, COM 저장/재열기, NASCA와 Workspace 애드온 연결은 실제 환경에서 확인할 단계다. 보호 문서는 열린 Office native 경계를 유지한다. macOS에서 암호화 파일을 직접 파싱하는 경로는 만들지 않는다.
