# 개인 메일 검색과 Agent 연계

2026-10-02 사용자 요청에 따른 현재 구현 확인과 후속 설계. 실제 계정 내용과 비밀번호는 이 문서에 남기지 않는다.

## 현재 확인한 경계

- POP3 UIDL 수집, 첨부 추출, 선택 모델 정리, 원문 해시 대조와 불변 개인 Wiki 저장은 기존 구현을 재사용한다. 자동 정리 OFF는 새 수집/첨부 읽기/모델 정리를 모두 중지한다.
- 메일 화면은 제목/보낸 사람 필터만 사용하고 있었다. 이번 변경은 기존 personal_mail_query와 같은 mail query 호출을 화면에 연결한다. OpenWiki Personal 범위와 관련 구간, 원문 열기, 정리 전/읽기 실패/문서 수정/검색 한도를 표시한다.
- 현재 검색은 MiniSearch의 구조 문맥을 포함한 BM25다. 저장된 Wiki 최대 1,000개, 최대 5개 구간을 반환한다. 요약에서 빠진 원문 정보는 이 검색으로 찾을 수 있다고 주장하지 않는다. 의미 검색, 원문 전체 인덱스, 재순위화와 스레드별 집계는 아직 없다.
- Agent는 personal_mail_query로 찾은 sourceId를 read_personal_mail로 읽는다. 도구 존재와 실제 실행 기록은 구분한다. 인용 강제 검증과 UI의 대화 근거 첨부는 후속이다.
- 최근 반영은 Wiki readback이 확인된 저장 영수증 savedAt이다. POP3 listingAt/lastCheckedAt과 별도로 표시한다. 하단은 수집/첨부/정리/확인 대기/연결 필요를 실제 호스트 상태로 표시한다.
- 진행 시간은 monotonic clock의 실제 측정값을 정수 초로 보여준다. 메시지 시각은 원래 기록을 OS 형식으로 표시한다. 큐의 생성 시각과 Agent 반영 시각을 분리한다.

## 추천 설계와 공식 근거

1. 원문 메일과 추출한 첨부를 정확한 정보 검색용으로 인덱싱하고 개인 Wiki를 업무 문맥/요약 검색용으로 함께 사용한다. 제목, 보낸 사람, 수신 시각, Message-ID/References, 첨부 이름과 문서 내 위치, UIDL/원문 해시를 보존한다. 원문과 생성 설명은 별도 필드로 둔다. [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)은 구간에 문서별 문맥을 붙이는 접근과 BM25/임베딩 결합을 설명한다.
2. 보낸 사람/기간/첨부 종류를 먼저 제한한 뒤 키워드와 의미 검색을 합친다. 정확한 프로젝트 코드, 날짜, 금액은 키워드 검색을 유지하고 표현이 다른 질문은 의미 검색으로 보완한다. 후보를 재순위화하고 중복 회신을 정리한다. [OpenAI Retrieval](https://developers.openai.com/api/docs/guides/retrieval)의 attribute_filter와 hybrid_search/RRF, Anthropic의 reranking을 방법론으로 참고한다. OpenAI 호스팅 저장소를 새로 연결하거나 메일을 업로드한 것은 아니다. 사내 허용 임베딩과 실제 검색 평가가 확보된 뒤 도입한다.
3. 검색 도구는 작은 결과와 ID/위치를 반환한다. Agent가 필요한 원문/첨부 구간만 다시 읽고 기간과 회신 흐름을 확인한다. 여러 메일을 읽은 뒤 결정/요청/기한/변경 사항을 출처별로 합친다. [Anthropic Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)의 just-in-time 조회를 적용할 후속 설계다. 메일 전체를 매번 프롬프트에 붙이지 않는다.
4. 답변에 원문/첨부 위치로 열리는 출처를 달고 메일 수신 기준, 검색 범위와 누락을 남긴다. [OpenAI File Search](https://developers.openai.com/api/docs/guides/tools-file-search)의 file_citation과 검색 결과 반환을 참고한다. 최신 회신이 빠진 상황을 최신 결정이라고 표시하지 않는다.
5. 메일은 외부 발신자의 자료이며 사용자 지시나 실행 승인으로 승격하지 않는다. 검색/원문 조회와 파일 변경/외부 전송을 분리하고 기존 승인을 유지한다. [OpenAI Agent Safety](https://developers.openai.com/api/docs/guides/agent-builder-safety)의 비신뢰 자료 분리와 구조화된 전달을 참고한다. 인증은 사용자 결정대로 시작할 때마다 다시 연결하며 비밀번호를 디스크/프롬프트에 저장하지 않는다.

## 우선순위와 판단 방법

먼저 원문/첨부 인덱스, 보낸 사람/기간/첨부 필터, 스레드 묶기와 클릭 가능한 인용을 보강한다. 다음으로 허용된 의미 검색/재순위화가 정확한 키워드 검색보다 개선되는지 비교한다. 새 검색 서비스를 후보를 찾았다는 이유만으로 설치하지 않는다.

향후 품질 평가에는 정확한 키워드, 표현이 다른 질문, 첨부에만 있는 정보, 서로 다른 회신/기한 변경, 정보 없음, 누락 첨부를 포함한다. 정답 원문 검색 Recall@5/10, 인용이 실제 구간을 뒷받침하는 비율, 날짜/금액 일치, 답변 시간과 토큰을 따로 본다. 공급사의 개선 수치를 누비 성적으로 표시하지 않는다. 현재 사용자 지시에 따라 테스트를 실행하지 않고 Electron 빌드와 수동 읽기/화면 확인만 수행한다.
