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

- [x] Step 1: 시험(2026-10-21 08:55). `tests/docx-snapshot.test.mjs` 5건: Office 시뮬레이션 호스트의 양식 6종(기안문, 개조식 기안문, 출장 보고, 품의서, 주간 보고, 업무 보고)을 `tests/helpers-docx-fixture.mjs`로 실제 docx로 조립해 `wordFormMap`이 `word-form-map.test.mjs`와 같은 칸/목차/표 행/작성 요령/안내 문구 슬롯을 내는지 확인. 콘텐츠 컨트롤은 field, 깨진 파일은 `docx_invalid`.
- [x] Step 2: 구현. `runtime/docx-snapshot.mjs`: 의존성 없는 OOXML 태그 토크나이저로 요소 트리(각 요소의 문자 범위 유지), styles.xml(outlineLvl와 크기는 basedOn 사슬로 해석), numbering.xml(decimal/ganada/bullet 등 listString, 깊은 단계 초기화), 문단(하이퍼링크/fldSimple/인라인 sdt 안의 run 포함, 삭제 추적 제외, 같은 서식 run 병합, textRuns, editable=run 1개), 표(gridSpan, tcW, vMerge 이어짐 셀 제외), 블록/인라인 sdt → `f-N` field(tag, alias, 종류, showingPlcHdr). `locations`에 문단/셀/필드의 XML 범위를 둬 Task D가 조각만 고친다. `extractFormMap`은 Office `word-form-map.mjs`를 그대로 호출.
- [x] Step 3: 통과(5/5). 제한: 중첩 표는 셀 글자로만 읽음, OOPIF 없음, 각주/머리글은 읽지 않음(본문만).

### Task B: 양식 패키지 저장과 등록 카드 데이터

**Files:** Modify `runtime/document-forms.mjs`; Create `tests/document-forms.test.mjs`.

**Interfaces:** `registerForm({workspace, source, name}) -> forms/<name>/{form-map.json, source.sha256, preview.json}`; `loadForm(workspace,name) -> {map, hash, changed}`; `formQuestionPlan(map, values) -> {questions:[{id,label,kind,required,example,group}], filled:[...]}`.

- [x] Step 1: 시험(2026-10-21 09:05). `tests/document-forms.test.mjs` 2건: 등록 뒤 `.nubi/forms/<이름>/{form-map.json, source.sha256, preview.json}`, 목록, 원본이 바뀌면 `changed:true`(원본이 없으면 null), 없는 양식은 `form_missing`, 이름 검증, 질문 계획(표 하나가 질문 하나, 목차 하나가 질문 하나, 필수 먼저, 선택인 표 행은 뒤, 값이 있으면 filled).
- [x] Step 2: 구현. `runtime/document-forms.mjs`: registerForm(원본은 읽기만, Workspace 안 원본은 상대 경로 기록), loadForm, listForms, formPreview(값 없이 라벨/종류/안내 문구), formQuestionPlan(group은 셀→표 id, 표 행→표 id, 안내 문구 슬롯→목차 id; 예시는 안내 문구 또는 종류별 보기).
- [x] Step 3: 통과(2/2).

### Task C: 채움 계획(근거 또는 질문)과 서비스 메서드

**Files:** Modify `runtime/project-service.mjs`(또는 `desktop-features.mjs` 패턴으로 `installDocumentForms(Service)`), Create `runtime/document-forms-service.mjs`, `tests/document-forms-service.test.mjs`.

**Interfaces:** `formPlan({name, sources:{files:[], wikiQuery, mail}, answers}) -> {sheet:{cells,rows,sections}, questions, evidence}`; `formAnswer({planId, answers})`. 모델은 `createFormFill`의 structured/ask 포트를 Desktop 전송에 연결해 쓴다. 근거 없는 값은 넣지 않고 질문으로 보낸다.

- [x] Step 1: 시험(2026-10-21 09:40, 가짜 모델). `tests/document-forms-service.test.mjs` 2건: 요청과 자료(위키 발췌)에서 채운 칸마다 source와 quote가 붙고, 자료에 없는 칸(출장 기간)은 질문 카드로 가며, 빈 답은 한 번 더 묻고, 답을 주면 채움표를 다시 써서 ready가 된다(cells 3회, section 2회). 거절된 채움표(요청에 없는 인용)는 이유와 함께 되돌아가 두 번째에 통과. 양식 없음, 요청 없음, 프로젝트 바뀜, 공급자 없음, 잘못된 action 거절. 등록/목록/질문 계획도 같은 메서드로.
- [x] Step 2: 구현. 메서드는 하나 `documentForm({action})`: register, list, questions, plan, answer, status, cancel(허용 목록 등록). `runtime/document-forms-service.mjs`: Office `createFormFill`을 Desktop `modelTransport`에 연결(structured: 스키마 거절 피드백 3회, form_fill 목적), ask는 열린 칸 전부를 한 카드로 돌려주고 답은 "라벨: 값"으로 answers에 넣어 모델이 인용하게 한다. 자료는 `sources.files`(Workspace 글 파일 10개, 2만 자)와 `sources.passages`(호출자가 넘기는 위키/메일/파일 발췌 40개)이며 history-N으로 들어가 evidence가 kind/ref로 되돌아온다. 목차의 sources는 Office 파서가 버리므로 구조화 응답에서 따로 보관. Office 부품은 `scripts/build-office-forms.mjs`가 typebox/numfmt와 함께 `generated/office-forms.mjs`로 묶는다(pretest, compile). Task B 등록 패키지에 `items.json`(값 없는 항목)을 더해 채움 실행의 장부가 원본 없이도 선다.
- [x] Step 3: 통과(2/2). 계획과 다른 점: `formChecks`는 사본에 쓴 뒤 비교하는 검사라 Task D(form_apply) 뒤로 미뤘고, 채움표 자체의 검사(인용 일치, 숫자, 안내 문구)는 Office `parseCellSheet`가 한다. 위키 질의와 메일 조회는 호출자(에이전트/화면)가 발췌로 넘긴다.

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
