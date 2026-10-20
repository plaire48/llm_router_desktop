# Word 새 문서 생성

2026-10-15 첫 범위는 구조화된 제목, 절, 본문, 혼합 강조와 편집 가능한 표를 가진 새 DOCX 초안이다. 기존 NASCA 문서의 열기/수정/저장은 이 파일 생성 경로로 처리하지 않는다.

## 재사용

GenOffice 고정 revision `438d9c65709952490c970beaa2599ef45e74431f`의 빈 DOCX/문단/표 생성과 그 의존 파일 5개를 수정 없이 추가했다. 기존 AgentLoop도 그대로 재사용한다. 기존 Office X의 source manifest로 해시를 대조했고 `verify:vendor`는 LICENSE/NOTICE를 포함한 총 10개 파일을 검사한다. ExcelJS/docx/PptxGenJS를 추가해 생성기를 중복 소유하지 않았다.

GenOffice의 간단한 표 생성기는 Letter 본문 폭 9360 twips를 기본으로 쓰므로, 실제 용지 폭을 지정할 수 있는 `generateTableModelXml`을 선택했다. 표 너비를 현재 용지와 여백에 맞추고 머리글 반복, 행 분할 방지와 혼합 서식 문단을 사용한다. vendor 코드를 수정하는 대신 어댑터의 지원 모델만 제한했다.

`jszip` 3.10.2와 `fast-xml-parser` 5.11.2를 기존 Office X와 같은 버전으로 고정했다. 이번 환경은 npm registry DNS 접근이 막혀 기존 설치본과 잠금 정보를 재사용했다. required dependency 트리와 TypeScript/esbuild 실행은 확인했으며, 인터넷에서 새로 내려받는 `npm ci`는 이번에 검증하지 않았다.

## 호출

```ts
import {prepareWordDocument, createWordDocument} from '@nubi/document-agent/word';

// model is the host's authorized existing AgentTransport.
const result = await prepareWordDocument(
  {request: '제공한 자료로 보고서를 작성해 주세요.', sources: authorizedSources},
  host.model,
  signal,
  {fontFamily: 'Malgun Gothic', onTool: name => hostProgress(name)}
);
// result.bytes is an in-memory DOCX draft. The host owns persistence and final approval.
// For already structured content: createWordDocument(draft, signal, {fontFamily}).
```

`prepareWordDocument`는 자료 읽기 → 구조화된 초안 제출 → 메모리 내 DOCX 생성으로 이어진다. 기존 GenOffice 도구 루프를 사용하고, 모델의 완료 문장만으로 파일을 만들지 않는다. 허용하지 않은 XML/코드/필드를 받지 않으며 모델에 파일, shell, 인증과 Office 쓰기 도구를 제공하지 않는다. 취소된 모델 응답을 폐기한다.

`WordDraft`는 문자열과 굵게 여부, 문단/표 데이터만 받는다. 기본 용지는 Letter이며 `paperSize: A4`를 명시할 수 있다. 글꼴은 호스트가 전달하고 기본값은 Malgun Gothic이다. 설치된 글꼴과 렌더 결과는 환경별로 확인해야 한다. 모델은 설치 경로나 임의의 OOXML을 지정할 수 없다.

`savedToOffice: false`와 `finalSaveRequired: true`는 실제 Office 저장/보호가 끝나지 않았음을 나타낸다. 이 helper는 상태를 호스트에 영구 저장하지 않는다. 기존 부분 수정 session의 checkpoint/resume과 달리 신규 생성의 작업 저장/재시작 복구, 최종 승인/저장과 Workspace 애드온 호출 연결은 후속 통합 범위다. host가 외부 파일이나 기존 파일에 덮어쓰는 행위를 이 helper의 반환으로 승인받았다고 간주하지 않는다.

`inspectGeneratedWord`는 새로 만든 평문 출력의 구조 검사 전용이다. 본문, 표와 일부 서식, 용지 크기와 활성 콘텐츠 유무를 관찰한다. 전체 OOXML schema 검증기나 범용 Office/DRM 파일 판별기가 아니며 NASCA 원본에 연결하지 않는다. 본문을 포함한 반환값은 보호된 호스트 정책에 맞게 사용하고 일반 로그에 쓰지 않는다.

## 첫 과제와 검사

2026-10-16 후속 호스트 모델 연결과 실제 합성 문서 생성 결과는 [최신 제한 평가 기록](../../docs/research/2026-10-16-document-agent-host-model-quality.md)에 분리한다. 아래 과거 두 CLI 진입 실패를 지우거나 제품 전체 비교 성공으로 바꾸지 않는다. 전체 기능 범위는 [기능군 공백](CAPABILITY-COVERAGE.md)을 따른다.

`eval/WD-CREATE-01.json`은 허구의 시범 운영 자료로 1쪽 A4 보고서를 작성하는 과제다. 작성 6건, 검토 완료 3건, 대기 3건과 완료율 50%, 담당자/기한/배포 보류를 다룬다. 정답 초안은 `reference-draft.json`, 독립 검사 코드는 `word-create-oracle.mjs`에 두며 생산 생성기는 이를 import하지 않는다.

```bash
npm test
npm run verify:vendor
node scripts/create-word-example.mjs artifacts/word-create-example
node scripts/benchmark-word.mjs artifacts/word-create-benchmark
```

같은 출력 디렉터리의 예전 파일은 덮어쓰지 않으므로 다시 실행할 때 새 경로를 지정한다. 예시 파일은 고정 명세로 만든 생성기/렌더 확인용이며 실모델 작성 품질 성적이 아니다. 모델 주입 흐름 검사는 시험용 transport를 사용한다.

실제 비교 실행기는 두 CLI에 같은 자료와 JSON 구조를 주고 같은 생성기로 DOCX를 만드는 제한 비교다. 제품 전체의 파일 작성/편집/렌더링 도구 사용 방식은 측정하지 않는다. CLI 버전과 설정, 계획/시도/차단/미실행을 기록한다. 제품별 3회, 총 6회를 계획했지만 이번에는 Codex 로컬 런타임 권한 제한과 Claude 인증 문제로 각 1회 진입에서 막혔다. 후속 4회는 미실행으로 유지하며 생성된 실모델 문서는 0개다. 제품 간 정확도/속도 우열을 산출하지 않는다. stderr/인증/로그인 주소는 저장하지 않는다.

## 화면 확인

런타임이 제공한 Python과 `documents/render_docx.py`, 번들 LibreOffice로 생성 파일을 렌더했다. 최초 기본 글꼴 경로에서는 한글이 누락되어 실패로 판단했다. 호스트 글꼴을 Apple SD Gothic Neo로 지정하고 QA용 fontconfig/SAL_FONTPATH가 시스템 글꼴을 읽도록 설정한 뒤 재렌더했다. 최종 1쪽 PNG에서 한글/표/굵게 표시를 확인했고 문단 겹침/페이지 넘침이 없음을 검토했다. 글꼴 설정은 로컬 QA 프로세스에만 적용하고 시스템/Office 보안 설정을 바꾸지 않았다.

실제 Windows Word/Office 2016 화면, NASCA 보호와 저장/재열기, Qwen 등 실모델 품질은 미검증이다. 구조 검사, 로컬 렌더와 실제 Office 확인을 구분한다.
