# Word 2016 기능 목록과 누비 지원 현황

기준은 Office 2016 Word의 개체 모델(VBA/COM)이다. "가져오기"는 양식 등록 때 저장하는 내용이고, "채우기"는 사본에 값을 쓰는 기능이다. Excel과 PowerPoint는 1.3.1이다.

상태: 지원 / 이번 작업(J) / 막음(이유가 있어 일부러 쓰지 않음) / 1.3.1

## 글과 문단

| Word 2016 기능 | 개체 모델 | 가져오기 | 채우기 |
|---|---|---|---|
| 문단 글 바꾸기 | `Paragraphs(n).Range.Text` | 지원 | 지원(`replace_text`) |
| 안내 문구만 바꾸기 | `Range.Find.Execute Replace` | 지원 | 지원(`replace_guide`, 한 문단에 한 번 나오는 문구) |
| 목차 아래 문단 넣기 | `Range.InsertParagraphAfter` | 지원 | 지원(`insert_paragraphs`, 견본 문단 서식 복사) |
| 작성 요령 문단 지우기 | `Paragraph.Range.Delete` | 지원 | 지원(`remove_paragraph`) |
| 글꼴, 크기, 굵게, 색 등 글자 서식 | `Range.Font` | 지원(12종) | 보존(쓴 글은 그 자리 서식을 따름) |
| 정렬, 들여쓰기, 간격, 테두리 | `Range.ParagraphFormat` | 지원 | 보존 |
| 글머리와 번호 목록 | `Range.ListFormat` | 지원 | 보존과 이어 쓰기 |
| 스타일과 테마 | `Document.Styles`, `Document.DocumentTheme` | 지원 | 보존 |

## 표

| Word 2016 기능 | 개체 모델 | 가져오기 | 채우기 |
|---|---|---|---|
| 칸 값 쓰기 | `Tables(n).Cell(r,c).Range.Text` | 지원 | 지원(`fill_cell`) |
| 행 추가 | `Tables(n).Rows.Add` | 지원 | 지원(`add_rows`, 마지막 행 서식 복사) |
| 병합 칸, 음영, 머리글 반복, 중첩 표 | `Cell.Merge`, `Shading`, `HeadingFormat` | 지원 | 보존 |

## 입력 컨트롤(ContentControls)

| Word 2016 기능 | 개체 모델 | 가져오기 | 채우기 |
|---|---|---|---|
| 일반 텍스트, 서식 있는 텍스트 | `wdContentControlText`, `wdContentControlRichText` | 지원 | 지원 |
| 체크 상자 | `wdContentControlCheckBox`, `.Checked` | 지원 | J1 완료: 체크 상태와 기호 |
| 드롭다운 목록 | `wdContentControlDropdownList`, `.DropdownListEntries` | 지원 | J1 완료: 목록 값만 |
| 콤보 상자 | `wdContentControlComboBox` | 지원 | J1 완료: 목록 값과 자유 입력 |
| 날짜 선택 | `wdContentControlDate`, `.DateDisplayFormat` | 지원 | J1 완료: 날짜 저장과 표시 형식 |
| 표 칸 안의 컨트롤 | `Cell.Range.ContentControls` | 지원 | J1 완료: 행 이름으로 라벨 |
| 그림 컨트롤 | `wdContentControlPicture` | 지원 | J5 완료: Workspace 안 PNG, JPEG를 상자에 맞춰 넣음 |
| 반복 구역 | `wdContentControlRepeatingSection`(2013 이후) | J6 완료: 묶인 표 행을 읽음 | J6 완료: 새 행을 새 항목으로 추가 |
| 사용자 지정 XML에 묶인 컨트롤 | `ContentControl.XMLMapping` | 지원 | J8 완료: 컨트롤과 XML 값(사용자 지정 XML, 문서 속성)을 함께 씀. 단순 경로(/p:a[1]/p:b[1])만, 그 밖은 막음 |
| 잠긴 컨트롤 | `.LockContents` | 지원 | 막음(양식 작성자의 잠금) |

## 머리글, 글상자, 옛 양식 필드, 책갈피

| Word 2016 기능 | 개체 모델 | 가져오기 | 채우기 |
|---|---|---|---|
| 머리글과 바닥글(기본, 첫 쪽, 짝수 쪽) | `Sections(n).Headers(wdHeaderFooterPrimary)` 등 | 지원 | J2 완료: 칸, 컨트롤, 안내 문구, 책갈피. 행 추가는 하지 않음 |
| 글상자 안 글 | `Shapes(n).TextFrame.TextRange` | 지원 | J3 완료: 본문의 글상자. 새 방식과 옛 Word용 사본을 함께 바꿈. 머리글 안 글상자는 1.3.1 |
| 옛 양식 필드(텍스트, 체크, 드롭다운) | `FormFields`, `wdFieldFormTextInput` 등 | J4 완료 | J4 완료: 최대 길이, 목록 값 지킴 |
| 책갈피 자리 값 | `Bookmarks("이름").Range.Text` | 지원(이름) | J6 완료: 이름 붙은 빈 책갈피. 글을 감싼 책갈피는 상호 참조라 그대로 둠 |
| 그림 넣기(사진, 서명) | `InlineShapes.AddPicture` | 지원 | J5 완료: 그림 컨트롤에 넣음. 빈 칸에 새 그림 넣기는 1.3.1 |

## 보호와 변경 추적

| Word 2016 기능 | 개체 모델 | 가져오기 | 채우기 |
|---|---|---|---|
| 문서 보호(읽기 전용, 양식만 입력) | `Document.Protect wdAllowOnlyFormFields` | 지원 | J7 완료: 읽기 전용은 등록만 하고 채우지 않음, 양식 보호는 컨트롤과 양식 필드만 씀 |
| 변경 추적 켜진 문서 | `Document.TrackRevisions` | 지원 | J7 완료: 지운 글과 넣은 글을 '누비' 변경 내용으로 남김. 그림 넣기는 추적하지 않음 |

## 쓰지 않는 것(이유)

| Word 2016 기능 | 개체 모델 | 가져오기 | 채우기 |
|---|---|---|---|
| 필드 결과(DATE, PAGE, MERGEFIELD, 목차) | `Fields(n).Update` | 지원 | 보존. Word가 열거나 인쇄할 때 다시 계산 |
| 각주, 미주, 메모 | `Footnotes`, `Comments` | 지원 | 보존. 양식 칸이 아님 |
| 차트, 수식, 도형 모양 | `InlineShape.Chart`, `OMaths`, `Shapes` | 지원 | 보존 |
| PDF 저장 | `Document.ExportAsFixedFormat` | 해당 없음 | 미리보기는 LibreOffice 렌더. Word로 PDF 저장은 1.3.1 |

## 결과 (2026-10-21)

J1부터 J8까지 구현했다. 각 단계는 실패 시험을 먼저 만들고, 원본은 건드리지 않고 사본에만 쓰며, 쓴 뒤 다시 읽어 확인한다.

- 함께 고친 결함: 글상자나 그림이 있는 문단을 쓰면 글상자와 그림이 사라질 수 있었다. 이제 떠 있는 도형은 그대로 두고, 그림, 수식, 링크, 각주 표시가 있는 문단은 쓰지 않는다.
- 함께 고친 결함: 반복 구역 안의 표 행을 읽지 못했다.
- 실모델 측정: 합성 양식 6건 6/6, 정확도 1.0. 새 '교육 신청서' 사례는 머리글 표, 옛 텍스트 필드, 드롭다운, 날짜, 체크 상자, 책갈피, 글상자를 한 번에 채운다.
- Windows Office 2016에서 Word로 연 결과 확인은 사용자 실측이 남았다.
