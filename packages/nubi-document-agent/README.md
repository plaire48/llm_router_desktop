# 누비 문서 작성 모듈

선택 `@nubi/document-agent/editors`는 누비의 Monaco와 외부 Obsidian의 열린 버퍼를 같은 읽기/부분 수정 계약으로 다룬다. 기존 모델 루프와 호스트 승인/영구 실행 기록을 주입받고 범위 읽기, 변경 충돌 검사, 단회 적용과 전체 본문 재읽기를 제공한다. [호출 계약과 검증 범위](EDITORS.md)를 따른다. 소스와 실제 Monaco 검사는 준비됐으며 Workspace UI/통신 등록, 실제 Obsidian/Windows 메모장/PDF 앱 연결은 아직 완료하지 않았다.

GenOffice AgentLoop 원본을 재사용한 독립 모듈이다. Word의 관찰된 한 서식 구간 안에서 문구 하나를 교체하는 계약과, 요구사항에서 구성을 정해 새 Word/Excel/PowerPoint 초안을 만드는 선택 어댑터를 제공한다. 모델, 문서 접근, 승인, 저장소와 이벤트는 호스트가 주입한다.

**초기 목표는 GenOffice 전체 작업의 연결/검증이며 기준은 Office 2016이다.** [전체 172개 대상](../../docs/superpowers/specs/2026-10-16-document-agent-genoffice-parity-office2016.md)의 Word 45/45, Excel 55/55, PPT 72/72 작업을 새 평문 파일로 각각 3회 검증했다. [519회 실행 근거](eval/capabilities/genoffice-execution-coverage.json)에 입력 변형, 재열기, 비대상 보존과 해시가 있다. Excel 에디터 8개도 기존 GenOffice/Univer와 실제 저장을 연결했다. 그림/미디어/복사/에디터 작업은 호스트 능력이 주입될 때 노출한다. 전체 인자/모델 품질/실제 Office 완료를 뜻하지 않는다.

**전체 Office 작성 품질은 미검증이다.** 기능별 파일 검사와 모델의 복합 업무 판단, 모든 인자 조합, Office 2016 실제 실행은 별도다. GenOffice 3D 작업은 GLB와 미리보기 그림 보존이며 Office 네이티브 3D 편집 구현이 아니다. [현재 범위와 남은 작업](CAPABILITY-COVERAGE.md), [원본 엔진 호출](FILE-OPERATIONS.md), [실행 결과](../../docs/research/2026-10-16-document-agent-genoffice-parity-progress.md)를 따른다.

Excel 공식 후보는 STOCKHISTORY 정정 후 471개다. 남은 8종의 계산을 연결해 기본 1,377건에서 계산 실패 24건을 해소했다. 기본 계약 3회 통과는 456종이지만, Microsoft 공개 예제에서 ETS 예측/신뢰구간/통계 3종은 수치가 달라 별도 보류한다. [현재 함수 원장](eval/capabilities/formula-execution-coverage.json)은 추가 대조도 통과한 453종, ETS 수치 공백 3종, 경계 대기 2종, PHONETIC 공백 1종, 호스트 필요 12종을 구분한다. [미지원 함수 연결과 Microsoft 예제 대조](../../docs/research/2026-10-16-document-agent-missing-functions-execution.md)에 새 147건과 공식 예제 150건 중 147건 실패를 함께 남겼다. 전체 인자, 배열 결과 영역이나 실제 Excel 호환 완료는 아니다.

## 요구사항에서 직접 구성을 정하는 작성

선택 `@nubi/document-agent/composition`의 `prepareComposition`은 호스트 모델이 Word 블록 순서와 가로/세로 구역, Excel 시트와 데이터 위치/수식, PPT 슬라이드 수와 개체 좌표를 직접 정하게 한다. 업무 양식이나 레이아웃 프리셋을 제공하지 않는다. 다만 지원하는 네이티브 문단/표/도형/차트와 크기 제한은 있다. `composeWord`, `composeExcel`, `composePowerPoint`는 검증된 구성에서 새 평문 초안만 반환한다. PPT 실행기는 호스트가 주입한다.

`reviseComposition`은 검증 근거를 받아 작은 선언형 패치를 제안하고 전체 구성을 재검증한다. 최종 저장 승인과 Office 반영은 호스트 책임이다. Excel 원천 바인딩은 자료 복사이며 업무 계산 규칙을 대신하지 않는다. 산출물별 정답 대조, 실제 재계산, 원천 보존과 렌더 검토가 별도로 필요하다.

[자유 구성 평가 기록](../../docs/research/2026-10-16-document-agent-open-composition-evaluation.md)에 구매 정산, 교육 행사, 시스템 전환의 세 가상 업무를 기존 Claude 호스트로 작성한 결과와 최초 실패, 수정, 파일 9개를 남겼다. 같은 사례의 앱별 최초 실행 1회와 보완 성적이며, 새로운 과제에 대한 반복 성공률이나 Codex 대조 성적은 아니다.

## 작성 후 자동 검토와 부분 수정

선택 `@nubi/document-agent/quality`의 `runCompositionQuality`는 호스트의 현재 파일 렌더/사실/보존/계산 검토를 기존 생성기와 `reviseComposition`에 연결한다. 검토한 문제 위치 안에서만 수정하고 후보를 다시 생성해 검토한다. 전체 페이지가 검토되지 않았거나 major 오류가 남으면 완료하지 않는다. 과거 후보의 검토 재사용, 비대상 수정과 통과 검사 악화를 차단한다. [호출 계약과 상태](QUALITY.md)를 따른다. `verified_draft`도 새 평문 검토 초안이며 최종 승인/Office 저장은 호스트 후속이다.

## 현재 확인한 범위

`createNativeOfficeWritePort`는 호스트의 기존 native 관찰/승인된 변경/Excel 계산/독립 재읽기를 연결한다. 세 앱의 빈 테스트 문서에 실제 쓰기를 실행할 [Windows 도구](WINDOWS-OFFICE-WRITE.md)를 준비했다. 현재 Windows 환경이 없으므로 로컬 계약과 Node 프로세스 검사만 완료했으며 PowerShell 파서/실제 Office 2016/COM/NASCA/저장은 미검증이다. 이 포트는 위 GenOffice 172개 파일 작업의 전체 native 이식이나 제품 등록이 아니다.

`createNativeOfficeSkill`과 `runNativeOfficeTask`는 기존 호스트 모델에 native 관찰/쓰기/명시적 완료 도구를 노출한다. 관찰과 쓰기 직전 값, 실제 검증 영수증을 묶고 거절/미확정 뒤 재전송하지 않는다. 기존 실행기에는 skill만 합성할 수 있다. [호스트 모델 호출 계약](NATIVE-HOST-MODEL.md)을 따른다.

- `prepare`: 호스트의 Word 스냅샷을 읽고 GenOffice 도구 루프로 변경안을 준비한다. 실제 문서를 변경하지 않는다.
- `apply`: 호스트의 정확한 변경안 승인과 현재 문서를 재확인한 뒤 문서 포트에 한 번 반영을 요청한다.
- `reconcile`: 응답이 유실된 쓰기는 기존 실행 영수증과 실제 상태만 조회한다. 같은 쓰기를 다시 보내지 않는다.
- `suspend`/`detach`: 진행 호출을 취소하고 작업 상태를 호스트 저장소에 보존한다. 취소한 호출의 늦은 결과로 새 변경안을 만들지 않는다.
- `resume`: 지원하는 대기/실패 상태에서 명시적으로 새 관찰과 모델 계획을 수행한다. 재연결 전 승인 ID는 사용할 수 없다.

첫 과제는 [WD-EDIT-01](eval/WD-EDIT-01.json)이다. 날짜 문구만 바꾸고 다른 문단, 강조 구간, 글꼴 크기와 문단 서식을 유지한다. 모델/Office 외부 의존성을 시험용 호스트가 대신하며 실제 GenOffice AgentLoop와 변경/승인/검증 코드는 실행한다.

## 실행

```bash
npm ci --ignore-scripts
npm test
npm run verify:vendor
```

Node 22.19 이상을 요구한다. 기본 편집 core는 런타임 외부 의존성이 없다. 선택 `./word`, `./powerpoint` 생성기는 GenOffice 원본과 JSZip/fast-xml-parser를 사용한다. `./excel`은 기존 누비 Office와 같은 ExcelJS 4.4.0 경로를 사용한다. [Excel/PPT 호출과 검증 범위](EXCEL-POWERPOINT-CREATION.md)를 따른다. TypeScript, Node 타입과 esbuild는 개발/빌드용이다.

```ts
import {createDocumentAddon} from '@nubi/document-agent';

const addon = createDocumentAddon();
const session = await addon.attach(host, {projectId: 'project-1'});
const pending = await session.prepare({
  taskId: 'task-1', runId: 'run-1', targetRef: 'host-document:meeting',
  request: '회의 날짜만 바꾸고 나머지 내용과 서식은 유지해 주세요.'
});
// The host presents this exact proposal and records the user's decision.
// After an actual grant, the host invokes:
const result = await session.apply('task-1', pending.proposal!.approvalId);
```

`host`의 계약은 [types.ts](src/types.ts)다. 패키지 import/attach만으로 모델, Office, 네트워크 또는 작업을 시작하지 않는다. 프로젝트를 바꿀 때 기존 session을 해제하고 새 scope로 연결한다.

## 기존 native Word 읽기 연결

`createNativeWordReadPort(bridge)`는 기존 Office X의 `inspect_office_members`와 `inspect_office` 응답을 재사용하는 읽기 전용 어댑터다. 함수 서명은 native type info에서 받고, 본문과 서식은 실제 getter 호출의 반환값으로 구성한다. 메타데이터 조회 불가와 문서 읽기 성공을 따로 기록한다.

```ts
import {createNativeWordReadPort, type NativeWordBridge} from '@nubi/document-agent';

async function observeWord(bridge: NativeWordBridge) {
  const reader = createNativeWordReadPort(bridge);
  const scope = {projectId: 'project-1', taskId: 'task-1'};
  const signal = new AbortController().signal;
  const acquired = await reader.acquire(scope, 'host-document:meeting', signal);
  const context = {...acquired, scope};
  try {
    const snapshot = await reader.read(context, signal);
    return {snapshot, evidence: reader.evidence(context)};
  } finally {
    await reader.release(context);
  }
}
```

`bridge`의 연결 소유권은 호스트가 관리한다. `acquire`는 이미 열린 Word 문서와 선택 범위에 고정한 `NativeWordConnection`을 반환한다. 그 `call`은 기존 native 호출자에 위 두 도구만 전달하며, 취소 확인과 문서/창 identity 확인, Office UI/STA 직렬 처리를 유지한다. `release`는 획득한 원래 연결을 받아 이 lease가 소유한 native 핸들을 정리한다. 사용자의 문서를 닫지 않는다. 라이브러리 import는 IPC나 프로세스를 시작하지 않는다.

`createOfficeXNativeReadCaller(wire)`로 기존 `tool`/`tool_result` 봉투를 사용하는 호출자를 구성할 수 있다. `wire`의 송수신/연결 종료는 호스트가 제공한다. 실행 ID와 호출 ID를 함께 검사하며, 취소 뒤 늦은 응답과 다른 실행의 응답은 사용하지 않는다. 연결 종료 때 `close()`를 호출해 대기 중인 읽기도 실패로 반환한다.

첫 범위는 본문 story의 최대 512 UTF-16 단위 선택이다. 문단과 관찰된 동일 서식 구간을 만들며 글꼴 이름/크기/굵게/기울임/밑줄/색, 문단 정렬/앞뒤 간격/좌우 들여쓰기만 읽는다. 표, 필드, 인라인 개체와 콘텐츠 컨트롤이 포함되면 지원 범위 밖으로 반환한다. 동일 범위를 두 번 읽어 내용과 이 서식이 일치하는지 확인한다. 두 번의 일치는 원자적 관찰이나 전체 문서 보존을 보장하지 않는다. 범위별 getter 호출 비용과 실제 Word 좌표/문자 처리도 Windows에서 확인해야 한다.

이 어댑터는 `apply`/`reconcile`/저장을 제공하지 않는다. 변경안 준비 흐름과의 연결은 시험 호스트로 검사했으며, 실제 적용은 별도 native 쓰기 포트가 완성된 뒤 연결해야 한다. [소스 대응과 검증 기록](../../docs/research/2026-10-15-document-agent-native-word-read.md)을 따른다.

## Windows에서 기존 native DLL로 읽기

[WINDOWS-WORD-READ.md](WINDOWS-WORD-READ.md)의 개발용 실행기는 기존 Office X native DLL을 불러 이미 열린 Word의 선택 범위를 읽는다. 실행 중인 VSTO 작업창에 새 기능을 설치하는 방식이 아니라, 기존 native 클래스를 별도 Windows PowerShell STA 프로세스에서 재사용하는 진단 경로다. 모델이나 인증은 사용하지 않는다.

`scripts/Read-WordNative.ps1`가 Word 세션을 고정하고, 자식 Node의 `scripts/read-word-native.mjs`에서 오는 조회/읽기 요청을 기존 native 클래스에 전달한다. 출력은 원문 대신 읽기 범위/개수/해시와 실행 근거다. 수정, 저장, 문서 열기/닫기와 Word 종료는 제공하지 않는다.

현재 Windows 환경이 없어 이 PowerShell 실행기와 실제 DLL/COM 호출은 미검증이다. macOS에서 자식 Node 프로세스와 프로토콜 fixture의 실제 송수신을 검사한 결과와 구분한다. 실제 Office 읽기, Office 2016 제품 확인, NASCA 확인은 서로 별도 근거가 필요하다.

## 새 Word 문서 생성

`@nubi/document-agent/word`의 `prepareWordDocument`는 호스트 모델과 기존 GenOffice 루프로 새 초안을 준비하고, `createWordDocument`는 구조화된 내용을 실제 DOCX 바이트로 만든다. 제목/본문/혼합 강조/편집 가능한 표를 지원하며 파일 저장과 Office 변경은 하지 않는다. [생성 API와 검증 범위](WORD-CREATION.md)를 따른다.

## 호스트가 지킬 책임

선택 `@nubi/document-agent/host-model`의 `createHostModelTransport(host)`는 기존 호스트의 선택 모델/complete를 GenOffice transport로 변환한다. 모델 ID를 연결 시 고정하고 도구 호출/관찰 ID, 취소와 오류를 전달한다. 패키지가 로그인이나 인증 저장소를 소유하지 않는다.

```ts
import {createHostModelTransport} from '@nubi/document-agent/host-model';
import {prepareWordDocument} from '@nubi/document-agent/word';

const transport = createHostModelTransport({
  id: selectedModelId,
  complete: (messages, tools, context) => host.complete(messages, tools, context)
});
const draft = await prepareWordDocument({request, sources}, transport, signal);
// The host reviews bytes, obtains final save approval and verifies actual Office state.
```

`eval/host-authoring.mjs`는 생산 모듈 밖의 평가 실행기다. 고정 과제와 반복 횟수를 먼저 정하고 최초 실패와 1회 보완 결과를 분리한다. `scripts/evaluate-host-model.mjs`는 현재 저장소의 기존 Desktop Claude 어댑터를 연결하는 개발 실행 예시이며 패키지 실행 의존성이 아니다. 모델 호출과 도구명 메타데이터를 기록하고 계정/인증/원본 stderr는 기록하지 않는다. 새 출력 경로에만 합성 과제 산출물을 저장한다. 검사기의 고정 값/셀 주소는 제품 프롬프트나 생성기에 들어가지 않는다.

- `targetRef`는 호스트가 확인한 문서 핸들이다. 임의 경로, URL이나 모델이 만든 문서 ID를 신뢰하지 않는다.
- `acquire`는 같은 사용자/프로젝트의 실제 열린 문서에 대해 배타적 lease를 제공한다. COM 객체는 포트 밖으로 전달하지 않는다.
- `apply`는 쓰기 직전에 lease, 취소, 문서 세션/revision과 이전 텍스트를 원자적으로 검사한다. 모듈의 사전 읽기만으로 충돌 검사를 대신하지 않는다.
- `read`는 모델의 기대값이 아닌 실제 문서 상태를 반환한다. 관찰 범위 밖의 개체/기능까지 보존했다고 주장하지 않는다.
- `authorize`는 현재 사용자의 실제 승인 기록에서 정확한 scope/approval/fingerprint를 확인한다. UI 닫힘을 승인으로 취급하지 않는다.
- `present`는 비동기 UI 대기 이후에도 signal과 generation을 검사한다. 폐기된 연결의 늦은 질문을 표시하지 않는다.
- `compareAndSet` 성공은 기존 보호 정책에 따른 영구 저장까지 끝난 상태를 의미한다. checkpoint에는 본문 스냅샷이 포함되므로 일반 로그나 평문 파일에 임의 저장하지 않는다.
- 모델 transport는 이 실행에 허용된 선택 모델과 인증에 고정한다. 모듈은 인증 저장소를 만들지 않는다.

`COMPLETED`/`verification: verified`는 승인된 부분 교체와 관찰된 스냅샷의 readback 일치만 뜻한다. 요청의 의미적 품질, 문서 전체 레이아웃, 파일 저장과 NASCA 보호 검증 성적을 뜻하지 않는다. 첫 버전은 항상 `saved: false`를 반환한다. 저장이 필요한 전체 업무를 이 부분 작업의 성공만으로 완료 처리하지 않는다.

## 미구현과 미검증

Windows 개발용 읽기 bridge와 stdio 실행 경로는 소스로 준비했다. 실제 Windows DLL/COM 실행, 설치된 VSTO/Workspace 연결, native 쓰기 포트, 기존 Excel/PPT 수정, 여러 서식 구간에 걸친 수정, 실제 회사 문서 입력과 Office 저장/재열기는 후속 범위다. 기존 고정 명세 출력/렌더와 2026-10-16 기존 Claude 호스트로 시작한 제한 실모델 평가는 별도 경로다. 결과는 [실모델 검증 기록](../../docs/research/2026-10-16-document-agent-host-model-quality.md)에 남긴다. 전체 모델 작성 품질과 기능군 평가는 완료하지 않았다. Excel 입력 변경과 0건 경계의 수식 재계산은 로컬 LibreOffice에서 확인했다. 테스트의 native 프로토콜 fixture는 COM 실행 결과가 아니다. Windows Office 2016과 NASCA는 미측정이다.

재연결 뒤 완료/대기 기록은 읽을 수 있으며, PAUSED 등 지원 상태의 명시적 재계획과 APPLYING/UNCONFIRMED의 읽기 전용 조정만 지원한다. 모든 실행 위치의 자동 복구를 보장하지 않는다. 사용자 취소는 자동 재개하지 않는다.

## 재사용

GenOffice `438d9c65709952490c970beaa2599ef45e74431f`의 루프와 Word/PPT 생성 의존 파일 19개를 원본 그대로 포함했다. 기존 Office X의 고정 소스 manifest와 해시를 대조했다. Excel은 누비 Office의 typed writer 패턴을 메모리 생성용으로 적용했다. 별도 Agent 루프를 새로 작성하지 않았고 제공자/인증/편집기 전체를 가져오지 않았다. [출처와 라이선스](THIRD-PARTY-NOTICES.md), [GenOffice 해시](vendor/genoffice-source.json), [누비 재사용 기록](vendor/nubi-reuse.json)을 따른다.

Office 함수 목록의 용도와 현재 연결 범위는 [OFFICE-API-CATALOG.md](OFFICE-API-CATALOG.md)에 정리했다.
