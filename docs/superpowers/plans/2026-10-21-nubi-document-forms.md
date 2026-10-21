# 문서 양식 작성 구현 계획 (Word 먼저)

> 실행: Claude가 직접 구현한다(2026-10-21 사용자 지시 "고도화를 네가 해도 좋아. Office 문서 작성부터"). 각 과제는 시험 먼저, 구현, 통과, 기록 순서다. 체크박스는 완료 때 갱신한다.

**목표:** 사용자가 Word 양식 파일을 열면 누비가 양식을 해석해 저장하고, 작성 때 필요한 값을 근거에서 찾거나 한 카드로 묻고, 사본에 제자리 편집으로 채운 뒤 전후 렌더로 확인하고 Workspace에 저장한다.

**구조:** 누비 Office S1의 순수 Node 부품(`packages/nubi-office/worker/word-form-map.mjs`, `form-fill.mjs`, `form-apply.mjs`, `form-checks.mjs`, `form-values.mjs`, `guide-text.mjs`)을 Desktop에서 그대로 import한다. 새로 만드는 것은 Word 없이 docx에서 같은 스냅숏 항목을 만드는 OOXML 읽기, 같은 작업(fill_cell, replace_guide, replace_text, fill_field)을 docx 사본에 제자리로 쓰는 OOXML 쓰기, 질문 묶음, 전후 렌더, 서비스 메서드와 카드 UI다. Windows에서 문서가 열려 있으면 기존 externalOffice 경로가 같은 작업을 COM으로 실행한다.

**기술:** Node 22+, jszip(Desktop 의존성에 이미 있음), saxes, 기존 nubi-office worker 모듈, LibreOffice는 Mac 시험 전용(§8 답 25), pdfjs-dist(기존).

**설계:** `docs/superpowers/specs/2026-10-21-nubi-document-writing-quality-design.md`(D1~D8), 워크플로우 설계 §3.9, 계획 Task 11~13(`2026-10-18-nubi-workflow-agent-phase1.md`).

## 전역 제약

- **등록은 Office를 열어 전체 내용을 가져온다(사용자 지시 2026-10-21 11:20).** 텍스트, 서식(글꼴, 크기, 색), 그림, 수식, 모든 시트, 도형을 캡처 계약 v1로 저장하고 원본 바이트 사본을 함께 둔다. 파일만 읽는 등록(`engine:'file'`)은 Mac과 CI의 시험 전용이며 제품에서는 호출자가 `acknowledgeFileOnly:true`를 명시해야 하고 결과에 `fidelity:'file'`이 남는다. 설계 §3 "양식 등록은 Office를 열어 전체를 가져온다".

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

- [x] Step 1: 시험(2026-10-21 10:30). `tests/docx-apply.test.mjs` 4건: 칸 채우기 뒤 document.xml 외 zip 항목 전부 바이트 동일(`verifyDocxCopy`), 바뀐 문단은 대상뿐(targets 밖이면 violations), 두 서식 문단의 안내 문구 치환은 굵은 run을 유지하고 표식 run은 그대로, 문단 통째 쓰기는 스타일 유지, 견본 같은 문단 삽입/삭제(마지막 문단 보호), 표 행 추가(폭과 span 유지, 빈 셀), 콘텐츠 컨트롤 채우기(placeholder 해제), 없는 대상과 작업은 Office 거절 코드. Office `applyFill`로 출장 보고 채움표 전체(13 작업)를 쓰고 `formChecks` "칸 4/4, 목차 2/2, 남은 안내 문구 0, 서식 유지, 근거 확인", 같은 채움표 두 번째는 작업 0. 서비스 `tests/document-forms-service.test.mjs` 3번째: apply가 Workspace 안 사본에 쓰고(원본 경로는 `form_source_protected`, .docx 아니면 `form_output_invalid`, 있는 파일은 `form_output_exists`), 검토 목록(REVIEWER)까지 돌아 state written, 원본은 그대로.
- [x] Step 2: 구현. `runtime/docx-apply.mjs`: `applyOperationToXml`(fill_cell, replace_text, replace_guide/replace_text_fragment, fill_field, insert_paragraphs, remove_paragraph, add_rows)은 대상 요소의 문자 범위만 바꿔 끼운다. 문단은 pPr와 책갈피를 보존하고 run을 다시 만든다(같은 rPr의 run 병합, 치환 글자는 안내 문구가 시작한 run의 서식). `createDocxWriter`가 Office 채움의 read/apply 포트가 되고 쓰기마다 다시 읽어 Office 호스트와 같은 영수증 검사(내용, 서식 보존, 다른 칸과 문단 보존, 표 모양)를 돌려준다. `docx-snapshot`은 Word처럼 셀 문단도 p-N에 세어(호스트와 같은 번호) 지도가 COM 경로와도 맞는다. 서비스 apply: 첫 카드는 apply 호출이 승인, 고친 채움표는 state approval로 멈춰 다시 apply, 질문은 answer. 끝나면 사본 저장과 `verifyDocxCopy` 결과(`written`).
- [x] Step 3: 통과(4/4, 서비스 3/3). Windows COM 경로는 기존 externalOffice 연결을 쓰는 후속이며 이 docx 경로가 Mac과 CI의 기준이다.

### Task E: 전후 렌더

**Files:** Create `runtime/document-render.mjs`, `tests/document-render.test.mjs`.

**Interfaces:** `renderDocumentPages(path, {outDir, soffice}) -> {pages:[png], status:'rendered'|'unavailable', engine}`; soffice는 `NUBI_SOFFICE` 또는 PATH에서 찾고 없으면 `unavailable`("렌더 미확인"). Mac 시험 전용. 페이지별 PNG는 LibreOffice PageRange 필터로 뽑는다.

- [x] Step 1: 시험(2026-10-21 10:50). `tests/document-render.test.mjs` 2건: `soffice:false`면 unavailable(soffice_missing), 지원 안 하는 형식은 format_unsupported, 이 Mac에서는 출장 보고와 기안문이 PDF와 page-1.png로 나온다(전후 3.6초). 서비스 4번째: written 전 render는 `form_plan_not_written`, LibreOffice 없이는 unavailable, 있으면 `.nubi/forms/<이름>/renders/<planId 8자>/{before,after}/page-N.png`.
- [x] Step 2: 구현. `runtime/document-render.mjs`: `findSoffice`(NUBI_SOFFICE → 흔한 위치 → PATH, false면 찾지 않음), `renderDocumentPages`(격리 프로필로 PDF 변환, pdfjs로 쪽수(없으면 /Type /Page 수), 쪽마다 `writer_png_Export` PageRange로 PNG, 상한 12쪽), `renderBeforeAfter`. 서비스 `documentForm render`.
- [x] Step 3: 통과(2/2, 서비스 4/4). CI(ubuntu)에는 LibreOffice가 없어 unavailable 경로만 돈다. Windows 설치판은 COM 렌더가 아니라 Office 자체 확인이다(§8 답 25).

### Task H: Office 전체 캡처 명령 (Codex, C# 호스트)

2026-10-21 Codex 확인: Desktop 실제 통로와 본 Files/Interfaces가 다르다. 워크플로우 설계 §8 질문34와 `docs/OFFICE-CAPTURE-TASK-H-2026-10-21.md` 참조. 제품 구현 전 연결 범위 답 대기.

**Files:** Modify `packages/nubi-office/native/Nubi.Office.Host/ContentPort.cs`(`office_capture_template` 분기), Create `ContentCapture.cs`(Word, Excel, PowerPoint 캡처), Modify `NubiPane.cs`(읽기 전용 분류). 시험: `Nubi.Office.Tests`에 캡처 JSON 스키마 검사(COM 없이 가짜 문서), 실제 Office는 사용자 PC.

**Interfaces:** `office_capture_template {scopeId, outDir, maxAssets:200, renders:true}` → 캡처 계약 v1(설계 §3). 자산과 렌더는 outDir에 파일로 쓰고 JSON에는 경로만. 문서는 바꾸지 않는다(읽기만, 렌더는 ExportAsFixedFormat/Slide.Export/Range.CopyPicture를 임시 폴더로).

- [ ] Step 1: 시험. Word 합성 문서(그림 1, 머리글, 각주, 굵은 빨간 run, 표 음영)에서 runs 서식, 그림 자산, 머리글 글이 JSON에 있고 renders가 쪽 수만큼 있다. Excel 2시트(수식, 숫자 서식, 채움색, 병합, 이름 정의)와 PowerPoint 2슬라이드(자리표시자, 그림)도 같은 방식.
- [ ] Step 2: 구현.
- [ ] Step 3: 통과(사용자 PC Office 2016 확인 포함).

### Task I: Desktop 캡처 수신과 등록 엔진 (Claude)

**Files:** Create `runtime/office-capture.mjs`(계약 검증과 요약), `runtime/docx-capture.mjs`(file 엔진: runs 서식, 그림, 머리글과 바닥글, 각주, 구역), Modify `runtime/document-forms.mjs`(원본 사본, capture.json, assets), `runtime/document-forms-service.mjs`(register engine 'office'는 연결된 네이티브 호스트로 캡처, 없으면 `form_office_required`; 'file'은 acknowledgeFileOnly), `runtime/native-office-host.mjs`(연결 접근자).

- [x] Step 1: 시험(2026-10-21 11:55). `tests/docx-capture.test.mjs` 2건(run의 글꼴/크기/색/굵게/기울임, 그림 자산과 기준 문단과 크기, 머리글과 바닥글, 용지와 여백, 표 셀 폭, 계약 검증의 거절 7가지), `document-forms.test.mjs`(등록 폴더: assets, capture.json, form-map.json, items.json, preview.json, source.docx 사본, source.sha256; preview.fidelity), `document-forms-service.test.mjs` 5번째(Office 연결 없이는 `form_office_required`, file 엔진은 acknowledgeFileOnly 필수, 가짜 호스트의 `office_capture_template`로 등록하면 자산 저장과 Office로 확인함 표시, 임시 폴더 정리). `tests/docx-compare.test.mjs`(§8 답 33 비교 DTO).
- [x] Step 2: 구현. `runtime/office-capture.mjs`(계약 v1 검증, 요약, 기록), `runtime/docx-capture.mjs`(file 엔진), `runtime/docx-compare.mjs`(기존 비교기용 before/after 블록, 문단은 글자 정렬, 셀은 자리), `document-forms.mjs`(원본 바이트 사본 읽기 전용, capture.json과 assets), `document-forms-service.mjs`(register 기본 engine office: 작업의 네이티브 Office 연결로 `office_capture_template {path,outDir,maxAssets:200,renders:true}` 호출, 자산 읽어 저장, 원본 경로 일치 검사; written에 compare), `native-office-host.mjs`(`nativeOfficeHost` 읽기 전용 접근자).
- [x] Step 3: 통과(10/10). 호스트 명령 자체는 Task H(Codex).
- [x] (2026-10-21 12:40) Excel/PowerPoint file 엔진: `runtime/xlsx-capture.mjs`(exceljs: 숨김 시트 포함 모든 시트, 값/수식/결과, 숫자 서식, 글꼴/채움/테두리/정렬, 병합, 서식만 있는 빈 셀, 데이터 유효성(셀 목록에 없는 것도), 조건부 서식, 열 너비와 행 높이, 탭 색, 이름 정의, 그림 자산과 위치, 차트 종류와 제목), `runtime/pptx-capture.mjs`(슬라이드 순서, 레이아웃 이름, 배경, 자리표시자, 위치와 크기(pt), run의 글꼴/크기/색/굵게, 그림 자산과 설명, 표, 차트, 그룹, 노트), `runtime/office-file-capture.mjs`(확장자로 앱 선택). 등록은 세 앱 모두 원본 사본과 capture.json과 assets를 저장하고, 채움 지도는 Word만 만든다(Excel/PowerPoint는 `fillable:false`, questions/plan은 `form_fill_unsupported_app`). Office 연결의 앱과 파일의 앱이 다르면 `form_office_app_mismatch`. 시험 `tests/office-file-capture.test.mjs` 3, 등록 1, 서비스 보강.

### Task F: 화면(양식 등록, 질문 카드, 채움표 확인, 전후 비교, 저장)

**Files:** Create `ui/FormRegisterCard.jsx`, `ui/FormFillCard.jsx`, `ui/form-cards.css`, `tests/form-cards-ui-fixture.jsx`, `scripts/check-form-cards-ui.mjs`; Modify `electron-app/FileWorkspace.jsx`(실제 문서 파일 진입에서 "양식으로 등록"과 "양식으로 작성"); Create `ui/DocumentFormControl.jsx`, `ui/form-cards-view.mjs`, `tests/form-cards-view.test.mjs`. 기존 Electron main의 일반 dispatch와 `documentForm` 등록을 사용하므로 생성물 `lib/main.cjs`는 편집하지 않음.

- [x] Step 1: 시험(1280/440 캡처, 디자인 규칙). 등록 카드는 칸 목록과 라벨 수정, 질문 카드는 한 묶음 폼(기존 WorkflowPanel 입력 폼 양식 재사용), 채움표 카드는 OfficeTransaction 양식, 전후 비교는 두 페이지 그림과 바뀐 칸 표시.
- [x] Step 2: 구현. 모션과 접근성 규칙 준수.
- [x] Step 3: 답 33/38차 계약 화면 통과(2026-10-21). written.compare를 기존 NativeDocumentPreview에 연결. 음영/원본 잠깐 보기/삽입과 삭제 내역, Excel/PPT 저장됨 및 작성 차단, fidelity 표시. 1280/440 FileWorkspace 합성 호스트 화면과 디자인/접근성 검사 통과. 집중 20/20 뒤 새 표시 시험 포함 순수 Node 4/4, 기존 Office UI 6장면 통과. 전체 게이트와 실제 모델/Windows/설치판은 별도. `docs/DOCUMENT-FORMS-TASK-F-2026-10-21.md` 및 새 SHA 명세 참조.

### Task G: 벤치마크 기준선

- [x] (2026-10-21 12:40) 양식 채우기 기준선: `eval/document-forms/run.mjs`(제품 경로 register → plan → answer → apply, 로그인한 Claude 모델, 코드 채점: 열림(파싱과 LibreOffice 변환), 비대상 보존(verifyDocxCopy), 칸 값과 목차 낱말, 남은 안내 문구, 빠진 값 질문). 합성 5과제(기안문, 출장 보고, 품의서, 주간 보고, 값이 빠진 출장 보고) 결과 `eval/document-forms/synthetic-baseline-2026-10-21.json`: 5/5 성공, 정확도 1.0, 보존 5/5, 열림 5/5, 질문 1/1, 중앙값 17.3초, 모델 호출 합 18(과제당 1~5). 1차에서 찾은 결함 둘을 고쳤다. ① 검증이 문단을 id로 비교해 새 문단 뒤 마지막 빈 문단을 대상 밖 변경으로 보고 → 글자 정렬(LCS)로 수정, 회귀 시험 추가. ② Mac LibreOffice 렌더에서 한글이 네모(fontconfig가 macOS 글꼴을 못 봄) → 렌더 때 macOS 글꼴 폴더를 담은 fonts.conf, 시험은 PDF에 한글 글꼴이 들어갔는지 확인. 채점기 시험 `tests/document-forms-eval.test.mjs`.
- [ ] 새로 만들기 2과제(document-agent `createWordDocument`)와 Office 2016 실기 확인은 남음.

### Office 기능 점검표 (2026-10-21 14:40, 사용자 지시 "오피스에서 할 수 있는 모든 걸 다 테스트", "워드 먼저 모든 기능 완벽하게, 엑셀과 파워포인트는 1.3.1")

- [x] 점검 파일 생성기 `eval/office-fidelity/make_fixtures.py`(python-docx/openpyxl/python-pptx와 직접 쓴 OOXML)와 고정 파일 `tests/fixtures/office-fidelity/synthetic-kitchen-sink.{docx,xlsx,pptx}`. 세 파일 모두 LibreOffice에서 열린다.
- [x] 채점표 `eval/office-fidelity/features.mjs`(Word 38, Excel 25, PowerPoint 20 항목)와 `report.mjs`. 처음 측정: Word 11/38, PowerPoint 7/20, Excel은 exceljs가 차트 시트에서 읽기 실패.
- [x] Word file 엔진 다시 작성(`runtime/docx-capture.mjs`, 공용 `runtime/ooxml-parts.mjs`): run 서식 전부, 문단 서식, 스타일 목록 번호(스냅숏도 스타일 numPr 해석), 표(병합, 음영, 머리글 반복, 중첩), 인라인/떠 있는 그림(위치, 배치, 자르기), 도형과 글상자, 차트(종류, 제목, 계열), 수식, 링크, 책갈피, 필드, 각주와 미주, 메모, 변경 추적, 입력 컨트롤 4종, 구역(방향, 단), 머리글과 바닥글(종류별), 스타일, 테마. 결과 **Word 38/38**(`tests/office-fidelity.test.mjs`). 비교 DTO에 머리글과 바닥글 글자 추가.
- [x] Excel 읽기 실패 시 시트 목록만 담은 부분 캡처로 저장(원본 사본은 그대로). Excel 25항목, PowerPoint 20항목 보강은 1.3.1.
- [ ] Windows Office 2016에서 같은 채점표(Task H, Word).
