# 브라우저 Agent 근거 검색 품질 강화

2026-10-01. 현재 실패와 속도 평가를 바탕으로 긴 문서 검색의 실제 결함을 재현하고 소스에 반영했다. 새 프레임워크를 추가하지 않고 기존 MiniSearch 7.2.0과 LangChain textsplitters 1.0.1을 재사용한다. 둘 다 MIT이며 기존 번들의 라이선스를 유지한다. 이전 Sol/Luna 30과제의 고정 ZIP은 변경하지 않는다.

## 방법론 검토와 선택

| 방법과 공식 근거 | 이번 판단과 적용 |
| --- | --- |
| [Anthropic 평가 방법론](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 실행 종료와 실제 환경 결과를 구분한다. 같은 입력의 반례와 기존 회귀를 검사하고 Chrome에서 원문, 문서 교체와 조회 결과를 독립 확인한다. 합성 원문 검사가 실모델 정확도는 아니다. |
| [LangChain ParentDocumentRetriever 실제 소스](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-classic/src/retrievers/parent_document.ts) | 작은 검색 단위와 충분한 원문 문맥을 분리하는 패턴을 적용한다. 제목만 잘린 경우에만 뒤의 원문을 최대 5000자로 확장한다. ParentDocumentRetriever 패키지, 원격 임베딩과 벡터 저장소는 도입하지 않는다. 기존 MarkdownTextSplitter를 유지한다. |
| [MiniSearch 메모리 색인과 fields](https://lucaong.github.io/minisearch/classes/MiniSearch.MiniSearch.html), [공식 소스](https://github.com/lucaong/minisearch/blob/master/src/MiniSearch.ts) | 실제 기존 라이브러리를 재사용한다. 색인 생성과 검색을 분리하고 본문 검색에서는 text 필드만 검색한다. 문서 제목을 모든 조각의 본문 근거로 취급하지 않는다. |
| [Stagehand 캐시](https://docs.stagehand.dev/v3/best-practices/caching) | 변하지 않은 입력의 재계산을 줄이는 패턴을 참고한다. 현재 문서를 읽고 전체 해시를 확인한 뒤 어휘 색인만 재사용한다. 페이지 관찰, 클릭이나 쓰기 결과를 재생하는 캐시는 이번에 만들지 않는다. 서버 캐시 비용과 외부 전송을 추가하지 않는다. |
| [Anthropic 독립 조사](https://www.anthropic.com/engineering/multi-agent-research-system) | 이전에 도입한 Pi와 p-limit의 읽기 전용 워커를 유지한다. 이번 검색 개선은 주 실행기와 워커의 공통 원문 도구에 적용된다. 모든 과제에 병렬 분석을 추가하지 않으며 어려운 비교 과제의 호출 비용과 완료율은 별도 실모델 평가 대상으로 남긴다. |
| DSPy/GEPA, BrowserGym/AgentLab | [기존 검토](../../../docs/research/2026-10-01-nubi-browser-harness-quality-bp.md)를 재사용한다. 전자는 학습/보지 않은 평가 세트와 독립 정답이 준비된 뒤 비교할 후보다. 후자는 공식 공개 벤치마크 환경에서 사용할 후보다. 설치하거나 공개 점수를 주장하지 않는다. |

공식 main 소스는 조사 자료다. 설치 버전은 현재 package-lock과 node_modules에서 확인했다. 외부 코드를 복사하거나 추가 모델 호출, Python 런타임, 원격 검색 서비스, 인증 저장소를 추가하지 않았다.

## 실제 변경

`browser-content.js`는 긴 단일 문단 앞의 제목을 검색할 때 제목 13자만 반환했다. 바로 뒤의 자격 조건과 제외 조건은 읽히지 않았고 다시 조회해야 했다. 제목만 들어 있는 검색 조각은 현재 원문에서 최대 5000자의 연속 문맥을 반환한다. 이미 유용한 짧은 본문 조각은 늘리지 않는다. 구간, UTF-16 offset, content_hash, PDF의 실제 페이지 겹침, partial과 다음 구간 계약을 유지한다. 확장한 구간도 전체 문서나 예외의 완전한 열람을 증명하지 않는다.

같은 문서의 title을 모든 조각의 name으로 색인해 본문에 없는 단어도 검색 결과를 만들었다. 페이지 원문 검색은 본문 단어로만 후보를 만든다. 다른 도구의 이름/문맥 검색 순위는 기존대로 유지한다. 결과가 없으면 다른 원문 용어나 순차 읽기를 사용하며 사실의 부재로 판정하지 않는다.

`evidence-search.js`의 기존 MiniSearch 구성을 재사용 가능한 검색 함수로 분리했다. 원문 조회는 실제 문서/URL/본문의 SHA-256과 frame을 확인한 뒤 같은 버전의 색인만 재사용한다. 60초, 6개 문서와 합계 30만 문자 범위이며 초과 문서는 검색하지만 캐시에 남기지 않는다. 만료와 퇴출 때 타이머도 제거해 퇴출된 색인이 타이머에 붙잡혀 남지 않게 했다. 저장소나 사이트 위키에 원문을 기록하지 않는다. 현재 관찰과 승인, 쓰기 영수증을 대체하지 않는다.

## 검증

변경 전 ZIP의 두 모듈은 이번 수정 직전 소스와 동일함을 확인했다. 실제 Chrome의 같은 4조건에서 변경 전에는 제목 검색과 제목만의 가짜 본문 일치가 실패했고, 원문 변경/새로고침 거절은 통과했다. 최종 후보는 별도 프로필에서 같은 4조건을 3회 반복한다. 새 `retrieval-context-browser`는 정규 반복 목록과 quality-baseline-v11에 포함한다. v11의 전체 핵심 묶음은 Chrome 122회와 단위/디자인/후보 빌드 3단계이며 이번 집중 검사가 그 전체 묶음의 통과를 의미하지 않는다.

메모리 캐시는 별도 Node 프로세스에서 MiniSearch 생성 횟수와 타이머 수를 관찰해 같은 원문 재사용, 만료, 7번째 문서의 퇴출과 초과 원문의 비보관을 검사했다. 인용 원문과 현재 문서 해시 거절, 유니코드, PDF 구간, 기존 일반 검색과 품질 게이트의 회귀 검사도 수행한다.

반복 검색 실험은 같은 167330자 합성 원문과 4개 검색어를 각 24회 사용하고 변경 전/후 순서를 번갈아 배치했다. 매번 원문 전체 해시 3개와 패킷 생성을 포함했다. 중앙값은 **4.16ms → 1.20ms**였다. 이 값은 로컬 Node 검색 처리만 측정하며 Chrome 읽기, 실제 모델 추론이나 30과제 전체 소요 시간은 포함하지 않는다. 원자료는 [query-benchmark.json](../verification/retrieval-quality-2026-10-01/query-benchmark.json)에 있다.

최종 단위/디자인/빌드 결과, Chrome 반복, 소스 해시와 ZIP은 [result.json](../verification/retrieval-quality-2026-10-01/result.json)에 기록한다. 초기 수정 중 실패한 로그와 중단한 검사도 별도로 보존한다. 새로운 후보의 Sol/Luna/Qwen 실모델 정확도와 전체 완료율은 미측정이며 이전 후보의 실모델 결과를 이 후보의 성능으로 승격하지 않는다.

최종 고정 후보는 단위 **1690/1690**, 관련 검사 **60/60**, 디자인과 후보 빌드 통과다. 실제 Chrome **4조건 × 3회 = 12조건**이 통과했고 세 실행의 번들 해시가 같다. 변경한 8개 소스/검사 파일이 현재 작업 폴더와 고정 후보에서 동일함을 확인했다. 후보 SHA-256은 `edf5e498b2429735d250a1b6d37f370d42612d7f603eae3eadd5d26c01a10e17`이다. 전체 v11의 125단계 게이트나 실모델 평가를 완료한 상태는 아니다.

소스 반영과 후보 패키징까지 진행한다. 설치된 확장 교체, 배포와 업로드는 수행하지 않는다. Workspace Code-OSS의 내장 소스 갱신과 Office native 검증은 이번 브라우저 검색 변경의 증거 범위에 포함하지 않는다.
