# 새 문서 초안의 원본 엔진 작업

2026-10-16. 선택 `./file-operations`는 기존 GenOffice Word/Excel/PPT 작업을 새 평문 초안에 연결한다. `./genoffice-node`는 기존 Office X Word/Excel 실행기와 GenOffice PPT 실행기에 전달하는 선택 Node 어댑터다. 실제 회사 문서, 열린 Office, NASCA 원본을 이 파일 경로로 가져오지 않는다. 생성된 초안의 범위 내 파일 편집 기능이며 Windows COM 편집 지원이 아니다.

## 현재 연결

| 앱 | 직접 작업 | 호스트 자산/자료 작업 | 실제 파일 검사 | 에디터 실행 대기 |
| --- | ---: | ---: | ---: | ---: |
| Word | 43 | 2 | 45종 × 3회 | 0 |
| Excel | 46 | 1 + 선택 에디터 8 | 55종 × 3회 | 0 |
| PPT | 62 | 10 | 72종 × 3회 | 0 |

[전체 실행 원장](eval/capabilities/genoffice-execution-coverage.json)은 원본 작업별 실제 입력, 보존/재열기와 소스 해시를 기록한다. Word 워터마크 텍스트/그림은 하나로 센다. 전체 172개 작업, 173개 검사 변형의 519회 통과이며 모든 인자 조합이나 렌더 검증이 아니다. [기능 확장 결과](../../docs/research/2026-10-16-document-agent-genoffice-parity-progress.md)와 [에디터 실행 결과](../../docs/research/2026-10-16-document-agent-univer-editor-execution.md)에 최초 실패와 보완도 남겼다.

Word는 문자/문단/스타일/목록/표/구역/필드/책갈피/목차, 그림/텍스트 상자/차트/워터마크, 주석/변경 추적/각주/미주를 연결했다. Excel은 셀/범위/수식, 정렬/필터/보호, 행열/시트, 서식/표/차트/도형/그림/스파크라인/피벗 생성까지 연결했다. PPT는 텍스트/도형/연결선/자유 경로/표/차트/그림, 레이아웃/테마/전환/애니메이션/주석/구역/복사를 연결했다. GenOffice의 3D는 파일과 미리보기 그림을 넣는 수준이다.

Excel의 공식 후보는 STOCKHISTORY 정정 후 471개이며 이름 인식과 실제 계산은 별개다. [함수별 원장](eval/capabilities/formula-execution-coverage.json)과 [1,377개 실행 결과](../../docs/research/2026-10-16-document-agent-office2016-function-matrix.md)는 과거 448종과 최초 실패를 보존한다. [최신 후속](../../docs/research/2026-10-16-document-agent-missing-functions-execution.md)은 8종을 연결한 기본 1,372/1,377 통과와 Microsoft 예제의 ETS 3종 수치 공백을 분리한다. 현재 원장은 453종 계약 통과와 ETS 3종/메타데이터/경계/호스트 대기를 구분한다. 기존 GenOffice 미래 함수 저장 마커를 재사용하고, `xlsxSidecarPath`로 Rust/IronCalc 실행기를 주입한다. sidecar의 312/327과 5종 차이는 그대로 남긴다. `xlsxEditorEnginePath`까지 제공하면 기존 설치 Univer가 일반 수정 후 계산과 `convert_to_values`를 담당한다. 오류/문자열/논리값 타입을 구분하고 실제 오류의 값 변환은 거부한다. 기존 계산 327/327과 값 변환 327/327도 별도로 재검사했다. 기본 엔진의 자동 fallback이나 모든 후보 함수 계산 성공으로 세지 않는다. ExcelJS는 읽기/쓰기 도구이며 계산 엔진이 아니다.

그림은 호스트 `assets: [{id, bytes, mime: 'image/png', description}]`로만 제공한다. Word `insertImageAsset`/`insertPictureAsset`/`setWatermarkPictureAsset`, Excel `addImageAsset`, PPT `addPictureAsset`/`replacePictureAsset`/`setImageFillAsset`가 원본 작업에 대응한다. 최대 90,000바이트/4,096px와 단일 자산 batch를 적용한다. 모델은 자산 ID만 보며 경로/URL/바이트를 넣지 않는다. Excel 이미지는 Node 포트가 새 전용 임시 디렉터리에 쓴 사본 경로로만 전달한다.

PPT 호스트 payload 7개는 `addMedia`, `addModel3d`, `pasteElements`, `setChart`, `pasteSlide`, `insertSlidePptx`, `setAnimations`이다. 호스트가 `GeneratedOperationPayload`의 새 초안 이력, 현재 SHA-256 revision, 원본 작업과 입력을 결합해 `payloads`에 제공한다. 모델은 `{op:'applyBoundPayload',payloadRef:'id'}`만 보낸다. 임의 필드 추가/미등록 ID/과거 revision은 거부한다. 바이트와 복사 자료를 모델이 생성하거나 기존 회사 파일에서 추출하는 경로가 아니다.

Excel 에디터 전용 8개는 `FileEnginePort.hostEditor: {operations:{excel:[...]},maxOperationsPerBatch:1,invoke}`로 정확한 지원 목록을 주입할 때만 노출한다. 선택 Node 엔진이 원본 GenOffice 편집 함수/저장기와 실제 Univer를 연결한다. 한 batch에 한 작업을 실행하고 일반 작업과 혼합하지 않는다. 선택 엔진의 `convert_to_values`도 한 작업씩 호출한다. 기존 session과 동일하게 원본 복사/revision/취소/반환 파일 재열기를 검사한다. 읽기의 `features.sheets`는 표/피벗/보호, `features.visuals`는 실제 도형 ID를 제공한다. 전체 worksheet 색인 완료 전에 보호 없음으로 취급하지 않는다. 실제 새 파일 24/24와 경계/피벗 확장 21/21을 확인했다.

원본 operation의 모든 인자 조합을 지원하거나 검증한 것은 아니다. 입력 제한 list/numberBetween, 조건부 서식 number/text/colorScale/dataBar, 단순 내부 정의 이름, 정적 내부 INDIRECT/OFFSET 등 현재 세부 범위는 남아 있다. 동적/외부/큐브 함수, 전체 구조화 참조 등은 호스트 연결과 계산 검증을 붙일 작업으로 관리한다.

새 Excel 초안의 기존 수식과 수정 수식은 전체 행/열 및 빈 셀까지의 내부 참조를 유지한다. 시트의 실제 저장 셀을 검사한 후 의존성만 할당 영역과 교차하며 범위 문자열을 잘라 저장하지 않는다. 쓰기 대상은 계속 400행/20열, 전체 12,000셀 한도이며 분석 의존성은 250,000개를 넘기지 않는다. 기본 `formulaReferences`의 관찰 범위 계약은 유지하고 이 새 평문 초안 경로에만 `worksheet` 범위를 사용한다. 기존 GenOffice 파일 엔진으로 원천 한 셀을 수정한 뒤 전체 열 계산과 비대상 보존을 확인한 근거는 [후속 기록](../../docs/research/2026-10-16-document-agent-excel-authoring-repair.md)에 있다.

2026-10-17 실제 호스트 초안 후속: 셀 값/수식/범위 수정과 지우기만 있는 배치는 현재 읽은 셀 범위와 배치 전체의 대상 셀을 먼저 합쳐 의존성을 검사한다. 실제 작은 시트를 가상의 400행/20열로 확장해 정상 수정을 거부하던 문제를 고쳤다. 새 대상이 원래 빈 셀이어도 기존 수식과의 순환 참조를 검사하며 250,000개 한도는 유지한다. 구조 변경과 다른 작업이 섞인 배치는 기존 보수적 범위 검사를 유지한다. 실제 모델이 만든 두 Excel의 입력 변경 6파일/12결과 재계산과 비대상 값/수식 보존은 [실제 호스트 업무 검증](../../docs/research/2026-10-17-document-agent-live-complex-quality.md)을 따른다.

Excel `read_file_draft`는 관찰한 `sheet` 이름과 선택 `range`를 받는다. 생략 시 첫 시트 `A1:T100`을 유지한다. `session.read(signal, {sheet, range})`도 같은 계약이다. 존재하는 시트와 400행/20열 안의 A1 범위만 허용하며 경로나 다른 인자는 거부한다. 선택 범위는 기존 Node GenOffice 포트와 선택 에디터 검사에도 전달하고, 수정 후 재열기도 같은 시트/범위를 사용한다. 구조 수정으로 해당 시트가 없어지면 기본 읽기로 돌아간다. 읽기 범위는 쓰기 승인 범위가 아니며 최종 계산/보존/저장 검증을 대체하지 않는다.

## 호스트 호출

```ts
import {createGeneratedFileSession, prepareFileDocument} from '@nubi/document-agent/file-operations';
import {createNodeGenOfficeEngine} from '@nubi/document-agent/genoffice-node';

const engine = createNodeGenOfficeEngine({
  wordExcelEnginePath: hostPaths.wordExcelEngine,
  slideEnginePath: hostPaths.slideEngine,
  nodePath: hostPaths.bundledNode,
  xlsxSidecarPath: hostPaths.xlsxSidecar
});
const session = await createGeneratedFileSession({
  domain: 'word', origin: 'new_unencrypted_draft', bytes: generatedDraft.bytes
}, engine);
try {
  const operations = session.catalog({op: 'define_style'});
  const before = await session.read(signal);
  const changed = await session.apply([
    {op: 'define_style', styleId: 'ReviewCallout', basedOn: 'Normal', run: {italic: true}},
    {op: 'applyStyle', target: {blockIndexes: [2]}, styleId: 'ReviewCallout'}
  ], before.revision, signal);
  const candidate = session.snapshot();
  // The host independently verifies content and obtains final save approval.
} finally {
  session.dispose();
}

const draft = await prepareFileDocument({
  domain: 'powerpoint', origin: 'new_unencrypted_draft',
  bytes: generatedDeck.bytes, request: '표 아래에 세 단계 도형을 추가하고 균등하게 배치하세요.'
}, engine, hostTransport, signal);
```

`origin`은 호스트의 생성 이력 확인이다. 문자열만 붙이면 기존 보호 문서를 읽어도 된다는 뜻이 아니며 범용 암호화 판별기로 사용하지 않는다. `bytes`와 실행 파일 경로는 호스트가 제공한다. 모델은 임의 파일/프로세스 경로를 전달하지 않는다. 호스트가 기존 엔진을 배포/업데이트하고 `FileEnginePort` 구현을 교체할 수 있다. core는 Office X 절대 경로나 Desktop 인증에 결합하지 않는다.

실행기는 소스 checkout으로 준비할 수 있다. 이 명령은 모델/인증/Office를 실행하지 않는다.

```bash
node scripts/build-slide-engine.mjs /path/to/office_x /host-owned/engines/slides.cjs
node scripts/build-xlsx-editor-engine.mjs /path/to/office_x /path/to/installed/companion/workspace /host-owned/engines/editor.cjs
```

Excel 선택 에디터/계산을 사용할 호스트는 `xlsxSidecarPath`와 `xlsxEditorEnginePath`를 함께 제공한다. 원본 checkout과 기존 설치 Univer 의존성을 빌드 입력으로 사용하며 별도 UI나 인증/실행 루프를 만들지 않는다. 배포물과 라이선스는 호스트가 관리한다.

Word/Excel은 기존 Office X `dist/cli/genoffice-engine.cjs`를 재사용했다. PPT는 고정 원본 `cli/formats/pptx.ts`, `pptx-ops`의 실제 atomic executor와 저장기를 별도 프로세스로 묶는다. Node 포트가 각 호출에 전용 임시 디렉터리/입출력 파일을 만들고 제한 루트만 전달한다. 부모 인증값과 임의 Node 옵션을 전달하지 않는다. 원본은 복사하며 반환 바이트만 후보가 된다. Windows 설치판의 엔진 배포와 Electron/Workspace 연결은 미검증이다.

## 검증과 복구 경계

- 읽기 뒤의 SHA-256 revision이 같은 초안에만 apply한다. 동시에 하나만 실행하고 과거 관찰과 취소된 응답을 거부한다.
- 원본 엔진의 atomic 실행 뒤 수정본을 별도 프로세스로 다시 읽는다. 구조/활성 콘텐츠 검사와 readback이 성공해야 session의 후보를 바꾼다. 실패한 후보는 확정하지 않는다.
- `dispose`는 진행 중 엔진에 취소 신호를 보내며 호스트 신호를 변경하지 않는다. 종료 후 늦은 결과는 버린다. 불확실한 Office 쓰기나 사용자 원본 파일을 재전송하는 경로가 아니다.
- Word는 원본 엔진 관찰에 직접 run 색/굵게 정보를 추가한다. 스타일 정의와 실제 직접 서식이 다를 수 있음을 모델에 보여준다. 이 정보는 모든 Word 스타일/테마/조건부 표 서식의 완전한 effective-format 해석기가 아니다.
- 모델 연결은 기존 GenOffice AgentLoop를 사용한다. 기능 목록/정확한 스키마 조회 → 실제 초안 읽기 → 원본 작업 반영/재열기 → 명시적 완료 순서다. 실제 작업 진전 없이 3회 도구 오류가 나면 `file_recovery_required`로 멈춘다.
- 결과는 항상 `savedToOffice: false`, `semanticVerificationRequired: true`다. 영구 checkpoint, 재시작 복구, 최종 저장 승인과 실제 Office 저장은 호스트 후속 연결이다.

직접 기능 실행, 모델의 기능 선택, 시각 표시와 실제 Office 실행은 별도 성적이다. [검증 기록](../../docs/research/2026-10-16-document-agent-feature-execution.md)을 따른다.

## 복합 문서 검증

[업무형 평가](../../docs/research/2026-10-16-document-agent-hard-business-authoring.md), [자유 구성 평가](../../docs/research/2026-10-16-document-agent-open-composition-evaluation.md), [새 54회 양 모델 비교](../../docs/research/2026-10-16-document-agent-dual-business-comparison.md)를 기능 검사와 분리한다. `./composition`은 모델이 블록/구역, 시트/수식, PPT 개체 좌표를 직접 정한다. `reviseComposition`은 실제 검증 실패를 근거로 선언형 계획을 수정한다.

`./excel`의 `bindGeneratedExcelChart`는 계산된 새 초안의 기존 막대 차트에 열 범위를 연결하고, `./powerpoint`의 `attachGeneratedPowerPointChartWorkbooks`는 검증된 Sheet1 참조와 캐시에서 내부 데이터 통합문서를 만든다. 기존 암호화 파일 접근이나 Office 저장 도구가 아니다.
