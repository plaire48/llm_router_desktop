# 문서 양식 작성 구현 계획 (Word 먼저)

> 실행: Claude가 직접 구현한다(2026-10-21 사용자 지시 "고도화를 네가 해도 좋아. Office 문서 작성부터"). 각 과제는 시험 먼저, 구현, 통과, 기록 순서다. 체크박스는 완료 때 갱신한다.

**목표:** 사용자가 Word 양식 파일을 열면 누비가 양식을 해석해 저장하고, 작성 때 필요한 값을 근거에서 찾거나 한 카드로 묻고, 사본에 제자리 편집으로 채운 뒤 전후 렌더로 확인하고 Workspace에 저장한다.

**구조:** 누비 Office S1의 순수 Node 부품(`packages/nubi-office/worker/word-form-map.mjs`, `form-fill.mjs`, `form-apply.mjs`, `form-checks.mjs`, `form-values.mjs`, `guide-text.mjs`)을 Desktop에서 그대로 import한다. 새로 만드는 것은 Word 없이 docx에서 같은 스냅숏 항목을 만드는 OOXML 읽기, 같은 작업(fill_cell, replace_guide, replace_text, fill_field)을 docx 사본에 제자리로 쓰는 OOXML 쓰기, 질문 묶음, 전후 렌더, 서비스 메서드와 카드 UI다. Windows에서 문서가 열려 있으면 기존 externalOffice 경로가 같은 작업을 COM으로 실행한다.

**기술:** Node 22+, jszip(Desktop 의존성에 이미 있음), saxes, 기존 nubi-office worker 모듈, LibreOffice는 Mac 시험 전용(§8 답 25), pdfjs-dist(기존).

**설계:** `docs/superpowers/specs/2026-10-21-nubi-document-writing-quality-design.md`(D1~D8), 워크플로우 설계 §3.9, 계획 Task 11~13(`2026-10-18-nubi-workflow-agent-phase1.md`).

## 전역 제약

- 원본 양식 파일은 절대 쓰지 않는다. 출력 경로가 원본과 같으면 `form_source_protected`.
- OOXML 쓰기는 풀기 → 바뀌는 문단 조각만 편집 → 묶기. 바뀌지 않는 zip 항목은 바이트 동일.
- 비밀값과 사내 자료는 시험 픽스처에 넣지 않는다. 픽스처는 합성 양식만.
- 모델 호출은 Desktop의 기존 전송(modelTransport)만 쓴다.
- 사용자에게 보이는 글과 오류는 한국어.

---

### Task A: docx 스냅숏 읽기와 양식 지도 추출

**Files:** Create `packages/nubi-desktop/runtime/docx-snapshot.mjs`, `packages/nubi-desktop/runtime/document-forms.mjs`, `packages/nubi-desktop/tests/docx-snapshot.test.mjs`, `packages/nubi-desktop/tests/helpers-docx-fixture.mjs`(합성 docx를 jszip으로 조립).

**Interfaces:** `docxSnapshot(buffer) -> {items, styles, paragraphs:Map<id, xmlLocation>}`; item 모양은 Word 호스트와 같다(`{id:'p-N'|'tT/rR/cC', kind:'paragraph'|'cell'|'field', text, style, outlineLevel, listString, bold, editable:true, writable:true, fields, controls, table,row,column,span,width, tag,title,controlType,showingPlaceholder}`). `extractFormMap(buffer) -> {map, hash, items, summary}`는 `wordFormMap(items)`를 그대로 쓴다.

- [ ] Step 1: 시험. 합성 기안문 docx(제목, 2행 표, 번호 제목, 안내 문단, 한글 목록, 굵은 라벨+날짜 안내)에서 항목 id와 종류, outlineLevel, 표 좌표가 기대와 같고 `wordFormMap`이 칸 2개와 절 1개와 날짜 칸 1개를 낸다.
- [ ] Step 2: 구현. `w:body` 순회, `w:p`(style → outlineLevel은 styles.xml의 `w:outlineLvl` 또는 Heading N), `w:numPr` → listString, `w:tbl`(gridSpan, tcW), `w:sdt`(content control) → field. 문단 id는 문서 순서 번호, 셀 id는 표/행/열.
- [ ] Step 3: 통과와 기록.

### Task B: 양식 패키지 저장과 등록 카드 데이터

**Files:** Modify `runtime/document-forms.mjs`; Create `tests/document-forms.test.mjs`.

**Interfaces:** `registerForm({workspace, source, name}) -> forms/<name>/{form-map.json, source.sha256, preview.json}`; `loadForm(workspace,name) -> {map, hash, changed}`; `formQuestionPlan(map, values) -> {questions:[{id,label,kind,required,example,group}], filled:[...]}`.

- [ ] Step 1: 시험. 등록 뒤 폴더 세 파일, 원본 해시가 바뀌면 `changed:true`, 질문 계획이 필수 빈 칸만 한 묶음으로 낸다.
- [ ] Step 2: 구현. 질문 묶음은 필수 칸 먼저, 같은 group은 한 질문으로.
- [ ] Step 3: 통과.

### Task C: 채움 계획(근거 또는 질문)과 서비스 메서드

**Files:** Modify `runtime/project-service.mjs`(또는 `desktop-features.mjs` 패턴으로 `installDocumentForms(Service)`), Create `runtime/document-forms-service.mjs`, `tests/document-forms-service.test.mjs`.

**Interfaces:** `formPlan({name, sources:{files:[], wikiQuery, mail}, answers}) -> {sheet:{cells,rows,sections}, questions, evidence}`; `formAnswer({planId, answers})`. 모델은 `createFormFill`의 structured/ask 포트를 Desktop 전송에 연결해 쓴다. 근거 없는 값은 넣지 않고 질문으로 보낸다.

- [ ] Step 1: 시험(가짜 모델). 근거가 있는 칸은 evidence가 붙고 없는 칸은 questions로 가며, 답을 주면 채움표가 다시 검사된다(`formChecks`).
- [ ] Step 2: 구현. 
- [ ] Step 3: 통과.

### Task D: docx 사본에 제자리 쓰기와 검증

**Files:** Create `runtime/docx-apply.mjs`, `tests/docx-apply.test.mjs`.

**Interfaces:** `applyDocxOperations(buffer, operations, {snapshot}) -> {buffer, applied, skipped}`; 작업은 form-apply의 `nextOperation`이 내는 `fill_cell`, `fill_field`, `replace_guide`, `replace_text`, `add_rows`(행 복제), `insert_paragraphs`, `remove_paragraph`. `verifyDocxCopy(original, result, {targets}) -> {sameEntries, changedParagraphs, violations}`.

- [ ] Step 1: 시험. 셀 채우기 뒤 다른 zip 항목은 바이트 동일, 안내 글 치환은 run 서식(rPr) 유지, 같은 채움표 두 번 적용은 두 번째 쓰기 0, 원본 경로 출력은 거절.
- [ ] Step 2: 구현. 바뀌는 `w:p`만 문자열 범위로 바꿔 끼우고 나머지 XML은 그대로. 쪼개진 run은 합친다(Claude 스킬의 merge_runs).
- [ ] Step 3: 통과.

### Task E: 전후 렌더

**Files:** Create `runtime/document-render.mjs`, `tests/document-render.test.mjs`.

**Interfaces:** `renderDocumentPages(path, {outDir, soffice}) -> {pages:[png], status:'rendered'|'unavailable', engine}`; soffice는 `NUBI_SOFFICE` 또는 PATH에서 찾고 없으면 `unavailable`("렌더 미확인"). Mac 시험 전용. 페이지별 PNG는 LibreOffice PageRange 필터로 뽑는다.

- [ ] Step 1: 시험. soffice가 없으면 unavailable, 있으면(이 Mac) 합성 docx가 1페이지 PNG로 나온다.
- [ ] Step 2: 구현.
- [ ] Step 3: 통과.

### Task F: 화면(양식 등록, 질문 카드, 채움표 확인, 전후 비교, 저장)

**Files:** Create `ui/FormRegisterCard.jsx`, `ui/FormFillCard.jsx`, `ui/form-cards.css`, `tests/form-cards-ui-fixture.jsx`, `scripts/check-form-cards-ui.mjs`; Modify `ui/Workbench.jsx`(진입: 문서 파일을 열었을 때 "양식으로 등록"과 "양식으로 작성"), `electron-app/lib/main.cjs` dispatch.

- [ ] Step 1: 시험(1280/440 캡처, 디자인 규칙). 등록 카드는 칸 목록과 라벨 수정, 질문 카드는 한 묶음 폼(기존 WorkflowPanel 입력 폼 양식 재사용), 채움표 카드는 OfficeTransaction 양식, 전후 비교는 두 페이지 그림과 바뀐 칸 표시.
- [ ] Step 2: 구현. 모션과 접근성 규칙 준수.
- [ ] Step 3: 통과.

### Task G: 벤치마크 기준선

- [ ] 설계 §4의 Word 10과제 중 양식 채우기 4개와 새로 만들기 2개를 합성 양식으로 돌려 복구 없이 열림, 비대상 보존, 양식 정확도를 코드로 채점하고 `eval/document-forms/`에 기록. 렌더는 이 Mac의 LibreOffice로 사람이 확인한다.
