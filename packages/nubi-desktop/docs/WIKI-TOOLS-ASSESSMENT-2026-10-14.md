# 위키 성능 보강 도구 검토 (Mem0, Docling/MarkItDown, Graphiti, DeepEval) — 2026-10-14

사용자가 제안한 네 가지 도구를 누비 Workspace(Electron, Node 실행기, Windows 회사 PC, Python 없음)에 어떻게 쓸 수 있는지 검토한 결과다. 각 항목은 "무엇인가 / 누비에서 맞는 자리 / 제약 / 추천"으로 정리했고, 마지막에 추천 순서와 사용자 결정이 필요한 항목을 둔다.

## 전제

- 회사 PC에는 Python과 Docker가 없고, 설치판은 Node 24와 Electron만 포함한다. Python 기반 도구는 **개발 PC에서 측정과 비교에만** 쓰고, 제품에는 같은 개념을 Node로 옮겨 넣는다.
- 사내 데이터는 PC 밖으로 나가지 않는다. 호스팅형 서비스(Mem0 Platform 등)는 제외한다.
- OpenWiki 코어는 수정하지 않는다(2026-09-29 결정). 보강은 누비 실행기와 화면, 평가 하네스에서 한다.

## 1. Mem0 (mem0ai/mem0) — 대화 메모리 계층

- **무엇인가**: 대화에서 기억할 사실을 모델로 추출해 저장하고, 다음 대화에서 검색해 프롬프트에 넣는 계층. 추출 → 기존 기억과 대조(ADD/UPDATE/DELETE/NOOP) → 벡터 저장이 핵심 알고리즘이다.
- **Node 지원**: npm `mem0ai` 3.3.1(Apache-2.0)에 `mem0ai/oss` 자체 호스팅 진입점이 있다. OpenAI 호환 LLM과 임베더, 벡터 저장소(메모리 내장 또는 외부)를 설정해야 한다. 의존성은 `openai`, `axios`, `zod`, `uuid`.
- **누비에서 맞는 자리**: 사용자 선호(답변 길이, 자주 쓰는 프로젝트, 담당 업무), 프로젝트 사실(배포 절차의 예외, 담당자)처럼 **대화마다 다시 말해야 하는 것**. 위키(OpenWiki)는 소스 기반 사실, 메모리는 사람이 말한 사실로 역할이 다르다.
- **제약**: 누비의 모델 호출은 전부 `providers.complete`(AI Pro, FabriX, ChatGPT, Claude CLI)를 거친다. `mem0ai/oss`는 OpenAI 호환 HTTP 엔드포인트를 직접 부르므로, 사내 OpenAI 호환 API가 있을 때만 바로 붙는다. Claude CLI 경로로는 쓸 수 없다.
- **추천**: Mem0의 **알고리즘을 누비 실행기에 직접 구현**한다. 추출 프롬프트와 대조 규칙은 Mem0 OSS를 그대로 따르되, 호출은 기존 어댑터, 저장은 프로젝트 상태 SQLite(+ 임베딩은 기존 검색 임베더)로 한다. 이렇게 하면 어떤 제공자에서도 동작하고 데이터가 PC에 남는다. 사내 OpenAI 호환 API가 확인되면 `mem0ai/oss`로 교체할 수 있게 저장 형식을 Mem0와 같은 필드(memory, hash, created_at, updated_at, metadata)로 맞춘다.
- **화면**: 설정에 "기억" 항목(목록, 삭제, 끄기). 새 기억이 생기면 대화에 "기억했어요: …" 한 줄과 되돌리기. 저장 전 승인은 기본 꺼짐으로 두되 사용자 결정 사항.

## 2. MarkItDown, Docling — 문서를 Markdown으로

- **현재 누비**: `runtime/document-extract.mjs`가 PDF는 pdf.js 텍스트, DOCX는 mammoth, PPTX/XLSX는 직접 XML 파싱으로 읽는다. 표는 줄바꿈 텍스트로 풀리므로 **PDF 표의 열 구조와 조건 항목이 깨진다**는 지적이 맞다. Windows에서는 Office가 있으면 `office-document.ps1`로 변환한다.
- **MarkItDown**(Python, MIT): 형식 변환에 가볍다. 표는 간단한 Markdown 표로 나오지만 PDF는 pdfminer 기반이라 표 구조 복원은 약하다.
- **Docling**(Python, MIT): 레이아웃 모델과 TableFormer로 PDF 표를 구조째 복원한다. 모델 파일이 수백 MB, PyTorch 필요. 회사 PC 설치판에는 넣을 수 없다.
- **추천**: 제안대로 **PDF 표가 깨지는 사례는 Docling을 1순위 비교 후보**로, 단순 변환은 MarkItDown으로 둔다. 다만 둘 다 **개발 PC에서 비교 실험**으로 시작한다. 표가 많은 사내 PDF 샘플 10개를 세 방식(현재 pdf.js, MarkItDown, Docling)으로 변환해 표 복원율과 조건 항목 보존을 채점한다. 결과에 따라 (a) Node에서 가능한 보강(pdf.js 글자 좌표 기반 표 복원)을 먼저 하고, (b) 그래도 부족하면 "선택 설치 사이드카"(Python 포함 번들)를 사용자 결정으로 올린다.
- **위키 생성에 쓰는 경우**: OpenWiki는 Markdown과 소스만 읽으므로, 변환은 OpenWiki 앞단(누비가 `openwiki/sources/`에 Markdown을 쓰는 단계)에서 한다. 코어 수정 없이 가능하다.

## 3. Graphiti (getzep/graphiti) — 시간 기반 지식 그래프

- **무엇인가**: 에피소드(메일, 문서, 대화)에서 개체와 관계를 추출해 그래프로 쌓되, 각 사실에 **유효 시작(valid_at), 무효화 시점(invalid_at), 원본 에피소드**를 남기는 이중 시간 모델. 질문 시점 기준으로 "그때 참이던 사실"을 찾는다.
- **제약**: Python, 그래프 DB(Neo4j, FalkorDB, Kuzu) 필요, 추출마다 LLM 호출. 회사 PC에는 올릴 수 없고, 사내 서버로도 별도 인프라다.
- **누비에서 맞는 자리**: 메일과 결재는 "사실이 바뀌는" 자료다(담당자 변경, 기한 연장, 금액 수정). 지금 OpenWiki Claims는 소스 기준 신선도(`wiki-evidence.mjs`)만 보고 **시간 축이 없다**. Graphiti의 모델만 가져오면 된다.
- **추천**: 그래프 DB 없이 **시간 사실 기록**을 SQLite에 둔다. 한 사실 = (주어, 서술, 값, valid_from, invalid_at, 원본: 메일 ID 또는 커밋, 대체한 사실 ID). 메일 자동 정리 단계에서 사실을 추출하고 같은 주어, 서술의 이전 사실을 invalid_at로 닫는다. 위키 문서 화면의 "연결된 문서" 아래에 "사실 이력"을 보여 주고, 에이전트 질문에는 질문 시점 기준 유효 사실만 근거로 준다. 추출 프롬프트는 Graphiti의 엔티티, 엣지 추출 프롬프트 구조를 참고한다.
- **범위 결정**: 처음에는 메일 위키만. 소스 위키는 Git 이력이 이미 시간 축 역할을 한다.

## 4. DeepEval (confident-ai/deepeval)과 OpenWiki 자체 평가

- **DeepEval**: Python 평가 프레임워크. 근거 충실도(Faithfulness), 답변 관련성, 문맥 정밀도, 재현율, 요약, G-Eval(사용자 기준) 지표를 LLM 판정으로 계산한다. 판정 모델은 사용자 정의 클래스로 바꿀 수 있어 사내 API에 붙일 수 있다.
- **OpenWiki 자체 평가**: `packages/openwiki/evals/ledger`(LEDGER)는 Git 체크포인트를 재생하며 생성된 위키의 **각 사실 주장을 supported / stale / invented / unverified**로 판정한다. 위키가 소스 변화에 따라 얼마나 정확하고 최신인지 재는 지표로, 우리가 보강하려는 "갱신 품질"과 정확히 맞는다. `evals/deepswe`는 Codex 과제 해결에 위키가 도움이 되는지 재는 쌍대 실험으로, Harbor와 LangSmith가 필요해 지금 환경과는 거리가 있다.
- **현재 누비 하네스**: `eval/grade.mjs`는 관찰 가능한 결과(파일 변경, 키워드, 정규식)만으로 채점하고 모델의 자기 주장은 세지 않는다. 근거 충실도 같은 **판정형 지표가 없다**.
- **추천**:
  1. 누비 하네스에 **LLM 판정 지표**를 Node로 추가한다(DeepEval의 Faithfulness, Answer Relevancy, Summarization 프롬프트 구조를 따름). 판정 모델은 기존 릴레이(`eval/relay.mjs`)로 호출하므로 Python이 필요 없다. 쉬운 80문항에는 "근거 충실도", 메일 정리에는 "요약 충실도"를 붙인다.
  2. **LEDGER를 개발 PC에서 우리 코퍼스(order-service)로 실행**한다. OpenWiki 제공자 설정(OPENWIKI_PROVIDER)이 필요하므로, 릴레이 위에 OpenAI 호환 로컬 HTTP 어댑터를 하나 두면 사내 API나 Claude CLI 경로로도 돌릴 수 있다. 결과(stale, invented 비율)를 갱신 품질 기준선으로 삼고, 커밋하지 않은 변경 갱신(10-12 작업)의 전후를 같은 지표로 다시 잰다.
  3. DeepEval 자체는 개발 PC Python 환경에서 판정 프롬프트 교차 검증용으로만 쓴다(제품 포함 없음).

## 추천 순서

| 순서 | 작업 | 이유 | 규모 |
| --- | --- | --- | --- |
| 1 | 판정형 지표 추가(근거 충실도, 요약 충실도)와 LEDGER 기준선 측정 | 성능을 올리려면 먼저 재야 한다. 둘 다 코어 수정 없이 가능 | 하네스 2~3일 |
| 2 | 시간 사실 기록(Graphiti 모델) — 메일 위키부터 | 메일, 결재는 사실이 바뀌는 자료. 지금 가장 큰 품질 구멍 | 실행기+화면 1주 |
| 3 | 대화 메모리(Mem0 알고리즘) | 반복 설명을 줄이고 답변 개인화. 저장 정책 결정 필요 | 실행기+설정 화면 3~4일 |
| 4 | PDF 표 추출 비교 실험(Docling, MarkItDown, 현재) | 결과가 나와야 Node 보강인지 사이드카인지 정한다 | 개발 PC 1일 |

## 사용자 결정이 필요한 것

1. 사내 **OpenAI 호환 HTTP 엔드포인트**가 있는가(있으면 Mem0 OSS, DeepEval, LEDGER를 직접 연결할 수 있다. 없으면 모두 릴레이 어댑터 경유).
2. 회사 PC에 **선택 설치 Python 사이드카**를 둘 수 있는가(Docling용). 불가하면 Node 보강까지만 한다.
3. 대화 메모리의 **저장 범위와 승인**: 개인 PC 로컬만, 프로젝트별 분리, 저장 전 확인 여부.
4. 시간 사실 기록을 **메일 위키에만** 먼저 적용하는 데 동의하는가.
5. 평가용 사내 샘플(메일, PDF, 위키)을 로컬 전용으로 제공할 수 있는가. 공개 코퍼스만으로는 표 깨짐과 사실 변경 사례가 부족하다.
