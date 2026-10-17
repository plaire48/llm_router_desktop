# 문서 모듈 1차 목표: GenOffice 전체 작업과 Office 2016 기준

2026-10-16 후속: [8종 계산 연결과 공식 예제 대조](../../research/2026-10-16-document-agent-missing-functions-execution.md)에서 기본 계약 456종과 ETS 추가 수치 공백 3종을 분리했다. 현재 통과 상태 453종과 남은 18종을 전체 인자/Office 성공으로 확대하지 않는다.

2026-10-16 사용자 결정: 초기 목표는 GenOffice가 지원하는 기능을 Word, Excel, PowerPoint 모두에서 제공하는 것이다. 작은 함수 목록과 쉬운 사례의 성공으로 완료하지 않는다. 기존 구현을 기반으로 연결하고 기능별 실행, 복합 업무와 실패 복구를 확인한다. 이번 결정은 기존 직접 구현과 검증 승인을 이어간다.

후속 함수 검증: 기존 후보 472개에서 Microsoft 365 전용 STOCKHISTORY를 공식 페이지 근거로 정정해 현재는 471개다. [함수별 실제 원장](../../../packages/nubi-document-agent/eval/capabilities/formula-execution-coverage.json)과 [1,377개 실행/수정 결과](../../research/2026-10-16-document-agent-office2016-function-matrix.md)는 해당 계약 3회 통과 448종과 계산 실패 8/메타데이터 1/경계 대기 2/호스트 필요 12종을 유지한다. 아래 472개와 327회는 이전 확보/검증 시점의 근거이며 전체 함수 완료로 소급 해석하지 않는다.

## 목표와 기준 목록

1차 구현 분모는 고정 GenOffice `438d9c65709952490c970beaa2599ef45e74431f`의 문서 작업이다. 현재 전체 목록은 **Word 45, Excel 55, PPT 72개, 합계 172개**다. 이전 162개는 모델에게 공개된 카탈로그만 셌으며, PPT 호스트 전용 10개를 빠뜨렸다. 전체 목록에는 이미지 바이트, 미디어, 복사한 개체 등 호스트가 자료를 제공해야 하는 작업도 남긴다.

원본: [전체 구현 대상](../../../packages/nubi-document-agent/eval/capabilities/genoffice-parity-target.json). Excel의 에디터 전용 8개도 분모에 포함한다. 현재 headless 어댑터가 호출할 수 없다는 이유로 완료 대상에서 빼지 않는다. 실제 에디터/호스트 포트가 필요하며, 연결과 실행을 별도로 구현한다. Office 2016과 맞지 않을 가능성이 있는 3D 개체 등은 버전 근거를 확인하고 호환 방법과 제한을 기록한다. 검증 없이 Office 2016에서 된다고 표시하지 않는다.

이 172개는 Microsoft Office 전체 함수 개수가 아니다. Excel 계산 함수는 별도 분모다. Word/PPT의 본문, 서식, 표, 그림과 도형, 구역, 주석 등은 객체의 메서드와 속성으로 비교한다.

## Office 2016 대조 근거

| 대상 | 공식 기준 | 이번 확보 범위 |
| --- | --- | --- |
| Excel 계산 함수 | [Microsoft 함수 목록](https://support.microsoft.com/en-us/excel/excel-functions-alphabetical) | 이름 521개. 버전 표기로 2016 이전 후보 472개, 이후 49개 구분. 버전 미표시를 설치판 지원 확정으로 간주하지 않음 |
| Word 객체와 멤버 | [Word 객체 모델](https://learn.microsoft.com/en-us/office/vba/api/overview/word/object-model) | 공식 문서 식별자 6,226행 |
| Excel 객체와 멤버 | [Excel 객체 모델](https://learn.microsoft.com/en-us/office/vba/api/overview/excel/object-model) | 공식 문서 식별자 5,996행 |
| PPT 객체와 멤버 | [PPT 객체 모델](https://learn.microsoft.com/en-us/office/vba/api/overview/powerpoint/object-model) | 공식 문서 식별자 2,812행 |

객체 모델 문서 행에는 객체, 속성, 메서드와 enum이 섞여 있다. 현재 문서의 인덱스이므로 이 숫자를 Office 2016의 함수 수로 표시하지 않는다. MicrosoftDocs/VBA-Docs tree `604bdf2064c1eb56d723184fff2681bda5aaa348`과 각 문서 blob SHA를 고정했다. 원본 파일 해시, 링크와 버전 확인 상태는 `eval/capabilities/official-*-api-index.json` 및 `official-excel-functions.json`에 있다.

Windows가 준비되면 기존 native COM 멤버 조회를 재사용해 실제 설치판의 서명, get/set/call, 인자와 반환 타입을 대조한다. `16.0`이라는 Application.Version 값만으로 영구 라이선스 Office 2016과 Microsoft 365를 구분하지 않는다. 제품명, 빌드, 앱, 비트 수와 실행 환경을 함께 기록한다.

## 기능별 완료 조건

각 작업은 원본 이름과 서명, 대응 Office 객체, 버전 근거, 호스트 전제, 연결 상태, 지원 인자 범위와 실행 근거를 가진다. 다음을 모두 확인해야 해당 범위에서 완료다.

1. 원본 GenOffice 엔진에 연결한다. 새 모델/인증/승인/실행 루프를 중복 소유하지 않는다.
2. 서로 다른 입력 3회에서 실제 결과와 비대상 보존을 독립 검사한다. 인자 일부만 검사했으면 그 범위를 남긴다.
3. 저장 후 다시 열어 실제 값, 수식, 서식 또는 편집 가능한 개체를 확인한다. Excel은 입력 변경 후 계산 결과까지 본다.
4. 관련 복합 업무에서 Codex와 Claude Code가 기능을 올바르게 선택하고 실패를 수정하는지 비교한다. 최초 실패와 복구 결과를 분리한다.
5. Windows Office 2016과 NASCA 결과는 실제 환경에서 별도 확인한다. 로컬 파일 검사는 이 확인을 대신하지 않는다.

누락된 항목은 담당 구현 경로와 다음 검사를 가진 작업으로 남긴다. `미지원` 한 줄을 완료 상태로 두지 않는다. 읽기 전용/기능 부재/환경 부재/실행 실패/검증 대기는 구분하며 실패를 분모에서 빼지 않는다.

## 현재 연결과 이번 수정

| 앱 | 전체 작업 | 직접 연결 | 호스트 자산/자료 | 실제 파일 3회 검증 | 실제 에디터 대기 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Word | 45 | 43 | 2 | 45 | 0 |
| Excel | 55 | 46 | 1 + 에디터 8 | 55 | 0 |
| PPT | 72 | 62 | 10 | 72 | 0 |
| 합계 | 172 | 151 | 21 | 172 | 0 |

현재 소스로 기존 43개 검사 129/129, 추가 115개 검사 변형 345/345, PPT 호스트 payload 7개 21/21, 선택 Excel 에디터 8개 24/24를 확인했다. 워터마크 텍스트/그림 변형을 하나로 세므로 고유 172개이며 총 519회다. [전체 실행 원장](../../../packages/nubi-document-agent/eval/capabilities/genoffice-execution-coverage.json)이 입력과 원천/후보/소스/엔진 해시를 연결한다. 호스트 능력이 필요한 작업과 직접 작업을 구분한다. GenOffice 3D는 모델 파일과 미리보기 그림 보존이며 Office native 3D가 아니다.

Excel의 임의 16개 함수 제한을 없애고 공식 Office 2016 후보 이름, 버전과 호스트 전제를 기록한 레지스트리로 전환했다. 지수와 백분율, 과학 표기, 배열 상수, 소문자/점/숫자를 포함한 함수명, 일부 내부 INDIRECT/OFFSET 참조를 확장했다. 수식 240자 제한은 [공식 한도](https://support.microsoft.com/en-us/excel/excel-specifications-and-limits)의 8,192자로 맞췄다. 기존 신규 문서 크기와 참조/순환 검사 경계는 유지한다.

**이 변경으로 472종 함수 전체가 계산 검증된 것은 아니다.** 현재 이름과 기본 문법을 인식하는 범위이며, 함수별 모든 인자 검증은 계산 엔진에 남아 있다. 정의된 이름, 구조화 참조, 참조 교집합/3D 참조, CSE 배열 결과 영역과 동적 INDIRECT/OFFSET의 전체 지원은 추가 작업이다. 외부 서비스/자동화/큐브에 연결되는 함수는 호스트 기능이 필요하다는 구체적인 오류로 구분하고 연결 경로를 마련한다. 임의 파일 엔진에서 조용히 실행하지 않는다.

기존 GenOffice의 `xlsx-gateway/.../future-functions.ts`를 수정 없이 재사용했다. 통계/2013 이후 함수의 XLSX 저장 마커 누락으로 발생한 실제 계산 실패를 고쳤다. 현재 로컬 계산 증거는 **106종 함수 계약 및 문법을 포함한 327개 검사(3개 입력 변형) 327/327**이다. 처음 285/327, 실패 42건을 별도로 보존한다. 고정 상수 함수의 반복은 입력 민감도 증거로 부풀리지 않는다. [실행 근거](../../../packages/nubi-document-agent/artifacts/formula-breadth-2/evidence.json)를 따른다.

기존 companion에 설치된 Univer `0.25.1`의 최초 조사는 읽기 전용이었다. 함수 목록 534개 중 구현 등록 511개, 공식 Office 2016 후보와 겹치는 등록 448개를 확인했다. 이는 레지스트리이며 함수 실행 성공으로 합산하지 않는다. 이후 선택 호스트 에디터/계산 엔진에 실제 연결해 저장된 계산값과 값 변환을 각각 327/327 확인했다. 기존 설치 의존성을 재사용하며 이 패키지에 새 Univer npm 의존성을 추가하지 않았다.

## 이어갈 구현 순서

기존 엔진의 파일 작업과 공통 자산/자료 포트에 이어 Excel 에디터 전용 8개도 원본 편집 함수/저장기와 실제 Univer에 연결했다. [연결과 실제 검증](../../research/2026-10-16-document-agent-univer-editor-execution.md)은 파일 24/24, 경계/피벗 확장 21/21, 저장된 계산값 327/327과 값 변환 327/327을 분리한다. 호스트가 `xlsxEditorEnginePath`를 제공할 때만 적용한다. 다음은 전체 후보 함수/참조와 인자 계산, 새 에디터 기능의 복합 모델 선택/보존, Office 2016 대조를 이어간다.

이미 시작한 54개 복합 업무 비교는 최초 조건과 실패를 그대로 보존한다. 이번 기능 범위 확장과 수정 후보를 같은 기준선 결과에 섞지 않는다. Desktop/스케줄러는 나중에 독립 애드온 계약으로 호출하며, NASCA 문서는 열린 Office의 native 관찰/수정 경계를 유지한다.
