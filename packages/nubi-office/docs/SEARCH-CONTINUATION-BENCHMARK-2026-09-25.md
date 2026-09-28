# Office 검색 누락 비교와 개선

2026-09-25. 앞선 [구조 조회 비교](OFFICE-AGENT-BENCHMARK-2-2026-09-25.md)의 후속 작업이다. Windows Office 2016 / 사내 Qwen 3.8 27B 기준을 유지했다. 설치/native 빌드와 릴리즈는 실행하지 않았다.

## 확인한 격차

기존 `searchContentPages`는 MiniSearch 결과를 `slice(0,8)`로 잘랐고 나머지를 조회할 방법이 없었다. 같은 용어가 여러 문단이나 발표자 노트에 있으면 상위 8개 이후의 일치 항목에 접근하려고 질의를 임의로 바꿔야 했다. 검색 결과 개수와 이어보기 여부도 없었다. 이는 전체 문서를 읽는 도구의 유무와 별개인 검색 인터페이스의 누락이다.

추가로 검색 직전에 native 원본을 다시 확인하지 않았고, 진전 기록이 항목 ID만 사용해 같은 항목의 본문과 노트를 구분하지 못했다. 이번에는 이 두 경계도 수정했다.

## 소스와 방법론 검토

| 출처 | 직접 확인 | 적용 및 비선택 |
|---|---|---|
| [Office Agents 검색 페이지 처리](https://github.com/hewliyang/office-agents/blob/95fb654491a9d394dc85ea2b8c93dee2ca4546b9/packages/excel/src/lib/excel/search-data-pagination.ts) | 고정 커밋의 `search-data-pagination.ts`와 `tools/search-data.ts`를 새로 다운로드했다. offset, hasMore, nextOffset과 범위 제한을 확인했다. | 나머지 결과를 조회할 수 있는 명시적 페이지 계약을 참고했다. 해당 collector의 totalFound는 조기 종료 시 전체 정확한 수가 아닐 수 있어 그대로 복사하지 않았다. |
| [OpenCode grep](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/grep.ts) | 기존 다운로드에서 검색 범위, 결과 제한, 추가 결과와 잘림 안내를 읽었다. MIT. | 결과 제한을 숨기지 않는 방식 참고. Office 원본을 파일 검색이나 셸에 넘기지 않는다. |
| [Codex tool search](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/tools/handlers/tool_search_spec.rs) | 기존 다운로드에서 query/limit와 설명 예산을 확인했다. Apache-2.0. | 도구 발견용 인터페이스이므로 문서 검색 구현으로 혼동하지 않았다. 동적 도구 선택은 이번 변경 범위가 아니다. |
| [Anthropic 도구 설계](https://www.anthropic.com/engineering/writing-tools-for-agents) | 범위 축소, 페이지 처리와 에이전트가 후속 행동을 선택할 수 있는 도구 응답을 검토했다. | 반환량을 제한하면서 다음 조회 방법과 미확인 범위를 함께 제공한다. |
| [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) | 큰 도구 집합의 지연 발견과 문맥 비용 문제를 검토했다. | 모델/제공자별 API를 추가하는 대신 기존 Qwen 호환 도구 계약을 유지했다. Claude 전용 기능을 지원한다고 표시하지 않는다. |

Office Agents는 package.json에 MIT를 선언하지만 이전 검토에서 루트 LICENSE가 발견되지 않았다. 이번에도 코드 복사나 패키지 설치 없이 설계 참고만 했다. 다운로드/검토 파일 해시는 [출처 기록](../verification/search-source-review.json)에 있다. 누비 0.8.4 소스는 앞서 다운로드한 아카이브와 비교 기록을 재사용했다. Microsoft Copilot/Claude 비공개 제품 코드를 확보한 것은 아니다.

## 실제 반영

- 기존 **MiniSearch 7.2.0**과 **Pi 실행기**를 재사용한다. 신규 런타임 의존성은 없다.
- Word/PPT `search_document`에 `cursor`, `viewId`, `field`를 추가했다. 본문, 노트, 제목/태그/이름을 구분해 검색할 수 있다.
- 최대 8개 결과와 직렬화 12,000자 이내로 반환한다. `totalMatches`, `nextCursor`와 원문 위치/발췌를 제공한다.
- 이어보기는 같은 문서 관찰, 질의와 필터에만 유효하다. 원본 fingerprint 변경뿐 아니라 읽은 페이지 추가도 이전 cursor를 무효화한다. 결과 순위가 달라진 채 다음 페이지를 잇지 않는다.
- 검색 전에 이미 읽은 native 페이지를 순차 재확인한다. 검색과 이어보기는 쓰기 승인이 아니다.
- 진전 기록은 실제 fingerprint, 항목, 필드, 발췌 위치/내용으로 구분한다. 같은 결과를 재요청하거나 질의만 바꿔서는 새로운 검색 진전으로 계산하지 않는다.
- 잘린 항목은 전체 개수와 최대 40개 ID, 생략된 ID 수로 표시한다. 미열람 페이지와 본문 미확인은 결과를 모두 조회해도 해소되지 않는다.

검색은 정규화된 단어 기반 순위 검색이다. `totalMatches`는 일치한 **항목의 필드 수**이며 단어의 등장 횟수나 정확한 구문 일치 개수가 아니다. 같은 필드에 여러 번 등장한 모든 위치를 반환하지 않는다. 원문 상세 읽기와 기존 native 편집 검증이 계속 필요하다.

## 평가와 한계

[고정 입력 비교](../eval/benchmark-search-continuation.mjs)는 Word/PPT 각 25/80/200개 항목에서 본문과 노트를 검색한다. 이전 정책은 질의당 8개 필드만 조회 가능했으며, 개선 후 각각 **50/160/400개 필드**를 이어보기로 모두 조회했다. 6개 사례 모두 중복 0개이고 발췌는 원문 substring과 일치했다. 이전 정책의 비교값은 기존 코드의 상위 8개 제한에서 계산한 값이며 타사 실행 결과가 아니다. [기계 판독 결과](../verification/search-continuation-benchmark.json).

실제 Pi 통합 경로의 스크립트형 Word/PPT 검사에서는 20개 노트 결과가 다음 모델 호출을 거쳐 모두 회수되고 native 쓰기는 0회임을 확인했다. 테스트 fixture의 항목 수를 실제 목록과 일치시키고, 이전의 안내 문구 문자열 검사도 구조화된 검색 결과 계약 검사로 바꿨다.

`npm run test:pinned` 전체 **668/668 통과**, 실패/건너뜀 0개다. `npm run design:check`는 공통 24개 파일 일치와 위반 0개를 확인했다. 이번에는 UI 스타일/컴포넌트를 변경하지 않았다. 소스 해시는 [검증 기록](../verification/search-continuation-quality.json)을 따른다. 합성 검색 회수율을 Qwen 문서 이해 정확도로 표현하지 않는다. 실제 Windows 11/Office 2016 COM/Qwen/NASCA 성능은 미검증이다. 검색 전 원본 재확인이 추가되므로 COM 비용 감소도 주장하지 않는다. native lazy paging, 표/차트/도형 편집 확대, 보호된 재시작 복원과 기업 양식 배포는 여전히 남은 과제다.
