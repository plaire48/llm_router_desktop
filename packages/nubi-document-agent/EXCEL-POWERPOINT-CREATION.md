# 새 Excel과 PowerPoint 초안

상태: 2026-10-16. 선택 `./excel`, `./powerpoint`에 호스트 모델용 `prepare*`, 구조 초안용 `create*`, 새 평문 출력용 `inspectGenerated*`, 타입과 JSON 스키마를 추가했다. Windows Office, NASCA, 실모델 품질과 Workspace 연결은 미검증이다.

## 재사용과 호출

| 자산 | 실제 적용 | 제외 범위 |
| --- | --- | --- |
| GenOffice AgentLoop | 호스트 transport와 기존 도구 호출 루프 | 인증, 승인과 저장소의 중복 소유 |
| 누비 Office ExcelJS writer | 4.4.0 typed 값/수식/스타일/인쇄/직렬화 방식과 기존 uuid override | 디스크 저장 소유권과 보호 파일 파싱 |
| 고정 GenOffice PPT 엔진 | `createBlankPptx`, `generateParagraphXml` 원본과 의존 파일. 어댑터가 native slide/table/notes 조립 | 전체 편집기, 기존 파일 재직렬화와 차트 편집 |

원본 GenOffice 19개 파일은 Office X manifest의 SHA-256과 대조하고 수정 없이 포함했다. `vendor/genoffice-source.json`, `vendor/nubi-reuse.json`과 `THIRD-PARTY-NOTICES.md`에 적용 범위와 출처를 남겼다.

```ts
import {prepareExcelDocument} from '@nubi/document-agent/excel';
import {preparePowerPointDocument} from '@nubi/document-agent/powerpoint';

const input = {request: '제공한 자료로 보고서를 작성하세요.', sources};
const xlsx = await prepareExcelDocument(input, host.model, signal);
const pptx = await preparePowerPointDocument(input, host.model, signal);
// bytes: Uint8Array, savedToOffice: false, finalSaveRequired: true
// Host owns review, approval, final Office save and readback.
```

자료 읽기 도구 후 구조 초안을 받으며 모델의 완료 문장만으로 성공 처리하지 않는다. 취소한 호출의 늦은 결과는 버린다. 글꼴과 `onTool` 이벤트는 선택 인자로 주입한다. 기본 글꼴은 Malgun Gothic이며 macOS 예제 QA에서는 Apple SD Gothic Neo를 지정했다.

Excel은 최대 8개 시트, 시트당 20열과 400행, 전체 12,000개 셀, typed value/formula/format/role을 지원한다. 전체 수식 의존성은 250,000개로 제한한다. `decimal`은 소수점 두 자리 금액을 표시한다. 인쇄 시 첫 행을 반복한다. 수식은 선행 `=` 없이 Office 2016 후보 함수 이름과 내부 참조, 지수/백분율/배열 상수 등을 인식한다. 임의 16개 제한은 제거했고 길이는 8,192자다. 후보 목록은 함수별 계산 성공을 뜻하지 않으며, 현재 106종 계약과 문법의 로컬 327개 계산 검사만 확인했다. GenOffice 원본의 XLSX 미래 함수 저장 마커를 재사용한다. 호스트 기능이 필요한 함수와 정적 분석이 어려운 참조는 구체적인 사유로 구분하고 후속 구현 대상에 둔다. 없는 셀과 확인 가능한 순환 참조를 거부한다. 문자열 `=SUM(1,2)`는 수식으로 실행하지 않는다. `date`는 ISO 입력을 실제 날짜로 저장하며 날짜 반환 수식의 표시 형식으로도 지정할 수 있다. **ExcelJS는 계산 엔진이 아니므로 `calculationRequired: true`를 반환한다.** 계산/결과 읽기/저장은 별도 호스트 단계다.

2026-10-16 추가 파일 기능은 [FILE-OPERATIONS.md](FILE-OPERATIONS.md)에 분리했다. 선택 `./file-operations`는 새 평문 초안의 표/이름/입력 제한/조건부 서식/차트와 PPT 도형/정렬/그룹/노트 등의 원본 작업을 실제 엔진에 전달한다. 여기의 단순 생성 스키마를 임의 기존 파일 수정기로 확대하지 않는다.

PowerPoint는 16:9, 최대 12장, 짧은 제목과 문단, 편집 가능한 표와 발표자 노트를 지원한다. 제한된 템플릿에서 너무 긴 제목과 표는 거부한다. 표는 이미지가 아니다. raw XML, 실행 코드, 임의 복합 디자인, 차트와 기존 파일 수정은 지원하지 않는다.

`inspectGenerated*`는 **새로 만든 평문 출력**의 제한된 구조 검사다. NASCA/기존 회사 문서 reader와 전체 OOXML 검증이 아니다. Office에서 연 보호 문서는 호스트 native 어댑터로 관찰/수정한다. 신규 생성 helper는 상태 없는 선택 함수이며 영구 checkpoint, 재시작 복구, Workspace 등록과 최종 저장은 후속 연결이다. 초안 본문을 일반 로그에 저장하지 않는다. 기존 Word 편집 session 계약은 유지한다.

## 검사와 예제

`eval/EX-CREATE-01.json`, `PP-CREATE-01.json`은 합계 6/3/3, 완료율 50%, 담당자/마감일/배포 보류를 다룬다. 정답 초안과 독립 사실 검사는 `eval/`에만 둔다. 틀린 수식 범위와 합계, 담당자/날짜를 검출하는 부정 사례를 포함한다. 생산 생성기는 정답을 import하지 않는다.

```bash
npm test
npm run verify:vendor
node scripts/create-office-examples.mjs artifacts/office-create-new
node scripts/benchmark-office.mjs excel artifacts/excel-benchmark-new --plan-only
node scripts/benchmark-office.mjs powerpoint artifacts/ppt-benchmark-new --plan-only
```

기존 파일을 덮어쓰지 않으므로 새 출력 경로를 쓴다. 기준 예제는 실모델 결과가 아니다. 모델 계약 검사는 시험용 transport를 사용한다.

최종 예제는 `artifacts/office-create-01-v3/outputs/`다. XLSX는 LibreOffice 계산 후 독립 Python XML 읽기에서 합계 6/3/3과 비율 0.5를 확인했다. 검토 한 건 증가 복사본에서 6/4/2와 4/6, 작성/검토 0건 복사본에서 0/0/0과 비율 0을 확인했다. 테스트 복사본은 결과와 분리했다.

PPT는 구조/배치/글꼴/native table 검사와 Artifact Tool import를 통과했다. PPT 3장과 Excel 2개 시트의 PDF 렌더를 모두 검토했다. 첫 PPT의 table URI 오류로 표가 숨겨진 문제를 수정하고 필수 표 내용의 PDF 표시 검사도 추가했다. 최종 한글과 표가 표시되며 겹침/잘림이 없었다. 구조 통과와 실제 표시는 별도 증거다. 글꼴은 Office 파일에 포함하거나 시스템에 설치하지 않았다.

로컬 QA용 `finalize-powerpoint-example.mjs`, `qa-office-examples.py`는 현재 호스트 번들 런타임과 이전 Word QA의 task-local fontconfig를 사용한다. 다른 기기에서는 경로와 글꼴을 맞춰야 한다. 패키지 실행 의존성은 아니다.

## 비교 실행의 경계

2026-10-16 후속: 기존 Desktop Claude 연결로 별도의 호스트 모델 평가를 수행한다. 아래 두 CLI 직접 비교의 과거 미실행 상태와 구분하며 [최신 제한 평가 기록](../../docs/research/2026-10-16-document-agent-host-model-quality.md), [기능군 공백](CAPABILITY-COVERAGE.md)을 따른다. 앱별 보고서 한 종류를 전체 작성 품질로 확대하지 않는다.

공통 `benchmark-office.mjs`는 두 CLI에 같은 앱별 자료/스키마를 주고 같은 생성기로 출력한다. 제품별 3회, 앱별 6회다. `--plan-only`는 CLI와 계정을 호출하지 않는다. 제품 전체 도구 사용/시각 수정/저장 흐름 비교가 아니며 구조 통과도 계산/렌더와 실제 Office 검증을 추가로 받아야 한다.

기존 Word에서 확인한 Codex 권한 제한과 Claude 미인증 상태의 해소 증거가 없어 실제 CLI를 반복 호출하지 않았다. 이번 두 앱은 각각 계획 6회, 시도 0회, 모델 문서 0개와 `not_run`이다. 성공률이나 속도/정확도 우열은 미측정이다. 조건이 갖춰지면 `--plan-only` 없이 새 경로로 실행한다. 인증값과 원본 stderr는 저장하지 않는다.

의존성은 기존 로컬 설치와 lock을 재사용했다. `npm ls`는 필수 의존성이 맞음을 확인했지만 네트워크/캐시 부족으로 신규 `npm ci`는 미검증이다. Windows Office 2016, Qwen, NASCA 보호와 Office 저장/재열기는 계속 미검증이다.
