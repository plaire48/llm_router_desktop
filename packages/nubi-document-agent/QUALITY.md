# 작성 후 자동 검토와 부분 수정

선택 `@nubi/document-agent/quality`는 기존 `prepareComposition`/생성기/`reviseComposition`을 호스트의 실제 검토에 연결한다. 모델과 렌더러, 계산, 원천 검증, 승인과 저장은 호스트 책임이다. 새 평문 초안만 처리하며 Office/회사 문서 저장을 수행하지 않는다.

```ts
import {runCompositionQuality} from '@nubi/document-agent/quality';
import {composeWord,composeExcel,composePowerPoint} from '@nubi/document-agent/composition';

const result = await runCompositionQuality({
  domain, plan, request, sources, datasets, maxRepairs: 2
}, {
  transport: existingHostTransport,
  async build({domain,plan,signal}) {
    if (domain === 'word') return composeWord(plan,signal,{fontFamily});
    if (domain === 'excel') return composeExcel(plan,datasets,signal,{fontFamily});
    return composePowerPoint(plan,existingFileEngine,signal,{fontFamily});
  },
  inspect: hostInspectCurrentDraft,
  onRound: round => hostEvents.emit(round)
}, signal);
// The host presents the private candidate and review record, then owns approval/save.
```

`inspect`는 `{candidate,layoutHints,signal}`을 받는다. candidate는 `domain`, `plan`, `bytes`, `artifactHash`, `planHash`의 복사본이다. 현재 바이트와 계획에 묶인 아래 검토 영수증을 반환해야 한다.

- `checks`: structure, facts, preservation, render, layout, visual. Excel은 calculation도 필요하다. 각 항목의 status는 passed/failed/not_checked이며 실제 근거 evidence가 필요하다.
- `pages`: 전체 count, 실제 렌더한 페이지별 `{page,imageHash}`, 실제 검토한 페이지 번호 reviewed. 페이지 번호는 1부터 시작한다. PPT는 렌더 페이지 수와 계획 슬라이드 수가 같아야 한다.
- `findings`: code, kind, severity(major/minor), 실제 계획의 JSON Pointer path와 구체적인 message. major가 남으면 완료하지 않는다.
- `artifactHash`, `planHash`: 입력 후보의 값과 정확히 일치해야 한다. 이전 후보 영수증은 거부한다.

검토가 빠졌으면 `needs_review`를 반환한다. 실패를 고칠 실제 위치가 있으면 기존 GenOffice 계획 루프로 부분 수정안을 받고 새 파일을 생성해 다시 검토한다. 검토에서 관찰한 major/minor 경로 밖의 수정은 거부한다. 거부 이유와 허용 경로, 전체 개체 규격을 같은 기존 계획 루프에 전달해 재제안할 수 있다. 반복된 동일 계획은 `stalled`, 제한까지 실패가 남으면 `repair_limit`, 통과했던 검사가 다시 실패하면 `repair_regression`과 직전 후보를 반환한다. 제안서 본문에 수정/검증 설명을 섞지 않는다.

`verified_draft`는 위 호스트 검사와 전체 페이지 검토가 통과했다는 뜻이다. 사람의 최종 승인이나 실제 Office/NASCA 저장 성공을 뜻하지 않는다. 모든 반환값에 `savedToOffice:false`가 남는다. 취소 뒤 늦은 검토/모델 응답은 적용하지 않는다. 입력 domain/request/자료와 원본 계획은 작업 시작 시 고정한다. 영구 checkpoint와 재시작은 기존 호스트 저장 계약에 연결할 후속이다.

`inspectCompositionQuality`는 PPT의 여러 줄 텍스트, 표의 줄바꿈 공간, 작은 글씨와 내용 개체 겹침을 실제 계획 경로로 알려준다. 이 값은 **추정 힌트**다. 글꼴별 실제 배치나 시각 품질은 호스트가 실제 렌더를 읽고 판정해야 한다. 비어 있는 배경 도형을 텍스트 겹침으로 취급하지 않는다. 위치와 양식 프리셋은 제공하지 않는다.

개발 검증에서는 기존 LibreOffice/Poppler/pdfplumber/openpyxl로 실제 PDF/PNG와 계산값을 읽고, 기존 로그인된 Codex/Claude CLI에 PNG를 실제 이미지 첨부로 전달한다. 그림을 JSON의 base64 텍스트로만 넣어 시각 검사했다고 표시하지 않는다. 별도 새 인증 저장소나 모델 실행기를 제품에 추가하지 않는다. 평가용 호스트는 `eval/create-quality-inspector.mjs`, 렌더/계산은 `scripts/render-quality-artifact-v2.py`에 있다. 이 개발 어댑터의 로컬 경로는 제품 API가 아니다.

이전 기능 회귀와 함수 수치는 이 기능의 업무 품질 점수가 아니다. 새 업무와 과거 실패의 실제 적용 결과는 [평가 기록](../../docs/research/2026-10-16-document-agent-quality-cycle.md)에 따로 기록한다.

Excel 작성 거부의 후속은 [수식 참조와 작성 복구 기록](../../docs/research/2026-10-16-document-agent-excel-authoring-repair.md)을 따른다. 같은 업무에서 다시 확보한 거부 계획의 복구와 처음부터 새로 작성한 시험을 구분한다. 새 Excel 평가에서는 기본 입력, 원천 변경, 활동 0건의 세 상태를 실제 저장 파일에서 재계산한다. 수식 분석 통과, 독립 계산, 두 모델 각각의 전 페이지 검토는 서로 다른 근거다. 검토를 통과해도 남은 minor 의견은 영수증에 보존한다.

후속 정렬/문구 보완은 [native 쓰기 준비와 표시 기록](../../docs/research/2026-10-16-document-agent-native-write-preparation.md)에 분리한다. 새 `createNativeOfficeWritePort`와 Windows 실행 도구는 [별도 계약](WINDOWS-OFFICE-WRITE.md)을 따른다. 평문 파일 검토 영수증으로 실제 Office의 변경/계산/저장을 통과시키지 않는다.

Word 자유 구성에는 문단 글자 크기, 줄간격, 앞뒤 간격과 표 글자 크기, 작은 표의 `keepTogether`를 추가했다. 표 너비는 cm, 간격은 pt, 줄간격은 배수다. 기존 GenOffice 문단/표 모델에 전달하며 표의 문단 속성은 `TableParagraph`의 직접 필드를 사용한다. 길고 큰 표는 `keepTogether`를 끄고 반복 머리행으로 페이지를 나눈다.

후속 수정에서 호스트가 보존해야 할 관찰 경로를 알고 있으면 `reviseComposition` 옵션과 `runCompositionQuality` 입력의 `preservePaths`에 JSON Pointer 배열을 전달한다. 예를 들어 `/slides/0`부터 기존 마지막 슬라이드까지 보호하고 `/slides` 수정 범위를 허용하면 맨 뒤 추가는 가능하지만 앞에 삽입해 기존 인덱스를 옮기는 수정은 거부한다. 최대 200개 경로이며 시작 시 실제로 존재해야 한다. 경로 값은 canonical 비교로 유지하며 원본 계획, 데이터와 범위 목록은 모델 대기 전에 복사한다. 보호 위반은 위치 피드백을 기존 루프에 반환하고 후보 파일을 만들지 않는다. 보존 경로는 호스트가 정하며 모델이 자신의 권한을 넓히지 않는다.

Word 표의 `lineSpacing`, `spaceBefore`, `spaceAfter`는 셀 내부 문단에 적용한다. 줄간격은 배수, 앞뒤 간격은 pt이며 기존 GenOffice 모델에는 twip으로 전달한다. 표 바깥 여백을 의미하지 않는다. 정확히 17cm/25.5cm인 합계를 부동소수점 오차로 거부하지 않되 실제 너비 초과는 계속 거부한다. PPT의 명시적 줄바꿈은 줄 수에 필요한 최소 높이를 검사하고 정확한 개체 경로를 반환한다. 이는 최소 계약이며 실제 글꼴 줄바꿈과 표/차트 배치는 여전히 렌더 검토가 필요하다.

Excel의 빈 문자열 값은 스키마대로 허용하며 null이나 수식으로 바꾸지 않는다. 일반 값의 선행 `=` 역시 문자열로 보존하고 수식 필드에서만 정규화한다. 쓰기/의존성 한도와 Office 2016 함수 범위는 유지한다.

평가 호스트는 선택 `reviewProviders`에 두 기존 모델을 지정할 수 있다. 이때 각 모델이 모든 페이지를 실제로 검토해야 하며 한쪽의 누락/실패도 완료를 막는다. 실제 minor 지적이 있는 실패 검사도 부분 수정 대상이다. 실패 검사에 구체적인 지적이 전혀 없으면 검토 대기로 남긴다. 단독 검토와 교차 검토의 실제 성적은 평가 기록에서 분리한다.

배열의 한 인덱스만 관찰한 경우 그 인덱스의 삽입/삭제로 비대상 형제를 이동시키지 않는다. 이런 구조 변경에는 부모 배열의 관찰 범위가 필요하다. 평가 호스트는 PPT의 미첨부 페이지를 지적한 시각 응답을 원문 기록에 보존하고 한 번 재검토한다. 반복되면 해당 응답의 페이지 검토를 인정하지 않는다.
