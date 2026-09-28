# Excel 작성 초안의 문맥 개선

2026-09-25. 기존 비교에서 확인한 문맥 관리 과제를 새 Excel 문서 작성 경로에 적용했다. 기준은 Windows Office 2016과 실제 카탈로그의 Qwen 3.8 27B다. native/설치 빌드와 릴리즈는 실행하지 않았다.

## 부족했던 부분

다른 시트는 `draftIndex`로 전달했지만 현재 작성 중인 시트는 `partialDraft`에 전체 내용을 넣고 있었다. 초안은 최대 60,000자이므로 대화와 스킬/도구 정의에 더해 같은 내용을 반복 전달했다. 원문 조회 도구는 셀만 지원하여, 큰 서식 목록을 문맥에서 생략하면 다시 조회할 방법도 없었다.

## 소스 비교와 선택

| 출처 | 이번에 읽은 소스 | 적용 판단 |
|---|---|---|
| [Office Agents](https://github.com/hewliyang/office-agents/blob/95fb654491a9d394dc85ea2b8c93dee2ca4546b9/packages/excel/src/lib/tools/get-cell-ranges.ts) | 고정 커밋의 `get-cell-ranges.ts`를 새로 다운로드했다. A1 범위, 셀 수 제한과 서식 선택 조회를 확인했다. | 필요한 셀과 서식만 읽는 도구 계약을 참고했다. Office.js 실행기를 도입하거나 코드를 복사하지 않았다. package.json의 MIT 선언만 확인됐고 루트 LICENSE 부재 경계는 유지한다. |
| [OpenCode](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/read.ts) | 기존 다운로드에서 offset/limit과 줄/바이트 제한을 확인했다. MIT. | 조회량 제한과 후속 원문 읽기를 참고했다. Office 셀은 중간에서 잘라내지 않고 셀 단위로 생략한다. |
| [Codex](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/exec-server/src/file_read.rs) | 기존 다운로드에서 handle, offset/len, EOF, 열린 조회 수 제한을 읽었다. Apache-2.0. | 저장된 원문과 한 번의 조회 결과를 분리하는 구조를 참고했다. 이 파일은 전송 계층이며 Codex의 전체 문맥 관리 구현이라고 해석하지 않는다. |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 식별자를 남기고 필요할 때 원문을 조회하는 접근을 검토했다. | 초안 원본과 모델에 전달하는 부분 보기를 분리하고 생략된 위치를 조회할 수 있게 했다. |

출처와 파일 해시는 [검토 기록](../verification/draft-context-source-review.json)에 남겼다. 이전 누비 0.8.4 다운로드/경쟁 소스/라이선스 검토는 앞선 비교 기록을 재사용했다. Microsoft Copilot 또는 Claude의 비공개 코드를 확보한 것은 아니다.

## 실제 반영

- 작은 초안은 기존과 같이 전달한다. 큰 초안은 현재 초안 부분의 직렬화 길이를 **24,000자 이내**로 제한한다. 최근 작성/조회한 셀을 먼저 넣고 나머지는 주소를 남긴다.
- 보이는 셀의 값과 수식은 자르거나 요약하지 않는다. 생략된 셀/서식은 비어 있다고 해석하지 않도록 `draftView`에 표시한다. 원본 초안은 메모리에 온전히 남는다.
- `read_document_draft`는 기존 A1 셀 조회에 더해 formats, merges, columnWidths, rowHeights, borders, page를 조회한다. 서식은 최대 8개 항목씩 읽고 다음 cursor는 같은 초안 해시를 요구한다.
- 큰 부분 보기를 `write_document_sheet`로 제출하여 전체 초안을 덮어쓰는 경로를 차단했다. 기존 chunk 수정과 commit은 원본 전체에 적용한다. 스킬 작업공간의 기존 read/edit/write 경로와 권한 계약은 유지한다.
- 서식 chunk는 해당 필드 전체를 교체한다는 기존 의미를 도구 설명/조회 결과에 명시했다. 조회한 일부 서식만으로 전체 목록을 교체하지 않도록 나머지도 읽도록 안내한다.
- Pi 실행기와 기존 Office 초안/조회 도구를 재사용했다. fast-check는 기존 개발 의존성으로 보존/분할 성질을 검사했다. 새 런타임 패키지는 없다.

이는 메모리 초안 조회다. 실제 Office 문서나 NASCA 파일을 외부 도구로 열거나 재저장하지 않는다. 원본 수정, 계산/readback과 최종 저장 승인은 기존 경로를 따른다. 전체 요청 크기 제한도 계속 적용되며 24,000자가 Qwen의 실제 토큰 한도라는 뜻은 아니다.

## 비교와 검증

[재현 스크립트](../eval/benchmark-draft-window.mjs)는 정상 시트 스키마를 통과한 16/40/100개 셀 입력을 사용했다. 현재 초안 JSON이 각각 35,135/38,145/40,848자에서 23,489/23,899/23,847자로 줄었다. **33.1–41.6% 감소는 현재 초안 부분에 대한 수치**이며 전체 요청 토큰/성공률/경쟁 제품 대비 성능이 아니다. 생략한 모든 셀을 다시 읽어 원본과 비교했고 원본 초안은 변경되지 않았다. [결과 JSON](../verification/draft-window-benchmark.json).

단위 검사에서는 정확한 셀/생략 주소 분할, 최근 셀 우선, 서식 페이지 재구성, 변경된 해시 거부와 미작성 속성을 확인했다. fast-check 고정 seed의 Unicode/이스케이프 50개 사례도 같은 보존 조건을 통과했다.

Pi 통합 경로에서는 큰 초안을 작은 chunk로 작성하고 문맥 재구성 후 전체 교체 시도를 거부했다. 생략된 셀을 다시 읽고 모든 원본 값을 보존한 명세로 commit/검토/저장 흐름을 진행했다. 스크립트형 모델과 native fixture를 썼으므로 실제 Qwen/Office 성공의 증거가 아니다. `npm run test:pinned` 전체 **681/681 통과**, 실패/건너뜀 0개다. `npm run design:check`는 공통 24개 파일 일치와 위반 0개를 확인했다. UI 스타일/컴포넌트는 변경하지 않았다. 소스 해시는 [검증 기록](../verification/draft-window-quality.json)을 따른다.

실제 Windows 11/Office 2016 COM/Qwen/NASCA, native lazy paging, 표/차트/도형 기능 확대, 보호된 재시작 복원과 기업 양식 배포는 여전히 별도 과제다. 이번 변경은 설치 파일에 포함되지 않았다.
