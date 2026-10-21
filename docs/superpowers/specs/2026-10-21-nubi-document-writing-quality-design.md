# 문서 쓰기 품질 설계: Claude Code 문서 스킬 벤치마크와 누비 적용 (2026-10-21, Claude)

사용자 요청(2026-10-21): "COM으로 외부에서 연 문서를 에이전트가 자연스럽게 고치는 것, 실제로 파일을 얼마나 잘 쓰는지가 중요하다. Word, Excel, PPT 모두 ① 파일 쓰기 ② 문서를 열어 그대로 양식화(XML)하고 그 양식을 사용자 정보나 질문으로 채워 문서를 만드는 구조. Claude Code를 벤치마킹해 품질을 최대한 올려라." 그리고 "문서 쓰기는 정해진 길이 없으니 Claude를 벤치마킹하자."

벤치마크 대상은 이 세션에서 읽은 Claude Code의 세 스킬(docx 93줄, pptx 270줄, xlsx 99줄과 각 scripts)이다. 누비 쪽 현재는 `packages/nubi-document-agent`(GenOffice 엔진 재사용, 작업 172개 연결, 구성 계획과 품질 루프, Windows 네이티브 쓰기 포트는 미실측), `packages/nubi-office`(Office 2016 VSTO, S1 Word 표 양식 작성), Desktop의 Task 11~13(양식 지도 추출, 채움표와 검토 카드, `office.apply_form` COM 우선/OOXML 대체), `office-document.ps1`(COM 읽기), `native-office-draft/host`(승인 뒤 반영)이다.

## 1. Claude Code가 하는 것과 누비의 현재 (대조표)

| 단계 | Claude Code 스킬 | 누비 현재 | 격차 |
|---|---|---|---|
| 새 문서 만들기 | Word는 docx-js, PPT는 pptxgenjs **구조화 덱**(테마, 레이아웃, 자리표시자, 섹션), Excel은 openpyxl에 **값 대신 수식** | GenOffice 엔진으로 빈 문서와 문단/표/슬라이드 생성, 구성 계획 `prepareComposition` | 구조화 덱(레이아웃과 자리표시자로 한 곳에서 재스타일)과 Excel 수식 우선 규칙이 명문화돼 있지 않다 |
| 기존 문서 편집 | **풀기 → XML 제자리 편집(재직렬화 금지) → 묶기 → `validate.py --original`**. Word는 `merge_runs`로 쪼개진 run을 합친 뒤 찾기 | COM 경로는 열린 문서 안에서 관찰 뒤 패치, OOXML 대체 경로는 엔진 재직렬화 | OOXML 대체 경로가 전체 재직렬화면 서식과 미지원 요소가 깨진다. 제자리 편집 규칙과 원본 기준선 검증이 없다 |
| 양식 채우기 | PPT: "양식 칸 ≠ 자료 개수"(남는 그룹은 통째로 삭제), `<a:pPr>` 보존, 리터럴 글머리표 금지, `xml:space` | Word 표 칸(S1), 채움표를 코드가 먼저 검사 | Excel과 PPT 양식 지도가 없다. "남는 칸 처리"와 "서식 보존" 규칙이 Word 밖에는 없다 |
| 검증 | 스키마/관계/콘텐츠 타입/차트 검사(`validate.py`), Excel은 **재계산 뒤 오류 0**(`recalc.py`), 추적 변경은 저자 기준 누락 검사 | 품질 루프에 렌더/사실/보존/계산 검토, Excel 함수 471종 실행 원장 | OOXML 수준의 구조 검증기와 "원본 대비 변경 없음" 기준선이 없다. 재계산은 Windows에서만 가능 |
| 눈으로 확인 | PDF로 변환해 페이지 그림을 **직접 본다**, PPT는 썸네일 격자 | 캡처 검수 규칙은 UI에만 있음 | 문서 결과물을 그림으로 보는 단계가 없다 |
| 수정 제안 방식 | 추적 변경(redline)으로 제안하고 사람이 Word에서 수락 | 승인 카드 뒤 반영 | 문서 안 추적 변경으로 제안하는 길이 없다. 사용자 관점에서는 이게 가장 자연스럽다 |
| 읽기 | pandoc/markitdown으로 구조 읽기 | 네이티브 읽기 포트와 COM 읽기 | 동등 |

## 2. 채택할 원칙

1. **기존 문서는 제자리 편집만.** OOXML 대체 경로도 풀기 → 바뀌는 조각만 편집 → 묶기이며 재직렬화하지 않는다. 비대상 부분은 바이트 단위로 같아야 한다(원본 기준선 검증).
2. **검증은 코드가, 그림은 사람이.** 저장 뒤 반드시 구조 검증(스키마, 관계, 콘텐츠 타입, 차트)과 재읽기(readback)를 통과한다. Excel은 재계산 오류 0. 렌더 그림은 가능한 환경(Windows COM PDF 내보내기, LibreOffice가 있으면 그것)에서 만들고 없으면 "렌더 미확인"을 남긴다.
3. **수식은 값이 아니다.** Excel은 수식을 쓰고 가정은 셀 메모나 옆 셀에 적는다. 함수는 Office 2016 지원 목록(기존 471종 원장)에서만 고른다.
4. **구조화가 재사용이다.** 새 PPT는 테마와 레이아웃, 자리표시자, 섹션으로 만들고, 새 Word는 내장 제목 스타일로 만든다. 그래야 양식화(§3)가 역으로 가능하다.
5. **양식 칸 ≠ 자료 개수.** 남는 칸은 그룹째 지우고 모자라면 복제한다. 서식 속성(`pPr`, `rPr`, 셀 스타일)은 복사하고 리터럴 글머리표를 넣지 않는다.
6. **수정은 추적 변경으로 제안한다(Word).** 에이전트의 수정은 `w:ins`/`w:del`로 남기고 사람이 수락한다. 추적 변경 밖의 텍스트 변경은 검증에서 실패다.
7. **COM 우선, OOXML 대체.** Windows에서 문서가 열려 있으면 COM으로 같은 문서 안에서 고친다(기존 native-office-draft 승인 흐름). 없으면 OOXML 경로. 두 경로의 결과는 같은 검증을 통과해야 한다.

## 3. 양식화(templatize)와 채움 구조

```
문서 열기 ─▶ 양식 지도 만들기(XML 분석, 모델은 라벨 의미만) ─▶ 양식 패키지 저장(forms/<이름>/form-map.json, 원본 해시, 미리보기)
                                                                     │
사용자 요청 "/견적서" ─▶ 채움 계획: 칸마다 값의 출처 ─┬─ 사용자 정보(프로젝트 파일, 위키 Claims, 메일 사실)에서 근거와 함께
                                                     └─ 없으면 질문 카드(필수 칸 먼저, 한 번에 묶어서)
                     ─▶ 채움표(코드 검사: 형식, 필수, 숫자) ─▶ 적용(COM 또는 OOXML 제자리) ─▶ 검증(구조, 보존, 근거, 재계산) ─▶ 렌더 그림 ─▶ 검토 카드 ─▶ 사본 저장
```

- **양식 지도(세 앱 공통 계약)**: `{slots:[{id,label,location,kind,format,required,example,group}],fixed:[...],styles:{...},hash}`. Word는 표 칸, 라벨 옆 문단, 콘텐츠 컨트롤. Excel은 라벨 옆 셀, 이름 정의 범위, 입력 색 셀(파랑 글자 관행), 표 행. PPT는 자리표시자, 이름 있는 도형, 반복 그룹(팀원 카드 같은). 반복 그룹은 `group`으로 묶어 "칸 ≠ 자료 개수"를 처리한다. 기존 `form-map.mjs`/`word-form-map.mjs`를 Word 기준으로 재사용하고 Excel과 PPT를 추가한다.
- **양식 등록은 Office를 열어 전체를 가져온다(사용자 지시 2026-10-21 11:20).** 파일만 읽는 등록은 시험 전용이다. 등록 캡처 계약 v1(`runtime/office-capture.mjs`): `{schemaVersion:1, app:'word'|'excel'|'powerpoint', engine:'office'|'file', fidelity:'office'|'file', office:{version, build}|null, source:{name, bytes, hash}, document, assets:[{id, kind:'image'|'render', name, contentType, anchor}], summary}`. document는 앱별로 전부를 담는다. Word: 구역(용지, 여백), 머리글과 바닥글, 각주와 미주, 문단마다 runs `[{text, font, size, color, bold, italic, underline, highlight}]`, 표(셀 음영, 테두리, 병합, 폭), 그림(인라인과 떠 있는 것, 기준 문단, 크기, 자산 id), 콘텐츠 컨트롤, 필드, 스타일 목록. Excel: 통합 문서 이름 정의, 시트 전부 `{name, visible, usedRange, cells:[{address, value, formula, numberFormat, font, fill, alignment, merged}], merges, validations, protected}`, 그림과 차트(자산), 표(ListObject). PowerPoint: 슬라이드마다 `{index, layout, shapes:[{id, name, type, placeholder, text runs(font, size, color), left, top, width, height, picture 자산}], notes}`. renders는 Office가 그린 쪽/슬라이드/시트 그림이다. 저장은 `.nubi/forms/<이름>/`에 `source.<ext>`(원본 바이트 사본, 읽기 전용), `capture.json`(자산 바이트 제외), `assets/`, `renders/`, `form-map.json`, `preview.json`, `source.sha256`. 원본 사본이 있으므로 캡처가 세지 않은 정보도 잃지 않는다. 호스트 명령 `office_capture_template {outDir, maxAssets, renders:true}`는 누비 Office 네이티브 호스트(C#, Codex)가 구현하고, Desktop은 Windows에서 그 호스트로만 등록한다(`form_office_required`). Mac과 CI는 `engine:'file'`(docx 읽기, fidelity 'file')로 시험만 하며 화면에는 "Office로 확인함"과 "파일만 읽음"을 구분해 보인다.
- **원본은 절대 쓰지 않는다.** 출력 경로가 원본과 같으면 거절(`form_source_protected`). 사본에만 쓴다.
- **채움 값의 출처 표시.** 각 값은 `evidence`(파일 경로와 발췌, 위키 Claim, 메일 id) 또는 `asked`(사용자 답)를 가진다. 근거 없는 추정값은 넣지 않고 질문한다.
- **질문은 묶어서 한 번.** 필수 칸의 빈 값을 한 카드에 모아 묻고, 답을 받으면 채움표를 다시 검사한다(기존 질문 흐름 재사용).

## 4. 벤치마크 스위트와 채점

합성 문서만 쓴다(회사 자료 없음). 과제 30개: 앱마다 10개, 종류는 세 가지다.

| 종류 | Word | Excel | PPT |
|---|---|---|---|
| 새로 만들기(사양에서) | 제목 계층, 표, 목차, 번호 목록 | 입력 셀과 수식, 합계, 조건 집계 | 테마와 레이아웃, 섹션, 차트 |
| 양식 채우기 | 견적서/회의록/정의서 양식 | 검수표/예산표(이름 범위) | 보고 템플릿(반복 카드) |
| 기존 문서 수정 | 추적 변경으로 문장 교체와 표 행 추가 | 열 추가와 수식 확장, 외부 링크 보존 | 슬라이드 복제와 순서 바꾸기, 내용 교체 |

채점은 코드가 먼저 한다.

| 지표 | 방법 | 목표 |
|---|---|---|
| 복구 없이 열림 | OOXML 구조 검증(스키마, 관계, 콘텐츠 타입, 차트) | 30/30 |
| 사양 준수 | 요구한 구조 존재(제목/표/시트/슬라이드/차트) 코드 검사 | 30/30 |
| 비대상 보존 | 원본 대비 바뀌지 않아야 할 부분 바이트 동일(styles, 다른 슬라이드, 다른 셀) | 30/30 |
| 수식 평가 | 재계산 뒤 오류 0(Windows COM, 또는 LibreOffice가 있을 때) | 10/10 |
| 양식 정확도 | 기대 값과 칸 위치 일치, 남는 그룹 삭제 | 10/10 |
| 추적 변경 규율 | 추적 밖 텍스트 변경 0 | 10/10 |
| 렌더 확인 | PDF/썸네일을 사람이 검토(항목별 예/아니오) | 결함 0 |

두 실행기를 같은 과제에 돌린다. ① 누비 문서 경로(Mac/CI는 OOXML, Windows 실기기는 COM; 사용자 실측). ② Claude Code 스킬 경로를 참고 기준으로(이 Mac에서 docx-js와 pptxgenjs는 미설치, LibreOffice 없음 → 구조 검증까지만 비교하고 재계산/렌더는 Windows에서). 점수 차가 나는 과제를 격차 목록으로 만든다.

## 5. 과제 D1~D8

| 번호 | 과제 | 요지 | 배치 |
|---|---|---|---|
| D1 | OOXML 구조 검증기 | 스키마(ECMA-376 핵심), 관계, 콘텐츠 타입, 차트 검사와 `--original` 기준선(비대상 바이트 동일). 새 의존성 없이 기존 `fast-xml-parser`/`jszip`로. 모든 문서 쓰기 경로의 마지막 단계 | Task 13 안 |
| D2 | 제자리 편집 경로 | OOXML 대체 경로를 풀기/조각 편집/묶기로 바꾸고 Word run 병합을 넣는다 | Task 13 안 |
| D3 | 양식 지도 세 앱 확장 | Excel(라벨 옆 셀, 이름 범위, 입력 색), PPT(자리표시자, 이름 도형, 반복 그룹) 지도와 "칸 ≠ 자료" 규칙 | Task 11 안 |
| D4 | 채움 값 출처와 질문 묶음 | 값마다 evidence 또는 asked, 필수 빈 칸을 한 카드로 | Task 12 안 |
| D5 | Word 추적 변경 제안 | 수정을 `w:ins`/`w:del`로 쓰고 저자 기준 누락 검사 | Task 13 뒤 |
| D6 | Excel 수식 우선과 재계산 | 수식 쓰기 규칙, 가정 메모, 2016 함수 목록, Windows COM `Calculate` 뒤 오류 0, 외부 링크 보존 | Task 13 뒤 |
| D7 | PPT 구조화 덱과 템플릿 복제 | 테마/레이아웃/자리표시자/섹션으로 생성, 슬라이드 복제와 정리(관계 정리) | Task 13 뒤 |
| D8 | 렌더 확인 | Windows COM PDF 내보내기와 썸네일 격자, 검토 카드에 그림 첨부. Mac/CI는 "렌더 미확인" 표시 | Q5(Windows 체크리스트)와 함께 |

새 의존성은 없다. LibreOffice를 Mac/CI에 번들하지 않는다(§8 질문 25). Windows 실기기가 재계산과 렌더의 판정 환경이다.

## 6. 순서

위키 트랙이 끝난 뒤(사용자 지시 "하나씩") D1 → D2 → D3 → D4(Task 11~13 안에서) → 벤치마크 30과제 기준선 → D5 → D6 → D7 → D8. 기준선 측정 뒤 점수 차가 큰 지표부터 고친다. 과제마다 한 쪽 보고와 합성 문서 결과물, 검증 로그를 남긴다.
